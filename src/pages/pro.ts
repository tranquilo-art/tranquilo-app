// pages/pro.html's Pro waitlist form -- posts to api/subscribe.js, tagged
// source: "pro_waitlist". Cloudflare beacon is a side-effect import
// rather than its own <script> tag.
import { fieldWrap, isValidEmail } from "../utils/formValidation";
import "../analytics/cloudflareBeacon";

const form = document.getElementById("waitlistForm") as HTMLFormElement;
const emailInput = document.getElementById("waitlistEmail") as HTMLInputElement;
const section = document.getElementById("waitlistSection") as HTMLElement;
const success = document.getElementById("waitlistSuccess") as HTMLElement;
const submitBtn = document.getElementById(
  "waitlistSubmitBtn",
) as HTMLButtonElement;
const errorMsg = document.getElementById("waitlistErrorMsg") as HTMLElement;

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const wrap = fieldWrap(form, "waitlistEmail");
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
    body: JSON.stringify({ email: email, source: "pro_waitlist" }),
  })
    .then((res) => {
      if (!res.ok) throw new Error("subscribe failed");
      section.style.display = "none";
      success.style.display = "block";
    })
    .catch(() => {
      errorMsg.textContent =
        "Something went wrong — please try again in a moment.";
      errorMsg.classList.add("show");
      submitBtn.disabled = false;
      submitBtn.textContent = "Join the waitlist";
    });
});
