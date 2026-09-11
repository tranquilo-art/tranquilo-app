// The backup outgrew the GitHub Contents API's ~100 MB ceiling -- measured
// at 2,721 bytes/row as JSON, ~3,628 base64-encoded, capping at ~27,600
// items. gzip compresses this JSON shape roughly 10:1, moving the ceiling
// to ~280,000; object storage is the proper long-term answer, this buys
// the year. What matters here is the round trip -- a backup that can't be
// restored is worse than no backup, because it's believed.

import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  backupFilename,
  decodeBackupBody,
  encodeBackupBody,
  isDatedBackupName,
} from "../lib/backup-format.ts";

const SAMPLE = JSON.stringify([
  {
    native_id: "436884",
    source: "met",
    title: "The Chess Players",
    medium: "Tempera on wood",
  },
  {
    native_id: "522646",
    source: "cleveland",
    title: "Untitled",
    medium: "albumen print",
  },
]);

describe("backup encoding", () => {
  it("round-trips exactly", () => {
    expect(decodeBackupBody(encodeBackupBody(SAMPLE))).toBe(SAMPLE);
  });

  it("round-trips unicode without mangling it", () => {
    const tricky = JSON.stringify([
      { title: "Médînet-Abou (Thèbes) — Constructions Postérieures" },
      { title: "Sèriè à la Ristori" },
      { title: "四季花卉棋盤" },
      { artist: "Кузьма Петров-Водкин" },
    ]);
    expect(decodeBackupBody(encodeBackupBody(tricky))).toBe(tricky);
  });

  it("produces base64, because the Contents API demands it", () => {
    expect(encodeBackupBody(SAMPLE)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("actually compresses -- the whole point", () => {
    // Repetition is where the ratio comes from, so the fixture repeats to
    // measure anything real.
    const many = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({
        native_id: String(400000 + i),
        source: "met",
        title: "Study of a Figure",
        medium: "Albumen silver print from glass negative",
        review_status: "ok",
        category: "Photography",
      })),
    );
    const before = Buffer.from(many, "utf-8").toString("base64").length;
    const after = encodeBackupBody(many).length;
    expect(after).toBeLessThan(before / 5);
  });

  it("decodes what gzip+base64 produced by hand", () => {
    // Guards against the encoder and decoder agreeing on something that
    // isn't actually gzip.
    const byHand = zlib
      .gzipSync(Buffer.from(SAMPLE, "utf-8"))
      .toString("base64");
    expect(decodeBackupBody(byHand)).toBe(SAMPLE);
  });
});

describe("filenames", () => {
  it("dated and latest both carry .json.gz", () => {
    expect(backupFilename("2026-08-21")).toBe("2026-08-21.json.gz");
    expect(backupFilename(null)).toBe("latest.json.gz");
  });

  it("prune recognises both the new and the OLD dated names", () => {
    // Backups written before gzip was added are still .json and must
    // still be pruned, or they accumulate forever.
    expect(isDatedBackupName("2026-08-21.json.gz")).toBe(true);
    expect(isDatedBackupName("2026-08-21.json")).toBe(true);
  });

  it("never prunes latest, in either format", () => {
    expect(isDatedBackupName("latest.json.gz")).toBe(false);
    expect(isDatedBackupName("latest.json")).toBe(false);
  });

  it("ignores anything that is not a backup", () => {
    for (const n of ["README.md", "2026-08.json", "notes.json.gz", ""]) {
      expect(isDatedBackupName(n)).toBe(false);
    }
  });
});
