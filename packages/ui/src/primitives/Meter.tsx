import type { ReactNode } from "react";
import { cx } from "./util";
import "./Meter.css";

/** "health" auto-bands cyan→magenta→danger by fraction (matching map/token health);
    the others are fixed brand fills for generic resources (spell slots, XP, uses). */
export type MeterTone = "health" | "cyan" | "magenta" | "violet";

export interface MeterProps {
  value: number;
  max: number;
  /** Optional label; when present the value reads "value/max" (tabular) on the right. */
  label?: ReactNode;
  tone?: MeterTone;
  className?: string;
}

/** Labeled progress/resource bar. Health tone follows the same cyan/magenta/danger
    bands as token health; use fixed tones for slots, XP, and other resources. */
export function Meter({ value, max, label, tone = "cyan", className }: MeterProps) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const band = tone === "health"
    ? (fraction > 0.5 ? "healthy" : fraction > 0.25 ? "bloodied" : "down")
    : tone;
  return (
    <div className={cx("nh-meter", className)}>
      {label != null && (
        <div className="nh-meter-head">
          <span className="nh-meter-label">{label}</span>
          <span className="nh-meter-value tabular">{value}/{max}</span>
        </div>
      )}
      <div className="nh-meter-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className={cx("nh-meter-fill", `nh-meter-fill--${band}`)} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
