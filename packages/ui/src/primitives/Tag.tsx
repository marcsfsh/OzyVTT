import type { ReactNode } from "react";
import { cx } from "./util";
import "./Tag.css";

/**
 * What a tag marks. Fills: NEXT white, WAIT amber, HIT yellow, MISS grey. Outlines mark status: READY, TAKEN, SRD,
 * DONE and ERROR in their inks, HOMEBREW in yellow; HIDDEN FROM PLAYERS is dashed violet.
 */
export type TagTone =
  "next" | "wait" | "hit" | "miss" | "status" | "ready" | "done" | "error" | "srd" | "homebrew" | "hidden";

/** A VT323 tag: one or two words, uppercase, always beside the thing it marks. The words carry the meaning. */
export function Tag({
  tone = "status",
  size = "md",
  className,
  children
}: Readonly<{ tone?: TagTone; size?: "sm" | "md" | "lg"; className?: string; children: ReactNode }>) {
  return (
    <span className={cx("nh-tag", `nh-tag--${tone}`, size !== "md" && `nh-tag--${size}`, className)}>{children}</span>
  );
}
