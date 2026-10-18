import type { HomebrewType } from "../homebrew/types";

type Kind = HomebrewType;

/** The address word for a kind: `/compendium/tables/spells`, `/compendium/items/<id>`. */
export const KIND_SLUG: Readonly<Record<Kind, string>> = {
  class: "classes",
  subclass: "subclasses",
  species: "species",
  background: "backgrounds",
  feat: "feats",
  spell: "spells",
  "spell-list": "spell-lists",
  equipment: "items",
  monster: "monsters"
};
export const kindOfSlug = (slug: string | undefined): Kind | null =>
  (Object.entries(KIND_SLUG) as Array<[Kind, string]>).find(([, value]) => value === slug)?.[0] ?? null;

/**
 * The Compendium's addresses. Every view has one, and so does every record, SRD or homebrew, so a link or a reload
 * lands where the GM was. The table's filters and sort ride in the query beside a record's tab, so the table folded
 * beside a record keeps its kind and filters.
 *
 *   /compendium                       Overview
 *   /compendium/tables                every kind's table, Kind: All
 *   /compendium/tables/<kinds>        one kind's table (`spells`, `items`, `monsters`)
 *   /compendium/sources               Sources: packs, import and export
 *   /compendium/sharing               who sees what, as a grid
 *   /compendium/<kinds>/<id>          one record: `?tab=card|edit|sharing|history`, `&step=<step>`, `&as=<who>`
 *
 * The old `/homebrew` redirects here.
 */

export const COMPENDIUM_ROOT = "/compendium";

export type CompendiumSection = "overview" | "tables" | "sources" | "sharing";
export type RecordTab = "card" | "edit" | "sharing" | "history";
export const RECORD_TABS: readonly RecordTab[] = ["card", "edit", "sharing", "history"];

export type CompendiumView =
  | Readonly<{ view: "overview" }>
  /** `kind` null is Kind: All. */
  | Readonly<{ view: "tables"; kind: Kind | null }>
  | Readonly<{ view: "sources" }>
  | Readonly<{ view: "sharing" }>
  | Readonly<{ view: "record"; kind: Kind; id: string; tab: RecordTab }>;

const ID = /^[a-z0-9-]{1,80}$/;

/** The view an address under `/compendium` names, or null when it names none. */
export function compendiumViewOf(segments: readonly string[], query: URLSearchParams): CompendiumView | null {
  if (segments[0] !== "compendium") return null;
  const [, second, third] = segments;
  if (segments.length === 1) return { view: "overview" };
  if (segments.length > 3 || !second) return null;
  if (second === "tables") {
    if (segments.length === 2) return { view: "tables", kind: null };
    const kind = kindOfSlug(third);
    return kind ? { view: "tables", kind } : null;
  }
  if (segments.length === 2) {
    if (second === "sources") return { view: "sources" };
    if (second === "sharing") return { view: "sharing" };
    return null;
  }
  const kind = kindOfSlug(second);
  if (!kind || !third || !ID.test(third)) return null;
  const tab = query.get("tab");
  return { view: "record", kind, id: third, tab: RECORD_TABS.includes(tab as RecordTab) ? (tab as RecordTab) : "card" };
}

export function sectionOf(view: CompendiumView): CompendiumSection {
  if (view.view === "record") return "tables";
  return view.view;
}

export const COMPENDIUM_PATHS = {
  overview: COMPENDIUM_ROOT,
  tables: `${COMPENDIUM_ROOT}/tables`,
  sources: `${COMPENDIUM_ROOT}/sources`,
  sharing: `${COMPENDIUM_ROOT}/sharing`
} as const;

export const tablePath = (kind: Kind | null) =>
  kind ? `${COMPENDIUM_PATHS.tables}/${KIND_SLUG[kind]}` : COMPENDIUM_PATHS.tables;
export const recordPath = (kind: Kind, id: string) => `${COMPENDIUM_ROOT}/${KIND_SLUG[kind]}/${id}`;

/** The query keys a record's view owns; every other key is the table's, and travels with it. */
export const RECORD_KEYS = ["tab", "step", "as", "view", "new"] as const;

/** An address with the table's filters kept and the record's own keys replaced. */
export function withTableQuery(
  path: string,
  query: URLSearchParams,
  own: Readonly<Record<string, string | null | undefined>> = {}
): string {
  const next = new URLSearchParams(query);
  for (const key of RECORD_KEYS) next.delete(key);
  for (const [key, value] of Object.entries(own)) if (value) next.set(key, value);
  const search = next.toString();
  return search ? `${path}?${search}` : path;
}
