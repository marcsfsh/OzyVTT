import type { ReactNode } from "react";
import { cx } from "./util";

/**
 * An empty state (theme spec rule 3): one line saying what is missing and, when something fixes it, one secondary
 * button under it, in the space the content would fill. No heading, icon or box.
 */
export function EmptyState({
  action,
  className,
  children
}: Readonly<{ action?: ReactNode; className?: string; children: ReactNode }>) {
  return (
    <div className={cx("nh-empty", className)}>
      <p className="nh-empty-line">{children}</p>
      {action}
    </div>
  );
}
