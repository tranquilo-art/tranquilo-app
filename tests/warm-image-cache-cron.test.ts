// The Vercel Cron entry point for the catch-up sweep. Not the loop itself
// (that's warmBatch(), covered in warm-image-cache.test.ts) -- just this
// file's own job: auth, param parsing, and wiring the result into a
// response. warmBatch() and getSql() are mocked throughout, so nothing
// here touches Postgres, S3, or a museum.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../scripts/warm_image_cache.mts", () => ({
  warmBatch: vi.fn(),
  sourcesToWarm: vi.fn(() => ["met", "cleveland"]),
}));
vi.mock("../lib/db.ts", () => ({
  getSql: vi.fn(),
}));
// The handler imports these for warmBatch()'s `deps`, never actually
// called since warmBatch itself is mocked above.
vi.mock("../lib/img-object-key.ts", () => ({}));
vi.mock("../lib/img-store.ts", () => ({}));
vi.mock("../lib/img-s3.ts", () => ({}));
vi.mock("../lib/source-identity.ts", () => ({}));
vi.mock("../api/img/[source]/[id]/[tier].ts", () => ({}));

const { warmBatch, sourcesToWarm } = await import(
  "../scripts/warm_image_cache.mts"
);
const { getSql } = await import("../lib/db.ts");
const handlerModule = await import("../lib/cron/warm-image-cache.ts");
const handler = handlerModule.default;

function fakeReqRes(query: any = {}, authorized = true) {
  const req = {
    headers: authorized ? { authorization: "Bearer test-secret" } : {},
    query,
  };
  const res = {
    statusCode: 200,
    body: undefined as any,
    json(body: any) {
      this.body = body;
    },
  };
  return { req, res };
}

describe("warm-image-cache cron handler", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv, CRON_SECRET: "test-secret" };
    vi.mocked(getSql).mockReturnValue({} as any);
    vi.mocked(warmBatch).mockResolvedValue({
      committed: true,
      workLength: 5,
      done: 5,
      failed: 0,
      skipped: 0,
      bytesTotal: 1000,
      stoppedEarly: false,
      breakerTripped: false,
    } as any);
  });

  afterEach(() => {
    process.env = savedEnv;
    vi.clearAllMocks();
  });

  it("refuses without the right bearer token", async () => {
    const { req, res } = fakeReqRes({}, false);
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(warmBatch).not.toHaveBeenCalled();
  });

  it("refuses when CRON_SECRET itself isn't configured", async () => {
    delete process.env.CRON_SECRET;
    const { req, res } = fakeReqRes({});
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });

  it("500s when the database isn't configured, without calling warmBatch", async () => {
    vi.mocked(getSql).mockReturnValue(null as any);
    const { req, res } = fakeReqRes({});
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(warmBatch).not.toHaveBeenCalled();
  });

  it("defaults to display tier with a bounded limit", async () => {
    const { req, res } = fakeReqRes({});
    await handler(req, res);
    expect(warmBatch).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "display", limit: 50, commit: true }),
    );
    expect(res.statusCode).toBe(200);
  });

  it("honors ?tier=lightbox", async () => {
    const { req, res } = fakeReqRes({ tier: "lightbox" });
    await handler(req, res);
    expect(warmBatch).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "lightbox" }),
    );
  });

  it("ignores an unrecognised tier rather than passing it through unchecked", async () => {
    const { req, res } = fakeReqRes({ tier: "thumbnail" });
    await handler(req, res);
    expect(warmBatch).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "display" }),
    );
  });

  it("honors a ?limit= override within the bound", async () => {
    const { req, res } = fakeReqRes({ limit: "10" });
    await handler(req, res);
    expect(warmBatch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("caps an oversized ?limit= rather than letting one invocation run unbounded", async () => {
    const { req, res } = fakeReqRes({ limit: "100000" });
    await handler(req, res);
    const call = vi.mocked(warmBatch).mock.calls[0][0] as any;
    expect(call.limit).toBeLessThanOrEqual(200);
  });

  it("ignores a nonsensical ?limit= and falls back to the default", async () => {
    const { req, res } = fakeReqRes({ limit: "not-a-number" });
    await handler(req, res);
    expect(warmBatch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it("passes every non-held source, same as the CLI's own default", async () => {
    const { req, res } = fakeReqRes({});
    await handler(req, res);
    expect(sourcesToWarm).toHaveBeenCalledWith(null);
  });

  it("returns 500 and still reports partial progress when warmBatch throws mid-run", async () => {
    vi.mocked(warmBatch).mockImplementation(async (opts: any) => {
      opts.onProgress?.("warmed 3, failed 0, skipped 0, 1.2 MB in 0.4 min");
      throw new Error("S3 is not configured -- refusing to run");
    });
    const { req, res } = fakeReqRes({});
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/S3 is not configured/);
    expect(res.body.log).toContain(
      "warmed 3, failed 0, skipped 0, 1.2 MB in 0.4 min",
    );
  });

  it("reports the full result on success", async () => {
    const { req, res } = fakeReqRes({});
    await handler(req, res);
    expect(res.body).toMatchObject({ done: 5, failed: 0, workLength: 5 });
  });
});
