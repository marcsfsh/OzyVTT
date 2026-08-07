import type { ReactNode } from "react";
import { cx } from "./util";
import { StableSwap } from "./StableSwap";
import "./Switch.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional visible label (also the accessible name); omit and pass aria-label for icon-tight rows. */
  label?: ReactNode;
  /** The label this switch shows in its OTHER state. Pass it whenever `label` is state-dependent and the
      switch shares a row with anything: the label then reserves the wider of the two strings, so the
      track cannot slide out from under the pointer on the click that changes it (D23c). Never displayed. */
  labelAlternate?: string;
  /** Reserve a label band above the track (D23b). Set it where the switch stands in a form grid beside
      Field-wrapped inputs: the track top then lines up with their input wells rather than their labels.
      Off by default — a switch in an ordinary toolbar row has no band to match. */
  banded?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** On/off toggle for settings and feature flags (role="switch"). Prefer over a
    checkbox when the change takes effect immediately. */
export function Switch({ checked, onChange, label, labelAlternate, banded = false, disabled = false, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx("nh-switch", checked && "nh-switch--on", label != null && "nh-switch--labeled", banded && "nh-switch--banded", "tap-target", "interactive", className)}
      onClick={() => onChange(!checked)}
      {...aria}
    >
      <span className="nh-switch-track" aria-hidden="true"><span className="nh-switch-thumb" /></span>
      {/* The label stays INSIDE the button on purpose: it is part of the tap target, and on the reveal
          control it IS the state. The band above (D23b) is margin on the button, never a wrapper. */}
      {label != null && (
        <span className="nh-switch-label">
          {labelAlternate != null ? <StableSwap current={label} alternate={labelAlternate} /> : label}
        </span>
      )}
    </button>
  );
}
