// The artwork detail panel (image, Meet-the-Cast/Plot-Twist/Tea sections,
// material/provenance/tags, shelf-browse swipe nav), as a native custom
// element.
//
// Same property-assignment host as ITopbarHost/ITranquiloFeedHost/
// ITranquiloLightboxHost (`detailModalEl.app = {...}`), since app.js
// discovers this element at runtime via getElementById, not a static
// import. See src/types/ITranquiloDetailModalHost.ts for the full contract.
//
// The storyline<->detail-modal handoff is deliberately not part of that
// host, since neither component owns the other: two CustomEvents instead,
// "storyline-handoff-open" (opens this panel and remembers where to
// return) and "storyline-handoff-restore" (fired from close(), lets
// app.js reopen the storyline at that chapter).
//
// app.js still owns the six-overlay popstate/Escape handler and reads this
// element's own classList/aria-hidden exactly as it read the plain div
// before this was a custom element -- see TranquiloLightbox.ts's header.
//
// Renders into light DOM, not a shadow root: every style already lives in
// css/style.css.

import {
  type CitationStyle,
  formatCitation,
  publicationLabel,
} from "../app/citation";
import { licenseLabel } from "../app/licenseLabels";
import { currentLocale, facetLabel, type MessageKey, t } from "../i18n/index";
import { isNamedMaker } from "../logic/logic";
import {
  importTaxApplies,
  PRINT_COUNTRIES,
  printOptionsFor,
  regionForCountry,
} from "../logic/printOptions";
import type { ITranquiloDetailModalHost } from "../types/ITranquiloDetailModalHost";
import type { Item, TeaVoiceSource } from "../types/Item";
import type { PrintQuoteResult } from "../types/PrintQuote";
import { on } from "../utils/on";

// Built when the element mounts, with text from src/i18n escaped on the way
// in (translations must never be parsed as markup).
const detailModalMarkup = () => `
<button class="detail-close" id="detailClose" aria-label="${escapeHtml(t("detail.close"))}">&times;</button>
<div class="detail-shelf-position" id="detailShelfPosition" hidden></div>
<button class="detail-shelf-nav prev" id="detailShelfPrev" type="button" aria-label="${escapeHtml(t("detail.shelfPrev"))}" hidden>&larr;</button>
<button class="detail-shelf-nav next" id="detailShelfNext" type="button" aria-label="${escapeHtml(t("detail.shelfNext"))}" hidden>&rarr;</button>
<div class="detail-modal-track" id="detailModalTrack"></div>
`;

// escapeHtml/SHARE_SVG/STORYLINE_SVG are duplicated here rather than
// imported from src/feed/slideBuilder.ts: small, fully static content that's
// cheaper to copy once than to add an import or a host method for.
function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CHEVRON_SVG =
  '<svg class="cast-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const TWIST_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>';
const STORYLINE_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>';
// Set-of-works chip icon -- same duplication reasoning as STORYLINE_SVG above.
const SET_OF_WORKS_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const SHARE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';
// A rectangular flag-on-a-pole, deliberately not TWIST_SVG's wavy pennant
// shape above -- both buttons can appear in the same caption-actions row,
// and a "report a problem" control should not look like the "plot twist"
// one it sits next to.
const FLAG_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"></path><path d="M4 4h13l-2 4 2 4H4"></path></svg>';

// Checkboxes, not buttons -- more than one can apply to the same
// report. A free-text comment sits alongside them regardless of which (if
// any) are checked; see wireReportMenu().
//
// `value` is what reaches /api/submit-collection (and the report email), so
// it stays fixed English whatever the visitor's language; only `label` is
// translated.
const REPORT_CATEGORIES: ReadonlyArray<{ value: string; label: MessageKey }> = [
  { value: "There's an issue with image", label: "detail.report.image" },
  { value: "There's an issue with content", label: "detail.report.content" },
  {
    value: "I'm having a technical issue (broken link)",
    label: "detail.report.technical",
  },
  { value: "Tell us more", label: "detail.report.more" },
];

// The AI-disclosure badge on a Tea-tier caption. TranquiloStorylineMode.ts
// carries its own copy of this exact string for its chapter captions,
// duplicated here for the same reason as the SVG icons above.
const AI_CORRECTIONS_EMAIL = "hello@tranquilo.art";
const AI_HELP_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="12" r="9"></circle>' +
  '<path d="M9.4 9.3a2.6 2.6 0 1 1 3.4 2.5c-.7.25-1 .75-1 1.4v.5"></path>' +
  '<line x1="12" y1="17.3" x2="12" y2="17.3"></line>' +
  "</svg>";
const AI_DISCLOSURE_HTML =
  `<button class="ai-badge" type="button" data-ai-disclosure ` +
  `aria-expanded="false" aria-label="How this text was written">${
    AI_HELP_SVG
  }</button>` +
  `<span class="ai-badge-note" data-ai-disclosure-text role="note">` +
  `Drafted with AI help; edited and reviewed by a person. ` +
  `Spotted an error? <a href="mailto:${AI_CORRECTIONS_EMAIL}">${AI_CORRECTIONS_EMAIL}</a>` +
  `</span>`;

function licenseRow(item: Item): string {
  const { label, deed } = licenseLabel(item?.license, item?.url);
  if (!label) return "";
  const value = deed
    ? `<a class="meta-license-link" href="${escapeHtml(deed)}" target="_blank" rel="noopener license">${escapeHtml(label)}</a>`
    : escapeHtml(label);
  // Not metaRow(), which escapes its value -- this one carries a link.
  return `<div class="meta-row"><span class="meta-label">${escapeHtml(t("detail.meta.license"))}</span> ${value}</div>`;
}

function metaRow(label: string, value: string | null | undefined): string {
  if (!value || !String(value).trim()) return "";
  return `<div class="meta-row"><span class="meta-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
}

// `artist_nationality`/`artist_lifespan` are only set for works attributed
// to a named person; `culture`/`culture_period` for a culture or era. Both
// can legitimately be present, so both are shown.
function originRows(item: Item): string {
  let rows = "";
  const nationality = item.artist_nationality || "";
  const lifespan = item.artist_lifespan || "";
  if (nationality || lifespan) {
    rows += metaRow(
      t("detail.meta.artistOrigin"),
      [nationality, lifespan].filter(Boolean).join(" · "),
    );
  }
  const culture = item.culture || "";
  const period = item.culture_period || "";
  if (culture || period) {
    // attribution_type describes the ARTIST field, which is the wrong
    // signal for Europeana, where `culture` is always the object's place
    // regardless of attribution_type -- a Europeana row naming a real
    // artist once rendered as "Culture: Netherlands" under that label.
    rows += metaRow(
      item.source === "europeana"
        ? t("detail.meta.objectOrigin")
        : item.attribution_type === "person"
          ? t("detail.meta.origin")
          : t("detail.meta.culture"),
      [culture, period].filter(Boolean).join(" · "),
    );
  }
  // Older rows, and anything the split could not place, still have the raw
  // string. Showing it unlabelled-but-present beats dropping it.
  if (!rows && item.bio) rows = metaRow(t("detail.meta.origin"), item.bio);
  return rows;
}

// Meet-the-Cast section. If any cast member is "hedged" (source-attributed
// but unconfirmed), the intro switches to softened language and each
// hedged name gets a "Possibly" prefix, so it's never presented with a
// grounded identification's confidence.
function buildCastSectionHtml(item: Item): string {
  if (!item.cast || (item.cast_tier !== "full" && item.cast_tier !== "partial"))
    return "";
  const isHedged = item.cast.some((c) => c.attribution_confidence === "hedged");

  let introHtml = "";
  if (isHedged) {
    const names = item.cast.map((c) => c.name);
    const joined =
      names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
        : names[0];
    introHtml = `<p class="cast-intro cast-intro-hedged">Believed to depict ${escapeHtml(joined)}.</p>`;
  } else if (item.cast_context && item.cast_context.status === "grounded") {
    introHtml = `<p class="cast-intro">${escapeHtml(item.cast_context.text)}</p>`;
  }
  // Shown even when hedged: the existence of a sourced, contested
  // identification is itself a grounded fact, distinct from the identity
  // claim it describes.
  const contextDetailHtml =
    item.cast_context && item.cast_context.status === "grounded" && isHedged
      ? `<p class="cast-context-detail">${escapeHtml(item.cast_context.text)}</p>`
      : "";

  const peopleHtml = item.cast
    .map((person, idx) => {
      const hedgedPerson = person.attribution_confidence === "hedged";
      const displayName = hedgedPerson
        ? t("detail.cast.possibly", { name: person.name })
        : person.name;
      const tidbitHtml =
        person.status === "grounded" && person.tidbit
          ? `<p>${escapeHtml(person.tidbit)}</p>${
              person.source_url
                ? `<a class="source-link" href="${escapeHtml(person.source_url)}" target="_blank" rel="noopener"><span class="link-text">${escapeHtml(t("detail.source"))}</span><span class="link-arrow" aria-hidden="true">&rarr;</span></a>`
                : ""
            }`
          : `<p class="cast-no-tidbit">${escapeHtml(t("detail.cast.noDetail"))}</p>`;
      return (
        `<li class="cast-person">` +
        `<button class="cast-person-toggle" type="button" aria-expanded="false" data-cast-idx="${idx}">` +
        `<span class="cast-name">${escapeHtml(displayName)}</span>${
          CHEVRON_SVG
        }</button>` +
        `<div class="cast-tidbit" id="castTidbit${idx}" hidden>${tidbitHtml}</div>` +
        `</li>`
      );
    })
    .join("");

  return (
    `<div class="cast-section">` +
    `<button class="cast-toggle" type="button" aria-expanded="false">` +
    `<span>${escapeHtml(t("detail.cast.title"))}</span>${CHEVRON_SVG}</button>` +
    `<div class="cast-panel" hidden>${
      introHtml
    }<ul class="cast-list">${peopleHtml}</ul>${contextDetailHtml}</div>` +
    `</div>`
  );
}

function wireCastSection(container: HTMLElement): void {
  const section = container.querySelector<HTMLElement>(".cast-section");
  if (!section) return;
  const sectionToggle =
    section.querySelector<HTMLButtonElement>(".cast-toggle");
  const panel = section.querySelector<HTMLElement>(".cast-panel");
  if (!sectionToggle || !panel) return;
  on(sectionToggle, () => {
    const open = sectionToggle.getAttribute("aria-expanded") === "true";
    sectionToggle.setAttribute("aria-expanded", open ? "false" : "true");
    panel.hidden = open;
  });
  // Scoped to this section, not a global getElementById -- castTidbit ids
  // repeat across items, and once shelf browsing puts more than one in the
  // DOM at once, a global lookup would always hit the first page's tidbit.
  section
    .querySelectorAll<HTMLButtonElement>(".cast-person-toggle")
    .forEach((btn) => {
      on(btn, () => {
        const tidbit = section.querySelector<HTMLElement>(
          `#castTidbit${btn.dataset.castIdx}`,
        );
        if (!tidbit) return;
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", open ? "false" : "true");
        tidbit.hidden = open;
      });
    });
}

// Scoped to this item's container, same reasoning as wireCastSection. The
// outside-click listener has to live on `document`, but buildPage() creates
// a fresh container per item, so it gets its own AbortController per menu
// open rather than accumulating a permanent listener for every item ever
// opened.
function wireReportMenu(
  container: HTMLElement,
  item: Item,
  host: ITranquiloDetailModalHost,
): void {
  const reportBtn = container.querySelector<HTMLButtonElement>(".btn-report");
  const menu = container.querySelector<HTMLElement>(".report-menu");
  if (!reportBtn || !menu) return;

  const checkboxes = Array.from(
    menu.querySelectorAll<HTMLInputElement>(
      '.report-checkbox input[type="checkbox"]',
    ),
  );
  const commentInput =
    menu.querySelector<HTMLTextAreaElement>(".report-comment");
  const sendBtn = menu.querySelector<HTMLButtonElement>(".report-send");

  let outsideClick: AbortController | null = null;

  const closeMenu = () => {
    menu.hidden = true;
    reportBtn.setAttribute("aria-expanded", "false");
    outsideClick?.abort();
    outsideClick = null;
  };

  const resetMenu = () => {
    checkboxes.forEach((c) => {
      c.checked = false;
    });
    if (commentInput) commentInput.value = "";
  };

  on(reportBtn, (e) => {
    e.stopPropagation();
    const opening = menu.hidden;
    if (!opening) {
      closeMenu();
      return;
    }
    resetMenu();
    menu.hidden = false;
    reportBtn.setAttribute("aria-expanded", "true");
    outsideClick = new AbortController();
    on(
      document,
      "click",
      (ev) => {
        if (
          menu.contains(ev.target as Node) ||
          reportBtn.contains(ev.target as Node)
        )
          return;
        closeMenu();
      },
      { signal: outsideClick.signal },
    );
  });

  if (sendBtn) {
    on(sendBtn, () => {
      const categories = checkboxes
        .filter((c) => c.checked)
        .map((c) => c.value);
      const comment = commentInput?.value.trim() || "";
      // Nothing to report -- neither a category nor a word typed. Silent,
      // not an error: this is the state right after opening the menu, not
      // a mistake someone needs telling about.
      if (!categories.length && !comment) return;

      // Fire-and-forget: the toast confirms immediately regardless of
      // outcome, so a report about a broken image never surfaces a second
      // failure on top of the first.
      void fetch("/api/submit-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "report",
          itemSource: item.source,
          itemNativeId: item.id,
          // Fixed English, like the category values: this is report data
          // for the team, not text shown to the visitor.
          itemTitle: item.title || "Untitled",
          itemUrl: `${location.origin}/v/${encodeURIComponent(`${item.source}-${item.id}`)}`,
          categories,
          comment,
          locale: currentLocale(),
        }),
      }).catch(() => {});

      host.showToast(t("detail.report.thanks"));
      closeMenu();
    });
  }
}

// Plot Twist section. twist_story renders as the lead item, above
// fact-box/bio/credit/tags. Confidence hedging happens in the twist_story
// copy itself rather than a different badge or box treatment, so every
// confidence tier shares one visual style.
function buildTwistSectionHtml(item: Item): string {
  if (!item.twist_category || !item.twist_story) return "";
  const sourceLinkHtml = item.twist_source_url
    ? `<a class="source-link" href="${escapeHtml(item.twist_source_url)}" target="_blank" rel="noopener"><span class="link-text">${escapeHtml(t("detail.source"))}</span><span class="link-arrow" aria-hidden="true">&rarr;</span></a>`
    : "";
  return (
    `<div class="twist-box">` +
    `<div class="twist-label">${TWIST_SVG}<span>${escapeHtml(t("detail.twist"))}</span></div>` +
    `<p>${escapeHtml(item.twist_story)}</p>${sourceLinkHtml}</div>`
  );
}

// The grounding behind a Tea Voice caption, as small link icons. Icons
// rather than a labelled "Source →" link, since a Tea caption fires on
// nearly every item and a labelled link there would read as citation-dense.
// One icon per grounded claim, since collapsing several sources to one
// link would silently imply it covered the rest.
const TEA_SOURCE_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>' +
  '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';

// A book behind a claim gets its own icon, linking to where a reader can
// get it.
const TEA_BOOK_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>' +
  '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>';

function teaBookSourceHtml(src: TeaVoiceSource): string {
  const pub = src.publication;
  if (!pub?.url) return "";
  const label = publicationLabel(pub);
  const tip = src.text ? `${src.text} — ${label}` : label;
  return (
    `<a class="tea-book-source" href="${escapeHtml(pub.url)}" ` +
    'target="_blank" rel="noopener noreferrer" ' +
    `title="${escapeHtml(tip)}" ` +
    `aria-label="${escapeHtml(t("detail.bookSource", { title: pub.title }))}">` +
    `${TEA_BOOK_SVG}</a>`
  );
}

function sourceHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Never let a malformed stored URL take down the whole modal.
    return "source";
  }
}

// "Cite this work": MLA, APA and ABNT (the Brazilian standard), each with
// its own Copy button. Collapsed until asked for. Offered only alongside a Tea caption, the reviewed tier whose
// readers (educators, students) are the ones asking for citations.
const CITATION_STYLES: { style: CitationStyle; label: string }[] = [
  { style: "mla", label: "MLA" },
  { style: "apa", label: "APA" },
  { style: "abnt", label: "ABNT" },
];

function citeButtonHtml(item: Item): string {
  if (!item.caption_tea) return "";
  return `<button class="btn-cite" type="button" aria-expanded="false">${escapeHtml(t("detail.cite.button"))}</button>`;
}

function citePanelHtml(item: Item): string {
  if (!item.caption_tea) return "";
  return `<div class="cite-panel" hidden>${CITATION_STYLES.map(
    ({ style, label }) =>
      `<div class="cite-row" data-style="${style}"><span class="cite-style">${label}</span>` +
      `<p class="cite-text">${escapeHtml(formatCitation(item, style))}</p>` +
      `<button class="cite-copy" type="button">${escapeHtml(t("detail.cite.copy"))}</button></div>`,
  ).join("")}</div>`;
}

function wireCite(container: HTMLElement): void {
  const btn = container.querySelector<HTMLButtonElement>(".btn-cite");
  const panel = container.querySelector<HTMLElement>(".cite-panel");
  if (!btn || !panel) return;
  on(btn, () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
  });
  for (const row of panel.querySelectorAll<HTMLElement>(".cite-row")) {
    const copy = row.querySelector<HTMLButtonElement>(".cite-copy");
    const text = row.querySelector(".cite-text")?.textContent ?? "";
    if (!copy) continue;
    // The button's own label confirms the copy (then resets), so the
    // click is never indistinguishable from a no-op.
    const flash = (key: MessageKey) => {
      copy.textContent = t(key);
      setTimeout(() => {
        copy.textContent = t("detail.cite.copy");
      }, 2000);
    };
    on(copy, () => {
      if (!navigator.clipboard?.writeText) return flash("detail.cite.failed");
      navigator.clipboard.writeText(text).then(
        () => flash("detail.cite.copied"),
        () => flash("detail.cite.failed"),
      );
    });
  }
}

function wirePrint(
  container: HTMLElement,
  item: Item,
  host: ITranquiloDetailModalHost,
): void {
  const btn = container.querySelector<HTMLButtonElement>(".btn-print");
  const panel = container.querySelector<HTMLElement>(".print-panel");
  if (!btn || !panel) return;
  const panelEl: HTMLElement = panel;
  const orientation =
    (item.master_width ?? 0) > (item.master_height ?? 0) ? "hor" : "ver";
  const mockup = (p: string) =>
    `<div class="mockup mockup-${p}" data-orientation="${orientation}">` +
    `<div class="mockup-surface"><img src="${escapeHtml(item.img)}" alt="" loading="lazy" decoding="async"></div></div>`;
  const countryName = (code: string) =>
    new Intl.DisplayNames([currentLocale()], { type: "region" }).of(code) ??
    code;
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(currentLocale(), {
      style: "currency",
      currency,
    }).format(amount);
  let renderId = 0;

  function fillQuote(
    row: HTMLElement,
    country: string,
    result: PrintQuoteResult | null,
  ) {
    const price = row.querySelector<HTMLElement>(".print-price");
    const delivery = row.querySelector<HTMLElement>(".print-delivery");
    if (!price || !delivery) return;
    if (!result) {
      price.textContent = t("detail.print.priceUnavailable");
    } else if (!result.available) {
      price.textContent = t("detail.print.notAvailable", {
        country: countryName(country),
      });
    } else {
      price.textContent = money(result.total, result.currency);
      const days =
        result.minDays !== null && result.maxDays !== null
          ? t("detail.print.deliveryDays", {
              min: String(result.minDays),
              max: String(result.maxDays),
            })
          : "";
      delivery.textContent = [
        t("detail.print.deliveryIncluded", {
          price: money(result.delivery, result.currency),
        }),
        days,
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  function render(country: string, refocus = false) {
    const id = ++renderId;
    const region = regionForCountry(country);
    const products = printOptionsFor(item, region);
    const countries = [...PRINT_COUNTRIES].sort((a, b) =>
      countryName(a).localeCompare(countryName(b), currentLocale()),
    );
    panelEl.innerHTML =
      `<label class="print-ship-to"><span>${escapeHtml(t("detail.print.shipTo"))}</span><select>${countries
        .map(
          (code) =>
            `<option value="${code}"${code === country ? " selected" : ""}>${escapeHtml(countryName(code))}</option>`,
        )
        .join("")}</select></label>` +
      products
        .map((p) => {
          const name = t(`print.product.${p}` as MessageKey);
          return (
            `<div class="print-option" data-product="${p}">` +
            `<button class="print-thumb" type="button" aria-expanded="false" aria-label="${escapeHtml(t("detail.print.showMockup", { product: name }))}">${mockup(p)}</button>` +
            `<span class="print-label"><span class="print-name">${escapeHtml(name)}</span>` +
            `<span class="print-size">${escapeHtml(t(`print.size.${p}` as MessageKey))}</span></span>` +
            `<span class="print-quote"><span class="print-price" aria-live="polite">${escapeHtml(t("detail.print.priceLoading"))}</span>` +
            `<span class="print-delivery"></span></span>` +
            `<div class="print-mockup-large" hidden>${mockup(p)}` +
            `<p class="print-mockup-note">${escapeHtml(t("detail.print.mockupNote"))}</p></div></div>`
          );
        })
        .join("") +
      `<p class="print-soon">${[
        t("detail.print.approximate"),
        importTaxApplies(region) && t("detail.print.importTax"),
        t("detail.print.soon"),
      ]
        .filter(Boolean)
        .map((text) => escapeHtml(text as string))
        .join(" ")}</p>`;
    const select = panelEl.querySelector<HTMLSelectElement>(
      ".print-ship-to select",
    );
    if (select) {
      on(select, "change", () => render(select.value, true));
      if (refocus) select.focus();
    }
    const rows = [...panelEl.querySelectorAll<HTMLElement>(".print-option")];
    for (const row of rows) {
      const thumb = row.querySelector<HTMLButtonElement>(".print-thumb");
      const large = row.querySelector<HTMLElement>(".print-mockup-large");
      if (!thumb || !large) continue;
      on(thumb, () => {
        const opening = large.hidden;
        for (const other of rows) {
          const otherLarge = other.querySelector<HTMLElement>(
            ".print-mockup-large",
          );
          if (otherLarge) otherLarge.hidden = true;
          other
            .querySelector(".print-thumb")
            ?.setAttribute("aria-expanded", "false");
        }
        large.hidden = !opening;
        thumb.setAttribute("aria-expanded", String(opening));
      });
      host
        .printQuote(item, row.dataset.product ?? "", country)
        .then(
          (result) => result,
          () => null,
        )
        .then((result) => {
          if (id === renderId) fillQuote(row, country, result);
        });
    }
  }

  host.printCountry(item).then((detected) => {
    if (!detected) return;
    if (!printOptionsFor(item, regionForCountry(detected)).length) return;
    render(detected.toUpperCase());
    btn.hidden = false;
  });
  on(btn, () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      host.trackEvent("print_panel_open", { category: item.category ?? null });
    }
  });
}

function buildTeaSourcesHtml(item: Item): string {
  // Only Tea-tier captions have grounding. A Basic-tier item deliberately
  // has no caption_tea and no claims, and must not sprout an empty source
  // row.
  if (!item.caption_tea) return "";
  const sources = item.tea_voice_sources;
  if (!Array.isArray(sources) || !sources.length) return "";

  return (
    `<div class="tea-sources">` +
    `<span class="tea-sources-label">${escapeHtml(t("detail.sources"))}</span>${sources
      .map((src) => {
        if (!src?.url) return "";
        const book = teaBookSourceHtml(src);
        // A claim whose source is the book itself needs only the book icon.
        if (book && src.publication?.url === src.url) return book;
        // The tooltip carries the claim this link actually backs, plus the
        // host -- "show the source on hover" is only useful if it says
        // WHICH part of the caption it supports.
        const host = sourceHostLabel(src.url);
        const tip = (src.text ? `${src.text} — ` : "") + host;
        return (
          `<a class="tea-source" href="${escapeHtml(src.url)}" ` +
          'target="_blank" rel="noopener noreferrer" ' +
          `title="${escapeHtml(tip)}" ` +
          `aria-label="${escapeHtml(t("detail.sourceHost", { host }))}">` +
          `${TEA_SOURCE_SVG}</a>${book}`
        );
      })
      .join("")}</div>`
  );
}

export interface DetailShelfContext {
  items: Item[];
  index: number;
}

interface StorylineHandoffOpenDetail {
  item: Item;
  storylineId: string;
  position: number;
}

interface StorylineHandoffRestoreDetail {
  id: string;
  position: number;
}

export class TranquiloDetailModal extends HTMLElement {
  app: ITranquiloDetailModalHost | null = null;

  private closeBtn!: HTMLButtonElement;
  private trackEl!: HTMLElement;
  private shelfPositionEl!: HTMLElement;
  private shelfPrevEl!: HTMLButtonElement;
  private shelfNextEl!: HTMLButtonElement;

  // ---- Shelf browse mode: swipe/click/arrow-key navigation between a
  // shelf's items without closing and re-tapping. Reuses Storyline mode's
  // horizontal scroll-snap mechanism. Unlike Storyline mode there's no
  // forced intro page and the position indicator is plain "N of M" text
  // rather than a dot timeline, since shelves aren't bounded to a small
  // fixed count. No wraparound at the boundaries.
  private shelfItems: Item[] | null = null;
  private singleItem: Item[] | null = null;
  private detailInFlight = new Set<string>();
  private shelfIndex = 0;
  private shelfObserver: IntersectionObserver | null = null;

  // Whether the currently-open panel was opened from Discover rather than
  // the main feed -- buildShelfRow's click handler has to close shelvesMode
  // first (its z-index sits above this panel's), so close() needs this flag
  // to know it should restore Discover rather than reveal whatever's
  // underneath.
  private openedFromShelves = false;

  // Which storyline to put back, and where, when reached via
  // storyline-handoff-open -- null for any other path, so an ordinary
  // close does nothing special.
  private storylineHandoff: StorylineHandoffRestoreDetail | null = null;

  // Throws a clear error instead of a silent null if detailModalMarkup() and
  // a selector below ever drift apart.
  private requireEl<T extends Element>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el) {
      throw new Error(
        `<tranquilo-detail-modal>: missing ${selector} in its own template`,
      );
    }
    return el;
  }

  private requireApp(): ITranquiloDetailModalHost {
    if (!this.app) {
      throw new Error("<tranquilo-detail-modal>: called before app was set");
    }
    return this.app;
  }

  // Exposed so app.js's Escape-key fallback can snapshot this before
  // calling close(), which clears the flag as part of restoring Discover --
  // otherwise the fallback's own closeShelvesMode() would undo it.
  get isReturningToShelves(): boolean {
    return this.openedFromShelves;
  }

  connectedCallback(): void {
    if (this.getAttribute("data-detail-modal-mounted") === "1") return;
    this.setAttribute("data-detail-modal-mounted", "1");

    this.innerHTML = detailModalMarkup();
    this.closeBtn = this.requireEl<HTMLButtonElement>("#detailClose");
    this.trackEl = this.requireEl<HTMLElement>("#detailModalTrack");
    this.shelfPositionEl = this.requireEl<HTMLElement>("#detailShelfPosition");
    this.shelfPrevEl = this.requireEl<HTMLButtonElement>("#detailShelfPrev");
    this.shelfNextEl = this.requireEl<HTMLButtonElement>("#detailShelfNext");

    on(this.closeBtn, () =>
      this.requireApp().requestOverlayClose(() => this.close()),
    );
    on(this.shelfPrevEl, () => this.goToShelfIndex(this.shelfIndex - 1));
    on(this.shelfNextEl, () => this.goToShelfIndex(this.shelfIndex + 1));

    on(document, "keydown", (e) => {
      if (!this.shelfItems || !this.classList.contains("open")) return;
      if (e.key === "ArrowLeft") this.goToShelfIndex(this.shelfIndex - 1);
      else if (e.key === "ArrowRight") this.goToShelfIndex(this.shelfIndex + 1);
    });

    on<CustomEvent<StorylineHandoffOpenDetail>>(
      this,
      "storyline-handoff-open",
      (e) => {
        this.storylineHandoff = {
          id: e.detail.storylineId,
          position: e.detail.position,
        };
        this.open(e.detail.item);
      },
    );
  }

  private updateShelfPosition(index: number): void {
    if (!this.shelfItems) return;
    this.shelfIndex = index;
    this.shelfPositionEl.textContent = t("slide.position", {
      index: index + 1,
      total: this.shelfItems.length,
    });
    this.shelfPrevEl.disabled = index === 0;
    this.shelfNextEl.disabled = index === this.shelfItems.length - 1;
    this.requireApp().sampleArtworkColor(this.shelfItems[index], (tint) => {
      this.style.backgroundColor = tint || "";
    });
    this.ensureDetail(index);
  }

  private observeShelfTrack(): void {
    this.shelfObserver?.disconnect();
    this.shelfObserver = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (
            entry.isIntersecting &&
            (!best || entry.intersectionRatio > best.intersectionRatio)
          ) {
            best = entry;
          }
        }
        if (best) {
          const idx = Array.from(this.trackEl.children).indexOf(best.target);
          if (idx !== -1) this.updateShelfPosition(idx);
        }
      },
      { root: this.trackEl, threshold: 0.6 },
    );
    Array.from(this.trackEl.children).forEach((page) => {
      this.shelfObserver?.observe(page);
    });
  }

  private goToShelfIndex(index: number): void {
    if (!this.shelfItems) return;
    const clamped = Math.max(0, Math.min(this.shelfItems.length - 1, index));
    const page = this.trackEl.children[clamped] as HTMLElement | undefined;
    if (page) this.trackEl.scrollLeft = page.offsetLeft;
  }

  private buildDetailContentHtml(item: Item): string {
    const host = this.requireApp();
    // A culture or period label ("Italian 16th Century") stays plain text,
    // like "Unknown": many makers, so there is no one author to show more of.
    let artistLine = item.artist
      ? isNamedMaker(item.artist)
        ? `<button class="artist-link" type="button">${escapeHtml(item.artist)}</button>`
        : `<span>${escapeHtml(item.artist)}</span>`
      : "";
    // Labelled since a lone "Unknown" would otherwise read as though
    // something failed to load rather than an honest attribution.
    if (artistLine)
      artistLine = `<span class="meta-label">${escapeHtml(t("detail.meta.artist"))}</span> ${artistLine}`;
    const dateLine = item.date
      ? `<span class="sep">&middot;</span><span class="meta-label">${escapeHtml(t("detail.meta.created"))}</span> ${escapeHtml(item.date)}`
      : "";
    // Same storyline chip the main feed renders, for entry points that
    // only ever land here.
    const storyline = host.storylineFor(item);
    const storylineChipHtml = storyline
      ? `<button class="storyline-chip" type="button">${STORYLINE_SVG}` +
        `<span>Storyline &middot; ${host.storylinePositionLabel(item, storyline)}</span></button>`
      : "";
    // Same set-of-works chip, same reasoning as storylineChipHtml above.
    const setOfWork = host.setOfWorkFor(item);
    const setOfWorksChipHtml = setOfWork
      ? `<button class="set-of-works-chip" type="button">${SET_OF_WORKS_SVG}` +
        `<span>${host.setOfWorkPositionLabel(item, setOfWork)}</span></button>`
      : "";
    return (
      `${
        item.img
          ? `<div class="d-frame loading"><div class="art-skeleton"></div><img alt="${escapeHtml(item.title || t("common.untitled"))}"></div>`
          : ""
      }<div class="cat-label">${escapeHtml(facetLabel("category", item.category ?? ""))}</div>` +
      `<h2 class="art-title">${escapeHtml(item.title || t("common.untitled"))}</h2>` +
      `<p class="art-meta">${artistLine}${dateLine}</p>${storylineChipHtml}${
        setOfWorksChipHtml
        // Reuses shareItem()/.btn-share as-is, a second entry point onto
        // the feed's existing mechanism.
      }<div class="caption-actions"><button class="btn-share" type="button" aria-label="${escapeHtml(t("slide.share"))}">` +
      `${SHARE_SVG}</button><button class="btn-report" type="button" aria-label="${escapeHtml(t("detail.report.button"))}" aria-haspopup="true" aria-expanded="false">${FLAG_SVG}</button>` +
      `<div class="report-menu" hidden role="menu">${REPORT_CATEGORIES.map(
        (c) =>
          `<label class="report-checkbox"><input type="checkbox" value="${escapeHtml(c.value)}">${escapeHtml(t(c.label))}</label>`,
      ).join(
        "",
      )}<textarea class="report-comment" maxlength="2000" placeholder="${escapeHtml(t("detail.report.commentPlaceholder"))}"></textarea>` +
      `<button class="report-send" type="button">${escapeHtml(t("detail.report.send"))}</button></div></div>${buildTwistSectionHtml(
        item,
      )}${
        item.caption_tea || item.caption_basic
          ? `<div class="fact-box">` +
            `<div class="fact-label">${escapeHtml(item.caption_tea ? t("detail.fact.didYouKnow") : t("detail.fact.basic"))}` +
            `${item.caption_tea ? AI_DISCLOSURE_HTML : ""}</div>` +
            `<p>${escapeHtml(item.caption_tea || item.caption_basic || "")}</p>${buildTeaSourcesHtml(
              item,
            )}</div>`
          : ""
      }${buildCastSectionHtml(item)}<div class="rule"></div>` +
      `<div class="d-body">${
        // Labelled rows. metaRow() renders nothing (not an empty <div>)
        // when the value is missing.
        metaRow(t("detail.meta.material"), item.medium)
      }${
        originRows(item)
        // Set only when `date` describes the photograph rather than the
        // object, labelled separately so it never reads as the creation date.
      }${
        metaRow(t("detail.meta.photographDate"), item.photograph_date)
        // Who photographed the work, credited apart from its maker. Absent
        // for most rows, and metaRow() then renders nothing.
      }${
        metaRow(t("detail.meta.photographer"), item.photographer)
        // "Provenance", not "Credit" -- non-provenance text is blanked at
        // ingestion, so anything reaching here has earned the label.
      }${metaRow(t("detail.meta.provenance"), item.credit)}${metaRow(t("detail.meta.tagged"), item.tags)}${
        licenseRow(item)
        // Actions, not metadata: grouped after a divider (.detail-actions).
        // sourceLinkLabel() rather than an inline lookup, so this and the
        // lightbox's link can't drift into naming the institution two ways.
      }<div class="detail-actions"><div class="detail-actions-row"><a class="source-link" href="${escapeHtml(item.url ?? "")}" target="_blank" rel="noopener"><span class="link-text">${escapeHtml(host.sourceLinkText(item))}</span><span class="link-arrow" aria-hidden="true">&rarr;</span></a>${citeButtonHtml(item)}<button class="btn-print" type="button" aria-expanded="false" hidden>${escapeHtml(t("detail.print.button"))}</button></div>${citePanelHtml(item)}<div class="print-panel" hidden></div></div>` +
      `</div>`
    );
  }

  private wireDetailContentInteractions(
    container: HTMLElement,
    item: Item,
    rewireFrame = true,
  ): void {
    const host = this.requireApp();
    const dFrame = container.querySelector<HTMLElement>(".d-frame");
    if (dFrame && rewireFrame) {
      // Always rendered together by buildDetailContentHtml, so guaranteed
      // present whenever dFrame is.
      const dSkeleton = dFrame.querySelector(".art-skeleton") as HTMLElement;
      const dImg = dFrame.querySelector("img") as HTMLImageElement;
      host.applyNudityGate(dFrame, item);
      const dImageState = host.wireArtworkImageState(
        dFrame,
        dSkeleton,
        dImg,
        item.img,
        item,
        "display",
      );
      on(dFrame, () => {
        if (dImageState.isFailed()) dImageState.retry();
      });
    }
    const shareBtn = container.querySelector<HTMLButtonElement>(".btn-share");
    if (shareBtn) on(shareBtn, () => host.shareItem(item));
    wireReportMenu(container, item, host);
    wireCite(container);
    wirePrint(container, item, host);

    const storylineChipBtn =
      container.querySelector<HTMLButtonElement>(".storyline-chip");
    if (storylineChipBtn) {
      const storyline = host.storylineFor(item);
      if (storyline) {
        on(storylineChipBtn, () => host.openStorylineMode(storyline.id));
      }
    }

    const setOfWorksChipBtn =
      container.querySelector<HTMLButtonElement>(".set-of-works-chip");
    if (setOfWorksChipBtn) {
      const setOfWork = host.setOfWorkFor(item);
      if (setOfWork) {
        on(setOfWorksChipBtn, () => host.openSetOfWorksMode(setOfWork.id));
      }
    }

    const artistBtn =
      container.querySelector<HTMLButtonElement>(".artist-link");
    if (artistBtn) {
      on(artistBtn, () => {
        // Explicitly navigating to the artist's filtered feed, so suppress
        // close()'s Discover-restore behavior rather than reopening it on
        // top of the requested view.
        this.openedFromShelves = false;
        this.close();
        host.setArtistFilter(item.artist ?? "");
      });
    }
    wireCastSection(container);
  }

  // Fetches the curated text for the page at `index` and its neighbours,
  // then re-renders each page that is still showing. The artwork frame is
  // carried over untouched so its image does not reload or flicker.
  private ensureDetail(index: number): void {
    const items = this.shelfItems ?? this.singleItem;
    if (!items) return;
    for (const at of [index, index + 1, index - 1]) {
      const item = items[at];
      const page = this.trackEl.children[at] as HTMLElement | undefined;
      if (!item || !page || item._detail) continue;
      const key = `${item.source}:${item.id}`;
      if (this.detailInFlight.has(key)) continue;
      this.detailInFlight.add(key);
      this.requireApp()
        .fetchItemDetail(item)
        .then((detail) => {
          item.caption_tea = detail.caption_tea;
          item.tea_voice_sources = detail.tea_voice_sources;
          item.cast = detail.cast;
          item.cast_context = detail.cast_context;
          item.twist_story = detail.twist_story;
          item.twist_source_url = detail.twist_source_url;
          item._detail = true;
          const inner = page.querySelector<HTMLElement>(".detail-modal-inner");
          if (inner?.isConnected) this.refreshPage(inner, item);
        })
        .catch((err) => {
          console.error("detail: curated text failed to load", err);
        })
        .finally(() => {
          this.detailInFlight.delete(key);
        });
    }
  }

  private refreshPage(inner: HTMLElement, item: Item): void {
    const frame = inner.querySelector<HTMLElement>(".d-frame");
    inner.innerHTML = this.buildDetailContentHtml(item);
    const fresh = inner.querySelector<HTMLElement>(".d-frame");
    if (frame && fresh) fresh.replaceWith(frame);
    this.wireDetailContentInteractions(inner, item, !frame);
  }

  private buildPage(item: Item): HTMLElement {
    const page = document.createElement("div");
    page.className = "detail-modal-page";
    const inner = document.createElement("div");
    inner.className = "detail-modal-inner";
    inner.innerHTML = this.buildDetailContentHtml(item);
    page.appendChild(inner);
    this.wireDetailContentInteractions(inner, item);
    return page;
  }

  // shelfContext (optional): the shelf's full qualifying-items list and the
  // tapped item's position. Omitted by every other caller, which keeps
  // behaving as before -- a single page, no position indicator, no nav.
  open(item: Item, shelfContext?: DetailShelfContext): void {
    const host = this.requireApp();
    // From a feed slide the item is already hydrated, but from a shelf
    // card or storyline chapter it may not be -- this panel renders fields
    // that live outside the manifest.
    if (!item._full) {
      host.hydrateItems([item]).then(() => this.open(item, shelfContext));
      return;
    }
    host.trackEvent("detail_view", {
      id: item.id,
      tea_voice_status: item.tea_voice_status,
    });

    // Tracked independently of `browsingShelf` below: even a single-item
    // shelf (no swipe nav) should return to Discover on close.
    this.openedFromShelves = !!shelfContext;

    const browsingShelf = !!(shelfContext && shelfContext.items.length > 1);
    this.shelfItems = browsingShelf && shelfContext ? shelfContext.items : null;
    this.singleItem = browsingShelf ? null : [item];

    this.trackEl.innerHTML = "";
    (browsingShelf && shelfContext ? shelfContext.items : [item]).forEach(
      (pageItem) => {
        this.trackEl.appendChild(this.buildPage(pageItem));
      },
    );

    this.classList.add("open");
    this.setAttribute("aria-hidden", "false");
    this.style.backgroundColor = "";

    if (browsingShelf && shelfContext) {
      this.shelfPositionEl.hidden = false;
      this.shelfPrevEl.hidden = false;
      this.shelfNextEl.hidden = false;
      // Instant, not smooth-scrolled -- this is the opening position, not
      // a user-triggered navigation.
      const targetPage = this.trackEl.children[shelfContext.index] as
        | HTMLElement
        | undefined;
      this.trackEl.scrollLeft = targetPage ? targetPage.offsetLeft : 0;
      this.updateShelfPosition(shelfContext.index);
      this.observeShelfTrack();
    } else {
      this.shelfPositionEl.hidden = true;
      this.shelfPrevEl.hidden = true;
      this.shelfNextEl.hidden = true;
      host.sampleArtworkColor(item, (tint) => {
        if (tint) this.style.backgroundColor = tint;
      });
      this.ensureDetail(0);
    }
    host.pushOverlayHistoryState("detail");
  }

  close(): void {
    this.classList.remove("open");
    this.setAttribute("aria-hidden", "true");
    this.shelfObserver?.disconnect();
    this.shelfObserver = null;
    this.shelfItems = null;
    this.singleItem = null;
    this.shelfIndex = 0;
    // Restore Discover if that's where this view came from -- shelvesMode
    // was only closed to make room for this panel, not because the user
    // asked to leave, and its DOM/scroll position was never touched.
    if (this.openedFromShelves) {
      this.openedFromShelves = false;
      this.requireApp().reopenShelvesMode();
    }
    // The other half of storyline-handoff-open: dispatched rather than a
    // direct call, since neither component owns the other.
    const handoff = this.storylineHandoff;
    this.storylineHandoff = null;
    if (handoff) {
      this.dispatchEvent(
        new CustomEvent<StorylineHandoffRestoreDetail>(
          "storyline-handoff-restore",
          { detail: handoff, bubbles: true },
        ),
      );
    }
  }
}

customElements.define("tranquilo-detail-modal", TranquiloDetailModal);
