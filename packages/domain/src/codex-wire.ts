// The Codex's HTTP shapes (`/api/v1/codex/*`): one definition that the server's projections are typed
// against, the client reads and the OpenAPI document is generated from. The GM shape of a record is the stored
// row; its player twin is a separate allow-list, so a field added to the GM side stays off the player wire until
// it is added here too. Every key is present on both sides (nullable where unused), so the document's
// role-projected `oneOf` matches exactly one branch. Prose for each field lives in the server's
// `openapi/descriptions.ts`.

import { z } from "zod";
import { CodexInWorldDateSchema } from "./codex-calendar.js";
import { CODEX_ENTITY_TYPES } from "./codex-entities.js";
import type { Wire } from "./wire.js";

// ----- Vocabulary -----

const CodexEntityTypeSchema = z.enum(CODEX_ENTITY_TYPES);
/** Which record a connection comes from. Every connection points into a page. */
const CodexConnectionSourceKindSchema = z.enum(["page", "session", "quest", "journal"]);
export type CodexConnectionSourceKind = z.infer<typeof CodexConnectionSourceKindSchema>;
const CodexConnectionOriginSchema = z.enum(["declared", "mention"]);
export type CodexConnectionOrigin = z.infer<typeof CodexConnectionOriginSchema>;
/** A GM-layer edge never travels to a player; a mention takes the layer of the text it sits in. */
const CodexConnectionLayerSchema = z.enum(["player", "gm"]);
export type CodexConnectionLayer = z.infer<typeof CodexConnectionLayerSchema>;
const CodexMapKindSchema = z.enum(["battlemap", "regional", "world"]);
export type CodexMapKind = z.infer<typeof CodexMapKindSchema>;
/** Every journal row's kind, discriminated for display. */
const CodexJournalKindSchema = z.enum(["note", "combat", "deadline", "downtime", "milestone", "standing", "quest"]);
export type CodexJournalKind = z.infer<typeof CodexJournalKindSchema>;
/** A chronicle row: a journal kind (`note` reads as `entry`) or a dated `event` page. */
const CodexChronicleKindSchema = z.enum([
  "entry",
  "combat",
  "event",
  "deadline",
  "downtime",
  "milestone",
  "standing",
  "quest"
]);
export type CodexChronicleKind = z.infer<typeof CodexChronicleKindSchema>;
const CodexSessionStatusSchema = z.enum(["planned", "played"]);
export type CodexSessionStatus = z.infer<typeof CodexSessionStatusSchema>;
/** Lifecycle order. `not-started` and `active` are open; the rest are done. */
const CodexQuestStatusSchema = z.enum(["not-started", "active", "completed", "failed", "canceled"]);
export type CodexQuestStatus = z.infer<typeof CodexQuestStatusSchema>;
/** A blank `text` is a legitimate transient state (a row just added), so blank rows are never stripped. */
export const CodexQuestObjectiveSchema = z.strictObject({ text: z.string().max(120), done: z.boolean() });
export type CodexQuestObjective = Wire<z.infer<typeof CodexQuestObjectiveSchema>>;
/** The kinds the suite-wide search indexes. */
const CodexRecordKindSchema = z.enum(["page", "journal", "map", "marker", "quest", "session"]);
export type CodexRecordKind = z.infer<typeof CodexRecordKindSchema>;
/** Every surface the reveal audit reports on. */
const CodexRevealAuditKindSchema = z.enum(["date", "page", "map", "marker", "journal", "session", "quest", "standing"]);
export type CodexRevealAuditKind = z.infer<typeof CodexRevealAuditKindSchema>;

const tags = () => z.array(z.string());
const timestamp = () => z.iso.datetime();

// ----- Pages -----

/** Derived from `inWorldDate`, the date the GM typed, against the live calendar. */
const dating = {
  inWorldLabel: z.string().nullable(),
  calendarInstant: z.number().nullable(),
  inWorldDate: CodexInWorldDateSchema.nullable()
};

export const CodexPageSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  entityType: CodexEntityTypeSchema,
  /** Player-facing structured fields; secret keys rest in `gmFields`. */
  fields: z.record(z.string(), z.string()),
  folder: z.string().nullable(),
  tags: tags(),
  revealedToPlayers: z.boolean(),
  bannerAssetId: z.uuid().nullable(),
  ...dating,
  rev: z.number().int().min(0),
  createdAt: timestamp(),
  /** Moves on every save. */
  updatedAt: timestamp(),
  /** Moves only when something a player can see changes, so it is the one edit time players get. */
  playerUpdatedAt: timestamp()
});
export type CodexPageSummary = Wire<z.infer<typeof CodexPageSummarySchema>>;
export const CodexPageSchema = CodexPageSummarySchema.extend({
  playerBody: z.string(),
  gmBody: z.string(),
  gmFields: z.record(z.string(), z.string())
});
export type CodexPage = Wire<z.infer<typeof CodexPageSchema>>;

/**
 * Only when revealed. No GM body, GM fields, reveal flag, date or `rev`. No `folder`, which is the GM's private
 * filing, and no `updatedAt`, which a GM-only save moves.
 */
export const PlayerCodexPageSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  entityType: CodexEntityTypeSchema,
  tags: tags(),
  bannerAssetId: z.uuid().nullable(),
  playerUpdatedAt: timestamp()
});
export type PlayerCodexPageSummary = Wire<z.infer<typeof PlayerCodexPageSummarySchema>>;
/** `playerBody` arrives as `body`. */
export const PlayerCodexPageSchema = PlayerCodexPageSummarySchema.extend({
  fields: z.record(z.string(), z.string()),
  body: z.string()
});
export type PlayerCodexPage = Wire<z.infer<typeof PlayerCodexPageSchema>>;

/** GM-only: the state a save checkpointed. */
export const CodexPageRevisionSchema = z.strictObject({
  id: z.number().int().min(1),
  pageId: z.uuid(),
  rev: z.number().int().min(0),
  title: z.string(),
  playerBody: z.string(),
  gmBody: z.string(),
  bannerAssetId: z.uuid().nullable(),
  tags: tags(),
  authoredAt: timestamp(),
  authorTag: z.string()
});
export type CodexPageRevision = Wire<z.infer<typeof CodexPageRevisionSchema>>;

// ----- Connections: declared edges and `[[wiki link]]` mentions are one system -----

/** One graph edge. `id` is null exactly for a mention, which is edited through its source text. */
export const CodexConnectionSchema = z.strictObject({
  id: z.uuid().nullable(),
  fromKind: CodexConnectionSourceKindSchema,
  fromId: z.uuid(),
  toPageId: z.uuid(),
  /** The out-label ("ally of"); null for an unlabelled connection. */
  label: z.string().min(1).max(40).nullable(),
  origin: CodexConnectionOriginSchema,
  layer: CodexConnectionLayerSchema,
  createdAt: timestamp().nullable()
});
export type CodexConnection = Wire<z.infer<typeof CodexConnectionSchema>>;
/** Player-layer edges between records the player can see; no `id`, `layer` or `createdAt`. */
export const PlayerCodexConnectionSchema = z.strictObject({
  fromKind: CodexConnectionSourceKindSchema,
  fromId: z.uuid(),
  toPageId: z.uuid(),
  label: z.string().min(1).max(40).nullable(),
  origin: CodexConnectionOriginSchema
});
export type PlayerCodexConnection = Wire<z.infer<typeof PlayerCodexConnectionSchema>>;

/** One row of a page's Connections panel: the other end resolved, plus the edge's direction. */
export const CodexPageConnectionSchema = z.strictObject({
  id: z.uuid().nullable(),
  direction: z.enum(["out", "in"]),
  otherKind: CodexConnectionSourceKindSchema,
  otherId: z.uuid(),
  /** A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry's player text. */
  otherTitle: z.string(),
  otherEntityType: CodexEntityTypeSchema.nullable(),
  /** The other record's own reveal flag. */
  otherRevealed: z.boolean(),
  label: z.string().nullable(),
  origin: CodexConnectionOriginSchema,
  layer: CodexConnectionLayerSchema,
  /** The heading a mention sits under; null for a declared connection. */
  section: z.string().nullable()
});
export type CodexPageConnection = Wire<z.infer<typeof CodexPageConnectionSchema>>;
/** Gated like the graph feed; no `id`, `layer` or `otherRevealed`. */
export const PlayerCodexPageConnectionSchema = z.strictObject({
  direction: z.enum(["out", "in"]),
  otherKind: CodexConnectionSourceKindSchema,
  otherId: z.uuid(),
  otherTitle: z.string(),
  otherEntityType: CodexEntityTypeSchema.nullable(),
  label: z.string().nullable(),
  origin: CodexConnectionOriginSchema,
  section: z.string().nullable()
});
export type PlayerCodexPageConnection = Wire<z.infer<typeof PlayerCodexPageConnectionSchema>>;

// ----- The atlas: maps and their pins -----

export const CodexMapSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  name: z.string(),
  kind: CodexMapKindSchema,
  parentMapId: z.uuid().nullable(),
  revealedToPlayers: z.boolean(),
  sortKey: z.number(),
  tags: tags(),
  createdAt: timestamp(),
  updatedAt: timestamp()
});
export type CodexMap = Wire<z.infer<typeof CodexMapSchema>>;
/** Only when revealed. `parentMapId` is null unless the parent is revealed too. */
export const PlayerCodexMapSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  name: z.string(),
  kind: CodexMapKindSchema,
  parentMapId: z.uuid().nullable(),
  tags: tags()
});
export type PlayerCodexMap = Wire<z.infer<typeof PlayerCodexMapSchema>>;

const hexColor = () => z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const CodexMarkerSchema = z.strictObject({
  id: z.uuid(),
  mapId: z.uuid(),
  x: z.number(),
  y: z.number(),
  iconId: z.string(),
  iconColor: hexColor(),
  label: z.string().nullable(),
  revealedToPlayers: z.boolean(),
  tags: tags(),
  /** At most one party pin atlas-wide. Player-facing, but grants no visibility. */
  isParty: z.boolean(),
  pageIds: z.array(z.uuid()),
  subMapId: z.uuid().nullable(),
  /** Scenes staged from this pin: GM-only in every projection. */
  sceneIds: z.array(z.uuid()),
  actorId: z.uuid().nullable(),
  createdAt: timestamp(),
  updatedAt: timestamp()
});
export type CodexMarker = Wire<z.infer<typeof CodexMarkerSchema>>;
/** Only when the pin and its map are revealed. No scene or actor links; page and sub-map links only when revealed. */
export const PlayerCodexMarkerSchema = z.strictObject({
  id: z.uuid(),
  mapId: z.uuid(),
  x: z.number(),
  y: z.number(),
  iconId: z.string(),
  iconColor: hexColor(),
  label: z.string().nullable(),
  pageIds: z.array(z.uuid()),
  subMapId: z.uuid().nullable(),
  tags: tags(),
  isParty: z.boolean()
});
export type PlayerCodexMarker = Wire<z.infer<typeof PlayerCodexMarkerSchema>>;

// ----- Journal payloads, one per kind that carries structured facts -----

/** `applied` (has the GM confirmed the clock move?) makes applying idempotent and is GM workflow state. */
export const CodexDowntimePayloadSchema = z.strictObject({
  who: z.string(),
  activity: z.string(),
  days: z.number().int().min(0),
  applied: z.boolean(),
  /** Links the row to a character page; `who` is the fallback. No foreign key: deleting the page nulls it. */
  characterPageId: z.uuid().nullable()
});
export type CodexDowntimePayload = Wire<z.infer<typeof CodexDowntimePayloadSchema>>;
/** The level reached. `reason` has no reveal split, so GM-only detail belongs in `gmText`. Both
 *  audiences get the same shape. */
export const CodexMilestonePayloadSchema = z.strictObject({
  level: z.number().int().min(1).max(20),
  reason: z.string().max(120)
});
export type CodexMilestonePayload = Wire<z.infer<typeof CodexMilestonePayloadSchema>>;
/** `delta` is the change from the old value. No foreign key, so history survives a deleted faction. */
export const CodexStandingPayloadSchema = z.strictObject({
  factionPageId: z.uuid(),
  delta: z.number().int(),
  reason: z.string().max(120)
});
export type CodexStandingPayload = Wire<z.infer<typeof CodexStandingPayloadSchema>>;
/** A quest reached `status`, written on quest create and status change. No foreign key, so history survives the quest. */
export const CodexQuestEventPayloadSchema = z.strictObject({ questId: z.uuid(), status: CodexQuestStatusSchema });
export type CodexQuestEventPayload = Wire<z.infer<typeof CodexQuestEventPayloadSchema>>;
export type CodexJournalPayload =
  CodexDowntimePayload | CodexMilestonePayload | CodexStandingPayload | CodexQuestEventPayload;
const CodexJournalPayloadSchema = z.union([
  CodexDowntimePayloadSchema,
  CodexMilestonePayloadSchema,
  CodexStandingPayloadSchema,
  CodexQuestEventPayloadSchema,
  z.null()
]);

/** No `applied`; `characterPageId` only when that page is revealed. */
export const PlayerCodexDowntimePayloadSchema = z.strictObject({
  who: z.string(),
  activity: z.string(),
  days: z.number().int().min(0),
  characterPageId: z.uuid().nullable()
});
export type PlayerCodexDowntimePayload = Wire<z.infer<typeof PlayerCodexDowntimePayloadSchema>>;
export type PlayerCodexMilestonePayload = CodexMilestonePayload;
/** `factionPageId` is null unless the faction's page is revealed. */
export const PlayerCodexStandingPayloadSchema = z.strictObject({
  factionPageId: z.uuid().nullable(),
  delta: z.number().int(),
  reason: z.string().max(120)
});
export type PlayerCodexStandingPayload = Wire<z.infer<typeof PlayerCodexStandingPayloadSchema>>;
/** `questId` is null unless the quest is revealed. */
export const PlayerCodexQuestEventPayloadSchema = z.strictObject({
  questId: z.uuid().nullable(),
  status: CodexQuestStatusSchema
});
export type PlayerCodexQuestEventPayload = Wire<z.infer<typeof PlayerCodexQuestEventPayloadSchema>>;
export type PlayerCodexJournalPayload =
  PlayerCodexDowntimePayload | PlayerCodexMilestonePayload | PlayerCodexStandingPayload | PlayerCodexQuestEventPayload;
const PlayerCodexJournalPayloadSchema = z.union([
  PlayerCodexDowntimePayloadSchema,
  CodexMilestonePayloadSchema,
  PlayerCodexStandingPayloadSchema,
  PlayerCodexQuestEventPayloadSchema,
  z.null()
]);

// ----- The journal -----

export const CodexJournalEntrySchema = z.strictObject({
  id: z.uuid(),
  playerText: z.string(),
  gmText: z.string().nullable(),
  revealedToPlayers: z.boolean(),
  attachMarkerId: z.uuid().nullable(),
  attachPageId: z.uuid().nullable(),
  kind: CodexJournalKindSchema,
  sourceEncounterId: z.number().int().nullable(),
  /** The session this entry is filed under, or null. */
  sessionId: z.uuid().nullable(),
  /** The session's live number, or the number a deleted revealed session left behind (with `sessionId` null). */
  sessionNumber: z.number().int().nullable(),
  realDate: z.string().nullable(),
  /** `inWorldDate` is the literal date the GM entered, so instants can be recomputed when the calendar changes. */
  ...dating,
  sortKey: z.number(),
  tags: tags(),
  /** Kind-specific structured data; null for kinds without one. */
  payload: CodexJournalPayloadSchema,
  createdAt: timestamp(),
  updatedAt: timestamp()
});
export type CodexJournalEntry = Wire<z.infer<typeof CodexJournalEntrySchema>>;
/**
 * Only when revealed. `sessionId` and `sessionNumber` are both null unless the session is revealed, since
 * either half says the session exists.
 */
export const PlayerCodexJournalEntrySchema = z.strictObject({
  id: z.uuid(),
  text: z.string(),
  kind: CodexJournalKindSchema,
  sessionId: z.uuid().nullable(),
  sessionNumber: z.number().int().nullable(),
  realDate: z.string().nullable(),
  inWorldLabel: z.string().nullable(),
  tags: tags(),
  createdAt: timestamp()
});
export type PlayerCodexJournalEntry = Wire<z.infer<typeof PlayerCodexJournalEntrySchema>>;

/**
 * One chronicle row: a journal entry, or a dated `event` page (`id` is then the page id and the texts are
 * bounded excerpts of its bodies). Every key is present on every kind.
 */
export const CodexChronicleRecordSchema = z.strictObject({
  kind: CodexChronicleKindSchema,
  id: z.uuid(),
  title: z.string().nullable(),
  text: z.string(),
  gmText: z.string().nullable(),
  revealedToPlayers: z.boolean(),
  sessionId: z.uuid().nullable(),
  sessionNumber: z.number().int().nullable(),
  realDate: z.string().nullable(),
  ...dating,
  tags: tags(),
  attachPageId: z.uuid().nullable(),
  attachMarkerId: z.uuid().nullable(),
  sourceEncounterId: z.number().int().nullable(),
  /** Has the GM's clock reached this deadline's date? Derived server-side, so rewinding the clock un-fires it. */
  fired: z.boolean(),
  payload: CodexJournalPayloadSchema,
  /** Where confirming this downtime would move the clock. Null once applied and for other kinds. */
  proposedDate: CodexInWorldDateSchema.nullable(),
  createdAt: timestamp(),
  updatedAt: timestamp()
});
export type CodexChronicleRecord = Wire<z.infer<typeof CodexChronicleRecordSchema>>;
/** No GM text, attachments, encounter id or proposed date. `fired` is measured against the published date. */
export const PlayerCodexChronicleRecordSchema = z.strictObject({
  kind: CodexChronicleKindSchema,
  id: z.uuid(),
  title: z.string().nullable(),
  text: z.string(),
  sessionId: z.uuid().nullable(),
  sessionNumber: z.number().int().nullable(),
  realDate: z.string().nullable(),
  inWorldLabel: z.string().nullable(),
  inWorldDate: CodexInWorldDateSchema.nullable(),
  /** Use this for placement and sorting; never re-derive it client-side. */
  calendarInstant: z.number().nullable(),
  tags: tags(),
  fired: z.boolean(),
  payload: PlayerCodexJournalPayloadSchema,
  createdAt: timestamp()
});
export type PlayerCodexChronicleRecord = Wire<z.infer<typeof PlayerCodexChronicleRecordSchema>>;

// ----- Sessions: prep is the GM half, the recap the player half -----

export const CodexSessionSchema = z.strictObject({
  id: z.uuid(),
  sessionNumber: z.number().int().nullable(),
  /** The real-world date the group met, free text. */
  realDate: z.string().nullable(),
  attendees: z.array(z.string()),
  prepBody: z.string(),
  recapBody: z.string(),
  revealedToPlayers: z.boolean(),
  status: CodexSessionStatusSchema,
  tags: tags(),
  /** Scenes staged for this session. A dangling id is expected. */
  sceneIds: z.array(z.uuid()),
  rev: z.number().int().min(0),
  createdAt: timestamp(),
  updatedAt: timestamp()
});
export type CodexSession = Wire<z.infer<typeof CodexSessionSchema>>;
/**
 * Only when revealed. No prep (the GM's plan), attendees (real-world personal data), status, scenes or `rev`;
 * `recapBody` arrives as `recap`.
 */
export const PlayerCodexSessionSchema = z.strictObject({
  id: z.uuid(),
  sessionNumber: z.number().int().nullable(),
  realDate: z.string().nullable(),
  recap: z.string(),
  tags: tags()
});
export type PlayerCodexSession = Wire<z.infer<typeof PlayerCodexSessionSchema>>;

// ----- Quests: the player body is what the party was told, the GM body where it is really going -----

export const CodexQuestSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  status: CodexQuestStatusSchema,
  playerBody: z.string(),
  gmBody: z.string(),
  /** Ordered: the GM's sequence is the meaning. */
  objectives: z.array(CodexQuestObjectiveSchema).max(24),
  /** Pages this quest concerns. */
  entityIds: z.array(z.uuid()).max(24),
  revealedToPlayers: z.boolean(),
  tags: tags(),
  rev: z.number().int().min(0),
  createdAt: timestamp(),
  updatedAt: timestamp()
});
export type CodexQuest = Wire<z.infer<typeof CodexQuestSchema>>;
/** Only when revealed. No GM body or `rev`; `entityIds` only for revealed pages. */
export const PlayerCodexQuestSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  status: CodexQuestStatusSchema,
  body: z.string(),
  objectives: z.array(CodexQuestObjectiveSchema).max(24),
  entityIds: z.array(z.uuid()).max(24),
  tags: tags()
});
export type PlayerCodexQuest = Wire<z.infer<typeof PlayerCodexQuestSchema>>;

// ----- Faction standing -----

/** One row per faction page. `value` runs -100 (Hostile) to +100 (Allied); the history is `standing` journal rows. */
export const CodexStandingSchema = z.strictObject({
  id: z.uuid(),
  factionPageId: z.uuid(),
  value: z.number().int().min(-100).max(100),
  revealedToPlayers: z.boolean(),
  createdAt: timestamp(),
  updatedAt: timestamp()
});
export type CodexStanding = Wire<z.infer<typeof CodexStandingSchema>>;
/** Only when both the standing and its faction page are revealed. The faction page id identifies it. */
export const PlayerCodexStandingSchema = z.strictObject({
  factionPageId: z.uuid(),
  value: z.number().int().min(-100).max(100)
});
export type PlayerCodexStanding = Wire<z.infer<typeof PlayerCodexStandingSchema>>;

// ----- The calendar: the GM's prep clock and the players' published clock -----

export const CodexCalendarMonthSchema = z.strictObject({ name: z.string(), days: z.number().int().min(1).max(400) });
export const CodexCalendarEraSchema = z.strictObject({
  name: z.string().max(40),
  startYear: z.number().int().min(-100_000).max(100_000)
});
/** The calendar's structure is public, so both audiences share it. */
const calendarStructure = {
  yearName: z.string(),
  eras: z.array(CodexCalendarEraSchema).max(20),
  months: z.array(CodexCalendarMonthSchema).min(1).max(24),
  weekdays: z.array(z.string()).max(20)
};
/** `currentDate` is the GM's clock; `publishedDate` is what players currently see as theirs. */
export const GmCodexCalendarSchema = z.strictObject({
  ...calendarStructure,
  currentDate: CodexInWorldDateSchema.nullable(),
  publishedDate: CodexInWorldDateSchema.nullable()
});
export type GmCodexCalendar = Wire<z.infer<typeof GmCodexCalendarSchema>>;
/** `currentDate` is the published date. */
export const PlayerCodexCalendarSchema = z.strictObject({
  ...calendarStructure,
  currentDate: CodexInWorldDateSchema.nullable()
});
export type PlayerCodexCalendar = Wire<z.infer<typeof PlayerCodexCalendarSchema>>;

// ----- Suite-wide search -----

/** Every key is present on every kind, and each is already in that kind's player projection. */
export const CodexSearchHitSchema = z.strictObject({
  kind: CodexRecordKindSchema,
  id: z.uuid(),
  title: z.string(),
  tags: tags(),
  /** Pages only. */
  entityType: CodexEntityTypeSchema.nullable(),
  /** Markers only, so a pin hit can open its map. */
  mapId: z.uuid().nullable()
});
export type CodexSearchHit = Wire<z.infer<typeof CodexSearchHitSchema>>;
/** The Codex is unpaginated; `truncated` means the search itself was cut off. */
export const CodexSearchResultSchema = z.strictObject({ hits: z.array(CodexSearchHitSchema), truncated: z.boolean() });
export type CodexSearchResult = Wire<z.infer<typeof CodexSearchResultSchema>>;

// ----- Settings (GM-only) -----

/** `enabled: false` stops new revisions but deletes none; `windowMinutes: 0` keeps every save. */
const CodexRevisionHistorySettingsSchema = z.strictObject({
  enabled: z.boolean(),
  windowMinutes: z.number().int().min(0).max(10_080)
});
export type CodexRevisionHistorySettings = Wire<z.infer<typeof CodexRevisionHistorySettingsSchema>>;
/** What kept history costs; `versionBytes` is an approximate character count; disk usage differs. */
const CodexRevisionHistoryUsageSchema = z.strictObject({
  versionCount: z.number().int().min(0),
  versionBytes: z.number().int().min(0)
});
export type CodexRevisionHistoryUsage = Wire<z.infer<typeof CodexRevisionHistoryUsageSchema>>;
export const CodexRevisionHistorySchema = CodexRevisionHistorySettingsSchema.extend(
  CodexRevisionHistoryUsageSchema.shape
);
/** A preference stored server-side so it follows the GM across devices. */
export const CodexAutosaveSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  intervalSeconds: z.number().min(1).max(600)
});
export type CodexAutosaveSettings = Wire<z.infer<typeof CodexAutosaveSettingsSchema>>;
export const CodexSettingsSchema = z.strictObject({
  revisionHistory: CodexRevisionHistorySchema,
  autosave: CodexAutosaveSettingsSchema
});
export type CodexSettings = Wire<z.infer<typeof CodexSettingsSchema>>;
/** The writable half, sent whole: usage figures are server facts. */
export type CodexSettingsInput = Readonly<{
  revisionHistory: CodexRevisionHistorySettings;
  autosave: CodexAutosaveSettings;
}>;

// ----- Calendar check (GM-only): what a calendar change would move in front of players -----

/** A revealed dated record a proposed calendar would move: its date resolves to another day, or a deadline players
 *  saw pass would read as approaching again. */
export const CodexCalendarMoveSchema = z.strictObject({
  kind: z.enum(["page", "journal"]),
  id: z.uuid(),
  /** The page's title, or the start of the journal entry's player text, else its kind. */
  title: z.string(),
  /** The date as players read it now, and as they would. */
  before: z.string(),
  after: z.string(),
  unpasses: z.boolean()
});
export type CodexCalendarMove = Wire<z.infer<typeof CodexCalendarMoveSchema>>;

// ----- The reveal audit (GM-only): what the player projections currently emit -----

/** `id` is what the kind's reveal route takes, which for `standing` is the faction page id. The `date` row's
 *  routes are the calendar's publish and unpublish, which take none. */
export const CodexRevealAuditRowSchema = z.strictObject({
  kind: CodexRevealAuditKindSchema,
  id: z.union([z.uuid(), z.literal("published-date")]),
  title: z.string(),
  /** Set on `journal` rows only, since `title` is the record's prose and cannot identify its kind. */
  journalKind: CodexJournalKindSchema.nullable()
});
export type CodexRevealAuditRow = Wire<z.infer<typeof CodexRevealAuditRowSchema>>;
/** Always present: `revealed: 0` and no rows when the party can see none of it. */
export const CodexRevealAuditSectionSchema = z.strictObject({
  kind: CodexRevealAuditKindSchema,
  revealed: z.number().int().min(0),
  /** How many exist at all. */
  total: z.number().int().min(0),
  rows: z.array(CodexRevealAuditRowSchema)
});
export type CodexRevealAuditSection = Wire<z.infer<typeof CodexRevealAuditSectionSchema>>;
export const CodexRevealAuditSchema = z.strictObject({
  sections: z.array(CodexRevealAuditSectionSchema),
  revealed: z.number().int().min(0),
  total: z.number().int().min(0)
});
export type CodexRevealAudit = Wire<z.infer<typeof CodexRevealAuditSchema>>;

// ----- Assets and backup -----

/** An uploaded Codex image. */
export const CodexAssetSchema = z.strictObject({
  id: z.uuid(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  mediaType: z.string()
});
export type CodexAsset = Wire<z.infer<typeof CodexAssetSchema>>;

const count = () => z.number().int().min(0);
/** The database's own row counts after a restore, never the bundle's claims. */
export const CodexImportCountsSchema = z.strictObject({
  pages: count(),
  folders: count(),
  maps: count(),
  markers: count(),
  journal: count(),
  /** Declared connections only; mentions are rebuilt from body text. */
  connections: count(),
  sessions: count(),
  quests: count(),
  standing: count(),
  revisions: count()
});
export type CodexImportCounts = Wire<z.infer<typeof CodexImportCountsSchema>>;
