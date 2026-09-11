/* The support strip and its Donate chooser, as a native custom element.
 * Same behavior as the original js/support.js IIFE; connectedCallback()
 * fires automatically for every instance including a freshly rebuilt
 * feed slide, so the old re-scan-for-unmounted-placeholders logic is gone.
 *
 * Renders into light DOM: every style already lives in css/style.css.
 *
 * Two backward-compat seams: `data-support-strip` is set by this
 * component so the pre-existing attribute selector in
 * tests/e2e/support-strip.spec.mts and tests/donations-flag.test.js keeps
 * matching, and `window.TranquiloSupport` still exposes the same shape
 * those tests read via page.evaluate(). Both can go once the test suite
 * targets the element directly.
 *
 * Every button here is a plain <a> to a Stripe-hosted Payment Link, no
 * fetch or serverless function, for two reasons: api/ is at Vercel
 * Hobby's 12-function cap, and Vercel's Fair Use Guidelines carve
 * donations out of "commercial usage" for linking out, but a judgement
 * call for our own Checkout Session endpoint we don't need to make.
 * Donation events in our own analytics would need the webhook, which
 * needs Vercel Pro -- a deliberate omission, not an oversight.
 */

import { on } from "../utils/on";

interface DonateTier {
  url: string;
  brl: number;
  usd: string;
}

interface DonateConfig {
  once: { url: string; note: string };
  monthly: DonateTier[];
}

/* THE ONLY THING YOU NEED TO EDIT AT LAUNCH: replace the four sandbox
 * URLs with live equivalents (`https://buy.stripe.com/`, no `test_`).
 * Stripe's "Copy to live mode" button brings prices across without a
 * rebuild, but do it once at the end -- each copy makes a separate live
 * product and later sandbox edits won't propagate.
 *
 * Amounts are BRL, the account's settlement currency: Adaptive Pricing
 * only runs when the price currency is one of them, and a USD-based
 * price would silently disable it (every donor sees dollars, Brazilian
 * donors lose Boleto -- measured on real links). The dollar figures are
 * indicative and drift with the exchange rate; re-check them whenever
 * this file is touched.
 */
/* Donations are open -- Stripe onboarding cleared. Flipping this back to
 * true is still the whole switch if donations need closing in a hurry,
 * but closing them properly also means restoring the CSS gate and the
 * two vercel.json redirects, or /pages/support.html stays reachable --
 * see tests/donations-flag.test.js, which holds those halves together.
 */
const COMING_SOON = false;

const DONATE: DonateConfig = {
  once: {
    url: "https://buy.stripe.com/8x2fZg5djcaY7iUbNY9ws02",
    // "Customer chooses price" can't be recurring, a Stripe limitation --
    // hence fixed tiers for the monthly options below.
    note: "Choose your own amount",
  },
  monthly: [
    {
      url: "https://buy.stripe.com/fZu8wO49f2Ao0UwcS29ws03",
      brl: 15,
      usd: "2.91",
    },
    {
      url: "https://buy.stripe.com/3cI4gy35b4Iw5aM19k9ws01",
      brl: 25,
      usd: "4.84",
    },
    {
      url: "https://buy.stripe.com/9B64gy9tzfna1YA19k9ws00",
      brl: 50,
      usd: "9.69",
    },
  ],
};

// Every Stripe URL this file will ever produce, for the tests to walk.
function allLinks(): string[] {
  return [DONATE.once.url, ...DONATE.monthly.map((t) => t.url)];
}

// A sandbox link on the live site looks completely normal and accepts no
// money -- the first sign would be a donor saying they paid when no
// payment exists.
function isTestLink(url: string): boolean {
  return /\/test_|sandbox/.test(String(url));
}

// Sandbox links are correct on a Vercel preview deployment, only wrong on
// the real domain, so the guard is scoped to hostname rather than banning
// them outright.
const PRODUCTION_HOSTS = ["tranquilo.art", "www.tranquilo.art"];

function isProductionHost(hostname: string): boolean {
  return PRODUCTION_HOSTS.indexOf(String(hostname || "")) !== -1;
}

// Fails loud and closed: if sandbox links ever reach the real domain the
// strip refuses to offer donation at all, rather than sending someone to
// a checkout that cheerfully takes card details and charges nothing.
function liveConfigProblem(hostname: string): string | null {
  if (!isProductionHost(hostname)) return null;
  const bad = allLinks().filter(isTestLink);
  return bad.length
    ? `${bad.length} sandbox payment link(s) on the live site`
    : null;
}

function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STRIP_LINE = "Tranquilo runs on direct support, not ads.";

function brokenStripHtml(problem: string): string {
  console.error(
    `[support] ${problem} -- donation disabled. See src/components/TranquiloSupportStrip.ts DONATE.`,
  );
  return `<p class="support-strip-line">${escapeHtml(STRIP_LINE)}</p>
<p class="support-strip-note">Donations are briefly unavailable. Thank you for wanting to &mdash; please try again shortly.</p>`;
}

function comingSoonStripHtml(): string {
  return `<p class="support-strip-line">${escapeHtml(STRIP_LINE)}</p>
<p class="support-strip-soon">Donations open soon.</p>`;
}

function stripHtml(withLine: boolean): string {
  // Ships with the Stripe button alone -- other channels get their slot
  // only when genuinely live, since a disabled button asking for money
  // is worse than no button.
  const line = withLine
    ? `<p class="support-strip-line">${escapeHtml(STRIP_LINE)}</p>`
    : "";
  return `${line}<div class="support-strip-actions">
<button type="button" class="btn btn-primary support-donate-btn" data-support-open aria-haspopup="dialog">
<span class="support-card-icon" aria-hidden="true">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<rect x="2" y="5" width="20" height="14" rx="2"></rect>
<line x1="2" y1="10" x2="22" y2="10"></line>
</svg>
</span>Donate</button>
</div>`;
}

function dialogHtml(): string {
  const tiers = DONATE.monthly
    .map(
      (t) =>
        `<a class="support-tier" href="${escapeHtml(t.url)}" target="_blank" rel="noopener"><span class="support-tier-amount">R$${t.brl}</span><span class="support-tier-sub">per month</span></a>`,
    )
    .join("");

  return `<div class="support-dialog-inner" role="document">
<button type="button" class="support-dialog-close" data-support-close aria-label="Close">&times;</button>
<h2 id="supportDialogTitle" class="support-dialog-title">Support Tranquilo</h2>
<p class="support-dialog-body">Every contribution goes to hosting and the quiet cost of keeping this running.</p>
<div class="support-group">
<h3 class="support-group-label">Give once</h3>
<a class="support-once" href="${escapeHtml(DONATE.once.url)}" target="_blank" rel="noopener">${escapeHtml(DONATE.once.note)}<span class="link-arrow" aria-hidden="true">&rarr;</span></a>
</div>
<div class="support-group">
<h3 class="support-group-label">Give monthly</h3>
<div class="support-tiers">${tiers}</div>
</div>
<p class="support-dialog-note">Payment is handled by Stripe &mdash; Tranquilo never sees your card details. Amounts are shown in your own currency at checkout.</p>
</div>`;
}

// The dialog is a single document-level singleton, not per-instance --
// every <tranquilo-support-strip> on the page opens the same dialog.
let dialog: HTMLDivElement | null = null;
let lastFocused: Element | null = null;

function ensureDialog(): HTMLDivElement {
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.className = "support-dialog";
  dialog.id = "supportDialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "supportDialogTitle");
  dialog.setAttribute("aria-hidden", "true");
  dialog.innerHTML = dialogHtml();
  document.body.appendChild(dialog);

  // Clicking the backdrop closes; clicking inside must not, or a tier
  // click would close the dialog underneath the navigation it just started.
  on(dialog, (e) => {
    if (e.target === dialog) closeDialog();
  });
  const closeBtn = dialog.querySelector("[data-support-close]");
  if (closeBtn) on(closeBtn, closeDialog);
  return dialog;
}

function openDialog(): void {
  const el = ensureDialog();
  lastFocused = document.activeElement;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  const first = el.querySelector<HTMLElement>(".support-once");
  if (first) first.focus();
}

function closeDialog(): void {
  if (!dialog) return;
  dialog.classList.remove("open");
  dialog.setAttribute("aria-hidden", "true");
  // Send focus back where it came from, or a keyboard user is dropped at
  // the top of the document with no idea what happened.
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

on(document, "keydown", (e) => {
  if (e.key === "Escape" && dialog && dialog.classList.contains("open")) {
    closeDialog();
  }
});

export class TranquiloSupportStrip extends HTMLElement {
  connectedCallback(): void {
    // data-support-strip is the pre-existing selector tests and the CSS
    // gate look for. Idempotent against a reconnect.
    this.setAttribute("data-support-strip", "");
    this.classList.add("support-strip");
    if (this.getAttribute("data-support-mounted") === "1") return;

    // Coming-soon wins over the sandbox guard: both end in "no button",
    // and "briefly unavailable" would be the wrong sentence for something
    // never available.
    const problem = COMING_SOON ? null : liveConfigProblem(location.hostname);
    // The Support Us page drops the line and leads with the button, since
    // its own .mkt-lead already says the same thing above. The homepage
    // keeps it, since there it's the only thing explaining the button.
    //
    // Opt-out rather than opt-in, so a strip added later gets the
    // explanatory sentence by default.
    const withLine = this.getAttribute("data-support-strip-line") !== "off";
    this.innerHTML = COMING_SOON
      ? comingSoonStripHtml()
      : problem
        ? brokenStripHtml(problem)
        : stripHtml(withLine);
    this.setAttribute("data-support-mounted", "1");
    const openBtn = this.querySelector("[data-support-open]");
    if (openBtn) on(openBtn, openDialog);
  }
}

customElements.define("tranquilo-support-strip", TranquiloSupportStrip);

// Backward-compat surface for tests reaching into window.TranquiloSupport
// rather than the element itself -- tests/e2e/support-strip.spec.mts
// reads this via page.evaluate().
const TranquiloSupport = {
  DONATE,
  COMING_SOON,
  STRIP_LINE,
  allLinks,
  isTestLink,
  isProductionHost,
  liveConfigProblem,
  PRODUCTION_HOSTS,
  open: openDialog,
  close: closeDialog,
};

declare global {
  interface Window {
    TranquiloSupport?: typeof TranquiloSupport;
  }
}

if (typeof window !== "undefined") {
  window.TranquiloSupport = TranquiloSupport;
}
