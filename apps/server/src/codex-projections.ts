import type { CodexBacklinkRow, CodexChronicleRecord, CodexEntityType, CodexInWorldDate, CodexJournalRow, CodexLinkEdgeRow, CodexMapRow, CodexMarkerRow, CodexPageRow, CodexPageSummaryRow, CodexQuestObjective, CodexQuestRow, CodexQuestStatus, CodexRecordKind, CodexRelationshipRow, CodexRelationshipView, CodexSessionRow } from "./codex-store.js";

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

// ----- Wiki-link edges (CI-8: the Graph's second edge kind, beside the typed relationships) -----

/** One `[[wiki link]]` edge as either audience receives it. `layer` is store-side bookkeeping and never ships. */
export type CodexLinkEdge = Readonly<{ fromPageId: string; toPageId: string }>;

export function projectGmLinkEdges(edges: readonly CodexLinkEdgeRow[]): CodexLinkEdge[] {
  return edges.map((edge) => ({ fromPageId: edge.fromPageId, toPageId: edge.toPageId }));
}

/**
 * The player's wiki-link graph. TWO rules, each copied from the feed that already enforces it rather
 * than invented here:
 *   1. BOTH endpoints revealed - `projectPlayerRelationshipEdges`. An edge with one visible end is worse
 *      than useless: it tells a player a page they cannot see EXISTS, and draws them a line to it.
 *   2. The `player` layer only - `projectPlayerBacklinks`. A link written in a page's GM body is a GM
 *      note about a connection, not a connection the players have been shown; the revealed player body
 *      of the very same page may say nothing of the sort.
 * Both must hold. Rule 1 alone would leak GM-body links between two revealed pages; rule 2 alone would
 * leak the existence of unrevealed pages linked from a revealed player body.
 */
export function projectPlayerLinkEdges(edges: readonly CodexLinkEdgeRow[], revealedPageIds: ReadonlySet<string>): CodexLinkEdge[] {
  return edges
    .filter((edge) => edge.layer === "player" && revealedPageIds.has(edge.fromPageId) && revealedPageIds.has(edge.toPageId))
    .map((edge) => ({ fromPageId: edge.fromPageId, toPageId: edge.toPageId }));
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

/**
 * One marker of CI-4's page -> markers reverse lookup, with the CONTEXT its player predicate needs.
 * `mapRevealed` rides along for the same reason `CodexSearchRecord` carries it: reached by PAGE id, a pin
 * arrives without its map's gate having been applied, and a pin's visibility is not its own flag alone.
 */
export type CodexPageMarkerRecord = Readonly<{
  marker: CodexMarkerRow;
  mapRevealed: boolean;
  revealedPageIds: ReadonlySet<string>;
  subMapRevealed: boolean;
}>;

/**
 * null unless this pin is player-visible - the audited gate for the reverse lookup. The predicate is
 * COPIED from `GET /codex/maps/:id/markers`, the forward read, and is exactly as strong:
 *   map    -> that route 404s a player on an unrevealed map BEFORE projecting a single pin (CD-6), so a
 *             revealed pin on a secret map is invisible there and must be invisible here. Arriving by
 *             page id rather than map id cannot be the way around it.
 *   marker -> `projectPlayerMarker`, which also filters the pin's own page/sub-map links to the revealed
 *             subset and strips scene/actor ids. This projects THROUGH it rather than reimplementing it,
 *             so the two reads can never drift.
 */
export function projectPlayerPageMarker(record: CodexPageMarkerRecord): PlayerCodexMarker | null {
  if (!record.mapRevealed) return null;
  return projectPlayerMarker(record.marker, { revealedPageIds: record.revealedPageIds, subMapRevealed: record.subMapRevealed });
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

// ----- Sessions (M9: prep is the GM half, recap is the player half) -----

export type GmCodexSession = CodexSessionRow;
/**
 * A session as a PLAYER sees it. Deliberately the tightest projection in this file - four keys - and each
 * omission is a decision, not an oversight:
 *
 *   `prepBody`  - the GM's plan for the evening. The single most secret thing on the record; it is why
 *                 the record is two-layer at all. It has no player-facing form and never gains one.
 *   `rev`       - the editor's conflict token, absent from every other player projection here.
 *   `attendees` - GM-only FOR NOW (P2, secret by default). It is real-world personal data about who came,
 *                 and nothing in the player Codex needs it yet.
 *   `status`    - GM-only FOR NOW, same rule: "planned vs played" is the GM's own scheduling state.
 *
 * Widening either of the last two later is a one-line, reversible change; leaking them is not, which is
 * the whole reason they start out.
 *
 * `recapBody` is renamed `recap` on the way out, matching `playerBody`->`body` and `playerText`->`text`:
 * the layer prefix only means something when there are two layers, and here there is only one left.
 */
export type PlayerCodexSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  realDate: string | null;
  recap: string;
}>;

export function projectGmSession(row: CodexSessionRow): GmCodexSession { return row; }

/** null when unrevealed; otherwise the player layer. prepBody, rev, status and attendees never enter it. */
export function projectPlayerSession(row: CodexSessionRow): PlayerCodexSession | null {
  if (!row.revealedToPlayers) return null;
  // Explicit allow-list, never a spread-and-delete: a field added to `CodexSessionRow` must be added HERE
  // to reach a player, so the default for anything new is secret.
  return { id: row.id, sessionNumber: row.sessionNumber, realDate: row.realDate, recap: row.recapBody };
}

// ----- Quests (M10: playerBody is what the party was told, gmBody is where it is really going) -----

export type GmCodexQuest = CodexQuestRow;
/**
 * A quest as a PLAYER sees it. Each omission and each inclusion is a decision:
 *
 *   `gmBody`     - dropped. It is why the record is two-layer at all, exactly as `gmBody` on a page and
 *                  `prepBody` on a session are, and it has no player-facing form.
 *   `rev`        - dropped. The editor's conflict token, absent from every other player projection here.
 *   `status`     - KEPT, and this is the one place a quest differs from a session (whose `status` is
 *                  GM-only). "What is still open" is the entire point of CT-4: a revealed quest whose
 *                  state the player cannot see would tell them nothing they did not already know, and
 *                  active-vs-completed is a fact about the party's own adventure, not GM scheduling.
 *   `objectives` - KEPT. An objective's text lives beside `playerBody`, not `gmBody` (§2 of the M10
 *                  contract), so it ships with the quest. Order is preserved exactly as stored.
 *   `entityIds`  - KEPT but FILTERED, see below.
 *
 * `playerBody` is renamed `body` on the way out, matching `playerBody`->`body` on a page and
 * `recapBody`->`recap` on a session: the layer prefix only means something when there are two layers.
 */
export type PlayerCodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  body: string;
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
}>;

export function projectGmQuest(row: CodexQuestRow): GmCodexQuest { return row; }

/**
 * null when unrevealed; otherwise the player layer. `gmBody` and `rev` never enter it.
 *
 * `entityIds` survives only for the entities that are THEMSELVES revealed - the identical rule
 * `projectPlayerMarker` applies to a pin's `pageIds`, and it is copied rather than re-derived, including
 * the shape: the CALLER resolves which targets are revealed and passes the set in, because a projection
 * that reached back into the store would be a second place that decides what a player may see.
 *
 * Without the filter a revealed quest would advertise the ids of still-secret pages - "this quest
 * concerns something you cannot see" is the same leak a dangling graph edge is (`projectPlayerLinkEdges`).
 */
export function projectPlayerQuest(row: CodexQuestRow, context: Readonly<{ revealedEntityIds: ReadonlySet<string> }>): PlayerCodexQuest | null {
  if (!row.revealedToPlayers) return null;
  // Explicit allow-list, never a spread-and-delete: a field added to `CodexQuestRow` must be added HERE
  // to reach a player, so the default for anything new is secret.
  return {
    id: row.id, title: row.title, status: row.status, body: row.playerBody,
    objectives: row.objectives,
    entityIds: row.entityIds.filter((entityId) => context.revealedEntityIds.has(entityId))
  };
}

/**
 * A bounded one-line rendering of a record's prose, for any list ROW (a search hit, a chronicle row).
 * One length for the suite: a row that summarises a record the reader can open should look the same
 * everywhere, and two nearly-equal excerpt lengths is the kind of near-duplicate this overhaul removes.
 */
const EXCERPT_LENGTH = 160;
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`;
}

// ----- The chronicle (CT-11 / CT-12: one timeline, journal entries + dated `event` pages) -----

/**
 * What a chronicle row IS, for the reader. R2: one row shape for every record; the kind reads by icon +
 * label, never by colour alone. `combat` is split out from `entry` because it already renders with its own
 * badge and replay edge today and must keep doing so - it is the same store row, discriminated for display.
 */
export type CodexChronicleKind = "entry" | "combat" | "event";

/**
 * One chronicle row as the GM sees it. Flat and uniform on purpose: every key is present on every kind
 * (null where it does not apply), so no reader branches on key *presence* - the same discipline
 * `CodexSearchHit` follows.
 *
 * `id` is the record's OWN id - a journal-entry id for `entry`/`combat`, a page id for `event` - and `kind`
 * is what says which. That is also what "open this row" means, so there is exactly one thing to look at.
 *
 * `text` / `gmText` are the row's two layers. For a journal entry they are the entry's full text, because
 * an entry IS its text and has nowhere else to be read. For an `event` page they are a bounded EXCERPT of
 * the page's two bodies, because the page itself is the place to read them and a chronicle that inlined
 * 100k-character wiki bodies would be a page list wearing a timeline's clothes. The excerpt helper is the
 * one search rows already use - one bounded-row-text rule for the suite, not two.
 */
export type GmCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  /** An `event` page's title. `null` for a journal entry, which has no name. */
  title: string | null;
  text: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  tags: readonly string[];
  attachPageId: string | null;
  attachMarkerId: string | null;
  sourceEncounterId: number | null;
  createdAt: string;
  updatedAt: string;
}>;

/**
 * One chronicle row as a PLAYER sees it. This is `PlayerCodexJournalEntry` plus `title`, and nothing else -
 * every key was re-checked against the player LIST projection it must not exceed:
 *
 *   `title`        - `projectPlayerPageSummary` emits a revealed page's title; null for an entry.
 *   `text`         - an entry's `playerText` (via `projectPlayerJournalEntry`) or an excerpt of a revealed
 *                    page's `body`, which is `playerBody` (via `projectPlayerPage`). Never `gmText`/`gmBody`.
 *   `inWorldLabel` - already player-visible on entries; on an event it is the whole point of CT-11 (the row
 *                    has to land in a year), and it is DERIVED from the date the GM chose to publish by
 *                    revealing the page. A reviewed addition, like `tags` in CI-2.
 *   `createdAt`    - already player-visible on entries; for a page it is strictly less informative than the
 *                    `updatedAt` a player already receives from `projectPlayerPageSummary`.
 *   `sessionNumber`/`realDate`/`tags` - already in `projectPlayerJournalEntry`; null/empty on an event.
 *
 * Absent by construction: `gmText`, `calendarInstant`, `inWorldDate`, `revealedToPlayers`, `attachPageId`,
 * `attachMarkerId`, `sourceEncounterId` (K2 - the replay id never reaches a player), `updatedAt`, `rev`.
 */
export type PlayerCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  tags: readonly string[];
  createdAt: string;
}>;

export function projectGmChronicleRecord(record: CodexChronicleRecord): GmCodexChronicleRecord {
  if (record.kind === "entry") {
    const entry = record.entry;
    return {
      kind: entry.kind === "combat" ? "combat" : "entry", id: entry.id, title: null,
      text: entry.playerText, gmText: entry.gmText, revealedToPlayers: entry.revealedToPlayers,
      sessionNumber: entry.sessionNumber, realDate: entry.realDate, inWorldLabel: entry.inWorldLabel,
      calendarInstant: entry.calendarInstant, inWorldDate: entry.inWorldDate, tags: entry.tags,
      attachPageId: entry.attachPageId, attachMarkerId: entry.attachMarkerId, sourceEncounterId: entry.sourceEncounterId,
      createdAt: entry.createdAt, updatedAt: entry.updatedAt
    };
  }
  const page = record.page;
  return {
    kind: "event", id: page.id, title: page.title,
    text: excerpt(page.playerBody), gmText: page.gmBody.trim() ? excerpt(page.gmBody) : null,
    revealedToPlayers: page.revealedToPlayers,
    sessionNumber: null, realDate: null, inWorldLabel: page.inWorldLabel,
    calendarInstant: page.calendarInstant, inWorldDate: page.inWorldDate, tags: page.tags,
    attachPageId: null, attachMarkerId: null, sourceEncounterId: null,
    createdAt: page.createdAt, updatedAt: page.updatedAt
  };
}

/**
 * null when this record is not player-visible - **the only gate the chronicle has** (`listChronicle()` is
 * deliberately ungated, K1). Neither arm invents a predicate; each DELEGATES to the projection that already
 * owns that record type, so the chronicle can never be weaker than the read it duplicates:
 *
 *   entry / combat -> `projectPlayerJournalEntry`. Revealed only, `playerText` only, `gmText` and the
 *                     replay id (K2) dropped. Exactly `GET /codex/journal` for a player.
 *   event          -> `projectPlayerPage`. Revealed only, `body` = `playerBody`, `gmBody` and `gmFields`
 *                     dropped. Exactly `GET /codex/pages/{id}` for a player.
 *
 * That delegation is the point, and it is the `projectPlayerPageMarker` precedent (M7): a hand-rolled
 * `record.page.revealedToPlayers ? {...} : null` would pass the same tests today and drift the first time
 * either underlying projection tightens.
 */
export function projectPlayerChronicleRecord(record: CodexChronicleRecord): PlayerCodexChronicleRecord | null {
  if (record.kind === "entry") {
    const projected = projectPlayerJournalEntry(record.entry);
    if (!projected) return null;
    return {
      kind: projected.kind === "combat" ? "combat" : "entry", id: projected.id, title: null, text: projected.text,
      sessionNumber: projected.sessionNumber, realDate: projected.realDate, inWorldLabel: projected.inWorldLabel,
      tags: projected.tags, createdAt: projected.createdAt
    };
  }
  const projected = projectPlayerPage(record.page);
  if (!projected) return null;
  return {
    kind: "event", id: projected.id, title: projected.title, text: excerpt(projected.body),
    sessionNumber: null, realDate: null, inWorldLabel: record.page.inWorldLabel,
    tags: projected.tags, createdAt: record.page.createdAt
  };
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
  | Readonly<{ kind: "marker"; marker: CodexMarkerRow; mapRevealed: boolean }>
  // A quest needs NO extra context: its own `revealedToPlayers` is the whole predicate (see
  // `PLAYER_VISIBLE_SQL`), and a hit carries no entity linkage that would need resolving.
  | Readonly<{ kind: "quest"; quest: CodexQuestRow }>;

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
 *
 * A QUEST (M10) fits without widening the shape: `title` is the quest's title, and `tags` is `[]` because
 * quests carry no tags at all (not in the spec's column list). The empty array rather than a `null` or a
 * missing key is the point of "every key present on every kind" - a row renderer must not branch on which
 * kind it got. Its `status` and `objectives` are deliberately NOT here: they are read on the record, and a
 * result row exists to navigate, not to summarise.
 */
export type CodexSearchHit = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  entityType: CodexEntityType | null;
  mapId: string | null;
}>;

/* A journal entry has no title, so its result row shows a bounded excerpt of its text - see `excerpt` above. */

export function projectGmSearchHit(record: CodexSearchRecord): CodexSearchHit {
  switch (record.kind) {
    case "page": return { kind: "page", id: record.page.id, title: record.page.title, tags: record.page.tags, entityType: record.page.entityType, mapId: null };
    // The GM may see either layer, so an entry with no player text still shows something useful.
    case "journal": return { kind: "journal", id: record.entry.id, title: excerpt(record.entry.playerText || record.entry.gmText || ""), tags: record.entry.tags, entityType: null, mapId: null };
    case "map": return { kind: "map", id: record.map.id, title: record.map.name, tags: record.map.tags, entityType: null, mapId: null };
    case "marker": return { kind: "marker", id: record.marker.id, title: record.marker.label ?? "", tags: record.marker.tags, entityType: null, mapId: record.marker.mapId };
    case "quest": return { kind: "quest", id: record.quest.id, title: record.quest.title, tags: [], entityType: null, mapId: null };
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
 *   quest   -> `projectPlayerQuest`: revealed only. Its `entityIds` are not carried by a hit at all, so
 *              the entity filter that projection also applies has nothing to do here.
 * The store's SQL applies the same predicate so hidden records don't crowd the result cap; this is
 * the layer that makes it a safety property rather than an optimization.
 *
 * Both layers matter and neither is redundant: the M6 lesson recorded in `codex-store.test.ts` is that
 * weakening the SQL predicate left every test passing because THIS function quietly caught it - which is
 * also true in reverse. Each is tested at its own layer for exactly that reason.
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
    case "quest":
      return record.quest.revealedToPlayers
        ? { kind: "quest", id: record.quest.id, title: record.quest.title, tags: [], entityType: null, mapId: null }
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
