import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientIp } from "../lib/client-ip.ts";

const saved = { ...process.env };

function asAws() {
  delete process.env.VERCEL;
  process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
}

function asVercel() {
  process.env.VERCEL = "1";
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
}

beforeEach(() => {
  delete process.env.VERCEL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
});

afterEach(() => {
  process.env = { ...saved };
});

describe("clientIp on AWS", () => {
  beforeEach(asAws);

  it("prefers CloudFront-Viewer-Address over a spoofed x-forwarded-for", () => {
    expect(
      clientIp({
        headers: {
          "cloudfront-viewer-address": "198.51.100.4:41234",
          "x-forwarded-for": "1.2.3.4, 198.51.100.4",
        },
      }),
    ).toBe("198.51.100.4");
  });

  it("strips the port from an unbracketed IPv6 viewer address", () => {
    expect(
      clientIp({
        headers: { "cloudfront-viewer-address": "2001:db8::1:51234" },
      }),
    ).toBe("2001:db8:0:0::/64");
  });

  it("strips the port from a bracketed IPv6 viewer address", () => {
    expect(
      clientIp({
        headers: { "cloudfront-viewer-address": "[2001:db8::1]:51234" },
      }),
    ).toBe("2001:db8:0:0::/64");
  });

  it("maps an IPv4-mapped IPv6 viewer address to IPv4", () => {
    expect(
      clientIp({
        headers: { "cloudfront-viewer-address": "::ffff:1.2.3.4:443" },
      }),
    ).toBe("1.2.3.4");
  });

  it("groups one /64 into a single key and keeps other /64s apart", () => {
    const key = (addr: string) =>
      clientIp({ headers: { "cloudfront-viewer-address": addr } });
    expect(key("2001:db8:1:2:aaaa::1:40000")).toBe(
      key(
        "2001:db8:1:2:bbbb:cccc:dddd:1:40001".replace(":1:40001", ":9:40001"),
      ),
    );
    expect(key("2001:db8:1:3::1:40000")).not.toBe(key("2001:db8:1:2::1:40000"));
  });

  it("falls through to the next source on garbage", () => {
    expect(
      clientIp({
        headers: {
          "cloudfront-viewer-address": "not-an-ip:80",
          "x-forwarded-for": "1.2.3.4, 203.0.113.7",
        },
      }),
    ).toBe("203.0.113.7");
    expect(
      clientIp({
        headers: { "x-forwarded-for": "1.2.3.4, garbage" },
        socket: { remoteAddress: "10.0.0.2" },
      }),
    ).toBe("10.0.0.2");
  });

  it("uses the last x-forwarded-for hop and ignores a spoofed first hop", () => {
    const a = clientIp({
      headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
    });
    const b = clientIp({
      headers: { "x-forwarded-for": "8.8.8.8, 203.0.113.7" },
    });
    expect(a).toBe("203.0.113.7");
    expect(b).toBe(a);
  });

  it("handles a header array, whitespace and empty hops", () => {
    expect(
      clientIp({ headers: { "x-forwarded-for": ["1.2.3.4", "203.0.113.7"] } }),
    ).toBe("203.0.113.7");
    expect(
      clientIp({ headers: { "x-forwarded-for": "1.2.3.4,  203.0.113.7 , " } }),
    ).toBe("203.0.113.7");
  });

  it("falls back to the socket address, ignores x-real-ip, and returns null when empty", () => {
    expect(
      clientIp({ headers: {}, socket: { remoteAddress: "10.0.0.2" } }),
    ).toBe("10.0.0.2");
    expect(clientIp({ headers: { "x-real-ip": "203.0.113.9" } })).toBe(null);
    expect(clientIp({})).toBe(null);
    expect(clientIp(null)).toBe(null);
  });
});

describe("clientIp on Vercel", () => {
  beforeEach(asVercel);

  it("ignores a viewer-supplied CloudFront-Viewer-Address", () => {
    expect(
      clientIp({
        headers: {
          "cloudfront-viewer-address": "6.6.6.6:1",
          "x-real-ip": "203.0.113.7",
        },
      }),
    ).toBe("203.0.113.7");
  });

  it("prefers x-vercel-forwarded-for, then x-real-ip", () => {
    expect(
      clientIp({
        headers: {
          "x-vercel-forwarded-for": "203.0.113.8",
          "x-real-ip": "203.0.113.7",
        },
      }),
    ).toBe("203.0.113.8");
    expect(clientIp({ headers: { "x-real-ip": "203.0.113.7" } })).toBe(
      "203.0.113.7",
    );
  });

  it("returns null when only the CloudFront header is present", () => {
    expect(
      clientIp({ headers: { "cloudfront-viewer-address": "6.6.6.6:1" } }),
    ).toBe(null);
  });
});

describe("clientIp outside AWS and Vercel", () => {
  it("does not trust the CloudFront header", () => {
    expect(
      clientIp({
        headers: {
          "cloudfront-viewer-address": "6.6.6.6:1",
          "x-forwarded-for": "203.0.113.7",
        },
      }),
    ).toBe("203.0.113.7");
  });
});
