import type { ReactNode } from "react";
import { cx } from "./util";
import "./Switch.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional visible label (also the accessible name); omit and pass aria-label for icon-tight rows. */
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** On/off toggle for settings and feature flags (role="switch"). Prefer over a
    checkbox when the change takes effect immediately. */
export function Switch({ checked, onChange, label, disabled = false, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx("nh-switch", checked && "nh-switch--on", label != null && "nh-switch--labeled", "interactive", className)}
      onClick={() => onChange(!checked)}
      {...aria}
    >
      <span className="nh-switch-track" aria-hidden="true"><span className="nh-switch-thumb" /></span>
      {label != null && <span className="nh-switch-label">{label}</span>}
    </button>
  );
}
