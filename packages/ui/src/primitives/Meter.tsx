import { useRef, type ReactNode } from "react";
import { useOnChange } from "../motion/hooks";
import { burst, canMove, comet } from "../motion/lightRail";
import { cx } from "./util";
import "./Meter.css";

/** "health" auto-bands cyan→magenta→danger by fraction (matching map/token health);
    the others are fixed brand fills for generic resources (spell slots, XP, uses). */
export type MeterTone = "health" | "cyan" | "magenta" | "violet";

interface MeterProps {
  value: number;
  max: number;
  /** Optional label; when present the value reads "value/max" (tabular) on the right. */
  label?: ReactNode;
  tone?: MeterTone;
  /**
   * Runs light along the track from the old value to the new one (ADR-0045): red as health falls and gold as it
   * rises, the spark's colour for anything else.
   */
  light?: boolean;
  className?: string;
}

/** Labeled progress/resource bar. Health tone follows the same cyan/magenta/danger
    bands as token health; use fixed tones for slots, XP, and other resources. */
export function Meter({ value, max, label, tone = "cyan", light = false, className }: MeterProps) {
  const track = useRef<HTMLDivElement>(null);
  useOnChange(value, (before, now) => {
    const el = track.current;
    if (!light || !el || max <= 0 || !canMove()) return;
    // The fill sits 2px inside the track.
    const at = (v: number) => 2 + (el.clientWidth - 4) * Math.max(0, Math.min(1, v / max));
    const line = el.clientHeight / 2;
    const shade = tone === "health" ? (now < before ? "red" : "gold") : undefined;
    comet(el, { from: at(before), to: at(now), line, thick: 3, tone: shade, delay: 40, dur: 230 });
    burst(el, { at: at(now), line, w: 60, h: 8, tone: shade, delay: 250 });
  });
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const band = tone === "health" ? (fraction > 0.5 ? "healthy" : fraction > 0.25 ? "bloodied" : "down") : tone;
  return (
    <div className={cx("nh-meter", className)}>
      {label != null && (
        <div className="nh-meter-head">
          <span className="nh-meter-label">{label}</span>
          <span className="nh-meter-value tabular">
            {value}/{max}
          </span>
        </div>
      )}
      <div
        ref={track}
        className="nh-meter-track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className={cx("nh-meter-fill", `nh-meter-fill--${band}`)} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
