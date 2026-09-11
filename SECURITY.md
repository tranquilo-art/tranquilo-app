# Security Policy

At Tranquilo, we treat user privacy and system security as fundamental priorities. As a privacy-first public good platform, we appreciate the work of security researchers and community members who help us keep our platform and community safe.

---

## Data & System Scope

To help you evaluate potential vulnerabilities realistically, here is an overview of what Tranquilo handles:

* **Donations & Payment Data:** We accept voluntary donations through **Stripe**. All payment processing, cardholder data, and transaction security are handled directly by Stripe via secure checkout interfaces. Tranquilo never stores, transmits, or has access to raw credit card numbers or sensitive financial credentials.
* **Email Addresses:** Submitted collection forms, donation receipts, and waitlist signups collect real email addresses. Protecting user contact data is our highest priority.
* **Public Catalogue Metadata:** The artwork catalogue (`items` table) contains public-domain artwork metadata and contains no sensitive user data.
* **Anonymous Analytics:** We log anonymous, aggregated interaction metrics. We do not track or store IP addresses, user accounts, or persistent identifiers.
* **Credentials & Secrets:** All operational credentials (database connection strings, API keys for Stripe, Resend, Vercel, Neon, Sentry, etc.) are strictly managed server-side via environment configuration and are never exposed in repository code.

---

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public GitHub issue.**

1. Send an email to **mel@tranquilo.art** with details of the issue.
2. Include steps to reproduce the issue, a proof of concept, or supporting details where possible.

### What to Expect
* **Acknowledgment:** We aim to acknowledge receipt of all reports within **2–3 business days**.
* **Assessment & Fix:** We will review the report, assess the impact, and work on a fix as quickly as possible.
* **Credit:** While we do not operate a formal monetary bug-bounty program, we are deeply grateful for responsible disclosures and will happily credit you in our project release notes (with your permission) once the issue is resolved.

---

## In-Scope vs. Out-of-Scope

### In-Scope
* The live platform at [tranquilo.art](https://tranquilo.art).
* All serverless `/api/` endpoints hosted by Tranquilo (including webhook listeners and donation redirect flows).
* Source code in this repository.

### Out-of-Scope
* **Third-Party Providers:** Vulnerabilities in third-party infrastructure or payment gateways (such as Stripe, Vercel, Neon, Resend, Sentry, or API endpoints for partner institutions like The Met, Cleveland Museum of Art, Europeana, Smithsonian, or Wikimedia Commons). Please report issues with those platforms directly to their respective security teams.
* **Denial of Service (DoS/DDoS):** Volumetric, automated, or denial-of-service testing against `tranquilo.art` or third-party APIs is strictly prohibited. For any identified flaw, a minimal proof of concept with low traffic volume is sufficient.
* **Social Engineering:** Spam, phishing, or social engineering attacks against project maintainers or users.