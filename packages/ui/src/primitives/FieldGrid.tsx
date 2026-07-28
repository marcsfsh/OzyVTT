import type { CSSProperties, ReactNode } from "react";
import { cx } from "./util";
import "./FieldGrid.css";

export interface FieldGridProps {
  children: ReactNode;
  /** Minimum column width before the grid folds to fewer columns. Default 220px. */
  min?: string;
  className?: string;
}

/** The form layout every authoring surface wants: as many equal columns as fit, no
    media query. Lifted from the Codex's `.codex-fields`, where the load-bearing detail
    is `minmax(min(220px, 100%), 1fr)` and not `minmax(220px, 1fr)` — the bare version
    forces a 220px track inside a 200px rail and pushes the document sideways at 375px.

    Because it is intrinsic rather than breakpoint-driven, the same grid resolves to one
    column inside a narrow desktop rail AND to two columns in a full-width phone column,
    which is the correct answer in both places and takes no thought from the caller.

    A field that must span the full row takes `className="nh-fieldgrid-wide"` (textareas,
    a `rows` editor, a fieldset) rather than the grid learning about its children. */
export function FieldGrid({ children, min, className }: FieldGridProps) {
  const style = min ? ({ "--nh-fg-min": min } as CSSProperties) : undefined;
  return <div className={cx("nh-fieldgrid", className)} style={style}>{children}</div>;
}
