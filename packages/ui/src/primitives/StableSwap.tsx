import type { ReactNode } from "react";
import "./StableSwap.css";

export interface StableSwapProps {
  /** The text actually being shown right now. */
  current: ReactNode;
  /** The text this control shows in its OTHER state. Reserved, never read, never displayed. */
  alternate: string;
  className?: string;
}

/**
 * D23c — a control whose LABEL is its state must not resize when the state changes.
 *
 * The bug it exists for: the reveal switch's label swaps a 15-character string for a 19-character one
 * ("Shown to players" ⇄ "Hidden from players"). The label lives inside the same `<button>` as the track,
 * and the button sits in a right-anchored cluster, so the extra width grows LEFTWARD — the track slides
 * out from under the pointer and the second click misses. `SaveState` already established the principle
 * ("the label reserves the width of the longest string so the buttons beside it never shuffle"); its own
 * implementation is a hand-tuned `min-width` in rem, which is a guess that has to be re-tuned per font,
 * per theme and per breakpoint. This is the exact version of the same idea.
 *
 * Both strings occupy ONE `inline-grid` cell, so the cell is as wide as the longer of them in whatever
 * font it actually inherits — no `ch` arithmetic, no JS measurement, no breakpoint.
 *
 * **The reserved string is a `data-` attribute painted by `::after`, not a second text node**, and that
 * is a deliberate departure from the obvious "render both, hide one". Rendering it as text puts the
 * record's OTHER visibility phrase into the DOM of every reveal control, and the phrase pair is
 * test-locked: `apps/client/src/codex/prep-clock-reveal.test.tsx` asserts that a revealed journal row
 * never says "Hidden from players" anywhere, which is the 2026-07-30 fix for the two visibility axes
 * colliding on one row. A hidden text node satisfies `queryByText` (verified — `aria-hidden` and
 * `visibility: hidden` are both invisible to it) and would have turned that lock red. Generated content
 * is not in the DOM at all, so the lock keeps meaning what it says while the width is still reserved
 * exactly. The structural assertion moves with it: `stable-swap.test.tsx` pins the attribute.
 */
export function StableSwap({ current, alternate, className }: StableSwapProps) {
  return (
    <span className={className ? `nh-stableswap ${className}` : "nh-stableswap"}>
      <span className="nh-stableswap-face">{current}</span>
      <span className="nh-stableswap-ghost" aria-hidden="true" data-stable-swap-alt={alternate} />
    </span>
  );
}
