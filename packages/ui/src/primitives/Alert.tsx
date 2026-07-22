import type { ReactNode } from "react";
import { cx } from "./util";
import "./Alert.css";

export type AlertTone = "info" | "success" | "warning" | "danger";

export interface AlertProps {
  tone?: AlertTone;
  /** Optional bold lead line above the body text. */
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const TONE_ICON: Record<AlertTone, string> = { info: "•", success: "✓", warning: "⚠", danger: "⚠" };

/** Inline, in-flow message banner (icon + tone edge). Distinct from a Toast:
    an Alert stays put and explains state (a warning, a result, guidance);
    a Toast is transient. Danger/warning announce assertively. */
export function Alert({ tone = "info", title, className, children }: AlertProps) {
  return (
    <div
      className={cx("nh-alert", `nh-alert--${tone}`, className)}
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
    >
      <span className="nh-alert-icon" aria-hidden="true">{TONE_ICON[tone]}</span>
      <div className="nh-alert-body">
        {title != null && <strong className="nh-alert-title">{title}</strong>}
        {children != null && <div className="nh-alert-text">{children}</div>}
      </div>
    </div>
  );
}
