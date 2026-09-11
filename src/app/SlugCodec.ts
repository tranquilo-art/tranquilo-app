// Encodes/decodes the {source}-{native_id} slug used in share links
// (/v/{slug}) and the historical /index.html#{slug} hash form (see
// api/v/[slug].js, which resolves the same format server-side).
//
// Escapes only "%", "/", "#", "?" and whitespace -- the characters that
// would actually corrupt a URL path segment -- rather than blanket-escaping
// with encodeURIComponent()/encodeURI(): Europeana ids contain a literal
// "/", and non-ASCII Commons filenames percent-encode long enough under
// either function to hit "URL too long" in at least one real client.
// Commons' "File:" prefix and Europeana's internal "/" are normalized
// before this step.
//
// Only the id half goes through this; the raw unencoded identity
// (source-nativeId) is a separate contract owned by slideBuilder.ts's
// slugFor(), which this class never re-derives.
export class SlugCodec {
  encodeId(source: string, rawId: string): string {
    let idPart = rawId;
    let m: RegExpExecArray | null;
    if (source === "commons" && idPart.slice(0, 5) === "File:") {
      idPart = idPart.slice(5);
    } else if (source === "europeana") {
      m = /^\/([0-9]+)\/(.+)$/.exec(idPart);
      if (m) idPart = `${m[1]}-${m[2]}`;
    }
    return idPart.replace(/[%/#?\s]/g, encodeURIComponent);
  }

  // The reverse of encodeId(). Also accepts an old-style link unchanged:
  // an old id was encoded whole, so decoding hands back "File:..." or a
  // leading "/" already intact, and the guards below detect and skip the transform.
  decodeId(source: string, idPart: string): string {
    let rawId = decodeURIComponent(idPart);
    let m: RegExpExecArray | null;
    if (source === "commons") {
      if (rawId.slice(0, 5) !== "File:") rawId = `File:${rawId}`;
    } else if (source === "europeana" && rawId.charAt(0) !== "/") {
      m = /^([0-9]+)-(.+)$/.exec(rawId);
      if (m) rawId = `/${m[1]}/${m[2]}`;
    }
    return rawId;
  }

  // Rebuilds the raw "{source}-{native_id}" form slideBuilder.ts's slugFor()
  // produces, since resolveSlug() in TranquiloFeed.ts splits on the first
  // hyphen and needs the untransformed native_id before that split.
  decodeSlug(part: string): string {
    const cut = part.indexOf("-");
    if (cut === -1) return decodeURIComponent(part);
    const source = part.slice(0, cut);
    const idPart = part.slice(cut + 1);
    return `${source}-${this.decodeId(source, idPart)}`;
  }

  // Accepts either /v/{slug} (the current URL form) or the historical
  // /index.html#{slug} hash, still honoured since old shared links persist.
  slugFromLocation(): string {
    const fromPath = location.pathname.match(/^\/v\/(.+)$/);
    if (fromPath) {
      return this.decodeSlug(fromPath[1]);
    }
    return this.decodeSlug(location.hash.replace(/^#/, ""));
  }

  // Separate from slugFromLocation() -- a different question (which
  // storyline vs. which artwork) with no hash-form equivalent.
  storylineIdFromLocation(): string {
    const m = location.pathname.match(/^\/s\/([^/]+)\/?$/);
    return m ? decodeURIComponent(m[1]) : "";
  }
}
