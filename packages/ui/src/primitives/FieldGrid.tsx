import type { CSSProperties, ReactNode } from "react";
import { cx } from "./util";
import "./FieldGrid.css";

export interface FieldGridProps {
  children: ReactNode;
  /** Minimum column width before the grid folds to fewer columns. Default 220px. */
  min?: string;
  className?: string;
}

/** The authoring form layout: as many equal columns as fit, no media query. The track is
    `minmax(min(220px, 100%), 1fr)` so a narrow rail never gets a 220px track that overflows. Full-row fields take
    `className="nh-fieldgrid-wide"`. */
export function FieldGrid({ children, min, className }: FieldGridProps) {
  const style = min ? ({ "--nh-fg-min": min } as CSSProperties) : undefined;
  return (
    <div className={cx("nh-fieldgrid", className)} style={style}>
      {children}
    </div>
  );
}
