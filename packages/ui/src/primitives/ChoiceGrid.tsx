import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./util";
import { Input } from "./forms";
import { IconSearch } from "./icons";
import { ChoiceCard } from "./ChoiceCard";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import "./ChoiceGrid.css";

export interface ChoiceOption {
  value: string;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  /** Provenance badge (SRD / Homebrew) — pass a `Badge`, reusing its tones. */
  badge?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
  disabledReason?: ReactNode;
  /** Facet bucket this option belongs to; matched against the active facet value. */
  facet?: string;
  /** Extra searchable text (traits, tags, source) beyond the title. */
  keywords?: string;
}

export interface ChoiceGridProps {
  options: readonly ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** Required — a radiogroup needs an accessible name. */
  ariaLabel: string;

  searchable?: boolean;
  searchPlaceholder?: string;
  /** Debounce for the search box, ms. 0 filters on every keystroke. */
  searchDelay?: number;

  /** Facet row. Include your own "all" option; `facetAllValue` says which one
      means "don't filter". */
  facets?: readonly SegmentedOption[];
  facetValue?: string;
  onFacetChange?: (value: string) => void;
  facetLabel?: string;
  facetAllValue?: string;

  /** Optional detail pane rendered beside the grid (the selected option's full text). */
  detail?: ReactNode;
  detailTitle?: ReactNode;

  emptyTitle?: string;
  emptyText?: string;
  /** Action offered in the empty state (e.g. "Clear filters"). */
  emptyAction?: ReactNode;

  className?: string;
}

/** Faceted picker: search + facets + a `ChoiceCard` grid + an optional detail pane.
    The closest existing surface is MonsterBrowser, which is a flat undebounced list;
    this fixes the three things that made it feel cheap:

      - the search is debounced, so a long catalog doesn't refilter per keystroke;
      - no results is a real `.nh-empty` state, not a stray list row;
      - the grid is a keyboard radiogroup (arrows move and select, Home/End jump,
        roving tabindex so Tab enters and leaves the grid once).

    Filtering is plain substring matching over title + keywords. Content, ordering,
    and any smarter ranking belong to the caller. */
export function ChoiceGrid({
  options, value, onChange, ariaLabel,
  searchable = true, searchPlaceholder = "Search…", searchDelay = 160,
  facets, facetValue, onFacetChange, facetLabel = "Filter", facetAllValue = "all",
  detail, detailTitle,
  emptyTitle = "No matches", emptyText = "Try a different search or clear the filters.", emptyAction,
  className
}: ChoiceGridProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const searchId = useId();
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (searchDelay <= 0) { setDebounced(query); return; }
    const timer = setTimeout(() => setDebounced(query), searchDelay);
    return () => clearTimeout(timer);
  }, [query, searchDelay]);

  const shown = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    return options.filter((option) => {
      if (facets && facetValue && facetValue !== facetAllValue && option.facet !== facetValue) return false;
      if (!needle) return true;
      return option.title.toLowerCase().includes(needle) || (option.keywords ?? "").toLowerCase().includes(needle);
    });
  }, [options, debounced, facets, facetValue, facetAllValue]);

  // Roving tabindex: the selected card is the grid's single tab stop, falling back
  // to the first selectable one so the group is always reachable.
  const selectable = shown.filter((option) => !option.disabled);
  const tabStop = selectable.find((option) => option.value === value)?.value ?? selectable[0]?.value ?? null;

  const move = (from: string, delta: number, toEdge?: "first" | "last") => {
    if (selectable.length === 0) return;
    const index = selectable.findIndex((option) => option.value === from);
    const next = toEdge === "first" ? 0
      : toEdge === "last" ? selectable.length - 1
      : (index + delta + selectable.length) % selectable.length;
    const target = selectable[next];
    if (!target) return;
    onChange(target.value);
    itemRefs.current.get(target.value)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: string) => {
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": event.preventDefault(); move(from, 1); break;
      case "ArrowLeft": case "ArrowUp": event.preventDefault(); move(from, -1); break;
      case "Home": event.preventDefault(); move(from, 0, "first"); break;
      case "End": event.preventDefault(); move(from, 0, "last"); break;
      default: break;
    }
  };

  return (
    <div className={cx("nh-choicegrid", detail != null && "nh-choicegrid--split", className)}>
      <div className="nh-choicegrid-picker">
        {(searchable || facets) && (
          <div className="nh-choicegrid-controls">
            {searchable && (
              <div className="nh-choicegrid-search">
                <span className="nh-choicegrid-search-icon" aria-hidden="true"><IconSearch /></span>
                <Input
                  id={searchId}
                  type="search"
                  value={query}
                  placeholder={searchPlaceholder}
                  aria-label={`Search ${ariaLabel.toLowerCase()}`}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
            {facets && facetValue != null && onFacetChange && (
              <SegmentedControl size="sm" ariaLabel={facetLabel} options={[...facets]} value={facetValue} onChange={onFacetChange} />
            )}
          </div>
        )}

        <p className="nh-choicegrid-count tabular" role="status">
          {shown.length} of {options.length}
        </p>

        {shown.length === 0 ? (
          <div className="nh-empty">
            <span className="nh-empty-icon" aria-hidden="true"><IconSearch /></span>
            <span className="nh-empty-title">{emptyTitle}</span>
            <span className="nh-empty-text">{emptyText}</span>
            {emptyAction}
          </div>
        ) : (
          <div className="nh-choicegrid-items" role="radiogroup" aria-label={ariaLabel}>
            {shown.map((option) => (
              <ChoiceCard
                key={option.value}
                ref={(node) => {
                  if (node) itemRefs.current.set(option.value, node);
                  else itemRefs.current.delete(option.value);
                }}
                selected={option.value === value}
                onSelect={() => onChange(option.value)}
                onKeyDown={(event) => onKeyDown(event, option.value)}
                tabIndex={option.value === tabStop ? 0 : -1}
                title={option.title}
                description={option.description}
                icon={option.icon}
                badge={option.badge}
                meta={option.meta}
                disabled={option.disabled}
                disabledReason={option.disabledReason}
              />
            ))}
          </div>
        )}
      </div>

      {detail != null && (
        <aside className="nh-choicegrid-detail" aria-label={typeof detailTitle === "string" ? detailTitle : "Details"}>
          {detailTitle != null && <h3 className="nh-choicegrid-detail-title">{detailTitle}</h3>}
          <div className="nh-choicegrid-detail-body">{detail}</div>
        </aside>
      )}
    </div>
  );
}
