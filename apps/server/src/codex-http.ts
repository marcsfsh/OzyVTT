import { createHash, randomUUID } from "node:crypto";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { API_VERSION } from "@vtt/api-contract";
import type { MapAssetStore } from "./map-assets.js";
import { CODEX_BUNDLE_VERSION, CodexNotFoundError, CodexRevisionConflictError, CodexValidationError, downtimePayloadOf, type CodexSearchRef, type CodexStore } from "./codex-store.js";
import { projectGmCalendar, projectGmChronicleRecord, projectGmConnections, projectGmJournalEntry, projectGmMap, projectGmMarker, projectGmPage, projectGmPageConnections, projectGmPageSummary, projectGmQuest, projectGmSearchHit, projectGmSession, projectGmStanding, projectPlayerCalendar, projectPlayerChronicleRecord, projectPlayerConnections, projectPlayerJournalEntry, projectPlayerMap, projectPlayerMarker, projectPlayerPage, projectPlayerPageConnections, projectPlayerPageMarker, projectPlayerPageSummary, projectPlayerQuest, projectPlayerSearchHit, projectPlayerSession, projectPlayerStanding, projectRevealAudit, type CodexRevealAuditRecord, type CodexSearchRecord, type PlayerConnectionContext, type PlayerSessionNumberContext } from "./codex-projections.js";

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
 * D19: the optional idempotency key every codex JSON-body write accepts.
 *
 * It rides on the BODY rather than a header because that is where the game surface puts it, and one
 * convention across two surfaces beats two. It is stripped before the store call (`withoutCommandId`) - the
 * store knows nothing about retries - and `idempotency`, inside `requireWrite`, owns the recall/record cycle.
 *
 * Body-less POSTs and every DELETE are deliberately WITHOUT one: they are naturally idempotent already
 * (applying an applied downtime is refused, activating an active session is a no-op, deleting a deleted
 * record succeeds), so a key would be ceremony that implies a guarantee the verb already gives.
 */
const CommandIdSchema = z.string().uuid().optional();
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
  inWorldDate: InWorldDateSchema.optional(),
  commandId: CommandIdSchema
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
  expectedRev: z.number().int().nonnegative().optional(),
  commandId: CommandIdSchema
}).strict();
/**
 * D8: declaring a connection. `label` is OPTIONAL and nullable - an unlabelled connection is a legitimate
 * "these two are related", which is what a `[[wiki link]]` already expresses; forcing a word would make
 * the declared half of one concept stricter than the derived half. `type` is gone: after v22's relabel
 * the stored value IS the label, so a slug would be a second vocabulary to translate.
 */
const ConnectionCreateSchema = z.object({
  toPageId: z.string().uuid(),
  label: z.string().trim().max(40).nullable().optional(),
  layer: z.enum(["player", "gm"]).optional(),
  commandId: CommandIdSchema
}).strict();
/** Relabel or re-layer a DECLARED connection. An omitted field is left alone, as everywhere else here. */
const ConnectionUpdateSchema = z.object({
  label: z.string().trim().max(40).nullable().optional(),
  layer: z.enum(["player", "gm"]).optional(),
  commandId: CommandIdSchema
}).strict();
const RevealSchema = z.object({ revealed: z.boolean() , commandId: CommandIdSchema }).strict();
const FolderMoveSchema = z.object({ from: z.string().trim().min(1).max(160), to: z.string().trim().max(160) , commandId: CommandIdSchema }).strict();
const FolderPathSchema = z.object({ path: z.string().trim().min(1).max(160) , commandId: CommandIdSchema }).strict();

const MapKindSchema = z.enum(["battlemap", "regional", "world"]);
const MapCreateSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  kind: MapKindSchema,
  parentMapId: z.string().uuid().nullable().optional(),
  revealedToPlayers: z.boolean().optional(),
  tags: TagsSchema.optional(),
  commandId: CommandIdSchema
}).strict();
const MapUpdateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), kind: MapKindSchema.optional(), tags: TagsSchema.optional() , commandId: CommandIdSchema }).strict();
const MapParentSchema = z.object({ parentMapId: z.string().uuid().nullable() , commandId: CommandIdSchema }).strict();

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
  label: z.string().max(120).nullable().optional(), revealedToPlayers: z.boolean().optional(), tags: TagsSchema.optional(), ...MarkerLinks,
  commandId: CommandIdSchema
}).strict();
const MarkerUpdateSchema = z.object({
  x: Coord.optional(), y: Coord.optional(), iconId: IconId.optional(), iconColor: IconColor.optional(),
  label: z.string().max(120).nullable().optional(), revealedToPlayers: z.boolean().optional(), tags: TagsSchema.optional(), ...MarkerLinks,
  commandId: CommandIdSchema
}).strict();
const MarkerMoveSchema = z.object({ x: Coord, y: Coord , commandId: CommandIdSchema }).strict();
/**
 * CT-7: mark this pin as the party, or stop it being the party. One boolean and nothing else - the pin's
 * position, label, links and reveal state are all set through the routes that already own them, because the
 * party marker is an ORDINARY marker with a flag, and moving it IS moving a marker (`POST /markers/{id}/move`).
 */
const MarkerPartySchema = z.object({ isParty: z.boolean() , commandId: CommandIdSchema }).strict();

const JournalWriteSchema = z.object({
  tags: TagsSchema.optional(),
  playerText: z.string().max(20_000).optional(),
  gmText: z.string().max(20_000).nullable().optional(),
  revealedToPlayers: z.boolean().optional(),
  attachMarkerId: z.string().uuid().nullable().optional(),
  attachPageId: z.string().uuid().nullable().optional(),
  /**
   * D9: a journal write names its session by ID, never by number. `sessionNumber` is gone from every write
   * body and `.strict()` 400s it with the key named in `details.issues` - the number is a DISPLAY value the
   * server resolves from the joined record, so a client asserting one would be asserting something it does
   * not own. Omitted on a create auto-files under the active session; explicit `null` files under none; an
   * id that names no session is a 404.
   */
  sessionId: z.string().uuid().nullable().optional(),
  realDate: z.string().max(40).nullable().optional(),
  inWorldLabel: z.string().max(120).nullable().optional(),
  inWorldDate: InWorldDateSchema.optional(),
  commandId: CommandIdSchema
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
  days: z.number().int().min(0).max(3650),
  /**
   * D12: which character PAGE this downtime belongs to, so the tracker totals a person rather than a
   * spelling of their name. Optional and nullable - `who` is the fallback for anyone with no page, and
   * both may coexist. An id that names no page is a 404 from the store; the page's TYPE is not checked
   * (a GM may track downtime for an NPC), which is the deliberate opposite of the standing rule.
   */
  characterPageId: z.string().uuid().nullable().optional()
}).strict();
const DowntimeCreateSchema = JournalWriteSchema.extend({ downtime: DowntimeInputSchema });
/**
 * D12: the journal UPDATE body, which is the create body plus one narrow payload group.
 *
 * The group carries exactly three keys. `days` is absent DELIBERATELY, not by oversight: it is what
 * `applyDowntime` moved the campaign clock by, so editing it afterwards would leave the clock disagreeing
 * with the record that justified it - `.strict()` therefore 400s a stray `days`, which is the honest
 * answer rather than a silent drop. `applied` is absent for the same reason it is absent from create.
 */
const JournalUpdateSchema = JournalWriteSchema.extend({
  downtime: z.object({
    who: z.string().trim().max(120).optional(),
    activity: z.string().trim().max(120).optional(),
    characterPageId: z.string().uuid().nullable().optional()
  }).strict().optional()
});
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
/** D31: scene attachments. 20 is the table's own scene cap - a session cannot stage more scenes than exist. */
const SessionSceneIdsSchema = z.array(z.string().uuid()).max(20);
const SessionCreateSchema = z.object({
  sessionNumber: SessionNumberSchema.optional(),
  realDate: z.string().max(40).nullable().optional(),
  attendees: AttendeesSchema.optional(),
  prepBody: z.string().max(100_000).optional(),
  recapBody: z.string().max(100_000).optional(),
  revealedToPlayers: z.boolean().optional(),
  status: SessionStatusSchema.optional(),
  /** D10: the codex-wide tag vocabulary, `TagsSchema` verbatim - one bound for every taggable record. */
  tags: TagsSchema.optional(),
  /** D31: scenes staged for this session. Capped at the TABLE's scene cap, which the store re-applies. */
  sceneIds: SessionSceneIdsSchema.optional(),
  commandId: CommandIdSchema
}).strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a recap as a side effect of an edit. */
const SessionUpdateSchema = z.object({
  sessionNumber: SessionNumberSchema.optional(),
  realDate: z.string().max(40).nullable().optional(),
  attendees: AttendeesSchema.optional(),
  prepBody: z.string().max(100_000).optional(),
  recapBody: z.string().max(100_000).optional(),
  status: SessionStatusSchema.optional(),
  tags: TagsSchema.optional(),
  sceneIds: SessionSceneIdsSchema.optional(),
  expectedRev: z.number().int().nonnegative().optional(),
  commandId: CommandIdSchema
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
  revealedToPlayers: z.boolean().optional(),
  /** D10: the codex-wide tag vocabulary, `TagsSchema` verbatim - one bound for every taggable record. */
  tags: TagsSchema.optional(),
  commandId: CommandIdSchema
}).strict();
/** No `revealedToPlayers`: reveal is its own route, so a PATCH cannot publish a quest as a side effect of an edit. */
const QuestUpdateSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  status: QuestStatusSchema.optional(),
  playerBody: z.string().max(100_000).optional(),
  gmBody: z.string().max(100_000).optional(),
  objectives: ObjectivesSchema.optional(),
  entityIds: QuestEntityIdsSchema.optional(),
  tags: TagsSchema.optional(),
  expectedRev: z.number().int().nonnegative().optional(),
  commandId: CommandIdSchema
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
  reason: z.string().trim().max(120).default(""),
  commandId: CommandIdSchema
}).strict();
/**
 * OWNER DECISION (2026-07-30): the codex-wide settings body. Nested under `revisionHistory` deliberately -
 * `codex_meta` is the codex's settings row, and a nested object gives a later codex-wide setting a home
 * without inventing fields for it today.
 *
 * `windowMinutes` is `z.number()` and NOT `.int()`, which is the one deliberate looseness here. The bounds are
 * REJECTED (0..10080, this file's usual router-rejects / store-enforces arrangement - see `StandingSetSchema`),
 * because a control that produced 99999 would be a malformed caller and deserves to hear so. A FRACTIONAL
 * value inside the range is a different thing: it is a slider artefact, not a mistake about what was meant, so
 * the store TRUNCATES it (`revisionWindowMinutes`) and the response carries the stored value back. Rejecting
 * 45.5 would make a legitimate drag fail for no reader-visible reason.
 */
const CodexSettingsSchema = z.object({
  revisionHistory: z.object({
    enabled: z.boolean(),
    windowMinutes: z.number().min(0).max(10_080)
  }).strict(),
  /**
   * D6 / director ruling R4: autosave, in SECONDS - the wire unit, the column's unit and this schema's unit
   * are one, so nothing converts at a boundary. 1..600, and the looseness is `windowMinutes`' exactly: the
   * BOUNDS are rejected (a control that produced 0 or 9999 would be a malformed caller and deserves to hear
   * so), a FRACTIONAL value inside the range is a picker artefact and is truncated by the store.
   *
   * REQUIRED, like `revisionHistory`: this is a wholesale PUT that answers with the full read shape, so an
   * omitted group would silently reset a setting the caller never mentioned.
   */
  autosave: z.object({
    enabled: z.boolean(),
    intervalSeconds: z.number().min(1).max(600)
  }).strict(),
  commandId: CommandIdSchema
}).strict();
/**
 * The delete (owner decision, 2026-07-30). `olderThanDays: 0` deletes EVERY revision, and it is arithmetic
 * rather than a magic value - nothing is younger than zero days old - so `min(0)` admits it without a branch.
 *
 * `.int()` and `.nonnegative()` REJECT rather than clamp, the deliberate opposite of `windowMinutes` directly
 * above: this is the one destructive route in the Codex, and a malformed request must not be interpreted
 * generously. "3.5 days" or "-1" is a caller that does not know what it is asking, and the honest answer is a
 * 400. The store rejects the same values behind this, and also caps the age (`MAX_PRUNE_DAYS`) - which this
 * mirrors, because a cutoff date past the representable range would otherwise 500 rather than 400.
 */
const RevisionsDeleteSchema = z.object({ olderThanDays: z.number().int().min(0).max(36_500) }).strict();
/**
 * D16 / director ruling R1: the restore body IS a saved export's `data`, posted back unedited.
 *
 * `bundleVersion` is OPTIONAL, and that is the whole point of the feature: every backup a GM already has
 * was taken before this key existed, and refusing those would make "true backup and restore" a promise
 * only kept for files created after the upgrade. Absent means a pre-versioning v1 bundle. Anything other
 * than 1 is refused - a bundle from a NEWER build may carry shapes this one cannot honour, and silently
 * dropping them is the failure mode a restore must not have.
 *
 * `exportedAt` is accepted and ignored, so nothing has to be stripped from the file before POSTing it.
 */
const CodexImportSchema = z.object({
  codex: z.record(z.string(), z.unknown()),
  bundleVersion: z.number().int().refine((value) => value === CODEX_BUNDLE_VERSION, { message: "This backup was made by a newer version of the app. Update, then restore." }).optional(),
  exportedAt: z.string().optional(),
  commandId: CommandIdSchema
}).strict();
const CalendarSchema = z.object({
  yearName: z.string().max(20),
  months: z.array(z.object({ name: z.string().trim().min(1).max(40), days: z.number().int().min(1).max(400) })).min(1).max(24),
  weekdays: z.array(z.string().trim().min(1).max(40)).max(20),
  currentDate: z.object({ year: z.number().int().min(-100_000).max(100_000), month: z.number().int().min(0).max(23), day: z.number().int().min(1).max(400) }).nullable().optional(),
  commandId: CommandIdSchema
}).strict();

/**
 * What a caller turned out to be. `gm` and `integration` are the same GRADE - an integration credential
 * is the GM's own trusted automation and receives GM projections - but they stay distinct here because
 * the two denial messages differ, and because conflating them at the resolver is how a future rule that
 * should apply to only one of them ends up applying to both.
 *
 * `none` and `denied` are the 401/403 split, and the boundary is exact: `none` is "there was no
 * `Authorization: Bearer <token>` to read". Everything a caller actually presented and that failed -
 * an expired session, a revoked credential, a token scoped for something else, a player token on a GM
 * surface - is `denied`, because the caller IS authenticated in the sense 401 asks about and telling
 * them to authenticate again is advice that cannot work.
 */
type CodexPrincipal = Readonly<{ kind: "gm" | "player" | "integration" | "none" | "denied" }>;
type CodexGrade = "gm" | "player";

type CodexRouterOptions = Readonly<{
  store: CodexStore;
  /** Content-addressed store for page media (banners + inline images), separate from map/token assets. */
  assets: MapAssetStore;
  authorizeGm: (token: string | undefined) => boolean;
  authorizePlayer: (token: string | undefined) => boolean;
  /**
   * A GM-minted integration credential, checked against the scope THIS route needs. Returns null for a
   * token that is unparseable, unknown, revoked, expired, or missing the scope - the store does not
   * distinguish those to the caller, and neither does this router (all four are one 403).
   *
   * Required rather than optional on purpose: a mount site that forgot it would silently run a codex
   * with no credential access at all, and "the integrations panel mints a codex token that does
   * nothing" is a bug that reads as a product decision.
   */
  verifyIntegration: (token: string, scope: "codex:read" | "codex:write") => Readonly<{ id: string; name: string }> | null;
  /**
   * Emit a content-free `codex:changed` ping so every client refetches its projected view.
   *
   * D22: it takes NO argument. It used to take a `scope` word that was broadcast to every socket, players
   * included - telling the table which part of the codex the GM is working in. No listener read it, the
   * homebrew notifier already refused the same thing on principle, and the honest ping is a revision.
   */
  notifyChanged: () => void;
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
/**
 * Strip the idempotency key before a parsed body reaches the store. The store knows nothing about
 * retries, and a key that leaked into an input object would be a `.strict()` failure one layer down or,
 * worse, a field silently persisted on a record.
 */
function withoutCommandId<T extends { commandId?: string }>(input: T): Omit<T, "commandId"> {
  const { commandId, ...rest } = input;
  void commandId;
  return rest;
}
/**
 * Which RESOURCE a read is of, as a short stable fingerprint for the `ETag`.
 *
 * The path plus the query, with the query SORTED so `?tag=x&folder=y` and `?folder=y&tag=x` are one
 * resource rather than two - a client that reorders its parameters must not silently lose its cache. Hashed
 * rather than embedded so the tag stays a fixed length whatever the query is; it is an opaque validator, so
 * nothing reads it back, and truncating to 12 hex characters is ample for telling apart the ~40 codex reads
 * (a collision would only ever mean an unnecessary 200, never a wrong 304 - the revision and grade are
 * still there in full).
 */
function resourceKey(request: Request): string {
  const [path, rawQuery = ""] = request.originalUrl.split("?");
  const query = [...new URLSearchParams(rawQuery)].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : 1))).map(([key, value]) => `${key}=${value}`).join("&");
  return createHash("sha1").update(`${path}?${query}`).digest("hex").slice(0, 12);
}
function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  return typeof value === "string" ? value : "";
}
function envelope(response: Response, status: number, data: unknown) {
  return response.status(status).json({ ok: true, apiVersion: API_VERSION, data });
}
/**
 * The one error envelope. `details` and `currentRevision` are optional and omitted when absent rather
 * than sent as null, because `ApiErrorEnvelopeSchema` declares them optional and a present-but-null key
 * would fail it.
 *
 * The request id comes from `res.locals`, which the middleware set from the caller's own `X-Request-Id`
 * when they sent a usable one. It used to be re-read off the response HEADER, which worked only because
 * the middleware had just written a fresh uuid there - so a caller who supplied an id got a different one
 * back in the error body than the one they were correlating on.
 */
function failure(response: Response, status: number, code: string, message: string, details?: Record<string, unknown>, currentRevision?: number) {
  const id = typeof response.locals.requestId === "string" ? response.locals.requestId : (response.getHeader("x-request-id")?.toString() ?? randomUUID());
  return response.status(status).json({
    ok: false,
    apiVersion: API_VERSION,
    error: { code, message, requestId: id, ...(details ? { details } : {}), ...(currentRevision !== undefined ? { currentRevision } : {}) }
  });
}
/**
 * A malformed body. `message` stays the FIRST issue, because it is the human-readable line a GM sees;
 * `details.issues` carries every issue with its machine-addressable `path`, which is what an integration
 * needs and what the published conventions have always promised. Reporting only the first issue meant a
 * caller with three bad fields learned about them one round-trip at a time.
 *
 * **What may be forwarded is an ALLOW-LIST**, and that is the whole point of the last arm. Two error kinds
 * are the caller's own mistake and carry copy written for them: a `ZodError` from a request schema, and a
 * `CodexValidationError` from one of the store's validators. ANYTHING ELSE is not a 400 at all - it is this
 * process failing - so it takes the same sanitized 500 the router's catch-all produces, with the real error
 * on the server log.
 *
 * It used to forward `(error as Error).message` for every non-Zod error, which defeated the sanitization
 * this file documents for itself two hundred lines down: an import with a duplicate page id answered
 * `400 validation_failed` / "UNIQUE constraint failed: codex_pages.id" - internal table and column names to
 * whoever asked - and a genuine internal failure was reported to the caller as their own bad request.
 */
function malformed(response: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    return failure(response, 400, "validation_failed", error.issues[0]?.message ?? "The request is malformed.", {
      issues: error.issues.map((issue) => ({ path: [...issue.path], message: issue.message }))
    });
  }
  if (error instanceof CodexValidationError) return failure(response, 400, "validation_failed", error.message);
  console.error("codex request failed:", error);
  return failure(response, 500, "internal_error", "The codex request failed.");
}
/**
 * Map a store/validation error to its HTTP envelope: 404 not-found, 409 conflict, else 400 malformed.
 *
 * `currentRevision` is a THUNK, evaluated only on a conflict, and supplied only by the three routes whose
 * 409 can be a stale `expectedRev` (page, session and quest PATCH). That is the rule the conventions
 * state: `error.currentRevision` is present exactly when the 409 is a lost race, so a client can decide
 * whether to rebase. A state-machine refusal - applying an already-applied downtime - deliberately
 * carries none, because there is no revision to rebase onto.
 */
function codexError(response: Response, error: unknown, currentRevision?: () => number | undefined) {
  if (error instanceof CodexRevisionConflictError) return failure(response, 409, "conflict", error.message, undefined, currentRevision?.());
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
    // Nor does a session: its own reveal flag is the whole player predicate, exactly as a quest's is.
    case "session": { const session = store.getSession(ref.id); return session ? { kind: "session", session } : null; }
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
  // The candidate set is every page id a player-visible PAYLOAD can name: the factions standing is
  // tracked against, plus (D12) the character pages downtime records link to. Both are small and precise
  // rather than "every revealed page", and a payload id with no candidate has no entry in the set at all,
  // which is the right answer - it fails closed to null.
  // Both candidate reads are TARGETED - one row per faction, one distinct id per downtime character. The
  // downtime half used to be `listTimeline()` filtered in JS, which pulled every journal row through the
  // session join and JSON-parsed two columns per row to reach one id, on every player journal read and
  // (unconditionally, for both roles) on every keystroke of the search palette. Same answer, one indexed
  // scan of one column.
  const downtimePages = store.downtimeCharacterPageIds();
  return {
    unrevealedSessionIds: store.unrevealedSessionIds(),
    // D11: the candidate set is EVERY quest, because any of them may appear in history. Small table, and
    // a quest with no entry in the set fails closed - its history stays hidden.
    revealedQuestIds: new Set(store.listQuests().filter((quest) => quest.revealedToPlayers).map((quest) => quest.id)),
    revealedPageIds: revealedPageIdsIn(store, [...store.listStanding().map((row) => row.factionPageId), ...downtimePages])
  };
}

/**
 * D8: the context `projectPlayerConnections` needs, resolved once per request. Sibling of
 * `revealedPageIdsIn` and `playerSessionNumbers`, with the same division of labour - it ANSWERS which
 * records a player may see; the projection decides whether that lets an edge travel.
 *
 * `revealedSourceIds` covers the three NON-page source kinds D13 added, and each is resolved by running the
 * record through ITS OWN PLAYER PROJECTION rather than by reading a flag - so a connection can never be a
 * way around the gate the record's own list endpoint applies.
 *
 * The journal arm is why that distinction is spelled out rather than assumed. It used to read
 * `entry.revealedToPlayers`, which is weaker than `projectPlayerJournalEntry` for two kinds: a `standing`
 * record is additionally gated on its faction page and a `quest` history row on its quest. A GM who set
 * standing on a hidden faction, typed `[[Vallaki]]` into the record's player text and revealed the row
 * published that row's existence and its text on Vallaki's Connections panel and in the graph feed - while
 * `/codex/journal`, `/codex/timeline`, `/codex/search` and the reveal audit all correctly hid it. The audit,
 * the one screen whose job is answering "what can the party see?", disagreed with what the party could see.
 *
 * Sessions and quests keep their flag test because for those two kinds the flag IS the whole projection
 * (`projectPlayerSession` / `projectPlayerQuest` gate on nothing else); writing them as flag tests beside a
 * projection call would imply a difference that does not exist. If either ever grows a second condition,
 * it grows it in its projection and this must follow - which is what the journal arm is here to remember.
 */
function playerConnectionContext(store: CodexStore): PlayerConnectionContext {
  const revealedPageIds = new Set(store.listPages().filter((page) => page.revealedToPlayers).map((page) => page.id));
  const revealedSourceIds = new Set<string>();
  for (const session of store.listSessions()) if (session.revealedToPlayers) revealedSourceIds.add(session.id);
  for (const quest of store.listQuests()) if (quest.revealedToPlayers) revealedSourceIds.add(quest.id);
  const journalContext = playerSessionNumbers(store);
  for (const entry of store.listTimeline()) if (projectPlayerJournalEntry(entry, journalContext) !== null) revealedSourceIds.add(entry.id);
  return { revealedPageIds, revealedSourceIds };
}

const NO_TOKEN = "A GM session, player session, or integration bearer token is required.";
const BAD_TOKEN = "The token is invalid, revoked, or missing the required scope.";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Just the three authorization callbacks, so the import guard below can be built from the SAME ones the router gets. */
export type CodexAuthOptions = Pick<CodexRouterOptions, "authorizeGm" | "authorizePlayer" | "verifyIntegration">;

/**
 * Honour the caller's own correlation id when it is a UUID v4, mint one otherwise - the exact
 * arrangement `game-http.ts` uses, so one integration correlating across both surfaces sees one id.
 * A non-UUID value is REPLACED rather than echoed: this id lands in logs and in error bodies, and
 * echoing arbitrary caller text into both is how a log line becomes a forgery.
 *
 * Idempotent, because the import guard runs it too: an id already resolved for this response is kept, so a
 * request that meets it twice correlates on one id rather than two.
 */
function codexRequestConventions(request: Request, response: Response, next: NextFunction) {
  if (typeof response.locals.requestId !== "string") {
    const supplied = request.header("x-request-id");
    response.locals.requestId = supplied && UUID_V4.test(supplied) ? supplied : randomUUID();
  }
  response.setHeader("x-request-id", response.locals.requestId as string);
  response.setHeader("cache-control", "no-store");
  next();
}

/**
 * Who is calling, and are they allowed to want `scope`? Role derives from the signed session token or
 * the verified credential and from nothing else - never from a body, a query, or network position.
 *
 * Order matters and is deliberate: GM session, then player session, then credential. The preview flow
 * depends on it in reverse - `POST /codex/preview-session` mints a real PLAYER token precisely so the
 * GM's preview walks the player branch, and it would silently return GM projections if a GM token
 * could be reused for it.
 *
 * MEMOIZED on `response.locals` for the life of the request, keyed by scope. Not an optimization: a request
 * that meets the import guard and then the router would otherwise be resolved twice, and
 * `IntegrationCredentialStore.verify` is not a pure function - it writes a `used` audit row and, on a
 * refusal, a `failed` one. Resolving twice would double-count a credential's failures.
 */
function principalFor(request: Request, response: Response, options: CodexAuthOptions, scope: "codex:read" | "codex:write"): CodexPrincipal {
  const cached = response.locals.codexPrincipal as Readonly<{ scope: string; principal: CodexPrincipal }> | undefined;
  if (cached && cached.scope === scope) return cached.principal;
  const token = bearer(request);
  const principal: CodexPrincipal = token === undefined ? { kind: "none" }
    : options.authorizeGm(token) ? { kind: "gm" }
      : options.authorizePlayer(token) ? { kind: "player" }
        : options.verifyIntegration(token, scope) ? { kind: "integration" }
          : { kind: "denied" };
  response.locals.codexPrincipal = { scope, principal };
  return principal;
}

/** The one refusal a codex WRITE can get, spelled once so the router and the import guard cannot drift. */
function refuseWrite(response: Response, principal: CodexPrincipal) {
  if (principal.kind === "none") return failure(response, 401, "unauthenticated", NO_TOKEN);
  if (principal.kind === "player") return failure(response, 403, "forbidden", "Codex writes are the GM's.");
  return failure(response, 403, "forbidden", BAD_TOKEN);
}

/**
 * Authorization for `POST /codex/import`, mounted in `server.ts` AHEAD of that route's 64 MB body parser.
 *
 * The parser has to be app-level and has to run before the global 512 KB one (body-parser marks a request
 * parsed and every later parser skips it), which put it before every router - so the whole body was
 * buffered, utf-8 decoded and `JSON.parse`d before the codex router's per-route `requireWrite` could write
 * a 401. Any client on the LAN with no `Authorization` header at all - or a hostile page, since `/api/v1`
 * has wildcard CORS and `authorization` in its allowed headers - could make the process block on a 64 MB
 * parse, repeatedly, on the same event loop that owns GameState: Socket.IO, turn order and every combat
 * command stall for the duration.
 *
 * It is the SAME policy, not a copy: the same `principalFor`, the same `refuseWrite`, and the resolved
 * principal is memoized on `response.locals`, so the router's `requireWrite` reuses this answer rather than
 * re-verifying the credential. An authorized caller simply falls through to the parser.
 */
export function createCodexImportGuard(options: CodexAuthOptions) {
  return [codexRequestConventions, (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:write");
    if (principal.kind === "gm" || principal.kind === "integration") return next();
    return refuseWrite(response, principal);
  }];
}

export function createCodexRouter(options: CodexRouterOptions) {
  const router = Router();
  const { store } = options;

  router.use(codexRequestConventions);

  /**
   * The grade a ROLE-PROJECTED read should be projected at, or null when the caller was answered with a
   * 401/403 and the handler must simply return. An integration credential reads at GM grade.
   */
  const readGrade = (request: Request, response: Response): CodexGrade | null => {
    const principal = principalFor(request, response, options, "codex:read");
    if (principal.kind === "gm" || principal.kind === "integration") return "gm";
    if (principal.kind === "player") return "player";
    if (principal.kind === "none") { failure(response, 401, "unauthenticated", NO_TOKEN); return null; }
    failure(response, 403, "forbidden", BAD_TOKEN);
    return null;
  };

  /** GM-GRADE reads: folders, revision history, settings, the reveal audit, export. No player branch. */
  const requireGmRead = (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:read");
    if (principal.kind === "gm" || principal.kind === "integration") return next();
    if (principal.kind === "none") return failure(response, 401, "unauthenticated", NO_TOKEN);
    if (principal.kind === "player") return failure(response, 403, "forbidden", "The codex's GM surfaces are the GM's.");
    return failure(response, 403, "forbidden", BAD_TOKEN);
  };

  /**
   * D19: `commandId` idempotency, as ONE interception point rather than a line in twenty-five handlers.
   *
   * A codex JSON-body write may carry `commandId`. Resend the same id and the stored outcome is replayed
   * verbatim - the same status and the same bytes - with `x-idempotent-replay: true` so a caller can tell
   * a replay from a fresh execution.
   *
   * **It is called from inside `requireWrite`, AFTER authorization, and that placement is load-bearing.**
   * As a plain `router.use` it ran before the route's own guard, which made a receipt into a bearer
   * token: a PLAYER who knew (or guessed) a GM's `commandId` got the GM's 201 back. Caught by the test
   * that asserts a player replaying a GM's key still gets 403. A replay is a cache of a response, and a
   * cache must never be reachable by a caller who could not have produced the response.
   *
   * **The receipt is written AFTER the response is produced**, which means after the store transaction
   * has committed, and the crash window that leaves is stated honestly rather than hidden: a process that
   * dies between the commit and the receipt re-executes ONE identical retry. That is strictly better than
   * the alternative - a receipt written first can record an outcome that never committed, and a replay
   * would then report success for a write that did not happen. Re-executing once is recoverable; lying
   * is not.
   *
   * **Only a 2xx is recorded.** A failed write stored nothing, so a retry after an error must re-execute -
   * the correct reading of "retry safely". It is also why a body that never succeeded still 400s on
   * retry: there is no receipt to replay, so it reaches the handler and is validated as the first was.
   *
   * **A receipt remembers WHAT IT WAS FOR, and a mismatched reuse is refused rather than replayed.** The
   * key alone used to be the whole lookup, so a caller that reused one id across two DIFFERENT writes got
   * the first response back verbatim and the second write silently never ran - answered 2xx, as though it
   * had. That is the exact failure idempotency exists to prevent, arriving through the mechanism meant to
   * prevent it. The fingerprint is the method and the path, which is the finest grain that is stable across
   * a genuine retry: the same request retried carries the same body too, but a client that retries after
   * fixing a typo is retrying, and refusing that would make the key useless.
   *
   * A receipt with a NULL fingerprint predates the column and is still replayed - it is a real outcome of
   * some earlier request, and refusing retries in flight across an upgrade would be the worse trade.
   *
   * Returns true when it has ALREADY answered the request.
   */
  const idempotency = (request: Request, response: Response): boolean => {
    const supplied = (request.body as { commandId?: unknown } | undefined)?.commandId;
    if (typeof supplied !== "string" || request.method === "DELETE") return false;
    const fingerprint = `${request.method} ${request.baseUrl}${request.path}`;
    const replay = store.recallCommand(supplied);
    if (replay) {
      if (replay.fingerprint !== null && replay.fingerprint !== fingerprint) {
        failure(response, 400, "validation_failed", "That commandId was already used for a different request. An idempotency key identifies one request, so retries must resend the same one and a new request needs a new key.");
        return true;
      }
      response.setHeader("x-idempotent-replay", "true");
      response.status(replay.status).json(replay.body);
      return true;
    }
    const send = response.json.bind(response);
    response.json = (payload: unknown) => {
      if (response.statusCode >= 200 && response.statusCode < 300) store.recordCommand(supplied, response.statusCode, payload, fingerprint);
      return send(payload);
    };
    return false;
  };

  /** Every write. A player session gets 403, not 401: they are authenticated, and they are refused. */
  const requireWrite = (request: Request, response: Response, next: NextFunction) => {
    const principal = principalFor(request, response, options, "codex:write");
    // The idempotency check runs HERE, inside the guard, so it is provably after authorization - see
    // `idempotency` above for the bug that placement fixes.
    if (principal.kind === "gm" || principal.kind === "integration") return idempotency(request, response) ? undefined : next();
    return refuseWrite(response, principal);
  };

  /**
   * The ONE route a credential may not reach: minting a player session token. A `codex:write` credential
   * is authorization to change the world, not authorization to hand out ambient player sessions, and no
   * consumer needs it - the route exists so the GM's own UI can preview the player Codex.
   */
  const requireGmSession = (request: Request, response: Response, next: NextFunction) => {
    const token = bearer(request);
    if (token === undefined) return failure(response, 401, "unauthenticated", "A valid GM session is required.");
    if (!options.authorizeGm(token)) return failure(response, 403, "forbidden", "Only a GM session may mint a player preview.");
    next();
  };

  /**
   * Send a codex read, with a weak `ETag` and a `304` when the caller already holds this exact answer.
   *
   * The tag names three things, and all three are load-bearing:
   *
   *   `r{revision}` - the coarse codex revision. Correctness rests on one store guarantee: EVERY codex
   *      write bumps it inside its own transaction, reveals and clock moves included, since those change
   *      what a reader sees even though they change no record's `rev`. A write that skipped the bump would
   *      make this serve stale reads, which is why `codex-conventions.test.ts` walks every mutating store
   *      method and fails if one leaves `store.revision` where it found it.
   *   `{grade}` - because a GM and a player at the same revision get different bodies, and one shared tag
   *      would let a proxy hand a GM's answer to a player.
   *   `{resource}` - WHICH read this is. Without it the validator was global, so a tag obtained from one
   *      endpoint revalidated a DIFFERENT endpoint to 304 with an empty body: an integration keeping one
   *      "last seen codex ETag" (the contract advertises ETag/304 to credential holders) would conclude
   *      nothing had changed on a resource it had never read. An `ETag` is a validator for one resource;
   *      one that is not scoped to a resource is not an ETag.
   *
   * Weak, because the bytes may differ between two responses at one revision (timestamps in derived labels).
   *
   * Called at the point of SERIALIZATION, after every authorization and existence gate, so a conditional
   * request can never turn a 404 into a 304 and confirm that a hidden record exists and is unchanged.
   */
  const readEnvelope = (request: Request, response: Response, grade: CodexGrade, data: unknown) => {
    const etag = `W/"codex-r${store.revision}-${grade}-${resourceKey(request)}"`;
    response.setHeader("etag", etag);
    if (request.header("if-none-match") === etag) return response.status(304).end();
    return envelope(response, 200, data);
  };

  // ----- Pages: list + search (GM or player; player sees only revealed) -----

  router.get(`${CODEX_BASE}/pages`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const filter = {
      folder: request.query.folder === undefined ? undefined : (request.query.folder === "" ? null : String(request.query.folder)),
      tag: request.query.tag === undefined ? undefined : String(request.query.tag)
    };
    const rows = store.listPages(filter);
    const pages = role === "gm" ? rows.map(projectGmPageSummary) : rows.map(projectPlayerPageSummary).filter((page) => page !== null);
    return readEnvelope(request, response, role, { pages });
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
    const role = readGrade(request, response);

    if (!role) return;
    const query = typeof request.query.q === "string" ? request.query.q : "";
    // Resolved before the map so it is computed once per request, not once per hit. Built for both
    // roles rather than conditionally: every read behind it is a targeted one over a small table, and a
    // `null` here would only push the branch into the projection call below, where forgetting it is a leak
    // rather than a type error. (It briefly was NOT cheap - a full `listTimeline()` per request, paid by a
    // GM search that never uses the result - which is why the cost is now named rather than asserted.)
    const playerContext = playerSessionNumbers(store);
    const found = store.searchAll(role, query);
    const hits = found.hits
      .map((ref) => loadSearchRecord(store, ref))
      .filter((record) => record !== null)
      .map((record) => (role === "gm" ? projectGmSearchHit(record) : projectPlayerSearchHit(record, playerContext)))
      .filter((hit) => hit !== null);
    // D19: the cap is SIGNALLED, not hidden. `truncated` comes from the store's own 51st-row probe, before
    // the projections above drop anything a player may not see - so it answers "was the SEARCH cut off",
    // which is the question a reader typing a narrower query is asking. A player whose 50 rows shrink to 12
    // after gating still sees "narrow your search", which is honest: there really was more to find.
    return readEnvelope(request, response, role, { hits, truncated: found.truncated });
  });

  router.get(`${CODEX_BASE}/pages/:id`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    // D8: ONE `connections` list where `backlinks` and `relationships` used to be two. They answered the
    // same question about the same edges in two shapes, which is precisely what made "relationships" and
    // "mentions" read to a GM as two features with two panels.
    if (role === "gm") return readEnvelope(request, response, role, { page: projectGmPage(page), connections: projectGmPageConnections(store.connectionsForPage(page.id)) });
    const projected = projectPlayerPage(page);
    if (!projected) return failure(response, 404, "not_found", "That page was not found.");
    // The SAME context the graph feed resolves, and for the same reason: the panel and the graph are two
    // renderings of one edge list, so they must be gated by one predicate. Passing it in (rather than
    // letting the projection read the store's `otherRevealed`) is what makes that literally true.
    return readEnvelope(request, response, role, { page: projected, connections: projectPlayerPageConnections(store.connectionsForPage(page.id), playerConnectionContext(store)) });
  });

  // ----- Pages: authoring (GM only) -----

  router.post(`${CODEX_BASE}/pages`, requireWrite, (request, response) => {
    try {
      const input = PageCreateSchema.parse(request.body);
      const page = store.createPage(withoutCommandId(input));
      options.notifyChanged();
      return envelope(response, 201, { page: projectGmPage(page) });
    } catch (error) { return malformed(response, error); }
  });

  router.patch(`${CODEX_BASE}/pages/:id`, requireWrite, (request, response) => {
    try {
      const { expectedRev, commandId, ...fields } = PageUpdateSchema.parse(request.body); void commandId;
      const page = store.updatePage(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged();
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      // The row is re-read only on a conflict, so the 409 can name the revision the caller lost the
      // race to. Reading it here rather than carrying it on the error keeps the store's error class a
      // plain marker; `store.getPage` is one indexed lookup on a path that is already failing.
      return codexError(response, error, () => store.getPage(pathParam(request, "id"))?.rev);
    }
  });

  router.post(`${CODEX_BASE}/pages/:id/reveal`, requireWrite, (request, response) => {
    try {
      const { revealed } = RevealSchema.parse(request.body);
      const page = store.setPageRevealed(pathParam(request, "id"), revealed);
      options.notifyChanged();
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  router.delete(`${CODEX_BASE}/pages/:id`, requireWrite, (request, response) => {
    store.deletePage(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/folders/move`, requireWrite, (request, response) => {
    try {
      const { from, to } = FolderMoveSchema.parse(request.body);
      const moved = store.moveFolder(from, to);
      options.notifyChanged();
      return envelope(response, 200, { moved });
    } catch (error) { return malformed(response, error); }
  });

  // Folder records make empty folders persist (a folder is otherwise only implied by the pages inside it). GM-only.
  router.get(`${CODEX_BASE}/folders`, requireGmRead, (request, response) => readEnvelope(request, response, "gm", { folders: store.listFolders() }));
  // ----- GM preview: mint a real, short-lived player principal (never a role flag on the GM token) -----
  router.post(`${CODEX_BASE}/preview-session`, requireGmSession, (_request, response) => {
    try { return envelope(response, 201, { token: options.issuePreviewSession() }); }
    catch (error) { return malformed(response, error); }
  });

  router.post(`${CODEX_BASE}/folders`, requireWrite, (request, response) => {
    try { const path = store.createFolder(FolderPathSchema.parse(request.body).path); options.notifyChanged(); return envelope(response, 201, { path }); }
    catch (error) { return malformed(response, error); }
  });
  router.post(`${CODEX_BASE}/folders/delete`, requireWrite, (request, response) => {
    try { store.deleteFolder(FolderPathSchema.parse(request.body).path); options.notifyChanged(); return envelope(response, 200, { deleted: true }); }
    catch (error) { return malformed(response, error); }
  });

  router.get(`${CODEX_BASE}/pages/:id/revisions`, requireGmRead, (request, response) => {
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    return readEnvelope(request, response, "gm", { revisions: store.listRevisions(page.id) });
  });

  router.post(`${CODEX_BASE}/pages/:id/revisions/:revisionId/restore`, requireWrite, (request, response) => {
    try {
      const revisionId = Number(request.params.revisionId);
      if (!Number.isInteger(revisionId)) return failure(response, 400, "validation_failed", "The revision id is malformed.");
      const page = store.restoreRevision(pathParam(request, "id"), revisionId, "gm");
      options.notifyChanged();
      return envelope(response, 200, { page: projectGmPage(page) });
    } catch (error) {
      if (error instanceof CodexNotFoundError) return failure(response, 404, "not_found", error.message);
      return malformed(response, error);
    }
  });

  // ----- Connections (D8: one edge concept, one panel, one graph) -----

  /**
   * Declare a connection FROM this page TO another. 201, and idempotent on `(from, to, label)` - so a
   * double-click on "Add" cannot make two edges.
   *
   * It counts as an edit of BOTH pages for "recently updated", because the Connections panel is part of
   * the page - but neither page's `rev` moves, so an open editor is not forced into a conflict by an edit
   * to a panel beside it.
   */
  router.post(`${CODEX_BASE}/pages/:id/connections`, requireWrite, (request, response) => {
    try {
      const connection = store.createConnection(pathParam(request, "id"), withoutCommandId(ConnectionCreateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 201, { connection: { id: connection.id, fromKind: "page" as const, fromId: connection.fromPageId, toPageId: connection.toPageId, label: connection.label, origin: "declared" as const, layer: connection.layer, createdAt: connection.createdAt } });
    } catch (error) { return codexError(response, error); }
  });

  /**
   * Relabel a DECLARED connection, or move it between layers.
   *
   * A `mention` has no id and cannot reach this route: it is derived from a body's text, so it is edited
   * by editing that text. That is not a limitation to route around - it is what keeps one sentence and
   * one edge from being two things to keep in step.
   */
  router.patch(`${CODEX_BASE}/connections/:id`, requireWrite, (request, response) => {
    try {
      const connection = store.updateConnection(pathParam(request, "id"), withoutCommandId(ConnectionUpdateSchema.parse(request.body)));
      options.notifyChanged();
      return envelope(response, 200, { connection: { id: connection.id, fromKind: "page" as const, fromId: connection.fromPageId, toPageId: connection.toPageId, label: connection.label, origin: "declared" as const, layer: connection.layer, createdAt: connection.createdAt } });
    } catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/connections/:id`, requireWrite, (request, response) => {
    store.deleteConnection(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  /**
   * The whole-graph feed. ONE edge list where `GET /codex/relationships` and `GET /codex/links` used to be
   * two - the Graph drew typed edges and wiki-link edges as separate species, so a codex wired together
   * with `[[links]]` looked like a field of orphans beside one wired with relationships.
   *
   * The player's copy passes `projectPlayerConnections`' three-condition gate. The context is resolved
   * HERE, once per request: which pages are revealed, and which non-page SOURCE records are - because a
   * connection out of a hidden session's prep body must not travel even to a revealed page.
   */
  router.get(`${CODEX_BASE}/connections`, (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const all = store.listAllConnections();
    if (role === "gm") return readEnvelope(request, response, role, { connections: projectGmConnections(all) });
    return readEnvelope(request, response, role, { connections: projectPlayerConnections(all, playerConnectionContext(store)) });
  });

  // ----- Maps (the atlas tree) -----

  router.get(`${CODEX_BASE}/maps`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listMaps();
    // A player's map keeps its parent link only when that parent is itself revealed - resolve per row (mirrors the marker route below).
    const revealed = new Set(rows.filter((row) => row.revealedToPlayers).map((row) => row.id));
    const maps = role === "gm"
      ? rows.map(projectGmMap)
      : rows.map((row) => projectPlayerMap(row, { parentRevealed: row.parentMapId ? revealed.has(row.parentMapId) : false })).filter((map) => map !== null);
    return readEnvelope(request, response, role, { maps });
  });

  router.post(`${CODEX_BASE}/maps`, requireWrite, (request, response) => {
    try { const map = store.createMap(withoutCommandId(MapCreateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 201, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/maps/:id`, requireWrite, (request, response) => {
    try { const map = store.updateMap(pathParam(request, "id"), withoutCommandId(MapUpdateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/maps/:id/parent`, requireWrite, (request, response) => {
    try { const map = store.setMapParent(pathParam(request, "id"), MapParentSchema.parse(request.body).parentMapId); options.notifyChanged(); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/maps/:id/reveal`, requireWrite, (request, response) => {
    try { const map = store.setMapRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged(); return envelope(response, 200, { map: projectGmMap(map) }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/maps/:id`, requireWrite, (request, response) => {
    store.deleteMap(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  // ----- Markers -----

  router.get(`${CODEX_BASE}/maps/:id/markers`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const mapId = pathParam(request, "id");
    const map = store.getMap(mapId);
    if (!map) return failure(response, 404, "not_found", "That map was not found.");
    const rows = store.listMarkers(mapId);
    if (role === "gm") return readEnvelope(request, response, role, { markers: rows.map(projectGmMarker) });
    if (!map.revealedToPlayers) return failure(response, 404, "not_found", "That map was not found.");
    const markers = rows
      .map((row) => projectPlayerMarker(row, {
        revealedPageIds: revealedPageIdsIn(store, row.pageIds),
        subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
      }))
      .filter((marker) => marker !== null);
    return readEnvelope(request, response, role, { markers });
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
    const role = readGrade(request, response);

    if (!role) return;
    const page = store.getPage(pathParam(request, "id"));
    if (!page) return failure(response, 404, "not_found", "That page was not found.");
    if (role !== "gm" && !page.revealedToPlayers) return failure(response, 404, "not_found", "That page was not found.");
    const rows = store.markersForPage(page.id);
    if (role === "gm") return readEnvelope(request, response, role, { markers: rows.map(projectGmMarker) });
    const markers = rows
      .map((row) => projectPlayerPageMarker({
        marker: row,
        mapRevealed: store.getMap(row.mapId)?.revealedToPlayers ?? false,
        revealedPageIds: revealedPageIdsIn(store, row.pageIds),
        subMapRevealed: row.subMapId ? (store.getMap(row.subMapId)?.revealedToPlayers ?? false) : false
      }))
      .filter((marker) => marker !== null);
    return readEnvelope(request, response, role, { markers });
  });

  router.post(`${CODEX_BASE}/maps/:id/markers`, requireWrite, (request, response) => {
    try { const marker = store.createMarker(pathParam(request, "id"), withoutCommandId(MarkerCreateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 201, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * D15: WHERE IS THE PARTY - one read, for the dashboard card and the atlas jump.
   *
   * Registered before every `/markers/:id` route below it. `/codex/party` is a literal segment under
   * `/codex/`, so nothing could swallow it either way, but the literals-before-params house rule is what
   * keeps that true when a `/codex/:something` route eventually exists.
   *
   * It replaces a client-side scan of every map looking for the flagged pin. The server already knows -
   * `partyMarker()` is one indexed read against the partial unique index that makes "exactly one party
   * pin" structural - and the resolution belongs on the side that owns the answer.
   *
   * The player answer is NULL rather than a 404 when the pin is not visible, and that is the whole
   * viewer-safety argument: a 404 would distinguish "there is a party pin you may not see" from "there is
   * no party pin", which is exactly the bit `isParty` must never grant. Null says neither. The pin itself
   * goes through `projectPlayerPageMarker`, so `isParty` still grants no visibility of its own - a hidden
   * party pin, or one on a hidden map, is as hidden as any other.
   *
   * `mapName` is safe for the same structural reason: it is only ever sent when the projection succeeded,
   * which requires the map to be revealed - and a revealed map's name is already in `GET /codex/maps`.
   */
  router.get(`${CODEX_BASE}/party`, (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const marker = store.partyMarker();
    const map = marker ? store.getMap(marker.mapId) : null;
    if (!marker || !map) return readEnvelope(request, response, role, { party: null });
    if (role === "gm") return readEnvelope(request, response, role, { party: { marker: projectGmMarker(marker), mapName: map.name } });
    const projected = projectPlayerPageMarker({
      marker,
      mapRevealed: map.revealedToPlayers,
      revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
      subMapRevealed: marker.subMapId ? (store.getMap(marker.subMapId)?.revealedToPlayers ?? false) : false
    });
    return readEnvelope(request, response, role, { party: projected === null ? null : { marker: projected, mapName: map.name } });
  });

  /**
   * D15: ONE pin, by id - what lets a reader resolve a pin without walking every map.
   *
   * The player gate is COPIED, not invented: `projectPlayerPageMarker` is `projectPlayerMarker` plus the
   * map gate, which is the identical CD-6 compound predicate `GET /codex/maps/{id}/markers` applies
   * before it projects a single pin. Either half failing is a **404, never a 403** - arriving by id must
   * not become a probe for "is there something here?", and the body is the same one a bogus id gets.
   *
   * Registered BEFORE `PATCH /markers/:id` only for readability; Express matches on method, so the order
   * of a GET against a PATCH is immaterial. The order that matters is literal-before-param, above.
   */
  router.get(`${CODEX_BASE}/markers/:id`, (request, response) => {
    const role = readGrade(request, response);
    if (!role) return;
    const marker = store.getMarker(pathParam(request, "id"));
    if (!marker) return failure(response, 404, "not_found", "That pin was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { marker: projectGmMarker(marker) });
    const projected = projectPlayerPageMarker({
      marker,
      mapRevealed: store.getMap(marker.mapId)?.revealedToPlayers ?? false,
      revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
      subMapRevealed: marker.subMapId ? (store.getMap(marker.subMapId)?.revealedToPlayers ?? false) : false
    });
    if (!projected) return failure(response, 404, "not_found", "That pin was not found.");
    return readEnvelope(request, response, role, { marker: projected });
  });

  router.patch(`${CODEX_BASE}/markers/:id`, requireWrite, (request, response) => {
    try { const marker = store.updateMarker(pathParam(request, "id"), withoutCommandId(MarkerUpdateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/markers/:id/move`, requireWrite, (request, response) => {
    try { const { x, y } = MarkerMoveSchema.parse(request.body); const marker = store.moveMarker(pathParam(request, "id"), x, y); options.notifyChanged(); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/markers/:id/reveal`, requireWrite, (request, response) => {
    try { const marker = store.setMarkerRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged(); return envelope(response, 200, { marker: projectGmMarker(marker) }); }
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
  router.put(`${CODEX_BASE}/markers/:id/party`, requireWrite, (request, response) => {
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
      options.notifyChanged();
      return envelope(response, 200, { marker: projectGmMarker(marker) });
    } catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/markers/:id`, requireWrite, (request, response) => {
    store.deleteMarker(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  // ----- Journal / timeline -----

  router.get(`${CODEX_BASE}/journal`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const markerId = typeof request.query.markerId === "string" ? request.query.markerId : undefined;
    const pageId = typeof request.query.pageId === "string" ? request.query.pageId : undefined;
    // A player may read a location's mini-timeline only when the location (marker/page) is itself
    // player-visible - otherwise a hidden pin/page id (however obtained) could be probed. Entry-level reveal
    // is still enforced below.
    //
    // The pin gate goes through `projectPlayerPageMarker`, which is the CD-6 compound predicate
    // (`marker.revealed AND map.revealed`), NOT the pin's own flag. Written as the flag alone, this route
    // answered 200 for a revealed pin on a hidden map while `GET /codex/markers/{id}` seventy lines up 404'd
    // the same pin - a 200-vs-404 existence oracle, and two spellings of one rule. There is one spelling now.
    if (role !== "gm") {
      if (markerId) {
        const marker = store.getMarker(markerId);
        const visible = marker !== null && projectPlayerPageMarker({
          marker,
          mapRevealed: store.getMap(marker.mapId)?.revealedToPlayers ?? false,
          revealedPageIds: revealedPageIdsIn(store, marker.pageIds),
          subMapRevealed: marker.subMapId ? (store.getMap(marker.subMapId)?.revealedToPlayers ?? false) : false
        }) !== null;
        if (!visible) return failure(response, 404, "not_found", "That was not found.");
      }
      if (pageId && !store.getPage(pageId)?.revealedToPlayers) return failure(response, 404, "not_found", "That was not found.");
    }
    const rows = markerId || pageId ? store.listEntriesFor({ markerId, pageId }) : store.listTimeline();
    if (role === "gm") return readEnvelope(request, response, role, { entries: rows.map(projectGmJournalEntry) });
    // An entry's `sessionNumber` is gated on the SESSION's reveal state, not the entry's, so the caller
    // resolves that set here - the `revealedPageIdsIn` division of labour, one record type later.
    const context = playerSessionNumbers(store);
    const entries = rows.map((row) => projectPlayerJournalEntry(row, context)).filter((entry) => entry !== null);
    return readEnvelope(request, response, role, { entries });
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
    const role = readGrade(request, response);

    if (!role) return;
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
      return readEnvelope(request, response, role, { records });
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
    return readEnvelope(request, response, role, { records });
  });

  router.post(`${CODEX_BASE}/journal`, requireWrite, (request, response) => {
    try { const entry = store.createEntry(withoutCommandId(JournalWriteSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 201, { entry: projectGmJournalEntry(entry) }); }
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
  router.post(`${CODEX_BASE}/journal/deadline`, requireWrite, (request, response) => {
    try { const entry = store.createDeadline(withoutCommandId(DeadlineCreateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 201, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * Creating downtime NEVER moves the clock (O-3). It answers with the date the clock WOULD move to, so the
   * GM's confirm affordance can say what it will do before it does it; `apply-downtime` below is the only
   * thing that moves anything.
   */
  router.post(`${CODEX_BASE}/journal/downtime`, requireWrite, (request, response) => {
    try {
      const entry = store.createDowntime(withoutCommandId(DowntimeCreateSchema.parse(request.body)));
      options.notifyChanged();
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
  router.post(`${CODEX_BASE}/journal/milestone`, requireWrite, (request, response) => {
    try { const entry = store.createMilestone(withoutCommandId(MilestoneCreateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 201, { entry: projectGmJournalEntry(entry) }); }
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
  router.post(`${CODEX_BASE}/journal/:id/apply-downtime`, requireWrite, (request, response) => {
    try {
      const { entry, calendar } = store.applyDowntime(pathParam(request, "id"));
      options.notifyChanged();
      return envelope(response, 200, { entry: projectGmJournalEntry(entry), calendar: projectGmCalendar(calendar, store.getPublishedDate()) });
    } catch (error) { return codexError(response, error); }
  });

  router.patch(`${CODEX_BASE}/journal/:id`, requireWrite, (request, response) => {
    try { const entry = store.updateEntry(pathParam(request, "id"), withoutCommandId(JournalUpdateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 200, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/journal/:id/reveal`, requireWrite, (request, response) => {
    try { const entry = store.setEntryRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged(); return envelope(response, 200, { entry: projectGmJournalEntry(entry) }); }
    catch (error) { return codexError(response, error); }
  });

  router.delete(`${CODEX_BASE}/journal/:id`, requireWrite, (request, response) => {
    store.deleteEntry(pathParam(request, "id"));
    options.notifyChanged();
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
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listSessions();
    if (role === "gm") return readEnvelope(request, response, role, { sessions: rows.map(projectGmSession), activeSessionId: store.activeSessionId });
    // A player gets `activeSessionId: null`, never the real id: it names a record that may well be
    // unrevealed, and a player has no use for it. The KEY stays present so one response shape serves both
    // roles - a key that appears only for the GM is a tell in itself.
    return readEnvelope(request, response, role, { sessions: rows.map(projectPlayerSession).filter((session) => session !== null), activeSessionId: null });
  });

  router.post(`${CODEX_BASE}/sessions`, requireWrite, (request, response) => {
    try { const session = store.createSession(withoutCommandId(SessionCreateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 201, { session: projectGmSession(session) }); }
    catch (error) { return codexError(response, error); }
  });

  router.get(`${CODEX_BASE}/sessions/:id`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const session = store.getSession(pathParam(request, "id"));
    if (!session) return failure(response, 404, "not_found", "That session was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { session: projectGmSession(session) });
    const projected = projectPlayerSession(session);
    // The SAME 404 an absent session gets, deliberately - never 403.
    if (!projected) return failure(response, 404, "not_found", "That session was not found.");
    return readEnvelope(request, response, role, { session: projected });
  });

  router.patch(`${CODEX_BASE}/sessions/:id`, requireWrite, (request, response) => {
    try {
      const { expectedRev, commandId, ...fields } = SessionUpdateSchema.parse(request.body); void commandId;
      const session = store.updateSession(pathParam(request, "id"), fields, expectedRev, "gm");
      options.notifyChanged();
      return envelope(response, 200, { session: projectGmSession(session) });
    } catch (error) { return codexError(response, error, () => store.getSession(pathParam(request, "id"))?.rev); }
  });

  router.delete(`${CODEX_BASE}/sessions/:id`, requireWrite, (request, response) => {
    store.deleteSession(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/sessions/:id/reveal`, requireWrite, (request, response) => {
    try { const session = store.setSessionRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged(); return envelope(response, 200, { session: projectGmSession(session) }); }
    catch (error) { return codexError(response, error); }
  });

  /**
   * Point the table at this session. Returns only the pointer, not the record: activating changes nothing
   * ABOUT the session (see `setActiveSession` - no `rev`, no `updated_at`), so echoing the row back would
   * imply an edit that did not happen.
   */
  router.post(`${CODEX_BASE}/sessions/:id/activate`, requireWrite, (request, response) => {
    try { const activeSessionId = store.setActiveSession(pathParam(request, "id")); options.notifyChanged(); return envelope(response, 200, { activeSessionId }); }
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
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listQuests();
    if (role === "gm") return readEnvelope(request, response, role, { quests: rows.map(projectGmQuest) });
    const quests = rows
      .map((row) => projectPlayerQuest(row, { revealedEntityIds: revealedPageIdsIn(store,row.entityIds) }))
      .filter((quest) => quest !== null);
    return readEnvelope(request, response, role, { quests });
  });

  router.post(`${CODEX_BASE}/quests`, requireWrite, (request, response) => {
    try { const quest = store.createQuest(withoutCommandId(QuestCreateSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 201, { quest: projectGmQuest(quest) }); }
    catch (error) { return codexError(response, error); }
  });

  router.get(`${CODEX_BASE}/quests/:id`, (request, response) => {
    const role = readGrade(request, response);

    if (!role) return;
    const quest = store.getQuest(pathParam(request, "id"));
    if (!quest) return failure(response, 404, "not_found", "That quest was not found.");
    if (role === "gm") return readEnvelope(request, response, role, { quest: projectGmQuest(quest) });
    const projected = projectPlayerQuest(quest, { revealedEntityIds: revealedPageIdsIn(store,quest.entityIds) });
    // The SAME 404 an absent quest gets, deliberately - never 403.
    if (!projected) return failure(response, 404, "not_found", "That quest was not found.");
    return readEnvelope(request, response, role, { quest: projected });
  });

  router.patch(`${CODEX_BASE}/quests/:id`, requireWrite, (request, response) => {
    try {
      const { expectedRev, commandId, ...fields } = QuestUpdateSchema.parse(request.body); void commandId;
      const quest = store.updateQuest(pathParam(request, "id"), fields, expectedRev);
      options.notifyChanged();
      return envelope(response, 200, { quest: projectGmQuest(quest) });
    } catch (error) { return codexError(response, error, () => store.getQuest(pathParam(request, "id"))?.rev); }
  });

  router.delete(`${CODEX_BASE}/quests/:id`, requireWrite, (request, response) => {
    store.deleteQuest(pathParam(request, "id"));
    options.notifyChanged();
    return envelope(response, 200, { deleted: true });
  });

  router.post(`${CODEX_BASE}/quests/:id/reveal`, requireWrite, (request, response) => {
    try { const quest = store.setQuestRevealed(pathParam(request, "id"), RevealSchema.parse(request.body).revealed); options.notifyChanged(); return envelope(response, 200, { quest: projectGmQuest(quest) }); }
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
    const role = readGrade(request, response);

    if (!role) return;
    const rows = store.listStanding();
    if (role === "gm") return readEnvelope(request, response, role, { standing: rows.map(projectGmStanding) });
    const standing = rows
      .map((row) => projectPlayerStanding(row, { factionRevealed: pageRevealedFor(store, row.factionPageId) }))
      .filter((row) => row !== null);
    return readEnvelope(request, response, role, { standing });
  });

  /**
   * Set where the party stands with one faction. The store writes the value AND appends the `standing`
   * chronicle record in ONE transaction, so the table and the history can never disagree - which is also why
   * `reason` belongs on this body rather than on a second call.
   *
   * The ping it emits carries nothing, like every other one (D22): a standing write really does change the
   * journal as well as the table, and telling the whole table which of the two a GM just touched was the
   * `scope` word that D22 removed. Every client listener refetches its own view regardless.
   */
  router.put(`${CODEX_BASE}/standing/:factionPageId`, requireWrite, (request, response) => {
    try {
      const { value, reason } = StandingSetSchema.parse(request.body);
      const standing = store.setStanding(pathParam(request, "factionPageId"), value, reason);
      options.notifyChanged();
      return envelope(response, 200, { standing: projectGmStanding(standing) });
    } catch (error) { return codexError(response, error); }
  });

  router.post(`${CODEX_BASE}/standing/:factionPageId/reveal`, requireWrite, (request, response) => {
    try {
      const standing = store.setStandingRevealed(pathParam(request, "factionPageId"), RevealSchema.parse(request.body).revealed);
      options.notifyChanged();
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
  router.get(`${CODEX_BASE}/reveal-audit`, requireGmRead, (request, response) => {
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
    return readEnvelope(request, response, "gm", { audit: projectRevealAudit(records) });
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
    const role = readGrade(request, response);

    if (!role) return;
    const calendar = store.getCalendar();
    const publishedDate = store.getPublishedDate();
    return readEnvelope(request, response, role, { calendar: role === "gm" ? projectGmCalendar(calendar, publishedDate) : projectPlayerCalendar(calendar, publishedDate) });
  });

  /**
   * Replacing the calendar moves the GM's clock and NOTHING else - advancing never publishes (D11-H). It
   * answers with the GM projection, the same shape the GM's GET returns, so the console does not have to
   * hold two spellings of one object.
   */
  router.put(`${CODEX_BASE}/calendar`, requireWrite, (request, response) => {
    try { const calendar = store.setCalendar(withoutCommandId(CalendarSchema.parse(request.body))); options.notifyChanged(); return envelope(response, 200, { calendar: projectGmCalendar(calendar, store.getPublishedDate()) }); }
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
  router.post(`${CODEX_BASE}/calendar/publish`, requireWrite, (_request, response) => {
    try {
      const calendar = store.publishCampaignDate();
      options.notifyChanged();
      return envelope(response, 200, { calendar: projectGmCalendar(calendar, store.getPublishedDate()) });
    } catch (error) { return codexError(response, error); }
  });

  /**
   * D16: restore a backup. The one genuinely destructive route in the Codex.
   *
   * REPLACE-ONLY and all-or-nothing - the store wipes and reloads every table inside one transaction, so
   * a bad row aborts the lot and the codex is left exactly as it was. The guardrails are authorization
   * (GM session or `codex:write`) and the caller's own confirmation; there is deliberately no `confirm`
   * literal in the body, because the body has to be a saved export file posted back unedited.
   *
   * The ping is emitted after a successful restore and every client refetches everything - which is
   * exactly right when the whole world has just been replaced underneath them.
   */
  router.post(`${CODEX_BASE}/import`, requireWrite, (request, response) => {
    try {
      const { codex } = CodexImportSchema.parse(request.body);
      const counts = store.importBundle(codex);
      options.notifyChanged();
      return envelope(response, 200, { replaced: true, counts });
    } catch (error) { return codexError(response, error); }
  });

  // ----- Codex-wide settings (GM-only: how much version history the codex keeps) -----

  /**
   * OWNER DECISION (2026-07-30). Two GM-only routes over `codex_meta`'s two new columns.
   *
   * **GM-only on BOTH sides, including the read**, unlike the calendar pair immediately above. There is no
   * player projection to write because there is nothing here a player has any use for: these settings describe
   * how the GM's own authoring history is kept, they gate no content, and they place nothing on a player's
   * screen. A read a player could make would only be a fact about the GM's tooling leaking sideways.
   *
   * **NOTHING IS BROADCAST from either of these routes, or from the revision delete below** - the one place in
   * this file that departs from "every write calls `notifyChanged`", so it is worth saying why rather than
   * looking like an omission. `notifyChanged` is a content-free ping (D22) - it carries a revision and
   * nothing else, so it cannot say "settings changed" even if that were worth saying. Firing it here would
   * make every client, players included, refetch a list that did not move. Nothing a player can read
   * changed: these settings describe how the GM's own authoring history is kept. There is exactly one GM,
   * and they get the new state in this response.
   *
   * The store still bumps the coarse codex revision inside each write's transaction (every write does), so an
   * ETag-driven reader is not left holding a stale token; there is simply no content to push.
   */
  router.get(`${CODEX_BASE}/settings`, requireGmRead, (request, response) => readEnvelope(request, response, "gm", { settings: store.getSettings() }));

  /**
   * Replaces the settings wholesale and answers with the full READ shape, never with what was sent - so a caller
   * whose `windowMinutes` was clamped or truncated sees the real value rather than believing its own number
   * took, and gets the usage figures without a second round trip. Same contract as `PUT /codex/calendar`: a
   * malformed body is a 400 through `malformed`, and the store is the enforcer behind it.
   *
   * `versionCount` / `versionBytes` are NOT accepted here, and the schema is `.strict()` (as every schema in
   * this file is), so sending either is a **400** rather than a silently ignored key. That is the right answer
   * rather than merely the convenient one: they are facts about a table the caller cannot see, so a body
   * carrying them is a caller asserting something it does not know, and hearing so is better than being
   * quietly overruled. `CodexSettingsInput` has no shape for them either, so there is no path that stores them.
   */
  router.put(`${CODEX_BASE}/settings`, requireWrite, (request, response) => {
    try { return envelope(response, 200, { settings: store.setSettings(withoutCommandId(CodexSettingsSchema.parse(request.body))) }); }
    catch (error) { return malformed(response, error); }
  });

  /**
   * OWNER DECISION (2026-07-30): "yes" to a way of deleting existing version history. The ONE destructive route
   * in the Codex surface, and everything about it is deliberately unforgiving.
   *
   * Addressed at `/codex/page-revisions` - the whole `codex_page_revisions` table - rather than under
   * `/codex/pages/{id}/revisions`, because the question it answers ("reclaim the space my history is using") is
   * about the codex, not about one page. `GET /codex/pages/{id}/revisions` remains the per-page read; the two
   * paths do not overlap and neither can be mis-matched by the router.
   *
   * A bad `olderThanDays` is a 400, never a clamp (see `RevisionsDeleteSchema`). It works with history switched
   * OFF - a GM who disabled it is exactly the GM reclaiming space - and it never touches `codex_pages`: a page
   * as it stands now is not a version of itself.
   */
  router.delete(`${CODEX_BASE}/page-revisions`, requireWrite, (request, response) => {
    try { return envelope(response, 200, { deleted: store.deleteRevisionsOlderThan(RevisionsDeleteSchema.parse(request.body).olderThanDays) }); }
    catch (error) { return malformed(response, error); }
  });

  // ----- Export (GM backup / round-trip) -----

  router.get(`${CODEX_BASE}/export`, requireGmRead, (request, response) => {
    return readEnvelope(request, response, "gm", { codex: store.exportBundle(), exportedAt: new Date().toISOString(), bundleVersion: CODEX_BUNDLE_VERSION });
  });

  // ----- Media (page banners + inline images) -----

  router.post(CODEX_ASSET_BASE, requireWrite, express.raw({ type: () => true, limit: "11mb" }), async (request, response) => {
    try {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) return failure(response, 400, "validation_failed", "Upload the image as the request body.");
      const filename = typeof request.query.filename === "string" ? request.query.filename : "image";
      const imported = await options.assets.import(request.body, filename);
      return envelope(response, imported.duplicate ? 200 : 201, { asset: { id: imported.metadata.id, width: imported.metadata.width, height: imported.metadata.height, mediaType: imported.metadata.mediaType } });
    } catch (error) { return failure(response, 400, "validation_failed", error instanceof Error ? error.message : "The image upload failed."); }
  });

  router.get(`${CODEX_ASSET_BASE}/:id/content`, async (request, response) => {
    const id = pathParam(request, "id");
    // GM (or a credential, which reads at GM grade) always; a player only when the asset is used by a
    // revealed page (banner or inline image).
    //
    // This was the ONE codex route that hand-rolled its authorization - `authorizeGm(token) ||
    // (authorizePlayer(token) && ...)` - and so the one route a `codex:read` credential could not reach,
    // while the served OpenAPI, the generated reference and the scope table all promise it does. A
    // `codex:write` credential could upload a page banner it could never read back. Routed through
    // `principalFor` like every other codex read, there is no longer a route with its own answer to "who is
    // calling". The 403-for-everyone-else (rather than a 401 for no token) is the deliberate, documented
    // exception this route keeps: a media URL must not become an existence oracle, so it refuses before it
    // looks anything up, and the refusal reads the same whoever asked.
    const principal = principalFor(request, response, options, "codex:read");
    const allowed = principal.kind === "gm" || principal.kind === "integration"
      || (principal.kind === "player" && store.isPageAssetVisibleToPlayers(id));
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

  /**
   * The catch-all. It used to forward `error.message` to the caller, which on a SQLite failure is a table
   * name, a column name, or a file path - detail a player session and an integration credential have no
   * business receiving, and detail nobody can act on anyway. One fixed sentence out, the real error to
   * the server log, matching the game surface's discipline.
   *
   * The ONE thing it does look at is a body-parser refusal, and only because this router owns a parser of
   * its own: the asset upload mounts `express.raw` at 11 MB, and an error thrown by a route-level parser
   * reaches THIS handler, not the app-level one in `server.ts` that renders 413s - Express propagates
   * errors forward through the stack and that handler is registered before this router. So an oversized
   * page image answered a sanitized 500 and the caller could not tell "too big" from "we broke". The status
   * and the sentence are copied from the app-level handler so the surface answers one way.
   */
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if ((error as { type?: string } | null)?.type === "entity.too.large") return failure(response, 413, "bad_request", "The request body is too large.");
    console.error("codex request failed:", error);
    return failure(response, 500, "internal_error", "The codex request failed.");
  });
  return router;
}
