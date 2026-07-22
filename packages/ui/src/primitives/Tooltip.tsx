import type { ReactNode } from "react";
import { useId } from "react";
import { cx } from "./util";
import "./Tooltip.css";

export interface TooltipProps {
  content: ReactNode;
  /** The trigger — should be focusable so the tip is keyboard-reachable. */
  children: ReactNode;
  placement?: "top" | "bottom";
  className?: string;
}

/** Lightweight hover/focus tooltip: surface-2, line border, small text, no glow.
    The bubble stays in the DOM and is linked via aria-describedby. Not a
    substitute for a visible label on touch — pair icon-only controls with one. */
export function Tooltip({ content, children, placement = "top", className }: TooltipProps) {
  const id = useId();
  return (
    <span className={cx("nh-tooltip", `nh-tooltip--${placement}`, className)}>
      <span className="nh-tooltip-trigger" aria-describedby={id}>{children}</span>
      <span role="tooltip" id={id} className="nh-tooltip-bubble">{content}</span>
    </span>
  );
}
