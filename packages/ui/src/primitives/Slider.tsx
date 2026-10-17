import type { CSSProperties, ReactNode } from "react";
import { cx } from "./util";
import "./Slider.css";

interface SliderProps {
  /** From 0 to 1. */
  value: number;
  /** Every step of a drag or a key press. */
  onChange: (value: number) => void;
  /** Once the person lets go (pointer up, key up, or leaving the control): the moment to save. */
  onCommit?: (value: number) => void;
  /** The visible label, and the accessible name. */
  label: ReactNode;
  /** Keeps the label for screen readers only, for a row that already names what the slider sets. */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

/** A 0-100% level (a volume) set by dragging or with the arrow keys. The native range input keeps touch, keyboard
    and screen-reader behaviour; the stylesheet gives it the house look and a 44px hit area. */
export function Slider({
  value,
  onChange,
  onCommit,
  label,
  hideLabel = false,
  disabled = false,
  className
}: SliderProps) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const commit = (target: EventTarget) => onCommit?.(Number((target as HTMLInputElement).value) / 100);
  return (
    <label className={cx("nh-slider", disabled && "nh-slider--disabled", className)}>
      <span className={hideLabel ? "nh-sr-only" : "nh-slider-label"}>{label}</span>
      <input
        type="range"
        className="nh-slider-input"
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={disabled}
        aria-valuetext={`${percent}%`}
        style={{ "--nh-slider-fill": `${percent}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        onPointerUp={(event) => commit(event.currentTarget)}
        onKeyUp={(event) => commit(event.currentTarget)}
      />
      <span className="nh-slider-value tabular" aria-hidden="true">
        {percent}%
      </span>
    </label>
  );
}
