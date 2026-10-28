import { useLayoutEffect, useRef, type RefObject } from "react";
import { canMove, flipFrom, splitIn } from "./lightRail";

interface Seen {
  /** Each chip's box, relative to the strip, so a page that scrolled between two renders never reads as a move. */
  boxes: Map<Element, { x: number; y: number; w: number; h: number }>;
}

/**
 * A strip of chips (conditions, effects, live states), lit as it changes (ADR-0045, group 5). A chip that arrives after
 * the strip's first render settles in with the chroma split, and the chips that stay slide to their new places when one
 * arrives or leaves. A chip is new when its element is: React keeps the element of a chip whose key stays, so a label
 * that changes (Exhaustion 2 to 3) never counts as an arrival.
 */
export function useChipStrip(host: RefObject<HTMLElement | null>, selector = ":scope > .nh-chip"): void {
  const seen = useRef<Seen | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    const before = seen.current;
    const frame = el?.getBoundingClientRect();
    const boxes = new Map<Element, { x: number; y: number; w: number; h: number }>();
    if (el && frame)
      for (const chip of el.querySelectorAll(selector)) {
        const box = chip.getBoundingClientRect();
        boxes.set(chip, { x: box.left - frame.left, y: box.top - frame.top, w: box.width, h: box.height });
      }
    // A strip that renders nothing still counts as rendered, so its first chip arriving later settles in.
    seen.current = { boxes };
    if (!before || !frame || !canMove()) return;
    const changed = boxes.size !== before.boxes.size || [...boxes.keys()].some((chip) => !before.boxes.has(chip));
    if (!changed) return;
    for (const chip of boxes.keys()) {
      const was = before.boxes.get(chip);
      if (!was) splitIn(chip, { dur: 200 });
      else flipFrom(chip, new DOMRect(frame.left + was.x, frame.top + was.y, was.w, was.h));
    }
  });
}
