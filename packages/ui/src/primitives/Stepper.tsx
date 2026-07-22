import type { ReactNode } from "react";
import { cx } from "./util";
import "./Stepper.css";

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Optional visible label to the left of the control. */
  label?: ReactNode;
  /** Render the value display (e.g. signed modifiers `+3` / `±0`). Defaults to `String(value)`. */
  format?: (value: number) => ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Numeric −/+ spinner for small bounded quantities: ability scores, dice
    counts, HP nudges, uses. Clamps to min/max and disables the spent edge. */
export function Stepper({ value, onChange, min, max, step = 1, label, format, disabled = false, className, ...aria }: StepperProps) {
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  const atMin = min != null && value <= min;
  const atMax = max != null && value >= max;
  const groupLabel = aria["aria-label"] ?? (typeof label === "string" ? label : "Value");
  return (
    <div className={cx("nh-stepper", className)}>
      {label != null && <span className="nh-stepper-label">{label}</span>}
      <div className="nh-stepper-controls" role="group" aria-label={groupLabel}>
        <button type="button" className="nh-stepper-btn interactive" aria-label="Decrease" disabled={disabled || atMin} onClick={() => onChange(clamp(value - step))}>−</button>
        <span className="nh-stepper-value tabular" aria-live="polite">{format ? format(value) : value}</span>
        <button type="button" className="nh-stepper-btn interactive" aria-label="Increase" disabled={disabled || atMax} onClick={() => onChange(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}
