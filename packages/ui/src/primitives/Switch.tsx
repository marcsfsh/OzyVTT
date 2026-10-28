import { useRef, type ReactNode } from "react";
import { useOnChange } from "../motion/hooks";
import { burst, canMove, comet } from "../motion/lightRail";
import { cx } from "./util";
import { StableSwap } from "./StableSwap";
import "./Switch.css";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Optional visible label (also the accessible name); omit and pass aria-label for icon-tight rows. */
  label?: ReactNode;
  /** The label shown in the other state. Pass it when `label` depends on state and the switch shares a row, so
      the label reserves the wider string and the track doesn't move under the pointer. Never displayed. */
  labelAlternate?: string;
  /** Reserve a label band above the track so it lines up with Field-wrapped inputs' wells in a form grid. Off by
      default. */
  banded?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** On/off toggle for settings and feature flags (role="switch"). Prefer over a
    checkbox when the change takes effect immediately. */
export function Switch({
  checked,
  onChange,
  label,
  labelAlternate,
  banded = false,
  disabled = false,
  className,
  ...aria
}: SwitchProps) {
  // The thumb slides across as it always has; light runs through the track behind it from the side it left, with a
  // small burst where it stops (ADR-0045).
  const track = useRef<HTMLSpanElement>(null);
  useOnChange(checked, (_was, on) => {
    const el = track.current;
    if (!el || !canMove()) return;
    const [from, to] = on ? [4, el.clientWidth - 4] : [el.clientWidth - 4, 4];
    const line = el.clientHeight / 2;
    comet(el, { from, to, line, thick: 2, delay: 0, dur: 200, tone: on ? "cyan" : undefined });
    burst(el, { at: to, line, delay: 180, w: 28, h: 10, tone: on ? "cyan" : undefined });
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={cx(
        "nh-switch",
        checked && "nh-switch--on",
        label != null && "nh-switch--labeled",
        banded && "nh-switch--banded",
        "tap-target",
        "interactive",
        className
      )}
      onClick={() => onChange(!checked)}
      {...aria}
    >
      <span ref={track} className="nh-switch-track" aria-hidden="true">
        <span className="nh-switch-thumb" />
      </span>
      {/* The label stays inside the button: it is part of the tap target. The band is margin on the button, with no
          wrapper. */}
      {label != null && (
        <span className="nh-switch-label">
          {labelAlternate != null ? <StableSwap current={label} alternate={labelAlternate} /> : label}
        </span>
      )}
    </button>
  );
}
