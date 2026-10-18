import type { SortChoice } from "../codex/search/SearchView";
import { GROUPS, METHOD_ORDER, type OpenApiDocument, type Operation } from "./openapi-model";

/**
 * The API reference's rows: each operation of the served document with its tag, summary and who may call it, and
 * the filters and sort the table applies to them.
 */

export type OperationRow = Readonly<{
  /** The operation id, or a stand-in made from its method and path; the address names it. */
  key: string;
  method: string;
  path: string;
  operation: Operation;
  tag: string;
  /** Where the tag stands in the document's own list of groups, so sorting by tag keeps the server's order. */
  tagRank: number;
  /** The document's sentence about the tag, when it has one. */
  tagNote?: string;
  summary: string;
  callers: readonly Caller[];
  scopes: readonly string[];
}>;

export type Caller = "anyone" | "gm" | "player" | "integration" | "screen";
export const CALLER_WORDS: Readonly<Record<Caller, string>> = {
  anyone: "Anyone",
  gm: "GM session",
  player: "Player session",
  integration: "Integration",
  screen: "Paired screen"
};

/** Who can call an operation, from its security requirements. */
export function callersOf(operation: Operation): readonly Caller[] {
  const security = operation.security;
  if (!security || security.length === 0) return ["anyone"];
  const callers = security.flatMap((entry): Caller[] => {
    if ("bearerAuth" in entry) return ["integration"];
    if ("gmAuth" in entry) return ["gm"];
    if ("playerAuth" in entry) return ["player"];
    if ("viewerCookieAuth" in entry) return ["screen"];
    return [];
  });
  return [...new Set(callers)];
}

/** "createIntegrationCredential" as words: "Create integration credential". */
export const wordsOf = (operationId: string) => {
  const words = operationId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const firstSentence = (text: string | undefined) => {
  const match = /^(.+?[.!?])(\s|$)/.exec((text ?? "").trim());
  return match ? match[1] : (text ?? "").trim();
};

/** The document's operations as rows. The tag comes from the document; a document without tags is grouped by path. */
export function operationRows(document: OpenApiDocument): readonly OperationRow[] {
  const declared = (document.tags ?? []).map((tag) => tag.name);
  const fallback = GROUPS.map((group) => group.title);
  return Object.entries(document.paths).flatMap(([path, operations]) =>
    METHOD_ORDER.filter((method) => operations[method]).map((method) => {
      const operation = operations[method] as Operation;
      const tag = operation.tags?.[0] ?? GROUPS.find((group) => group.match(path))?.title ?? "Other";
      const [declaredAt, fallbackAt] = [declared.indexOf(tag), fallback.indexOf(tag)];
      return {
        key: operation.operationId ?? `${method}${path.replace(/[^A-Za-z0-9]+/g, "_")}`,
        method,
        path,
        operation,
        tag,
        // The document's groups first, then the path groups an untagged document falls back on, then the rest.
        tagRank:
          declaredAt >= 0
            ? declaredAt
            : fallbackAt >= 0
              ? declared.length + fallbackAt
              : declared.length + fallback.length,
        tagNote: document.tags?.find((entry) => entry.name === tag)?.description,
        // A document without a summary or a description still names the operation, from its id.
        summary:
          operation.summary ??
          (firstSentence(operation.description) || (operation.operationId ? wordsOf(operation.operationId) : "")),
        callers: callersOf(operation),
        scopes: [
          ...new Set((operation.security ?? []).flatMap((entry) => ("bearerAuth" in entry ? entry.bearerAuth : [])))
        ]
      };
    })
  );
}

export type ApiSortKey = "tag" | "path" | "method" | "operation";
export const SORT_WORDS: Readonly<Record<ApiSortKey, string>> = {
  tag: "Tag",
  path: "Path",
  method: "Method",
  operation: "Operation id"
};
export const DEFAULT_SORT: readonly SortChoice<ApiSortKey>[] = [
  { key: "tag", direction: "asc" },
  { key: "path", direction: "asc" }
];

export type ApiFilters = Readonly<{
  text: string;
  /** Null is every tag. */
  tags: readonly string[] | null;
  methods: readonly string[];
  callers: readonly Caller[];
  scopes: readonly string[];
}>;
export const NO_FILTERS: ApiFilters = { text: "", tags: null, methods: [], callers: [], scopes: [] };

const byTag = (a: OperationRow, b: OperationRow) => a.tagRank - b.tagRank || a.tag.localeCompare(b.tag);

/** The tags in the order the document lists its groups, each once. */
export function tagsOf(rows: readonly OperationRow[]): readonly string[] {
  return [...new Set([...rows].sort(byTag).map((row) => row.tag))];
}

/** The rows the table shows: every filter narrows them, and an empty filter group narrows nothing. */
export function visibleRows(
  rows: readonly OperationRow[],
  filters: ApiFilters,
  sort: readonly SortChoice<ApiSortKey>[]
): readonly OperationRow[] {
  const words = filters.text.toLowerCase().split(/\s+/).filter(Boolean);
  const kept = rows.filter(
    (row) =>
      (filters.tags === null || filters.tags.includes(row.tag)) &&
      (filters.methods.length === 0 || filters.methods.includes(row.method)) &&
      (filters.callers.length === 0 || row.callers.some((caller) => filters.callers.includes(caller))) &&
      (filters.scopes.length === 0 || row.scopes.some((scope) => filters.scopes.includes(scope))) &&
      words.every((word) => `${row.path} ${row.key} ${row.summary}`.toLowerCase().includes(word))
  );
  const compare = (a: OperationRow, b: OperationRow, key: ApiSortKey): number =>
    key === "tag"
      ? byTag(a, b)
      : key === "method"
        ? METHOD_ORDER.indexOf(a.method as (typeof METHOD_ORDER)[number]) -
          METHOD_ORDER.indexOf(b.method as (typeof METHOD_ORDER)[number])
        : key === "operation"
          ? a.key.localeCompare(b.key)
          : a.path.localeCompare(b.path);
  return [...kept].sort((a, b) => {
    for (const level of sort) {
      const order = compare(a, b, level.key);
      if (order !== 0) return level.direction === "asc" ? order : -order;
    }
    return 0;
  });
}
