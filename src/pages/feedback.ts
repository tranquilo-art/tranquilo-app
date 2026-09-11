// pages/feedback.html's bug report / feedback form.
import {
  isNonEmpty,
  isValidEmail,
  setFieldError,
} from "../utils/formValidation";

const form = document.getElementById("feedbackForm") as HTMLFormElement;
const formSection = document.getElementById("formSection") as HTMLElement;
const formSuccess = document.getElementById("formSuccess") as HTMLElement;
const submitBtn = document.getElementById("submitBtn") as HTMLButtonElement;
const submitErrorMsg = document.getElementById("submitErrorMsg") as HTMLElement;
const messageEl = document.getElementById("message") as HTMLTextAreaElement;
const emailEl = document.getElementById("email") as HTMLInputElement;
const contextEl = document.getElementById("context") as HTMLInputElement;
const typeEl = document.getElementById("feedbackType") as HTMLSelectElement;

// Prefill "where were you" from the referrer, same-origin only -- a
// cross-origin referrer would leak somewhere the visitor was before
// Tranquilo. Path only, never the query string.
try {
  if (document.referrer) {
    const ref = new URL(document.referrer);
    if (ref.origin === window.location.origin) {
      contextEl.value = ref.pathname;
    }
  }
} catch (_e) {
  /* a referrer we cannot parse is simply not worth prefilling */
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  let valid = true;

  const messageOk = isNonEmpty(messageEl.value);
  setFieldError(form, "message", !messageOk);
  if (!messageOk) valid = false;

  // Blank is valid -- anonymity is a supported choice, not an error state.
  // Only a non-empty, malformed address fails.
  const emailValue = emailEl.value.trim();
  const emailOk = emailValue === "" || isValidEmail(emailValue);
  setFieldError(form, "email", !emailOk);
  if (!emailOk) valid = false;

  if (!valid) {
    const firstError = form.querySelector(".field.error");
    if (firstError)
      firstError.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  submitErrorMsg.classList.remove("show");
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";

  fetch("/api/submit-collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Shares a route with the collection-submit form: api/ is at
      // Vercel Hobby's 12-function cap.
      kind: "feedback",
      feedbackType: typeEl.value,
      message: messageEl.value.trim(),
      context: contextEl.value.trim(),
      email: emailValue,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      formSection.style.display = "none";
      formSuccess.classList.add("show");
      formSuccess.scrollIntoView({ behavior: "smooth", block: "center" });
    })
    .catch(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send feedback";
      // The written message is still sitting in the textarea, deliberately --
      // clearing the form on a network error would destroy the one thing the
      // person actually spent effort on.
      submitErrorMsg.textContent =
        "That didn't send. Your message is still here — try again in a moment.";
      submitErrorMsg.classList.add("show");
    });
});
