// The nightly backup's SELECT * once failed at 34,697 rows with "response is
// too large (max is 67108864 bytes)" -- a cap specific to Neon's HTTP query
// mode. The WebSocket Pool/Client mode speaks the real Postgres wire
// protocol and has no such cap, so fetchAllRows() moves just this SELECT
// onto Pool; everything else in db-backup.js stays on the HTTP client.
//
// Real Pool/Client objects need a live Postgres connection this suite
// doesn't have, so the constructor is injected as a fake honouring the real
// contract (connect() -> client with query()/release(), pool.end()).
import { describe, expect, it } from "vitest";
import { fetchAllRows } from "../lib/cron/db-backup.ts";

function fakePool(rows: any, opts?: any) {
  const options = opts || {};
  let released = false;
  let ended = false;
  const queries: any[] = [];

  const client = {
    query: async (sql: any) => {
      queries.push(sql);
      if (options.queryFails) throw new Error("connection reset");
      return { rows: rows };
    },
    release: () => {
      released = true;
    },
  };

  function FakePool(this: any, config: any) {
    this.connectionString = config.connectionString;
  }
  FakePool.prototype.connect = async () => {
    if (options.connectFails) throw new Error("could not connect");
    return client;
  };
  FakePool.prototype.end = async () => {
    ended = true;
  };

  return {
    FakePool,
    queries,
    wasReleased: () => released,
    wasEnded: () => ended,
  };
}

describe("fetchAllRows", () => {
  it("runs the backup SELECT once and returns its rows", async () => {
    const sample = [
      { id: "met:1", native_id: "1" },
      { id: "met:2", native_id: "2" },
    ];
    const { FakePool, queries, wasReleased, wasEnded } = fakePool(sample);

    const rows = await fetchAllRows({ PoolCtor: FakePool });

    expect(rows).toEqual(sample);
    expect(queries.length).toBe(1);
    expect(queries[0]).toMatch(/FROM items/);
    // Single SELECT is already its own consistent snapshot -- nothing to
    // wrap in an explicit transaction.
    expect(queries[0]).not.toMatch(/BEGIN|COMMIT/i);
    expect(wasReleased()).toBe(true);
    expect(wasEnded()).toBe(true);
  });

  it("still releases the client and ends the pool when the query throws", async () => {
    const { FakePool, wasReleased, wasEnded } = fakePool([], {
      queryFails: true,
    });

    await expect(fetchAllRows({ PoolCtor: FakePool })).rejects.toThrow(
      "connection reset",
    );
    expect(wasReleased()).toBe(true);
    expect(wasEnded()).toBe(true);
  });

  it("still ends the pool when connect() itself throws", async () => {
    const { FakePool, wasEnded } = fakePool([], { connectFails: true });

    await expect(fetchAllRows({ PoolCtor: FakePool })).rejects.toThrow(
      "could not connect",
    );
    expect(wasEnded()).toBe(true);
  });
});
