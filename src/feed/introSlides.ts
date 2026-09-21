import tranquiloIconLightUrl from "../../assets/tranquilo-icon-light.svg";
import { roundedWorkCount } from "../logic/logic";

// One of the three homepage action cards. `action` is either a plain link
// (Mission, Support) or a button that opens the newsletter modal (Connect).
// The icon sits in its own row with the title (.action-card-title-row) so
// it can lay out as a small inline mark beside the title on a phone, and
// the button lives outside .action-card-body so it can stack under the
// text on a phone and pin to the card's bottom everywhere wider -- see the
// .action-card rules in css/style.css.
function actionCard({
  icon,
  title,
  body,
  action,
  attrs = "",
}: {
  icon: string;
  title: string;
  body: string;
  action: string;
  attrs?: string;
}): string {
  return (
    `<div class="action-card"${attrs}>` +
    `<div class="action-card-body">` +
    `<div class="action-card-title-row">` +
    `<div class="icon-chip" aria-hidden="true">${icon}</div>` +
    `<h2>${title}</h2>` +
    `</div>` +
    `<p>${body}</p>` +
    `</div>` +
    action +
    `</div>`
  );
}

// The feed's two static, catalogue-independent slides -- the intro trailer
// and the "nothing collected yet" placeholder for My Collection. Neither
// reads or builds an Item, so they live in their own module rather than
// alongside slideBuilder.ts.
export function buildIntroSlide(facets: {
  sources?: unknown[];
  total?: number;
}): HTMLElement {
  // Computed at render time from ?shape=facets, not by iterating `items`
  // (which now holds only scrolled-through pages, not the whole catalogue).
  const sourceCount = (facets.sources || []).length;
  const liveCount = facets.total || 0;
  const el = document.createElement("section");
  el.className = "slide intro";
  el.innerHTML =
    // Light icon, not violet: this slide sits on the near-black ground
    // with no artwork behind it, unlike the top bar's scrim over a painting.
    `<div class="intro-lockup-wrap">` +
    `<img class="intro-lockup" src="${tranquiloIconLightUrl}" ` +
    `alt="" aria-hidden="true" width="150" height="245">` +
    `<div class="intro-lockup-word">Tranquilo.art</div>` +
    `</div>` +
    `<h1 class="visually-hidden">A calmer way to scroll.</h1>` +
    `<div class="intro-rule"></div>` +
    `<p>Enjoy calm scrolling with ${roundedWorkCount(liveCount)} public-domain works across ${sourceCount}${
      sourceCount === 1 ? " source" : " sources"
    }.</p>` +
    `<div class="action-cards">` +
    actionCard({
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
      title: "Mission",
      body: "Open source &amp; ad&#8209;free.",
      action: `<a class="action-card-btn" href="/pages/get-involved.html">Get involved</a>`,
    }) +
    actionCard({
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 6-10 7L2 6"></path></svg>`,
      title: "Connect",
      body: "Monthly curated art.",
      action: `<button type="button" class="action-card-btn" data-open-newsletter>Subscribe</button>`,
    }) +
    // Marked data-donations on the whole card, not just the link, so the
    // donations kill switch (tests/donations-flag.test.ts) hides the icon
    // and copy along with the button rather than leaving a headless card.
    actionCard({
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>`,
      title: "Support",
      body: "Sustained by community.",
      action: `<a class="action-card-btn" href="/pages/support.html">Give</a>`,
      attrs: " data-donations",
    }) +
    `</div>`;
  return el;
}

export function buildEmptyCollectionSlide(): HTMLElement {
  const el = document.createElement("section");
  el.className = "slide intro";
  el.innerHTML =
    '<div class="intro-eyebrow">My Collection</div>' +
    "<h1>Nothing collected<br>yet.</h1>" +
    '<div class="intro-rule"></div>' +
    "<p>Tap the bookmark on any piece to start.</p>";
  return el;
}
