import tranquiloIconLightUrl from "../../assets/tranquilo-icon-light.svg";
import { roundedWorkCount } from "../logic/logic";

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
    `<p>${roundedWorkCount(liveCount)} public-domain works across ${sourceCount}${
      sourceCount === 1 ? " source" : " sources"
    }. ` +
    `No accounts, no ads, no algorithm &mdash; just scroll.</p>` +
    `<nav class="intro-links">` +
    `<a href="/pages/about.html">About</a>` +
    `<span class="sep">&middot;</span>` +
    `<a href="/pages/submit.html">Submit a Collection</a>` +
    // Separator inside the gated span, or hiding the link alone leaves a
    // trailing dot.
    `<span data-donations><span class="sep">&middot;</span>` +
    `<a href="/pages/support.html">Support us</a></span>` +
    `</nav>` +
    // Custom element, shared with pages/support.html so the two copies
    // can't drift; connectedCallback() fires on its own once inserted.
    `<tranquilo-support-strip data-donations></tranquilo-support-strip>`;
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
