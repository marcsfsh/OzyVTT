import { randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import type { MapAssetStore } from "./map-assets.js";
import { CodexNotFoundError, CodexRevisionConflictError, type CodexSearchRef, type CodexStore } from "./codex-store.js";
import { projectGmBacklinks, projectGmCalendar, projectGmChronicleRecord, projectGmJournalEntry, projectGmLinkEdges, projectGmMap, projectGmMarker, projectGmPage, projectGmPageSummary, projectGmQuest, projectGmRelationships, projectGmSearchHit, projectGmSession, projectGmStanding, projectPlayerBacklinks, projectPlayerCalendar, projectPlayerChronicleRecord, projectPlayerJournalEntry, projectPlayerLinkEdges, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageMarker, projectPlayerPageSummary, projectPlayerQuest, projectPlayerRelationships, projectPlayerRelationshipEdges, projectPlayerSearchHit, projectPlayerSession, projectPlayerStanding, projectRevealAudit, type CodexRevealAuditRecord, type CodexSearchRecord, type PlayerSessionNumberContext } from "./codex-projections.js";

/**
 * The codex REST surface (`/api/v1/codex/*`), a GM-authed router mounted in `server.ts` alongside the
 * map/token/viewer routers - the same pattern maps use, deliberately OUTSIDE the GameState broadcast.
 * Every write bumps the store's coarse revision and pings clients via `notifyChanged`; every read
 * branches on the caller's role and projects through `codex-projections.ts` so `gmBody` and unrevealed
 * pages can never reach a player.
 */

const CODEX_BASE = "/api/v1/codex";

const TagsSchema = z.array(z.string().trim().min(1).max(40)).max(24);
/**
 * A raw in-world date. Declared once and shared by the journal and page write schemas (CT-11) - two copies
 * of the same bounds is how one surface silently accepts a date the other rejects.
 */
const InWorldDateFields = z.object({ year: z.number().int().min(-100_000).max(100_000), month: z.number().int().min(0).max(23), day: z.number().int().min(1).max(400) });
const InWorldDateSchema = InWorldDateFields.nullable();
const EntityTypeSchema = z.enum(["note", "character", "location", "faction", "item", "species", "religion", "event"]);
const FieldsSchema = z.record(z.string().max(40), z.string().max(2000));
const PageCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  entityType: EntityTypeSchema.optional(),
  fields: FieldsSchema.optional(),
  gmFields: FieldsSchema.optional(),
  folder: z.string().max(160).nullable().optional(),
  tags: TagsSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  revealedToPlayers: z.boolean().optional(),
  bannerAssetId: z.string().uuid().nullable().optional(),
  /** CT-11: what places an `event` page on the chronicle. Omitted = undated; `null` = clear the date. */
  inWorldDate: InWorldDateSchema.optional()
}).strict();
const PageUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  entityType: EntityTypeSchema.optional(),
  fields: FieldsSchema.optional(),
  gmFields: FieldsSchema.optional(),
  folder: z.string().max(160).nullable().optional(),
  tags: TagsSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  bannerAssetId: z.string().uuid().nullable().optional(),
  inWorldDate: InWorldDateSchema.optional(),
  expectedRev: z.number().int().nonnegative().optional()
}).strict();
const RelationshipCreateSchema = z.object({ toPageId: z.string().uuid(), type: z.string().trim().min(1).max(40) }).strict();
const RevealSchema = z.object({ revealed: z.boolean() }).strict();
const FolderMoveSchema = z.object({ from: z.string().trim().min(1).max(160), to: z.string().trim().max(160) }).strict();
const FolderPathSchema = z.object({ path: z.string().trim().min(1).max(160) }).strict();

const MapKindSchema = z.enum(["battlemap", "regional", "world"]);
const MapCreateSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  kind: MapKindSchema,
  parentMapId: z.string().uuid().nullable().optional(),
  revealedToPlayers: z.boolean().optional(),
  tags: TagsSchema.optional()
}).strict();
const MapUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), kind: MapKindSchema.optional(), tags: TagsSchema.optional() }).strict();
const MapParentSchema = z.object({ parentMapId: z.string().uuid().nullable() }).strict();

const Coord = z.number().finite().min(0).max(1_000_000);
const IconColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const IconId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(60);
const MarkerLinks = {
  pageIds: z.array(z.string().uuid()).max(24).optional(),
  subMapId: z.string().uuid().nullable().optional(),
  sceneIds: z.array(z.string().uuid()).max(24).optional(),
  actorId: z.string().uuid().nullable().optional()
};
const MarkerCreateSchema = z.object({
  x: Coord, y: Coord, iconId: IconId, iconColor: IconColor,
  label: z.string().max(120).nullable().optional(), revealedToPlayers: z.boolean().optional(), tags: TagsSchema.optional(), ...MarkerLinks
}).strict();
const MarkerUpdateSchema = z.object({
  x: Coord.optional(), y: Coord.optional(), iconId: IconId.optional(), iconColor: IconColor.optional(),
  label: z.string().max(120).nullable().optional(), revealedToPlayers: z.boolean().optional(), tags: TagsSchema.optional(), ...MarkerLinks
}).strict();
const MarkerMoveSchema = z.object({ x: Coord, y: Coord }).strict();
/**
 * CT-7: mark this pin as the party, or stop it being the party. One boolean and nothing else - the pin's
 * position, label, links and reveal state are all set through the routes that already own them, because the
 * party marker is an ORDINARY marker with a flag, and moving it IS moving a marker (`POST /markers/{id}/move`).
 */
const MarkerPartySchema = z.object({ isParty: z.boolean() }).strict();

const JournalWriteSchema = z.object({
  tags: TagsSchema.optional(),
  playerText: z.string().max(20_000).optional(),
  gmText: z.string().max(20_000).nullable().optional(),
  revealedToPlayers: z.boolean().optional(),
  attachMarkerId: z.string().uuid().nullable().optional(),
  attachPageId: z.string().uuid().nullable().optional(),
  sessionNumber: z.number().int().min(0).max(100_000).nullable().optional(),
  realDate: z.string().max(40).nullable().optional(),
  inWorldLabel: z.string().max(120).nullable().optional(),
  inWorldDate: InWorldDateSchema.optional()
}).strict();
/**
 * M11 deadlines (CT-5). Everything a journal entry accepts, with ONE difference: `inWorldDate` is REQUIRED
 * and cannot be null. A deadline is "a thing that will happen at a time" and its `fired` state is derived
 * from that date alone (D11-C), so an undated deadline is not a deadline - it is a note that can never fire.
 * The store rejects it too; this is the early rejection, exactly as `.strict()` is everywhere else here.
 *
 * There is no `kind` field to send and no reveal rule of its own: `revealedToPlayers` rides in from
 * `JournalWriteSchema` unchanged, because O-2 makes a deadline hidden-by-default and revealable exactly like
 * any other entry - not GM-only, and not published by a switch of its own.
 */
const DeadlineCreateSchema = JournalWriteSchema.extend({ inWorldDate: InWorldDateFields });
/**
 * M11 downtime (CT-10). `days` is the spec's "timeCost", named for what it is; its bounds are the ones
 * `CodexDowntimePayload` publishes (0 to 3650 - ten years is already far past the point where a GM would
 * type a date instead). `who`/`activity` share the marker-label bound of 120, the same reason
 * `SessionNumberSchema` shares the journal's: one value, one bound, in one place.
 *
 * `applied` is deliberately not an input. O-3 makes confirming the clock move a separate, explicit act
 * (`POST /journal/{id}/apply-downtime`); accepting it here would let one POST both record the week off and
 * move the campaign clock, which is the exact side effect the owner asked us to stop doing.
 *
 * `who`/`activity` are NOT `.min(1)`, and that is a correction rather than a looseness. Downtime is often
 * party-wide ("the party rests a week") with nobody in particular to name, the store accepts a blank half
 * on the `questObjectives` precedent, and the composer's submit arms on prose OR who OR activity - so a
 * `.min(1)` here made a state the UI offers fail with a raw "String must contain at least 1 character(s)".
 * Caught by driving the real route with the body the composer builds; the two suites mock each other and
 * neither could see it. `downtimeSummaryLabel` already drops a blank half without stray punctuation.
 */
const DowntimeInputSchema = z.object({
  who: z.string().trim().max(120),
  activity: z.string().trim().max(120),
  days: z.number().int().min(0).max(3650)
}).strict();
const DowntimeCreateSchema = JournalWriteSchema.extend({ downtime: DowntimeInputSchema });
/**
 * M12 milestones (CT-8) - `DowntimeCreateSchema`'s shape verbatim, one kind later, so the third structured
 * journal kind is composed the way the first two are rather than inventing a third convention.
 *
 * `level` is 1-20, the repo's existing character-level bound (`homebrewLevel` in the contract publishes the
 * same numbers), because CT-8 is "milestone / level history" and no 5e character is level 0 or 21. There is
 * no XP field: the spec says "no XP arithmetic" in as many words.
 *
 * `reason` is NOT `.min(1)` and carries a `""` default, the `who`/`activity` correction applied before it can
 * bite: "we hit 5" with the why in the entry's own prose is a legitimate body, and a minimum here would 400 a
 * state the composer can reach. `max(120)` is the repo's one-line-of-display bound, shared with a marker
 * label, an `inWorldLabel` and an objective's text.
 */
const MilestoneInputSchema = z.object({
  level: z.number().int().min(1).max(20),
  reason: z.string().trim().max(120).default("")
}).strict();
const MilestoneCreateSchema = JournalWriteSchema.extend({ milestone: MilestoneInputSchema });
/**
 * M9 sessions. `sessionNumber`'s bounds are the journal's verbatim, on purpose: the two are the SAME
 * number - a journal entry's `sessionNumber` resolves against a session record - and two copies of the
 * bound is how one surface silently accepts a value the other rejects (the reason `InWorldDateSchema`
 * above is shared rather than repeated).
 */
const SessionNumberSchema = z.number().int().min(0).max(100_000).nullable();
const AttendeesSchema = z.array(z.string().trim().min(1).max(40)).max(24);
const SessionStatusSchema = z.enum(["planned", "played"]);
const SessionCreateSchema = z.object({
  sessionNumber: SessionNumberSchema.optional(),
  realDate: z.string().max(40).nullable().optional(),
  attendees: AttendeesSchema.optional(),
  prepBody: z.string().max(100_000).optional(),
  recapBody: z.string().max(100_000).optional(),
  revealedToPlayers: z.boolean().optional(),
  status: SessionStatusSchema.optional()
}).strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a recap as a side effect of an edit. */
const SessionUpdateSchema = z.object({
  sessionNumber: SessionNumberSchema.optional(),
  realDate: z.string().max(40).nullable().optional(),
  attendees: AttendeesSchema.optional(),
  prepBody: z.string().max(100_000).optional(),
  recapBody: z.string().max(100_000).optional(),
  status: SessionStatusSchema.optional(),
  expectedRev: z.number().int().nonnegative().optional()
}).strict();
/**
 * M10 quests. The body bound is `z.string().max(100_000)`, the page/session bound verbatim, because a
 * quest body IS a two-layer prose body and `body()` in the store enforces exactly that number - two
 * copies of one bound is how one surface silently accepts a value the other rejects.
 *
 * `ObjectiveSchema` mirrors `questObjectives` in the store: 24 items and 120 characters, the numbers
 * `CodexQuestObjective` publishes. `text` is NOT `.min(1)`, deliberately - the checklist's real flow is
 * "add a row, then type into it" and the editor autosaves the whole draft, so a minimum would 400 the
 * first save after "Add item". The published schema agreed to this rather than the reverse, and says so
 * in its own description, so the contract is not advertising a rule nobody enforces. See
 * `questObjectives` for the full reasoning; the store is the enforcer, this is the early rejection.
 */
const QuestStatusSchema = z.enum(["active", "completed", "failed"]);
const ObjectiveSchema = z.object({ text: z.string().max(120), done: z.boolean() }).strict();
const ObjectivesSchema = z.array(ObjectiveSchema).max(24);
const QuestEntityIdsSchema = z.array(z.string().uuid()).max(24);
const QuestCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  status: QuestStatusSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  objectives: ObjectivesSchema.optional(),
  entityIds: QuestEntityIdsSchema.optional(),
  revealedToPlayers: z.boolean().optional()
}).strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a quest as a side effect of an edit. */
const QuestUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  status: QuestStatusSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  objectives: ObjectivesSchema.optional(),
  entityIds: QuestEntityIdsSchema.optional(),
  expectedRev: z.number().int().nonnegative().optional()
}).strict();
/**
 * M12 standing (CT-6). `value` is the SIGNED -100..100 scale (M12-B): a faction can be actively against the
 * party, which an unsigned "favour" bar cannot say.
 *
 * The store CLAMPS to the same range and this REJECTS outside it, which is the deliberate arrangement
 * everywhere in this file (the router is the early rejection, the store is the enforcer) - the client's
 * control cannot produce 150, so a 150 is a malformed caller and deserves to hear so rather than to be
 * silently corrected. The clamp still stands behind it for every non-HTTP writer.
 *
 * `reason` is optional and may be empty, for the reason `DowntimeInputSchema`'s `who`/`activity` are: the
 * GM adjusting a standing mid-session should not be blocked on typing a sentence, and the change itself is
 * still recorded on the chronicle. `max(120)` is the repo's one-line bound.
 */
const StandingSetSchema = z.object({
  value: z.number().int().min(-100).max(100),
  reason: z.string().trim().max(120).default("")
}).strict();
const CalendarSchema = z.object({
  yearName: z.string().max(20),
  months: z.array(z.object({ name: z.string().trim().min(1).max(40), days: z.number().int().min(1).max(400) })).min(1).max(24),
  weekdays: z.array(z.string().trim().min(1).max(40)).max(20),
  currentDate: z.object({ year: z.number().int().min(-100_000).max(100_000), month: z.number().int().min(0).max(23), day: z.number().int().min(1).max(400) }).nullable().optional()
}).strict();

type CodexRouterOptions = Readonly<{
  store: CodexStore;
  /** Content-addressed store for page media (banners + inline images), separate from map/token assets. */
  assets: MapAssetStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined) => boolean;
  /** Emit a content-free `codex:changed` ping so every client refetches its projected view. */
  notifyChanged: (scope: "pages" | "maps" | "markers" | "journal" | "sessions" | "quests") => void;
  /**
   * Mints a short-lived PLAYER token so the GM can preview the player Codex truthfully. The preview must
   * be a real player principal - `roleOf` below checks `authorizeGm` FIRST, so reusing the GM's own token
   * would silently return GM projections while claiming to be the player view.
   */
  issuePreviewSession: () => string;
}>;

const CODEX_ASSET_BASE = "/api/v1/codex-assets";

function bearer(request: Request): string | undefined {
  return request.header("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
}
/** A route param is always a single string at runtime; coerce the Express `string | string[]` type. */
function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  return typeof value === "string" ? value : "";
}
function envelope(response: Response, status: number, data: unknown) {
  return response.status(status).json({ ok: true, apiVersion: API_VERSION, data });
}
function failure(response: Response, status: number, code: string, message: string) {
  const id = response.getHeader("x-request-id")?.toString() ?? randomUUID();
  return response.status(status).json({ ok: false, apiVersion: API_VERSION, error: { code, message, requestId: id } });
}
function malformed(response: Response, error: unknown) {
  return failure(response, 400, "validation_failed", error instanceof z.ZodError ? (error.issues[0]?.message ?? "The request is malformed.") : (error as Error).message);
}
/** Map a store/validation error to its HTTP envelope: 404 not-found, 409 conflict, else 400 malformed. */
function codexError(response: Response, error: unknown) {
  if (error instanceof CodexRevisionConflictError) return failure(response, 409, "conflict", error.message);
  if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
  return malformed(response, error);
}

/**
 * Resolve one search hit to the live record plus the CONTEXT its player predicate needs. A marker
 * carries its map's reveal flag because a pin on a secret map is invisible to players however the pin
 * itself is flagged (CD-6) - the identical resolution `GET /codex/maps/:id/markers` performs before it
 * projects a single marker. Returns null for a row whose record has since gone.
 */
function loadSearchRecord(store: CodexStore, ref: CodexSearchRef): CodexSearchRecord | null {
  switch (ref.kind) {
    case "page": { const page = store.getPage(ref.id); return page ? { kind: "page", page } : null; }
    case "journal": { const entry = store.getEntry(ref.id); return entry ? { kind: "journal", entry } : null; }
    case "map": { const map = store.getMap(ref.id); return map ? { kind: "map", map } : null; }
    case "marker": {
      const marker = store.getMarker(ref.id);
      if (!marker) return null;
      return { kind: "marker", marker, mapRevealed: store.getMap(marker.mapId)?.revealedToPlayers ?? false };
    }
    // No context to resolve: a quest's own reveal flag is the whole player predicate, and a hit carries
    // no entity linkage (unlike the quest RECORD, whose `entityIds` the list route filters).
    case "quest": { const quest = store.getQuest(ref.id); return quest ? { kind: "quest", quest } : null; }
  }
}

/**
 * Of a record's linked PAGE ids, the subset that is itself revealed. This is the resolution both marker
 * routes were already performing inline (`store.getPage(id)?.revealedToPlayers ?? false`, a missing page
 * counting as NOT revealed), lifted out when M10's quest routes became the third caller: three hand-copies
 * of one viewer-safety predicate is three chances for one of them to be weakened alone.
 *
 * It answers the question; it does not make the decision. `projectPlayerMarker` / `projectPlayerQuest`
 * still own what a player may see, and each takes the resolved set as context so no projection reaches
 * back into the store.
 */
function revealedPageIdsIn(store: CodexStore, pageIds: readonly string[]): ReadonlySet<string> {
  return new Set(pageIds.filter((pageId) => store.getPage(pageId)?.revealedToPlayers ?? false));
}

/**
 * Is THIS page revealed? The one-page form of `revealedPageIdsIn`, written in terms of it rather than beside
 * it, so M12's standing routes cannot end up asking the question with a fourth hand-copied expression.
 * `projectPlayerStanding` still owns whether a standing travels; this only answers the question it asks.
 */
function pageRevealedFor(store: CodexStore, pageId: string): boolean {
  return revealedPageIdsIn(store, [pageId]).has(pageId);
}

/**
 * The session context every PLAYER journal read needs, resolved once per request rather than per row: which
 * `sessionNumber`s name a session record the players have not been shown. Sibling of `revealedPageIdsIn`
 * above, with the same division of labour - it ANSWERS the question, it does not make the decision;
 * `projectPlayerJournalEntry` still owns whether the number travels.
 *
 * It exists as a helper for the reason that one did: `GET /codex/journal` and `GET /codex/timeline` are two
 * call sites for one viewer-safety resolution, and two hand-copies is two chances for one to be weakened
 * alone. A GM read never calls it - the GM projection is not gated.
 */
function playerSessionNumbers(store: CodexStore): PlayerSessionNumberContext {
  // `revealedPageIds` rides along because `projectPlayerJournalEntry` needs it to gate a `standing`
  // record against its faction page. Resolved HERE, once, so every player journal read — the timeline,
  // `GET /codex/journal`, the per-page and per-marker mini-timelines, search and the reveal audit — is
  // gated by construction rather than by each route remembering. The gate used to live on the chronicle
  // alone, and the three surfaces that did not go through it leaked.
  // The candidate set is the factions standing is tracked against — one row per faction, so this is small
  // and precise rather than "every revealed page". A standing record whose faction page was deleted has no
  // candidate at all and is therefore hidden, which is the right answer.
  return {
    unrevealedSessionNumbers: store.unrevealedSessionNumbers(),
    revealedPageIds: revealedPageIdsIn(store, store.listStanding().map((row) => row.factionPageId))
  };
}

export function createCodexRouter(options: CodexRouterOptions) {
  const router = Router();
  const { store } = options;

  router.use((request, response, next) => {
    response.setHeader("x-request-id", randomUUID());
    response.setHeader("cache-control", "no-store");
    next();
  });

  const roleOf = (request: Request): "gm" | "player" | null => {
    const token = bearer(request);
    if (options.authorizeGm(token)) return "gm";
    if (options.authorizePlayer(token)) return "player";
    return null;
  };
  const requireGm = (request: Request, response: Response, next: NextFunction) => {
    if (!options.authorizeGm(bearer(request))) return failure(response, 401, "unauthenticated", "A valid GM session is required.");
    next();
  };

  // ----- Pages: list + search (GM or player; player sees only revealed) -----

  router.get(`${CODEX_BASE}/pages`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const filter = {
      folder: request.query.folder === undefined ? undefined : (request.query.folder === "" ? null : String(request.query.folder)),
      tag: request.query.tag === undefined ? undefined : String(request.query.tag)
    };
    const rows = store.listPages(filter);
    const pages = role === "gm" ? rows.map(projectGmPageSummary) : rows.map(projectPlayerPageSummary).filter((page) => page !== null);
    return envelope(response, 200, { pages });
  });

  /**
   * CI-1 / R8: ONE search box, ONE result list, all record types - so this stays the single search
   * route and simply learned to return more kinds, rather than gaining a sibling.
   *
   * `hits` is that one list (pages, journal entries, maps, markers), discriminated by `kind`.
   *
   * A page-only `results` array rode alongside it for exactly one commit, so the client could migrate
   * without a flag-day. Every caller now reads `hits`, so it is gone: two lists answering one query is
   * the parallel-mechanism problem this overhaul exists to remove, and the Codex has no external API
   * consumer to keep it for.
   */
  router.get(`${CODEX_BASE}/search`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to search the codex.");
    const query = typeof request.query.q === "string" ? request.query.q : "";
    // Resolved before the map so it is computed once per request, not once per hit. Built for both
    // roles rather than conditionally: it is two cheap reads, and a `null` here would only push the
    // branch into the projection call below, where forgetting it is a leak rather than a type error.
    const playerContext = playerSessionNumbers(store);
    const hits = store.searchAll(role, query)
      .map((ref) => loadSearchRecord(store, ref))
      .filter((record) => record !== null)
      .map((record) => (role === "gm" ? projectGmSearchHit(record) : projectPlayerSearchHit(record, playerContext)))
      .filter((hit) => hit !== null);
    return envelope(response, 200, { hits });
  });

  router.get(`${CODEX_BASE}/pages/:id`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    if (role === "gm") return envelope(response, 200, { page: projectGmPage(page), backlinks: projectGmBacklinks(store.backlinksToPage(page.id)), relationships: projectGmRelationships(store.listRelationshipsFor(page.id)) });
    const projected = projectPlayerPage(page);
    if (!projected) return failure(response, 404, "not_found", "That page was not found.");
    return envelope(response, 200, { page: projected, backlinks: projectPlayerBacklinks(store.backlinksToPage(page.id)), relationships: projectPlayerRelationships(store.listRelationshipsFor(page.id)) });
  });

  // ----- Pages: authoring (GM only) -----

  router.post(`${CODEX_BASE}/pages`, requireGm, (request, response) => {
    try {
      const input = PageCreateSchema.parse(request.body);
      const page = store.createPage(input);
      options.notifyChanged("pages");
      return envelope(response, 201, { page: projectGmPage(page) });
    } catch (error) { return malformed(response, error); }
  });

  router.patch(`${CODEX_BASE}/pages/:id`, requireGm, (request, response) => {
    try {
      const { expectedRev, ...fields } = PageUpdateSchema.parse(request.body);
      const page = store.updatePage(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged("pages");
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexRevisionConflictError) return failure(response, 409, "conflict", error.message);
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  router.post(`${CODEX_BASE}/pages/:id/reveal`, requireGm, (request, response) => {
    try {
      const { revealed } = RevealSchema.parse(request.body);
      const page = store.setPageRevealed(pathParam(request, "id"), revealed);
      options.notifyChanged("pages");
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/pages/:id`, requireGm, (request, response) => {
    store.deletePage(pathParam(request, "id"));
    options.notifyChanged("pages");
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/folders/move`, requireGm, (request, response) => {
    try {
      const { from, to } = FolderMoveSchema.parse(request.body);
      const moved = store.moveFolder(from, to);
      options.notifyChanged("pages");
      return envelope(response, 200, { moved });
    } catch (error) { return malformed(response, error); }
  });

  // Folder records make empty folders persist (a folder is otherwise only implied by the pages inside it). GM-only.
  router.get(`${CODEX_BASE}/folders`, requireGm, (_request, response) => envelope(response, 200, { folders: store.listFolders() }));
  // ----- GM preview: mint a real, short-lived player principal (never a role flag on the GM token) -----
  router.post(`${CODEX_BASE}/preview-session`, requireGm, (_request, response) => {
    try { return envelope(response, 201, { token: options.issuePreviewSession() }); }
    catch (error) { return malformed(response, error); }
  });

  router.post(`${CODEX_BASE}/folders`, requireGm, (request, response) => {
    try { const path = store.createFolder(FolderPathSchema.parse(request.body).path); options.notifyChanged("pages"); return envelope(response, 201, { path }); }
    catch (error) { return malformed(response, error); }
  });
  router.post(`${CODEX_BASE}/folders/delete`, requireGm, (request, response) => {
    try { store.deleteFolder(FolderPathSchema.parse(request.body).path); options.notifyChanged("pages"); return envelope(response, 200, { deleted: true }); }
    catch (error) { return malformed(response, error); }
  });

  router.get(`${CODEX_BASE}/pages/:id/revisions`, requireGm, (request, response) => {
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    return envelope(response, 200, { revisions: store.listRevisions(page.id) });
  });

  router.post(`${CODEX_BASE}/pages/:id/revisions/:revisionId/restore`, requireGm, (request, response) => {
    try {
      const revisionId = Number(request.params.revisionId);
      if (!Number.isInteger(revisionId)) return failure(response, 400, "validation_failed", "The revision id is malformed.");
      const page = store.restoreRevision(pathParam(request, "id"), revisionId, "gm");
      options.notifyChanged("pages");
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  // ----- Relationships (typed entity edges) -----

  router.post(`${CODEX_BASE}/pages/:id/relationships`, requireGm, (request, response) => {
    try { const { toPageId, type } = RelationshipCreateSchema.parse(request.body); const relationship = store.createRelationship(pathParam(request, "id"), toPageId, type); options.notifyChanged("pages"); return envelope(response, 201, { relationship }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/relationships/:id`, requireGm, (request, response) => {
    store.deleteRelationship(pathParam(request, "id"));
    options.notifyChanged("pages");
    return envelope(response, 200, { deleted: true });
  });

  router.get(`${CODEX_BASE}/relationships`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const all = store.listAllRelationships();
    if (role === "gm") return envelope(response, 200, { relationships: all });
    // Player graph: project through the choke point - only edges whose BOTH endpoints are revealed pages.
    const revealed = new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id));
    return envelope(response, 200, { relationships: projectPlayerRelationshipEdges(all, revealed) });
  });

  /**
   * CI-8: the whole-graph WIKI-LINK feed - the sibling of the typed-edge route above, and deliberately
   * its neighbour. The Graph drew only typed relationships, so a codex wired together with `[[links]]`
   * looked like a field of orphans; it now draws both kinds, visually distinguished.
   *
   * A player's edges obey the SAME both-endpoints-revealed rule the typed feed enforces (a dangling edge
   * would let a player infer a hidden page exists) AND the layer rule `projectPlayerBacklinks` applies -
   * player-body links only, never the GM body's. `projectPlayerLinkEdges` holds both; the store hands
   * over raw rows so that projection is the only gate.
   */
  router.get(`${CODEX_BASE}/links`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the codex.");
    const all = store.listAllLinks();
    if (role === "gm") return envelope(response, 200, { links: projectGmLinkEdges(all) });
    const revealed = new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id));
    return envelope(response, 200, { links: projectPlayerLinkEdges(all, revealed) });
  });

  // ----- Maps (the atlas tree) -----

  router.get(`${CODEX_BASE}/maps`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the atlas.");
    const rows = store.listMaps();
    // A player's map keeps its parent link only when that parent is itself revealed - resolve per row (mirrors the marker route below).
    const revealed = new Set(rows.filter((row) => row.revealedToPlayers).map((row) => row.id));
    const maps = role === "gm"
      ? rows.map(projectGmMap)
      : rows.map((row) => projectPlayerMap(row, { parentRevealed: row.parentMapId ? revealed.has(row.parentMapId) : false })).filter((map) => map !== null);
    return envelope(response, 200, { maps });
  });

  router.post(`${CODEX_BASE}/maps`, requireGm, (request, response) => {
    try { const map = store.createMap(MapCreateSchema.parse(request.body)); options.notifyChanged("maps"); return envelope(response, 201, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/maps/:id`, requireGm, (request, response) => {
    try { const map = store.updateMap(pathParam(request, "id"), MapUpdateSchema.parse(request.body)); options.notifyChanged("maps"); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/maps/:id/parent`, requireGm, (request, response) => {
    try { const map = store.setMapParent(pathParam(request, "id"), MapParentSchema.parse(request.body).parentMapId); options.notifyChanged("maps"); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/maps/:id/reveal`, requireGm, (request, response) => {
    try { const map = store.setMapRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("maps"); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/maps/:id`, requireGm, (request, response) => {
    store.deleteMap(pathParam(request, "id"));
    options.notifyChanged("maps");
    return envelope(response, 200, { deleted: true });
  });

  // ----- Markers -----

  router.get(`${CODEX_BASE}/maps/:id/markers`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the atlas.");
    const mapId = pathParam(request, "id");
    const map = store.getMap(mapId);
    if (!map) return failure(response, 404, "not_found", "That map was not found.");
    const rows = store.listMarkers(mapId);
    if (role === "gm") return envelope(response, 200, { markers: rows.map(projectGmMarker) });
    if (!map.revealedToPlayers) return failure(response, 404, "not_found", "That map was not found.");
    const markers = rows
      .map((row) => projectPlayerMarker(row, {
        revealedPageIds: revealedPageIdsIn(store, row.pageIds),
        subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
      }))
      .filter((marker) => marker !== null);
    return envelope(response, 200, { markers });
  });

  /**
   * CI-4, the REVERSE of the route directly above: which pins on the atlas point at THIS page, so an open
   * page can offer "seen on the map" instead of the Atlas being the only way to find out.
   *
   * This is a NEW player-reachable read, so nothing about its gating is invented - every clause is copied
   * from a route that already enforces it, and it is deliberately placed beside the forward read so the
   * two can be compared at a glance:
   *   - the PAGE gate comes from `GET /codex/journal?pageId=`: a player may only ask about a location
   *     they can already see, so an unrevealed page 404s before any pin is considered. Without it, a page
   *     id (however obtained) becomes a probe for "does the party have a pin on this place?".
   *   - each pin then goes through `projectPlayerPageMarker`, which is `projectPlayerMarker` PLUS the map
   *     gate the forward route applies before it projects anything (CD-6). A revealed pin on a secret map
   *     is invisible on the Atlas and is invisible here.
   * The store's `markersForPage` is deliberately ungated, so this projection is the ONLY gate.
   */
  router.get(`${CODEX_BASE}/pages/:id/markers`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the atlas.");
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    if (role !== "gm" && !page.revealedToPlayers) return failure(response, 404, "not_found", "That page was not found.");
    const rows = store.markersForPage(page.id);
    if (role === "gm") return envelope(response, 200, { markers: rows.map(projectGmMarker) });
    const markers = rows
      .map((row) => projectPlayerPageMarker({
        marker: row,
        mapRevealed: store.getMap(row.mapId)?.revealedToPlayers ?? false,
        revealedPageIds: revealedPageIdsIn(store, row.pageIds),
        subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
      }))
      .filter((marker) => marker !== null);
    return envelope(response, 200, { markers });
  });

  router.post(`${CODEX_BASE}/maps/:id/markers`, requireGm, (request, response) => {
    try { const marker = store.createMarker(pathParam(request, "id"), MarkerCreateSchema.parse(request.body)); options.notifyChanged("markers"); return envelope(response, 201, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/markers/:id`, requireGm, (request, response) => {
    try { const marker = store.updateMarker(pathParam(request, "id"), MarkerUpdateSchema.parse(request.body)); options.notifyChanged("markers"); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/markers/:id/move`, requireGm, (request, response) => {
    try { const { x, y } = MarkerMoveSchema.parse(request.body); const marker = store.moveMarker(pathParam(request, "id"), x, y); options.notifyChanged("markers"); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/markers/:id/reveal`, requireGm, (request, response) => {
    try { const marker = store.setMarkerRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("markers"); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * CT-7 / M12-C: which pin is the party. ONE marker atlas-wide, so setting a new one clears the old in the
   * store's single transaction and no reconciliation rule is needed - "the party is in exactly one place".
   *
   * `isParty: false` clears the flag on THIS marker only. That is why it is not simply `setPartyMarker(null)`:
   * that clears whichever marker currently holds the flag, so calling it unconditionally would unset a
   * DIFFERENT pin whenever the GM switched off a marker that was never the party.
   *
   * There is deliberately no party-specific move, reveal or delete route. A party pin is moved by moving the
   * marker, revealed by revealing the marker, and deleted by deleting the marker - one flag on the record
   * every existing marker route already owns.
   */
  router.put(`${CODEX_BASE}/markers/:id/party`, requireGm, (request, response) => {
    try {
      const markerId = pathParam(request, "id");
      const { isParty } = MarkerPartySchema.parse(request.body);
      if (isParty) store.setPartyMarker(markerId);
      else if (store.partyMarker()?.id === markerId) store.setPartyMarker(null);
      // The one existence check, and it covers both arms: `setPartyMarker` throws `CodexNotFoundError` on an
      // unknown id, and the clearing arm - which is a no-op for an id that holds no flag - falls through to
      // this read. An up-front `getMarker` guard as well was measurably dead: no mutation of it failed a test.
      const marker = store.getMarker(markerId);
      if (!marker) return failure(response, 404, "not_found", "That marker was not found.");
      options.notifyChanged("markers");
      return envelope(response, 200, { marker: projectGmMarker(marker) });
    } catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/markers/:id`, requireGm, (request, response) => {
    store.deleteMarker(pathParam(request, "id"));
    options.notifyChanged("markers");
    return envelope(response, 200, { deleted: true });
  });

  // ----- Journal / timeline -----

  router.get(`${CODEX_BASE}/journal`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the journal.");
    const markerId = typeof request.query.markerId === "string" ? request.query.markerId : undefined;
    const pageId = typeof request.query.pageId === "string" ? request.query.pageId : undefined;
    // A player may read a location's mini-timeline only when the location (marker/page) is itself revealed -
    // otherwise a hidden pin/page id (however obtained) could be probed. Entry-level reveal is still enforced below.
    if (role !== "gm") {
      if (markerId && !store.getMarker(markerId)?.revealedToPlayers) return failure(response, 404, "not_found", "That was not found.");
      if (pageId && !store.getPage(pageId)?.revealedToPlayers) return failure(response, 404, "not_found", "That was not found.");
    }
    const rows = markerId || pageId ? store.listEntriesFor({ markerId, pageId }) : store.listTimeline();
    if (role === "gm") return envelope(response, 200, { entries: rows.map(projectGmJournalEntry) });
    // An entry's `sessionNumber` is gated on the SESSION's reveal state, not the entry's, so the caller
    // resolves that set here - the `revealedPageIdsIn` division of labour, one record type later.
    const context = playerSessionNumbers(store);
    const entries = rows.map((row) => projectPlayerJournalEntry(row, context)).filter((entry) => entry !== null);
    return envelope(response, 200, { entries });
  });

  /**
   * CT-11 / CT-12: **the one chronicle** - journal entries and dated `event` pages in one chronological
   * list, one row shape (R2). Both lenses read this; "by session" is a REGROUPING of these same records,
   * not a second fetch, so the two lenses cannot disagree about what exists.
   *
   * A NEW player-reachable read, and the design doc calls out exactly why that matters: the player Codex
   * fetches the timeline, so every record kind that resolves onto the chronicle is player-reachable by
   * DEFAULT rather than by decision. Nothing here filters - `store.listChronicle()` is ungated on purpose
   * and `projectPlayerChronicleRecord` is the single gate (K1), which in turn delegates to the page and
   * journal player projections rather than restating them.
   *
   * Deliberately a NEW route rather than a widened `GET /codex/journal`: that route's `entries` are journal
   * rows, read by the page mini-timeline, the marker mini-timeline and the Campaign dashboard. Making it
   * polymorphic would hand three unrelated callers records they never asked for.
   */
  router.get(`${CODEX_BASE}/timeline`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the chronicle.");
    const rows = store.listChronicle();
    if (role === "gm") {
      // The GM's `fired` is measured against `campaignInstant()`, the GM's OWN clock; the player branch below
      // measures against `publishedInstant()`. Two clocks, two accessors, resolved in two separate branches on
      // purpose (O-1 / D11-G) - one shared local would be a single careless edit away from being the leak.
      const campaignInstant = store.campaignInstant();
      const records = rows.map((row) => projectGmChronicleRecord(row, {
        campaignInstant,
        // O-3's proposal, per row: only an unapplied downtime has one, and only the GM ever sees it.
        proposedDate: row.kind === "entry" ? store.proposedDateFor(row.entry) : null
      }));
      return envelope(response, 200, { records });
    }
    // The same session context `GET /codex/journal` resolves, for the same reason: an `entry` row's
    // `sessionNumber` reaches a player through `projectPlayerJournalEntry`, which this delegates to.
    const context = playerSessionNumbers(store);
    const publishedInstant = store.publishedInstant();
    // M12: a `standing` record's payload names a faction PAGE, and a published record must not advertise a
    // faction the party has never met. Resolved here, once per request, in the same division of labour the
    // session context above follows - the caller answers "which pages are revealed", the projection decides
    // whether the id travels. The set is the one `GET /codex/relationships` and `GET /codex/links` build.
    const revealedPageIds = new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id));
    const records = rows.map((row) => projectPlayerChronicleRecord(row, { ...context, publishedInstant, revealedPageIds })).filter((record) => record !== null);
    return envelope(response, 200, { records });
  });

  router.post(`${CODEX_BASE}/journal`, requireGm, (request, response) => {
    try { const entry = store.createEntry(JournalWriteSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 201, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * M11: DEADLINES (CT-5) and DOWNTIME (CT-10) - two more journal kinds, deliberately created through their
   * own routes rather than a `kind` field on `POST /codex/journal`, because each has a rule that entry does
   * not: a deadline REQUIRES a structured date, and downtime requires its payload. A polymorphic body would
   * have to accept both and enforce neither until it reached the store.
   *
   * Registered BEFORE the `/journal/:id` family below. There is in fact no conflict to avoid today - the only
   * routes on `/journal/:id` are PATCH and DELETE, and the only POST under it is the two-segment
   * `/journal/:id/reveal` - so Express could not mis-match `POST /journal/deadline` whichever order these
   * were written in. They are placed first anyway, so that adding `POST /codex/journal/:id` later cannot
   * quietly swallow them; order is the cheap defence and it has to be in place before it is needed.
   *
   * There is NO deadline/downtime reveal route: `POST /codex/journal/{id}/reveal` already works on any journal
   * entry, and O-2 makes these records hidden-but-revealable exactly like every other one. A kind-specific
   * reveal route would be a second gate to keep in step with the first.
   */
  router.post(`${CODEX_BASE}/journal/deadline`, requireGm, (request, response) => {
    try { const entry = store.createDeadline(DeadlineCreateSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 201, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * Creating downtime NEVER moves the clock (O-3). It answers with the date the clock WOULD move to, so the
   * GM's confirm affordance can say what it will do before it does it; `apply-downtime` below is the only
   * thing that moves anything.
   */
  router.post(`${CODEX_BASE}/journal/downtime`, requireGm, (request, response) => {
    try {
      const entry = store.createDowntime(DowntimeCreateSchema.parse(request.body));
      options.notifyChanged("journal");
      return envelope(response, 201, { entry: projectGmJournalEntry(entry), proposedDate: store.proposedDateFor(entry) });
    } catch (error) { return codexError(response, error); }
  });

  /**
   * M12: MILESTONES (CT-8) - the third structured journal kind, registered here for the reason the two above
   * are: its payload is required and an ordinary `POST /codex/journal` could accept neither it nor reject its
   * absence. Placed BEFORE the `/journal/:id` family so a later `POST /codex/journal/:id` cannot swallow it.
   *
   * No reveal route of its own, exactly like a deadline and a downtime: `POST /codex/journal/{id}/reveal`
   * already works on every journal kind, and a kind-specific gate is a second gate to keep in step.
   */
  router.post(`${CODEX_BASE}/journal/milestone`, requireGm, (request, response) => {
    try { const entry = store.createMilestone(MilestoneCreateSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 201, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * O-3's confirmation: the GM says yes, and the campaign clock moves by the downtime's `days`.
   *
   * Answers with the entry AND the calendar, because one operation changed both and a client that refetched
   * only the entry would render an out-of-date "Now:" until something else happened to reload it. The
   * calendar comes back GM-projected, the same shape `GET /codex/calendar` hands a GM.
   *
   * Applying twice is refused by the store rather than being made a no-op here: "already applied" is a real
   * answer the GM should see, and a silent second success is how a clock quietly gains a week.
   */
  router.post(`${CODEX_BASE}/journal/:id/apply-downtime`, requireGm, (request, response) => {
    try {
      const { entry, calendar } = store.applyDowntime(pathParam(request, "id"));
      options.notifyChanged("journal");
      return envelope(response, 200, { entry: projectGmJournalEntry(entry), calendar: projectGmCalendar(calendar, store.getPublishedDate()) });
    } catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/journal/:id`, requireGm, (request, response) => {
    try { const entry = store.updateEntry(pathParam(request, "id"), JournalWriteSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 200, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/journal/:id/reveal`, requireGm, (request, response) => {
    try { const entry = store.setEntryRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("journal"); return envelope(response, 200, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/journal/:id`, requireGm, (request, response) => {
    store.deleteEntry(pathParam(request, "id"));
    options.notifyChanged("journal");
    return envelope(response, 200, { deleted: true });
  });

  /**
   * M9: SESSIONS - the GM's prep on one side, the players' recap on the other. A new player-reachable
   * read, so nothing about its gating is invented: the reads branch on `roleOf` and project through
   * `codex-projections.ts` exactly as the page reads directly above do, and an unrevealed session 404s a
   * player rather than 403ing, because a status code that distinguishes "secret" from "absent" IS the
   * leak (the `GET /codex/pages/:id` rule).
   *
   * There is deliberately NO `/codex/sessions/:id/entries`. The client already holds the chronicle, whose
   * records carry `sessionNumber`, so "the entries for session 4" is a filter over data the caller has -
   * adding a route would add a second player-reachable surface and a second reveal gate to keep in step
   * with the first. Sessions likewise do NOT join `GET /codex/timeline`: a session has no
   * `calendarInstant`, and `compareChronicle` sorts every undated record below every dated one, so they
   * would clump beneath the very entries they contain.
   */
  router.get(`${CODEX_BASE}/sessions`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the session log.");
    const rows = store.listSessions();
    if (role === "gm") return envelope(response, 200, { sessions: rows.map(projectGmSession), activeSessionId: store.activeSessionId });
    // A player gets `activeSessionId: null`, never the real id: it names a record that may well be
    // unrevealed, and a player has no use for it. The KEY stays present so one response shape serves both
    // roles - a key that appears only for the GM is a tell in itself.
    return envelope(response, 200, { sessions: rows.map(projectPlayerSession).filter((session) => session !== null), activeSessionId: null });
  });

  router.post(`${CODEX_BASE}/sessions`, requireGm, (request, response) => {
    try { const session = store.createSession(SessionCreateSchema.parse(request.body)); options.notifyChanged("sessions"); return envelope(response, 201, { session: projectGmSession(session) }); }
    catch (error) { return codexError(response, error); }
  });

  router.get(`${CODEX_BASE}/sessions/:id`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the session log.");
    const session = store.getSession(pathParam(request, "id"));
    if (!session) return failure(response, 404, "not_found", "That session was not found.");
    if (role === "gm") return envelope(response, 200, { session: projectGmSession(session) });
    const projected = projectPlayerSession(session);
    // The SAME 404 an absent session gets, deliberately - never 403.
    if (!projected) return failure(response, 404, "not_found", "That session was not found.");
    return envelope(response, 200, { session: projected });
  });

  router.patch(`${CODEX_BASE}/sessions/:id`, requireGm, (request, response) => {
    try {
      const { expectedRev, ...fields } = SessionUpdateSchema.parse(request.body);
      const session = store.updateSession(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged("sessions");
      return envelope(response, 200, { session: projectGmSession(session) });
    } catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/sessions/:id`, requireGm, (request, response) => {
    store.deleteSession(pathParam(request, "id"));
    options.notifyChanged("sessions");
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/sessions/:id/reveal`, requireGm, (request, response) => {
    try { const session = store.setSessionRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("sessions"); return envelope(response, 200, { session: projectGmSession(session) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * Point the table at this session. Returns only the pointer, not the record: activating changes nothing
   * ABOUT the session (see `setActiveSession` - no `rev`, no `updated_at`), so echoing the row back would
   * imply an edit that did not happen.
   */
  router.post(`${CODEX_BASE}/sessions/:id/activate`, requireGm, (request, response) => {
    try { const activeSessionId = store.setActiveSession(pathParam(request, "id")); options.notifyChanged("sessions"); return envelope(response, 200, { activeSessionId }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * M10: QUESTS - what is still open. The session routes directly above are the model, verbatim: the reads
   * branch on `roleOf` and project through `codex-projections.ts`, every write is `requireGm`, and an
   * unrevealed quest 404s a player rather than 403ing, because a status code that distinguishes "secret"
   * from "absent" IS the leak (the `GET /codex/pages/:id` rule).
   *
   * The one thing a session route does not have to do: a quest's `entityIds` ARE codex page ids, and a
   * player's copy carries them, so the caller resolves which of those pages are themselves revealed and
   * hands the set to the projection - `revealedPageIdsIn`, the same helper both marker routes use for a
   * pin's `pageIds`. Resolved here rather than inside the projection so there is still exactly one place
   * that decides what a player may see.
   *
   * There is deliberately NO `/codex/quests/:id/objectives`: objectives are a field of the quest, replaced
   * wholesale by PATCH. A sub-resource would be a second write path into one record, with its own `rev`
   * story to get wrong - and reordering, inserting and deleting would each need their own verb.
   */
  router.get(`${CODEX_BASE}/quests`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the quest log.");
    const rows = store.listQuests();
    if (role === "gm") return envelope(response, 200, { quests: rows.map(projectGmQuest) });
    const quests = rows
      .map((row) => projectPlayerQuest(row, { revealedEntityIds: revealedPageIdsIn(store,row.entityIds) }))
      .filter((quest) => quest !== null);
    return envelope(response, 200, { quests });
  });

  router.post(`${CODEX_BASE}/quests`, requireGm, (request, response) => {
    try { const quest = store.createQuest(QuestCreateSchema.parse(request.body)); options.notifyChanged("quests"); return envelope(response, 201, { quest: projectGmQuest(quest) }); }
    catch (error) { return codexError(response, error); }
  });

  router.get(`${CODEX_BASE}/quests/:id`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the quest log.");
    const quest = store.getQuest(pathParam(request, "id"));
    if (!quest) return failure(response, 404, "not_found", "That quest was not found.");
    if (role === "gm") return envelope(response, 200, { quest: projectGmQuest(quest) });
    const projected = projectPlayerQuest(quest, { revealedEntityIds: revealedPageIdsIn(store,quest.entityIds) });
    // The SAME 404 an absent quest gets, deliberately - never 403.
    if (!projected) return failure(response, 404, "not_found", "That quest was not found.");
    return envelope(response, 200, { quest: projected });
  });

  router.patch(`${CODEX_BASE}/quests/:id`, requireGm, (request, response) => {
    try {
      const { expectedRev, ...fields } = QuestUpdateSchema.parse(request.body);
      const quest = store.updateQuest(pathParam(request, "id"), fields, expectedRev);
      options.notifyChanged("quests");
      return envelope(response, 200, { quest: projectGmQuest(quest) });
    } catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/quests/:id`, requireGm, (request, response) => {
    store.deleteQuest(pathParam(request, "id"));
    options.notifyChanged("quests");
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/quests/:id/reveal`, requireGm, (request, response) => {
    try { const quest = store.setQuestRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged("quests"); return envelope(response, 200, { quest: projectGmQuest(quest) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * M12: STANDING (CT-6) - where the party stands with each faction. The quest routes above are the model:
   * the read branches on `roleOf` and projects through `codex-projections.ts`, and every write is `requireGm`.
   *
   * The one thing a quest route does not do: a standing is addressed by its FACTION PAGE id, not by an id of
   * its own. That is not a shortcut - migration v16 makes `faction_page_id` unique, so "the standing with the
   * Harpers" names exactly one row, and a separate id would be a second way to say the same thing (and would
   * make `PUT` need a create-or-update dance the GM would have to think about).
   *
   * A player's read is filtered by `projectPlayerStanding`, which requires BOTH the standing and its faction
   * page to be revealed - see that function for why. The caller resolves the page's state here, in the
   * `revealedPageIdsIn` division of labour: this ANSWERS the question, the projection makes the decision.
   */
  router.get(`${CODEX_BASE}/standing`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the campaign standing.");
    const rows = store.listStanding();
    if (role === "gm") return envelope(response, 200, { standing: rows.map(projectGmStanding) });
    const standing = rows
      .map((row) => projectPlayerStanding(row, { factionRevealed: pageRevealedFor(store, row.factionPageId) }))
      .filter((row) => row !== null);
    return envelope(response, 200, { standing });
  });

  /**
   * Set where the party stands with one faction. The store writes the value AND appends the `standing`
   * chronicle record in ONE transaction, so the table and the history can never disagree - which is also why
   * `reason` belongs on this body rather than on a second call.
   *
   * `notifyChanged("journal")` rather than a scope of its own: this write really does change the journal (it
   * appends a chronicle record), the ping is content-free, and every client listener refetches its whole view
   * regardless of scope. Adding a `"standing"` member would widen `CodexRouterOptions` and break `server.ts`'s
   * annotated handler for no behavioural gain.
   */
  router.put(`${CODEX_BASE}/standing/:factionPageId`, requireGm, (request, response) => {
    try {
      const { value, reason } = StandingSetSchema.parse(request.body);
      const standing = store.setStanding(pathParam(request, "factionPageId"), value, reason);
      options.notifyChanged("journal");
      return envelope(response, 200, { standing: projectGmStanding(standing) });
    } catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/standing/:factionPageId/reveal`, requireGm, (request, response) => {
    try {
      const standing = store.setStandingRevealed(pathParam(request, "factionPageId"), RevealSchema.parse(request.body).revealed);
      options.notifyChanged("journal");
      return envelope(response, 200, { standing: projectGmStanding(standing) });
    } catch (error) { return codexError(response, error); }
  });

  /**
   * CT-9: the REVEAL AUDIT - one GM view of everything the party can currently see, across every reveal
   * surface in the Codex. GM-only: it is a list of what is public, but it also states the SHAPE of what is
   * not (`total` per section), and it exists to be acted on by the one role that can act.
   *
   * **This route loads and resolves; it decides nothing.** Every predicate lives in `projectRevealAudit`,
   * which in turn delegates to the per-kind PLAYER projections - so there is no `revealed` test in this
   * handler, and adding one would be the second source of truth CT-9's risk note forbids. What the handler
   * does own is the CONTEXT each player projection needs, resolved with the same helpers the real player
   * routes use (`revealedPageIdsIn`, `playerSessionNumbers`, the map-reveal lookup) rather than with a
   * cheaper local copy - because the audit's whole value is that it agrees with those routes exactly.
   *
   * Un-revealing happens through the EXISTING per-kind reveal routes, which is why each row carries the id
   * that route takes. There is deliberately no unreveal route and no bulk operation: a bulk "hide everything"
   * is one mis-click that cannot be undone from the same screen.
   *
   * Deliberately NOT covered (U-5): tokens, fog, and the shared table viewer. The table has its own
   * visibility system with different rules, and folding it in would make this the second place that decides
   * what a player can see - exactly what the aggregation rule above exists to prevent.
   */
  router.get(`${CODEX_BASE}/reveal-audit`, requireGm, (_request, response) => {
    const maps = store.listMaps();
    const mapRevealed = new Map(maps.map((map) => [map.id, map.revealedToPlayers]));
    const sessionContext = playerSessionNumbers(store);
    const records: CodexRevealAuditRecord[] = [
      ...store.listPages().map((page) => ({ kind: "page", page } as const)),
      ...maps.map((map) => ({ kind: "map", map, parentRevealed: map.parentMapId ? (mapRevealed.get(map.parentMapId) ?? false) : false } as const)),
      // Every pin on every map, each carrying ITS map's gate - the resolution `GET /codex/maps/:id/markers`
      // performs before it projects a single marker (CD-6). A revealed pin on a secret map is invisible
      // there and must be absent here, or the audit would claim the party can see something it cannot.
      ...maps.flatMap((map) => store.listMarkers(map.id).map((marker) => ({
        kind: "marker", marker, mapRevealed: map.revealedToPlayers,
        revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
        subMapRevealed: marker.subMapId ? (mapRevealed.get(marker.subMapId) ?? false) : false
      } as const))),
      ...store.listTimeline().map((entry) => ({ kind: "journal", entry, sessionContext } as const)),
      ...store.listSessions().map((session) => ({ kind: "session", session } as const)),
      ...store.listQuests().map((quest) => ({ kind: "quest", quest, revealedEntityIds: revealedPageIdsIn(store, quest.entityIds) } as const)),
      ...store.listStanding().map((standing) => ({
        kind: "standing", standing,
        factionRevealed: pageRevealedFor(store, standing.factionPageId),
        factionTitle: store.getPage(standing.factionPageId)?.title ?? null
      } as const))
    ];
    return envelope(response, 200, { audit: projectRevealAudit(records) });
  });

  // ----- Calendar (the world's own months / weekdays / era, and M11's two clocks) -----

  /**
   * ROLE-PROJECTED since M11, and this route is the reason O-1 needed a server-side gate at all: it used to
   * hand `store.getCalendar()` raw to any authenticated session, so the moment the GM advanced the clock
   * while prepping, every player's "Now:" chip moved with it.
   *
   * The two roles now read two different clocks out of one route (D11-G): the GM gets their own
   * `currentDate` plus `publishedDate` so they can see whether the party is behind them, and a player gets
   * `currentDate` sourced ONLY from the published date. Neither branch touches the other's projection.
   */
  router.get(`${CODEX_BASE}/calendar`, (request, response) => {
    const role = roleOf(request);
    if (!role) return failure(response, 401, "unauthenticated", "Join the table to read the calendar.");
    const calendar = store.getCalendar();
    const publishedDate = store.getPublishedDate();
    return envelope(response, 200, { calendar: role === "gm" ? projectGmCalendar(calendar, publishedDate) : projectPlayerCalendar(calendar, publishedDate) });
  });

  /**
   * Replacing the calendar moves the GM's clock and NOTHING else - advancing never publishes (D11-H). It
   * answers with the GM projection, the same shape the GM's GET returns, so the console does not have to
   * hold two spellings of one object.
   */
  router.put(`${CODEX_BASE}/calendar`, requireGm, (request, response) => {
    try { const calendar = store.setCalendar(CalendarSchema.parse(request.body)); options.notifyChanged("journal"); return envelope(response, 200, { calendar: projectGmCalendar(calendar, store.getPublishedDate()) }); }
    catch (error) { return malformed(response, error); }
  });

  /**
   * O-1 / D11-H: the ONE thing that moves the players' clock. It takes no body - "publish" means exactly
   * "the party now sees where I am", and a settable published date would be a second clock to keep in step
   * with the first two.
   *
   * Registered after `GET`/`PUT /codex/calendar`; there is no param route on `/calendar` at all, so the
   * literal `/calendar/publish` segment cannot be mis-matched.
   */
  router.post(`${CODEX_BASE}/calendar/publish`, requireGm, (_request, response) => {
    try {
      const calendar = store.publishCampaignDate();
      options.notifyChanged("journal");
      return envelope(response, 200, { calendar: projectGmCalendar(calendar, store.getPublishedDate()) });
    } catch (error) { return codexError(response, error); }
  });

  // ----- Export (GM backup / round-trip) -----

  router.get(`${CODEX_BASE}/export`, requireGm, (_request, response) => {
    return envelope(response, 200, { codex: store.exportBundle(), exportedAt: new Date().toISOString() });
  });

  // ----- Media (page banners + inline images) -----

  router.post(CODEX_ASSET_BASE, requireGm, express.raw({ type: () => true, limit: "11mb" }), async (request, response) => {
    try {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) return failure(response, 400, "validation_failed", "Upload the image as the request body.");
      const filename = typeof request.query.filename === "string" ? request.query.filename : "image";
      const imported = await options.assets.import(request.body, filename);
      return envelope(response, imported.duplicate ? 200 : 201, { asset: { id: imported.metadata.id, width: imported.metadata.width, height: imported.metadata.height, mediaType: imported.metadata.mediaType } });
    } catch (error) { return failure(response, 400, "validation_failed", error instanceof Error ? error.message : "The image upload failed."); }
  });

  router.get(`${CODEX_ASSET_BASE}/:id/content`, async (request, response) => {
    const id = pathParam(request, "id");
    const token = bearer(request);
    // GM always; a player only when the asset is used by a revealed page (banner or inline image).
    const allowed = options.authorizeGm(token) || (options.authorizePlayer(token) && store.isPageAssetVisibleToPlayers(id));
    if (!allowed) return failure(response, 403, "forbidden", "That image is not available to this session.");
    const metadata = await options.assets.get(id);
    const content = metadata ? await options.assets.readOriginal(id) : null;
    if (!metadata || !content) return failure(response, 404, "not_found", "That image was not found.");
    const etag = `"${id}"`;
    response.setHeader("etag", etag);
    response.setHeader("content-type", metadata.mediaType);
    response.setHeader("cache-control", "private, no-store");
    if (request.header("if-none-match") === etag) return response.status(304).end();
    response.setHeader("content-length", content.length);
    return response.send(content);
  });

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    return failure(response, 500, "internal_error", error instanceof Error ? error.message : "The codex request failed.");
  });
  return router;
}
