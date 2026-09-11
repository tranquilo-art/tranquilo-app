// Wires tap-to-reveal for every "ai-badge" disclosure button (next to an
// AI-drafted caption). One delegated listener, since the detail panel
// rebuilds per item and a per-render listener would leak. Only owns the
// aria-expanded state a tap toggles (visibility itself is CSS's job) and
// closes any open note on an outside click, exempting the note's own
// content so its mailto link stays followable.
export function wireAiDisclosureToggle(): void {
  document.addEventListener("click", (e: any) => {
    const badge = e.target.closest?.("[data-ai-disclosure]");
    if (badge) {
      e.preventDefault();
      const open = badge.getAttribute("aria-expanded") === "true";
      badge.setAttribute("aria-expanded", open ? "false" : "true");
      return;
    }
    if (e.target.closest?.("[data-ai-disclosure-text]")) return;
    const expanded = document.querySelectorAll(
      '[data-ai-disclosure][aria-expanded="true"]',
    );
    for (let i = 0; i < expanded.length; i++) {
      expanded[i].setAttribute("aria-expanded", "false");
    }
  });
}
