import type { CodexBacklinkRow, CodexEntityType, CodexJournalRow, CodexMapRow, CodexMarkerRow, CodexPageRow, CodexPageSummaryRow, CodexRecordKind, CodexRelationshipRow, CodexRelationshipView } from "./codex-store.js";

/**
 * The codex viewer-safety boundary. Two-layer pages carry a player-facing body AND a GM-secret body;
 * players must only ever receive `playerBody` of REVEALED pages, never `gmBody` and never an unrevealed
 * page. This module is the single audited choke point - every player-facing codex read projects through
 * these functions, which destructure the GM-only fields away (the same discipline `projections.ts` uses
 * for actor `notes`). Do the stripping here, never in the store or the router.
 */

/** A page as the GM sees it - everything, both bodies. */
export type GmCodexPage = CodexPageRow;

/** A page as a player sees it: the player body only, no `gmBody`, no `rev`, and only when revealed. */
export type PlayerCodexPage = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  fields: Readonly<Record<string, string>>;
  folder: string | null;
  tags: readonly string[];
  body: string;
  bannerAssetId: string | null;
  updatedAt: string;
}>;

export type GmCodexPageSummary = CodexPageSummaryRow;
export type PlayerCodexPageSummary = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  folder: string | null;
  tags: readonly string[];
  bannerAssetId: string | null;
  updatedAt: string;
}>;

export type CodexBacklink = Readonly<{ sourcePageId: string; sourceTitle: string; section: string | null }>;

export function projectGmPage(row: CodexPageRow): GmCodexPage {
  return row;
}

/** null when the page is not revealed to players; otherwise the player-facing projection (no gmBody, no gmFields). */
export function projectPlayerPage(row: CodexPageRow): PlayerCodexPage | null {
  if (!row.revealedToPlayers) return null;
  // Explicit allow-list: gmBody, gmFields, and rev never enter the returned object. `fields` is the
  // player-facing quick-reference (revealed with the page); GM-only structured attributes live in
  // `gmFields` (secret motives etc.) and are dropped here exactly like gmBody.
  return { id: row.id, title: row.title, entityType: row.entityType, fields: row.fields, folder: row.folder, tags: row.tags, body: row.playerBody, bannerAssetId: row.bannerAssetId, updatedAt: row.updatedAt };
}

export function projectGmPageSummary(row: CodexPageSummaryRow): GmCodexPageSummary {
  return row;
}

export function projectPlayerPageSummary(row: CodexPageSummaryRow): PlayerCodexPageSummary | null {
  if (!row.revealedToPlayers) return null;
  return { id: row.id, title: row.title, entityType: row.entityType, folder: row.folder, tags: row.tags, bannerAssetId: row.bannerAssetId, updatedAt: row.updatedAt };
}

// ----- Relationships -----

export function projectGmRelationships(views: readonly CodexRelationshipView[]): CodexRelationshipView[] {
  return [...views];
}
/** A player sees an edge only when the OTHER endpoint is revealed (the page they're on already is). */
export function projectPlayerRelationships(views: readonly CodexRelationshipView[]): CodexRelationshipView[] {
  return views.filter((view) => view.otherRevealed);
}
/** The whole-graph edge feed: a player sees an edge only when BOTH endpoints are revealed pages. */
export function projectPlayerRelationshipEdges(edges: readonly CodexRelationshipRow[], revealedPageIds: ReadonlySet<string>): CodexRelationshipRow[] {
  return edges.filter((edge) => revealedPageIds.has(edge.fromPageId) && revealedPageIds.has(edge.toPageId));
}

// ----- Maps -----

export type GmCodexMap = CodexMapRow;
export type PlayerCodexMap = Readonly<{ id: string; assetId: string; name: string; kind: CodexMapRow["kind"]; parentMapId: string | null; tags: readonly string[] }>;

export function projectGmMap(row: CodexMapRow): GmCodexMap { return row; }
/**
 * null unless the map is revealed. `parentMapId` survives ONLY when the parent map is itself revealed -
 * otherwise a revealed child would leak the id of a still-secret ancestor (the same target-reveal
 * discipline the marker projection applies to page/sub-map links, on the reverse edge). The caller
 * resolves the parent's reveal flag and passes it in.
 */
export function projectPlayerMap(row: CodexMapRow, context: Readonly<{ parentRevealed: boolean }>): PlayerCodexMap | null {
  if (!row.revealedToPlayers) return null;
  return { id: row.id, assetId: row.assetId, name: row.name, kind: row.kind, parentMapId: context.parentRevealed ? row.parentMapId : null, tags: row.tags };
}

// ----- Markers -----

export type GmCodexMarker = CodexMarkerRow;
/** A marker as a player sees it: no scene/actor links (GM-only), and page/sub-map links only when those targets are themselves revealed. */
export type PlayerCodexMarker = Readonly<{
  id: string; mapId: string; x: number; y: number; iconId: string; iconColor: string; label: string | null; pageIds: string[]; subMapId: string | null;
  tags: readonly string[];
}>;

export function projectGmMarker(row: CodexMarkerRow): GmCodexMarker { return row; }

/**
 * null unless the marker is revealed. Of a marker's linked pages, only the ones that are themselves
 * revealed survive (so a pin never advertises a still-secret page); the sub-map link survives only when
 * that map is revealed; scene and actor links are GM-only and always stripped. The caller resolves which
 * targets are revealed and passes them in.
 */
export function projectPlayerMarker(row: CodexMarkerRow, context: Readonly<{ revealedPageIds: ReadonlySet<string>; subMapRevealed: boolean }>): PlayerCodexMarker | null {
  if (!row.revealedToPlayers) return null;
  return {
    id: row.id, mapId: row.mapId, x: row.x, y: row.y, iconId: row.iconId, iconColor: row.iconColor, label: row.label, tags: row.tags,
    pageIds: row.pageIds.filter((pageId) => context.revealedPageIds.has(pageId)),
    subMapId: context.subMapRevealed ? row.subMapId : null
  };
}

// ----- Journal -----

export type GmCodexJournalEntry = CodexJournalRow;
/** A journal entry as a player sees it: player text only, no gmText, no GM-only linkage, only when revealed. */
export type PlayerCodexJournalEntry = Readonly<{
  id: string; text: string; kind: CodexJournalRow["kind"]; sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; tags: readonly string[]; createdAt: string;
}>;

export function projectGmJournalEntry(row: CodexJournalRow): GmCodexJournalEntry { return row; }
export function projectPlayerJournalEntry(row: CodexJournalRow): PlayerCodexJournalEntry | null {
  if (!row.revealedToPlayers) return null;
  return { id: row.id, text: row.playerText, kind: row.kind, sessionNumber: row.sessionNumber, realDate: row.realDate, inWorldLabel: row.inWorldLabel, tags: row.tags, createdAt: row.createdAt };
}

// ----- Suite-wide search (CI-1 / R8: one index, one result list, every record kind) -----

/**
 * One record a search matched, loaded from the store with whatever CONTEXT its player predicate needs.
 * A marker carries its map's reveal flag because a pin's visibility is not its own flag alone (CD-6).
 */
export type CodexSearchRecord =
  | Readonly<{ kind: "page"; page: CodexPageRow }>
  | Readonly<{ kind: "journal"; entry: CodexJournalRow }>
  | Readonly<{ kind: "map"; map: CodexMapRow }>
  | Readonly<{ kind: "marker"; marker: CodexMarkerRow; mapRevealed: boolean }>;

/**
 * One row in the single result list. Uniform on purpose - `kind` tells the client where to navigate,
 * and every key is present on every kind (null where it does not apply) so nothing branches on key
 * presence. Deliberately NARROW: it carries only what is needed to render a row and open the record.
 *
 * Every field re-checked against the player LIST projection it must not exceed:
 *   `title`  - page title / map name / marker label, each already in that kind's player projection;
 *              for a journal entry it is an EXCERPT of the layer-appropriate text, and a player's
 *              excerpt is taken from `playerText` only - which `projectPlayerJournalEntry` already
 *              hands that player in full.
 *   `tags`   - player-visible on all four kinds (pages always were; CI-2 put them on the other three,
 *              and each player projection emits them).
 *   `entityType` - `projectPlayerPageSummary` emits it; null for the other kinds.
 *   `mapId`  - `projectPlayerMarker` emits it, and a player only ever gets a marker hit when that map
 *              is revealed, so this can never name a secret map; null for the other kinds.
 * Nothing else is added without re-running this check. No bodies, no reveal flags, no parent links,
 * no scene/actor ids, no `rev`.
 */
export type CodexSearchHit = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  entityType: CodexEntityType | null;
  mapId: string | null;
}>;

const EXCERPT_LENGTH = 160;
/** A journal entry has no title, so the result row shows a bounded one-line excerpt of its text. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
}

export function projectGmSearchHit(record: CodexSearchRecord): CodexSearchHit {
  switch (record.kind) {
    case "page": return { kind: "page", id: record.page.id, title: record.page.title, tags: record.page.tags, entityType: record.page.entityType, mapId: null };
    // The GM may see either layer, so an entry with no player text still shows something useful.
    case "journal": return { kind: "journal", id: record.entry.id, title: excerpt(record.entry.playerText || record.entry.gmText || ""), tags: record.entry.tags, entityType: null, mapId: null };
    case "map": return { kind: "map", id: record.map.id, title: record.map.name, tags: record.map.tags, entityType: null, mapId: null };
    case "marker": return { kind: "marker", id: record.marker.id, title: record.marker.label ?? "", tags: record.marker.tags, entityType: null, mapId: record.marker.mapId };
  }
}

/**
 * null when this record is not player-visible - the audited gate. The predicate per kind is COPIED
 * from that kind's player LIST endpoint and must never be weaker, or search becomes the leak:
 *   page    -> `projectPlayerPage(Summary)`: revealed only.
 *   journal -> `projectPlayerJournalEntry`: revealed only, and the excerpt reads `playerText` ALONE.
 *   map     -> `projectPlayerMap`: revealed only.
 *   marker  -> `projectPlayerMarker` PLUS the map gate `GET /codex/maps/:id/markers` applies before
 *              projecting anything (CD-6): a revealed pin on a secret map is invisible to players.
 * The store's SQL applies the same predicate so hidden records don't crowd the result cap; this is
 * the layer that makes it a safety property rather than an optimization.
 */
export function projectPlayerSearchHit(record: CodexSearchRecord): CodexSearchHit | null {
  switch (record.kind) {
    case "page":
      return record.page.revealedToPlayers ? { kind: "page", id: record.page.id, title: record.page.title, tags: record.page.tags, entityType: record.page.entityType, mapId: null } : null;
    case "journal":
      return record.entry.revealedToPlayers ? { kind: "journal", id: record.entry.id, title: excerpt(record.entry.playerText), tags: record.entry.tags, entityType: null, mapId: null } : null;
    case "map":
      return record.map.revealedToPlayers ? { kind: "map", id: record.map.id, title: record.map.name, tags: record.map.tags, entityType: null, mapId: null } : null;
    case "marker":
      return record.marker.revealedToPlayers && record.mapRevealed
        ? { kind: "marker", id: record.marker.id, title: record.marker.label ?? "", tags: record.marker.tags, entityType: null, mapId: record.marker.mapId }
        : null;
  }
}

export function projectGmBacklinks(rows: readonly CodexBacklinkRow[]): CodexBacklink[] {
  return rows.map((row) => ({ sourcePageId: row.sourcePageId, sourceTitle: row.sourceTitle, section: row.section }));
}

/**
 * A player sees a backlink only when it came from the player-facing body of a page THEY can see - so a
 * GM-body reference, or a reference from a still-secret page, never reveals that a hidden page points here.
 */
export function projectPlayerBacklinks(rows: readonly CodexBacklinkRow[]): CodexBacklink[] {
  return rows
    .filter((row) => row.layer === "player" && row.sourceRevealed)
    .map((row) => ({ sourcePageId: row.sourcePageId, sourceTitle: row.sourceTitle, section: row.section }));
}
