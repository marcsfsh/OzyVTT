import { useState, type ReactNode } from "react";
import { cx } from "./util";
import { IconChevron } from "./icons";
import "./FeatureList.css";

export interface FeatureItem {
  id: string;
  title: ReactNode;
  /** Short qualifier shown beside the title: "Level 3", "1/short rest". */
  meta?: ReactNode;
  /** Provenance / kind badge slot. */
  badge?: ReactNode;
  body: ReactNode;
  /** Open on first render (uncontrolled mode only). */
  defaultOpen?: boolean;
}

export interface FeatureListProps {
  items: readonly FeatureItem[];
  /** Controlled mode: the ids currently open. Omit to let the list manage itself. */
  openIds?: readonly string[];
  onToggle?: (id: string, open: boolean) => void;
  /** Show the Expand all / Collapse all pair. Worth it past ~6 features. */
  allowExpandAll?: boolean;
  ariaLabel?: string;
  className?: string;
}

/** In-flow disclosure list for long class/species feature sets. `Menu` is a
    popover — wrong shape for twenty features you need to read side by side with
    the rest of the step.

    Built on native `<details>`, so keyboard and screen-reader behaviour come from
    the platform rather than a hand-rolled aria-expanded dance. Collapsed rows are
    a single tappable line, which is what makes a twenty-feature class readable at
    375px. */
export function FeatureList({ items, openIds, onToggle, allowExpandAll = false, ariaLabel, className }: FeatureListProps) {
  const [internal, setInternal] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((item) => item.defaultOpen).map((item) => item.id))
  );
  const controlled = openIds != null;
  const open = controlled ? new Set(openIds) : internal;

  const setOpen = (id: string, next: boolean) => {
    if (!controlled) {
      setInternal((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(id); else copy.delete(id);
        return copy;
      });
    }
    onToggle?.(id, next);
  };

  const setAll = (next: boolean) => {
    if (!controlled) setInternal(next ? new Set(items.map((item) => item.id)) : new Set());
    for (const item of items) onToggle?.(item.id, next);
  };

  return (
    <div className={cx("nh-features", className)} aria-label={ariaLabel} role={ariaLabel ? "group" : undefined}>
      {allowExpandAll && items.length > 0 && (
        <div className="nh-features-bulk">
          <button type="button" className="nh-features-bulk-btn" onClick={() => setAll(true)}>Expand all</button>
          <span className="nh-features-bulk-sep" aria-hidden="true">·</span>
          <button type="button" className="nh-features-bulk-btn" onClick={() => setAll(false)}>Collapse all</button>
        </div>
      )}

      {items.map((item) => (
        <details
          key={item.id}
          className="nh-feature"
          open={open.has(item.id)}
          onToggle={(event) => {
            const isOpen = (event.currentTarget as HTMLDetailsElement).open;
            if (isOpen !== open.has(item.id)) setOpen(item.id, isOpen);
          }}
        >
          <summary className="nh-feature-summary">
            <span className="nh-feature-caret" aria-hidden="true"><IconChevron /></span>
            <span className="nh-feature-title">{item.title}</span>
            {item.meta != null && <span className="nh-feature-meta tabular">{item.meta}</span>}
            {item.badge != null && <span className="nh-feature-badge">{item.badge}</span>}
          </summary>
          <div className="nh-feature-body">{item.body}</div>
        </details>
      ))}
    </div>
  );
}
