// A thin addEventListener wrapper. `click` is the most common listener in
// this codebase, so the two-argument form defaults to it; anything else
// names its event explicitly. The generic-string overload covers a
// CustomEvent name that isn't a key of HTMLElementEventMap.
export function on<K extends keyof HTMLElementEventMap>(
  elem: EventTarget,
  event: K,
  handler: (ev: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function on<E extends Event = Event>(
  elem: EventTarget,
  event: string,
  handler: (ev: E) => void,
  options?: boolean | AddEventListenerOptions,
): void;
export function on(elem: EventTarget, handler: (ev: Event) => void): void;
export function on(
  elem: EventTarget,
  eventOrHandler: string | ((ev: Event) => void),
  maybeHandler?: (ev: Event) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  if (typeof eventOrHandler === "function") {
    elem.addEventListener("click", eventOrHandler as EventListener);
  } else {
    elem.addEventListener(
      eventOrHandler,
      maybeHandler as EventListener,
      options,
    );
  }
}
