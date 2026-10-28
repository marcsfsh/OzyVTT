import { useLayoutEffect, useRef } from "react";
import { canMove, comet, edgeIn, fadeIn, ghostOut, rel } from "@vtt/ui";

/** Requests this device has already watched arrive, so a prompt that mounts again (a page change) doesn't replay it. */
const arrived = new Set<string>();

/**
 * A request reaching a player's phone and the answer going back (ADR-0045, group 12). Arriving, a comet runs in
 * along the horizon and the prompt rises with its top edge lit behind it. Answered, the prompt sinks away while its
 * edge drains back toward the GM. `id` names the request; nothing plays for a request this device has seen arrive.
 * Returns the refs for the prompt and its `OverlayEdge`.
 */
export function useRequestLight(id: string, on: boolean) {
  const prompt = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const card = prompt.current;
    const line = edge.current;
    if (!on || !card || !line) return;
    if (!arrived.has(id)) {
      arrived.add(id);
      if (canMove()) {
        const horizon = document.querySelector<HTMLElement>("[data-horizon]");
        if (horizon) {
          const box = rel(card, horizon);
          comet(horizon, { from: 0, to: box.cx, line: horizon.clientHeight - 1, thick: 3, delay: 0, dur: 230 });
        }
        fadeIn(card, { delay: 120, dur: 200, y: 12 });
        edgeIn(card, line, { sweep: "right" });
      }
    }
    // An unmount's cleanup runs while the prompt is still on the page, so its copy can sink where it was. It plays
    // only when the prompt left a list that stayed, so leaving the page plays nothing.
    return () => ghostOut(card, { leave: "sink", origin: "0%", whenGone: true, within: card.parentElement });
  }, [id, on]);
  return { prompt, edge };
}
