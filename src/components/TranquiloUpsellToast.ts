// The Collect upsell toast ("Saved temporarily in this browser...", with a
// Pro waitlist link). No host object -- gating and display never need
// app.js's private state, so app.js just calls its public methods.
//
// SESSION_TOAST_KEY/LAST_TOAST_KEY are duplicated (not imported) from
// app.js's consts of the same name/value: the same key string is also read
// by an unrelated legacy-migration and a `?resetUpsell=1` test switch, and
// storage is keyed by string, so duplicating the literal is safe.
const SESSION_TOAST_KEY = "tranquilo:toastShownThisSession";
const LAST_TOAST_KEY = "tranquilo:lastToastShownAt";
// Fires on the Nth save rather than on a clock, so "your collection is
// temporary" lands once there's actually something worth losing.
const UPSELL_MIN_SAVED = 3;

const UPSELL_TOAST_MARKUP = `
<button class="upsell-close" id="upsellClose" type="button" aria-label="Dismiss">&times;</button>
<p>Saved temporarily in this browser. Permanent collections and organization are part of Pro, still taking shape.</p>
<a class="upsell-cta" id="upsellCta" href="/pages/pro.html">Join the waitlist</a>
`;

export class TranquiloUpsellToast extends HTMLElement {
  private timer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback(): void {
    if (this.getAttribute("data-upsell-toast-mounted") === "1") return;
    this.setAttribute("data-upsell-toast-mounted", "1");

    this.innerHTML = UPSELL_TOAST_MARKUP;
    const closeBtn = this.querySelector<HTMLButtonElement>("#upsellClose");
    if (!closeBtn) {
      throw new Error(
        "<tranquilo-upsell-toast>: missing #upsellClose in its own template",
      );
    }
    closeBtn.addEventListener("click", () => this.hide());
    // upsellCta's href is root-relative deliberately: the feed
    // pushState()s to /v/{slug} without reloading, so a relative path
    // would resolve against that instead of "/" and 404.
  }

  // savedCount is passed in so the count reflects the save that just
  // happened. Gated by both UPSELL_MIN_SAVED and once-per-session, since
  // Collect is frequent/low-intent and would otherwise nag.
  maybeShow(savedCount: number): void {
    if (sessionStorage.getItem(SESSION_TOAST_KEY)) return;
    if (savedCount < UPSELL_MIN_SAVED) return;
    this.show();
    sessionStorage.setItem(SESSION_TOAST_KEY, "1");
    // Timestamp only, for manual "did this ever fire" checks -- nothing reads it back.
    localStorage.setItem(LAST_TOAST_KEY, String(Date.now()));
  }

  show(): void {
    this.classList.add("show");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), 7000);
  }

  hide(): void {
    this.classList.remove("show");
    if (this.timer) clearTimeout(this.timer);
  }
}

customElements.define("tranquilo-upsell-toast", TranquiloUpsellToast);
