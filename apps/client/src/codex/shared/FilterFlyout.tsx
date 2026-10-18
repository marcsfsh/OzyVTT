import { useEffect, useRef, type ReactNode } from "react";
import { Button, IconButton, IconX, cx } from "@vtt/ui";
import "./shared.css";

/** A funnel, the mark of a list's filters. */
function FilterGlyph() {
  return (
    <svg className="cx-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      <path d="M2.6 3.6h18.8v2.8l-7.2 7.6v6.4l-4.4 2v-8.4L2.6 6.4z" />
    </svg>
  );
}

/** The Filters toggle that opens a list's flyout. Pressed while the flyout is open. */
export function FiltersButton({
  open,
  onToggle,
  controls,
  count
}: Readonly<{
  open: boolean;
  onToggle: () => void;
  /** The flyout's id. */
  controls: string;
  /** How many filters are set, said after the word when any are. */
  count?: number;
}>) {
  return (
    <Button
      size="sm"
      className={cx("cx-filters-button", open && "is-on")}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <FilterGlyph />
      {count ? `Filters · ${count}` : "Filters"}
    </Button>
  );
}

/**
 * A list's filters as a flyout from the left edge of its view (C's filter panel): a title, Close, and whatever the
 * list filters on, with the list itself under them. It covers the view's left side while open and closes out of the
 * way with Close, Escape or a pick, which the caller handles. The view it sits in must be positioned.
 */
export function FilterFlyout({
  id,
  open,
  title,
  onClose,
  children,
  className,
  closeLabel = "Close filters"
}: Readonly<{
  id: string;
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** The Close button's name, for a flyout that holds more than filters. */
  closeLabel?: string;
}>) {
  const ref = useRef<HTMLElement>(null);
  // Opening moves focus into the flyout, so a keyboard user lands on its first control.
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("input, button:not(.cx-flyout-close), [tabindex='0']")?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <aside
      ref={ref}
      id={id}
      className={cx("cx-flyout", "anim-popover", className)}
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
          document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus();
        }
      }}
    >
      <div className="cx-flyout-head">
        <h2 className="cx-flyout-title">{title}</h2>
        <IconButton label={closeLabel} size="sm" className="cx-flyout-close" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>
      <div className="cx-flyout-body scroll-y">{children}</div>
    </aside>
  );
}

/**
 * A row of chips that each switch one filter value on or off (Status: Active, Not started, Done), labelled by its
 * group for assistive tech. An empty selection means the group filters nothing.
 */
export function FilterChips({
  label,
  options,
  selected,
  onChange
}: Readonly<{
  label: string;
  options: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
}>) {
  return (
    <div className="cx-filterchips" role="group" aria-label={label}>
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className={cx("cx-filterchip", "interactive", on && "is-on")}
            aria-pressed={on}
            onClick={() =>
              onChange(on ? selected.filter((value) => value !== option.value) : [...selected, option.value])
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
