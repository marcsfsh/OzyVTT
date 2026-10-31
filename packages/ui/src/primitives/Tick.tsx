import type { ReactNode } from "react";
import { cx } from "./util";
import "./Tick.css";

/**
 * A tick for picking several from a list (theme 2.5, ADR-0074): an 18px box and its words, where one setting on or off
 * is a Switch. Its row keeps a 44px hit area.
 */
export function Tick({
  checked,
  onChange,
  label,
  disabled = false,
  className
}: Readonly<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  className?: string;
}>) {
  return (
    <label className={cx("nh-check nh-tick", disabled && "is-disabled", className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="nh-tick-label">{label}</span>
    </label>
  );
}
