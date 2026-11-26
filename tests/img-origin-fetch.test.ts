import { getEventListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchFollowingRedirectsUnchecked,
  fetchOriginOnce,
  isPublicAddress,
  lookupWithin,
  type OriginResolver,
} from "../lib/img-origin-fetch.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const resolvesTo =
  (...addresses: string[]): OriginResolver =>
  async () =>
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));

describe("isPublicAddress", () => {
  it.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1",
    "100.63.255.255",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:0808:0808::1",
  ])("accepts %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::1",
    "2002:7f00:1::1",
    "2002:a9fe:a9fe::1",
    "2002:c0a8:101::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%eth0",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2001:2::1",
    "2001::1",
    "3fff::1",
    "not-an-ip",
    "",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("the DNS pre-flight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a host whose addresses are all public", async () => {
    const fetchMock = vi.fn(async () => new Response(JPEG));
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchOriginOnce(
      "https://images.metmuseum.org/a.jpg",
      "met",
      "display",
      resolvesTo("93.184.216.34", "2606:4700::1"),
    );
    expect(out.contentType).toBe("image/jpeg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["loopback", ["127.0.0.1"]],
    ["the metadata address", ["169.254.169.254"]],
    ["an RFC1918 address", ["10.0.0.5"]],
    ["a ULA address", ["fd00::1"]],
    ["a mapped private address", ["::ffff:192.168.0.1"]],
    ["one private address among public ones", ["93.184.216.34", "10.0.0.5"]],
  ])(
    "refuses a host that resolves to %s without fetching",
    async (_label, addresses) => {
      const fetchMock = vi.fn(async () => new Response(JPEG));
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        fetchOriginOnce(
          "https://images.metmuseum.org/a.jpg",
          "met",
          "display",
          resolvesTo(...addresses),
        ),
      ).rejects.toMatchObject({ refused: "dns-private" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses the Europeana any-https-host tier when the host resolves privately", async () => {
    const fetchMock = vi.fn(async () => new Response(JPEG));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchOriginOnce(
        "https://lvh.me/a.jpg",
        "europeana",
        "lightbox",
        resolvesTo("127.0.0.1"),
      ),
    ).rejects.toMatchObject({ refused: "dns-private" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the lookup throws or returns nothing", async () => {
    const fetchMock = vi.fn(async () => new Response(JPEG));
    vi.stubGlobal("fetch", fetchMock);
    const failing: OriginResolver = async () => {
      throw new Error("ENOTFOUND");
    };
    for (const resolver of [failing, resolvesTo()]) {
      await expect(
        fetchOriginOnce(
          "https://images.metmuseum.org/a.jpg",
          "met",
          "display",
          resolver,
        ),
      ).rejects.toMatchObject({ refused: "dns-failed" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves again on every hop and refuses a redirect to a private resolution", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://thumb.wikimedia.org/b.jpg" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const resolver = vi
      .fn<OriginResolver>()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    await expect(
      fetchOriginOnce(
        "https://upload.wikimedia.org/a.jpg",
        "commons",
        "display",
        resolver,
      ),
    ).rejects.toMatchObject({ refused: "dns-private" });
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the system resolver by default", async () => {
    const fetchMock = vi.fn(async () => new Response(JPEG));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchFollowingRedirectsUnchecked(
        "https://localhost/a.jpg",
        "europeana",
        "lightbox",
      ),
    ).rejects.toMatchObject({ refused: "dns-private" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an off-allowlist first hop before any lookup or fetch", async () => {
    const fetchMock = vi.fn(async () => new Response(JPEG));
    vi.stubGlobal("fetch", fetchMock);
    const resolver = vi.fn<OriginResolver>();
    for (const url of [
      "https://evil.example/a.jpg",
      "http://images.metmuseum.org/a.jpg",
      "https://127.0.0.1/a.jpg",
    ]) {
      await expect(
        fetchOriginOnce(url, "met", "display", resolver),
      ).rejects.toThrow(/refused/);
    }
    expect(resolver).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("lookup time limit", () => {
    const never: OriginResolver = () => new Promise(() => {});

    it("refuses a lookup that never answers within the cap", async () => {
      const fetchMock = vi.fn(async () => new Response(JPEG));
      vi.stubGlobal("fetch", fetchMock);
      const started = Date.now();
      await expect(
        fetchOriginOnce(
          "https://images.metmuseum.org/a.jpg",
          "met",
          "display",
          never,
          50,
        ),
      ).rejects.toMatchObject({ refused: "dns-failed" });
      expect(Date.now() - started).toBeLessThan(2000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses promptly when the overall abort fires during the lookup", async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = vi.fn(async () => new Response(JPEG));
        vi.stubGlobal("fetch", fetchMock);
        const outcome = fetchOriginOnce(
          "https://images.metmuseum.org/a.jpg",
          "met",
          "display",
          never,
          60_000,
        ).then(
          () => "resolved",
          (err) => err.refused,
        );
        await vi.advanceTimersByTimeAsync(20_000);
        expect(await outcome).toBe("dns-failed");
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("raises no unhandled rejection when a late lookup fails after the cap", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        let rejectLate: (err: Error) => void = () => {};
        const late: OriginResolver = () =>
          new Promise((_resolve, reject) => {
            rejectLate = reject;
          });
        await expect(
          fetchOriginOnce(
            "https://images.metmuseum.org/a.jpg",
            "met",
            "display",
            late,
            10,
          ),
        ).rejects.toMatchObject({ refused: "dns-failed" });
        rejectLate(new Error("ENOTFOUND"));
        await new Promise((r) => setTimeout(r, 20));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });

    const rejectsDnsFailed = (promise: Promise<unknown>) =>
      expect(promise).rejects.toMatchObject({ refused: "dns-failed" });

    it("leaves no timer or abort listener behind after a timeout", async () => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const outcome = lookupWithin(
          "host.example",
          never,
          controller.signal,
          100,
        );
        const assertion = rejectsDnsFailed(outcome);
        await vi.advanceTimersByTimeAsync(100);
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
        expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves no timer or abort listener behind after an abort", async () => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const outcome = lookupWithin(
          "host.example",
          never,
          controller.signal,
          60_000,
        );
        const assertion = rejectsDnsFailed(outcome);
        controller.abort();
        await assertion;
        expect(vi.getTimerCount()).toBe(0);
        expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("refuses and leaves nothing behind when the resolver throws synchronously", async () => {
      vi.useFakeTimers();
      try {
        const controller = new AbortController();
        const throwing: OriginResolver = () => {
          throw new Error("sync failure");
        };
        await expect(
          lookupWithin("host.example", throwing, controller.signal, 100),
        ).rejects.toThrow("sync failure");
        expect(vi.getTimerCount()).toBe(0);
        expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
        await rejectsDnsFailed(
          fetchOriginOnce(
            "https://images.metmuseum.org/a.jpg",
            "met",
            "display",
            throwing,
          ),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not call the resolver when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const resolver = vi.fn<OriginResolver>();
      await rejectsDnsFailed(
        lookupWithin("host.example", resolver, controller.signal, 100),
      );
      expect(resolver).not.toHaveBeenCalled();
    });
  });
});
