import type { ReactNode } from "react";
import { cx } from "./util";
import "./Badge.css";

export type BadgeTone = "neutral" | "primary" | "success" | "caution" | "danger" | "info" | "violet";

interface BadgeProps {
  tone?: BadgeTone;
  /** Filled (solid tone) in place of the default soft outline, for counts and high-emphasis tags. */
  solid?: boolean;
  className?: string;
  /** Native tooltip text. For a badge whose meaning needs one sentence of explanation beyond a label. */
  title?: string;
  children: ReactNode;
}

/** Compact count / status / category label. Smaller and quieter than a Chip
    (no icon slot, no interaction). Use it for counts ("3"), short statuses
    ("LIVE"), and metadata tags. Tone is decorative; the label carries meaning. */
export function Badge({ tone = "neutral", solid = false, className, title, children }: BadgeProps) {
  return (
    <span
      className={cx("nh-badge", tone !== "neutral" && `nh-badge--${tone}`, solid && "nh-badge--solid", className)}
      title={title}
    >
      {children}
    </span>
  );
}
