import { CODEX_SEARCH_TYPES, type CodexSearchType, type CodexSearchVisibility } from "../contract";

/**
 * Search's filters as its address holds them (`?q=&types=&visibility=&from=&to=&sort=`), so a filtered search is a
 * link and survives a refresh, and the words each filter shows.
 */

export const SEARCH_TYPE_LABEL: Readonly<Record<CodexSearchType, string>> = {
  character: "Character",
  location: "Location",
  faction: "Faction",
  item: "Item",
  religion: "Religion",
  species: "Species",
  event: "Event",
  note: "Note",
  session: "Session",
  quest: "Quest",
  marker: "Pin",
  map: "Map",
  journal: "Chronicle entry"
};

/** The order the Type menu lists them in: the kinds of page first, then the other records. */
export const SEARCH_TYPE_ORDER: readonly CodexSearchType[] = [
  "character",
  "location",
  "faction",
  "item",
  "religion",
  "species",
  "event",
  "note",
  "session",
  "quest",
  "marker",
  "map",
  "journal"
];

export type SortKey = "relevance" | "name" | "type" | "modified" | "visibility";
export type SortLevel = Readonly<{ key: SortKey; direction: "asc" | "desc" }>;

export const SORT_KEY_LABEL: Readonly<Record<SortKey, string>> = {
  relevance: "Best match",
  name: "Name",
  type: "Type",
  modified: "Modified",
  visibility: "Who sees it"
};

/** How a direction reads for a key: names and types read A to Z, dates newest first. */
export function directionLabel(key: SortKey, direction: "asc" | "desc"): string {
  if (key === "modified") return direction === "desc" ? "Newest first" : "Oldest first";
  if (key === "visibility") return direction === "asc" ? "Everyone first" : "Hidden first";
  if (key === "relevance") return direction === "asc" ? "Best first" : "Worst first";
  return direction === "asc" ? "A to Z" : "Z to A";
}

export const MAX_SORT_LEVELS = 4;

export type SearchFilters = Readonly<{
  q: string;
  /** Null means every type; empty means none is ticked. */
  types: readonly CodexSearchType[] | null;
  visibility: CodexSearchVisibility;
  from: string | null;
  to: string | null;
  sort: readonly SortLevel[];
}>;

const SORT_KEYS: readonly SortKey[] = ["relevance", "name", "type", "modified", "visibility"];

export function readFilters(query: URLSearchParams, role: "gm" | "player"): SearchFilters {
  const typesText = query.get("types") ?? "";
  const types = typesText
    .split(",")
    .map((type) => type.trim())
    .filter((type): type is CodexSearchType => (CODEX_SEARCH_TYPES as readonly string[]).includes(type));
  const visibility = query.get("visibility");
  const sort = (query.get("sort") ?? "")
    .split(",")
    .map((part) => {
      const [key, direction] = part.split(":");
      return SORT_KEYS.includes(key as SortKey)
        ? ({ key: key as SortKey, direction: direction === "desc" ? "desc" : "asc" } as SortLevel)
        : null;
    })
    .filter((level): level is SortLevel => level !== null && (role === "gm" || level.key !== "visibility"))
    .slice(0, MAX_SORT_LEVELS);
  return {
    q: query.get("q") ?? "",
    // `none` is every type cleared, which finds nothing until one is ticked again.
    types: typesText === "none" ? [] : types.length > 0 && types.length < CODEX_SEARCH_TYPES.length ? types : null,
    visibility: role === "gm" && (visibility === "hidden" || visibility === "revealed") ? visibility : "all",
    from: query.get("from"),
    to: query.get("to"),
    sort
  };
}

/** The query keys a change writes; an empty value clears its key. */
export function filterPatch(next: Partial<SearchFilters>): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  if ("q" in next) patch.q = next.q?.trim() ? next.q : null;
  if ("types" in next) patch.types = next.types ? (next.types.length > 0 ? next.types.join(",") : "none") : null;
  if ("visibility" in next) patch.visibility = next.visibility && next.visibility !== "all" ? next.visibility : null;
  if ("from" in next) patch.from = next.from ?? null;
  if ("to" in next) patch.to = next.to ?? null;
  if ("sort" in next)
    patch.sort =
      next.sort && next.sort.length > 0 ? next.sort.map((level) => `${level.key}:${level.direction}`).join(",") : null;
  return patch;
}

/** The sort the server applies when none is chosen: best match with a query, else by name. */
export function defaultSort(q: string): readonly SortLevel[] {
  return q.trim()
    ? [
        { key: "relevance", direction: "asc" },
        { key: "name", direction: "asc" }
      ]
    : [{ key: "name", direction: "asc" }];
}

/** "Sort: Type, then Modified". */
export function sortSummary(levels: readonly SortLevel[]): string {
  return `Sort: ${levels.map((level) => SORT_KEY_LABEL[level.key]).join(", then ")}`;
}

/** A day as the date filter shows it: "September 1". */
export function dayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" });
}

/** When a record last changed, the way a list reads it: Today, Yesterday, or the day. */
export function modifiedLabel(at: string | null, now: Date = new Date()): string {
  if (!at) return "None";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "None";
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {})
  });
}
