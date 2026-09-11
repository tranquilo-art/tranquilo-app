// The nightly canary once couldn't read the file it verifies. GitHub's
// Contents API only inlines content under 1 MB; past that it still
// returns 200 with `encoding: "none"` and empty content, so once the
// gzipped backup crossed 1 MB the canary read an empty string and
// reported a perfectly good backup as broken. A false alarm here is
// costly: it alerts loudly, skips pruning, and trains us to ignore the
// one alert that must never be ignored. The fix reads through the Git
// Blobs API instead, which returns base64 for files up to 100 MB.

import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { verifyWrittenBackup } from "../lib/cron/db-backup.ts";

function rows(n: any) {
  return Array.from({ length: n }, (_, i) => ({
    id: `met-${i}`,
    native_id: String(i),
    source: "met",
    title: `row ${i}`,
  }));
}
function gzB64(value: any) {
  return zlib
    .gzipSync(Buffer.from(JSON.stringify(value), "utf-8"))
    .toString("base64");
}

// A fake GitHub shaped like the real one. The first fix shipped broken
// because this fake returned an already-parsed object instead of a raw
// Response -- verifyWrittenBackup() read `meta.sha` fine in tests but got
// `undefined` in production, so the blob fallback never ran for real. This
// now returns Response-like objects, so a caller that forgets to parse
// fails here instead of at 03:00 in production.
function response(body: any, status?: any) {
  return {
    ok: (status || 200) < 400,
    status: status || 200,
    json: async () => body,
  };
}

function fakeGitHub(payload: any, opts?: any) {
  const options = opts || {};
  const b64 = gzB64(payload);
  const size = Buffer.from(b64, "base64").length;
  return async (path: any) => {
    if (path.indexOf("/git/blobs/") !== -1) {
      if (options.blobFails) return response({ message: "Not Found" }, 404);
      return response({ encoding: "base64", size: size, content: b64 });
    }
    // Contents API. Over 1 MB it returns 200 with no content -- nothing
    // about it looks like an error.
    if (options.overOneMb)
      return response({
        sha: "abc123",
        size: size,
        encoding: "none",
        content: "",
      });
    return response({
      sha: "abc123",
      size: size,
      encoding: "base64",
      content: b64,
    });
  };
}

describe("reading back a backup over 1 MB", () => {
  it("verifies it, instead of reporting the backup broken", async () => {
    const payload = rows(4743);
    const out = await verifyWrittenBackup(4743, {
      request: fakeGitHub(payload, { overOneMb: true }),
    });
    expect(out).toMatchObject({ ok: true, rows: 4743 });
  });

  it("still works for a small file the Contents API would inline", async () => {
    const out = await verifyWrittenBackup(3, { request: fakeGitHub(rows(3)) });
    expect(out.ok).toBe(true);
  });
});

describe("what it must still catch", () => {
  it("a row-count mismatch", async () => {
    const out = await verifyWrittenBackup(4743, {
      request: fakeGitHub(rows(4700), { overOneMb: true }),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/row count mismatch/i);
    expect(out.reason).toContain("4743");
    expect(out.reason).toContain("4700");
  });

  it("a payload that is not an array", async () => {
    const out = await verifyWrittenBackup(1, {
      request: fakeGitHub({ oops: true }, { overOneMb: true }),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not an array/i);
  });

  it("rows missing their identifiers", async () => {
    const out = await verifyWrittenBackup(1, {
      request: fakeGitHub([{ title: "no id" }], { overOneMb: true }),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/missing id/i);
  });

  it("a file it genuinely cannot read", async () => {
    // Must still be reachable -- the fix stops reporting it falsely, not
    // reporting it at all.
    const out = await verifyWrittenBackup(1, {
      request: fakeGitHub(rows(1), { overOneMb: true, blobFails: true }),
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(true); // unread, not proven bad
    expect(out.reason).toMatch(/returned no content/i);
  });

  it("never passes on empty content", async () => {
    const out = await verifyWrittenBackup(0, {
      request: async () => response({ encoding: "base64", content: "" }),
    });
    expect(out.ok).toBe(false);
  });
});

// A "do not trust today's file" alert can fire for a backup that's
// completely fine -- the canary couldn't read it, not that it's wrong.
// These are different findings with different flags; loud wording is
// reserved for a backup actually read and found wrong.
describe("inconclusive vs actually-bad", () => {
  it("flags an unparseable API shape as inconclusive, not a bad backup", async () => {
    const out = await verifyWrittenBackup(1, {
      request: async () => response({ size: 9, encoding: "none", content: "" }), // no sha
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(true);
    expect(out.reason).toMatch(/neither content nor a sha/i);
  });

  it("flags a row-count mismatch as a BAD backup, not inconclusive", async () => {
    const out = await verifyWrittenBackup(99, {
      request: fakeGitHub(rows(3), { overOneMb: true }),
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(false);
    expect(out.reason).toMatch(/row count mismatch/i);
  });

  it("flags undecodable bytes as a BAD backup -- we read them and they're wrong", async () => {
    const out = await verifyWrittenBackup(1, {
      request: async () =>
        response({ sha: "x", encoding: "base64", content: "bm90Z3ppcA==" }),
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(false);
  });

  it("treats a non-ok HTTP response as inconclusive", async () => {
    const out = await verifyWrittenBackup(1, {
      request: async () => response({ message: "Bad credentials" }, 401),
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(true);
  });
});
