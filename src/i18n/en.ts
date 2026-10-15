// English dictionary. Keys are flat dot-paths; values support `{name}`
// interpolation. Missing keys fall back to English at lookup time, so a
// half-translated dictionary still resolves.

export const en = {
  // Newsletter modal
  "newsletter.title": "Enjoy a monthly art moment",
  "newsletter.body": "A monthly note with curated art. No spam.",
  "newsletter.emailLabel": "Email",
  "newsletter.emailPlaceholder": "you@example.com",
  "newsletter.emailError": "Please enter a valid email address.",
  "newsletter.submit": "Subscribe",
  "newsletter.submitting": "Joining…",
  "newsletter.success": "You're on the list — look out for our next note.",
  "newsletter.error": "Something went wrong — please try again in a moment.",
  "newsletter.close": "Close",

  // Upsell toast — kept for future conversion, not yet wired up.
  "upsellToast.body":
    "Saved temporarily in this browser. Permanent collections and organization are part of Pro, still taking shape.",
  "upsellToast.joinWaitlist": "Join the waitlist",
  "upsellToast.dismiss": "Dismiss",

  // Example interpolation key — demonstrates the {name} mechanism.
  "greeting": "Hello, {name}!",
} as const;

export type TranslationKey = keyof typeof en;
export type TranslationValue = (typeof en)[TranslationKey];
