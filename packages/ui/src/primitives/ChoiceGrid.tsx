import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./util";
import { Input } from "./forms";
import { IconInfo, IconSearch, IconWarning } from "./icons";
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
  /** Single-select answer. Ignored (pass null) when `selection` is "multiple". */
  value: string | null;
  onChange: (value: string) => void;
  /** Required: a radiogroup needs an accessible name. */
  ariaLabel: string;

  /** "single" (default) is a pick-one radiogroup; "multiple" is a choose-N list with checkbox semantics. */
  selection?: "single" | "multiple";
  /** multiple: the chosen ids. */
  values?: readonly string[];
  /** multiple: `next` is false when the card was already chosen. */
  onToggle?: (value: string, next: boolean) => void;
  /** multiple: how many may be chosen. At capacity the unchosen cards lock with a reason instead of silently
      ignoring taps. */
  max?: number;
  /** The reason shown on locked cards at capacity. */
  maxReachedReason?: ReactNode;

  /**
   * Read about an option without choosing it: every card gets a sibling control that calls this with the
   * option's value. A sibling because a `ChoiceCard` is a button and can't nest controls. Callers should open a
   * `Modal`, not a `Drawer`, so a stray tap beside the overlay can't land on a card.
   */
  onInspect?: (value: string) => void;
  /** Accessible name for that control. Defaults to "About <title>". */
  inspectLabel?: (option: ChoiceOption) => string;

  /**
   * Cap the card list's height and scroll it inside the grid, so long choose-N lists keep every option mounted,
   * visible and swappable. The cap sits on `.nh-choicegrid-items` itself, which is safe because `max-height`
   * isn't a definite block size, so auto rows still size from their cards.
   */
  bounded?: boolean;

  searchable?: boolean;
  searchPlaceholder?: string;
  /** Debounce for the search box, ms. 0 filters on every keystroke. */
  searchDelay?: number;

  /** Facet row. Include your own "all" option; `facetAllValue` says which one means "don't filter". */
  facets?: readonly SegmentedOption[];
  facetValue?: string;
  onFacetChange?: (value: string) => void;
  facetLabel?: string;
  facetAllValue?: string;

  /* No detail pane: on narrow screens that needs master-detail, which `WizardShell` already owns
     (`detail` / `detailOpen` / `onOpenDetail`). Pass the detail to the shell. */

  emptyTitle?: string;
  emptyText?: string;
  /** Action offered in the empty state (e.g. "Clear filters"). */
  emptyAction?: ReactNode;

  className?: string;
}

/** Faceted picker: debounced search, facets and a `ChoiceCard` grid with a real empty state. The grid is a
    keyboard radiogroup (arrows move and select, Home/End jump, roving tabindex). Filtering is substring
    matching over title + keywords; ordering and ranking belong to the caller. */
export function ChoiceGrid({
  options,
  value,
  onChange,
  ariaLabel,
  selection = "single",
  values,
  onToggle,
  max,
  maxReachedReason,
  onInspect,
  inspectLabel = (option) => `About ${option.title}`,
  bounded = false,
  searchable = true,
  searchPlaceholder = "Search…",
  searchDelay = 160,
  facets,
  facetValue,
  onFacetChange,
  facetLabel = "Filter",
  facetAllValue = "all",
  emptyTitle = "No matches",
  emptyText = "Try a different search or clear the filters.",
  emptyAction,
  className
}: ChoiceGridProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const searchId = useId();
  const lockedNoticeId = useId();
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (searchDelay <= 0) {
      setDebounced(query);
      return;
    }
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

  /** Is anything actually narrowing the list right now? */
  const filtering =
    debounced.trim().length > 0 || (facets != null && facetValue != null && facetValue !== facetAllValue);

  const multiple = selection === "multiple";
  const chosen = useMemo(() => new Set(values ?? []), [values]);
  const isChosen = (option: ChoiceOption) => (multiple ? chosen.has(option.value) : option.value === value);
  // At capacity the unchosen cards lock (chosen ones stay tappable so a pick can be swapped). The reason is
  // stated once beside the count and locked cards reference it via `aria-describedby`, rather than repeating it
  // on every card.
  const atCapacity = multiple && max != null && chosen.size >= max;
  const lockedReason =
    maxReachedReason ?? (max != null ? `You have already chosen ${max}. Unpick one to swap.` : undefined);
  const capacityLocked = (option: ChoiceOption) => atCapacity && option.disabled !== true && !chosen.has(option.value);
  const lockedOf = (option: ChoiceOption) => option.disabled === true || capacityLocked(option);
  // Announced only when it is true and there is something it applies to.
  const showLockedNotice = atCapacity && lockedReason != null && shown.some(capacityLocked);

  // Roving tabindex: the chosen card is the single tab stop, else the first selectable one.
  const selectable = shown.filter((option) => !lockedOf(option));
  const tabStop = selectable.find(isChosen)?.value ?? selectable[0]?.value ?? null;

  const pick = (option: ChoiceOption) => {
    if (multiple) onToggle?.(option.value, !chosen.has(option.value));
    else onChange(option.value);
  };

  // Arrow keys move in both modes; only a radiogroup also selects as it moves.
  const move = (from: string, delta: number, toEdge?: "first" | "last") => {
    if (selectable.length === 0) return;
    const index = selectable.findIndex((option) => option.value === from);
    const next =
      toEdge === "first"
        ? 0
        : toEdge === "last"
          ? selectable.length - 1
          : (index + delta + selectable.length) % selectable.length;
    const target = selectable[next];
    if (!target) return;
    if (!multiple) onChange(target.value);
    itemRefs.current.get(target.value)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, from: string) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(from, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(from, -1);
        break;
      case "Home":
        event.preventDefault();
        move(from, 0, "first");
        break;
      case "End":
        event.preventDefault();
        move(from, 0, "last");
        break;
      default:
        break;
    }
  };

  return (
    <div className={cx("nh-choicegrid", className)}>
      <div className="nh-choicegrid-picker">
        {(searchable || facets) && (
          <div className="nh-choicegrid-controls">
            {searchable && (
              <div className="nh-choicegrid-search">
                <span className="nh-choicegrid-search-icon" aria-hidden="true">
                  <IconSearch />
                </span>
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
              <SegmentedControl
                size="sm"
                ariaLabel={facetLabel}
                options={[...facets]}
                value={facetValue}
                onChange={onFacetChange}
              />
            )}
          </div>
        )}

        {/* The count appears only while a filter hides something; unfiltered it would just restate the offer's own
            "2 of 3 chosen". */}
        {filtering && (
          <p className="nh-choicegrid-count tabular" role="status">
            {shown.length} of {options.length}
          </p>
        )}

        {/* The capacity rule, stated once. Not a live region (the offer count already announces it); locked cards
            point at it as a description. */}
        {showLockedNotice && (
          <p className="nh-choicegrid-locked" id={lockedNoticeId}>
            <span className="nh-choicegrid-locked-icon" aria-hidden="true">
              <IconWarning />
            </span>
            {lockedReason}
          </p>
        )}

        {shown.length === 0 ? (
          <div className="nh-empty">
            <span className="nh-empty-icon" aria-hidden="true">
              <IconSearch />
            </span>
            <span className="nh-empty-title">{emptyTitle}</span>
            <span className="nh-empty-text">{emptyText}</span>
            {emptyAction}
          </div>
        ) : (
          // `.scroll-y` declares the scroll region in the markup.
          <div
            className={cx("nh-choicegrid-items", bounded && "nh-choicegrid-items--bounded", bounded && "scroll-y")}
            role={multiple ? "group" : "radiogroup"}
            aria-label={ariaLabel}
          >
            {shown.map((option) => {
              const byCapacity = capacityLocked(option);
              const locked = option.disabled === true || byCapacity;
              return (
                <ChoiceCard
                  key={option.value}
                  ref={(node) => {
                    if (node) itemRefs.current.set(option.value, node);
                    else itemRefs.current.delete(option.value);
                  }}
                  selectionRole={multiple ? "checkbox" : "radio"}
                  selected={isChosen(option)}
                  onSelect={() => pick(option)}
                  onKeyDown={(event) => onKeyDown(event, option.value)}
                  tabIndex={option.value === tabStop ? 0 : -1}
                  title={option.title}
                  description={option.description}
                  icon={option.icon}
                  badge={option.badge}
                  meta={option.meta}
                  disabled={locked}
                  /* Per-option reasons only; capacity-locked cards reference the shared notice above. */
                  disabledReason={option.disabled === true ? option.disabledReason : undefined}
                  {...(byCapacity && showLockedNotice ? { "aria-describedby": lockedNoticeId } : {})}
                  /* Reading is never locked: the reference control stays live on a disabled card. */
                  action={
                    onInspect ? (
                      <button
                        type="button"
                        className="nh-choice-info interactive"
                        aria-label={inspectLabel(option)}
                        onClick={() => onInspect(option.value)}
                      >
                        <IconInfo />
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
