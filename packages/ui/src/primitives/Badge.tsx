import type { ReactNode } from "react";
import { cx } from "./util";
import "./Badge.css";

export type BadgeTone = "neutral" | "primary" | "success" | "caution" | "danger" | "info";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Filled (solid tone) instead of the default soft outline — for counts / high-emphasis tags. */
  solid?: boolean;
  className?: string;
  children: ReactNode;
}

/** Compact count / status / category label. Smaller and quieter than a Chip
    (no icon slot, no interaction) — use for counts ("3"), short statuses
    ("LIVE"), and metadata tags. Tone is decorative; the label carries meaning. */
export function Badge({ tone = "neutral", solid = false, className, children }: BadgeProps) {
  return (
    <span className={cx("nh-badge", tone !== "neutral" && `nh-badge--${tone}`, solid && "nh-badge--solid", className)}>
      {children}
    </span>
  );
}
