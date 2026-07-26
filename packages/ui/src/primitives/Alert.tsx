import type { ComponentType, ReactNode } from "react";
import { cx } from "./util";
import { IconCheck, IconInfo, IconWarning } from "./icons";
import "./Alert.css";

export type AlertTone = "info" | "success" | "warning" | "danger";

export interface AlertProps {
  tone?: AlertTone;
  /** Optional bold lead line above the body text. */
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/* System SVG glyphs, never text/emoji: a primitive's tone mark must take a token
   color and render the same on every platform. `IconCheck` is the system's one
   confirm tick — success reuses it rather than introducing a second tick shape. */
const TONE_ICON: Record<AlertTone, ComponentType<{ className?: string }>> = {
  info: IconInfo,
  success: IconCheck,
  warning: IconWarning,
  danger: IconWarning
};

/** Inline, in-flow message banner (icon + tone edge). Distinct from a Toast:
    an Alert stays put and explains state (a warning, a result, guidance);
    a Toast is transient. Danger/warning announce assertively. */
export function Alert({ tone = "info", title, className, children }: AlertProps) {
  const ToneIcon = TONE_ICON[tone];
  return (
    <div
      className={cx("nh-alert", `nh-alert--${tone}`, className)}
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
    >
      <span className="nh-alert-icon" aria-hidden="true"><ToneIcon /></span>
      <div className="nh-alert-body">
        {title != null && <strong className="nh-alert-title">{title}</strong>}
        {children != null && <div className="nh-alert-text">{children}</div>}
      </div>
    </div>
  );
}
