// Ambient music playback, as a native custom element.
//
// Music bucket content moved to Postgres, so app.js fetches it once at
// feed-init time and hands it over as plain properties
// (musicBuckets/categoryToBucket below) rather than this file reading
// them as shared top-level consts, since it can no longer be computed
// synchronously at module-eval time once it's a fetch.
//
// The music toggle button lives inside <tranquilo-topbar> -- this
// component owns everything behind it: the two crossfaded <audio>
// elements, the fade animation, which bucket the visible category maps
// to, the IntersectionObserver tracking that, and the credit line. app.js
// mediates: topbarEl.app.onMusicToggle calls this element's toggle() and
// forwards the result, since neither component reaches into the other.
//
// app.js still owns the feed, so it calls observeSlides() when the
// feed's slides change (initial render, pagination).
import type { Category } from "../types/Item";
import type { MusicBucket, MusicBucketKey } from "../types/MusicBucket";

const MUSIC_KEY = "tranquilo:musicOn";
const MUSIC_FADE_MS = 1200;

export class TranquiloMusicToggle extends HTMLElement {
  // Set once by app.js's init, before observeSlides() is ever called --
  // empty objects here are a safe default for the window before that
  // assignment, never actually read since applyMusicForCategory() only
  // runs from an IntersectionObserver callback that fires well after.
  musicBuckets: Record<MusicBucketKey, MusicBucket> = {} as Record<
    MusicBucketKey,
    MusicBucket
  >;
  categoryToBucket: Record<Category, MusicBucketKey> = {} as Record<
    Category,
    MusicBucketKey
  >;

  private linkEl!: HTMLAnchorElement;

  // Persisted "on" still can't autoplay on a fresh load, since there's no
  // user gesture yet and .play() would be silently blocked. Playback
  // stays locked until toggle() is called at least once this page load,
  // regardless of the persisted preference.
  private on = false;
  private unlocked = false;

  private audioA = new Audio();
  private audioB = new Audio();
  private activeAudio: HTMLAudioElement = this.audioA;
  private inactiveAudio: HTMLAudioElement = this.audioB;
  // The MUSIC_BUCKETS key currently playing/targeted.
  private currentBucketKey: MusicBucketKey | null = null;
  // Kept up to date regardless of `on`, so turning music on mid-scroll
  // starts the right bucket immediately instead of whatever was visible
  // at load.
  private currentVisibleCategory: Category | null = null;
  private fadeRaf: number | null = null;
  private observer: IntersectionObserver | null = null;

  get isOn(): boolean {
    return this.on;
  }

  connectedCallback(): void {
    this.classList.add("music-credit");
    this.setAttribute("id", "musicCredit");
    if (this.getAttribute("data-music-toggle-mounted") === "1") return;
    this.setAttribute("data-music-toggle-mounted", "1");

    this.innerHTML =
      '<a id="musicCreditLink" href="#" target="_blank" rel="noopener"></a>';
    this.linkEl = this.querySelector("a") as HTMLAnchorElement;

    [this.audioA, this.audioB].forEach((a) => {
      a.loop = true;
      a.preload = "none";
      a.volume = 0;
    });

    this.on = localStorage.getItem(MUSIC_KEY) === "true";
  }

  // Only ever called from the toggle button's click handler -- returns
  // the new on/off state so app.js can sync setMusicActive() and report
  // the analytics event, neither of which this element can do itself.
  toggle(): boolean {
    this.unlocked = true;
    this.setOn(!this.on);
    return this.on;
  }

  private setOn(on: boolean): void {
    this.on = on;
    localStorage.setItem(MUSIC_KEY, on ? "true" : "false");
    if (on) {
      this.currentBucketKey = null; // force a re-apply even if it happens to equal the stale value
      this.applyMusicForCategory(this.currentVisibleCategory);
    } else {
      this.stopFade();
      this.audioA.pause();
      this.audioB.pause();
      this.audioA.volume = 0;
      this.audioB.volume = 0;
      this.currentBucketKey = null;
      this.updateCredit(null);
    }
  }

  // One shared observer, fully re-targeted on every call -- disconnecting
  // before re-observing means it never keeps a stale reference to a
  // slide renderFeed() has since removed.
  observeSlides(feedEl: HTMLElement): void {
    if (this.observer) this.observer.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        // A plain loop, not forEach -- TS can't carry `best`'s narrowing
        // across a callback boundary.
        for (const entry of entries) {
          // Only slides tagged with a category are eligible -- the intro
          // slide has none, so whatever's playing keeps playing through it.
          const category = (entry.target as HTMLElement).dataset.category;
          if (
            entry.isIntersecting &&
            category &&
            (!best || entry.intersectionRatio > best.intersectionRatio)
          ) {
            best = entry;
          }
        }
        if (best) {
          this.onVisibleCategoryChange(best.target as HTMLElement);
        }
      },
      { root: feedEl, threshold: 0.6 },
    );

    feedEl.querySelectorAll("[data-category]").forEach((slide) => {
      this.observer?.observe(slide);
    });
  }

  private onVisibleCategoryChange(slide: HTMLElement): void {
    const category = slide.dataset.category as Category;
    this.currentVisibleCategory = category;
    if (!this.on || !this.unlocked) return;
    this.applyMusicForCategory(category);
  }

  private applyMusicForCategory(category: Category | null): void {
    const key = (category && this.categoryToBucket[category]) || null;
    if (key === this.currentBucketKey) return; // already playing/targeting this bucket
    const bucket = key ? this.musicBuckets[key] : null;
    // A bucket that exists but has no track sourced yet doesn't fade to
    // silence -- whatever's playing keeps playing uninterrupted.
    // currentBucketKey deliberately doesn't advance to this trackless
    // bucket's key, staying pointed at whatever's actually audible, so
    // scrolling back into it later is correctly a no-op. Distinct from
    // `bucket` being null (the intro slide), which still falls through to
    // fadeToMusicBucket(null) below.
    if (bucket && !bucket.track) return;
    this.currentBucketKey = key;
    this.fadeToMusicBucket(bucket);
  }

  // Fades `outgoing` down while fading `incoming` up to the new bucket's
  // track, then swaps which element is "active." `bucket` may be null
  // (the intro slide) or have a null track, either way fading to
  // silence -- but applyMusicForCategory() never calls this for the
  // "exists but no track yet" case, so in practice only the intro slide
  // fades to silence.
  private fadeToMusicBucket(bucket: MusicBucket | null): void {
    this.stopFade();
    this.updateCredit(bucket);

    const outgoing = this.activeAudio;
    const incoming = this.inactiveAudio;
    const hasTrack = !!bucket?.track;

    if (hasTrack) {
      const track = (bucket as MusicBucket).track as string;
      if (incoming.src !== track) incoming.src = track;
      incoming.volume = 0;
      const playPromise = incoming.play();
      if (playPromise?.catch) {
        playPromise.catch(() => {
          /* blocked or interrupted -- ignore, nothing to recover */
        });
      }
    }

    const start = performance.now();
    const outgoingStartVolume = outgoing.volume;
    const step = (now: number): void => {
      // Clamped on both ends: the first rAF timestamp can land marginally
      // before the synchronous performance.now() capture above, which
      // without the lower clamp once sent a negative volume into
      // HTMLMediaElement.volume and threw mid-fade.
      const t = Math.max(0, Math.min(1, (now - start) / MUSIC_FADE_MS));
      outgoing.volume = outgoingStartVolume * (1 - t);
      if (hasTrack) incoming.volume = t;
      if (t < 1) {
        this.fadeRaf = requestAnimationFrame(step);
        return;
      }
      outgoing.pause();
      outgoing.volume = 0;
      if (!hasTrack) {
        incoming.pause();
        incoming.volume = 0;
      }
      this.activeAudio = incoming;
      this.inactiveAudio = outgoing;
    };
    step(start);
  }

  private updateCredit(bucket: MusicBucket | null): void {
    if (!bucket?.track) {
      this.classList.remove("show");
      return;
    }
    this.linkEl.href = bucket.creditUrl as string;
    this.linkEl.textContent = `${bucket.credit} · ${bucket.license}`;
    this.classList.add("show");
  }

  private stopFade(): void {
    if (this.fadeRaf) {
      cancelAnimationFrame(this.fadeRaf);
      this.fadeRaf = null;
    }
  }
}

customElements.define("tranquilo-music-toggle", TranquiloMusicToggle);
