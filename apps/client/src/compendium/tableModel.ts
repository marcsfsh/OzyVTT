import type { HomebrewTableColumns } from "@vtt/api-contract";
import type { SortDirection, SortLevelOf } from "../codex/shared/SortDialog";
import { dayOf, dayRange, readSort, setOrDelete } from "../scenes/scene-lists";
import { KIND_COLUMNS, KIND_FILTERS, kindLabel, kindPlural, type Kind, type Names } from "./kinds";

/**
 * What a Compendium table filters and sorts on, kept in the address so a filtered table is a link and the table folded
 * beside a record keeps its filters. Pure, so the GM's tables, the players' and their tests agree.
 */

/** One row of a table: an SRD record or a homebrew one. The GM's rows carry its state; a player's carry none. */
export type CompendiumRow = Readonly<{
  id: string;
  kind: Kind;
  name: string;
  source: "srd" | "homebrew";
  /** The pack a homebrew row is in; null for the SRD, and for a player's rows, which never name a pack. */
  packId: string | null;
  state?: "draft" | "published";
  archived?: boolean;
  pendingChanges?: boolean;
  issueCount?: number;
  audience?: "hidden" | "everyone" | "characters";
  characterIds?: readonly string[];
  updatedAt?: string | null;
  columns: HomebrewTableColumns;
}>;

export type RowState = "published" | "pending" | "draft" | "archived";
export const ROW_STATES: readonly RowState[] = ["published", "pending", "draft", "archived"];
export const STATE_WORD: Readonly<Record<RowState, string>> = {
  published: "Published",
  pending: "Changes not live",
  draft: "Draft",
  archived: "Archived"
};
export function stateOf(row: CompendiumRow): RowState {
  if (row.archived) return "archived";
  if (row.state === "draft") return "draft";
  return row.pendingChanges ? "pending" : "published";
}

export type Audience = "hidden" | "everyone" | "characters";
export const AUDIENCES: readonly Audience[] = ["hidden", "everyone", "characters"];
export const AUDIENCE_WORD: Readonly<Record<Audience, string>> = {
  hidden: "Hidden",
  everyone: "Everyone",
  characters: "Chosen characters"
};

export type TableFilters = Readonly<{
  /** Names to find, as typed. */
  q: string;
  /** `srd` and pack ids to keep; null keeps every source. */
  sources: readonly string[] | null;
  states: readonly RowState[];
  audiences: readonly Audience[];
  problems: boolean;
  from: string | null;
  to: string | null;
  /** The kind's own filters by key; a key that is absent keeps every value. */
  kind: Readonly<Record<string, readonly string[]>>;
}>;

/** Archived rows stay out until the State filter asks for them, as the old Archived list did. */
export const DEFAULT_STATES: readonly RowState[] = ["published", "pending", "draft"];

export const NO_FILTERS: TableFilters = {
  q: "",
  sources: null,
  states: DEFAULT_STATES,
  audiences: AUDIENCES,
  problems: false,
  from: null,
  to: null,
  kind: {}
};

const listOf = (text: string | null): readonly string[] | null =>
  text === null ? null : text === "none" ? [] : text.split(",").filter(Boolean);
const writeList = (all: readonly string[], chosen: readonly string[] | null): string | null =>
  chosen === null || chosen.length === all.length ? null : chosen.length === 0 ? "none" : chosen.join(",");

export function readTableFilters(query: URLSearchParams, kind: Kind | null): TableFilters {
  const kindFilters: Record<string, readonly string[]> = {};
  for (const filter of kind ? KIND_FILTERS[kind] : []) {
    const chosen = listOf(query.get(`f.${filter.key}`));
    if (chosen) kindFilters[filter.key] = chosen;
  }
  const states = listOf(query.get("state"));
  const audiences = listOf(query.get("who"));
  return {
    q: query.get("q") ?? "",
    sources: listOf(query.get("source")),
    states: states ? ROW_STATES.filter((state) => states.includes(state)) : DEFAULT_STATES,
    audiences: audiences ? AUDIENCES.filter((audience) => audiences.includes(audience)) : AUDIENCES,
    problems: query.get("problems") === "1",
    from: dayOf(query.get("from")),
    to: dayOf(query.get("to")),
    kind: kindFilters
  };
}

export function writeTableFilters(query: URLSearchParams, filters: TableFilters, sources: readonly string[]) {
  setOrDelete(query, "q", filters.q.trim() ? filters.q : null);
  setOrDelete(query, "source", writeList(sources, filters.sources));
  const states = ROW_STATES.filter((state) => filters.states.includes(state));
  setOrDelete(
    query,
    "state",
    states.join(",") === DEFAULT_STATES.join(",") ? null : states.length === 0 ? "none" : states.join(",")
  );
  setOrDelete(query, "who", writeList(AUDIENCES, filters.audiences));
  setOrDelete(query, "problems", filters.problems ? "1" : null);
  setOrDelete(query, "from", filters.from);
  setOrDelete(query, "to", filters.to);
  for (const key of [...query.keys()]) if (key.startsWith("f.")) query.delete(key);
  for (const [key, values] of Object.entries(filters.kind))
    query.set(`f.${key}`, values.length ? values.join(",") : "none");
}

/** How many of the flyout's filters are set, for the Filters button. A player's table has only Source and the kind's. */
export function activeFilters(filters: TableFilters, gm = true): number {
  return [
    filters.sources !== null,
    gm && filters.states.join(",") !== DEFAULT_STATES.join(","),
    gm && filters.audiences.length !== AUDIENCES.length,
    gm && filters.problems,
    gm && (filters.from !== null || filters.to !== null),
    ...Object.keys(filters.kind).map(() => true)
  ].filter(Boolean).length;
}

const sourceKey = (row: CompendiumRow) => (row.source === "srd" ? "srd" : (row.packId ?? "table"));

export function filterRows(rows: readonly CompendiumRow[], filters: TableFilters, kind: Kind | null): CompendiumRow[] {
  const needle = filters.q.trim().toLowerCase();
  const [start, end] = dayRange(filters.from, filters.to);
  const kindFilters = kind ? KIND_FILTERS[kind] : [];
  return rows.filter((row) => {
    if (needle && !row.name.toLowerCase().includes(needle)) return false;
    if (filters.sources && !filters.sources.includes(sourceKey(row))) return false;
    if (row.state !== undefined) {
      if (!filters.states.includes(stateOf(row))) return false;
      if (row.audience && !filters.audiences.includes(row.audience)) return false;
    }
    if (filters.problems && !(row.issueCount && row.issueCount > 0)) return false;
    if (filters.from !== null || filters.to !== null) {
      const at = row.updatedAt ? new Date(row.updatedAt).getTime() : null;
      if (at === null || at < start || at > end) return false;
    }
    for (const filter of kindFilters) {
      const chosen = filters.kind[filter.key];
      if (!chosen) continue;
      const value = filter.value(row.columns);
      if (value === null || !chosen.includes(value)) return false;
    }
    return true;
  });
}

/** The columns a table sorts on: its name, its kind's columns, and the row's state. */
export type SortKey = string;
export type SortLevel = SortLevelOf<SortKey>;
export const DEFAULT_SORT: readonly SortLevel[] = [{ key: "name", direction: "asc" }];

export function sortKeys(kind: Kind | null, gm: boolean): readonly SortKey[] {
  return [
    "name",
    ...(kind ? KIND_COLUMNS[kind].map((column) => column.key) : ["kind"]),
    "source",
    ...(gm ? ["state", "who", "problems", "modified"] : [])
  ];
}

export function sortLabels(kind: Kind | null): Readonly<Record<SortKey, string>> {
  return {
    name: "Name",
    kind: "Kind",
    source: "Source",
    state: "State",
    who: "Who sees it",
    problems: "Problems",
    modified: "Modified",
    ...Object.fromEntries((kind ? KIND_COLUMNS[kind] : []).map((column) => [column.key, column.label]))
  };
}

export function readTableSort(query: URLSearchParams, kind: Kind | null, gm: boolean): readonly SortLevel[] {
  return readSort(query, sortKeys(kind, gm), DEFAULT_SORT);
}

/** How a direction reads for a column: words A to Z, numbers lowest first, dates newest first. */
export function directionLabel(key: SortKey, direction: SortDirection, kind: Kind | null): string {
  if (key === "modified") return direction === "desc" ? "Newest first" : "Oldest first";
  if (key === "problems") return direction === "desc" ? "Most first" : "Fewest first";
  if (key === "state") return direction === "asc" ? "Published first" : "Archived first";
  if (key === "who") return direction === "asc" ? "Hidden first" : "Hidden last";
  const column = kind ? KIND_COLUMNS[kind].find((entry) => entry.key === key) : undefined;
  if (column?.numeric || key === "level") return direction === "asc" ? "Lowest first" : "Highest first";
  return direction === "asc" ? "A to Z" : "Z to A";
}

export const firstDirection = (key: SortKey): SortDirection =>
  key === "modified" || key === "problems" ? "desc" : "asc";

const SOURCE_RANK = (row: CompendiumRow) => (row.source === "srd" ? 0 : row.packId === "table" ? 1 : 2);
const AUDIENCE_RANK: Readonly<Record<Audience, number>> = { hidden: 0, characters: 1, everyone: 2 };

export function sortRows(
  rows: readonly CompendiumRow[],
  levels: readonly SortLevel[],
  kind: Kind | null,
  names: Names
): CompendiumRow[] {
  const columns = kind ? KIND_COLUMNS[kind] : [];
  const valueOf = (key: SortKey, row: CompendiumRow): number | string => {
    switch (key) {
      case "name":
        return row.name.toLowerCase();
      case "kind":
        return kindLabel(row.kind);
      case "source":
        return SOURCE_RANK(row);
      case "state":
        return ROW_STATES.indexOf(stateOf(row));
      case "who":
        return row.audience ? AUDIENCE_RANK[row.audience] : 3;
      case "problems":
        return row.issueCount ?? 0;
      case "modified":
        return row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      default: {
        const column = columns.find((entry) => entry.key === key);
        return column ? column.sort(row.columns, names) : 0;
      }
    }
  };
  const compare = (left: number | string, right: number | string) =>
    typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
  return [...rows].sort((left, right) => {
    for (const level of levels) {
      const result = compare(valueOf(level.key, left), valueOf(level.key, right));
      if (result !== 0) return level.direction === "asc" ? result : -result;
    }
    return left.name.localeCompare(right.name);
  });
}

/** "Level 3 · 40 spells · sorted by Name": what the table holds, said once over it. */
export function tableSummary(
  shown: number,
  kind: Kind | null,
  filters: TableFilters,
  levels: readonly SortLevel[],
  labels: Readonly<Record<SortKey, string>>
): string {
  const noun = kind ? (shown === 1 ? kindLabel(kind) : pluralLower(kind)) : shown === 1 ? "record" : "records";
  const parts: string[] = [];
  if (filters.problems) parts.push("Has problems");
  const firstKind = kind ? KIND_FILTERS[kind][0] : undefined;
  const chosen = firstKind ? filters.kind[firstKind.key] : undefined;
  if (firstKind && chosen && chosen.length > 0 && chosen.length <= 3)
    parts.push(`${firstKind.label} ${chosen.map(firstKind.word).join(", ")}`);
  parts.push(`${shown} ${noun}`);
  parts.push(`sorted by ${levels.map((level) => labels[level.key] ?? level.key).join(", then ")}`);
  return parts.join(" · ");
}

const pluralLower = (kind: Kind) => kindPlural(kind).toLowerCase();
