import type { CSSProperties, ReactNode } from "react";
import { cx } from "./util";
import "./SideList.css";

/**
 * One side list (theme rule 13, ADR-0072): an eyebrow naming what the list holds, then one row a thing. A row that
 * names a kind of thing leads with its icon, a person with their face at 20px; a row that filters has none. The count
 * or short state sits at the right in VT323; the chosen row is lit cyan with a 2px edge at its left. A tree nests 16px
 * a level. The eyebrow takes text only, so it can never carry a count.
 */
export type SideListRowProps = Readonly<{
  label: ReactNode;
  /** An icon (15px) or a face (20px) before the label. */
  leading?: ReactNode;
  /** A number or a short state ("On"), drawn in VT323 at the right. */
  count?: ReactNode;
  /** Levels of a tree, 16px a level. */
  depth?: number;
  current?: boolean;
  onSelect?: () => void;
  href?: string;
  /** A control after the count, such as the row's More menu. */
  end?: ReactNode;
  /** The row's accessible name when its label is not plain words. */
  ariaLabel?: string;
  className?: string;
}>;

export function SideListRow({
  label,
  leading,
  count,
  depth = 0,
  current = false,
  onSelect,
  href,
  end,
  ariaLabel,
  className
}: SideListRowProps) {
  const body = (
    <>
      {leading != null && (
        <span className="nh-sidelist-leading" aria-hidden="true">
          {leading}
        </span>
      )}
      <span className="nh-sidelist-label">{label}</span>
      {count != null && <span className="nh-sidelist-count">{count}</span>}
    </>
  );
  const indent = depth > 0 ? ({ "--sidelist-depth": depth } as CSSProperties) : undefined;
  return (
    <li className={cx("nh-sidelist-row", current && "is-current", className)}>
      {href ? (
        <a
          className="nh-sidelist-hit"
          href={href}
          style={indent}
          aria-current={current ? "page" : undefined}
          aria-label={ariaLabel}
          onClick={(event) => {
            if (!onSelect) return;
            event.preventDefault();
            onSelect();
          }}
        >
          {body}
        </a>
      ) : (
        <button
          type="button"
          className="nh-sidelist-hit"
          style={indent}
          aria-current={current ? "true" : undefined}
          aria-label={ariaLabel}
          onClick={onSelect}
        >
          {body}
        </button>
      )}
      {end != null && <span className="nh-sidelist-end">{end}</span>}
    </li>
  );
}

/** One group: its eyebrow (words only) and its rows. */
export function SideListGroup({
  eyebrow,
  children,
  className
}: Readonly<{ eyebrow?: string; children: ReactNode; className?: string }>) {
  return (
    <div className={cx("nh-sidelist-group", className)} role="group" aria-label={eyebrow}>
      {eyebrow && (
        <p className="nh-sidelist-eyebrow" aria-hidden="true">
          {eyebrow}
        </p>
      )}
      <ul className="nh-sidelist-rows">{children}</ul>
    </div>
  );
}

export type SideListGroupSpec = Readonly<{
  eyebrow?: string;
  rows: ReadonlyArray<SideListRowProps & Readonly<{ key: string }>>;
}>;

/** The list from data: each group's eyebrow and rows. Callers that mix in their own rows compose the parts instead. */
export function SideList({
  label,
  groups,
  className
}: Readonly<{ label: string; groups: readonly SideListGroupSpec[]; className?: string }>) {
  return (
    <nav className={cx("nh-sidelist", className)} aria-label={label}>
      {groups.map((group, index) => (
        <SideListGroup key={group.eyebrow ?? index} eyebrow={group.eyebrow}>
          {group.rows.map(({ key, ...row }) => (
            <SideListRow key={key} {...row} />
          ))}
        </SideListGroup>
      ))}
    </nav>
  );
}
