// Loose "local@domain.tld" shape check, not full RFC 5322 -- good enough to
// catch a typo'd form field, not meant to guarantee deliverability.
//
// Deliberately NOT a single regex. The previous version,
// /^[^\s@]+@[^\s@]+\.[^\s@]+$/, let both [^\s@]+ groups absorb "." (it's not
// excluded from the class), so the engine could split a run of "."s between
// the first group and the literal \. in exponentially many ways before
// failing on a trailing character that doesn't match -- a polynomial ReDoS
// on user-controlled input (CodeQL js/polynomial-redos, api/subscribe.ts
// and api/submit-collection.ts both carried a copy). Plain string ops have
// no backtracking to exploit.
export function isValidEmail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!local || !domain) return false;
  if (/\s/.test(local) || /\s/.test(domain)) return false;

  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}
