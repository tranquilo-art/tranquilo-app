import { chromium } from "@playwright/test";

const LINKS = {
  "MONTHLY tier 1 (3 USD)":
    "https://buy.stripe.com/test_cNi7sM6Yy45z3Dx3226Ri02",
  "MONTHLY tier 2 (5 USD)":
    "https://buy.stripe.com/test_dRm14ofv4atX3Dx6ee6Ri04",
  "MONTHLY tier 3 (10 USD)":
    "https://buy.stripe.com/test_fZu8wQ6YycC5eibbyy6Ri05",
  "ONE-TIME (suggest 10 USD)":
    "https://buy.stripe.com/test_6oUcN6er0fOh8XReKK6Ri01",
};
const LOCS = ["BR", "US", "JP", "DE"];
const browser = await chromium.launch();
for (const [label, link] of Object.entries(LINKS)) {
  console.log(`\n######## ${label}`);
  for (const loc of LOCS) {
    const page = await browser.newPage();
    try {
      await page.goto(
        `${link}?prefilled_email=${encodeURIComponent(`test+location_${loc}@example.com`)}`,
        { waitUntil: "networkidle", timeout: 45000 },
      );
      await page.waitForTimeout(3500);
      const text = await page.evaluate(() => document.body.innerText);
      const amounts = [
        ...new Set(text.match(/(?:R\$|US\$|\$|€|£|¥)\s?[\d.,]+/g) || []),
      ].slice(0, 4);
      const curr = [...new Set(text.match(/\b(USD|BRL|JPY|EUR|GBP)\b/g) || [])];
      const rate = (text.match(/1 [A-Z]{3} = [\d.]+ [A-Z]{3}/) || ["—"])[0];
      const methods = ["Pix", "Boleto", "Card", "Link"].filter((m) =>
        new RegExp(`\\b${m}\\b`, "i").test(text),
      );
      // Adaptive Pricing is ON when a converted currency is offered alongside the base.
      const adaptive =
        /1 [A-Z]{3} = [\d.]+ [A-Z]{3}/.test(text) || curr.length > 1;
      console.log(
        `  ${loc}: ${String(amounts.join(" ")).padEnd(18)} | currencies: ${(curr.join("/") || "-").padEnd(9)} | rate: ${rate.padEnd(26)} | adaptive: ${adaptive ? "YES" : "no "} | ${methods.join(",")}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${loc}: FAILED ${message.split("\n")[0]}`);
    }
    await page.close();
  }
}
await browser.close();
