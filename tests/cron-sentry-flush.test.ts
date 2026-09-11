// The success path of a cron must flush Sentry before it returns. db-backup
// falsely reported timeouts three times: the SDK sends asynchronously, and a
// serverless function that returns immediately freezes before the transport
// runs, so Sentry only ever saw the in_progress check-in. The failure path
// already awaited a flush; the success path didn't.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The jobs live in lib/cron/, dispatched by one Vercel function
// (api/cron/index.ts, on ?job=) to stay under Hobby's 12-function cap.
const CRON = path.join(__dirname, "../lib/cron");
const crons = readdirSync(CRON).filter((f) => f.endsWith(".ts"));

describe("cron check-ins actually reach Sentry", () => {
  for (const f of crons) {
    const src = readFileSync(path.join(CRON, f), "utf8");
    const usesCheckIn = /captureCheckIn/.test(src);

    it(`${f} ${usesCheckIn ? "flushes before returning" : "uses no check-ins"}`, () => {
      if (!usesCheckIn) {
        expect(usesCheckIn).toBe(false); // documents which crons are monitored
        return;
      }
      // Every "ok" check-in must have a flush to carry it, not just "a flush
      // exists somewhere" -- that passed while a second success path
      // (health-check has two exits) silently lost its check-in. Two shapes
      // count: literal `status: "ok"` and the `checkIn("ok")` helper.
      const oks = (
        src.match(/status:\s*["']ok["']|checkIn\(["']ok["']\)/g) || []
      ).length;
      const flushes = (src.match(/await\s+Sentry\.flush\(/g) || []).length;
      expect(oks, `${f} sends no "ok" check-in`).toBeGreaterThan(0);
      expect(
        flushes,
        `${f} has ${oks} success check-in(s) but only ${flushes} ` +
          'flush(es) -- an unflushed "ok" is lost and the monitor reports a ' +
          "false timeout",
      ).toBeGreaterThanOrEqual(oks);
    });
  }

  // Every scheduled job must check in, not just flush if it happens to --
  // matters most for health-check.js, which IS the monitoring: if it
  // silently stops firing, nothing else would notice.
  for (const f of crons) {
    it(`${f} registers a Sentry cron monitor`, () => {
      const src = readFileSync(path.join(CRON, f), "utf8");
      expect(
        src,
        `${f} runs on a schedule but checks in nowhere -- if it stops ` +
          "firing, nothing will say so",
      ).toMatch(/captureCheckIn/);
    });

    it(`${f} declares a monitor config, so a missed run is detectable`, () => {
      // Without schedule + checkinMargin, Sentry cannot tell "late" from
      // "never ran". checkinMargin matters especially on Hobby, whose cron
      // firing time is documented as imprecise within the hour.
      const src = readFileSync(path.join(CRON, f), "utf8");
      expect(src).toMatch(/schedule:\s*\{\s*type:\s*["']crontab["']/);
      expect(src).toMatch(/checkinMargin:/);
      expect(src).toMatch(/maxRuntime:/);
    });
  }

  // The flush has to happen BEFORE the response goes out, not merely exist.
  // health-check once flushed after res.json() -- once the response is sent
  // the platform can freeze the instance, so the flush only completed when
  // it happened to stay warm, a race the counting check above can't see
  // since the counts are identical either way.
  for (const f of crons) {
    const src = readFileSync(path.join(CRON, f), "utf8");
    if (!/captureCheckIn/.test(src)) continue;

    it(`${f} flushes before it sends the response, not after`, () => {
      const okCheckIn = /status:\s*["']ok["']|checkIn\(["']ok["']\)/g;
      const problems = [];
      for (let m = okCheckIn.exec(src); m !== null; m = okCheckIn.exec(src)) {
        const rest = src.slice(m.index);
        const flushAt = rest.search(/await\s+Sentry\.flush\(/);
        const respondAt = rest.search(/res\.(?:json|end)\(/);
        if (respondAt === -1) continue; // no response on this path
        if (flushAt === -1 || flushAt > respondAt) {
          problems.push(`line ${src.slice(0, m.index).split("\n").length}`);
        }
      }
      expect(
        problems,
        `${f}: an "ok" check-in at ${problems.join(", ")} is ` +
          "flushed after the response is sent. Nothing is guaranteed to run " +
          "once the platform has the response, so the check-in is lost and the " +
          "monitor reports a false timeout on a job that succeeded.",
      ).toEqual([]);
    });
  }

  it("db-backup only messages Sentry when the run was SLOW", () => {
    // It used to captureMessage on every success -- would become a daily
    // issue people scroll past once the flush actually lands.
    const src = readFileSync(path.join(CRON, "db-backup.ts"), "utf8");
    const msg = src.match(/Sentry\.captureMessage\([^;]*;/s);
    expect(msg, "no captureMessage found").toBeTruthy();
    expect(msg?.[0]).not.toMatch(/level:\s*elapsed/);
    expect(src).toMatch(/if \(elapsed > [^)]*\) \{\s*Sentry\.captureMessage/);
  });
});

describe("the quarterly restore drill has a reminder attached", () => {
  // The runbook commits to a quarterly drill; rides the analytics report
  // rather than a new cron since api/ is at Vercel Hobby's 12-function cap.
  const src = readFileSync(path.join(CRON, "analytics-report.ts"), "utf8");

  it("appears on the Quarterly run", () => {
    expect(src).toMatch(/label === "Quarterly"/);
    expect(src).toMatch(/restore drill/i);
  });

  it("does NOT appear on the Monthly run, which would make it wallpaper", () => {
    const block = src.match(/if \(label === "Quarterly"\) \{[\s\S]*?\n {2}\}/);
    expect(
      block,
      "the drill block should be conditional, not unconditional",
    ).toBeTruthy();
  });

  it("tells the reader what to actually do, not just that it is due", () => {
    expect(src).toMatch(/restore_from_backup\.py/);
    expect(src).toMatch(/Neon branch/);
  });
});
