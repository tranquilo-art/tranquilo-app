// The homepage's "Connect" card opens this to subscribe to the newsletter.
// Modeled directly on TranquiloSupportStrip.ts's dialog: a document-level
// singleton appended to <body> lazily on first open, not a custom element
// nested inside the intro slide -- the intro slide is a recycled feed
// slide (see slideRecords in src/app.ts), so anything living inside it can
// be torn down and rebuilt, but the dialog itself must not be.
//
// Posts to the same /api/subscribe endpoint as pages/about.html's "Notify
// me" form and pages/pro.html's waitlist, tagged with its own `source` so
// Resend segments can tell the three apart.

import { t } from "../i18n";
import { fieldWrap, isValidEmail } from "../utils/formValidation";
import { on } from "../utils/on";

const NEWSLETTER_SOURCE = "homepage_newsletter";

async function dialogHtml(): Promise<string> {
  const [title, body, emailLabel, emailPlaceholder, emailError, submit, close] =
    await Promise.all([
      t("newsletter.title"),
      t("newsletter.body"),
      t("newsletter.emailLabel"),
      t("newsletter.emailPlaceholder"),
      t("newsletter.emailError"),
      t("newsletter.submit"),
      t("newsletter.close"),
    ]);
  return `<div class="support-dialog-inner" role="document">
<button type="button" class="support-dialog-close" data-newsletter-close aria-label="${close}">&times;</button>
<h2 id="newsletterDialogTitle" class="support-dialog-title">${title}</h2>
<p class="support-dialog-body">${body}</p>
<form class="mkt-form" id="newsletterForm" novalidate>
<div class="field" data-field="newsletterEmail">
<label for="newsletterEmail">${emailLabel}</label>
<input type="email" id="newsletterEmail" name="newsletterEmail" placeholder="${emailPlaceholder}">
<div class="error-msg">${emailError}</div>
</div>
<button class="btn-primary block" type="submit" id="newsletterSubmitBtn">${submit}</button>
<p class="submit-error-msg" id="newsletterErrorMsg"></p>
</form>
<p class="form-note" id="newsletterSuccess" style="display:none;">${await t(
    "newsletter.success",
  )}</p>
</div>`;
}

let dialog: HTMLDivElement | null = null;
let lastFocused: Element | null = null;

function wireForm(form: HTMLFormElement): void {
  const emailInput = form.querySelector<HTMLInputElement>("#newsletterEmail");
  const submitBtn = form.querySelector<HTMLButtonElement>(
    "#newsletterSubmitBtn",
  );
  const errorMsg = dialog?.querySelector<HTMLElement>("#newsletterErrorMsg");
  const success = dialog?.querySelector<HTMLElement>("#newsletterSuccess");
  if (!emailInput || !submitBtn || !errorMsg || !success) return;

  on(form, "submit", async (e) => {
    e.preventDefault();
    const wrap = fieldWrap(form, "newsletterEmail");
    const email = emailInput.value.trim();
    const valid = isValidEmail(email);
    wrap?.classList.toggle("error", !valid);
    if (!valid) return;

    errorMsg.classList.remove("show");
    submitBtn.disabled = true;
    submitBtn.textContent = await t("newsletter.submitting");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: NEWSLETTER_SOURCE }),
      });
      if (!res.ok) throw new Error("subscribe failed");
      form.style.display = "none";
      success.style.display = "block";
    } catch {
      errorMsg.textContent = await t("newsletter.error");
      errorMsg.classList.add("show");
      submitBtn.disabled = false;
      submitBtn.textContent = await t("newsletter.submit");
    }
  });
}

async function ensureDialog(): Promise<HTMLDivElement> {
  if (dialog) return dialog;
  dialog = document.createElement("div");
  dialog.className = "support-dialog";
  dialog.id = "newsletterDialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "newsletterDialogTitle");
  dialog.setAttribute("aria-hidden", "true");
  dialog.innerHTML = await dialogHtml();
  document.body.appendChild(dialog);

  // Clicking the backdrop closes; clicking inside must not.
  on(dialog, (e) => {
    if (e.target === dialog) closeDialog();
  });
  const closeBtn = dialog.querySelector("[data-newsletter-close]");
  if (closeBtn) on(closeBtn, closeDialog);
  const form = dialog.querySelector<HTMLFormElement>("#newsletterForm");
  if (form) wireForm(form);
  return dialog;
}

async function openDialog(): Promise<void> {
  const el = await ensureDialog();
  lastFocused = document.activeElement;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  const first = el.querySelector<HTMLElement>("#newsletterEmail");
  if (first) first.focus();
}

function closeDialog(): void {
  if (!dialog) return;
  dialog.classList.remove("open");
  dialog.setAttribute("aria-hidden", "true");
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
}

on(document, "keydown", (e) => {
  if (e.key === "Escape" && dialog && dialog.classList.contains("open")) {
    closeDialog();
  }
});

// Delegated rather than bound to a specific button: the intro slide that
// hosts [data-open-newsletter] is a recycled feed slide and can be torn
// down and rebuilt (see buildIntroSlide() in src/feed/introSlides.ts).
on(document, "click", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest("[data-open-newsletter]")) {
    openDialog();
  }
});
