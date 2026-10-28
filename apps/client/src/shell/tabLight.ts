import { burst, canMove, comet, rel } from "@vtt/ui";

/**
 * Light running along a tab strip to a tab that has news (ADR-0045, groups 7 and 13): from the tab that is showing to
 * the one with something new, bursting there. `edge` is the strip's line: its bottom, or its top for bottom tabs.
 * `strip` must be positioned.
 */
export function tabTrip(
  strip: HTMLElement,
  from: Element | null,
  to: Element,
  edge: "top" | "bottom" = "bottom"
): void {
  if (!canMove()) return;
  const end = rel(to, strip);
  const start = from ? rel(from, strip).cx : end.cx;
  const line = edge === "bottom" ? strip.clientHeight - 1 : 1;
  comet(strip, { from: start, to: end.cx, line, thick: 3, delay: 0, dur: 230 });
  burst(strip, { at: end.cx, line, delay: 210, w: 90, h: 8 });
}
