import type { ReactNode } from "react";
import { cx } from "./util";
import "./SegmentedControl.css";

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  /** Required — the group needs an accessible name. */
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}

/** Inline "pick exactly one" control for filters and mode switches (a
    role="group" of pressable options). Distinct from Tabs, which switch whole
    views/panels — reach for this for in-place option toggles. */
export function SegmentedControl({ options, value, onChange, ariaLabel, size = "md", className }: SegmentedControlProps) {
  return (
    <div className={cx("nh-segmented", size === "sm" && "nh-segmented--sm", className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="nh-segmented-option interactive"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon != null && <span className="nh-segmented-icon" aria-hidden="true">{option.icon}</span>}
          <span className="nh-segmented-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
