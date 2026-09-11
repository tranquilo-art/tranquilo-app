// pages/about.html's "notify me about new features" form -- same
// api/subscribe.js endpoint as pro.html, tagged source: "feature_notify".
import { fieldWrap, isValidEmail } from "../utils/formValidation";
import "../analytics/cloudflareBeacon";

const form = document.getElementById("notifyForm") as HTMLFormElement;
const emailInput = document.getElementById("notifyEmail") as HTMLInputElement;
const submitBtn = document.getElementById(
  "notifySubmitBtn",
) as HTMLButtonElement;
const errorMsg = document.getElementById("notifyErrorMsg") as HTMLElement;
const success = document.getElementById("notifySuccess") as HTMLElement;

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const wrap = fieldWrap(form, "notifyEmail");
  const email = emailInput.value.trim();
  const valid = isValidEmail(email);
  wrap?.classList.toggle("error", !valid);
  if (!valid) return;

  errorMsg.classList.remove("show");
  submitBtn.disabled = true;
  submitBtn.textContent = "Joining…";

  fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, source: "feature_notify" }),
  })
    .then((res) => {
      if (!res.ok) throw new Error("subscribe failed");
      form.style.display = "none";
      success.style.display = "block";
    })
    .catch(() => {
      errorMsg.textContent =
        "Something went wrong — please try again in a moment.";
      errorMsg.classList.add("show");
      submitBtn.disabled = false;
      submitBtn.textContent = "Notify me";
    });
});
