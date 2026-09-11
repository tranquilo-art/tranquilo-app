// Share links: URL construction for an artwork or a storyline, plus
// whichever share mechanism the device has (native share sheet on
// mobile, clipboard + toast otherwise).
//
// source defaults to "met" for pre-migration items that predate the
// `source` field, the same implicit-met convention used throughout the
// ingestion pipeline. See api/v/[slug].js, which resolves the same
// {source}-{native_id} slug server-side for link previews.
//
// /s/{id} rather than /v/{something} for storylines, since it's a
// different kind of object and should look like one in a pasted link.
// Server-side that path rewrites to slug "s-{id}" and reuses
// api/v/[slug].js rather than getting its own route (Vercel Hobby's
// 12-function cap).
export interface ShareServiceHost {
  trackEvent(name: string, props?: Record<string, unknown>): void;
  showToast(msg: string): void;
  encodeSlugId(source: string, rawId: string | number): string;
}

export class ShareService {
  // Below this, an AbortError can't be a person declining the share sheet
  // -- the sheet's own entry animation takes longer on every platform
  // that has one, well clear of instant rejections (single-digit ms).
  private static readonly SHARE_SHEET_MIN_DISMISS_MS = 300;

  constructor(private host: ShareServiceHost) {}

  shareUrlFor(item: { source?: string; id: string | number }): string {
    const source = item.source || "met";
    return `${location.origin}/v/${source}-${this.host.encodeSlugId(source, item.id)}`;
  }

  // encodeURIComponent is a no-op for today's lowercase hyphenated ids,
  // but present so a future hand-authored id with a space or apostrophe
  // can't repeat the same bug.
  storylineShareUrlFor(storyline: { id: string }): string {
    return `${location.origin}/s/${encodeURIComponent(storyline.id)}`;
  }

  // A mouse or trackpad, as opposed to a finger. Guarded since matchMedia
  // is absent in some embedded webviews, where treating the device as
  // touch avoids throwing inside a click handler.
  private hasFinePointer(): boolean {
    if (!window.matchMedia) return false;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  shareItem(item: {
    id: string | number;
    source?: string;
    title?: string;
    artist?: string;
  }): void {
    // The click/intent to share, not confirmed completion -- id + source
    // only, enough to build a "most-shared artwork" list via a join
    // against the catalogue later.
    this.host.trackEvent("share_click", { id: item.id, source: item.source });
    const title = item.title || "Untitled";
    const artist = item.artist && item.artist !== "Unknown" ? item.artist : "";
    this.shareLink(
      this.shareUrlFor(item),
      title,
      title + (artist ? ` — ${artist}` : ""),
    );
  }

  // A storyline is a different shareable object, not a different share
  // mechanism, so it routes through shareLink() below rather than a
  // second copy of the capability-detection branch.
  shareStoryline(storyline: {
    id: string;
    title: string;
    items: unknown[];
  }): void {
    this.host.trackEvent("share_click", { storyline_id: storyline.id });
    this.shareLink(
      this.storylineShareUrlFor(storyline),
      storyline.title,
      `${storyline.title} · ${storyline.items.length}-part storyline`,
    );
  }

  shareLink(url: string, title: string, text: string): void {
    let startedAt: number;
    // Desktop browsers can expose navigator.share and resolve it without
    // showing any sheet, so the branch is chosen by capability before
    // calling: a fine pointer means copy the link, which desktop wants
    // anyway. (hover: hover) AND (pointer: fine), not a width breakpoint,
    // since a touchscreen laptop is wide and coarse.
    if (navigator.share && !this.hasFinePointer()) {
      startedAt = Date.now();
      // try/catch as well as .catch(): navigator.share can throw
      // synchronously before returning a promise, in which case the
      // exception would otherwise escape this click handler.
      try {
        navigator
          .share({ title: title, text: text, url: url })
          .catch((err: unknown) => {
            // A real cancellation and a sheet that never opened both
            // reject as AbortError, so elapsed time separates them: the
            // sheet's entry animation takes longer than
            // SHARE_SHEET_MIN_DISMISS_MS, so a faster rejection means no
            // sheet was shown, falling through to the clipboard instead.
            const name = (err as { name?: string } | null)?.name;
            if (
              name === "AbortError" &&
              Date.now() - startedAt >= ShareService.SHARE_SHEET_MIN_DISMISS_MS
            )
              return;
            this.copyShareLink(url);
          });
      } catch (_err) {
        this.copyShareLink(url);
      }
      return;
    }
    this.copyShareLink(url);
  }

  // Always ends in a toast, success or failure -- a share control with no
  // feedback is indistinguishable from a broken one.
  copyShareLink(url: string): void {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          this.host.showToast("Link copied");
        })
        .catch(() => {
          this.host.showToast("Couldn't copy link");
        });
      return;
    }
    this.host.showToast("Couldn't copy link");
  }
}
