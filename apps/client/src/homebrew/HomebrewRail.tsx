/** The homebrew library rail: search, kind and status filters, and the record list.
    Group headings render only while the kind filter is "All types". Removed records are
    never silently hidden: a footer line counts them and offers a control to show them. */

import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, Field, GmOnlyTag, Input, Select } from "@vtt/ui";
import type { HomebrewRecordSummary } from "./api";
import {
  HOMEBREW_TYPES,
  STATUS_FILTERS,
  isHomebrewType,
  typePlural,
  type HomebrewType,
  type StatusFilter
} from "./types";

const SEARCH_DEBOUNCE_MS = 160;

export type RailFilters = Readonly<{ type: HomebrewType | "all"; status: StatusFilter; query: string }>;

export const EMPTY_FILTERS: RailFilters = { type: "all", status: "all", query: "" };

/**
/** The single source of the filter rules, shared by the list, its empty state and the
    hidden-removed line. "Removed" means soft-deleted in either state; the other status
    filters exclude removed rows. */
export function applyFilters(
  records: readonly HomebrewRecordSummary[],
  filters: RailFilters
): readonly HomebrewRecordSummary[] {
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

/** Each state is a word, not just a hue, because colour alone cannot carry the meaning. */
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

  // Local typed value so input feels instant; the list re-filters after a debounce.
  const [typed, setTyped] = useState(filters.query);
  useEffect(() => {
    if (typed === filters.query) return;
    const timer = setTimeout(() => onFilters({ ...filters, query: typed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed, filters, onFilters]);
  // A filter reset from an empty state must clear the box too.
  useEffect(() => {
    if (filters.query === "") setTyped("");
  }, [filters.query]);

  const shown = useMemo(() => applyFilters(records, filters), [records, filters]);

  const groups = useMemo(() => {
    if (filters.type !== "all") return null;
    return HOMEBREW_TYPES.map((type) => ({ type, rows: shown.filter((record) => record.type === type) })).filter(
      (group) => group.rows.length > 0
    );
  }, [shown, filters.type]);

  // The panel fetches removed rows too, so this count is accurate.
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
            Make a class, a monster or an item the SRD doesn&rsquo;t have. Start blank, or duplicate an SRD record and
            change what you need.
          </span>
          <Button variant="primary" onClick={onNew}>
            New homebrew
          </Button>
        </div>
      );
    }
    if (filters.query.trim()) {
      return (
        <div className="nh-empty">
          <span className="nh-empty-title">No homebrew matches &ldquo;{filters.query.trim()}&rdquo;.</span>
          <Button variant="ghost" className="tap-target" onClick={() => onFilters({ ...filters, query: "" })}>
            Clear search
          </Button>
        </div>
      );
    }
    return (
      <div className="nh-empty">
        <span className="nh-empty-title">No homebrew matches.</span>
        <span className="nh-empty-text">Try a different kind or status.</span>
        <Button variant="ghost" className="tap-target" onClick={() => onFilters(EMPTY_FILTERS)}>
          Clear filters
        </Button>
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
        <Button variant="primary" onClick={onNew}>
          New
        </Button>
      </div>

      <div className="hb-rail-filters">
        <Field label="Kind" htmlFor={typeId} className="hb-filter">
          <Select
            id={typeId}
            value={filters.type}
            onChange={(event) =>
              onFilters({ ...filters, type: isHomebrewType(event.target.value) ? event.target.value : "all" })
            }
          >
            <option value="all">All types</option>
            {HOMEBREW_TYPES.map((type) => (
              <option key={type} value={type}>
                {typePlural(type)}
              </option>
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
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <nav className="hb-list scroll-y" aria-label="Homebrew records">
        {shown.length === 0
          ? empty()
          : groups
            ? groups.map((group) => (
                <div key={group.type} className="hb-group">
                  <h3 className="hb-group-head">
                    {typePlural(group.type)} ({group.rows.length})
                  </h3>
                  {group.rows.map(row)}
                </div>
              ))
            : shown.map(row)}
      </nav>

      {hiddenRemoved > 0 && (
        <p className="hb-rail-foot">
          {hiddenRemoved} removed {hiddenRemoved === 1 ? "record is" : "records are"} hidden.{" "}
          <Button
            variant="ghost"
            size="sm"
            className="tap-target"
            onClick={() => onFilters({ ...filters, status: "removed" })}
          >
            Show them
          </Button>
        </p>
      )}
    </aside>
  );
}
