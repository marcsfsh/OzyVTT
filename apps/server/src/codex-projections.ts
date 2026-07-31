import { deadlineFired } from "./codex-store.js";
import type { CodexCalendar, CodexCalendarMonth, CodexChronicleRecord, CodexConnectionRow, CodexConnectionSourceKind, CodexEntityType, CodexInWorldDate, CodexJournalKind, CodexJournalRow, CodexMapRow, CodexMarkerRow, CodexPageRow, CodexPageSummaryRow, CodexQuestObjective, CodexQuestRow, CodexQuestStatus, CodexPageConnectionRow, CodexRecordKind, CodexSessionRow, CodexStandingRow } from "./codex-store.js";

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

// ----- Connections (D8: ONE gate, both origins) -----

/**
 * D8/D13: whether ONE connection may travel to a player. Three conditions, ALL of which must hold, and
 * each is copied from the feed that already enforced it rather than invented here:
 *
 *   1. **The target page is revealed.** An edge to a page a player cannot open tells them that page
 *      EXISTS and draws them a line to it - the leak `projectPlayerQuest` filters `entityIds` for.
 *   2. **The SOURCE record is revealed, per its own kind's rule.** A page, session or quest by its own
 *      flag; a journal entry by its own. Resolved by the caller and handed in, because a projection that
 *      reached back into the store would be a second place that decides what a player may see.
 *   3. **`layer === "player"`.** D13's rule, and it now applies to DECLARED edges too, which is stronger
 *      than the old relationship gate: a connection the GM declared on the GM layer never travels, even
 *      between two revealed pages. A link written in a GM body is a GM note ABOUT a connection, not a
 *      connection the party has been shown - and the revealed player half of the same record may say
 *      nothing of the sort.
 *
 * All three are load-bearing. (1) alone leaks GM-layer edges between two revealed pages; (3) alone leaks
 * the existence of unrevealed pages named from a revealed body; (2) alone leaks edges into secret pages.
 */
export type PlayerConnectionContext = Readonly<{
  /** Page ids the player may see. Both a connection's target and a page-kind source are checked against it. */
  revealedPageIds: ReadonlySet<string>;
  /** Non-page source records the player may see, by kind. Absent sets fail CLOSED: nothing travels. */
  revealedSourceIds: ReadonlySet<string>;
}>;

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

function connectionSourceVisible(kind: CodexConnectionSourceKind, sourceId: string, context: PlayerConnectionContext): boolean {
  return kind === "page" ? context.revealedPageIds.has(sourceId) : context.revealedSourceIds.has(sourceId);
}

/** The whole-graph feed, GM: passthrough. Ids, labels, layers, origins and timestamps are all GM-visible. */
export function projectGmConnections(edges: readonly CodexConnectionRow[]): CodexConnectionRow[] {
  return [...edges];
}

/**
 * A connection as a PLAYER receives it.
 *
 * VIEWER-SAFETY JUSTIFICATION, per dropped key: `id` goes because a player never addresses a connection
 * (there is no player write route, and an id would be a handle to something they cannot act on);
 * `layer` goes because every connection they receive is on the player layer, so the key could only ever
 * be a constant - and a constant that names the OTHER layer's existence; `createdAt` goes because when
 * the GM drew a line is GM authoring metadata, exactly as `rev` and `updatedAt` are everywhere else here.
 */
export type PlayerCodexConnection = Readonly<{
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  label: string | null;
  origin: "declared" | "mention";
}>;

export function projectPlayerConnections(edges: readonly CodexConnectionRow[], context: PlayerConnectionContext): PlayerCodexConnection[] {
  return edges
    .filter((edge) => edge.layer === "player" && context.revealedPageIds.has(edge.toPageId) && connectionSourceVisible(edge.fromKind, edge.fromId, context))
    // Explicit allow-list, never a spread-and-delete: a field added to `CodexConnectionRow` must be added
    // HERE to reach a player, so the default for anything new is secret.
    .map((edge) => ({ fromKind: edge.fromKind, fromId: edge.fromId, toPageId: edge.toPageId, label: edge.label, origin: edge.origin }));
}

/** One page's Connections panel, GM: passthrough - the reveal state of the other end is what the GM needs. */
export function projectGmPageConnections(rows: readonly CodexPageConnectionRow[]): CodexPageConnectionRow[] {
  return [...rows];
}

/**
 * One page's Connections panel as a PLAYER receives it.
 *
 * The gate is the SAME three conditions as the graph feed, stated once and applied here through
 * `otherRevealed` - which the store already resolved per kind. `otherRevealed` itself then DROPS from the
 * row: a player only ever receives connections to records they can see, so the key could only be the
 * constant `true`, and shipping a constant that names a predicate is how a reader learns the predicate
 * exists. `id` and `layer` drop for the reasons `PlayerCodexConnection` states.
 *
 * The page the panel belongs to is assumed already visible - the route 404s a player before it gets here.
 */
export type PlayerCodexPageConnection = Readonly<{
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  label: string | null;
  origin: "declared" | "mention";
  section: string | null;
}>;

export function projectPlayerPageConnections(rows: readonly CodexPageConnectionRow[]): PlayerCodexPageConnection[] {
  return rows
    .filter((row) => row.layer === "player" && row.otherRevealed)
    .map((row) => ({ direction: row.direction, otherKind: row.otherKind, otherId: row.otherId, otherTitle: row.otherTitle, otherEntityType: row.otherEntityType, label: row.label, origin: row.origin, section: row.section }));
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
/**
 * A marker as a player sees it: no scene/actor links (GM-only), and page/sub-map links only when those
 * targets are themselves revealed.
 *
 * M12 (CT-7) adds `isParty` and NOTHING else. The party pin is FOR the players - "you are here" is the
 * whole feature - so the flag is player-facing, and every other key here was re-checked against what a
 * player already received before M12 rather than being assumed unchanged. There is deliberately no second
 * marker type and no party-specific projection: the party marker is an ordinary marker with a flag, so it
 * travels this one function and is gated by this one gate.
 */
export type PlayerCodexMarker = Readonly<{
  id: string; mapId: string; x: number; y: number; iconId: string; iconColor: string; label: string | null; pageIds: string[]; subMapId: string | null;
  tags: readonly string[];
  isParty: boolean;
}>;

export function projectGmMarker(row: CodexMarkerRow): GmCodexMarker { return row; }

/**
 * null unless the marker is revealed. Of a marker's linked pages, only the ones that are themselves
 * revealed survive (so a pin never advertises a still-secret page); the sub-map link survives only when
 * that map is revealed; scene and actor links are GM-only and always stripped. The caller resolves which
 * targets are revealed and passes them in.
 *
 * `isParty` grants NO visibility and is checked by nothing. It is emitted AFTER the ordinary gate above,
 * so a hidden party pin - or a revealed party pin on a hidden map, which the caller's map gate stops
 * before this function is reached (CD-6) - stays hidden exactly like any other pin. A special case for
 * the party marker here would be a second visibility rule for one row, which is what M12 forbids.
 */
export function projectPlayerMarker(row: CodexMarkerRow, context: Readonly<{ revealedPageIds: ReadonlySet<string>; subMapRevealed: boolean }>): PlayerCodexMarker | null {
  if (!row.revealedToPlayers) return null;
  return {
    id: row.id, mapId: row.mapId, x: row.x, y: row.y, iconId: row.iconId, iconColor: row.iconColor, label: row.label, tags: row.tags,
    pageIds: row.pageIds.filter((pageId) => context.revealedPageIds.has(pageId)),
    subMapId: context.subMapRevealed ? row.subMapId : null,
    isParty: row.isParty
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
/**
 * A journal entry as a player sees it: player text only, no gmText, no GM-only linkage, only when revealed.
 * `sessionNumber` additionally passes through the session gate below - it is the one field here whose
 * visibility is not the entry's own flag alone.
 *
 * M11 widened `kind` (a revealed deadline says it is a deadline - O-2 puts no kind filter anywhere) but
 * deliberately added neither `payload` nor `fired`. This is the mini-timeline row on a page or a marker, and
 * a downtime's `who`/`activity` and a deadline's fired state are read on the CHRONICLE, which has them. A
 * player-facing field the player Codex does not read is a field with no reason to have been widened.
 */
export type PlayerCodexJournalEntry = Readonly<{
  id: string; text: string; kind: CodexJournalRow["kind"];
  /**
   * D9 / D14. VIEWER-SAFETY JUSTIFICATION, individually: this is emitted only when the linked session is
   * REVEALED, in which case the player can already list that session (`GET /codex/sessions`) and open it by
   * id (`GET /codex/sessions/{id}`). It therefore adds zero information and buys entry -> session
   * navigation, which is the reading parity D14 asks for. When the linked session is unrevealed it is null
   * TOGETHER with `sessionNumber` - both halves of the link, because either half announces that a session
   * they have not been shown exists.
   */
  sessionId: string | null;
  sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; tags: readonly string[]; createdAt: string;
}>;

/**
 * The context the player journal/chronicle projections need: which `sessionNumber`s name a session record
 * the GM has not revealed. The CALLER resolves it and passes it in - the `projectPlayerMarker` /
 * `projectPlayerQuest` shape verbatim, because a projection that reached back into the store would be a
 * second place that decides what a player may see.
 */
/** The quietest possible default for an unsupplied revealed-page set: nothing is revealed, so no id travels. */
const EMPTY_PAGE_IDS: ReadonlySet<string> = new Set<string>();

/**
 * What a player journal read needs resolved before anything can be projected. Both members are facts only
 * the store can answer; the projection decides who may see the answer.
 *
 * `revealedPageIds` is optional and defaults to EMPTY, which fails CLOSED: a caller that forgets it hides
 * standing records rather than publishing them. It became part of this context (rather than the chronicle's
 * alone) when the standing gate moved onto `projectPlayerJournalEntry` — see `playerStandingVisible`.
 */
export type PlayerSessionNumberContext = Readonly<{
  /**
   * D11: which quests the players have been shown. A `quest` history record is gated on the QUEST, not on
   * itself - see `playerQuestEventVisible`. Optional, and the absent value is the EMPTY set, which fails
   * closed: a caller that forgets to resolve it hides quest history rather than publishing it.
   */
  revealedQuestIds?: ReadonlySet<string>;
  /**
   * D9: keyed by session ID, not by number. That is what closes the gap the number version could not - an
   * UNNUMBERED hidden session could never appear in a set of numbers, so an entry filed under one had
   * nothing to gate on. The join is now the gate, and every filed entry has one.
   */
  unrevealedSessionIds: ReadonlySet<string>;
  revealedPageIds?: ReadonlySet<string>;
}>;

/**
 * A player's copy of an entry's `sessionNumber`: null when a session record EXISTS with that number and is
 * not revealed, otherwise the number unchanged.
 *
 * The leak this closes. A session's very existence is GM information - `GET /codex/sessions/:id` 404s a
 * player on an unrevealed session rather than 403ing, the list omits it, and `activeSessionId` is nulled
 * for players, all on that ground. M9's auto-linking then stamps the ACTIVE session's number onto every
 * entry written during play, so one revealed entry from an unrevealed session made the UI render
 * "Session 4" for a session the same code goes to trouble to hide.
 *
 * Note WHICH set this is, because the edge cases are the point:
 *   - no session record for the number -> unchanged. Every entry from before M9 (which shipped with no
 *     backfill) is in this case, and there is no record whose existence the number could give away. The
 *     mirror-image test - "is this number revealed?" - would blank those too, breaking behaviour that has
 *     always been correct.
 *   - record exists and IS revealed -> unchanged. The player can already open that session by id.
 *   - record exists and is NOT revealed -> null. The only case that changes.
 * The GM projection never consults this at all.
 */
/**
 * A `standing` record is about a faction PAGE, so it is only player-visible when that page is.
 *
 * This lives here, on the entry projection, rather than on the chronicle — and that placement is the whole
 * point. M12 first put it in `projectPlayerChronicleRecord`, which gated `GET /codex/timeline` and left the
 * other three player journal surfaces open: `GET /codex/journal`, player search, and the reveal audit (which
 * used `/codex/journal` as its own oracle, so the audit and its test agreed while both disagreed with the
 * chronicle). A revealed standing record for a secret faction reached the party there — its existence, its
 * in-world date, and, once the GM added prose or a tag, its searchable text. Found by the final QA pass and
 * reproduced through the real routes.
 *
 * `projectPlayerJournalEntry` is the ONE projection all four surfaces delegate to, so a gate here cannot be
 * forgotten by a fifth. That is the same reasoning `playerSessionNumber` below is built on.
 *
 * Absent context means nothing is revealed, which fails closed: a caller that forgets to resolve the page
 * set hides standing records rather than publishing them.
 */
function playerStandingVisible(row: CodexJournalRow, context: PlayerSessionNumberContext): boolean {
  if (row.kind !== "standing") return true;
  const payload = row.payload;
  const faction = payload !== null && "delta" in payload ? payload.factionPageId : null;
  return faction !== null && (context.revealedPageIds ?? EMPTY_PAGE_IDS).has(faction);
}

/**
 * A player's copy of an entry's session LINK - both halves, resolved together, because they are one fact.
 *
 * Three arms, and the middle one is the whole rule:
 *   - joined to a session the players have NOT been shown -> both null. A session's very existence is GM
 *     information (`GET /codex/sessions/{id}` 404s a player on an unrevealed one rather than 403ing, the
 *     list omits it, `activeSessionId` is nulled), so either half of the link announces it.
 *   - joined to a REVEALED session -> both pass. The player can already open that session by id.
 *   - not joined, but carrying a bare LABEL -> `sessionId: null`, label passes. After migration v19 the
 *     only bare labels in the database are those `deleteSession` stamped back for a REVEALED session
 *     (director ruling R2), so the number was already player-visible and there is no record left whose
 *     existence it could give away. A hidden session's delete stamps nothing at all.
 */
/**
 * D11: a `quest` history record is player-visible only when the QUEST it is about is.
 *
 * **This applies the standing lesson before it can recur.** A quest record carries `playerText: ""`, so it
 * cannot "stand on its own prose" - which is the exact false premise the standing CORRECTION documents.
 * Nulling `questId` alone would ship a dated row reading "Quest - completed" for a quest the party has
 * never heard of: the existence of a secret quest, and the fact that it just ended.
 *
 * It is NOT a kind filter in O-2's sense. It does not ask "is this a quest record?", it asks "is the thing
 * this record is ABOUT visible?" - the CD-6-family question `projectPlayerMarker` asks about a pin's map.
 *
 * It lives on `projectPlayerJournalEntry` rather than on the chronicle, so all four player journal
 * surfaces - the journal list, the timeline, search and the reveal audit - inherit it by construction.
 * That placement is the standing gate's, and it is there because the three surfaces that did NOT go
 * through the chronicle leaked.
 */
function playerQuestEventVisible(row: CodexJournalRow, context: PlayerSessionNumberContext): boolean {
  if (row.kind !== "quest") return true;
  const payload = row.payload;
  const questId = payload !== null && "questId" in payload ? payload.questId : null;
  return questId !== null && (context.revealedQuestIds ?? EMPTY_PAGE_IDS).has(questId);
}

function playerSessionLink(row: CodexJournalRow, context: PlayerSessionNumberContext): { sessionId: string | null; sessionNumber: number | null } {
  if (row.sessionId === null) return { sessionId: null, sessionNumber: row.sessionNumber };
  if (context.unrevealedSessionIds.has(row.sessionId)) return { sessionId: null, sessionNumber: null };
  return { sessionId: row.sessionId, sessionNumber: row.sessionNumber };
}

export function projectGmJournalEntry(row: CodexJournalRow): GmCodexJournalEntry { return row; }
export function projectPlayerJournalEntry(row: CodexJournalRow, context: PlayerSessionNumberContext): PlayerCodexJournalEntry | null {
  if (!row.revealedToPlayers) return null;
  if (!playerStandingVisible(row, context)) return null;
  if (!playerQuestEventVisible(row, context)) return null;
  const session = playerSessionLink(row, context);
  return { id: row.id, text: row.playerText, kind: row.kind, sessionId: session.sessionId, sessionNumber: session.sessionNumber, realDate: row.realDate, inWorldLabel: row.inWorldLabel, tags: row.tags, createdAt: row.createdAt };
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
  /**
   * D10. VIEWER-SAFETY JUSTIFICATION, individually: tags are SINGLE-LAYER by CI-2 - there is no GM-only
   * tag anywhere in the codex - and every other record kind already ships its tags to players (pages
   * always; maps, markers and journal entries since v10). A revealed session's tags are its player-facing
   * categorization, and they are already in the player search index by the same rule, so withholding them
   * here would make one kind behave differently for no reason a reader could name. Symmetry is the safer
   * answer: the asymmetric version is the one whose exception someone eventually forgets.
   */
  tags: readonly string[];
}>;

export function projectGmSession(row: CodexSessionRow): GmCodexSession { return row; }

/** null when unrevealed; otherwise the player layer. prepBody, rev, status and attendees never enter it. */
export function projectPlayerSession(row: CodexSessionRow): PlayerCodexSession | null {
  if (!row.revealedToPlayers) return null;
  // Explicit allow-list, never a spread-and-delete: a field added to `CodexSessionRow` must be added HERE
  // to reach a player, so the default for anything new is secret.
  return { id: row.id, sessionNumber: row.sessionNumber, realDate: row.realDate, recap: row.recapBody, tags: row.tags };
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
  /**
   * D10. VIEWER-SAFETY JUSTIFICATION, individually: the `PlayerCodexSession.tags` argument verbatim - tags
   * are single-layer by CI-2, every other kind already ships them, and a revealed quest's tags are its
   * player-facing categorization. The quest's own reveal flag remains the whole predicate.
   */
  tags: readonly string[];
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
    entityIds: row.entityIds.filter((entityId) => context.revealedEntityIds.has(entityId)),
    tags: row.tags
  };
}

// ----- Standing (M12 / CT-6: where the party stands with one faction) -----

export type GmCodexStanding = CodexStandingRow;
/**
 * A standing as a PLAYER sees it - two keys, and each omission is a decision:
 *
 *   `id`                 - the standing row's own id. A player never addresses a standing (the reveal
 *                          route is GM-only), and `factionPageId` already identifies the row uniquely
 *                          (migration v16's unique index), so a second id could only be noise.
 *   `revealedToPlayers`  - GM-only on every record in this file; a player only ever receives revealed ones.
 *   `createdAt`/`updatedAt` - GM-only, exactly as on a session and a quest. "When did this last move" is
 *                          a question the CHRONICLE answers, with the reason attached; a bare timestamp
 *                          beside a bar would tell the party a change happened without saying what.
 *
 * `value` is the signed -100..100 scale (M12-B). It travels unchanged: a revealed standing whose number
 * the player cannot see would say nothing at all, which is the same reason a revealed quest keeps `status`.
 */
export type PlayerCodexStanding = Readonly<{ factionPageId: string; value: number }>;

export function projectGmStanding(row: CodexStandingRow): GmCodexStanding { return row; }

/**
 * null when this standing is not player-visible; otherwise the player layer. Explicit allow-list literal,
 * never a spread-and-delete: a field added to `CodexStandingRow` must be added HERE to reach a player.
 *
 * TWO gates, and the second is the one worth explaining.
 *
 *   1. The standing's own `revealedToPlayers` - the ordinary rule every codex record follows.
 *   2. The FACTION PAGE must itself be revealed. A standing row is nothing but a faction and a number: it
 *      carries no title of its own by design (the store keeps no cached name, so a renamed faction cannot
 *      go stale), so a reader NAMES it by resolving `factionPageId` against the page list. Projected
 *      without this gate, a revealed standing for a secret faction hands the party a page id they cannot
 *      open and a bar they cannot label - "something you have never heard of is hostile to you" - which is
 *      exactly the leak `projectPlayerQuest` filters `entityIds` for and `projectPlayerLinkEdges` refuses
 *      a dangling edge for. Hiding the ROW rather than nulling the id is the `projectPlayerPageMarker`
 *      shape (CD-6): when the thing a record hangs off is secret, the record is invisible, because a
 *      record stripped of the only fact that identifies it is not a record.
 *
 * The CALLER resolves the faction's reveal state and passes it in - the `projectPlayerMarker` /
 * `projectPlayerQuest` division of labour verbatim, because a projection that reached back into the store
 * would be a second place that decides what a player may see.
 */
export function projectPlayerStanding(row: CodexStandingRow, context: Readonly<{ factionRevealed: boolean }>): PlayerCodexStanding | null {
  if (!row.revealedToPlayers) return null;
  if (!context.factionRevealed) return null;
  return { factionPageId: row.factionPageId, value: row.value };
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
 *
 * M11 adds `deadline` and `downtime` (CT-5 / CT-10) for the same reason `combat` is here: they are the same
 * journal row, discriminated so a reader can tell "a thing that will happen" from "a thing that happened".
 * Widening this type is DELIBERATELY breaking - `CHRONICLE_KIND_META` on the client is a
 * `Record<CodexChronicleKind, ...>`, so the compiler, not a reviewer, is what notices a new kind has no
 * icon and no word (F-5: nothing else about a new journal kind produces a single compile error).
 */
export type CodexChronicleKind = "entry" | "combat" | "event" | "deadline" | "downtime" | "milestone" | "standing" | "quest";

/**
 * A journal row's STORE kind mapped to its CHRONICLE kind - a real total function over `CodexJournalKind`,
 * never `kind === "combat" ? "combat" : "entry"`.
 *
 * That collapse was one of the two sites F-5 identified: it silently rendered any unknown kind as an
 * ordinary note, so a `deadline` row would have looked exactly like a stray entry and no test or type
 * would have said otherwise. An exhaustive `switch` with no `default` makes the NEXT kind (M12's
 * `milestone` / `standing`) a compile error here instead.
 *
 * Only `note` is renamed on the way out: "entry" is what an unclassified journal row has always been
 * called on the chronicle, and renaming it now would churn every reader for nothing.
 */
function chronicleKindOf(kind: CodexJournalKind): CodexChronicleKind {
  switch (kind) {
    case "note": return "entry";
    case "combat": return "combat";
    case "deadline": return "deadline";
    case "downtime": return "downtime";
    // M12 (CT-8 / CT-6). Widening `CodexJournalKind` in the store made this switch a compile error until
    // these two arms existed - which is the design, and it is why no `default` may ever be added here.
    case "milestone": return "milestone";
    case "standing": return "standing";
    // D11. The same mechanism one milestone later: no `default` may ever be added here, because the
    // compile error is what forces Lane C's `CHRONICLE_KIND_META` to gain an icon and a word too.
    case "quest": return "quest";
  }
}

/**
 * CT-5's `fired` is DERIVED and stored nowhere (D11-C), and the comparison that derives it is the store's
 * `deadlineFired` - imported, never re-implemented. Both chronicle projections below call that one function,
 * because two copies of a `<=` is how a dashboard ends up disagreeing with the timeline it links into.
 *
 * What this file owns is the part that is a viewer-safety decision rather than an arithmetic one: WHOSE
 * clock each audience is measured against. The GM row uses the GM's own clock; the player row uses the
 * PUBLISHED date (O-1 / D11-G). Measuring a player's row against the GM clock would leak the prep clock one
 * bit at a time - the party would learn that a date they have not been shown has already gone by - which is
 * exactly what O-1 exists to keep private. That is why the two contexts below name their instant differently
 * and are not assignable to one another.
 */

/**
 * CT-10's downtime payload, in the two shapes the two audiences get. Allow-listed by explicit literal per
 * audience (D11-E), never a spread of the stored payload: `applied` is GM WORKFLOW state - "have I confirmed
 * the clock move?" - and is a fact about the GM's prep, not about the party's week off, so it stops here.
 *
 * A record that is not downtime carries no payload at all; `null` rather than an omitted key, so no reader
 * branches on key presence (the rule every other chronicle field follows).
 */
export type GmCodexDowntime = Readonly<{ who: string; activity: string; days: number; applied: boolean; characterPageId: string | null }>;
/**
 * D12 on the player row. VIEWER-SAFETY JUSTIFICATION, individually: `characterPageId` travels only when
 * that page is itself REVEALED - the `factionPageId` rule on a standing payload verbatim - and in that
 * case the player can already open the page by id, so it adds no information and buys the same
 * downtime -> character navigation the GM gets.
 *
 * Unlike a `standing` record, the ROW is not hidden when the link is nulled, and the difference is the
 * test the standing CORRECTION says a row must pass: a downtime row stands on its own player-visible
 * content (`who`, `activity`, `days`, and usually prose), so a nulled link leaves a row that still means
 * something. A standing record has `playerText: ""` and means nothing without its faction.
 */
export type PlayerCodexDowntime = Readonly<{ who: string; activity: string; days: number; characterPageId: string | null }>;

/**
 * M12's two payloads, in the same per-audience allow-listed shape.
 *
 * CT-8 MILESTONE - `{ level, reason }`, and both halves reach a revealed record's player row. A milestone
 * IS "the party reached level 5, because X": a party knows its own level, and the reason is the record's
 * only content, so a player row without them would be a dated row that says nothing. `reason` is single-line
 * prose with no reveal split of its own (the store says so), which is exactly why the record's ordinary
 * `revealedToPlayers` gate is the thing that must hold - a milestone needing a GM-only half writes it in
 * `gmText`, like every other journal record. GM and player shapes are IDENTICAL today and are still written
 * as two literals, so a future field defaults to secret rather than to shipped.
 *
 * CT-6 STANDING - `{ factionPageId, delta, reason }`, and the DECISION the M12 contract asked for
 * explicitly: **a player DOES see `delta` on a revealed standing record.** The delta is the point of the
 * record - "the Harpers fell 15" - and a record the GM chose to publish with its number removed would be a
 * timeline row reading "something changed with someone". `reason` travels for the same reason a downtime's
 * `activity` does. What does NOT travel unconditionally is `factionPageId`: it is nulled unless that page is
 * itself revealed, the same filter `projectPlayerQuest` applies to `entityIds` and `projectPlayerMap` to
 * `parentMapId`.
 *
 * **CORRECTION.** This comment used to end "the row still stands on its own prose (`playerText`) when the
 * id is dropped, which is why nulling the field is right here and hiding the whole row is right on the
 * standing TABLE". That premise was false: `setStanding` writes `playerText: ""` unconditionally, so a
 * standing record has NO prose to stand on, and nulling the id alone shipped "A faction - up 70 · The party
 * paid the toll" to a table that had never heard of that faction. A record whose faction is secret is now
 * hidden WHOLE, matching `projectPlayerStanding` — see the gate in `projectPlayerChronicleRecord`. The
 * per-field filter below still applies, as the second line of defence rather than the only one.
 */
export type GmCodexMilestone = Readonly<{ level: number; reason: string }>;
export type PlayerCodexMilestone = Readonly<{ level: number; reason: string }>;
export type GmCodexStandingChange = Readonly<{ factionPageId: string; delta: number; reason: string }>;
export type PlayerCodexStandingChange = Readonly<{ factionPageId: string | null; delta: number; reason: string }>;
/**
 * D11's quest-history payload.
 *
 * VIEWER-SAFETY JUSTIFICATION for the PLAYER shape, individually: the whole ROW is hidden unless the quest
 * itself is revealed (`playerQuestEventVisible`), so when this travels the reader can already open the
 * quest and read its status on `GET /codex/quests`. `status` is the record's ONLY content - the same
 * reasoning that keeps `status` on `PlayerCodexQuest` where a session's is GM-only - and `questId` is
 * additionally nulled unless the quest is in the revealed set, as a second line of defence.
 */
export type GmCodexQuestEvent = Readonly<{ questId: string; status: CodexQuestStatus }>;
export type PlayerCodexQuestEvent = Readonly<{ questId: string | null; status: CodexQuestStatus }>;

/** Every payload shape a GM chronicle row can carry. `null` for the kinds that carry none. */
export type GmCodexChroniclePayload = GmCodexDowntime | GmCodexMilestone | GmCodexStandingChange | GmCodexQuestEvent;
/** Every payload shape a PLAYER chronicle row can carry - each one narrower than, or equal to, its GM twin. */
export type PlayerCodexChroniclePayload = PlayerCodexDowntime | PlayerCodexMilestone | PlayerCodexStandingChange | PlayerCodexQuestEvent;

/**
 * One entry's payload, per kind, per audience. Dispatching on the ENTRY's `kind` rather than sniffing the
 * blob is what makes "a downtime payload can never ride out on a milestone row" structural: the store
 * writes the payload the kind owns, and this reads only the payload that kind owns. The `in` guard beside
 * each arm is the type-level half of the same statement (the store's `CodexEntryPayload` is a plain union,
 * deliberately, so `kind` does not narrow it for free) and fails CLOSED - a row whose blob does not match
 * its kind projects `null`, never a half-filled object.
 */
function projectGmPayload(entry: CodexJournalRow): GmCodexChroniclePayload | null {
  const payload = entry.payload;
  if (payload === null) return null;
  switch (entry.kind) {
    case "downtime": return "who" in payload ? { who: payload.who, activity: payload.activity, days: payload.days, applied: payload.applied, characterPageId: payload.characterPageId } : null;
    case "milestone": return "level" in payload ? { level: payload.level, reason: payload.reason } : null;
    case "standing": return "delta" in payload ? { factionPageId: payload.factionPageId, delta: payload.delta, reason: payload.reason } : null;
    case "quest": return "questId" in payload ? { questId: payload.questId, status: payload.status } : null;
    case "note": case "combat": case "deadline": return null;
  }
}
/**
 * The player half. Explicit allow-list per kind, never a spread-and-delete: a field added to any stored
 * payload must be added HERE to reach a player, so the default for anything new is secret. `applied` is the
 * standing example - GM workflow state, dropped (D11-E) - and `factionPageId` is the M12 one, carried only
 * when the faction page is itself revealed.
 */
function projectPlayerPayload(entry: CodexJournalRow, revealedPageIds: ReadonlySet<string>, revealedQuestIds: ReadonlySet<string>): PlayerCodexChroniclePayload | null {
  const payload = entry.payload;
  if (payload === null) return null;
  switch (entry.kind) {
    case "downtime": return "who" in payload
      ? { who: payload.who, activity: payload.activity, days: payload.days, characterPageId: payload.characterPageId !== null && revealedPageIds.has(payload.characterPageId) ? payload.characterPageId : null }
      : null;
    case "milestone": return "level" in payload ? { level: payload.level, reason: payload.reason } : null;
    case "standing": return "delta" in payload
      ? { factionPageId: revealedPageIds.has(payload.factionPageId) ? payload.factionPageId : null, delta: payload.delta, reason: payload.reason }
      : null;
    // D11. The WHOLE ROW is already hidden unless the quest is revealed, so this arm only ever runs for a
    // quest the player can see; `questId` is nulled anyway when the id is not in the revealed set, as the
    // second line of defence - standing's arrangement verbatim.
    case "quest": return "questId" in payload
      ? { questId: revealedQuestIds.has(payload.questId) ? payload.questId : null, status: payload.status }
      : null;
    case "note": case "combat": case "deadline": return null;
  }
}

/**
 * What the CALLER resolves for a GM chronicle read. Both fields are things only the store can answer, and
 * the `projectPlayerMarker` / `projectPlayerQuest` division of labour applies unchanged: the caller ANSWERS
 * the question, the projection decides who may see the answer.
 *
 * Optional, and each absent value is the QUIETEST one (`fired: false`, no proposed date). A caller that
 * forgets loses a feature; it can never leak one. That is the only default an audited file may have, and it
 * is also what lets the M9/M10 call sites - which have no clock to supply - keep compiling untouched.
 */
export type GmChronicleContext = Readonly<{
  /** The GM's own clock as a sort instant. `deadlineFired` measures the GM's `fired` against THIS. */
  campaignInstant?: number | null;
  /** For an unapplied downtime, the date `applyDowntime` would move the clock to. GM workflow; never a player's. */
  proposedDate?: CodexInWorldDate | null;
}>;

/**
 * What the caller resolves for a PLAYER chronicle read: the session context this file already needed, plus
 * the PUBLISHED clock.
 *
 * The field is called `publishedInstant`, not `campaignInstant`, on purpose. It is the one structural defence
 * available here against the leak D11-G exists to prevent: `GmChronicleContext` and this type are not
 * assignable to one another by accident, so handing the player projection the GM's clock has to be typed out
 * deliberately rather than reached by a copy-paste of the GM branch.
 */
export type PlayerChronicleContext = PlayerSessionNumberContext & Readonly<{
  publishedInstant?: number | null;
  /**
   * M12: which page ids are revealed, for the one payload field that names a page - a `standing` record's
   * `factionPageId`. Optional, and the absent value is the QUIETEST one (an empty set nulls the id), so a
   * caller that forgets loses a link and can never leak one.
   */
  revealedPageIds?: ReadonlySet<string>;
}>;

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
  /** D9: the session record this row belongs to, by identity. `null` for an `event` page and for an unfiled entry. */
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  tags: readonly string[];
  attachPageId: string | null;
  attachMarkerId: string | null;
  sourceEncounterId: number | null;
  /** CT-5, derived (D11-C): has the GM's clock reached this deadline's own date? `false` for every other kind. */
  fired: boolean;
  /** CT-10 / CT-8 / CT-6: the kind's structured facts, GM shape (`applied` included). `null` for the kinds with none. */
  payload: GmCodexChroniclePayload | null;
  /** CT-10 / O-3: where the clock WOULD land if the GM confirms. `null` once applied, and for every other kind. */
  proposedDate: CodexInWorldDate | null;
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
 *                    `sessionNumber` therefore inherits that projection's session gate too, rather than
 *                    restating it: an unrevealed session's number never reaches this row either.
 *
 *   `fired`        - M11 (CT-5). A revealed deadline the campaign has already reached has to READ as passed,
 *                    or the party's copy of the timeline says something different from the GM's. Derived
 *                    against the PUBLISHED date, never the GM's clock (D11-G) - see `deadlineFired`.
 *   `payload`      - M11 (CT-10) and M12 (CT-8 / CT-6), allow-listed per kind by `projectPlayerPayload`.
 *                    A downtime carries only `who`/`activity`/`days` - `applied` is GM workflow state and is
 *                    dropped (D11-E), like `rev` on every other record here. A milestone carries
 *                    `level`/`reason`; a standing carries `delta`/`reason` and its `factionPageId` only when
 *                    that page is itself revealed.
 *
 * Absent by construction: `gmText`, `calendarInstant`, `inWorldDate`, `revealedToPlayers`, `attachPageId`,
 * `attachMarkerId`, `sourceEncounterId` (K2 - the replay id never reaches a player), `updatedAt`, `rev`,
 * `proposedDate` (M11 - the clock move the GM has not confirmed, and may never confirm, is prep).
 */
export type PlayerCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  /** D9: inherited from `projectPlayerJournalEntry`'s session gate rather than restated - see there. */
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  /**
   * D17 / director ruling R3, and this is a documented REVERSAL of the "machine-readable dates are GM-only"
   * line this type used to carry.
   *
   * VIEWER-SAFETY JUSTIFICATION, individually: `inWorldDate` is strictly derived from the record's own raw
   * date, which the GM published by revealing the record, and the `inWorldLabel` one line above already
   * encodes the identical information as prose ("Third, Melting 12, 1492" - the server's label carries
   * weekday, day, month and year). The structured parts add ZERO bits; they remove a client re-parse. The
   * GM's own clock is untouched by this field - a record's date is not the campaign's "now".
   */
  inWorldDate: CodexInWorldDate | null;
  /**
   * D17 / R3. VIEWER-SAFETY JUSTIFICATION, individually: a pure function of `inWorldDate` above and the
   * calendar structure the player already holds (`GET /codex/calendar`), so it is derivable client-side and
   * carries no new information at all. Shipping the SERVER's value is what stops the client re-deriving it
   * with arithmetic that disagrees - the day-clamp divergence on a day-31-of-a-30-day-month date is a
   * measured, ledgered bug, and one authority for one number is the fix. Null exactly when `inWorldDate`
   * is null.
   */
  calendarInstant: number | null;
  tags: readonly string[];
  fired: boolean;
  payload: PlayerCodexChroniclePayload | null;
  createdAt: string;
}>;

export function projectGmChronicleRecord(record: CodexChronicleRecord, context: GmChronicleContext = {}): GmCodexChronicleRecord {
  if (record.kind === "entry") {
    const entry = record.entry;
    return {
      kind: chronicleKindOf(entry.kind), id: entry.id, title: null,
      text: entry.playerText, gmText: entry.gmText, revealedToPlayers: entry.revealedToPlayers,
      sessionId: entry.sessionId, sessionNumber: entry.sessionNumber, realDate: entry.realDate, inWorldLabel: entry.inWorldLabel,
      calendarInstant: entry.calendarInstant, inWorldDate: entry.inWorldDate, tags: entry.tags,
      attachPageId: entry.attachPageId, attachMarkerId: entry.attachMarkerId, sourceEncounterId: entry.sourceEncounterId,
      // `fired` is asked of every entry, not only a deadline: `deadlineFired` answers `false` for a
      // non-deadline and for an undated row, so no reader here has to know which kinds can fire.
      fired: deadlineFired(entry, context.campaignInstant ?? null),
      payload: projectGmPayload(entry), proposedDate: context.proposedDate ?? null,
      createdAt: entry.createdAt, updatedAt: entry.updatedAt
    };
  }
  const page = record.page;
  return {
    kind: "event", id: page.id, title: page.title,
    text: excerpt(page.playerBody), gmText: page.gmBody.trim() ? excerpt(page.gmBody) : null,
    revealedToPlayers: page.revealedToPlayers,
    sessionId: null, sessionNumber: null, realDate: null, inWorldLabel: page.inWorldLabel,
    calendarInstant: page.calendarInstant, inWorldDate: page.inWorldDate, tags: page.tags,
    attachPageId: null, attachMarkerId: null, sourceEncounterId: null,
    // An `event` PAGE is not a deadline and carries no payload: a page has no `kind` in the journal's
    // vocabulary and no `payload_json` column, so these are structurally, not conditionally, absent.
    fired: false, payload: null, proposedDate: null,
    createdAt: page.createdAt, updatedAt: page.updatedAt
  };
}

/**
 * null when this record is not player-visible - **the only gate the chronicle has** (`listChronicle()` is
 * deliberately ungated, K1). Neither arm invents a predicate; each DELEGATES to the projection that already
 * owns that record type, so the chronicle can never be weaker than the read it duplicates:
 *
 *   entry / combat -> `projectPlayerJournalEntry`. Revealed only, `playerText` only, `gmText` and the
 *                     replay id (K2) dropped, and `sessionNumber` through the unrevealed-session gate.
 *                     Exactly `GET /codex/journal` for a player.
 *   event          -> `projectPlayerPage`. Revealed only, `body` = `playerBody`, `gmBody` and `gmFields`
 *                     dropped. Exactly `GET /codex/pages/{id}` for a player.
 *
 * That delegation is the point, and it is the `projectPlayerPageMarker` precedent (M7): a hand-rolled
 * `record.page.revealedToPlayers ? {...} : null` would pass the same tests today and drift the first time
 * either underlying projection tightens - which is exactly what the session gate is, one milestone later.
 * `context` exists only for that delegation; an `event` row carries no session number to gate.
 */
export function projectPlayerChronicleRecord(record: CodexChronicleRecord, context: PlayerChronicleContext): PlayerCodexChronicleRecord | null {
  if (record.kind === "entry") {
    const projected = projectPlayerJournalEntry(record.entry, context);
    if (!projected) return null;
    /**
     * A `standing` record whose faction page is unrevealed is HIDDEN WHOLE, exactly as the standing TABLE
     * row is (`projectPlayerStanding`). This is not a kind filter in O-2's sense - it does not ask "is this
     * a standing?", it asks "is the thing this record is ABOUT visible?", the same question
     * `projectPlayerMarker` asks about a pin's map (CD-6) and `projectPlayerQuest` about a linked page.
     *
     * Nulling `factionPageId` alone is not enough, and the reasoning that said it was rested on a false
     * premise: it claimed "the row still stands on its own prose", but `setStanding` writes
     * `playerText: ""` unconditionally, so there is no prose. What shipped was a row reading
     * "A faction - up 70 · The party paid the toll" for a faction the party has never heard of - the
     * existence of a secret faction, the size of the move, and the sentence that caused it. Measured
     * against the real routes, not argued.
     *
     * The client said the same thing in `PlayerCodex.tsx` about the standing CARD ("a nameless bar reading
     * 'Hunted' would tell the table that something they have never been told about is hunting them"). The
     * two surfaces now agree, which is the point.
     */
    // O-2: NO kind filter here or anywhere. A deadline and a downtime are gated by the ordinary reveal flag
    // - the one `projectPlayerJournalEntry` just applied - and by nothing else, so a revealed deadline is
    // exactly as visible as a revealed note. `payload` still rides through the per-kind allow-list.
    return {
      kind: chronicleKindOf(projected.kind), id: projected.id, title: null, text: projected.text,
      sessionId: projected.sessionId, sessionNumber: projected.sessionNumber, realDate: projected.realDate,
      inWorldLabel: projected.inWorldLabel,
      // R3: both date forms, taken from the raw row rather than recomputed here - the store already
      // resolved them against the live calendar (K3's one-reflow rule), and a second derivation in this
      // file would be the second authority the ruling exists to remove.
      inWorldDate: record.entry.inWorldDate, calendarInstant: record.entry.calendarInstant,
      tags: projected.tags,
      fired: deadlineFired(record.entry, context.publishedInstant ?? null),
      payload: projectPlayerPayload(record.entry, context.revealedPageIds ?? EMPTY_PAGE_IDS, context.revealedQuestIds ?? EMPTY_PAGE_IDS),
      createdAt: projected.createdAt
    };
  }
  const projected = projectPlayerPage(record.page);
  if (!projected) return null;
  return {
    kind: "event", id: projected.id, title: projected.title, text: excerpt(projected.body),
    sessionId: null, sessionNumber: null, realDate: null, inWorldLabel: record.page.inWorldLabel,
    // R3, on the event arm too: a revealed `event` page's date is exactly as published as its label, and a
    // calendar view that could place entries but not events would be a calendar with a hole in it.
    inWorldDate: record.page.inWorldDate, calendarInstant: record.page.calendarInstant,
    tags: projected.tags, fired: false, payload: null, createdAt: record.page.createdAt
  };
}

// ----- Calendar (M11 / O-1: the GM's prep clock and the players' published clock are two values) -----

/**
 * The world calendar as the GM sees it: their own clock in `currentDate`, plus what the party is currently
 * being shown.
 *
 * This is the only projection in this file whose GM half is not a straight passthrough of the store row, and
 * that is because the row is not the whole answer: `publishedDate` lives in `codex_meta` columns beside
 * `calendar_json` rather than inside it (D11-G - `PUT /codex/calendar` replaces that whole blob from client
 * input, so a player-facing value inside it would be one careless PUT from being clobbered).
 */
export type GmCodexCalendar = Readonly<{
  yearName: string;
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  /** The GM's clock - the campaign's authoritative "now". Never reaches a player by any path. */
  currentDate: CodexInWorldDate | null;
  /** What players currently see as "now". Equal to `currentDate` until the GM runs ahead while prepping. */
  publishedDate: CodexInWorldDate | null;
}>;

/**
 * The world calendar as a PLAYER sees it - today's shape exactly, with one field re-sourced.
 *
 * `currentDate` KEEPS ITS NAME and its meaning ("where the campaign is now, as far as this reader is
 * concerned"); only where it comes from changes (D11-G), which is why the player's "Now:" chip needs no
 * client change at all.
 *
 * There is no reveal flag to gate on: a calendar is not a record, it has no `revealedToPlayers` column, and
 * its months/weekdays/era have always been player-visible - the world's own months are not a secret. The
 * gate this projection applies instead is on the SOURCE of the one field that is: `publishedDate` is read
 * and `calendar.currentDate` is not read AT ALL. That is the whole invariant, and it is why this is an
 * explicit key-by-key literal rather than a spread with `currentDate` overwritten: a spread would put the
 * GM clock into the object first and rely on a later key to remove it, which is precisely the shape K1
 * forbids (and it would carry any future GM-only calendar field straight out with it).
 *
 * `publishedDate` is deliberately NOT echoed back to a player: for a player `currentDate` already IS the
 * published date, so a second key could only duplicate it or lie about it.
 */
export type PlayerCodexCalendar = Readonly<{
  yearName: string;
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  currentDate: CodexInWorldDate | null;
}>;

export function projectGmCalendar(calendar: CodexCalendar, publishedDate: CodexInWorldDate | null): GmCodexCalendar {
  return { yearName: calendar.yearName, months: calendar.months, weekdays: calendar.weekdays, currentDate: calendar.currentDate ?? null, publishedDate };
}

export function projectPlayerCalendar(calendar: CodexCalendar, publishedDate: CodexInWorldDate | null): PlayerCodexCalendar {
  return { yearName: calendar.yearName, months: calendar.months, weekdays: calendar.weekdays, currentDate: publishedDate };
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
  | Readonly<{ kind: "quest"; quest: CodexQuestRow }>
  // D10: a session needs NO extra context either - its own `revealedToPlayers` is the whole predicate
  // (see `PLAYER_VISIBLE_SQL`), exactly as a quest's is. Gate 1 (`indexSession`) is what keeps prep and
  // attendees out of the player index in the first place.
  | Readonly<{ kind: "session"; session: CodexSessionRow }>;

/**
 * D10 / D23: what a session's result row is CALLED, on both the search surface and the reveal audit.
 *
 * `"Session {n}"` when it is numbered; a recap excerpt when it is not; `"Untitled session"` when it has
 * neither. Never an empty string - a blank row is unclickable and unreadable, which is the audit bug
 * `known-bugs.md:65-68` records. The fallback string is the repo's "Untitled page" / "Untitled quest"
 * copy family, so the two surfaces speak one language rather than two.
 *
 * The number is player-safe on a REVEALED session (`projectPlayerSession` emits it), and this helper is
 * only ever called with a session the caller has already decided the reader may see.
 */
export function sessionDisplayTitle(session: Readonly<{ sessionNumber: number | null; recap: string }>): string {
  if (session.sessionNumber !== null) return `Session ${session.sessionNumber}`;
  return excerpt(session.recap) || "Untitled session";
}

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
 * A QUEST (M10) fits without widening the shape: `title` is the quest's title, and since D10 gave quests
 * tags, `tags` is theirs. Its `status` and `objectives` are deliberately NOT here: they are read on the
 * record, and a result row exists to navigate, not to summarise.
 *
 * A SESSION (D10) fits the same way. `title` is `sessionDisplayTitle` - "Session 4", else a recap excerpt,
 * else "Untitled session" - and `tags` is the session's own. Nothing else: a hit exists to navigate, and
 * `prepBody`, `attendees` and `status` are not in the player session projection at all.
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

/**
 * null when this record is not player-visible - the audited gate. The predicate per kind is COPIED
 * from that kind's player LIST endpoint and must never be weaker, or search becomes the leak:
 *   page    -> `projectPlayerPage(Summary)`: revealed only.
 *   journal -> DELEGATES to `projectPlayerJournalEntry` (reveal flag AND M12's standing/faction gate),
 *              and the excerpt reads `playerText` ALONE.
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
export function projectPlayerSearchHit(record: CodexSearchRecord, context: PlayerSessionNumberContext): CodexSearchHit | null {
  switch (record.kind) {
    case "page":
      return record.page.revealedToPlayers ? { kind: "page", id: record.page.id, title: record.page.title, tags: record.page.tags, entityType: record.page.entityType, mapId: null } : null;
    case "journal":
      // Delegates rather than restating: `projectPlayerJournalEntry` owns BOTH the reveal flag and the
      // standing/faction gate, so this arm cannot drift from the list endpoint it is copied from. Search
      // was one of the three surfaces that leaked a secret faction's standing record while this arm read
      // `revealedToPlayers` alone — and a searchable row is the worst place for it, since the GM can add
      // prose and a tag to that record through the ordinary journal PATCH.
      return projectPlayerJournalEntry(record.entry, context) === null
        ? null
        : { kind: "journal", id: record.entry.id, title: excerpt(record.entry.playerText), tags: record.entry.tags, entityType: null, mapId: null };
    case "map":
      return record.map.revealedToPlayers ? { kind: "map", id: record.map.id, title: record.map.name, tags: record.map.tags, entityType: null, mapId: null } : null;
    case "marker":
      return record.marker.revealedToPlayers && record.mapRevealed
        ? { kind: "marker", id: record.marker.id, title: record.marker.label ?? "", tags: record.marker.tags, entityType: null, mapId: record.marker.mapId }
        : null;
    case "session": {
      // DELEGATES, like the journal arm above and for the same reason: `projectPlayerSession` owns what a
      // player may see of a session, so this arm cannot drift from `GET /codex/sessions`. Everything the
      // hit carries - the id, the number-derived title, the recap excerpt, the tags - comes back out of
      // that projection; nothing is read off the raw row. `prepBody` and `attendees` are not merely
      // omitted here, they never entered the player search index at all (gate 1, `indexSession`).
      const projected = projectPlayerSession(record.session);
      return projected === null
        ? null
        : { kind: "session", id: projected.id, title: sessionDisplayTitle(projected), tags: projected.tags, entityType: null, mapId: null };
    }
    case "quest":
      return record.quest.revealedToPlayers
        ? { kind: "quest", id: record.quest.id, title: record.quest.title, tags: record.quest.tags, entityType: null, mapId: null }
        : null;
  }
}


export function projectGmSearchHit(record: CodexSearchRecord): CodexSearchHit {
  switch (record.kind) {
    case "page": return { kind: "page", id: record.page.id, title: record.page.title, tags: record.page.tags, entityType: record.page.entityType, mapId: null };
    // The GM may see either layer, so an entry with no player text still shows something useful.
    case "journal": return { kind: "journal", id: record.entry.id, title: excerpt(record.entry.playerText || record.entry.gmText || ""), tags: record.entry.tags, entityType: null, mapId: null };
    case "map": return { kind: "map", id: record.map.id, title: record.map.name, tags: record.map.tags, entityType: null, mapId: null };
    case "marker": return { kind: "marker", id: record.marker.id, title: record.marker.label ?? "", tags: record.marker.tags, entityType: null, mapId: record.marker.mapId };
    case "quest": return { kind: "quest", id: record.quest.id, title: record.quest.title, tags: record.quest.tags, entityType: null, mapId: null };
    // The GM sees a session hit whatever its reveal state - reveal is the PLAYER predicate. The title rule
    // is shared with the player arm and the reveal audit, so one concept has one name everywhere.
    case "session": return { kind: "session", id: record.session.id, title: sessionDisplayTitle({ sessionNumber: record.session.sessionNumber, recap: record.session.recapBody }), tags: record.session.tags, entityType: null, mapId: null };
  }
}


// ----- The reveal audit (M12 / CT-9: one GM view of everything the party can currently see) -----

/**
 * **This is a READ-ONLY AGGREGATION and it decides nothing.** The spec's own risk note for CT-9 is that it
 * must not become a second source of truth about visibility, and the shape below is what keeps that
 * structural rather than aspirational: every row this emits is produced by asking THAT RECORD KIND'S
 * EXISTING PLAYER PROJECTION whether it returns something. There is no `revealed` test anywhere in this
 * section - not one - and adding one would be the defect the risk note names, because a hand-copied
 * predicate is a predicate that can be weakened alone.
 *
 * Delegating rather than restating is also the only way the audit can be RIGHT. "Revealed" is not the same
 * question as "player-visible" for two of the seven kinds, and both differences fall out for free here:
 *   - a MARKER flagged revealed on a HIDDEN map is invisible to players (CD-6), and `projectPlayerPageMarker`
 *     already knows it;
 *   - a STANDING revealed for an unrevealed FACTION page is invisible (see `projectPlayerStanding`).
 * An audit written against `revealed = 1` would list both and tell the GM the party can see things it
 * cannot - the exact failure the M12 verification test (audit counts vs. real player reads) exists to catch.
 *
 * Placed at the END of this file on purpose: it may only delegate to projections that are already defined
 * above it, so it can never be the first place a rule is written.
 */
export type CodexRevealAuditKind = "page" | "map" | "marker" | "journal" | "session" | "quest" | "standing";
/**
 * Every reveal surface in the Codex, in the order the audit reports them, and it is exhaustive BY
 * CONSTRUCTION: each of the six routes that flips a reveal flag today (`pages`, `maps`, `markers`,
 * `journal` - which covers all six journal kinds - `sessions`, `quests`) plus M12's standing. A seventh
 * reveal route added later that is not added here is the one failure this list cannot self-detect, which
 * is why the HTTP test enumerates the audit against the real player endpoints rather than against itself.
 *
 * Exported so the router and the client render the same fixed set of sections. The audit always returns
 * ALL of them, empty ones included: "nothing is revealed here" and "this did not load" must not look the
 * same on the GM's screen.
 */
export const CODEX_REVEAL_AUDIT_KINDS: readonly CodexRevealAuditKind[] = ["page", "map", "marker", "journal", "session", "quest", "standing"];

/**
 * One record the audit considers, carrying exactly the CONTEXT that record's player projection needs -
 * resolved by the caller, exactly as every other player read in this file resolves it. The marker arm
 * reuses `CodexPageMarkerRecord` verbatim rather than restating its three context fields, because it is
 * the same question (a pin plus its map's gate) and one definition cannot drift from itself.
 */
export type CodexRevealAuditRecord =
  | Readonly<{ kind: "page"; page: CodexPageSummaryRow }>
  | Readonly<{ kind: "map"; map: CodexMapRow; parentRevealed: boolean }>
  | (Readonly<{ kind: "marker" }> & CodexPageMarkerRecord)
  | Readonly<{ kind: "journal"; entry: CodexJournalRow; sessionContext: PlayerSessionNumberContext }>
  | Readonly<{ kind: "session"; session: CodexSessionRow }>
  | Readonly<{ kind: "quest"; quest: CodexQuestRow; revealedEntityIds: ReadonlySet<string> }>
  | Readonly<{ kind: "standing"; standing: CodexStandingRow; factionRevealed: boolean; factionTitle: string | null }>;

/**
 * One row of the audit: what it is, which record, and a line naming it.
 *
 * `id` is the record's OWN id - deliberately the id that kind's EXISTING reveal route already takes, so
 * un-revealing from the audit is `POST /codex/<kind>/{id}/reveal { revealed: false }` and nothing new.
 * M12 adds no unreveal route and no bulk operation: CT-9 is a view, not a writer.
 */
export type CodexRevealAuditRow = Readonly<{
  kind: CodexRevealAuditKind;
  id: string;
  title: string;
  /**
   * WHICH KIND of journal record this is, on a `kind: "journal"` row; `null` on every other kind.
   *
   * A field of its own rather than a prefix on `title`, because the client renders it as a BADGE beside
   * the title: a kind reads by icon AND label in this app (the same rule `CodexChronicleRecord.kind`
   * states - never by colour alone), and a string that has had "Deadline: " glued to its front cannot be
   * badged, cannot be styled, and cannot be told apart from a GM who genuinely began a note with that word.
   *
   * `title` alone was not enough to name a row on THIS surface. `AUDIT_JOURNAL_FALLBACK` names the kind
   * only when the record has NO player prose, so a revealed deadline WITH prose and a revealed note with
   * prose rendered identically - on the one screen whose entire job is answering "is that deadline
   * visible?". The fallback stays exactly as it was; this carries the kind on every journal row instead of
   * only the silent ones.
   *
   * PRESENT-AND-NULL, not absent. This row is deliberately ONE uniform shape for all seven surfaces (see
   * the type's comment above and `CodexSearchHit`, whose `entityType` and `mapId` are the same idea): a
   * reader must not have to branch on which kind it got, so every key is on every row and null means "does
   * not apply here". Making this the app's first key-presence-discriminated row would buy nothing - the
   * client checks one value either way - and would cost the `additionalProperties: false` contract
   * component its single-object shape.
   */
  journalKind: CodexJournalKind | null;
}>;

/** One reveal surface's report. Always present, `revealed: 0` and `rows: []` when the party can see none of it. */
export type CodexRevealAuditSection = Readonly<{
  kind: CodexRevealAuditKind;
  /** How many records of this kind the party can currently see. */
  revealed: number;
  /** How many exist at all, so "3 of 40" reads as deliberate rather than as an empty screen. */
  total: number;
  rows: readonly CodexRevealAuditRow[];
}>;

export type CodexRevealAudit = Readonly<{ sections: readonly CodexRevealAuditSection[]; revealed: number; total: number }>;

/**
 * One record's audit row, or null when the party cannot see it.
 *
 * Every arm calls the player projection and then reads the row's title OUT OF THAT PROJECTION'S OWN OUTPUT
 * rather than out of the stored record. The two are equal for every field used here, so this is not about
 * hiding anything from the GM (the audit is GM-only) - it is so that "this line is what the party has" is
 * true by construction rather than by a reviewer's say-so, and so a future tightening of any player
 * projection tightens the audit with it.
 */
/**
 * What an audit row calls a record that carries no player-facing prose of its own. Keyed by journal kind so
 * a seventh kind is a compile error rather than a silent blank line (the same discipline `chronicleKindOf`
 * and `CHRONICLE_KIND_META` follow). Deliberately not the client's `CHRONICLE_KIND_META` labels: those are a
 * reading rule on the client and this is a server payload, and one import across that boundary to save six
 * words would be the wrong trade.
 */
const AUDIT_JOURNAL_FALLBACK: Readonly<Record<CodexJournalKind, string>> = {
  note: "Journal entry",
  combat: "Battle",
  deadline: "Deadline",
  downtime: "Downtime",
  milestone: "Milestone",
  standing: "Faction standing changed",
  quest: "Quest updated"
};

function auditRow(record: CodexRevealAuditRecord): CodexRevealAuditRow | null {
  switch (record.kind) {
    case "page": {
      const projected = projectPlayerPageSummary(record.page);
      return projected === null ? null : { kind: "page", id: projected.id, title: projected.title, journalKind: null };
    }
    case "map": {
      const projected = projectPlayerMap(record.map, { parentRevealed: record.parentRevealed });
      return projected === null ? null : { kind: "map", id: projected.id, title: projected.name, journalKind: null };
    }
    case "marker": {
      // `projectPlayerPageMarker`, not `projectPlayerMarker`: the map gate is half the answer here (CD-6).
      const projected = projectPlayerPageMarker(record);
      return projected === null ? null : { kind: "marker", id: projected.id, title: projected.label ?? "", journalKind: null };
    }
    case "journal": {
      const projected = projectPlayerJournalEntry(record.entry, record.sessionContext);
      if (projected === null) return null;
      /**
       * A row on THIS surface must name itself. `excerpt(text)` alone did not: `setStanding` writes a
       * standing record with an empty player text, so every revealed standing change rendered as a blank
       * line with a Hide button beside it — on the one screen whose whole job is telling the GM what the
       * party can see, the GM could not tell what they were about to hide. That was the DEFAULT for a whole
       * kind, not an edge case. An unlabelled pin has the same problem and always has.
       *
       * So: the record's own text when it has any, else what KIND of record it is. Never an empty string.
       *
       * `journalKind` then carries the kind on EVERY journal row, prose or not. The fallback above solved
       * only half of this: a revealed deadline that HAS prose and a revealed note that has prose were
       * indistinguishable here, and "is that deadline visible?" is the question this screen exists to
       * answer.
       *
       * Read off `projected.kind` - the PLAYER projection's own output, exactly as this file's rule above
       * requires and for the same reason: if a later change stops handing players a journal entry's kind,
       * this line becomes a compile error instead of quietly outliving it. It is the same value as
       * `record.entry.kind`, which is what the fallback above is keyed by, so the badge and the fallback
       * text cannot disagree about what the record is.
       */
      return { kind: "journal", id: projected.id, title: excerpt(projected.text) || AUDIT_JOURNAL_FALLBACK[record.entry.kind], journalKind: projected.kind };
    }
    case "session": {
      const projected = projectPlayerSession(record.session);
      if (projected === null) return null;
      // A numbered session reads by its number, which is how the party refers to it; an unnumbered one
      // shows a bounded recap excerpt, and one with NEITHER shows "Untitled session".
      //
      // That last arm is the fix for `known-bugs.md:65-68`: an unnumbered session with an empty recap
      // rendered a blank, unreadable, unclickable audit row. It uses `sessionDisplayTitle`, the same helper
      // the search hit uses, so the two surfaces cannot end up calling one thing two names - the
      // `AUDIT_JOURNAL_FALLBACK` rule applied one arm over.
      return { kind: "session", id: projected.id, title: sessionDisplayTitle(projected), journalKind: null };
    }
    case "quest": {
      const projected = projectPlayerQuest(record.quest, { revealedEntityIds: record.revealedEntityIds });
      return projected === null ? null : { kind: "quest", id: projected.id, title: projected.title, journalKind: null };
    }
    case "standing": {
      const projected = projectPlayerStanding(record.standing, { factionRevealed: record.factionRevealed });
      // The faction's title comes from its PAGE, which this projection has just established is revealed -
      // so the name on this row is one the party can already read. The standing row itself stores no title.
      return projected === null ? null : { kind: "standing", id: projected.factionPageId, title: record.factionTitle ?? "", journalKind: null };
    }
  }
}

/**
 * The audit. Counts and rows per reveal surface, plus the whole-codex totals, from ONE pass over the
 * records the caller loaded.
 *
 * `id` on a standing row is the FACTION PAGE id, not the standing row's own - because that is what
 * `POST /codex/standing/{factionPageId}/reveal` takes, and the audit's ids exist to be handed straight
 * back to the existing reveal routes.
 */
export function projectRevealAudit(records: readonly CodexRevealAuditRecord[]): CodexRevealAudit {
  const rowsByKind = new Map<CodexRevealAuditKind, CodexRevealAuditRow[]>(CODEX_REVEAL_AUDIT_KINDS.map((kind) => [kind, []]));
  const totalByKind = new Map<CodexRevealAuditKind, number>(CODEX_REVEAL_AUDIT_KINDS.map((kind) => [kind, 0]));
  for (const record of records) {
    totalByKind.set(record.kind, (totalByKind.get(record.kind) ?? 0) + 1);
    const row = auditRow(record);
    if (row !== null) rowsByKind.get(record.kind)?.push(row);
  }
  const sections = CODEX_REVEAL_AUDIT_KINDS.map((kind) => {
    const rows = rowsByKind.get(kind) ?? [];
    return { kind, revealed: rows.length, total: totalByKind.get(kind) ?? 0, rows };
  });
  return {
    sections,
    revealed: sections.reduce((count, section) => count + section.revealed, 0),
    total: sections.reduce((count, section) => count + section.total, 0)
  };
}
