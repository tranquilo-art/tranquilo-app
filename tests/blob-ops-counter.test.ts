// Count Blob operations directly, because inferring them from
// img_cache_stats undercounted: the proxy's hit response is a cached 302
// that never re-enters the function -- Vercel hit 7.6K/10K ops with days
// left in the month and we had no idea.
//
// Two design choices the tests pin down: wrap the imports rather than count
// at call sites (so a future call site can't silently skip a hand-placed
// counter), and count failures too (Vercel bills an operation either way).
import { describe, expect, it, vi } from "vitest";
import { makeCountedBlobOps } from "../lib/blob-ops.ts";

function harness(impl: any = {}) {
  const counted: any[] = [];
  const ops = makeCountedBlobOps({
    put: impl.put || (async () => ({ url: "https://blob/x" })),
    head: impl.head || (async () => ({ url: "https://blob/x" })),
    record: async (op: any) => {
      counted.push(op);
    },
  });
  return { ops, counted };
}

describe("counting", () => {
  it("counts a put", async () => {
    const { ops, counted } = harness();
    await ops.put("k", Buffer.from("x"), {});
    expect(counted).toEqual(["put"]);
  });

  it("counts a head", async () => {
    const { ops, counted } = harness();
    await ops.head("k");
    expect(counted).toEqual(["head"]);
  });

  it("counts every call, not just the first", async () => {
    const { ops, counted } = harness();
    await ops.head("a");
    await ops.head("b");
    await ops.put("c", Buffer.from("y"), {});
    expect(counted).toEqual(["head", "head", "put"]);
  });
});

describe("failures still cost an operation", () => {
  it("counts a head that throws, and rethrows it", async () => {
    const { ops, counted } = harness({
      head: async () => {
        throw new Error("boom");
      },
    });
    await expect(ops.head("k")).rejects.toThrow("boom");
    expect(counted).toEqual(["head"]);
  });

  it("counts a put that throws", async () => {
    const { ops, counted } = harness({
      put: async () => {
        throw new Error("nope");
      },
    });
    await expect(ops.put("k", Buffer.from("x"), {})).rejects.toThrow("nope");
    expect(counted).toEqual(["put"]);
  });
});

describe("the counter never breaks image serving", () => {
  it("a failing recorder does not fail the operation", async () => {
    // Serving an image matters more than counting it.
    const ops = makeCountedBlobOps({
      put: async () => ({ url: "https://blob/ok" }),
      head: async () => ({ url: "https://blob/ok" }),
      record: async () => {
        throw new Error("neon down");
      },
    });
    await expect(ops.head("k")).resolves.toEqual({ url: "https://blob/ok" });
  });

  it("passes through the underlying return value untouched", async () => {
    const { ops } = harness({ head: async () => ({ url: "u", size: 42 }) });
    expect(await ops.head("k")).toEqual({ url: "u", size: 42 });
  });

  it("forwards every argument", async () => {
    const put = vi.fn(async () => ({ url: "u" }));
    const { ops } = harness({ put });
    await ops.put("path", "body", {
      access: "public",
      contentType: "image/jpeg",
    });
    expect(put).toHaveBeenCalledWith("path", "body", {
      access: "public",
      contentType: "image/jpeg",
    });
  });
});
