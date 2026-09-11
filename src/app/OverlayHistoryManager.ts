// All seven overlays are pure classList/flag show-hide with no
// browser-history entry by default, so back would otherwise exit the app
// entirely instead of closing one. Each open function calls push(); the
// popstate listener attach() registers is the single place that runs the
// real close logic, the same functions the close buttons and Escape
// already use. A single flat depth counter is enough since the overlays
// are mutually exclusive -- none opens on top of another.
export interface OverlayHistoryHost {
  detailModalEl: {
    classList: DOMTokenList;
    close(): void;
    isReturningToShelves?: boolean;
  };
  shelvesModeEl: { classList: DOMTokenList; close(): void };
  storylineModeEl: { classList: DOMTokenList; close(): void };
  setOfWorksModeEl: { classList: DOMTokenList; close(): void };
  lightboxEl: { classList: DOMTokenList; close(): void };
  exportModalEl: { classList: DOMTokenList; close(): void };
  isSearchOpen(): boolean;
  closeSearch(): void;
}

export class OverlayHistoryManager {
  private depth = 0;

  constructor(private host: OverlayHistoryHost) {}

  push(name: string): void {
    this.depth++;
    history.pushState({ overlay: name }, "", location.href);
  }

  // Routes an explicit close through history.back() instead of calling
  // closeFn directly, whenever a state was pushed for the open overlay --
  // otherwise the pushed entry is left stranded and the user's next back
  // press silently consumes it instead of navigating anywhere.
  requestClose(closeFn: () => void): void {
    if (this.depth > 0) {
      history.back();
    } else {
      closeFn();
    }
  }

  // For closes that are a side effect of switching views rather than an
  // explicit "close this" action -- these callers depend on closeFn's
  // side effects landing synchronously before their own re-render runs,
  // so the close can't be deferred behind history.back(). Runs closeFn()
  // immediately, then separately pops the stray history entry. Only safe
  // for overlays whose close never reopens a sibling (closeDetailModal
  // does, which is why it always goes through requestClose instead).
  closeSync(closeFn: () => void): void {
    closeFn();
    if (this.depth > 0) {
      history.back();
    }
  }

  attach(): void {
    window.addEventListener("popstate", this.handlePopstate);
    document.addEventListener("keydown", this.handleKeydown);
  }

  private handlePopstate = (): void => {
    if (this.depth > 0) {
      this.depth--;
    }
    const {
      detailModalEl,
      shelvesModeEl,
      storylineModeEl,
      setOfWorksModeEl,
      lightboxEl,
      exportModalEl,
    } = this.host;
    // Snapshot before closing anything: detailModalEl.close() may reopen
    // shelvesMode (openedFromShelves) as part of its normal behavior, and
    // that reopen must not be undone by this same event -- else-if on the
    // pre-close state is what keeps one back press closing one overlay.
    const wasDetailOpen = detailModalEl.classList.contains("open");
    const wasShelvesOpen = shelvesModeEl.classList.contains("open");
    const wasStorylineOpen = storylineModeEl.classList.contains("open");
    const wasSetOfWorksOpen = setOfWorksModeEl.classList.contains("open");
    const wasLightboxOpen = lightboxEl.classList.contains("open");
    const wasExportOpen = exportModalEl.classList.contains("open");
    const wasSearchOpen = this.host.isSearchOpen();
    // Checked in real visual stacking order, topmost first. More than one
    // can be flagged "open" at once by design (e.g. shelf -> detail modal
    // -> storyline chip leaves both flagged), so topmost-first means one
    // press always closes what the user can see, leaving the rest for
    // the next press.
    if (wasLightboxOpen) {
      lightboxEl.close();
    } else if (wasStorylineOpen) {
      storylineModeEl.close();
    } else if (wasSetOfWorksOpen) {
      setOfWorksModeEl.close();
    } else if (wasShelvesOpen) {
      shelvesModeEl.close();
    } else if (wasDetailOpen) {
      detailModalEl.close();
    } else if (wasExportOpen) {
      exportModalEl.close();
    } else if (wasSearchOpen) {
      this.host.closeSearch();
    }
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    const {
      detailModalEl,
      shelvesModeEl,
      storylineModeEl,
      setOfWorksModeEl,
      lightboxEl,
      exportModalEl,
    } = this.host;
    const overlayOpen =
      detailModalEl.classList.contains("open") ||
      shelvesModeEl.classList.contains("open") ||
      storylineModeEl.classList.contains("open") ||
      setOfWorksModeEl.classList.contains("open") ||
      lightboxEl.classList.contains("open") ||
      exportModalEl.classList.contains("open") ||
      this.host.isSearchOpen();
    if (overlayOpen && this.depth > 0) {
      // Closes exactly one overlay, same as a single close-button press.
      history.back();
      return;
    }
    // Fallback cleanup only -- nothing tracked as open, or a depth/state
    // desync. Direct calls are idempotent no-ops for whatever isn't open.
    //
    // Captured before detailModalEl.close() runs (which clears its own
    // flag while restoring Discover) -- otherwise the unconditional
    // shelvesModeEl.close() below would immediately undo that restoration.
    const wasReturningToShelves = detailModalEl.isReturningToShelves;
    detailModalEl.close();
    storylineModeEl.close();
    setOfWorksModeEl.close();
    if (!wasReturningToShelves) {
      shelvesModeEl.close();
    }
    lightboxEl.close();
    exportModalEl.close();
    if (this.host.isSearchOpen()) {
      this.host.closeSearch();
    }
  };
}
