// pages/submit.html's "Submit a Collection" form.
//
// This is pages/submit.html's single entry point -- the Cloudflare beacon
// is a side-effect import rather than its own <script> tag, same pattern
// as src/app.ts's own imports.
import {
  clearFieldError,
  isNonEmpty,
  isValidEmail,
  isValidUrl,
  setFieldError,
} from "../utils/formValidation";
import "../analytics/cloudflareBeacon";

const form = document.getElementById("submitForm") as HTMLFormElement;
const licenseType = document.getElementById("licenseType") as HTMLSelectElement;
const licenseOtherField = document.getElementById(
  "licenseOtherField",
) as HTMLElement;
const confirmCheckbox = document.getElementById(
  "confirmLicense",
) as HTMLInputElement;
const confirmError = document.getElementById("confirmError") as HTMLElement;
const formSection = document.getElementById("formSection") as HTMLElement;
const formSuccess = document.getElementById("formSuccess") as HTMLElement;
const submitBtn = document.getElementById("submitBtn") as HTMLButtonElement;
const submitErrorMsg = document.getElementById("submitErrorMsg") as HTMLElement;

licenseType.addEventListener("change", () => {
  const showOther = licenseType.value === "Other";
  licenseOtherField.style.display = showOther ? "block" : "none";
  if (!showOther) clearFieldError(form, "licenseOther");
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  let valid = true;

  const required = [
    "collectionName",
    "submitterName",
    "collectionLink",
    "licenseType",
    "licenseVerificationLink",
    "description",
  ];
  required.forEach((name) => {
    const el = document.getElementById(name) as HTMLInputElement;
    const ok = isNonEmpty(el.value);
    setFieldError(form, name, !ok);
    if (!ok) valid = false;
  });

  const submitterEmailEl = document.getElementById(
    "submitterEmail",
  ) as HTMLInputElement;
  const emailOk = isValidEmail(submitterEmailEl.value);
  setFieldError(form, "submitterEmail", !emailOk);
  if (!emailOk) valid = false;

  const collectionLinkEl = document.getElementById(
    "collectionLink",
  ) as HTMLInputElement;
  const linkOk = isValidUrl(collectionLinkEl.value);
  if (isNonEmpty(collectionLinkEl.value)) {
    setFieldError(form, "collectionLink", !linkOk);
    if (!linkOk) valid = false;
  }

  const licenseVerificationLinkEl = document.getElementById(
    "licenseVerificationLink",
  ) as HTMLInputElement;
  const verifyLinkOk = isValidUrl(licenseVerificationLinkEl.value);
  if (isNonEmpty(licenseVerificationLinkEl.value)) {
    setFieldError(form, "licenseVerificationLink", !verifyLinkOk);
    if (!verifyLinkOk) valid = false;
  }

  if (licenseType.value === "Other") {
    const licenseOtherEl = document.getElementById(
      "licenseOther",
    ) as HTMLInputElement;
    const otherOk = isNonEmpty(licenseOtherEl.value);
    setFieldError(form, "licenseOther", !otherOk);
    if (!otherOk) valid = false;
  }

  const confirmOk = confirmCheckbox.checked;
  confirmError.style.display = confirmOk ? "none" : "block";
  if (!confirmOk) valid = false;

  if (!valid) {
    const firstError = form.querySelector(".field.error, .field-check.error");
    if (firstError)
      firstError.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  submitErrorMsg.classList.remove("show");
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  const payload = {
    collectionName: (
      document.getElementById("collectionName") as HTMLInputElement
    ).value.trim(),
    submitterName: (
      document.getElementById("submitterName") as HTMLInputElement
    ).value.trim(),
    submitterEmail: submitterEmailEl.value.trim(),
    collectionLink: collectionLinkEl.value.trim(),
    licenseType: licenseType.value,
    licenseOther: (
      document.getElementById("licenseOther") as HTMLInputElement
    ).value.trim(),
    licenseVerificationLink: licenseVerificationLinkEl.value.trim(),
    description: (
      document.getElementById("description") as HTMLTextAreaElement
    ).value.trim(),
    estimatedSize: (
      document.getElementById("estimatedSize") as HTMLInputElement
    ).value.trim(),
    // Sent purely so it appears in the notification email -- the actual
    // list signup is the separate /api/subscribe call below.
    newsletterOptIn: (
      document.getElementById("newsletterOptIn") as HTMLInputElement
    ).checked,
  };

  const newsletterOptIn = payload.newsletterOptIn;

  fetch("/api/submit-collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) throw new Error("submit failed");
      formSection.style.display = "none";
      formSuccess.classList.add("show");
      formSuccess.scrollIntoView({ behavior: "smooth", block: "start" });

      // Best-effort, not blocking: the submission above already
      // succeeded, so a failure here just doesn't add them to the list.
      if (newsletterOptIn) {
        fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: payload.submitterEmail,
            source: "newsletter_submit",
          }),
        })
          .then((res) => {
            // fetch only rejects on a network error -- a 422/500 resolves
            // normally, so without this check a server-side failure was
            // completely silent.
            if (!res.ok)
              throw new Error(`subscribe returned HTTP ${res.status}`);
          })
          .catch((err) => {
            console.error("newsletter opt-in failed", err);
          });
      }
    })
    .catch(() => {
      submitErrorMsg.textContent =
        "Something went wrong sending this — please try again in a moment.";
      submitErrorMsg.classList.add("show");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit for review";
    });
});
