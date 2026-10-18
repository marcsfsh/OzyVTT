import { z } from "zod";
import {
  CODEX_SEARCH_SORT_KEYS,
  CODEX_SEARCH_TYPES,
  CODEX_SEARCH_VISIBILITIES,
  type CodexSearchType
} from "@vtt/domain";
import { DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT, type CodexFindQuery, type CodexSortLevel } from "./codex/find.js";
import { CodexValidationError } from "./codex/validate.js";

/**
 * The Codex's query strings, read with the messages a GM sees. The write bodies are in `@vtt/api-contract/schemas`,
 * and the route registry documents these parameters from `CodexSearchQuerySchema` and `CodexHomeQuerySchema` there;
 * `codex-queries.test.ts` checks the two agree.
 */

// ----- Query strings -----

/** A query parameter as one string: a repeated one is joined with commas, as a comma list reads. */
function queryText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String).join(",");
  return String(value);
}
function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A bound on a modified date: a whole UTC day for `YYYY-MM-DD`, else an ISO date and time. */
function dateBound(value: string | undefined, end: "start" | "end"): string | null {
  if (value === undefined || value.trim() === "") return null;
  const text = value.trim();
  const instant = DAY.test(text) ? `${text}T${end === "start" ? "00:00:00.000" : "23:59:59.999"}Z` : text;
  const parsed = Date.parse(instant);
  if (Number.isNaN(parsed) || !(DAY.test(text) || z.iso.datetime({ offset: true }).safeParse(text).success))
    throw new CodexValidationError("Give a modified date as 2026-10-17, or as an ISO date and time.");
  return new Date(parsed).toISOString();
}
const SORT_KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PAGE_TYPES: readonly CodexSearchType[] = CODEX_SEARCH_TYPES.slice(0, CODEX_SEARCH_TYPES.indexOf("journal"));

/** `GET /codex/search`'s parameters. Every one is optional; a malformed one is a 400. */
export function parseSearchQuery(raw: Readonly<Record<string, unknown>>): CodexFindQuery {
  const types = new Set<CodexSearchType>();
  for (const type of commaList(queryText(raw.types))) {
    if (type === "page") PAGE_TYPES.forEach((pageType) => types.add(pageType));
    else if ((CODEX_SEARCH_TYPES as readonly string[]).includes(type)) types.add(type as CodexSearchType);
    else throw new CodexValidationError(`"${type}" is not a type search knows.`);
  }
  const visibility = queryText(raw.visibility) ?? "all";
  if (!(CODEX_SEARCH_VISIBILITIES as readonly string[]).includes(visibility))
    throw new CodexValidationError("Visibility is all, revealed or hidden.");
  const sort = commaList(queryText(raw.sort)).map((level): CodexSortLevel => {
    const [key = "", direction = "asc"] = level.split(":");
    if (!SORT_KEY.test(key) && !(CODEX_SEARCH_SORT_KEYS as readonly string[]).includes(key))
      throw new CodexValidationError(`"${key}" is not a column search can sort by.`);
    if (direction !== "asc" && direction !== "desc") throw new CodexValidationError("Sort each column asc or desc.");
    return { key, direction };
  });
  if (sort.length > 4) throw new CodexValidationError("Sort by at most 4 columns.");
  const limitText = queryText(raw.limit);
  const limit = limitText === undefined ? DEFAULT_FIND_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FIND_LIMIT)
    throw new CodexValidationError(`Ask for 1 to ${MAX_FIND_LIMIT} results.`);
  const q = queryText(raw.q) ?? "";
  if (q.length > 200) throw new CodexValidationError("A search is up to 200 characters.");
  return {
    q,
    types,
    visibility: visibility as CodexFindQuery["visibility"],
    modifiedFrom: dateBound(queryText(raw.modifiedFrom), "start"),
    modifiedTo: dateBound(queryText(raw.modifiedTo), "end"),
    sort,
    limit
  };
}

/** `GET /codex/home`'s `since`: when the player last looked, as an ISO date and time. */
export function parseHomeSince(raw: Readonly<Record<string, unknown>>): string | null {
  const since = queryText(raw.since);
  if (since === undefined || since.trim() === "") return null;
  if (!z.iso.datetime({ offset: true }).safeParse(since.trim()).success)
    throw new CodexValidationError("Give `since` as an ISO date and time.");
  return new Date(Date.parse(since.trim())).toISOString();
}
