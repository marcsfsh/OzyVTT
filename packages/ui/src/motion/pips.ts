import type { RefObject } from "react";
import { useOnChange } from "./hooks";
import { canMove, pop, rel, warm } from "./lightRail";

/**
 * Pips and boxes for uses, slots, hit dice and exhaustion (ADR-0045, groups 8 and 16). Spending one cools it with a
 * short afterglow; getting them back (a rest) relights them in order, each with a small burst. `lit` is how many are
 * lit, from the first; `host` is positioned and holds the pips.
 */
export function usePipLight(
  host: RefObject<HTMLElement | null>,
  lit: number,
  o: Readonly<{ pip?: string; glow?: string; tone?: "gold" | "cyan" | "red" }> = {}
): void {
  useOnChange(lit, (before, now) => {
    const el = host.current;
    if (!el || before === now || !canMove()) return;
    const pips = [...el.querySelectorAll<HTMLElement>(o.pip ?? ":scope > i")];
    if (now < before) {
      for (const pip of pips.slice(now, before))
        // No end keyframe: the pip holds its glow, then settles to how the stylesheet paints a spent one.
        pip.animate(
          [
            { offset: 0, boxShadow: o.glow ?? "var(--use-afterglow)" },
            { offset: 0.2, boxShadow: o.glow ?? "var(--use-afterglow)" }
          ],
          { duration: 320, easing: "ease-out" }
        );
      return;
    }
    pips.slice(before, now).forEach((pip, index) => {
      const delay = index * 60;
      warm(pip, { delay });
      const box = rel(pip, el);
      pop(el, { x: box.cx, y: box.cy, size: Math.max(20, box.w * 2.4), delay, tone: o.tone ?? "gold" });
    });
  });
}
