import type { InputHTMLAttributes, ReactNode } from "react";
import { IconSearch } from "./icons";
import { cx } from "./util";
import "./ListToolbar.css";

/**
 * A list's toolbar reads one way (theme rule 17, ADR-0073): the find field, the filters, then at the right the count in
 * plain words ("6 maps", "8 of 332"), the sort as its icon and word, and the list's action on a Base line.
 */
export function ListToolbar({
  find,
  filters,
  count,
  sort,
  action,
  className
}: Readonly<{
  find?: ReactNode;
  filters?: ReactNode;
  /** A phrase in plain words, announced politely as it changes. */
  count?: ReactNode;
  sort?: ReactNode;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <div className={cx("nh-listbar", className)}>
      {find}
      {filters}
      <span className="nh-listbar-grow" />
      {count != null && (
        <span className="nh-listbar-count" role="status">
          {count}
        </span>
      )}
      {sort}
      {action}
    </div>
  );
}

/** A find field (theme rule 18): the search icon at 15px and a muted placeholder. */
export function FindField({ className, ...input }: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <span className={cx("nh-findfield", className)}>
      <IconSearch className="nh-findfield-icon" />
      <input type="search" className="nh-input nh-findfield-input" {...input} />
    </span>
  );
}

/**
 * A kind is its icon and its word (theme rule 19): "Battle map", "Monster". A state is a boxed Tag and readiness a lamp
 * and words; a kind is neither boxed nor lit.
 */
export function Kind({
  icon,
  children,
  className
}: Readonly<{ icon?: ReactNode; children: ReactNode; className?: string }>) {
  return (
    <span className={cx("nh-kind", className)}>
      {icon != null && (
        <span className="nh-kind-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="nh-kind-word">{children}</span>
    </span>
  );
}
