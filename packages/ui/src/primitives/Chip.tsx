import type { ReactNode } from "react";
import { cx } from "./util";
import "./Chip.css";

export type ChipTone = "neutral" | "harmful" | "beneficial" | "magical" | "info";

export interface ChipProps {
  tone?: ChipTone;
  /** Short glyph/icon so the category reads without relying on color. */
  icon?: ReactNode;
  /** Steady stronger violet glow, e.g. concentration-at-risk. No pulse. */
  atRisk?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
  /** Selectable/toggle chip: renders a <button aria-pressed> with press feedback. */
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  /** Trailing remove control (display/filter chips; omit on pressable chips). */
  onRemove?: () => void;
  removeLabel?: string;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
}

/** Condition/tag pill. Category reads from icon + label + border (never color
    alone); the label stays --text for contrast. Renders a <button> when it's
    pressable (onClick/pressed) and a <span> otherwise. */
export function Chip({ tone = "neutral", icon, atRisk = false, className, children, title, pressed, disabled, onClick, onRemove, removeLabel, ...aria }: ChipProps) {
  const isButton = pressed !== undefined || onClick !== undefined;
  const cls = cx(
    "nh-chip",
    tone !== "neutral" && `nh-chip--${tone}`,
    atRisk && "nh-chip--at-risk",
    isButton && "nh-chip--pressable tap-target interactive",
    className
  );
  const body = (
    <>
      {icon != null && <span className="nh-chip-icon" aria-hidden="true">{icon}</span>}
      <span className="nh-chip-label">{children}</span>
    </>
  );
  if (isButton) {
    return (
      <button type="button" className={cls} aria-pressed={pressed} disabled={disabled} title={title} onClick={onClick} {...aria}>
        {body}
      </button>
    );
  }
  return (
    <span className={cls} title={title} {...aria}>
      {body}
      {onRemove && (
        <button type="button" className="nh-chip-remove tap-target" aria-label={removeLabel ?? "Remove"} onClick={onRemove}>
          ✕
        </button>
      )}
    </span>
  );
}
