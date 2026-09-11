// Deriving a source's health from what actually happened to
// real requests, and deciding what is worth alerting about.
import { describe, expect, it } from "vitest";
import * as health from "../lib/source-health.ts";

const soon = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

describe("classifySources", () => {
  it("calls a source healthy while failures stay under the threshold", () => {
    const [s] = health.classifySources([
      { source: "met", consecutive_failures: 4 },
    ]);
    expect(s.status).toBe("healthy");
  });

  it("calls it degraded at the threshold", () => {
    const [s] = health.classifySources([
      { source: "met", consecutive_failures: 5 },
    ]);
    expect(s.status).toBe("degraded");
  });

  it("reports a standing hold as held, never as degraded", () => {
    // The hold is a decision we made; reporting it as a health problem
    // would page someone daily about their own choice.
    const [s] = health.classifySources([
      {
        source: "commons",
        hold_reason: "rate-limit hold",
        consecutive_failures: 99,
      },
    ]);
    expect(s.status).toBe("held");
  });

  it("reports an active cooldown as cooling rather than degraded", () => {
    // A source that asked us to back off is behaving correctly, and so are
    // we -- operationally different from one that's broken.
    const [s] = health.classifySources([
      { source: "commons", blocked_until: soon(), consecutive_failures: 1 },
    ]);
    expect(s.status).toBe("cooling");
  });

  it("stops treating an expired cooldown as cooling", () => {
    const [s] = health.classifySources([
      { source: "met", blocked_until: past(), consecutive_failures: 0 },
    ]);
    expect(s.status).toBe("healthy");
  });

  it("ranks a hold above a cooldown", () => {
    // The hold is the more permanent fact, the one a reader needs.
    const [s] = health.classifySources([
      {
        source: "commons",
        hold_reason: "rate-limit hold",
        blocked_until: soon(),
        consecutive_failures: 20,
      },
    ]);
    expect(s.status).toBe("held");
  });

  it("accepts an explicit clock, so the tests are not time-dependent", () => {
    const rows = [{ source: "met", blocked_until: "2026-01-01T00:00:00Z" }];
    expect(health.classifySources(rows, "2025-12-31T00:00:00Z")[0].status).toBe(
      "cooling",
    );
    expect(health.classifySources(rows, "2026-02-01T00:00:00Z")[0].status).toBe(
      "healthy",
    );
  });

  it("survives empty and missing input", () => {
    expect(health.classifySources([])).toEqual([]);
    expect(health.classifySources(undefined)).toEqual([]);
  });
});

describe("healthAlerts", () => {
  it("says nothing when everything is healthy", () => {
    expect(
      health.healthAlerts(
        health.classifySources([
          { source: "met", consecutive_failures: 0 },
          { source: "cleveland", consecutive_failures: 1 },
        ]),
      ),
    ).toEqual([]);
  });

  it("says nothing about a deliberately held source", () => {
    expect(
      health.healthAlerts(
        health.classifySources([
          {
            source: "commons",
            hold_reason: "rate-limit hold",
            consecutive_failures: 40,
          },
        ]),
      ),
    ).toEqual([]);
  });

  it("reports a degraded source with the numbers needed to act", () => {
    const [msg] = health.healthAlerts(
      health.classifySources([
        {
          source: "met",
          consecutive_failures: 8,
          last_status: 503,
          last_ok_at: null,
        },
      ]),
    );
    expect(msg).toContain("met");
    expect(msg).toContain("8 consecutive");
    expect(msg).toContain("503");
    expect(msg).toContain("never"); // no recorded success
  });

  it("distinguishes a cooldown from a breakage in the message itself", () => {
    const [msg] = health.healthAlerts(
      health.classifySources([
        { source: "commons", blocked_until: soon(), last_status: 429 },
      ]),
    );
    expect(msg).toContain("cooldown");
    expect(msg).toContain("served from the source directly");
  });

  it("reports each unhealthy source separately", () => {
    expect(
      health.healthAlerts(
        health.classifySources([
          { source: "met", consecutive_failures: 6, last_status: 500 },
          { source: "cleveland", blocked_until: soon(), last_status: 429 },
          { source: "europeana", consecutive_failures: 0 },
        ]),
      ),
    ).toHaveLength(2);
  });
});

describe("heldSourceSet -- one definition of 'are we allowed to touch this'", () => {
  const fakeSql = (result: any) => async () => {
    if (result instanceof Error) throw result;
    return result;
  };

  it("returns the held sources with their reasons", async () => {
    const held = await health.heldSourceSet(
      fakeSql([
        { source: "commons", hold_reason: "Wikimedia rate-limit hold" },
      ]),
      ["met", "commons"],
    );
    expect(held.commons).toContain("Wikimedia");
    expect(held.met).toBeUndefined();
  });

  it("FAILS CLOSED -- an unreadable holds table marks everything held", async () => {
    // Losing a latency sample costs nothing; fetching a source we promised
    // to leave alone costs a relationship.
    const held = await health.heldSourceSet(fakeSql(new Error("db down")), [
      "met",
      "cleveland",
      "commons",
    ]);
    expect(Object.keys(held).sort()).toEqual(["cleveland", "commons", "met"]);
  });

  it("fails closed with no client at all", async () => {
    const held = await health.heldSourceSet(null, ["met", "commons"]);
    expect(held.met).toBeTruthy();
    expect(held.commons).toBeTruthy();
  });

  it("returns nothing held when nothing is held", async () => {
    expect(await health.heldSourceSet(fakeSql([]), ["met"])).toEqual({});
  });
});
