import type { ReactNode } from "react";
import { cx } from "./util";
import "./Notice.css";

export type NoticeTone = "caution" | "info" | "danger" | "success" | "violet";

/**
 * One notice (theme rule 21, ADR-0075): a 1px frame of its meaning's colour at 45% over --line-strong, a 3px edge of
 * that colour at its left, no fill, and its words in --text. Amber for waiting, cyan for reading an old version, red
 * for a failure, violet for what only the GM sees. A hidden block keeps its own dashed violet box.
 */
export function Notice({
  tone = "info",
  children,
  className,
  role
}: Readonly<{ tone?: NoticeTone; children: ReactNode; className?: string; role?: "status" | "alert" }>) {
  return (
    <div className={cx("nh-notice", `nh-notice--${tone}`, className)} role={role}>
      {children}
    </div>
  );
}
