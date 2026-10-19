import { pinchZoomAllowed, subscribePreferences } from "../settings/preferences";

/**
 * The zoom guard. On a phone or tablet the page keeps its own size: a stray pinch or a double tap never zooms it, so
 * a finger scrolling a list is never cut off by a page that zoomed under it. Each entry installs it once at startup,
 * and the Device setting "Let pinch zoom the page" turns it off. Each browser honours a different part, so it holds
 * the page in four ways:
 *
 * - The viewport meta's scale limits. Chrome on Android and a Home Screen app keep them. iOS Safari ignores them for
 *   a pinch, and still skips its zoom into a focused field because of them.
 * - `touch-action: pan-x pan-y` on every element while `<html>` has `data-zoom-guard` (design-tokens.css). A finger
 *   still scrolls, and a pinch or a double tap does nothing.
 * - Safari's `gesturestart`, `gesturechange` and `gestureend`, cancelled, which is what stops a pinch in iOS Safari.
 * - A `touchmove` with two fingers or more, cancelled.
 *
 * An element with `touch-action: none` handles its own fingers: the battle map and the atlas pinch to zoom, and every
 * drag surface takes a drag. The guard leaves their events alone. Fields are at least 16px on a touch screen
 * (design-tokens.css), because iOS also zooms into a focused field with smaller text.
 */

/** The viewport while the guard holds the page. Each HTML entry ships with it, so the page holds from first paint. */
export const HELD_VIEWPORT = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
/** The viewport while pinch zoom is on. */
export const FREE_VIEWPORT = "width=device-width, initial-scale=1";
/** A device with a touch screen. The 16px field floor in design-tokens.css uses the same query. */
export const TOUCH_SCREEN = "(any-pointer: coarse)";

const listening = { capture: true, passive: false } as const;

/** Whether `target` is inside an element that handles its own fingers. */
function ownsGestures(target: EventTarget | null): boolean {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement)
    if (getComputedStyle(node).touchAction === "none") return true;
  return false;
}

/** Holds the page at its own size until the returned function is called. */
export function installZoomGuard(): () => void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const shipped = meta?.content;
  let held = false;
  const apply = () => {
    const allowed = pinchZoomAllowed();
    // A page that is already zoomed in is let go until it is back at its own size, so it can always be pinched out.
    held = !allowed && (window.visualViewport?.scale ?? 1) <= 1.01;
    document.documentElement.toggleAttribute("data-zoom-guard", held);
    const content = allowed ? FREE_VIEWPORT : HELD_VIEWPORT;
    if (meta && meta.content !== content) meta.content = content;
  };
  const onGesture = (event: Event) => {
    if (held && !ownsGestures(event.target)) event.preventDefault();
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!held || event.touches.length < 2 || !event.cancelable) return;
    if (Array.from(event.touches).every((touch) => ownsGestures(touch.target))) return;
    event.preventDefault();
  };
  // A Mac's trackpad raises gesture events too, and a device without a touch screen keeps that pinch.
  const gestures = window.matchMedia?.(TOUCH_SCREEN).matches ? ["gesturestart", "gesturechange", "gestureend"] : [];

  apply();
  const unsubscribe = subscribePreferences(apply);
  window.visualViewport?.addEventListener("resize", apply);
  document.addEventListener("touchmove", onTouchMove, listening);
  for (const type of gestures) document.addEventListener(type, onGesture, listening);
  return () => {
    unsubscribe();
    window.visualViewport?.removeEventListener("resize", apply);
    document.removeEventListener("touchmove", onTouchMove, listening);
    for (const type of gestures) document.removeEventListener(type, onGesture, listening);
    document.documentElement.removeAttribute("data-zoom-guard");
    if (meta && shipped !== undefined) meta.content = shipped;
  };
}
