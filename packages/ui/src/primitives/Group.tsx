import { useId, type ReactNode } from "react";
import { GmOnlyTag } from "./Reveal";
import { cx } from "./util";
import { Eyebrow } from "./Wordmark";
import "./Group.css";

/**
 * A group of related things (ADR-0048). A group you act in (`kind="act"`, the default) is the Cradle: no fill and no
 * top, a 2px base and sides that fade before the top, the base lighting cyan while the pointer or focus is inside. A
 * group you only read (`kind="read"`) is open: its heading and a 1px rule above it. The heading is the one eyebrow, in
 * the open top; `gmOnly` puts the GM only tag after it, and `actions` sit at its right. A group never holds a group: a
 * group inside another draws no box of its own.
 */
export function Group({
  title,
  kind = "act",
  actions,
  gmOnly = false,
  headingLevel,
  className,
  children
}: Readonly<{
  title?: ReactNode;
  kind?: "act" | "read";
  actions?: ReactNode;
  gmOnly?: boolean;
  /** Pass 2 or 3 when the group needs to be found as a heading; otherwise the title is a plain eyebrow. */
  headingLevel?: 2 | 3;
  className?: string;
  children: ReactNode;
}>) {
  const titleId = useId();
  const hasHead = title != null || actions != null || gmOnly;
  const label = title != null ? <Eyebrow id={titleId}>{title}</Eyebrow> : null;
  const Heading = headingLevel === 2 ? "h2" : headingLevel === 3 ? "h3" : null;
  return (
    <section
      className={cx("nh-group", kind === "read" && "nh-group--read", className)}
      aria-labelledby={title != null ? titleId : undefined}
    >
      {hasHead && (
        <div className="nh-group-head">
          {Heading && label ? <Heading className="nh-group-title">{label}</Heading> : label}
          {gmOnly && <GmOnlyTag />}
          {actions != null && <span className="nh-group-actions">{actions}</span>}
        </div>
      )}
      <div className="nh-group-body">{children}</div>
    </section>
  );
}
