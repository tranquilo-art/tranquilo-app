// The read-back check: a failed GET is inconclusive, while bytes that
// don't decode, parse or match the written row count are a bad backup.

import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { verifyWrittenBackup } from "../lib/cron/db-backup.ts";

const config = {
  bucket: "tranquilo-db-backups",
  region: "us-east-1",
  accessKeyId: "AKIAEXAMPLE",
  secret: () => "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `met-${i}`,
    native_id: String(i),
    source: "met",
    title: `row ${i}`,
  }));
}
function gz(value: unknown) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(value), "utf-8"));
}

function fakeGetObject(
  body: Buffer,
  opts: { fails?: boolean; status?: number } = {},
) {
  return async () => {
    if (opts.fails) return { ok: false, status: opts.status || 404 };
    return { ok: true, status: 200, body: body };
  };
}

describe("reading back a written backup", () => {
  it("verifies a good backup", async () => {
    const out = await verifyWrittenBackup(config, 4743, {
      getObject: fakeGetObject(gz(rows(4743))),
    });
    expect(out).toMatchObject({ ok: true, rows: 4743 });
  });

  it("verifies a small backup", async () => {
    const out = await verifyWrittenBackup(config, 3, {
      getObject: fakeGetObject(gz(rows(3))),
    });
    expect(out.ok).toBe(true);
  });
});

describe("what it must still catch", () => {
  it("a row-count mismatch", async () => {
    const out = await verifyWrittenBackup(config, 4743, {
      getObject: fakeGetObject(gz(rows(4700))),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/row count mismatch/i);
    expect(out.reason).toContain("4743");
    expect(out.reason).toContain("4700");
  });

  it("a payload that is not an array", async () => {
    const out = await verifyWrittenBackup(config, 1, {
      getObject: fakeGetObject(gz({ oops: true })),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not an array/i);
  });

  it("rows missing their identifiers", async () => {
    const out = await verifyWrittenBackup(config, 1, {
      getObject: fakeGetObject(gz([{ title: "no id" }])),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/missing id/i);
  });

  it("undecodable bytes are bad, not inconclusive", async () => {
    const out = await verifyWrittenBackup(config, 1, {
      getObject: fakeGetObject(Buffer.from("not gzip")),
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(false);
  });
});

describe("inconclusive vs actually-bad", () => {
  it("flags a GET failure as inconclusive, not a bad backup", async () => {
    const out = await verifyWrittenBackup(config, 1, {
      getObject: fakeGetObject(Buffer.alloc(0), { fails: true, status: 403 }),
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(true);
    expect(out.reason).toMatch(/HTTP 403/);
  });

  it("flags a row-count mismatch as a BAD backup, not inconclusive", async () => {
    const out = await verifyWrittenBackup(config, 99, {
      getObject: fakeGetObject(gz(rows(3))),
    });
    expect(out.ok).toBe(false);
    expect(out.inconclusive).toBe(false);
    expect(out.reason).toMatch(/row count mismatch/i);
  });
});
