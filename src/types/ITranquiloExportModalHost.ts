// The host contract <tranquilo-export-modal> talks to
// (`exportModalEl.app = {...}`). Purely a static confirmation with no
// dynamic content, so its host is just the shared overlay-history
// mechanism every other overlay uses.
export interface ITranquiloExportModalHost {
  // Pushes one history entry on open so the hardware back button closes it
  // instead of leaving the app; requestOverlayClose routes an explicit
  // close through history.back() when an entry is pending.
  pushOverlayHistoryState(name: string): void;
  requestOverlayClose(closeFn: () => void): void;
}
