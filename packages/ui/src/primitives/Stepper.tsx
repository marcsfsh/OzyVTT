import type { ReactNode } from "react";
import { cx } from "./util";
import "./Stepper.css";

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Optional visible label. Rendered as a label BAND above the control (D23a) so a labeled Stepper
      top-aligns with the Field-wrapped inputs beside it; without one the control renders inline. */
  label?: ReactNode;
  /** Render the value display (e.g. signed modifiers `+3` / `±0`). Defaults to `String(value)`. */
  format?: (value: number) => ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** Point at the element describing what the value produces (e.g. the resulting
      total + modifier), so focusing the spinner announces the outcome too. */
  "aria-describedby"?: string;
  /** Announce the value as it changes. Off by default: the −/+ buttons are already
      announced on press, and six Steppers on one screen (the ability allocator) would
      be six live regions all shouting over each other. Turn it on for a LONE stepper
      whose value is the whole point. */
  announceValue?: boolean;
}

/** Numeric −/+ spinner for small bounded quantities: ability scores, dice
    counts, HP nudges, uses. Clamps to min/max and disables the spent edge. */
export function Stepper({ value, onChange, min, max, step = 1, label, format, disabled = false, announceValue = false, className, ...aria }: StepperProps) {
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const atMin = min != null && value <= min;
  const atMax = max != null && value >= max;
  const groupLabel = aria["aria-label"] ?? (typeof label === "string" ? label : "Value");
  return (
    <div className={cx("nh-stepper", label != null && "nh-stepper--labeled", className)}>
      {label != null && <span className="nh-stepper-label">{label}</span>}
      <div className="nh-stepper-controls" role="group" aria-label={groupLabel} aria-describedby={aria["aria-describedby"]}>
        <button type="button" className="nh-stepper-btn interactive" aria-label="Decrease" disabled={disabled || atMin} onClick={() => onChange(clamp(value - step))}>−</button>
        <span className="nh-stepper-value tabular" aria-live={announceValue ? "polite" : undefined}>{format ? format(value) : value}</span>
        <button type="button" className="nh-stepper-btn interactive" aria-label="Increase" disabled={disabled || atMax} onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}
