/**
 * The homebrew library rail: search, two filters, and the grouped record list.
 *
 * **Type is a filter, not a nav axis.** Nine tab labels is roughly 810px of content in
 * a 343px viewport with no scroll cue, and it would make "everything I've homebrewed"
 * — the question the library exists to answer — unaskable. One `Select`, same control
 * as the create modal's, and the group headings do the work a tab bar would have.
 *
 * **Group headings are derived and conditional.** They render only while the type
 * filter is "All types". With a type selected every heading would say the same thing,
 * which is restating a constraint once per row.
 *
 * **Removed records are annotated, not silently dropped.** When the status filter
 * excludes them and some exist, the rail foots with one plain line and a control that
 * switches the filter — "annotate options; never filter them" (decision-log 2026-07-27).
 */

import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, Field, GmOnlyTag, Input, Select } from "@vtt/ui";
import type { HomebrewRecordSummary } from "./api";
import { HOMEBREW_TYPES, STATUS_FILTERS, isHomebrewType, typePlural, type HomebrewType, type StatusFilter } from "./types";

/** `ChoiceGrid`'s figure. The Codex's undebounced search is the mistake the styleguide calls out. */
const SEARCH_DEBOUNCE_MS = 160;

export type RailFilters = Readonly<{ type: HomebrewType | "all"; status: StatusFilter; query: string }>;

export const EMPTY_FILTERS: RailFilters = { type: "all", status: "all", query: "" };

/**
 * The one place the filter rules live, so the rail's list, its empty state and the
 * "removed are hidden" line can never disagree about what is shown.
 *
 * `status` is a VIEW over two orthogonal server fields: "Removed" is a soft-deleted row
 * of either state, so it can never be a `state` value. Drafts and published both hide
 * removed rows; only the Removed filter shows them.
 */
export function applyFilters(records: readonly HomebrewRecordSummary[], filters: RailFilters): readonly HomebrewRecordSummary[] {
  const needle = filters.query.trim().toLowerCase();
  return records.filter((record) => {
    if (filters.type !== "all" && record.type !== filters.type) return false;
    if (filters.status === "removed" ? !record.deletedAt : record.deletedAt) return false;
    if (filters.status === "draft" && record.state !== "draft") return false;
    if (filters.status === "published" && record.state !== "published") return false;
    if (needle && !record.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** The rail-row echo of the record's state. Every state is a WORD — the palette is
    heavy in the red-pink-magenta band and reserves violet for GM-only, so hue can
    never be the thing that carries the meaning. */
function StateBadge({ record }: Readonly<{ record: HomebrewRecordSummary }>) {
  if (record.deletedAt) return <Badge tone="neutral">Archived</Badge>;
  if (record.state === "draft") return <Badge tone="caution">Draft</Badge>;
  if (record.visibleToPlayers) return <Badge tone="success">Shown</Badge>;
  return <GmOnlyTag />;
}

export function HomebrewRail({
  records,
  filters,
  onFilters,
  selectedId,
  onSelect,
  onNew
}: Readonly<{
  records: readonly HomebrewRecordSummary[];
  filters: RailFilters;
  onFilters: (next: RailFilters) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}>) {
  const searchId = useId();
  const typeId = useId();
  const statusId = useId();

  // The input is uncontrolled by the committed query on purpose: typing must feel
  // instant, while the (potentially few-hundred-row) list re-filters on a 160ms rest.
  const [typed, setTyped] = useState(filters.query);
  useEffect(() => {
    if (typed === filters.query) return;
    const timer = setTimeout(() => onFilters({ ...filters, query: typed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed, filters, onFilters]);
  // A filter reset from an empty state has to pull the box back with it.
  useEffect(() => {
    if (filters.query === "") setTyped("");
  }, [filters.query]);

  const shown = useMemo(() => applyFilters(records, filters), [records, filters]);

  // Derived, never stored. Grouping only earns its keep when the type filter is open.
  const groups = useMemo(() => {
    if (filters.type !== "all") return null;
    return HOMEBREW_TYPES.map((type) => ({ type, rows: shown.filter((record) => record.type === type) })).filter((group) => group.rows.length > 0);
  }, [shown, filters.type]);

  // How many removed records the current filter is hiding — the sentence is a lie if
  // the removed rows were never fetched, which is why the panel reads them all.
  const hiddenRemoved = filters.status === "removed" ? 0 : records.filter((record) => record.deletedAt).length;

  const row = (record: HomebrewRecordSummary) => (
    <button
      key={record.id}
      type="button"
      className={`hb-row${record.id === selectedId ? " is-active" : ""}`}
      aria-current={record.id === selectedId ? "true" : undefined}
      onClick={() => onSelect(record.id)}
    >
      <span className="hb-row-name">{record.name}</span>
      <StateBadge record={record} />
    </button>
  );

  const empty = () => {
    if (records.length === 0) {
      return (
        <div className="nh-empty">
          <span className="nh-empty-title">Nothing homebrewed yet.</span>
          <span className="nh-empty-text">
            Make a class, a creature, an item — anything the SRD doesn&rsquo;t have. Start blank, or duplicate an SRD record and change what you need.
          </span>
          <Button variant="primary" onClick={onNew}>New homebrew</Button>
        </div>
      );
    }
    if (filters.query.trim()) {
      return (
        <div className="nh-empty">
          <span className="nh-empty-title">No homebrew matches &ldquo;{filters.query.trim()}&rdquo;.</span>
          <Button variant="ghost" className="tap-target" onClick={() => onFilters({ ...filters, query: "" })}>Clear search</Button>
        </div>
      );
    }
    return (
      <div className="nh-empty">
        <span className="nh-empty-title">No homebrew matches.</span>
        <span className="nh-empty-text">Try a different kind or status.</span>
        <Button variant="ghost" className="tap-target" onClick={() => onFilters(EMPTY_FILTERS)}>Clear filters</Button>
      </div>
    );
  };

  return (
    <aside className="hb-rail" aria-label="Homebrew library">
      <div className="hb-rail-head">
        <Input
          id={searchId}
          value={typed}
          placeholder="Search homebrew…"
          aria-label="Search homebrew"
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button variant="primary" onClick={onNew}>New</Button>
      </div>

      {/* auto-fit + minmax(min(150px, 100%), 1fr) resolves to ONE column in a 260px
          desktop rail and TWO in the full-width mobile column, with no media query and
          no one having to think about which way round it goes. */}
      <div className="hb-rail-filters">
        <Field label="Kind" htmlFor={typeId} className="hb-filter">
          <Select
            id={typeId}
            value={filters.type}
            onChange={(event) => onFilters({ ...filters, type: isHomebrewType(event.target.value) ? event.target.value : "all" })}
          >
            <option value="all">All types</option>
            {HOMEBREW_TYPES.map((type) => (
              <option key={type} value={type}>{typePlural(type)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor={statusId} className="hb-filter">
          <Select
            id={statusId}
            value={filters.status}
            onChange={(event) => onFilters({ ...filters, status: event.target.value as StatusFilter })}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Field>
      </div>

      <nav className="hb-list" aria-label="Homebrew records">
        {shown.length === 0
          ? empty()
          : groups
            ? groups.map((group) => (
                <div key={group.type} className="hb-group">
                  <h3 className="hb-group-head">{typePlural(group.type)} ({group.rows.length})</h3>
                  {group.rows.map(row)}
                </div>
              ))
            : shown.map(row)}
      </nav>

      {hiddenRemoved > 0 && (
        <p className="hb-rail-foot">
          {hiddenRemoved} removed {hiddenRemoved === 1 ? "record is" : "records are"} hidden.{" "}
          <Button variant="ghost" size="sm" className="tap-target" onClick={() => onFilters({ ...filters, status: "removed" })}>Show them</Button>
        </p>
      )}
    </aside>
  );
}
