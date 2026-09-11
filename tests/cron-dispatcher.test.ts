// The cron jobs dispatch through one Vercel function (api/cron/index.ts, on
// ?job=) to stay under Hobby's 12-function cap; each job's own logic lives
// in lib/cron/, which only Vercel functions under api/ can route to
// directly. This file tests only the dispatch contract -- right job called,
// unknown job rejected -- not each job's own behavior.
//
// `opts.jobs` is injected so this never touches the real handlers.
import { describe, expect, it, vi } from "vitest";

const dispatcherModule = await import("../api/cron/index.ts");
const dispatcher = dispatcherModule.default;

function fakeRes(): any {
  return {
    statusCode: null,
    body: null,
    json(payload: any) {
      this.body = payload;
    },
  };
}

describe("api/cron/index.js dispatcher", () => {
  it("calls the handler named by ?job, passing req and res through unchanged", async () => {
    const dbBackup = vi.fn(async (_req, res) => {
      res.statusCode = 200;
      res.json({ ok: true });
    });
    const req = { query: { job: "db-backup" }, headers: {} };
    const res = fakeRes();

    await dispatcher(req, res, { jobs: { "db-backup": dbBackup } });

    expect(dbBackup).toHaveBeenCalledTimes(1);
    expect(dbBackup).toHaveBeenCalledWith(req, res);
    expect(res.statusCode).toBe(200);
  });

  it("rejects a missing ?job without calling any handler", async () => {
    const spy = vi.fn();
    const req = { query: {}, headers: {} };
    const res = fakeRes();

    await dispatcher(req, res, { jobs: { "db-backup": spy } });

    expect(spy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unrecognised ?job without calling any handler", async () => {
    const spy = vi.fn();
    const req = { query: { job: "delete-everything" }, headers: {} };
    const res = fakeRes();

    await dispatcher(req, res, { jobs: { "db-backup": spy } });

    expect(spy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.known).toContain("db-backup");
  });

  it("exposes the real job map, wired to lib/cron/*.js, for Vercel's own invocation", () => {
    // Not calling these (they'd hit real Postgres/Sentry/Linear) -- just
    // confirming they're wired up, since an import-path typo would silently
    // 400 every real cron invocation.
    expect(Object.keys(dispatcherModule.REAL_JOBS).sort()).toEqual([
      "analytics-report",
      "db-backup",
      "health-check",
      "vercel-deployment-cleanup",
      "warm-image-cache",
    ]);
    for (const fn of Object.values(dispatcherModule.REAL_JOBS)) {
      expect(typeof fn).toBe("function");
    }
  });
});
