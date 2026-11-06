// Reading and writing objects in S3. Plain fetch + SigV4, no SDK -- this
// codebase's stated convention, avoiding a large dependency in the single
// hottest function in the project for one signed request.
//
// Generic over `config`; db-backup uses it with its own bucket and credentials.
//
// Path-style addressing, not virtual-hosted: the bucket name
// `cdn.prod.tranquilo.art` contains dots, so the virtual-hosted host
// (cdn.prod.tranquilo.art.s3.us-east-1.amazonaws.com) has more labels than
// AWS's wildcard cert (*.s3.us-east-1.amazonaws.com) can match -- confirmed
// live, TLS fails with "no alternative certificate subject name matches".
// Path-style keeps the host at plain s3.<region>.amazonaws.com, which
// verifies. The bucket itself has been rotated at least once (same dotted-
// name requirement each time) -- this reasoning outlives any one bucket
// name, so don't treat the literal name here as a config source of truth.

import crypto from "node:crypto";

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

interface S3Credentials {
  bucket: string;
  region: string;
  accessKeyId: string;
  secret(): string;
}

interface SignRequestOptions {
  method: string;
  host: string;
  canonicalUri: string;
  canonicalQueryString?: string;
  payloadHash: string;
  contentType?: string;
  amzDate: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

interface SignedRequest {
  signedHeaders: string;
  signature: string;
  authorization: string;
}

interface S3FetchResponse {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  arrayBuffer?(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

interface S3FetchOptions {
  now?: Date;
  fetch?: (url: string, init: RequestInit) => Promise<S3FetchResponse>;
}

interface PutResult {
  ok: boolean;
  status: number;
  etag?: string | null;
  error?: string;
}

interface GetResult {
  ok: boolean;
  status: number;
  body?: Buffer;
  contentType?: string | null;
  error?: string;
}

interface DeleteResult {
  ok: boolean;
  status: number;
  error?: string;
}

interface ListResult {
  ok: boolean;
  status: number;
  keys?: string[];
  error?: string;
}

function errorMessage(err: unknown): string {
  return String((err instanceof Error && err.message) || err);
}

function sha256hex(buf: string | NodeJS.ArrayBufferView): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function hmac(
  key: string | NodeJS.ArrayBufferView,
  data: string | NodeJS.ArrayBufferView,
): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

// Each path segment is encoded but the "/" separators are not, matching S3's
// own canonicalisation.
function canonicalUriFor(bucket: string, key: string): string {
  return `/${bucket}/${String(key).split("/").map(encodeURIComponent).join("/")}`;
}

// Bucket-root requests (list) address the bucket itself, not a key under it.
function canonicalUriForBucket(bucket: string): string {
  return `/${bucket}`;
}

// SigV4 requires params sorted by name, each name and value percent-encoded
// per RFC 3986 -- encodeURIComponent already matches that for the characters
// S3 param names/values here can contain.
function canonicalQueryStringFor(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
}

// Exported for testing: the signature has to be reproducible from fixed inputs,
// or there is no way to tell a correct implementation from one that merely
// happens to be accepted today.
function signRequest(opts: SignRequestOptions): SignedRequest {
  const method = opts.method;
  const host = opts.host;
  const canonicalUri = opts.canonicalUri;
  const canonicalQueryString = opts.canonicalQueryString || "";
  const payloadHash = opts.payloadHash;
  const contentType = opts.contentType;
  const amzDate = opts.amzDate; // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const region = opts.region;

  // content-type is signed only when actually sent (PUT) -- a signed header
  // that is absent, or an unsigned header that is present, is a mismatch.
  const canonicalHeaders =
    `${contentType ? `content-type:${contentType}\n` : ""}host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = `${contentType ? "content-type;" : ""}host;x-amz-content-sha256;x-amz-date`;

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    sha256hex(Buffer.from(canonicalRequest)),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, dateStamp), region), SERVICE),
    "aws4_request",
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  return {
    signedHeaders: signedHeaders,
    signature: signature,
    authorization: `${ALGORITHM} Credential=${opts.accessKeyId}/${
      scope
    }, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function amzDateNow(now?: Date): string {
  return (now || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

// PUT one object. Never throws -- an exception on the hot path would turn a
// degraded cache into a failed request; the caller falls back to Blob/origin.
async function putObject(
  config: S3Credentials,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string,
  opts?: S3FetchOptions,
): Promise<PutResult> {
  const options = opts || {};
  const host = `s3.${config.region}.amazonaws.com`;
  const canonicalUri = canonicalUriFor(config.bucket, key);
  const payloadHash = sha256hex(body);
  const amzDate = amzDateNow(options.now);

  const signed = signRequest({
    method: "PUT",
    host: host,
    canonicalUri: canonicalUri,
    payloadHash: payloadHash,
    contentType: contentType,
    amzDate: amzDate,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secret(),
  });

  try {
    const res = await (options.fetch || fetch)(
      `https://${host}${canonicalUri}`,
      {
        method: "PUT",
        headers: {
          "content-type": contentType,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          authorization: signed.authorization,
        },
        body: body as BodyInit,
      },
    );
    return {
      ok: res.ok,
      status: res.status,
      etag: res.headers?.get("etag") ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: errorMessage(err),
    };
  }
}

// GET one object. Same non-throwing convention as putObject. No body means
// no content-type to sign; the payload hash is just the hash of an empty
// buffer, same as AWS's own GET/DELETE examples.
async function getObject(
  config: S3Credentials,
  key: string,
  opts?: S3FetchOptions,
): Promise<GetResult> {
  const options = opts || {};
  const host = `s3.${config.region}.amazonaws.com`;
  const canonicalUri = canonicalUriFor(config.bucket, key);
  const payloadHash = sha256hex(Buffer.alloc(0));
  const amzDate = amzDateNow(options.now);

  const signed = signRequest({
    method: "GET",
    host: host,
    canonicalUri: canonicalUri,
    payloadHash: payloadHash,
    amzDate: amzDate,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secret(),
  });

  try {
    const res = await (options.fetch || fetch)(
      `https://${host}${canonicalUri}`,
      {
        method: "GET",
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          authorization: signed.authorization,
        },
      },
    );
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    return {
      ok: true,
      status: res.status,
      body: Buffer.from(await (res.arrayBuffer?.() ?? new ArrayBuffer(0))),
      contentType: res.headers?.get("content-type") ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: errorMessage(err),
    };
  }
}

// S3 answers 204 whether or not the key existed.
async function deleteObject(
  config: S3Credentials,
  key: string,
  opts?: S3FetchOptions,
): Promise<DeleteResult> {
  const options = opts || {};
  const host = `s3.${config.region}.amazonaws.com`;
  const canonicalUri = canonicalUriFor(config.bucket, key);
  const payloadHash = sha256hex(Buffer.alloc(0));
  const amzDate = amzDateNow(options.now);

  const signed = signRequest({
    method: "DELETE",
    host: host,
    canonicalUri: canonicalUri,
    payloadHash: payloadHash,
    amzDate: amzDate,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secret(),
  });

  try {
    const res = await (options.fetch || fetch)(
      `https://${host}${canonicalUri}`,
      {
        method: "DELETE",
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          authorization: signed.authorization,
        },
      },
    );
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: errorMessage(err) };
  }
}

// Flat <Contents><Key> scan; avoids an XML parser dependency.
function parseListKeys(xml: string): string[] {
  const re = /<Contents>[\s\S]*?<Key>([^<]*)<\/Key>[\s\S]*?<\/Contents>/g;
  const matches = xml.matchAll(re);
  return Array.from(matches, (m) =>
    m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
}

// First page only (up to 1000 keys); no continuation-token handling.
async function listObjects(
  config: S3Credentials,
  prefix: string,
  opts?: S3FetchOptions,
): Promise<ListResult> {
  const options = opts || {};
  const host = `s3.${config.region}.amazonaws.com`;
  const canonicalUri = canonicalUriForBucket(config.bucket);
  const query = { "list-type": "2", prefix: String(prefix || "") };
  const canonicalQueryString = canonicalQueryStringFor(query);
  const payloadHash = sha256hex(Buffer.alloc(0));
  const amzDate = amzDateNow(options.now);

  const signed = signRequest({
    method: "GET",
    host: host,
    canonicalUri: canonicalUri,
    canonicalQueryString: canonicalQueryString,
    payloadHash: payloadHash,
    amzDate: amzDate,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secret(),
  });

  try {
    const res = await (options.fetch || fetch)(
      `https://${host}${canonicalUri}?${canonicalQueryString}`,
      {
        method: "GET",
        headers: {
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          authorization: signed.authorization,
        },
      },
    );
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const xml = (await res.text?.()) ?? "";
    return { ok: true, status: res.status, keys: parseListKeys(xml) };
  } catch (err) {
    return { ok: false, status: 0, error: errorMessage(err) };
  }
}

export type { S3Credentials };
export {
  amzDateNow,
  canonicalUriFor,
  deleteObject,
  getObject,
  listObjects,
  parseListKeys,
  putObject,
  signRequest,
};
