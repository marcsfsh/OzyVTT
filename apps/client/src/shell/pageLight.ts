import { burst, canMove, comet, fadeIn, rel, wash } from "@vtt/ui";

/** Pane children that are not the page: the GM's calls for a roll ride along, and the light's own parts. */
const NOT_THE_PAGE = ".roll-call-dock, .lr-part";

/**
 * A change of section (ADR-0045, Change page). The sections' ink drains and fills in their own strip; this runs the
 * trip along the horizon, the top bar's bottom line, from the old section's x to the new one's, with a burst where it
 * lands. A wash falls onto the pane as the page fades in. On a phone the sections are the bottom tabs, and the light
 * still runs along the horizon at the top, at the tapped tab's x: the horizon is the first bar marked
 * `data-horizon` (the top bar, a player's identity bar or Play's strip on a phone).
 */
export function pageLight(from: HTMLElement, to: HTMLElement): void {
  if (!canMove()) return;
  const frame = to.closest("main") ?? document;
  const horizon = frame.querySelector<HTMLElement>("[data-horizon]");
  if (horizon) {
    const line = horizon.clientHeight - 1;
    const landsAt = rel(to, horizon).cx;
    comet(horizon, { from: rel(from, horizon).cx, to: landsAt, line });
    burst(horizon, { at: landsAt, line });
  }
  const pane = frame.querySelector<HTMLElement>(".app-pane");
  if (!pane) return;
  wash(pane, { at: rel(to, pane).cx, top: 0, h: pane.clientHeight * 0.6 });
  // A page whose root is `.anim-view` fades in through styles.css; any other page fades here. Opacity only: a
  // transform on the pane's child would trap every fixed overlay.
  for (const child of pane.children) {
    if (child.matches(NOT_THE_PAGE) || child.classList.contains("anim-view")) continue;
    const position = getComputedStyle(child).position;
    if (position !== "absolute" && position !== "fixed") fadeIn(child);
  }
}
