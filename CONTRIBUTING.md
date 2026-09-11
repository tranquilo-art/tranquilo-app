# Contributing to Tranquilo

Thank you for taking the time to contribute to Tranquilo! 🌿

Tranquilo is a privacy-first, ad-free digital space designed as a calm, 
anti-scrolling alternative for exploring public domain art. Because this 
project serves as a public good, we value code that is intentional, 
lightweight, and respectful of both user privacy and the cultural 
institutions that host these artworks.

Whether you're fixing a bug, improving accessibility, or refining 
our ingestion pipeline, we are glad you're here.

## A Note on Maintainership & Reviews

Tranquilo is a design-led project. It is maintained by Mel, a founder with 
a product and UX background, with technical guidance from Sam, a senior 
infrastructure engineer who advises on backend architecture in his limited 
spare time around a full-time job.

There could be a brief lag time around code reviews.

You can help us review your work faster by including:
* **Clear PR descriptions:** Explain *what* changed and *why*.
* **Visuals:** Add screenshots or screen recordings for UI/UX changes.
* **Testing context:** Share your local test results and any steps needed to verify the fix.

Detailed, well-tested PRs make async reviews significantly easier for us to evaluate and merge!

## How to Contribute

* **For small fixes:** Typo corrections, documentation updates, or straightforward bug 
fixes with existing test coverage can be submitted directly via Pull Request.

* **For new features or structural changes:** Please open an issue first 
to discuss your idea. Tranquilo’s architecture includes intentional constraints, 
often built around past performance measurements or API rate limits. 
Discussing changes beforehand helps ensure your time is spent effectively 
and aligns with the project's roadmap.

## Local Environment Setup
You don't need live database keys or institution API credentials to 
develop or test most features. Our test suites are fully offline and use 
local fixtures (like `tests/fixtures/e2e-items.json` standing in for `/api/items`).

* **Static Site & Serverless Functions:**
  ```bash
  bun install    # Install dependencies and test tooling
  bun run dev    # Start the local server (compiles src/ to js/)
  ```

* **Python Ingestion Pipeline:**
  ```bash
  uv sync --project python
  ```

See `.env.example` for the full list of environment variables the project uses.

## Running Tests & Formatting

We rely on offline, deterministic test suites to verify logic without hitting live APIs. The JavaScript suites must pass locally before merging:

```bash
bunx vitest run          # JS & logic unit tests
bunx playwright test     # End-to-end tests (stubbed backend, real browser)
bun run test:all         # Run both JS test suites
```

The ingestion pipeline's own test suite runs from its own branch/repo.

**Note on CI:** Please run test suites locally prior to opening a PR. Due to free-tier usage limits on GitHub Actions, local runs are our primary ground truth for test status.

## Key Architectural & Design Conventions
To keep the codebase maintainable and performant, please keep these guidelines in mind:
* Vite Build Model: HTML entry points (index.html, pages/*.html) reference TypeScript sources directly. Running vite build bundles these into dist/ for live deployments.
* Serverless Caps (/api/): We host on Vercel's Hobby plan, which enforces a strict limit of 12 serverless functions (we currently use 10). Never create a 13th file in /api/. Shared utility logic belongs in lib/, and scheduled jobs should be added as new cron entries in vercel.json pointing to api/cron/index.ts.
* Test-Driven Intent: Write tests that assert key behaviors and invariants rather than exact string matches or volatile internal implementation details.
* Preserve Context in Comments: Comments in this repository often contain historical context regarding specific edge cases or performance tradeoffs. If your PR alters behavior described in a comment, please update or remove the comment to match the new implementation.
* Respect Institution Rate Limits: Never perform bulk API requests against third-party institution endpoints (e.g., The Met, Cleveland Museum of Art, Smithsonian, Wikimedia Commons). Ingestion adapters must always be tested against offline local fixtures.
* Protect Analytics Data: Ensure local or automated browser testing blocks the Cloudflare analytics beacon to prevent artificial traffic spikes in production metrics.

## Scope of Contributions & Catalogue Curation

Tranquilo is a tightly curated public-good platform. To maintain strict standards around image licensing, artwork provenance, and editorial quality, **catalogue ingestion and data curation are managed exclusively by the core maintainers.**

* **What we welcome:** Bug fixes, UI/UX improvements, accessibility enhancements, performance optimizations, and test coverage.
* **What is off-limits:** Pull Requests that add new artwork batch files, alter live database content, or modify automated ingestion pipelines without prior maintainer approval.


## Community, Licensing & Security
* Community Standards: We are committed to maintaining a welcoming, respectful, and calm environment for everyone. Please ensure all interactions in issues and PRs remain constructive and kind.
* Licensing: By contributing, you agree that your code will be licensed under AGPL-3.0-or-later (see LICENSE). If incorporating external code or data, ensure its license is strictly compatible with our catalogue licensing guidelines (detailed in README.md).
* Security: Please do not open public issues for security vulnerabilities. Review our SECURITY.md for instructions on responsible disclosure.

## Thank you!
* If you made it this far, thank you and we look forward to working with you. Feedback welcome on how 
we can make contributing a rewarding experience.