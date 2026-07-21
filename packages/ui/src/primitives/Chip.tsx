import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./util";
import "./Chip.css";

export type ChipTone = "neutral" | "harmful" | "beneficial" | "magical" | "info";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  /** Short glyph/icon so the category reads without relying on color. */
  icon?: ReactNode;
  /** Steady stronger violet glow, e.g. concentration-at-risk. No pulse. */
  atRisk?: boolean;
  /** When set, renders a trailing remove control. */
  onRemove?: () => void;
  removeLabel?: string;
}

/** Condition/tag pill. Category reads from icon + label + border (never color
    alone); the label stays --text for contrast. Harmful=danger, beneficial=cyan,
    magical/concentration=violet, info=indigo. */
export function Chip({ tone = "neutral", icon, atRisk = false, onRemove, removeLabel, className, children, ...rest }: ChipProps) {
  return (
    <span className={cx("nh-chip", tone !== "neutral" && `nh-chip--${tone}`, atRisk && "nh-chip--at-risk", className)} {...rest}>
      {icon != null && <span className="nh-chip-icon" aria-hidden="true">{icon}</span>}
      <span className="nh-chip-label">{children}</span>
      {onRemove && (
        <button type="button" className="nh-chip-remove" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
          ✕
        </button>
      )}
    </span>
  );
}
