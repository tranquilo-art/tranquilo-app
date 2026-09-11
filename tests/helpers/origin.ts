/* A fake origin institution, on localhost.
 *
 * The proxy's failure handling (503s, 429s with and without Retry-After,
 * odd content types) couldn't be tested at all, since the only way to
 * produce those responses was to ask a real museum for them -- not
 * something to do casually with a Wikimedia rate-limit hold outstanding,
 * and exactly the behaviour that produced the hold in the first place. So
 * instead: a real HTTP server on an ephemeral port that answers however
 * the test needs. `fetchOriginOnce` performs a genuine fetch against it,
 * exercising the whole path (headers out, status and headers back, body
 * buffered) without a single packet leaving the machine.
 *
 * It also records every request it receives, making checkable one thing
 * that wasn't before: whether we actually identify ourselves. The proxy
 * was once found calling fetch() with no headers at all, so every cache
 * miss reached an institution anonymously -- fixed by reading the code,
 * and until now only ever confirmed by reading the code.
 */
import http from "node:http";

/**
 * Starts a server whose behaviour is chosen per-request by `handler`.
 *
 * `handler(req)` returns { status, headers, body } -- or a delay, for the
 * timeout path. Returns { url(path), requests, close() }.
 */
async function startFakeOrigin(handler: (req: any) => any) {
  const requests: any[] = [];
  const server = http.createServer(async (req: any, res: any) => {
    requests.push({
      url: req.url,
      method: req.method,
      headers: Object.assign({}, req.headers),
    });
    let reply: any;
    try {
      reply = await handler(req);
    } catch (_e) {
      reply = { status: 500, body: "handler threw" };
    }
    if (reply?.delayMs) {
      await new Promise((r) => setTimeout(r, reply.delayMs));
    }
    res.writeHead(reply.status || 200, reply.headers || {});
    res.end(reply.body === undefined ? "" : reply.body);
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.address() as import("node:net").AddressInfo).port;

  return {
    // https is required by isAllowedOrigin(), but fetchOriginOnce itself does
    // not care -- it is handed a URL and fetches it. These tests drive that
    // function directly, so http on localhost is right here; the https rule is
    // enforced earlier, in the handler, and is tested separately.
    url: (path?: string) => `http://127.0.0.1:${port}${path || "/image.jpg"}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export { startFakeOrigin };
