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
  /** Required — a radiogroup needs an accessible name. */
  ariaLabel: string;

  /** "single" (default) is the pick-one radiogroup. "multiple" is the choose-N
      list every content offer needs (three Weapon Masteries, six prepared spells):
      same cards, same one chosen treatment, checkbox semantics. */
  selection?: "single" | "multiple";
  /** multiple: the chosen ids. */
  values?: readonly string[];
  /** multiple: `next` is false when the card was already chosen. */
  onToggle?: (value: string, next: boolean) => void;
  /** multiple: how many may be chosen. Once `values` is full, the unchosen cards
      lock with a reason rather than silently swallowing taps — the grid owns this
      so every choose-N step says the same thing the same way. */
  max?: number;
  /** The reason shown on locked cards at capacity. */
  maxReachedReason?: ReactNode;

  /**
   * READ about an option without answering with it. Present ⇒ every card grows a sibling control
   * that calls this with the option's value; the grid never touches `value` / `values` for it.
   *
   * This is the only honest shape for a multi-select list of 203 spells: the rules a player needs
   * in order to choose cannot live inside the card (a `ChoiceCard` IS a button, so nothing
   * interactive nests in it) and cannot expand inline (that pushes the rest of the list off a
   * phone). The caller opens whatever reference it owns — a `Modal`, never a `Drawer`, because a
   * stray tap beside a scrimless overlay must not land on a card.
   */
  onInspect?: (value: string) => void;
  /** Accessible name for that control. Defaults to "About <title>". */
  inspectLabel?: (option: ChoiceOption) => string;

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

  /* NO detail pane. A grid of a dozen cards plus a detail column has exactly one
     honest narrow-screen layout — master-detail — and `WizardShell` already owns it
     (`detail` / `detailOpen` / `onOpenDetail`). Stacking a detail after the cards, as
     this used to, meant scrolling past every card to read the one you just tapped.
     Pass the detail to the shell instead: one idea, one place. */

  emptyTitle?: string;
  emptyText?: string;
  /** Action offered in the empty state (e.g. "Clear filters"). */
  emptyAction?: ReactNode;

  className?: string;
}

/** Faceted picker: search + facets + a `ChoiceCard` grid.
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
  selection = "single", values, onToggle, max, maxReachedReason,
  onInspect, inspectLabel = (option) => `About ${option.title}`,
  searchable = true, searchPlaceholder = "Search…", searchDelay = 160,
  facets, facetValue, onFacetChange, facetLabel = "Filter", facetAllValue = "all",
  emptyTitle = "No matches", emptyText = "Try a different search or clear the filters.", emptyAction,
  className
}: ChoiceGridProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const searchId = useId();
  const lockedNoticeId = useId();
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

  /** Is anything actually narrowing the list right now? */
  const filtering = debounced.trim().length > 0 || (facets != null && facetValue != null && facetValue !== facetAllValue);

  const multiple = selection === "multiple";
  const chosen = useMemo(() => new Set(values ?? []), [values]);
  const isChosen = (option: ChoiceOption) => multiple ? chosen.has(option.value) : option.value === value;
  // At capacity the UNCHOSEN cards lock (the chosen ones must stay tappable, or the
  // player can never change their mind) — with a reason, per the disabled rule.
  //
  // The reason is stated ONCE, beside the count, and every capacity-locked card points at it with
  // `aria-describedby`. It used to be stamped INTO each card: a choose-6 grid of 70 spells rendered
  // 64 copies of one sentence, and at level 20 the wizard's fourth step carried 409 of them — a
  // third of that step's DOM restating a fact about the GRID, not about any card. One idea, one
  // place; a locked option still says why, it just does not say it 64 times.
  const atCapacity = multiple && max != null && chosen.size >= max;
  const lockedReason = maxReachedReason ?? (max != null ? `You have already chosen ${max}. Unpick one to swap.` : undefined);
  const capacityLocked = (option: ChoiceOption) => atCapacity && option.disabled !== true && !chosen.has(option.value);
  const lockedOf = (option: ChoiceOption) => option.disabled === true || capacityLocked(option);
  // Announced only when it is true AND there is something it applies to.
  const showLockedNotice = atCapacity && lockedReason != null && shown.some(capacityLocked);

  // Roving tabindex: a chosen card is the grid's single tab stop, falling back to the
  // first selectable one so the group is always reachable.
  const selectable = shown.filter((option) => !lockedOf(option));
  const tabStop = selectable.find(isChosen)?.value ?? selectable[0]?.value ?? null;

  const pick = (option: ChoiceOption) => {
    if (multiple) onToggle?.(option.value, !chosen.has(option.value));
    else onChange(option.value);
  };

  // Arrow keys MOVE in both modes; only a radiogroup also selects as it moves — a
  // checkbox group that selected on arrow would tick every card you scrolled past.
  const move = (from: string, delta: number, toEdge?: "first" | "last") => {
    if (selectable.length === 0) return;
    const index = selectable.findIndex((option) => option.value === from);
    const next = toEdge === "first" ? 0
      : toEdge === "last" ? selectable.length - 1
      : (index + delta + selectable.length) % selectable.length;
    const target = selectable[next];
    if (!target) return;
    if (!multiple) onChange(target.value);
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
    <div className={cx("nh-choicegrid", className)}>
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

        {/* "9 of 9" counts nothing: with no search text and no facet, `shown` IS `options`, and every
            offer already carries its own "2 of 3 chosen" heading — so an unfiltered step announced
            two numbers, one of them constant. The count returns the moment a filter hides something,
            which is the only moment the two can differ. */}
        {filtering && (
          <p className="nh-choicegrid-count tabular" role="status">
            {shown.length} of {options.length}
          </p>
        )}

        {/* The capacity rule, stated once. NOT a live region: `.cb-offer-count` already announces
            "6 of 6 chosen" the moment the last pick lands, and two announcements of one event is the
            duplication this replaced. It is a DESCRIPTION — the locked cards point at it. */}
        {showLockedNotice && (
          <p className="nh-choicegrid-locked" id={lockedNoticeId}>
            <span className="nh-choicegrid-locked-icon" aria-hidden="true"><IconWarning /></span>
            {lockedReason}
          </p>
        )}

        {shown.length === 0 ? (
          <div className="nh-empty">
            <span className="nh-empty-icon" aria-hidden="true"><IconSearch /></span>
            <span className="nh-empty-title">{emptyTitle}</span>
            <span className="nh-empty-text">{emptyText}</span>
            {emptyAction}
          </div>
        ) : (
          <div className="nh-choicegrid-items" role={multiple ? "group" : "radiogroup"} aria-label={ariaLabel}>
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
                  /* PER-OPTION only. `option.disabled` is the caller saying something true about THIS
                     option ("you already have Perception from your background") — it belongs on the
                     card and nowhere else. Capacity is a fact about the grid, so a capacity-locked
                     card points at the one notice above instead of carrying a copy of it. */
                  disabledReason={option.disabled === true ? option.disabledReason : undefined}
                  {...(byCapacity && showLockedNotice ? { "aria-describedby": lockedNoticeId } : {})}
                  /* Reading is never locked. A card can be at capacity — the whole reason a player
                     wants to read the two they did not take — so the reference control stays live
                     on a disabled card, and it is the one thing on it that is. */
                  action={onInspect
                    ? <button
                        type="button"
                        className="nh-choice-info interactive"
                        aria-label={inspectLabel(option)}
                        onClick={() => onInspect(option.value)}
                      ><IconInfo /></button>
                    : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
