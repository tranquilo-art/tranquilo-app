/* Who we are when the IMAGE PROXY talks to a source institution -- the JS
 * half of the ingestion pipeline's source_identity.py. The proxy used to
 * fetch with no headers at all, and bvpb.mcu.es 429'd a single lightbox
 * request over it (2026-08-15) -- an unidentified request is one an
 * operator can only throttle or block, the same class of problem behind the
 * Wikimedia rate-limit hold.
 *
 * Values below are duplicated by hand from source_identity.py, since the
 * two runtimes can't share a module; a test asserts them against a
 * last-known-synced snapshot so drift is loud rather than silent.
 */

const PRODUCT = "Tranquilo";
const VERSION = "1.0";
const CONTACT_URL = "https://tranquilo.art";
const CONTACT_EMAIL = "hello@tranquilo.art";

// Shaped to Wikimedia's required format even where no source demands it,
// since meeting the strictest published policy everywhere costs nothing.
const USER_AGENT = `${PRODUCT}/${VERSION} (+${CONTACT_URL}; ${CONTACT_EMAIL}) node-fetch/1`;

// Wikimedia asks for the tool's purpose alongside the contact. Unused while
// the rate-limit hold stands; present so lifting the hold won't also
// require remembering this.
const WIKIMEDIA_USER_AGENT =
  `${PRODUCT}/${VERSION} (+${CONTACT_URL}; ${CONTACT_EMAIL}; ` +
  "art catalogue, CC0/CC-BY ingestion only) node-fetch/1";

/* Headers for fetching an image from an origin.
 *
 * Accept is sent as well as User-Agent: some institutional WAFs treat a
 * request with no Accept as a scraper, and we genuinely do only want images.
 */
function imageFetchHeaders(source?: string): Record<string, string> {
  return {
    "User-Agent": source === "commons" ? WIKIMEDIA_USER_AGENT : USER_AGENT,
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
}

export {
  CONTACT_EMAIL,
  CONTACT_URL,
  imageFetchHeaders,
  PRODUCT,
  USER_AGENT,
  VERSION,
  WIKIMEDIA_USER_AGENT,
};
