// Shared render for every "the real page can't load" state -- the static
// 404 (src/pages/404.ts) and the in-app fallback app.ts swaps in when
// startup's initial Promise.all() rejects (Neon/API down, not just a
// missing route). One template, so a visitor sees the same branded
// treatment -- rotating art, same attribution style as the detail modal
// -- whichever way they hit trouble, and a future third failure mode
// reuses this instead of growing its own markup.
import { licenseLabel } from "./app/licenseLabels";
import { sourceLinkLabel, sourceLinkPreposition } from "./app/sourceLinks";
import { pickRandomErrorArt } from "./data/errorArt";

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface ErrorStateOptions {
  // Short, specific technical detail -- e.g. "404 — Page not found" or
  // "api/items facets responded with 500" -- never a raw stack trace.
  detail: string;
  // Shown only for the in-app fallback, which has something to retry;
  // the static 404 page has no retry action, just "Back to Tranquilo".
  onRetry?: () => void;
}

// Returns a detached element (not innerHTML) so callers can attach the
// retry handler without an id-based document.getElementById round trip.
export function renderErrorState(opts: ErrorStateOptions): HTMLElement {
  const art = pickRandomErrorArt();
  const { label: licenseText, deed } = licenseLabel(art.license);
  const sourceLabel = sourceLinkLabel(art);
  const preposition = sourceLinkPreposition(art);

  const el = document.createElement("div");
  el.className = "error-state";
  el.innerHTML =
    `<div class="error-frame"><img src="${escapeHtml(art.img)}" alt="${escapeHtml(art.title)}" width="600" height="600"></div>` +
    `<p class="error-heading">We&rsquo;re having a problem right now, but we&rsquo;ll be back soon.</p>` +
    `<p class="error-detail">${escapeHtml(opts.detail)}</p>` +
    `<div class="error-art-caption">` +
    `<h2 class="art-title">${escapeHtml(art.title)}</h2>` +
    `<p class="art-meta"><span class="artist">${escapeHtml(art.artist)}</span><span class="sep">&middot;</span>${escapeHtml(art.date)}</p>` +
    `<div class="d-body">` +
    `<div class="meta-row"><span class="meta-label">Material</span> ${escapeHtml(art.medium)}</div>` +
    `<div class="meta-row"><span class="meta-label">Provenance</span> ${escapeHtml(art.credit)}</div>` +
    (licenseText
      ? `<div class="meta-row"><span class="meta-label">License</span> ${
          deed
            ? `<a class="meta-license-link" href="${escapeHtml(deed)}" target="_blank" rel="noopener license">${escapeHtml(licenseText)}</a>`
            : escapeHtml(licenseText)
        }</div>`
      : "") +
    `<div style="margin-top:14px;"><a class="source-link" href="${escapeHtml(art.url)}" target="_blank" rel="noopener"><span class="link-text">View ${escapeHtml(preposition)} ${escapeHtml(sourceLabel)}</span><span class="link-arrow" aria-hidden="true">&rarr;</span></a></div>` +
    `</div>` +
    `</div>` +
    (opts.onRetry
      ? `<button type="button" class="btn-primary error-retry-btn">Try again</button>`
      : `<a class="btn-primary error-home-link" href="/">Back to Tranquilo</a>`);

  if (opts.onRetry) {
    const retryBtn = el.querySelector(".error-retry-btn") as HTMLButtonElement;
    retryBtn.addEventListener("click", opts.onRetry);
  }

  return el;
}
