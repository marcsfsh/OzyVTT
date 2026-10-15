import type { ReactNode } from "react";
import "./StableSwap.css";

interface StableSwapProps {
  /** The text actually being shown right now. */
  current: ReactNode;
  /** The text this control shows in its other state. Reserved for width, never displayed. */
  alternate: string;
  className?: string;
}

/**
 * A label that is its own state must not resize when the state changes, or a neighbouring control slides
 * out from under the pointer. Both strings share one `inline-grid` cell, so the width is the longer one in
 * the inherited font. The alternate string is a `data-` attribute painted by `::after`, not a hidden text
 * node: a hidden node would still match `queryByText`, and client tests assert that a revealed row never
 * contains "Hidden from players".
 */
export function StableSwap({ current, alternate, className }: StableSwapProps) {
  return (
    <span className={className ? `nh-stableswap ${className}` : "nh-stableswap"}>
      <span className="nh-stableswap-face">{current}</span>
      <span className="nh-stableswap-ghost" aria-hidden="true" data-stable-swap-alt={alternate} />
    </span>
  );
}
