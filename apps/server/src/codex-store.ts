import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CODEX_ENTITY_TYPES, CODEX_SECRET_FIELD_KEYS, pruneCodexFields, type CodexEntityType as DomainCodexEntityType
} from "@vtt/domain";

/**
 * Worldbuilding / campaign-codex persistence: freeform two-layer wiki pages, a nested map tree with
 * markers, and a campaign journal. Lives in its own tables inside the shared game database, mutated
 * through GM-gated REST routes (`codex-http.ts`) - NOT the GameState broadcast. GameState stays small
 * and hot; the codex is fetched on demand and every write only bumps a coarse `codexRevision` used to
 * ping clients to refetch (`codex:changed`) and to ETag list reads.
 *
 * Viewer-safety note: this store returns RAW rows (both `playerBody` and `gmBody`). Stripping the
 * GM-only half for players happens in `codex-projections.ts`, the single audited boundary - never here.
 */

/**
 * A page's worldbuilding entity type. `note` is a plain page; the rest carry structured `fields`.
 * Re-exported from `@vtt/domain` rather than re-declared: the type list, the field keys per type and
 * the secret-key set are one table now, so the GM UI and this store cannot drift apart.
 */
export type CodexEntityType = DomainCodexEntityType;
export const ENTITY_TYPES: readonly CodexEntityType[] = CODEX_ENTITY_TYPES;

export type CodexPageRow = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  /** Structured, type-specific attributes (key -> value); player-facing when the page is revealed. */
  fields: Readonly<Record<string, string>>;
  /** GM-only structured attributes (secret motives etc.); NEVER projected to players, like `gmBody`. */
  gmFields: Readonly<Record<string, string>>;
  folder: string | null;
  tags: readonly string[];
  playerBody: string;
  gmBody: string;
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  /**
   * CT-11 dating, the SAME contract journal entries use (see `CodexJournalRow` below and `resolveDate`):
   * `inWorldDate` is the literal date the GM typed and is the source of truth; `calendarInstant` and
   * `inWorldLabel` are DERIVED from it and recomputed by `setCalendar`. Only an `event` page joins the
   * chronicle, but the columns live on every page so switching a page's type away and back is lossless.
   */
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexPageSummaryRow = Omit<CodexPageRow, "playerBody" | "gmBody" | "gmFields">;

/** A directional typed relationship between two pages (Strahd --rules--> Barovia). */
export type CodexRelationshipRow = Readonly<{ id: string; fromPageId: string; toPageId: string; type: string; createdAt: string }>;
/** A relationship as listed against one page: the OTHER endpoint resolved, with the edge direction. */
export type CodexRelationshipView = Readonly<{ id: string; type: string; direction: "out" | "in"; otherPageId: string; otherTitle: string; otherType: CodexEntityType; otherRevealed: boolean }>;

export type CodexLinkRow = Readonly<{
  sourcePageId: string;
  layer: "player" | "gm";
  targetKind: CodexLinkTargetKind;
  targetRef: string;
  section: string | null;
}>;
export type CodexLinkTargetKind = "page" | "actor" | "monster" | "spell" | "map" | "marker";

/**
 * CI-8: one `[[wiki link]]` edge between two PAGES, for the whole-graph feed. Carries `layer` because a
 * player edge may only come from a page's player-facing body - the projection decides, not this row.
 */
export type CodexLinkEdgeRow = Readonly<{ fromPageId: string; toPageId: string; layer: "player" | "gm" }>;

export type CodexPageRevisionRow = Readonly<{
  id: number;
  pageId: string;
  rev: number;
  title: string;
  playerBody: string;
  gmBody: string;
  bannerAssetId: string | null;
  tags: readonly string[];
  authoredAt: string;
  authorTag: string;
}>;

/**
 * A revision as the BACKUP BUNDLE carries it: the wire row plus the three snapshot columns `restoreRevision`
 * needs and `GET /codex/pages/{id}/revisions` does not send (see `listAllRevisions` for why the endpoint's
 * row cannot simply grow). A superset, never a parallel shape - one mapper produces the shared part.
 */
export type CodexPageRevisionExportRow = CodexPageRevisionRow & Readonly<{
  entityType: CodexEntityType;
  fields: Readonly<Record<string, string>>;
  gmFields: Readonly<Record<string, string>>;
}>;

/**
 * OWNER DECISION (2026-07-30): how much version history the codex keeps.
 *
 * `codex_page_revisions` was UNBOUNDED - every page save wrote a row, nothing pruned, and a revision row
 * weighs the same as a page row (both bodies). Measured while completing the export bundle: 200 pages x 15
 * revisions exported 20.8 MB against 1.24 MB without the history. The owner's answer was two knobs, and the
 * distinction between them is load-bearing:
 *
 *  - `enabled: false` writes NO new revisions at all. It never deletes what exists - disabling a feature must
 *    not destroy the GM's only undo - so old revisions stay listable and restorable with the switch off.
 *  - `windowMinutes` COALESCES: a save whose page already has a checkpoint younger than this writes no new
 *    one. **`0` is not "off"** - it means "checkpoint every save", i.e. exactly today's behaviour - and
 *    conflating the two would take the old behaviour away from a GM who asks for it by name.
 *
 * The owner's default is 90, chosen so "at most, 90 minutes of work could be lost".
 */
export type CodexRevisionSettings = Readonly<{ enabled: boolean; windowMinutes: number }>;
/**
 * What the kept history actually COSTS - read-only and server-computed, so the GM can answer "is my history
 * worth trimming?" on the same screen that holds the knobs and the delete.
 *
 * Deliberately APPROXIMATE, and the imprecision is the point: `versionBytes` is the summed `LENGTH()` of the
 * text this table stores, not disk usage and not the export's serialized size. A figure precise enough to
 * invite comparison against the sqlite file's size would be a figure that disagrees with it. It is rendered as
 * "about 8.0 MB of text".
 */
export type CodexRevisionHistoryUsage = Readonly<{ versionCount: number; versionBytes: number }>;
/** The revision-history section as a READER sees it: the two settable knobs plus what the history costs. */
export type CodexRevisionHistory = CodexRevisionSettings & CodexRevisionHistoryUsage;
/**
 * D6: "the Codex always keeps your work" made configurable. Two knobs, and the split is the same one
 * `CodexRevisionSettings` makes: `enabled` is whether the editors autosave at all, `intervalSeconds` is how
 * often they do it when they do.
 *
 * **The unit is SECONDS because the wire says seconds** (director ruling R4) - the column, this type and the
 * request body all agree, so nothing converts at a boundary and nothing can convert twice. The floor of 1 is
 * what today's 800 ms page-editor debounce maps onto, so an upgraded codex keeps effectively today's cadence.
 *
 * The server stores a PREFERENCE and nothing more. Autosave is editor behaviour: enforcement (explicit Save
 * and unsaved-changes warnings when it is off) lives in the client, because there is no server-side draft to
 * save. Storing it here is what makes the preference follow the GM from phone to laptop.
 */
export type CodexAutosaveSettings = Readonly<{ enabled: boolean; intervalSeconds: number }>;
/**
 * Every codex-wide setting, nested by area. `codex_meta` is the codex's singleton settings row, so this is
 * the shape of that row as a caller sees it; the `revisionHistory` nesting is what gives a later codex-wide
 * setting a home without inventing fields for it today.
 */
export type CodexSettings = Readonly<{ revisionHistory: CodexRevisionHistory; autosave: CodexAutosaveSettings }>;
/**
 * The WRITABLE half, and the reason the read and write shapes are two types rather than one: `versionCount` /
 * `versionBytes` are facts about a table the caller cannot see, so a body that could carry them would be a
 * client asserting them. They are absent here by construction, not filtered out later.
 *
 * `autosave` has no read-only half at all, so it is the SAME type on both sides - stated rather than mirrored,
 * because a second identical type is the one that drifts.
 */
export type CodexSettingsInput = Readonly<{ revisionHistory: CodexRevisionSettings; autosave: CodexAutosaveSettings }>;

export type CodexBacklinkRow = Readonly<{
  sourcePageId: string;
  sourceTitle: string;
  sourceRevealed: boolean;
  layer: "player" | "gm";
  section: string | null;
}>;

/**
 * The record kinds the ONE suite-wide search index carries (CI-1 / R8). Adding a kind here is a
 * viewer-safety change, and it takes THREE gates, not two. This comment listed only the last two
 * until M10; the missing one is the easiest of the three to get wrong, because nothing downstream
 * can compensate for it:
 *
 *  1. INDEX TEXT - the `index*` twin that writes this kind's rows must put ONLY player-layer text in
 *     `codex_search_player`. A `gm_body` that reaches the player table makes a player's query on a
 *     GM-only phrase MATCH; the hit's existence is the leak even though the body is never returned,
 *     and gates 2 and 3 both pass it, because the record really is revealed and really did match.
 *  2. `PLAYER_VISIBLE_SQL` below - one arm per kind, copied from that kind's player LIST endpoint.
 *  3. `projectPlayerSearchHit` - one branch per kind, copied from the same place.
 *
 * Gates 2 and 3 are belt and braces for each other (either alone hides an unrevealed record), which
 * is why each needs a test at ITS OWN layer - see the CI-1 describe blocks in `codex-store.test.ts`.
 * Gate 1 has no second line of defence at all.
 */
export type CodexRecordKind = "page" | "journal" | "map" | "marker" | "quest" | "session";
export const CODEX_RECORD_KINDS: readonly CodexRecordKind[] = ["page", "journal", "map", "marker", "quest", "session"];
/** One search hit as the store returns it: what kind of record matched, and which one. */
export type CodexSearchRef = Readonly<{ kind: CodexRecordKind; id: string }>;
/**
 * D19: a bounded search answer that SAYS it is bounded. The codex is unpaginated by design at LAN scale,
 * which is honest only while the caller can tell a complete list from a truncated one - `truncated` is that
 * difference, and it is measured by asking the database for one row more than the cap rather than by
 * comparing the returned length against it (which can never distinguish "exactly 50" from "50 and more").
 */
export type CodexSearchResult = Readonly<{ hits: readonly CodexSearchRef[]; truncated: boolean }>;
/** The one shared cap for every kind on the ONE search index. See `searchOrderBySql` for what it costs. */
const SEARCH_LIMIT = 50;

export type CodexMapKind = "battlemap" | "regional" | "world";
export type CodexMapRow = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: CodexMapKind;
  parentMapId: string | null;
  revealedToPlayers: boolean;
  sortKey: number;
  /** CI-2: the same tag vocabulary pages carry. */
  tags: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
export type CodexMarkerLinks = Readonly<{ pageIds: string[]; subMapId: string | null; sceneIds: string[]; actorId: string | null }>;
export type CodexMarkerRow = Readonly<{
  id: string;
  mapId: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  revealedToPlayers: boolean;
  /** CI-2: the same tag vocabulary pages carry. */
  tags: readonly string[];
  /**
   * CT-7 / M12-C: this pin is where the party is, and **at most one marker in the whole atlas** carries
   * it (migration v16's partial unique index is the file's half of that rule, `setPartyMarker` the
   * process's half).
   *
   * A FLAG on an ordinary marker rather than a marker of its own: the party pin is moved, linked,
   * labelled, tagged, revealed and deleted by exactly the paths every other pin uses, so there is one
   * marker projection and one visibility gate rather than two. It is player-visible on purpose - the
   * party pin is FOR the players - but it grants no visibility: a party pin that is hidden, or that sits
   * on a hidden map, stays hidden, because `isParty` is not part of any reveal predicate anywhere.
   */
  isParty: boolean;
} & CodexMarkerLinks & { createdAt: string; updatedAt: string }>;

export type CodexMapCreateInput = Readonly<{ assetId: string; name: string; kind: CodexMapKind; parentMapId?: string | null; revealedToPlayers?: boolean; tags?: readonly string[] }>;
export type CodexMarkerCreateInput = Readonly<{ x: number; y: number; iconId: string; iconColor: string; label?: string | null; revealedToPlayers?: boolean; pageIds?: readonly string[]; subMapId?: string | null; sceneIds?: readonly string[]; actorId?: string | null; tags?: readonly string[] }>;
export type CodexMarkerUpdateInput = Partial<CodexMarkerCreateInput>;

/** The world's calendar: ordered months (each with a length), weekday names, and an era suffix. */
export type CodexCalendarMonth = Readonly<{ name: string; days: number }>;
/** The world's calendar; `currentDate` is the campaign's "now" (a Today marker on the timeline), optional. */
export type CodexCalendar = Readonly<{ yearName: string; months: readonly CodexCalendarMonth[]; weekdays: readonly string[]; currentDate?: CodexInWorldDate | null }>;
/** A structured in-world date (month is a 0-based index into the calendar's months). */
export type CodexInWorldDate = Readonly<{ year: number; month: number; day: number }>;

const DEFAULT_CALENDAR: CodexCalendar = {
  yearName: "",
  months: [
    { name: "Deepwinter", days: 30 }, { name: "The Claw", days: 30 }, { name: "Melting", days: 30 },
    { name: "Greengrass", days: 30 }, { name: "Mirtul", days: 30 }, { name: "Flamerule", days: 30 },
    { name: "Highsun", days: 30 }, { name: "Harvest", days: 30 }, { name: "Fading", days: 30 },
    { name: "Leaffall", days: 30 }, { name: "The Rotting", days: 30 }, { name: "Deadwinter", days: 30 }
  ],
  weekdays: ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"]
};

/**
 * M11 (CT-5 / CT-10) widened the journal's kinds from two to four; M12 (CT-6 / CT-8) takes it to six and
 * the DATABASE needs no migration to accept them - v15 rebuilt the CHECK with all six precisely so this
 * one word each could be added without a second rebuild (see v16's comment).
 *
 * The two halves are now in agreement for the first time since M11. That is the ONLY change here: the DB
 * being more permissive than this union is still the safe direction, and `journalKind` still fails closed,
 * so a seventh kind written by a future build reads back as `note` rather than throwing.
 */
export type CodexJournalKind = "note" | "combat" | "deadline" | "downtime" | "milestone" | "standing";
/**
 * CT-10's downtime activity: WHO spent WHICH days doing WHAT, and whether the GM has confirmed the clock
 * move it proposes (O-3).
 *
 * What is deliberately NOT here:
 *  - `outcome`. It is prose, and this record already has two prose layers with a reveal split between them
 *    (`playerText` / `gmText`). A third prose channel inside a JSON blob would sit outside that split, which
 *    is exactly the leak shape K1 forbids.
 *  - anything a deadline would need. A deadline stores NO payload at all (D11-C): its text IS the "what",
 *    and its own `inWorldDate` IS the target date. Two dates for one record is what K3 exists to prevent.
 *
 * `applied` is real state, not a derived value: "has the GM confirmed?" cannot be computed from anything
 * else, and it is what makes `applyDowntime` idempotent. It is GM workflow state and must never be
 * projected to a player (D11-E).
 */
export type CodexDowntimePayload = Readonly<{
  who: string;
  activity: string;
  days: number;
  applied: boolean;
  /**
   * D12: WHICH character page this downtime belongs to, so the tracker can total a character's days and
   * link to their sheet rather than grouping on a free-text name that two GMs spell two ways.
   *
   * `who` is NOT replaced by it and both may coexist: the free-text name is the fallback for a character
   * with no page, and it is what an old row shows after this field arrives null. Nothing is required to
   * have a page - a GM tracking downtime for a hireling should not have to make one first.
   *
   * A plain id with no foreign key behind it, the `factionPageId` precedent: history must survive the page.
   * `deletePage` scrubs it to null so it cannot render as an unfollowable link, and `who` survives as the
   * display fallback - which is strictly more than the marker-scrub precedent requires.
   */
  characterPageId: string | null;
}>;
/**
 * CT-8's progression record: the party reached LEVEL n, and WHY.
 *
 * `level` is the level reached, not a delta, because that is the fact a GM states and the one a reader
 * wants ("we hit 5 after the crypt"). A delta would make the current level a sum over the whole timeline
 * that a single deleted record silently changes. Standing is the opposite (see below) and the difference
 * is deliberate: standing has a TABLE holding where things stand, so its records carry the change;
 * a level has no table, so its records carry the state.
 *
 * `reason` is the one prose channel that does NOT get a reveal split, so it must be safe for whoever the
 * record is revealed to. It is short, single-line prose ("cleared the crypt"); a milestone that needs a
 * GM-only half has `gmText` for it, exactly like every other journal record.
 */
export type CodexMilestonePayload = Readonly<{ level: number; reason: string }>;
/**
 * CT-6's standing record: what CHANGED and why. The `codex_standing` table says where things stand; this
 * says what happened. Storing the new value here as well would be a second copy of the same fact, and the
 * copy that goes stale first - deleting a record would leave a history that no longer adds up to the table.
 *
 * `delta` is therefore the change, never the resulting value (spec §2.2). `factionPageId` is a plain id
 * with no foreign key behind it: deleting a faction page cascades its STANDING ROW away but must leave its
 * history standing, because "the Harpers turned on us in Marpenoth" remains true after the page is gone.
 * Readers resolve the id defensively (a missing page is a name they cannot show, not an error).
 */
export type CodexStandingPayload = Readonly<{ factionPageId: string; delta: number; reason: string }>;
/**
 * Every payload the journal can carry, keyed by the `kind` that owns it - `downtime` -> `CodexDowntimePayload`,
 * `milestone` -> `CodexMilestonePayload`, `standing` -> `CodexStandingPayload`, and nothing at all for the
 * other three. `toEntry` is the ONE place that mapping is written, and it reads the stored blob only for
 * the kind that owns it, so a hand-edited or future-version row can never smuggle one kind's payload onto
 * another kind's record.
 *
 * A UNION rather than a discriminated `CodexJournalRow` per kind, and that is a deliberate, stated
 * limitation: TypeScript would then narrow `payload` from `kind`, which is genuinely better, but it makes
 * `CodexJournalRow` a union that `Partial<>`, object spreads and `{ ...row, kind }` all stop accepting -
 * and those appear in the projection layer and its tests, which M12 does not own. Use `payloadFor*` below
 * to narrow; they are the type-safe form of the same question and they cannot get the kind wrong.
 */
export type CodexEntryPayload = CodexDowntimePayload | CodexMilestonePayload | CodexStandingPayload;
export type CodexJournalRow = Readonly<{
  id: string;
  playerText: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  attachMarkerId: string | null;
  attachPageId: string | null;
  kind: CodexJournalKind;
  sourceEncounterId: number | null;
  /**
   * D9: the session this entry belongs to, BY IDENTITY. Null when the entry is filed under no session.
   * This is what a writer sets; `sessionNumber` below is what a reader displays.
   */
  sessionId: string | null;
  /**
   * The session's number as a DISPLAY value, resolved live from the joined session - so renumbering a
   * session updates every one of its entries with no journal write at all (the whole point of D9).
   *
   * It falls back to the bare label stored on the row, which after migration v19 exists in exactly one
   * circumstance: `deleteSession` stamped a REVEALED session's number back onto its entries when the record
   * went (director ruling R2). A hidden session's delete stamps nothing, so no label a player can see ever
   * names a record they have not been shown.
   */
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  /** The literal date the GM entered (independent of the calendar config), so instants can be recomputed if the calendar changes. */
  inWorldDate: CodexInWorldDate | null;
  sortKey: number;
  /** CI-2: the same tag vocabulary pages carry. */
  tags: readonly string[];
  /** M11/M12: kind-specific structured data. `null` for every kind but `downtime`, `milestone`, `standing`. */
  payload: CodexEntryPayload | null;
  createdAt: string;
  updatedAt: string;
}>;
/**
 * D9: writers name a session by ID, never by number. `sessionId` OMITTED on a create auto-files the entry
 * under the active session; an explicit `null` files it under none; an id that names no session is a
 * not-found. There is no bare-number write arm at all - the number is a display value the server resolves.
 */
export type CodexJournalCreateInput = Readonly<{ playerText?: string; gmText?: string | null; revealedToPlayers?: boolean; attachMarkerId?: string | null; attachPageId?: string | null; sessionId?: string | null; realDate?: string | null; inWorldLabel?: string | null; inWorldDate?: CodexInWorldDate | null; tags?: readonly string[] }>;
export type CodexJournalUpdateInput = CodexJournalCreateInput;
/** CT-10: what `createDowntime` needs beyond an ordinary entry. `applied` is not an input - it starts false. */
export type CodexDowntimeCreateInput = CodexJournalCreateInput & Readonly<{ downtime: Readonly<{ who: string; activity: string; days: number; characterPageId?: string | null }> }>;
/** CT-8: what `createMilestone` needs beyond an ordinary entry - `CodexDowntimeCreateInput`'s shape verbatim. */
export type CodexMilestoneCreateInput = CodexJournalCreateInput & Readonly<{ milestone: Readonly<{ level: number; reason: string }> }>;

/**
 * CT-6: where the party stands with ONE faction. The whole record is four facts, and what is NOT here is
 * the point:
 *
 *  - No history. Every change writes a `kind='standing'` chronicle record instead (spec §2.1), so the
 *    timeline is the one history in this codex rather than the second one.
 *  - No `rev`. There is no editor behind a standing - it is a number and a reason, set in one action -
 *    so there is no draft to go stale and nothing for a conflict token to protect.
 *  - No cached faction TITLE. `faction_page_id` resolves to the live page; a copied name would be the
 *    thing that goes stale the first time the GM renames the faction.
 *
 * `value` is SIGNED, -100..100, because a faction can be actively against the party and an unsigned
 * "favour" scale cannot say so (M12-B). The WORD a reader shows beside it (`Hostile` ... `Allied`) is a
 * presentation of this number and is deliberately not stored: two representations of one fact is one of
 * them being wrong after the next edit.
 */
export type CodexStandingRow = Readonly<{
  id: string;
  factionPageId: string;
  /** -100 (Hostile) .. +100 (Allied), 0 = Neutral. Clamped on the way in by `standingValue`. */
  value: number;
  /** O-2 / P2: a standing starts hidden. Players may or may not know where they stand. */
  revealedToPlayers: boolean;
  createdAt: string;
  updatedAt: string;
}>;
export type CodexCombatEntryInput = Readonly<{ sourceEncounterId: number; attachMarkerId?: string | null; attachPageId?: string | null; playerText: string; gmText?: string | null; revealedToPlayers?: boolean }>;

/**
 * CT-11 / CT-12: one record on the ONE chronicle, still in its own store shape.
 *
 * Deliberately a discriminated union of RAW rows rather than a pre-flattened row: this store returns raw
 * records and `codex-projections.ts` is the single audited place that decides what each audience may see
 * (see the file header). Flattening here would put half the projection in the store, where nothing audits
 * it. The flat, one-shape-per-row form (R2) is `Gm/PlayerCodexChronicleRecord` in the projections module.
 */
export type CodexChronicleRecord =
  | Readonly<{ kind: "entry"; entry: CodexJournalRow }>
  | Readonly<{ kind: "event"; page: CodexPageRow }>;

/**
 * M9: one real-world SESSION at the table. Two-layer exactly as a page is - `prepBody` is the GM's plan
 * and never enters a player projection, `recapBody` is the players' half and ships once `revealed`.
 *
 * `revealedToPlayers` matches every other codex record type. The SQL column stays `revealed`, exactly as
 * `codex_pages` does - the column is terse because its table names the subject, the field is explicit
 * because a row type does not.
 *
 * `sessionNumber` is nullable and UNIQUE-when-present (migration v13): the by-session lens resolves a
 * number to at most one record, and an unnumbered session is still a legitimate record.
 */
export type CodexSessionStatus = "planned" | "played";
export type CodexSessionRow = Readonly<{
  id: string;
  sessionNumber: number | null;
  /** The real-world date the group met ("2026-07-26"), free text - the calendar is the IN-WORLD one. */
  realDate: string | null;
  attendees: readonly string[];
  /** GM-only. The single most important secret on this record: never projected to a player. */
  prepBody: string;
  /** The player-facing half, gated by `revealedToPlayers` - the recap the table reads before the next session. */
  recapBody: string;
  revealedToPlayers: boolean;
  status: CodexSessionStatus;
  /** D10 / CI-2: the same single-layer tag vocabulary every other codex record carries. */
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexSessionCreateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  revealedToPlayers?: boolean;
  status?: CodexSessionStatus;
  tags?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own endpoint and its own recency rule, exactly as `CodexPageUpdateInput` omits it. */
export type CodexSessionUpdateInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  status?: CodexSessionStatus;
  tags?: readonly string[];
}>;

/**
 * M10: a QUEST - "what is still open". Two-layer exactly as a page and a session are: `gmBody` is the
 * GM's own notes on where this is really going and never enters a player projection, `playerBody` is
 * what the party has been told, gated by `revealedToPlayers`.
 *
 * `revealedToPlayers` on the row, `revealed` as the SQL column, exactly like every other codex record
 * type (M9 had to be corrected for getting this pair the other way round).
 *
 * Two things make this the first record of its shape in the codex:
 *  - `objectives` is an ORDERED MUTABLE LIST, the first one here. Its order is CONTENT, not incidental -
 *    see `questObjectives`.
 *  - `status` is the first enum a DASHBOARD queries rather than merely displays, which is what the
 *    `codex_quests_status` index in migration v14 is for.
 */
export type CodexQuestStatus = "active" | "completed" | "failed";
/**
 * One line on the quest's checklist. Deliberately nothing richer than `{ text, done }`: the M10 spec's
 * escalation clause makes a shape beyond this unapproved scope, so assignees / due dates / sub-quests
 * are a later decision rather than an unreviewed field that arrives with the first implementation.
 */
export type CodexQuestObjective = Readonly<{ text: string; done: boolean }>;
export type CodexQuestRow = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  /** The player-facing half, gated by `revealedToPlayers` - what the party has actually been told. */
  playerBody: string;
  /** GM-only. Where this quest is really going; never projected to a player. */
  gmBody: string;
  /** ORDERED. The GM's sequence is the meaning; nothing sorts, dedupes, or re-keys this. */
  objectives: readonly CodexQuestObjective[];
  /** Codex PAGE ids this quest concerns (via the client's `EntityPicker`), filtered on the way to a player. */
  entityIds: readonly string[];
  revealedToPlayers: boolean;
  /** D10 / CI-2: the same single-layer tag vocabulary every other codex record carries. */
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexQuestCreateInput = Readonly<{
  title: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  gmBody?: string;
  objectives?: readonly CodexQuestObjective[];
  entityIds?: readonly string[];
  revealedToPlayers?: boolean;
  tags?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own endpoint and its own recency rule, exactly as `CodexSessionUpdateInput` omits it. */
export type CodexQuestUpdateInput = Readonly<{
  title?: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  gmBody?: string;
  objectives?: readonly CodexQuestObjective[];
  entityIds?: readonly string[];
  tags?: readonly string[];
}>;

export type CodexPageCreateInput = Readonly<{
  title: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  gmFields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
  /** CT-11: the raw in-world date. `null` clears it; omitted leaves it alone (the journal's contract exactly). */
  inWorldDate?: CodexInWorldDate | null;
}>;

export type CodexPageUpdateInput = Readonly<{
  title?: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  gmFields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  bannerAssetId?: string | null;
  inWorldDate?: CodexInWorldDate | null;
}>;

/** Thrown when an update's `expectedRev` does not match the stored row - the client's page is stale. */
export class CodexRevisionConflictError extends Error {}
/** Thrown when a referenced page/map/marker does not exist. */
export class CodexNotFoundError extends Error {}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /\p{Cc}/u;
const MAX_BODY = 100_000;
const MAX_TAGS = 24;

export const MIGRATIONS = [{
  version: 1,
  sql: `
    CREATE TABLE codex_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      codex_revision INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE codex_pages (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      folder TEXT,
      tags_json TEXT NOT NULL,
      player_body TEXT NOT NULL,
      gm_body TEXT NOT NULL,
      revealed INTEGER NOT NULL,
      banner_asset_id TEXT,
      rev INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE codex_page_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      rev INTEGER NOT NULL,
      title TEXT NOT NULL,
      player_body TEXT NOT NULL,
      gm_body TEXT NOT NULL,
      banner_asset_id TEXT,
      tags_json TEXT NOT NULL,
      authored_at TEXT NOT NULL,
      author_tag TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_page_revisions_page ON codex_page_revisions (page_id, rev DESC);
    CREATE TABLE codex_links (
      source_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('player', 'gm')),
      target_kind TEXT NOT NULL CHECK (target_kind IN ('page', 'actor', 'monster', 'spell', 'map', 'marker')),
      target_ref TEXT NOT NULL,
      section TEXT
    ) STRICT;
    CREATE INDEX codex_links_target ON codex_links (target_kind, target_ref);
    CREATE INDEX codex_links_source ON codex_links (source_page_id);
    CREATE TABLE codex_maps (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('battlemap', 'regional', 'world')),
      parent_map_id TEXT REFERENCES codex_maps(id) ON DELETE SET NULL,
      revealed INTEGER NOT NULL,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_maps_parent ON codex_maps (parent_map_id);
    CREATE TABLE codex_markers (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL REFERENCES codex_maps(id) ON DELETE CASCADE,
      x REAL NOT NULL,
      y REAL NOT NULL,
      icon_id TEXT NOT NULL,
      icon_color TEXT NOT NULL,
      label TEXT,
      revealed INTEGER NOT NULL,
      page_id TEXT,
      sub_map_id TEXT,
      scene_id TEXT,
      actor_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_markers_map ON codex_markers (map_id);
    CREATE INDEX codex_markers_page ON codex_markers (page_id);
    CREATE TABLE codex_journal (
      id TEXT PRIMARY KEY,
      player_text TEXT NOT NULL,
      gm_text TEXT,
      revealed INTEGER NOT NULL,
      attach_marker_id TEXT,
      attach_page_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('note', 'combat')),
      source_encounter_id INTEGER,
      session_number INTEGER,
      real_date TEXT,
      in_world_label TEXT,
      calendar_instant INTEGER,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at);
    CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id);
    CREATE INDEX codex_journal_page ON codex_journal (attach_page_id);
  `
}, {
  version: 2,
  sql: `
    CREATE VIRTUAL TABLE codex_fts_player USING fts5(page_id UNINDEXED, title, body);
    CREATE VIRTUAL TABLE codex_fts_gm USING fts5(page_id UNINDEXED, title, body);
  `
}, {
  version: 3,
  sql: `
    ALTER TABLE codex_pages ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'note';
    ALTER TABLE codex_pages ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE codex_page_revisions ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'note';
    ALTER TABLE codex_page_revisions ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
    CREATE TABLE codex_relationships (
      id TEXT PRIMARY KEY,
      from_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      to_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_rel_from ON codex_relationships (from_page_id);
    CREATE INDEX codex_rel_to ON codex_relationships (to_page_id);
  `
}, {
  version: 4,
  sql: `ALTER TABLE codex_meta ADD COLUMN calendar_json TEXT;`
}, {
  version: 5,
  sql: `
    ALTER TABLE codex_pages ADD COLUMN gm_fields_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE codex_page_revisions ADD COLUMN gm_fields_json TEXT NOT NULL DEFAULT '{}';
  `
}, {
  version: 6,
  sql: `
    ALTER TABLE codex_journal ADD COLUMN in_world_year INTEGER;
    ALTER TABLE codex_journal ADD COLUMN in_world_month INTEGER;
    ALTER TABLE codex_journal ADD COLUMN in_world_day INTEGER;
  `
}, {
  version: 7,
  // Seal pre-existing secret fields: a page created when `goals` was a plain public field still holds it
  // in fields_json (leaks on reveal). Move it into gm_fields_json. Keep in sync with SECRET_FIELD_KEYS.
  sql: `
    UPDATE codex_pages
    SET gm_fields_json = json_set(COALESCE(gm_fields_json, '{}'), '$.goals', json_extract(fields_json, '$.goals')),
        fields_json = json_remove(fields_json, '$.goals')
    WHERE fields_json IS NOT NULL AND json_extract(fields_json, '$.goals') IS NOT NULL;
  `
}, {
  version: 8,
  // Markers link to MANY pages + MANY scenes: add JSON id-array columns, backfilling the single page_id/
  // scene_id into one-element arrays. The old single columns become dormant (kept, no longer read/written).
  sql: `
    ALTER TABLE codex_markers ADD COLUMN page_ids_json TEXT;
    ALTER TABLE codex_markers ADD COLUMN scene_ids_json TEXT;
    UPDATE codex_markers SET
      page_ids_json = CASE WHEN page_id IS NOT NULL THEN json_array(page_id) ELSE '[]' END,
      scene_ids_json = CASE WHEN scene_id IS NOT NULL THEN json_array(scene_id) ELSE '[]' END;
  `
}, {
  version: 9,
  // Folders become first-class records so an empty folder persists (before this, folders lived ONLY in page
  // paths, so moving the last note out erased the folder). The tree unions these records with page paths;
  // pages still carry their own `folder` path - a record is just what keeps an empty folder on screen.
  sql: `
    CREATE TABLE codex_folders (path TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    INSERT OR IGNORE INTO codex_folders (path, created_at)
      SELECT DISTINCT folder, '' FROM codex_pages WHERE folder IS NOT NULL AND folder != '';
  `
}, {
  version: 10,
  // CI-2: tags stop being a pages-only idea. Maps, markers and journal entries each gain the same
  // `tags_json` column pages already carry, so one vocabulary describes every record type (and, from
  // CI-1, one search matches across all of them). Existing rows backfill to an empty array — a NOT NULL
  // column with a default, so no read path has to cope with NULL.
  sql: `
    ALTER TABLE codex_maps ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE codex_markers ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE codex_journal ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
  `
}, {
  version: 11,
  // CI-1 / R8 ("one search box, one result list, all record types"). Search stops being a pages-only
  // idea: ONE unified index per audience carries every record kind, tagged with `kind` beside the id.
  // Deliberately not four indexes unioned at query time - a second parallel search mechanism is exactly
  // the root cause this overhaul exists to remove, and it would give journal/marker/map search its own
  // visibility rules to drift away from the page ones.
  //
  // The old pages-only tables are BACKFILLED verbatim (so existing page search is bit-for-bit what it
  // was) and then DROPPED, so there is one index and one sync path, not two to keep in step. Nothing
  // outside this file ever read them.
  //
  // Two layers, exactly the page precedent: the player table receives ONLY player-layer text; the GM
  // table receives both. Reveal state is NOT baked in - it is resolved against the live row at read
  // time (see `searchAll`), so toggling a reveal never needs a reindex.
  sql: `
    CREATE VIRTUAL TABLE codex_search_player USING fts5(kind UNINDEXED, record_id UNINDEXED, title, body);
    CREATE VIRTUAL TABLE codex_search_gm USING fts5(kind UNINDEXED, record_id UNINDEXED, title, body);

    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'page', f.page_id, f.title, f.body || char(10) || CASE WHEN json_valid(p.tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(p.tags_json)), '') ELSE '' END
      FROM codex_fts_player f JOIN codex_pages p ON p.id = f.page_id;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'page', f.page_id, f.title, f.body || char(10) || CASE WHEN json_valid(p.tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(p.tags_json)), '') ELSE '' END
      FROM codex_fts_gm f JOIN codex_pages p ON p.id = f.page_id;

    -- Maps and markers carry no GM-only TEXT (a name/label/tag set is single-layer), so both audiences
    -- index the same string; what separates them is the read-time reveal predicate, not the content.
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'map', id, name, CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_maps.tags_json)), '') ELSE '' END FROM codex_maps;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'map', id, name, CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_maps.tags_json)), '') ELSE '' END FROM codex_maps;
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'marker', id, COALESCE(label, ''), CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_markers.tags_json)), '') ELSE '' END FROM codex_markers;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'marker', id, COALESCE(label, ''), CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_markers.tags_json)), '') ELSE '' END FROM codex_markers;

    -- A journal entry DOES have two layers: gm_text is GM-only and must never enter the player table.
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'journal', id, '', player_text || char(10) || CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_journal.tags_json)), '') ELSE '' END FROM codex_journal;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'journal', id, '', player_text || char(10) || COALESCE(gm_text, '') || char(10) || CASE WHEN json_valid(tags_json) THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_journal.tags_json)), '') ELSE '' END FROM codex_journal;

    DROP TABLE codex_fts_player;
    DROP TABLE codex_fts_gm;
  `
}, {
  version: 12,
  // CT-11: an `event` page can carry an in-world DATE, so it takes its place on the one chronicle beside
  // the journal's entries. The columns are exactly the ones `codex_journal` already carries (migration
  // v1 + v6), deliberately named identically, because the dating CONTRACT is the same one: the raw
  // `in_world_{year,month,day}` the GM typed is the source of truth, and `calendar_instant` +
  // `in_world_label` are DERIVED from it by `resolveDate` and recomputed wholesale by `setCalendar`.
  // A second dating contract for pages would be a second thing to reflow and a second thing to get wrong.
  //
  // Additive with no backfill (K7): every existing page is NULL in all five, which is exactly "undated",
  // which is exactly today's behaviour. Nothing existing changes meaning.
  sql: `
    ALTER TABLE codex_pages ADD COLUMN in_world_year INTEGER;
    ALTER TABLE codex_pages ADD COLUMN in_world_month INTEGER;
    ALTER TABLE codex_pages ADD COLUMN in_world_day INTEGER;
    ALTER TABLE codex_pages ADD COLUMN in_world_label TEXT;
    ALTER TABLE codex_pages ADD COLUMN calendar_instant INTEGER;
    CREATE INDEX codex_pages_instant ON codex_pages (calendar_instant);
  `
}, {
  version: 13,
  // M9: a real-world SESSION becomes a record of its own - the GM's prep on one side, the players' recap
  // on the other - so "what are we doing on Sunday" and "what happened last time" stop being loose notes
  // scattered through the journal. Two-layer exactly as a page is: `prep_body` is the GM half and never
  // leaves `projectGmSession`; `recap_body` is the player half, gated by `revealed`.
  //
  // NO BACKFILL, deliberately (the K7 discipline v12 followed): a legacy journal entry already carries a
  // `session_number`, but inventing a session RECORD per distinct number would fabricate prep, recap and
  // attendance nobody wrote, and would guess at which numbers were real sessions. Existing numbered
  // entries therefore keep rendering exactly as they do today, grouped by a number with no record behind
  // it; a session record only exists once the GM makes one.
  //
  // The UNIQUE index is what makes the by-session lens's resolution TOTAL: a number maps to at most one
  // record, so "open session 4" is never ambiguous. An unnumbered session is still a legitimate state (a
  // one-shot, or a session drafted before the GM decides where it lands), and many may coexist.
  //
  // The `WHERE session_number IS NOT NULL` predicate is INTENT, not enforcement, and it is worth saying
  // so rather than implying otherwise: SQLite already treats NULLs as distinct in any UNIQUE index, so
  // repeated NULLs are permitted with or without it - verified by mutation, since a test cannot tell the
  // two apart. It is here because it states which rows the rule is about, and because it keeps the index
  // off every unnumbered row.
  //
  // `active_session_id` lives on `codex_meta` (`id INTEGER PRIMARY KEY CHECK (id = 1)`) so "exactly one
  // active session" is STRUCTURAL: there is one meta row, therefore one pointer, and no code path can
  // produce two. A `is_active` flag on `codex_sessions` would make it a convention that every write has
  // to remember to uphold. No FK to `codex_sessions(id)`: `deleteSession` clears the pointer itself, and
  // an FK would be a second, silent owner of that rule.
  //
  // `status` carries a CHECK the way every comparable v1 enum does (`codex_journal.kind`,
  // `codex_maps.kind`, `codex_links.layer`/`target_kind`). `sessionStatus()` already gates it in TS, but a
  // TS-only gate protects this process, not the file: anything that ever writes this database outside the
  // store - a repair script, a manual sqlite3 session - would be free to invent a third status that
  // `toSession` then silently coerces to "planned". The constraint is what makes the column honest.
  //
  // Ordering note: on a FRESH database this runs BEFORE `initialize()` seeds `codex_meta`, so nothing
  // here may assume a row exists. The ALTER alters the table, not a row, and the seed names its columns
  // (`INSERT INTO codex_meta (id, codex_revision)`), so the new column simply defaults to NULL - verified
  // against the running schema, not assumed.
  sql: `
    CREATE TABLE codex_sessions (
      id TEXT PRIMARY KEY,
      session_number INTEGER,
      real_date TEXT,
      attendees_json TEXT NOT NULL,
      prep_body TEXT NOT NULL,
      recap_body TEXT NOT NULL,
      revealed INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('planned', 'played')),
      rev INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX codex_sessions_number ON codex_sessions (session_number) WHERE session_number IS NOT NULL;
    ALTER TABLE codex_meta ADD COLUMN active_session_id TEXT;
  `
}, {
  version: 14,
  // M10 (CT-4): a QUEST becomes a record - "what is still open" stops being a paragraph the GM keeps
  // re-reading in a prep note. Two-layer exactly as v13's session is: `gm_body` is the GM half and never
  // leaves `projectGmQuest`; `player_body` is the player half, gated by `revealed`.
  //
  // NO BACKFILL, deliberately, and for a stronger reason than v12/v13 had: there is nothing to back-fill.
  // A quest has never existed in any form in this database - not as an entity type, not as a journal kind -
  // so no legacy row is a quest waiting to be promoted. An empty table on every existing codex is the
  // correct and complete upgrade.
  //
  // NOT a 9th entity type on `codex_pages` (D-12 rejected exactly that, and §8 of the campaign-tracking
  // doc records why): entity `fields` are a flat `Record<string,string>`, so objectives would be JSON
  // stuffed into a string, and `status` could not be queried. Do not revert this without re-reading D-12.
  //
  // `status` carries a CHECK for the same reason v13's does, and the reasoning is worth repeating rather
  // than cross-referencing: `questStatus()` gates it in TS, but a TS gate protects this PROCESS, not the
  // FILE. A repair script or a manual sqlite3 session would otherwise be free to write
  // `status = 'abandoned'`, which `toQuest` then coerces to "active" - so a bad row reads back as a
  // plausible one instead of failing loudly. The constraint is what makes the column honest. It matches
  // every comparable enum already here: `codex_journal.kind`, `codex_maps.kind`,
  // `codex_links.layer`/`target_kind`, and `codex_sessions.status`.
  //
  // The `status` INDEX is not decoration: §2.1 of the spec requires the status to be QUERYABLE because
  // the Campaign dashboard counts open quests, and that count is a per-render read.
  //
  // `objectives_json` and `entity_ids_json` are TEXT holding JSON arrays, the same shape v8's
  // `page_ids_json` / `scene_ids_json` established. NOT NULL with no default because every row is written
  // by `createQuest`, which always supplies at least "[]" - there is no legacy row to default for.
  sql: `
    CREATE TABLE codex_quests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
      player_body TEXT NOT NULL,
      gm_body TEXT NOT NULL,
      objectives_json TEXT NOT NULL,
      entity_ids_json TEXT NOT NULL,
      revealed INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX codex_quests_status ON codex_quests (status);
  `
}, {
  version: 15,
  // M11 (CT-5 deadlines, CT-10 downtime). The only migration in this file that REBUILDS a table, and the
  // reason is not a preference:
  //
  // `codex_journal.kind` has carried `CHECK (kind IN ('note', 'combat'))` since v1 and nothing has
  // superseded it. SQLite cannot widen a CHECK in place - there is no MODIFY/DROP CONSTRAINT - so a
  // `deadline` or `downtime` row is REJECTED by the file itself, not merely untyped. Verified by direct
  // probe against this build before writing a line of this: inserting either kind failed with
  // "CHECK constraint failed: kind IN ('note', 'combat')", and `ALTER TABLE ... MODIFY` was a syntax error.
  // The 12-step rebuild is therefore the ONLY way to do it.
  //
  // DROPPING the CHECK instead would have been one line, and it is the wrong line. v13 and v14 each state
  // why at length and it holds here verbatim: a TypeScript gate (`journalKind`) protects this PROCESS, not
  // this FILE. A repair script or a manual sqlite3 session would be free to write kind = 'quest', which
  // `journalKind` then coerces to "note" - a bad row reading back as a plausible one instead of failing
  // loudly. The constraint is what keeps the column honest.
  //
  // The CHECK admits SIX kinds while `CodexJournalKind` admits four (D11-B). `milestone` and `standing` are
  // M12's (spec §2.2); they are here because the cost of this migration is the REBUILD, and paying it twice
  // four weeks apart for one word each would be silly. The DB being more permissive than the TS union is
  // the direction that already exists and the safe one - the narrow gate is the one that runs on every read.
  //
  // Rebuild discipline, each point load-bearing:
  //  - The new table is the CURRENT table, byte-for-byte, in the SAME physical column order (v1's columns,
  //    then v6's three, then v10's `tags_json` with its DEFAULT) - copied from the live `sqlite_master` DDL,
  //    NOT reconstructed from the TypeScript row type. `payload_json` is appended LAST so no existing column
  //    moves. STRICT is kept, as v1 declared it.
  //  - The INSERT names its columns on BOTH sides. `SELECT *` would silently reorder or mis-map the day
  //    someone adds a column between writing this and running it.
  //  - All three indexes are recreated verbatim (`codex_journal_order`, `codex_journal_marker`,
  //    `codex_journal_page` - enumerated from v1 and confirmed against `sqlite_master`; there are no others
  //    and no triggers or views on this table). DROP TABLE takes its indexes with it, so forgetting one
  //    would silently turn the timeline's ORDER BY into a full scan.
  //  - Foreign keys ARE enforced here (`initialize()` opens with `enableForeignKeyConstraints: true`), so
  //    this was checked rather than assumed: nothing REFERENCES `codex_journal` and `codex_journal`
  //    references nothing, so the drop/rename has no FK work to do. If that ever changes, this migration
  //    must be revisited - a rename with FKs on rewrites child clauses, and a drop enforces them.
  //
  // `payload_json` is TEXT holding JSON, the shape v8's `page_ids_json` and v14's `objectives_json` already
  // established. Nullable with no default because it is null for every kind except `downtime` - unlike
  // `tags_json`, "no payload" is the normal state, not a legacy gap to backfill.
  //
  // The published date (O-1 / D11-G) is three INTEGER columns on `codex_meta`, not a field inside
  // `calendar_json`: `setCalendar` REPLACES that whole blob from GM client input, so a player-facing value
  // living inside it would be clobbered by an unrelated calendar edit. Raw parts rather than an instant
  // because K3 makes the raw date the source of truth - an instant would go stale under a calendar reshape.
  //
  // It is BACKFILLED from the calendar's `currentDate` (K7) so on day one players see exactly the date they
  // see today and nothing visibly changes until the GM first advances their own clock. Migrations here are
  // SQL-only, so this uses JSON1 (`json_valid` / `json_type` / `json_extract`), which v7 and v11 already
  // depend on. Three guards, each proven against this build rather than assumed:
  //   - `json_valid` FIRST, and non-negotiable: `json_extract` and `json_type` both THROW "malformed JSON"
  //     rather than returning NULL, so without this guard a single hand-edited `calendar_json` aborts the
  //     migration and leaves the GM's codex unopenable. Proven by mutation, not assumed.
  //     It is a NESTED CASE rather than `json_valid(...) AND json_type(...)` because SQLite's AND
  //     short-circuits only sometimes - measured on this build, the AND form survives here but the same
  //     two calls joined by AND in a bare SELECT throw. Whether the guard runs first is therefore an
  //     optimizer decision, and CASE is the construct SQLite documents as evaluating in order. The nested
  //     form costs three extra lines and removes the question.
  //   - `json_type(...) IN ('integer', 'real')` so a non-numeric part backfills NULL instead of writing
  //     TEXT into an INTEGER column of a STRICT table (which is an error, not a coercion).
  //   - `CAST(... AS INTEGER)` because a JSON `1492.0` extracts as REAL and STRICT rejects REAL in an
  //     INTEGER column. `normalizeCalendar` truncates, so this only matters for a hand-edited file - which
  //     is exactly the case a migration must not die on.
  // A NULL, absent, malformed or non-numeric `currentDate` therefore backfills NULL, which `getPublishedDate`
  // reads as "nothing published" - the same all-three-parts-or-none rule `toEntry` applies to a stored date.
  //
  // On a FRESH database this runs BEFORE `initialize()` seeds `codex_meta`, so the UPDATE matches no rows
  // and the columns simply start NULL (the ordering note v13 records; the ALTERs alter the table, not a row).
  sql: `
    CREATE TABLE codex_journal_new (
      id TEXT PRIMARY KEY,
      player_text TEXT NOT NULL,
      gm_text TEXT,
      revealed INTEGER NOT NULL,
      attach_marker_id TEXT,
      attach_page_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('note', 'combat', 'deadline', 'downtime', 'milestone', 'standing')),
      source_encounter_id INTEGER,
      session_number INTEGER,
      real_date TEXT,
      in_world_label TEXT,
      calendar_instant INTEGER,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      in_world_year INTEGER,
      in_world_month INTEGER,
      in_world_day INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT
    ) STRICT;
    INSERT INTO codex_journal_new
      (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json)
      SELECT
       id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json
      FROM codex_journal;
    DROP TABLE codex_journal;
    ALTER TABLE codex_journal_new RENAME TO codex_journal;
    CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at);
    CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id);
    CREATE INDEX codex_journal_page ON codex_journal (attach_page_id);

    ALTER TABLE codex_meta ADD COLUMN published_year INTEGER;
    ALTER TABLE codex_meta ADD COLUMN published_month INTEGER;
    ALTER TABLE codex_meta ADD COLUMN published_day INTEGER;
    UPDATE codex_meta SET
      published_year = CASE WHEN json_valid(calendar_json) THEN
        CASE WHEN json_type(calendar_json, '$.currentDate.year') IN ('integer', 'real')
          THEN CAST(json_extract(calendar_json, '$.currentDate.year') AS INTEGER) END END,
      published_month = CASE WHEN json_valid(calendar_json) THEN
        CASE WHEN json_type(calendar_json, '$.currentDate.month') IN ('integer', 'real')
          THEN CAST(json_extract(calendar_json, '$.currentDate.month') AS INTEGER) END END,
      published_day = CASE WHEN json_valid(calendar_json) THEN
        CASE WHEN json_type(calendar_json, '$.currentDate.day') IN ('integer', 'real')
          THEN CAST(json_extract(calendar_json, '$.currentDate.day') AS INTEGER) END END;
  `
}, {
  version: 16,
  // M12 (CT-6 standing, CT-7 party marker, CT-8 milestones). ADDITIVE ONLY - and the loudest thing about
  // this migration is what it does NOT do.
  //
  // It does NOT touch `codex_journal`. M12 adds two journal KINDS (`milestone`, `standing`), and v15
  // already rebuilt the CHECK with all six for exactly this reason: "the cost of this migration is the
  // REBUILD, and paying it twice four weeks apart for one word each would be silly". Verified against the
  // shipped v15 SQL above, not remembered - the CHECK reads
  // `kind IN ('note','combat','deadline','downtime','milestone','standing')` and `payload_json TEXT` is
  // already there. A second rebuild here would be the most destructive no-op in the file's history.
  //
  // `codex_standing` (spec §2.1). One row per faction, and the UNIQUE index is what makes that structural
  // rather than a convention every writer has to remember - `setStanding` upserts against it, so "adjust
  // the Harpers twice" can never become two disagreeing rows. `id` is still the primary key so the row has
  // a stable identity of its own if it ever needs one; the uniqueness that matters is the faction's.
  //
  // ON DELETE CASCADE on `faction_page_id`, and this was CONFIRMED against a live database rather than
  // assumed, because the two halves pull in opposite directions and both are wanted:
  //   - Foreign keys ARE enforced here (`initialize()` opens with `enableForeignKeyConstraints: true`),
  //     so deleting a faction page DOES remove its standing row. That is right: a standing is "where we
  //     stand with THEM", and with the page gone there is no them. A dangling row would render as a bar
  //     beside a blank name that no screen can delete.
  //   - Its `kind='standing'` CHRONICLE RECORDS SURVIVE, and must. They are `codex_journal` rows carrying
  //     `factionPageId` inside `payload_json`, which is TEXT with no foreign key behind it, so no cascade
  //     reaches them. "The Harpers turned on us in Marpenoth" stays true after the page is deleted, and
  //     the timeline is the campaign's history - deleting a page must not rewrite it. Probed directly:
  //     after `DELETE FROM codex_pages`, the standing row was gone and the journal row was still there.
  //   - The same FK also REJECTS a standing row for a page that does not exist, so `setStanding` cannot
  //     leave one behind on a typo'd id. It still checks first, to produce a message a GM can read.
  // No CHECK on `value`. Every other CHECK in this file guards an ENUM (`kind`, `status`, `layer`) where
  // the set of legal values is structural. -100..100 is a PRODUCT decision (M12-B) about a scale, and
  // baking it into the file would cost a full table rebuild - the v15 experience - to widen later. The
  // clamp lives in `standingValue`, and a hand-edited out-of-range row reads back clamped rather than
  // breaking the codex, which is this file's fail-closed discipline applied to a number instead of a word.
  //
  // `is_party` on `codex_markers` (CT-7 / M12-C). NOT NULL DEFAULT 0 so every existing pin is "not the
  // party" without a backfill pass - K7's cheapest possible shape, and the honest one: no marker in any
  // existing codex is the party marker, because until now there was no such thing.
  //
  // The PARTIAL UNIQUE INDEX is the file's half of "exactly one party marker atlas-wide". v13's
  // `codex_sessions_number` is the precedent, but this one differs in a way worth stating: v13's
  // `WHERE session_number IS NOT NULL` is INTENT (SQLite already treats NULLs as distinct), whereas this
  // predicate is LOad-BEARING - without it the index would demand every marker have a distinct `is_party`,
  // so a second ordinary pin could not exist. With it, only the `is_party = 1` rows are indexed, so many
  // zeros are legal and a second one is rejected. Both halves were probed against this build: flagging a
  // second party raises "UNIQUE constraint failed: codex_markers.is_party", and three markers at 0 coexist.
  //
  // That also fixes the ORDER of `setPartyMarker`'s two writes at the file level: clear-then-set commits,
  // set-then-clear is rejected mid-transaction. Measured, not reasoned about.
  sql: `
    CREATE TABLE codex_standing (
      id TEXT PRIMARY KEY,
      faction_page_id TEXT NOT NULL REFERENCES codex_pages(id) ON DELETE CASCADE,
      value INTEGER NOT NULL,
      revealed INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX codex_standing_faction ON codex_standing (faction_page_id);
    ALTER TABLE codex_markers ADD COLUMN is_party INTEGER NOT NULL DEFAULT 0;
    CREATE UNIQUE INDEX codex_markers_party ON codex_markers (is_party) WHERE is_party = 1;
  `
}, {
  version: 17,
  // OWNER DECISION (2026-07-30): revision history becomes GM-controllable, because `codex_page_revisions` was
  // unbounded (see `CodexRevisionSettings` for the measurement that provoked this).
  //
  // ADDITIVE ONLY, and the loudest thing about this migration is what it does NOT do: it does not prune,
  // trim, or touch a single existing revision row. Disabling history stops WRITING; destroying the GM's only
  // undo as a side effect of turning a feature off would be the worst possible reading of the request, and
  // there is deliberately no "delete my history" verb anywhere in this change.
  //
  // Two columns on `codex_meta` - the codex's singleton settings row (`id INTEGER PRIMARY KEY CHECK (id = 1)`),
  // which is where v4's calendar, v13's active-session pointer and v15's published date already live, so a
  // codex-wide setting has an established home and needs no table of its own.
  //
  // Both carry DEFAULTs, which is the whole of the upgrade story (K7): an existing codex reads
  // `revision_history_enabled = 1` (exactly today's behaviour - history on) and `revision_window_minutes = 90`
  // (the owner's default). Verified against this build rather than assumed: `ALTER TABLE ... ADD COLUMN
  // ... NOT NULL DEFAULT` on a STRICT table backfills the EXISTING row, so there is nothing to UPDATE
  // afterwards and no window in which the columns read NULL. On a FRESH database this runs BEFORE
  // `initialize()` seeds `codex_meta`, so there is no row to backfill and the seed's named-column INSERT
  // simply takes both defaults - the ordering note v13 records, and it holds here for the same reason (the
  // ALTERs alter the table, not a row).
  //
  // INTEGER for the boolean because SQLite has none, the encoding `revealed` / `is_party` already use.
  //
  // No CHECK on either column, and that is the same decision v16 made about `codex_standing.value` rather
  // than a lapse: 0..10080 is a PRODUCT bound (a week of minutes) on a number, not an ENUM whose legal set is
  // structural, and baking it into the file would cost a full table rebuild - the v15 experience - to widen
  // later. The clamp lives in `revisionWindowMinutes` on the way in, and `getSettings` re-validates on the way
  // OUT so a hand-edited or repair-scripted value reads as the default instead of propagating. That is this
  // file's fail-closed discipline applied to a number, and it is why the guard is on the READ: the write is
  // not the only way in.
  sql: `
    ALTER TABLE codex_meta ADD COLUMN revision_history_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE codex_meta ADD COLUMN revision_window_minutes INTEGER NOT NULL DEFAULT 90;
  `
}, {
  version: 18,
  // D6 (client decision, 2026-07-31): autosave becomes GM-configurable - on/off plus an interval.
  //
  // v17's shape VERBATIM, for the same reasons and with the same upgrade story: two columns on
  // `codex_meta`, the codex's singleton settings row, both carrying DEFAULTs so an existing codex reads
  // `{enabled: true, intervalSeconds: 1}` without a backfill pass and a fresh database takes the defaults
  // through `initialize()`'s named-column seed. INTEGER for the boolean, the encoding `revealed`,
  // `is_party` and `revision_history_enabled` already use.
  //
  // **SECONDS, not milliseconds** (director ruling R4). The wire unit is seconds, so the column is seconds:
  // a stored millisecond value converted at the boundary is a value that can be converted twice, and the
  // one thing worse than a wrong interval is an interval nobody can read off the row.
  //
  // The DEFAULT of 1 is not a new cadence - today's page editor debounces at 800 ms, which is below the
  // wire's 1 s floor, so 1 is the honest expression of "what this codex already did". D6's promise is that
  // the codex always keeps your work; an upgrade that quietly slowed saving down would break it.
  //
  // No CHECK on either column, the v16/v17 decision applied a third time: 1..600 is a PRODUCT bound on a
  // number, not an ENUM whose legal set is structural, and baking it in would cost a full table rebuild to
  // widen later. The clamp lives in `autosaveIntervalSeconds` on the way in and `autosaveSettings`
  // re-validates on the way OUT, because the write is not the only way into an INTEGER column.
  sql: `
    ALTER TABLE codex_meta ADD COLUMN autosave_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE codex_meta ADD COLUMN autosave_interval_seconds INTEGER NOT NULL DEFAULT 1;
  `
}, {
  version: 19,
  // D9 (client decision, 2026-07-31): journal entries join their session BY IDENTITY, and D11's `quest`
  // kind rides along. The second table rebuild in this file's history, and v15's discipline is copied
  // point for point rather than remembered.
  //
  // WHY A REBUILD. Two reasons, and each alone would be enough:
  //  - `kind` carries `CHECK (kind IN (...six...))` and SQLite cannot widen a CHECK in place. D11's quest
  //    history is a seventh kind. v15 already paid this cost once and said in as many words that paying it
  //    "twice four weeks apart for one word each would be silly" - so `quest` is admitted HERE, in Phase 2,
  //    even though the history flow itself ships in Phase 3. The DB being more permissive than
  //    `CodexJournalKind` is the established safe direction (`journalKind` fails closed to `note`).
  //  - `session_id` needs to be a real column, and appending it is the cheap half; the CHECK is the
  //    expensive half, so they land together.
  //
  // WHY THE JOIN AT ALL. `session_number` was a bare INTEGER copied onto the entry, which made renumbering a
  // session a lie: the entries kept the old number (`known-bugs.md:111-122`, OPEN). Joining by id makes the
  // display number LIVE - renumber the session and every entry follows, with no journal write at all.
  //
  // NO FOREIGN KEY on `session_id`, deliberately, and it is the same call v13 made for `active_session_id`:
  // `deleteSession` scrubs the column itself (with director ruling R2's conditional stamp-back), which a
  // cascade could not express - a revealed session's number must survive its record as a bare label, and a
  // hidden one's must not.
  //
  // Rebuild discipline, verbatim from v15:
  //  - The new table is the CURRENT table in the SAME physical column order, read from live `sqlite_master`,
  //    with `session_id` appended LAST so no existing column moves. STRICT kept.
  //  - The INSERT names its columns on BOTH sides.
  //  - All three indexes recreated verbatim, plus `codex_journal_session` for the new join.
  //  - FK situation re-verified at head: nothing references `codex_journal` and it references nothing.
  //
  // THE BACKFILL, in two steps and in this order:
  //
  //  1. SYNTHESIZE a session record for every number that names none. v13 deliberately did NOT backfill,
  //     on the grounds that fabricating session records would invent facts. The client's D9 consciously
  //     supersedes that decision (recorded in `decision-log.md` with this migration), and the objection is
  //     honoured rather than overridden: the synthesized rows carry EMPTY prep, recap and attendees - nothing
  //     is invented - and are `played` + `revealed = 0`, so they are invisible to players and nothing
  //     changes on any screen but the GM's session list, where a number that already existed now has a
  //     record to hang on. The alternative was orphaning those entries' numbers, which is data loss.
  //
  //     The UUID recipe emits a lowercase v4-shaped id: version nibble forced to `4`, variant to one of
  //     `[89ab]`, so it satisfies the store's `ID` regex and round-trips through every route that validates
  //     an id. `strftime('%Y-%m-%dT%H:%M:%fZ','now')` is fixed-width and compatible with the store's own
  //     `toISOString()` stamps.
  //
  //  2. RESOLVE the numbers into ids and NULL the column. After step 1 every number resolves, so the
  //     post-migration invariant is exact and testable: no journal row keeps a bare `session_number`. The
  //     column is RETAINED physically - it becomes the bare-LABEL store, written again by exactly one
  //     writer (`deleteSession`'s R2 stamp-back) and read by `toEntry` only as the no-join fallback.
  sql: `
    CREATE TABLE codex_journal_new (
      id TEXT PRIMARY KEY,
      player_text TEXT NOT NULL,
      gm_text TEXT,
      revealed INTEGER NOT NULL,
      attach_marker_id TEXT,
      attach_page_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('note', 'combat', 'deadline', 'downtime', 'milestone', 'standing', 'quest')),
      source_encounter_id INTEGER,
      session_number INTEGER,
      real_date TEXT,
      in_world_label TEXT,
      calendar_instant INTEGER,
      sort_key INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      in_world_year INTEGER,
      in_world_month INTEGER,
      in_world_day INTEGER,
      tags_json TEXT NOT NULL DEFAULT '[]',
      payload_json TEXT,
      session_id TEXT
    ) STRICT;
    INSERT INTO codex_journal_new
      (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json, payload_json)
      SELECT
       id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_number, real_date, in_world_label, calendar_instant, sort_key, created_at, updated_at, in_world_year, in_world_month, in_world_day, tags_json, payload_json
      FROM codex_journal;
    DROP TABLE codex_journal;
    ALTER TABLE codex_journal_new RENAME TO codex_journal;
    CREATE INDEX codex_journal_order ON codex_journal (calendar_instant, session_number, created_at);
    CREATE INDEX codex_journal_marker ON codex_journal (attach_marker_id);
    CREATE INDEX codex_journal_page ON codex_journal (attach_page_id);
    CREATE INDEX codex_journal_session ON codex_journal (session_id);

    INSERT INTO codex_sessions (id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at)
      SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
                   substr(hex(randomblob(2)), 2) || '-' ||
                   substr('89ab', (abs(random()) % 4) + 1, 1) || substr(hex(randomblob(2)), 2) ||
                   '-' || hex(randomblob(6))),
             j.session_number, NULL, '[]', '', '', 0, 'played', 1,
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM (SELECT DISTINCT session_number FROM codex_journal
            WHERE session_number IS NOT NULL
              AND session_number NOT IN (SELECT session_number FROM codex_sessions WHERE session_number IS NOT NULL)) j;

    UPDATE codex_journal SET
      session_id = (SELECT s.id FROM codex_sessions s WHERE s.session_number = codex_journal.session_number),
      session_number = NULL
    WHERE session_number IS NOT NULL;
  `
}, {
  version: 20,
  // D10 (client decision, 2026-07-31): sessions and quests become taggable, so every list in the Codex can
  // be filtered the same way and a tag click can open one cross-type view.
  //
  // v10's shape VERBATIM (`tags_json TEXT NOT NULL DEFAULT '[]'`), which is the whole upgrade story: an
  // existing row reads `[]` without a backfill pass, and `parseTags` already degrades a malformed blob to
  // an empty list rather than throwing. Tags are SINGLE-LAYER by CI-2 - there is no GM-only tag - so they
  // are indexed into both audience tables and need no reveal reasoning of their own.
  sql: `
    ALTER TABLE codex_sessions ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE codex_quests ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
  `
}, {
  version: 21,
  // D10: sessions join the ONE suite-wide search index. This is a three-gate viewer-safety change
  // (`CodexRecordKind`'s comment enumerates them); this migration is GATE 1 for every EXISTING session, and
  // gate 1 is the one with no second line of defence.
  //
  // The two audience rows are built by DIFFERENT expressions, and the difference is the gate:
  //  - PLAYER: recap, real date and tags. Every one of those is already in `projectPlayerSession`, so a
  //    player's query can only match text they could already read on a revealed session.
  //  - GM: the same plus `prep_body` and the attendee names. Prep is "the single most important secret on
  //    this record" and attendees are real-world personal data; a `prep_body` in the player table would make
  //    a player's query on a GM-only phrase MATCH, and the hit's existence is the leak even though the body
  //    is never returned.
  //
  // Reveal is NOT part of this: gates 2 (`PLAYER_VISIBLE_SQL`) and 3 (`projectPlayerSearchHit`) resolve it at
  // READ time, which is why `setSessionRevealed` needs no reindex - the `setQuestRevealed` rule verbatim.
  //
  // The title is `Session N` for a numbered session and empty for an unnumbered one; the number is already
  // player-visible on a revealed session, so it may sit in the player table. A hit with an empty title falls
  // back to a recap excerpt at projection time, never to a blank row.
  //
  // JSON1 guards match v11's and v15's: `json_valid` FIRST as a nested CASE (SQLite's AND short-circuits only
  // sometimes; CASE is documented as evaluating in order), so one hand-edited `tags_json` cannot abort the
  // migration and leave a codex unopenable.
  sql: `
    INSERT INTO codex_search_player (kind, record_id, title, body)
      SELECT 'session', id,
             CASE WHEN session_number IS NULL THEN '' ELSE 'Session ' || session_number END,
             recap_body || char(10) || COALESCE(real_date, '') || char(10) ||
             CASE WHEN json_valid(tags_json)
               THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_sessions.tags_json)), '')
               ELSE '' END
      FROM codex_sessions;
    INSERT INTO codex_search_gm (kind, record_id, title, body)
      SELECT 'session', id,
             CASE WHEN session_number IS NULL THEN '' ELSE 'Session ' || session_number END,
             prep_body || char(10) || recap_body || char(10) || COALESCE(real_date, '') || char(10) ||
             CASE WHEN json_valid(attendees_json)
               THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_sessions.attendees_json)), '')
               ELSE '' END || char(10) ||
             CASE WHEN json_valid(tags_json)
               THEN COALESCE((SELECT group_concat(value, ' ') FROM json_each(codex_sessions.tags_json)), '')
               ELSE '' END
      FROM codex_sessions;
  `
}];

/**
 * The player search index's visibility predicate, one arm per record kind. Each arm is COPIED from
 * that kind's player LIST endpoint - if search were ever gated more weakly than the list, search would
 * BE the leak. The arms and where they come from:
 *
 *   page    - `revealed = 1`. Same as `projectPlayerPageSummary` / `GET /codex/pages`.
 *   journal - `revealed = 1`. Same as `projectPlayerJournalEntry` / `GET /codex/journal`. An entry's
 *             own reveal flag is the WHOLE predicate: attaching an entry to a marker/page is an extra
 *             GATE on the by-attachment read, never a reveal path, and the unfiltered timeline a player
 *             gets is exactly "every revealed entry".
 *   map     - `revealed = 1`. Same as `projectPlayerMap` / `GET /codex/maps`. (A hidden PARENT only
 *             costs a revealed child its `parentMapId`; a search hit carries no parent link at all.)
 *   marker  - `revealed = 1` AND ITS MAP'S `revealed = 1`. The marker's own flag is NOT sufficient:
 *             `GET /codex/maps/:id/markers` 404s a player on an unrevealed map before projecting a
 *             single pin (CD-6), so a revealed pin on a secret map is invisible and search must agree.
 *   session - `revealed = 1`. Same as `projectPlayerSession` / `GET /codex/sessions`. A session's own flag
 *             is the WHOLE predicate, exactly as the player list route computes it. Gate 1 does the heavy
 *             lifting for this kind: `prep_body` and the attendee names never enter the player index at
 *             all, so even a revealed session cannot be found by its secrets.
 *   quest   - `revealed = 1`. Same as `projectPlayerQuest` / `GET /codex/quests`. A quest's own flag is
 *             the WHOLE predicate: its `entityIds` are a LINK to pages, not a gate on the quest, and the
 *             player list already drops the unrevealed ones from that array (the `projectPlayerMarker`
 *             rule). A quest linked to a secret page is still a quest the party legitimately has.
 *
 * `ELSE 0` fails closed: an unrecognized kind is never player-visible. That is why FORGETTING an arm
 * hides a kind from player search rather than leaking it - a weakened arm is the dangerous edit, not a
 * missing one, which is what the store-level test per kind is watching for.
 */
const PLAYER_VISIBLE_SQL = `(CASE codex_search_player.kind
  WHEN 'page' THEN EXISTS (SELECT 1 FROM codex_pages WHERE codex_pages.id = codex_search_player.record_id AND codex_pages.revealed = 1)
  WHEN 'journal' THEN EXISTS (SELECT 1 FROM codex_journal WHERE codex_journal.id = codex_search_player.record_id AND codex_journal.revealed = 1)
  WHEN 'map' THEN EXISTS (SELECT 1 FROM codex_maps WHERE codex_maps.id = codex_search_player.record_id AND codex_maps.revealed = 1)
  WHEN 'marker' THEN EXISTS (SELECT 1 FROM codex_markers JOIN codex_maps ON codex_maps.id = codex_markers.map_id
    WHERE codex_markers.id = codex_search_player.record_id AND codex_markers.revealed = 1 AND codex_maps.revealed = 1)
  WHEN 'quest' THEN EXISTS (SELECT 1 FROM codex_quests WHERE codex_quests.id = codex_search_player.record_id AND codex_quests.revealed = 1)
  WHEN 'session' THEN EXISTS (SELECT 1 FROM codex_sessions WHERE codex_sessions.id = codex_search_player.record_id AND codex_sessions.revealed = 1)
  ELSE 0 END)`;

/**
 * Search ORDER BY, built for ONE audience table. Both `codex_search_player` and `codex_search_gm` are
 * ordered through this function, so the two roles cannot rank the same world differently - the GM and
 * the player who type the same name arrive at the same record.
 *
 * Ranking is TWO tiers, in this order:
 *
 *  1. EXACT TITLE. A record whose title IS what you typed comes first, unconditionally. The quick
 *     switcher's whole contract is "type the name, press Enter, arrive", and tier 2 alone makes that
 *     a probability rather than a guarantee.
 *
 *     Measured on this schema, page titled `Strahd` versus one page whose body is the word repeated N
 *     times, ranked by tier 2 ONLY: at N=40 the titled page wins, at N=80 it LOSES, and the scores on
 *     either side of that line differ by roughly 1%. So the outcome is not decided by which record the
 *     GM meant - it is decided by how wordy their prose happened to get. Raising the title weight only
 *     moves the line; it does not remove it, because bm25 is a relevance heuristic and no weight makes
 *     a heuristic into a promise. "This record is literally called that" is not a heuristic, so it is
 *     not left to one. That is the whole justification for the special case, and it is deliberately the
 *     ONLY one: one extra rule, statable in a sentence, with tier 2 doing the rest of the work.
 *
 *     `LOWER()` in SQLite folds ASCII only, so a title with an uppercase NON-ASCII letter ("ÉLARA")
 *     will not match a typed "élara" here. That fails SAFE: the record simply falls through to tier 2,
 *     which still weights its title 10x. It is a missing boost, never a missing result.
 *
 *  2. WEIGHTED bm25, title over body. `bm25()` takes ONE weight per DECLARED column, in declaration
 *     order, and `kind`/`record_id` are declared but UNINDEXED - so the arity is FOUR, not two, and
 *     `title`/`body` are slots 2 and 3. This is worth stating because getting it wrong is SILENT:
 *     `bm25(t, 10.0, 1.0)` does not error, it weights the two UNINDEXED columns (which can never
 *     contribute) and leaves title and body at their 1.0 default - i.e. it is exactly the unweighted
 *     `rank` this replaces. The two leading 0.0s are therefore load-bearing documentation, not padding.
 *     Extra weights past the fourth are ignored just as silently. Verified empirically, not assumed.
 *
 * This only REORDERS; it never filters. A zero-weighted column still returns its rows (scored 0), and
 * neither tier is in the WHERE clause, so recall is bit-for-bit what it was - a page that only mentions
 * the term is still found, just below the page named after it.
 *
 * WHAT THIS DOES CHANGE, stated rather than hidden: the LIMIT 50 is one cap shared by all four kinds,
 * and it takes the first 50 in THIS order. So on a query matching more than 50 records, the composition
 * of that 50 shifts towards title matches. Journal entries feel it most, because they are indexed with
 * an EMPTY title (an entry has no name) and can therefore only ever place in tier 2 on body score - a
 * journal entry that used to edge out a barely-relevant page can now fall off the end. That is the
 * intended trade for a suite-wide search whose first job is navigation, and it only bites past 50 hits;
 * below the cap nothing is lost, only reordered. If journal recall on huge queries ever matters, the
 * fix is a per-kind cap, not a weaker title weight.
 */
function searchOrderBySql(table: "codex_search_player" | "codex_search_gm"): string {
  return `(CASE WHEN LOWER(${table}.title) = ? THEN 0 ELSE 1 END), bm25(${table}, 0.0, 0.0, 10.0, 1.0)`;
}

type PageRow = {
  id: string; title: string; entity_type: string; fields_json: string; gm_fields_json: string; folder: string | null; tags_json: string; player_body: string;
  gm_body: string; revealed: number; banner_asset_id: string | null;
  in_world_label: string | null; calendar_instant: number | null; in_world_year: number | null; in_world_month: number | null; in_world_day: number | null;
  rev: number; created_at: string; updated_at: string;
};
/**
 * One column list per page read, so a new column cannot land in the row type and be forgotten in one of
 * the three SELECTs (the CT-11 date columns are read by all of them). Same discipline as JOURNAL_COLUMNS.
 * The SUMMARY list is the full one minus the two bodies and the GM field map — `CodexPageSummaryRow`.
 */
const PAGE_DATE_COLUMNS = "in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day";
const PAGE_COLUMNS = `id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, ${PAGE_DATE_COLUMNS}, rev, created_at, updated_at`;
const PAGE_SUMMARY_COLUMNS = `id, title, entity_type, fields_json, folder, tags_json, revealed, banner_asset_id, ${PAGE_DATE_COLUMNS}, rev, created_at, updated_at`;
/** The raw stored date, reassembled. All three parts or none - the same rule `toEntry` applies to a journal row. */
function pageDateOf(row: Pick<PageRow, "in_world_year" | "in_world_month" | "in_world_day">): CodexInWorldDate | null {
  return row.in_world_year !== null && row.in_world_month !== null && row.in_world_day !== null
    ? { year: row.in_world_year, month: row.in_world_month, day: row.in_world_day }
    : null;
}
type RelationshipRowRaw = { id: string; from_page_id: string; to_page_id: string; type: string; created_at: string };
/**
 * The revision columns `CodexPageRevisionRow` is made of, named once for the same reason PAGE_COLUMNS is:
 * two reads share them (`listRevisions` per page, `listAllRevisions` for the backup) and a column added to
 * the row type must not be able to land in one SELECT and be forgotten in the other.
 */
const REVISION_COLUMNS = "id, page_id, rev, title, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag";
type RevisionRowRaw = { id: number; page_id: string; rev: number; title: string; player_body: string; gm_body: string; banner_asset_id: string | null; tags_json: string; authored_at: string; author_tag: string };
/** The ONE mapping of a `codex_page_revisions` row, so the per-page read and the backup read cannot disagree. */
function toRevision(row: RevisionRowRaw): CodexPageRevisionRow {
  return { id: row.id, pageId: row.page_id, rev: row.rev, title: row.title, playerBody: row.player_body, gmBody: row.gm_body, bannerAssetId: row.banner_asset_id, tags: JSON.parse(row.tags_json) as string[], authoredAt: row.authored_at, authorTag: row.author_tag };
}
type MapRowRaw = { id: string; asset_id: string; name: string; kind: string; parent_map_id: string | null; revealed: number; sort_key: number; tags_json: string; created_at: string; updated_at: string };
const MAP_COLUMNS = "id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at";
type MarkerRowRaw = { id: string; map_id: string; x: number; y: number; icon_id: string; icon_color: string; label: string | null; revealed: number; page_ids_json: string | null; sub_map_id: string | null; scene_ids_json: string | null; actor_id: string | null; tags_json: string; is_party: number; created_at: string; updated_at: string };
const MARKER_COLUMNS = "id, map_id, x, y, icon_id, icon_color, label, revealed, page_ids_json, sub_map_id, scene_ids_json, actor_id, tags_json, is_party, created_at, updated_at";
type StandingRowRaw = { id: string; faction_page_id: string; value: number; revealed: number; created_at: string; updated_at: string };
const STANDING_COLUMNS = "id, faction_page_id, value, revealed, created_at, updated_at";
type SessionRowRaw = { id: string; session_number: number | null; real_date: string | null; attendees_json: string; prep_body: string; recap_body: string; revealed: number; status: string; rev: number; created_at: string; updated_at: string; tags_json: string };
/** One column list per session read, the same discipline PAGE_COLUMNS / JOURNAL_COLUMNS follow. */
const SESSION_COLUMNS = "id, session_number, real_date, attendees_json, prep_body, recap_body, revealed, status, rev, created_at, updated_at, tags_json";
type QuestRowRaw = { id: string; title: string; status: string; player_body: string; gm_body: string; objectives_json: string; entity_ids_json: string; revealed: number; rev: number; created_at: string; updated_at: string; tags_json: string };
/** One column list per quest read, and the INSERT's value order is bound to it - the SESSION_COLUMNS discipline. */
const QUEST_COLUMNS = "id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, rev, created_at, updated_at, tags_json";
type JournalRowRaw = { id: string; player_text: string; gm_text: string | null; revealed: number; attach_marker_id: string | null; attach_page_id: string | null; kind: string; source_encounter_id: number | null; session_number: number | null; session_id: string | null; live_session_number: number | null; real_date: string | null; in_world_label: string | null; calendar_instant: number | null; in_world_year: number | null; in_world_month: number | null; in_world_day: number | null; sort_key: number; tags_json: string; payload_json: string | null; created_at: string; updated_at: string };
/**
 * D9: every journal read is now a LEFT JOIN onto `codex_sessions`, because the display number is LIVE.
 *
 * The column list is prefixed `j.` and paired with `JOURNAL_FROM` below so the two cannot be used apart -
 * a SELECT that took the columns without the join would read `live_session_number` as undefined and quietly
 * fall back to the bare label on every row, which is the exact bug D9 exists to remove.
 *
 * `session_number` is still SELECTed beside `live_session_number`: after v19 it is the bare-LABEL store,
 * NULL on every row, written again only by `deleteSession`'s conditional stamp-back (director ruling R2)
 * and read by `toEntry` only when there is no join to resolve.
 */
const JOURNAL_COLUMNS = "j.id, j.player_text, j.gm_text, j.revealed, j.attach_marker_id, j.attach_page_id, j.kind, j.source_encounter_id, j.session_number, j.session_id, s.session_number AS live_session_number, j.real_date, j.in_world_label, j.calendar_instant, j.in_world_year, j.in_world_month, j.in_world_day, j.sort_key, j.tags_json, j.payload_json, j.created_at, j.updated_at";
const JOURNAL_FROM = "codex_journal j LEFT JOIN codex_sessions s ON s.id = j.session_id";

/** Read a stored tag array defensively — a malformed value degrades to no tags rather than throwing. */
function parseTags(raw: string | null | undefined): readonly string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch { return []; }
}
function id(value: string): string {
  if (!ID.test(value)) throw new Error("Codex id is malformed.");
  return value;
}
/**
 * A record's display title. Shared by pages and (M10) quests rather than near-copied, because the rule
 * really is the same one - which is why the message no longer says "page".
 */
function title(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || CONTROL_CHARS.test(trimmed)) throw new Error("A title must be 1 to 160 printable characters.");
  return trimmed;
}
/** A nested notebook folder PATH ("NPCs/Villains"): "/"-separated segments, normalized and bounded. */
function folder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const segments = value.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length > 6) throw new Error("A folder path can be at most 6 levels deep.");
  for (const segment of segments) if (segment.length > 40 || CONTROL_CHARS.test(segment)) throw new Error("Each folder name is up to 40 printable characters.");
  const path = segments.join("/");
  if (path.length > 160) throw new Error("That folder path is too long.");
  return path;
}
function tags(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  const cleaned = [...new Set(value.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > MAX_TAGS) throw new Error(`A record may carry at most ${MAX_TAGS} tags.`);
  for (const tag of cleaned) if (tag.length > 40 || !/^[a-z0-9][a-z0-9-]*$/.test(tag)) throw new Error("Tags use lowercase letters, numbers, and hyphens.");
  return cleaned;
}
function body(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_BODY) throw new Error("A page body is limited to 100000 characters.");
  return text;
}
function entityType(value: string | undefined): CodexEntityType {
  if (value === undefined) return "note";
  if (!ENTITY_TYPES.includes(value as CodexEntityType)) throw new Error("Unknown entity type.");
  return value as CodexEntityType;
}
/** Structured entity attributes: a flat {slug: string} map, empties dropped, bounded in size. */
function entityFields(value: Readonly<Record<string, string>> | undefined): Record<string, string> {
  if (value === undefined) return {};
  const entries = Object.entries(value);
  if (entries.length > 40) throw new Error("An entity may carry at most 40 fields.");
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key) || key.length > 40) throw new Error("A field key must be a lowercase slug.");
    if (typeof raw !== "string" || raw.length > 2000 || CONTROL_CHARS.test(raw.replace(/[\n\r\t]/g, ""))) throw new Error("A field value is up to 2000 printable characters.");
    if (raw.trim() !== "") out[key] = raw;
  }
  if (JSON.stringify(out).length > 10_000) throw new Error("Entity fields are too large.");
  return out;
}
/**
 * Field keys that are GM-only (secret) whatever a caller claims. The client schema (`entities.ts`) marks
 * these `secret` and routes them to `gmFields`; the SERVER enforces the same split so a page can never
 * hold a secret attribute in the player-facing `fields` map - not from an old page, a restored revision,
 * or a hand-crafted API write. Keep in sync with the schema's `secret: true` fields.
 */
/** Derived from the shared entity table (`@vtt/domain`) — never hand-maintained here again. */
const SECRET_FIELD_KEYS: ReadonlySet<string> = CODEX_SECRET_FIELD_KEYS;
/** Move any secret-keyed values out of player-facing `fields` and into GM-only `gmFields` (viewer-safety net). */
function sealSecretFields(fields: Record<string, string>, gmFields: Record<string, string>): { fields: Record<string, string>; gmFields: Record<string, string> } {
  const outFields = { ...fields };
  const outGm = { ...gmFields };
  for (const key of SECRET_FIELD_KEYS) {
    if (key in outFields) { outGm[key] = outFields[key]; delete outFields[key]; }
  }
  return { fields: outFields, gmFields: outGm };
}
const REL_TYPE = /^[a-z0-9][a-z0-9-]*$/;
/** Relationship types that read the same both ways (label === inverse) - A->B and B->A are the SAME edge. */
const SYMMETRIC_RELATIONSHIPS = new Set(["ally", "enemy", "rival", "related"]);
function relationshipType(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!REL_TYPE.test(trimmed) || trimmed.length > 40) throw new Error("A relationship type must be a lowercase slug.");
  return trimmed;
}
function parseFields(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try { const parsed = JSON.parse(json) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}; }
  catch { return {}; }
}
function normalizeCalendar(input: CodexCalendar): CodexCalendar {
  const months = (input.months ?? []).map((month) => ({ name: shortLabel(month.name, 40, "month name") ?? "Month", days: Number.isFinite(month.days) ? Math.max(1, Math.min(Math.trunc(month.days), 400)) : 30 }));
  if (months.length < 1 || months.length > 24) throw new Error("A calendar needs 1 to 24 months.");
  const weekdays = (input.weekdays ?? []).slice(0, 20).map((day) => shortLabel(day, 40, "weekday") ?? "Day");
  const current = input.currentDate;
  const currentDate = current && Number.isFinite(current.year) && Number.isFinite(current.month) && Number.isFinite(current.day)
    ? { year: Math.trunc(current.year), month: Math.max(0, Math.min(Math.trunc(current.month), months.length - 1)), day: Math.max(1, Math.trunc(current.day)) }
    : null;
  return { yearName: shortLabel(input.yearName, 20, "era") ?? "", months, weekdays, currentDate };
}
function calendarDaysPerYear(calendar: CodexCalendar): number { return calendar.months.reduce((sum, month) => sum + month.days, 0); }
/** An absolute, monotonically-increasing day number for chronological sorting (negative years allowed). */
function calendarInstantOf(calendar: CodexCalendar, date: CodexInWorldDate): number {
  const monthIdx = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  let dayOfYear = 0;
  for (let i = 0; i < monthIdx; i += 1) dayOfYear += calendar.months[i].days;
  const day = Math.max(1, Math.min(Math.trunc(date.day), calendar.months[monthIdx].days));
  return Math.trunc(date.year) * calendarDaysPerYear(calendar) + dayOfYear + (day - 1);
}
/**
 * The chronicle's sort key, and the ONE comparator over it (CT-12's "by in-world date" lens).
 *
 * This is `listTimeline()`'s `ORDER BY` restated in TypeScript, clause for clause:
 *   `(calendar_instant IS NULL), calendar_instant, (session_number IS NULL), session_number, created_at`
 * It has to be restated because two tables with different columns cannot share one SQL `ORDER BY` without
 * a UNION that would then need every column of both. Stated once here and used for the merge, so the
 * chronicle cannot order the journal differently from the journal's own read - and `listTimeline()` is
 * already sorted by that SQL, so a stable sort leaves entry-vs-entry order exactly as SQL produced it.
 *
 * `id` is the final tiebreaker, which the SQL has no equivalent of: it only breaks ties SQL leaves
 * arbitrary, and it is what makes the two lenses provably re-orderings of one another rather than two
 * orders that happen to agree today.
 */
type ChronicleSortKey = Readonly<{ calendarInstant: number | null; sessionNumber: number | null; createdAt: string; id: string }>;
function chronicleSortKey(record: CodexChronicleRecord): ChronicleSortKey {
  return record.kind === "entry"
    ? { calendarInstant: record.entry.calendarInstant, sessionNumber: record.entry.sessionNumber, createdAt: record.entry.createdAt, id: record.entry.id }
    : { calendarInstant: record.page.calendarInstant, sessionNumber: null, createdAt: record.page.createdAt, id: record.page.id };
}
function compareChronicle(a: ChronicleSortKey, b: ChronicleSortKey): number {
  const undated = Number(a.calendarInstant === null) - Number(b.calendarInstant === null);
  if (undated !== 0) return undated;
  if (a.calendarInstant !== null && b.calendarInstant !== null && a.calendarInstant !== b.calendarInstant) return a.calendarInstant - b.calendarInstant;
  const unsessioned = Number(a.sessionNumber === null) - Number(b.sessionNumber === null);
  if (unsessioned !== 0) return unsessioned;
  if (a.sessionNumber !== null && b.sessionNumber !== null && a.sessionNumber !== b.sessionNumber) return a.sessionNumber - b.sessionNumber;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function formatInWorldDate(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const monthIdx = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  const month = calendar.months[monthIdx];
  const day = Math.max(1, Math.min(Math.trunc(date.day), month.days));
  const base = `${month.name} ${day}, ${Math.trunc(date.year)}${calendar.yearName ? ` ${calendar.yearName}` : ""}`;
  if (calendar.weekdays.length > 0) {
    const instant = calendarInstantOf(calendar, date);
    const index = ((instant % calendar.weekdays.length) + calendar.weekdays.length) % calendar.weekdays.length; // non-negative for negative years
    return `${calendar.weekdays[index]}, ${base}`;
  }
  return base;
}
const MAP_KINDS = new Set<CodexMapKind>(["battlemap", "regional", "world"]);
function mapName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || CONTROL_CHARS.test(trimmed)) throw new Error("A map name must be 1 to 120 printable characters.");
  return trimmed;
}
function mapKind(value: string): CodexMapKind {
  if (!MAP_KINDS.has(value as CodexMapKind)) throw new Error("Map kind must be battlemap, regional, or world.");
  return value as CodexMapKind;
}
function iconId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value) || value.length > 60) throw new Error("An icon id must be a lowercase slug.");
  return value;
}
function hexColor(value: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("A color must be a #rrggbb hex value.");
  return value;
}
function coord(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error("A marker position must sit within the map.");
  return value;
}
function markerLabel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 120 || CONTROL_CHARS.test(trimmed)) throw new Error("A marker label is up to 120 printable characters.");
  return trimmed;
}
function optionalId(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : id(value);
}
/** Validate + dedupe an array of ids (for a marker's multiple page/scene links). Caps at 24. */
function idArray(value: readonly string[] | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value) { const v = id(raw); if (!out.includes(v)) out.push(v); if (out.length >= 24) break; }
  return out;
}
/** Parse a JSON id-array column (null/garbage → []). */
function parseIdArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try { const arr: unknown = JSON.parse(json); return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : []; } catch { return []; }
}
const MAX_ENTRY = 20_000;
function entryText(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_ENTRY) throw new Error("A journal entry is limited to 20000 characters.");
  return text;
}
function entryGmText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > MAX_ENTRY) throw new Error("A journal entry is limited to 20000 characters.");
  return value === "" ? null : value;
}
function shortLabel(value: string | null | undefined, max: number, what: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max || CONTROL_CHARS.test(trimmed)) throw new Error(`A ${what} is up to ${max} printable characters.`);
  return trimmed;
}
function sessionNo(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100_000) throw new Error("A session number must be a non-negative integer.");
  return value;
}
const MAX_ATTENDEES = 24;
/**
 * Who was at the table: short free-text names, deduped and bounded. Deliberately NOT `tags()` - an
 * attendee is a person's name ("Ozy"), not a slug, so lowercasing and rejecting spaces would be wrong.
 * The per-name bound is `shortLabel`, which already trims, rejects control characters and caps length,
 * so this adds only the dedupe and the count cap.
 */
function attendees(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value) {
    const name = shortLabel(raw, 40, "attendee name");
    if (name && !out.includes(name)) out.push(name);
  }
  if (out.length > MAX_ATTENDEES) throw new Error(`A session may list at most ${MAX_ATTENDEES} attendees.`);
  return out;
}
const SESSION_STATUSES = new Set<CodexSessionStatus>(["planned", "played"]);
/**
 * The TS half of the status gate. The SQL CHECK in migration v13 is the other half and neither replaces
 * the other: this one produces a message a GM can read, that one keeps the FILE honest against anything
 * that writes this database without going through the store.
 */
function sessionStatus(value: string | undefined): CodexSessionStatus {
  if (value === undefined) return "planned";
  if (!SESSION_STATUSES.has(value as CodexSessionStatus)) throw new Error("A session is either planned or played.");
  return value as CodexSessionStatus;
}
const JOURNAL_KINDS = new Set<CodexJournalKind>(["note", "combat", "deadline", "downtime", "milestone", "standing"]);
/**
 * A stored `kind` PARSED, not coerced. Before M11 this was inlined in `toEntry` as
 * `row.kind === "combat" ? "combat" : "note"`, which is fine for two kinds and actively dangerous for four:
 * a `deadline` row would have read back as an ordinary note, rendered as one, and produced ZERO compile
 * errors anywhere - the failure would have been a GM's deadline quietly not existing.
 *
 * Fail-closed to `note`, the same discipline `sessionStatus`/`questStatus` use for their enums, and here it
 * has a second job: a row written by a FUTURE version reads as a plain note on an older build rather than
 * throwing. Narrowing, never throwing - a read path that can throw turns one bad row into an unopenable
 * codex.
 *
 * M12 is the case that comment was written for, and it is worth recording that the mechanism worked exactly
 * as designed: `milestone` and `standing` rows were storable from v15 onward and read back as `note` until
 * this set gained the two words. Nothing threw, nothing failed to compile, and a GM's milestone would have
 * been an ordinary note on every screen. Forgetting the entry here is therefore SILENT, which is why there
 * is a test that round-trips both kinds rather than one that only checks they can be inserted.
 */
function journalKind(value: string): CodexJournalKind {
  return JOURNAL_KINDS.has(value as CodexJournalKind) ? (value as CodexJournalKind) : "note";
}
/** 3650 days = ten default years: long enough for "the wizard spends a decade in the tower", bounded enough to be a typo guard. */
const MAX_DOWNTIME_DAYS = 3650;
/**
 * CT-10's payload on the way IN. `who` and `activity` go through `shortLabel` (trim, reject control
 * characters, cap at 120 - the repo's one-line-of-display bound), and an empty one is legal for the reason
 * `questObjectives` spells out: the GM's real flow is "make the record, then fill it in", and the editor
 * autosaves, so rejecting a blank would 400 the first save.
 *
 * `applied` is not an input. Downtime is always created unapplied (O-3): only `applyDowntime` sets it, and
 * only once. Accepting it here would let a caller pre-apply a record and skip the clock move entirely.
 */
function downtimePayload(input: Readonly<{ who: string; activity: string; days: number; characterPageId?: string | null }>): CodexDowntimePayload {
  const days = input?.days;
  if (!Number.isInteger(days) || days < 0 || days > MAX_DOWNTIME_DAYS) throw new Error(`Downtime days must be a whole number from 0 to ${MAX_DOWNTIME_DAYS}.`);
  return {
    who: shortLabel(input.who, 120, "downtime participant") ?? "",
    activity: shortLabel(input.activity, 120, "downtime activity") ?? "",
    days, applied: false,
    characterPageId: optionalId(input.characterPageId)
  };
}
/** Read a stored payload defensively - malformed JSON degrades to `null`, never a throw (`parseObjectives`' rule). */
function parseDowntimePayload(raw: string | null | undefined): CodexDowntimePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as { who?: unknown; activity?: unknown; days?: unknown; applied?: unknown; characterPageId?: unknown };
    return {
      who: typeof value.who === "string" ? value.who : "",
      activity: typeof value.activity === "string" ? value.activity : "",
      days: typeof value.days === "number" && Number.isFinite(value.days) ? Math.max(0, Math.trunc(value.days)) : 0,
      // Coerced, not trusted, exactly as `questObjectives` treats `done`: anything but exactly `true` is
      // false, so a malformed value can never mark downtime as already applied and suppress the clock move.
      applied: value.applied === true,
      // D12: THE PARSER IS THE MIGRATION. Every payload written before this field existed lacks the key,
      // and this default supplies it as `null` on read - so the wire's "always present" guarantee holds
      // for old rows with no `json_set` sweep over `payload_json` at all. The same fail-closed reader
      // discipline every other field here follows: a non-string is null, never a dangling half-value.
      characterPageId: typeof value.characterPageId === "string" && ID.test(value.characterPageId) ? value.characterPageId : null
    };
  } catch { return null; }
}
/**
 * 5e's level ceiling, and the same number `packages/rules-5e`'s `clampLevel` uses - taken from there rather
 * than invented here, so a milestone cannot record a level the rules engine would refuse to build.
 */
const MAX_LEVEL = 20;
/**
 * CT-8's payload on the way IN. `level` is REJECTED rather than clamped when out of range, unlike standing's
 * `value`: a level is a fact the GM states about their party, and silently turning "level 25" into "level 20"
 * would answer a POST with something other than what it asked for. A standing is a position on a scale the
 * GM is dragging, where the ends of the scale ARE the answer.
 *
 * An empty `reason` is legal for the reason `questObjectives` and `downtimePayload` both spell out: the real
 * flow is "record it, then say why", and rejecting the blank would 400 the first save.
 */
function milestonePayload(input: Readonly<{ level: number; reason: string }>): CodexMilestonePayload {
  const level = input?.level;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new Error(`A milestone's level must be a whole number from 1 to ${MAX_LEVEL}.`);
  return { level, reason: shortLabel(input.reason, 120, "milestone reason") ?? "" };
}
/** Read a stored milestone payload defensively - malformed JSON degrades to `null` (`parseDowntimePayload`'s rule). */
function parseMilestonePayload(raw: string | null | undefined): CodexMilestonePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as { level?: unknown; reason?: unknown };
    return {
      // Clamped on the way OUT even though it is rejected on the way in: a hand-edited row must read back
      // as a plausible level rather than break every screen that renders one.
      level: typeof value.level === "number" && Number.isFinite(value.level) ? Math.min(MAX_LEVEL, Math.max(1, Math.trunc(value.level))) : 1,
      reason: typeof value.reason === "string" ? value.reason : ""
    };
  } catch { return null; }
}
/** M12-B: standing runs -100 (Hostile) to +100 (Allied), 0 being Neutral. SIGNED - a faction can be against the party. */
const MIN_STANDING = -100;
const MAX_STANDING = 100;
/**
 * CT-6's value on the way in: CLAMPED, not rejected. The GM is positioning a faction on a fixed scale, and
 * the ends of that scale are meaningful answers ("as hostile as it gets"), so a request that overshoots is
 * asking for the end rather than making a mistake. This is the deliberate opposite of `milestonePayload`'s
 * level, which is a stated fact and is rejected when it is not one; the two are commented so the difference
 * reads as a decision rather than an inconsistency.
 *
 * A non-finite or non-numeric value is still an error, not a clamp - `Math.trunc(NaN)` is `NaN`, and
 * clamping that would write NaN into a STRICT INTEGER column.
 */
function standingValue(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("A standing value must be a number from -100 to 100.");
  return Math.min(MAX_STANDING, Math.max(MIN_STANDING, Math.trunc(value)));
}

/**
 * The revision window's bounds and default (owner decision, 2026-07-30).
 *
 * `0` is INSIDE the range and is meaningful: it means "checkpoint every save", which is exactly the behaviour
 * every codex had before this change. It is emphatically NOT the same as `enabled: false`, and the two are
 * separate columns so that no reader has to guess which a `0` meant.
 *
 * `10080` is one week of minutes - a ceiling rather than a recommendation. Past a week the window stops
 * coalescing a work session and starts meaning "keep almost nothing", which is what `enabled: false` already
 * says more honestly, so there is no reason to offer more.
 */
const MIN_REVISION_WINDOW_MINUTES = 0;
const MAX_REVISION_WINDOW_MINUTES = 10_080;
const DEFAULT_REVISION_SETTINGS: CodexRevisionSettings = { enabled: true, windowMinutes: 90 };
/**
 * The ceiling on `deleteRevisionsOlderThan`'s age, and it is a GUARD rather than a policy: a value large enough
 * to push the cutoff date out of range makes `toISOString()` throw `RangeError: Invalid time value`, turning a
 * silly request into a 500. 100 years already deletes nothing in any real codex, so nothing legitimate is
 * refused by it. Measured against this build, not assumed.
 */
const MAX_PRUNE_DAYS = 36_500;
/**
 * The window on the way in: CLAMPED and TRUNCATED, `standingValue`'s arrangement verbatim and for the same
 * reason - the GM is dragging a slider along a fixed scale, so a request that overshoots is asking for the end
 * of the scale rather than making a mistake, and a fractional minute is a UI artefact rather than an intent.
 * The HTTP router still REJECTS out-of-range values with a 400 (its control cannot produce one, so a caller
 * that does is malformed); this clamp stands behind it for every non-HTTP writer.
 *
 * A non-finite value is an error, not a clamp: `Math.trunc(NaN)` is `NaN`, and clamping that would write NaN
 * into a STRICT INTEGER column.
 */
function revisionWindowMinutes(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`A revision window must be a number of minutes from ${MIN_REVISION_WINDOW_MINUTES} to ${MAX_REVISION_WINDOW_MINUTES}.`);
  return Math.min(MAX_REVISION_WINDOW_MINUTES, Math.max(MIN_REVISION_WINDOW_MINUTES, Math.trunc(value)));
}
/**
 * D6 / director ruling R4: the autosave interval's bounds and default, in SECONDS - the wire's unit, so no
 * conversion happens anywhere between the request body and the column.
 *
 * `1` is the FLOOR rather than a special value: today's page editor debounces at 800 ms, so one second is the
 * nearest honest expression of "what this codex already did", and it is also the default. Unlike
 * `windowMinutes`, `0` is not in range - a zero-second autosave is a save on every keystroke, which is not a
 * cadence anyone means; a GM who wants no autosave says `enabled: false`.
 *
 * `600` is ten minutes: past that the setting stops meaning "save while I work" and starts meaning "I will
 * save it myself", which `enabled: false` says more honestly - v17's ceiling reasoning applied to this scale.
 */
const MIN_AUTOSAVE_INTERVAL_SECONDS = 1;
const MAX_AUTOSAVE_INTERVAL_SECONDS = 600;
const DEFAULT_AUTOSAVE_SETTINGS: CodexAutosaveSettings = { enabled: true, intervalSeconds: 1 };
/**
 * The interval on the way in: CLAMPED and TRUNCATED, `revisionWindowMinutes`' arrangement verbatim and for
 * the same reason - the GM is picking from a scale, so an overshoot asks for the end of it, and a fractional
 * second is a control artefact rather than an intent. The HTTP router still REJECTS out-of-range values with
 * a 400; this clamp stands behind it for every non-HTTP writer (import, tests, a repair script).
 */
function autosaveIntervalSeconds(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`An autosave interval must be a number of seconds from ${MIN_AUTOSAVE_INTERVAL_SECONDS} to ${MAX_AUTOSAVE_INTERVAL_SECONDS}.`);
  return Math.min(MAX_AUTOSAVE_INTERVAL_SECONDS, Math.max(MIN_AUTOSAVE_INTERVAL_SECONDS, Math.trunc(value)));
}
/**
 * CT-6's payload on the way IN. `delta` is passed in already computed by `setStanding` (it is the difference
 * between two clamped values, so it is bounded by -200..200 and needs no clamp of its own).
 */
function standingPayload(input: Readonly<{ factionPageId: string; delta: number; reason: string }>): CodexStandingPayload {
  return { factionPageId: input.factionPageId, delta: Math.trunc(input.delta), reason: shortLabel(input.reason, 120, "standing reason") ?? "" };
}
/** Read a stored standing payload defensively - malformed JSON degrades to `null` (`parseDowntimePayload`'s rule). */
function parseStandingPayload(raw: string | null | undefined): CodexStandingPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as { factionPageId?: unknown; delta?: unknown; reason?: unknown };
    return {
      factionPageId: typeof value.factionPageId === "string" ? value.factionPageId : "",
      delta: typeof value.delta === "number" && Number.isFinite(value.delta) ? Math.trunc(value.delta) : 0,
      reason: typeof value.reason === "string" ? value.reason : ""
    };
  } catch { return null; }
}

/**
 * The type-safe way to ask "does this entry carry MY payload?", one per payload-bearing kind.
 *
 * `CodexJournalRow.payload` is a union and `CodexJournalRow` is deliberately not a discriminated union (see
 * `CodexEntryPayload`), so a reader that wants a downtime's `applied` would otherwise reach for a cast - and
 * a cast is precisely how a `standing` payload gets read as a `downtime` one, with no error anywhere and a
 * `delta` rendering as a day count. These check the KIND, not the shape, so they cannot be fooled by a
 * payload that happens to have compatible fields.
 *
 * Free functions taking a `Pick`, exactly as `deadlineFired` is: the rule "which kind owns which payload"
 * has one home, and every layer above reads it from here rather than restating it.
 */
type PayloadBearing = Pick<CodexJournalRow, "kind" | "payload">;
export function downtimePayloadOf(entry: PayloadBearing): CodexDowntimePayload | null {
  return entry.kind === "downtime" ? (entry.payload as CodexDowntimePayload | null) : null;
}
export function milestonePayloadOf(entry: PayloadBearing): CodexMilestonePayload | null {
  return entry.kind === "milestone" ? (entry.payload as CodexMilestonePayload | null) : null;
}
export function standingPayloadOf(entry: PayloadBearing): CodexStandingPayload | null {
  return entry.kind === "standing" ? (entry.payload as CodexStandingPayload | null) : null;
}
/**
 * The kind -> payload-parser mapping, written ONCE (`toEntry` is its only caller). An EXHAUSTIVE switch with
 * no `default`, deliberately: adding a seventh kind to `CodexJournalKind` is then a compile error here, and
 * whoever adds it has to say what it carries instead of getting a silent `null`. The three kinds that carry
 * nothing say so by name rather than falling through.
 */
function payloadOf(kind: CodexJournalKind, raw: string | null): CodexEntryPayload | null {
  switch (kind) {
    case "downtime": return parseDowntimePayload(raw);
    case "milestone": return parseMilestonePayload(raw);
    case "standing": return parseStandingPayload(raw);
    case "note": case "combat": case "deadline": return null;
  }
}
/**
 * Every column `writeEntry` needs. `payload` is REQUIRED rather than optional, so every kind's creator has
 * to say what it carries. Three of the six say `null`, and that is the point: an optional field would let a
 * seventh kind be added that silently stores nothing.
 */
type EntryFields = Readonly<{ playerText: string; gmText: string | null; revealed: number; attachMarkerId: string | null; attachPageId: string | null; kind: CodexJournalKind; sourceEncounterId: number | null; sessionId: string | null; realDate: string | null; inWorldLabel: string | null; calendarInstant: number | null; inWorldDate: CodexInWorldDate | null; tags?: readonly string[]; payload: CodexEntryPayload | null }>;
/**
 * CT-5's "fires when the campaign date passes it", and **the only place that comparison is written**
 * (D11-C). Every reader - the store, the projections, any dashboard count - goes through this one function,
 * because two copies of a `<=` is precisely how a dashboard ends up disagreeing with the timeline it is
 * counting.
 *
 * `fired` is DERIVED and never stored. K3 makes the raw date the source of truth and instants derived; a
 * stored `fired` would be a SECOND derived cache that `setCalendar`'s reflow would then have to maintain,
 * and a reflow that missed it would leave a deadline permanently fired on a date that no longer exists. The
 * one behavioural consequence is that rewinding the clock un-fires a deadline, which is correct: the
 * campaign has not reached that day.
 *
 * `at` is passed IN rather than read from the store, and that is a viewer-safety decision, not a style one.
 * There are two clocks now (D11-G): the GM's `currentDate` and the players' published date. A player's
 * `fired` MUST be computed against the published date - deriving it from the GM's clock would leak, one bit
 * at a time, that the GM has run their prep clock past a date they have not published, which is the whole
 * thing O-1 exists to keep private. Making the instant an argument is what stops a caller getting that
 * wrong silently. See `campaignInstant()` and `publishedInstant()`.
 *
 * An undated entry never fires (it has no day to arrive at), and a non-deadline never fires at all.
 */
export function deadlineFired(entry: Pick<CodexJournalRow, "kind" | "calendarInstant">, at: number | null): boolean {
  return entry.kind === "deadline" && entry.calendarInstant !== null && at !== null && entry.calendarInstant <= at;
}
const QUEST_STATUSES = new Set<CodexQuestStatus>(["active", "completed", "failed"]);
/** The TS half of the quest status gate; migration v14's CHECK is the other half (see `sessionStatus`). */
function questStatus(value: string | undefined): CodexQuestStatus {
  if (value === undefined) return "active";
  if (!QUEST_STATUSES.has(value as CodexQuestStatus)) throw new Error("A quest is active, completed, or failed.");
  return value as CodexQuestStatus;
}
const MAX_OBJECTIVES = 24;
/** 120 = the repo's one-line-of-display bound (a marker `label`, an `inWorldLabel`), and the number `CodexQuestObjective` publishes. */
const MAX_OBJECTIVE_TEXT = 120;
/**
 * The Codex's FIRST ordered mutable list, so the rules it establishes are worth stating outright:
 *
 *  - ORDER IS CONTENT. A quest's objectives are a sequence the GM authored ("find the key, then open the
 *    vault"), not a set that happens to arrive in an order. This `map` is therefore the whole
 *    transformation: it never sorts, never dedupes (two steps may legitimately read the same), and never
 *    keys identity off the array index across a write - a write replaces the list wholesale, so no index
 *    has to survive one. Any of those three would silently rewrite what the GM wrote.
 *  - AN EMPTY `text` IS LEGAL, and that is a decision rather than a gap. The checklist's real flow is "add
 *    a row, then type into it" - `@vtt/ui`'s `Checklist` renders a blank row as "Item N" and leaves the
 *    caller to append it - and the editor PATCHes the whole draft on autosave. Rejecting the blank row
 *    would 400 the very first save after "Add item", while DROPPING it would renumber the list under the
 *    GM's cursor. Both are worse than storing an empty line the GM can see and fill in.
 *
 *    KNOWN DIVERGENCE, flagged rather than silently resolved: `CodexQuestObjective` in
 *    `packages/api-contract` publishes `minLength: 1` on this field, so the document is stricter here
 *    than the server. The length CAP (120) matches it deliberately; the minimum does not, because
 *    enforcing it would break the Add-then-type flow the UI primitive is built around. One of the two
 *    should move - this comment exists so the choice is made rather than discovered.
 *  - `done` is coerced, not trusted: anything that is not exactly `true` is `false`, so a malformed value
 *    can never mark an objective complete.
 *
 * The 24-item cap is the bound this file already uses for "a list of things on one record" (`MAX_TAGS`,
 * `idArray`), rather than a new number invented for quests.
 */
function questObjectives(value: readonly CodexQuestObjective[] | undefined): CodexQuestObjective[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Objectives must be a list.");
  if (value.length > MAX_OBJECTIVES) throw new Error(`A quest may carry at most ${MAX_OBJECTIVES} objectives.`);
  return value.map((objective) => {
    const text = typeof objective?.text === "string" ? objective.text.trim() : "";
    if (text.length > MAX_OBJECTIVE_TEXT || CONTROL_CHARS.test(text)) throw new Error(`An objective is up to ${MAX_OBJECTIVE_TEXT} printable characters.`);
    return { text, done: objective?.done === true };
  });
}
/** Read stored objectives defensively - a malformed column degrades to an empty list, as `parseTags` does. */
function parseObjectives(raw: string | null | undefined): CodexQuestObjective[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Order-preserving, exactly as written: this is the read side of "order is content".
    return parsed
      .filter((entry): entry is { text?: unknown; done?: unknown } => !!entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({ text: typeof entry.text === "string" ? entry.text : "", done: entry.done === true }));
  } catch { return []; }
}

/** A page title reduced to a stable link target: lowercased, trimmed, whitespace collapsed. */
export function pageLinkKey(rawTitle: string): string {
  return rawTitle.trim().toLowerCase().replace(/\s+/g, " ");
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const TARGET_KINDS = new Set<CodexLinkTargetKind>(["page", "actor", "monster", "spell", "map", "marker"]);

/** Parse `[[...]]` references out of one markdown body into link edges (no dedupe here). */
export function parseWikiLinks(text: string, layer: "player" | "gm"): CodexLinkRow[] {
  const links: CodexLinkRow[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK)) {
    const inner = match[1].trim();
    if (!inner) continue;
    const [targetPart, sectionPart] = inner.split("#", 2);
    const section = sectionPart?.trim() || null;
    let targetKind: CodexLinkTargetKind = "page";
    let ref = targetPart.trim();
    const colon = ref.indexOf(":");
    if (colon > 0) {
      const prefix = ref.slice(0, colon).trim().toLowerCase();
      if (TARGET_KINDS.has(prefix as CodexLinkTargetKind)) { targetKind = prefix as CodexLinkTargetKind; ref = ref.slice(colon + 1).trim(); }
    }
    if (!ref) continue;
    const key = targetKind === "page" ? pageLinkKey(ref) : ref;
    const dedupe = `${layer}|${targetKind}|${key}|${section ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    links.push({ sourcePageId: "", layer, targetKind, targetRef: key, section });
  }
  return links;
}

export class CodexStore {
  private database?: DatabaseSync;

  constructor(private readonly databasePath: string, private readonly now: () => number = Date.now) {}

  async initialize() {
    if (this.database) return;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = new DatabaseSync(this.databasePath, { enableForeignKeyConstraints: true });
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
      database.exec("CREATE TABLE IF NOT EXISTS codex_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      this.database = database;
      this.migrate();
      const meta = database.prepare("SELECT codex_revision FROM codex_meta WHERE id = 1").get() as { codex_revision: number } | undefined;
      if (!meta) database.prepare("INSERT INTO codex_meta (id, codex_revision) VALUES (1, 0)").run();
    } catch (error) {
      database.close();
      this.database = undefined;
      throw error;
    }
  }

  close() { this.database?.close(); this.database = undefined; }

  /** The coarse counter bumped on every write - drives the `codex:changed` ping and list ETags. */
  get revision(): number {
    return (this.requireDatabase().prepare("SELECT codex_revision FROM codex_meta WHERE id = 1").get() as { codex_revision: number } | undefined)?.codex_revision ?? 0;
  }

  // ----- Pages -----

  createPage(input: CodexPageCreateInput): CodexPageRow {
    const database = this.requireDatabase();
    const pageId = this.freshId();
    const stamp = this.stamp();
    const createdType = entityType(input.entityType);
    // CD-2: fields are pruned to the page's own type on the way in, so a page can never be born
    // holding values its type has no field for (and therefore no way for the GM to see or remove).
    const sealed = sealSecretFields(
      pruneCodexFields(createdType, entityFields(input.fields)),
      pruneCodexFields(createdType, entityFields(input.gmFields))
    );
    // CT-11: one call, the SAME `resolveDate` a journal entry goes through - so a page's instant and label
    // are derived from its raw date by identical code, and `setCalendar` can reflow both from the same rule.
    const dated = this.resolveDate(input.inWorldDate, null);
    const row: PageRow = {
      id: pageId, title: title(input.title), entity_type: createdType, fields_json: JSON.stringify(sealed.fields), gm_fields_json: JSON.stringify(sealed.gmFields),
      folder: folder(input.folder), tags_json: JSON.stringify(tags(input.tags)),
      player_body: body(input.playerBody), gm_body: body(input.gmBody), revealed: input.revealedToPlayers ? 1 : 0,
      banner_asset_id: input.bannerAssetId ? id(input.bannerAssetId) : null,
      in_world_label: dated.label, calendar_instant: dated.instant,
      in_world_year: dated.date ? dated.date.year : null, in_world_month: dated.date ? dated.date.month : null, in_world_day: dated.date ? dated.date.day : null,
      rev: 1, created_at: stamp, updated_at: stamp
    };
    this.transaction(() => {
      database.prepare("INSERT INTO codex_pages (id, title, entity_type, fields_json, gm_fields_json, folder, tags_json, player_body, gm_body, revealed, banner_asset_id, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, rev, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.id, row.title, row.entity_type, row.fields_json, row.gm_fields_json, row.folder, row.tags_json, row.player_body, row.gm_body, row.revealed, row.banner_asset_id, row.in_world_label, row.calendar_instant, row.in_world_year, row.in_world_month, row.in_world_day, row.rev, row.created_at, row.updated_at);
      this.rebuildLinks(pageId, row.player_body, row.gm_body);
      this.indexPage(pageId, row.title, row.player_body, row.gm_body, row.fields_json, row.gm_fields_json, row.tags_json);
      this.registerFolderPath(row.folder, stamp);
      // NEVER throttled, unlike `updatePage`'s (owner decision, 2026-07-30). Two reasons, and the first is the
      // decisive one: a page with no history at all is the one case with nothing to fall back to. And there is
      // no PRIOR state to checkpoint here anyway - the row this snapshots is the one it just created, which
      // makes the moment of creation a legitimate checkpoint in its own right rather than an exception.
      // Never THROTTLED - a page with no history has nothing to fall back to - but it does honour the global
      // switch. "Globally disable-able" has to mean off: a codex with history disabled would otherwise still
      // accumulate one checkpoint per page, and the client says in as many words that nothing new is written.
      if (this.revisionSettings().enabled) this.snapshotRevision(pageId, row, "codex:create");
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  /**
   * `forceRevision` is set by `restoreRevision` alone (see the call below). It is deliberately the LAST
   * parameter and defaults false, so every existing caller - the PATCH route included - is unchanged and no
   * request can ask for it.
   */
  updatePage(pageId: string, input: CodexPageUpdateInput, expectedRev: number | undefined, authorTag: string, forceRevision = false): CodexPageRow {
    const database = this.requireDatabase();
    const existing = this.pageRow(pageId);
    if (!existing) throw new CodexNotFoundError("That page no longer exists.");
    // CD-3 / D-4: the Codex is single-writer and last-writer-wins. The old copy ("Reload to keep
    // editing") promised a recovery step that does not exist — the next keystroke simply resyncs the
    // revision and saves. Say what actually happened instead of prescribing a fix.
    if (expectedRev !== undefined && expectedRev !== existing.rev) throw new CodexRevisionConflictError("This page was changed somewhere else after you opened it.");
    const nextEntityType = input.entityType === undefined ? (existing.entity_type as CodexEntityType) : entityType(input.entityType);
    // Re-seal whenever either field map is touched (covers restores + raw writes): secret keys never rest in `fields`.
    //
    // CD-2: also prune to the *effective* type, and do it on a bare type switch too. A switch used to
    // keep the old type's values in `fields_json`, where the editor renders only the new type's keys —
    // so the GM could neither see nor delete them, while a revealed page still shipped them to players.
    // Pruning is recoverable: a save snapshots the prior state into `codex_page_revisions` (which nothing
    // ever prunes), so `restoreRevision` restores the old type together with its values. Since 2026-07-30
    // that snapshot is THROTTLED (`revisionDue`), so the recoverable state may be up to `windowMinutes` old
    // rather than the immediately preceding one - the owner's accepted trade, not a gap.
    let fieldsJson = existing.fields_json;
    let gmFieldsJson = existing.gm_fields_json;
    if (input.fields !== undefined || input.gmFields !== undefined || nextEntityType !== existing.entity_type) {
      const baseFields = input.fields === undefined ? parseFields(existing.fields_json) : entityFields(input.fields);
      const baseGm = input.gmFields === undefined ? parseFields(existing.gm_fields_json) : entityFields(input.gmFields);
      const sealed = sealSecretFields(pruneCodexFields(nextEntityType, baseFields), pruneCodexFields(nextEntityType, baseGm));
      fieldsJson = JSON.stringify(sealed.fields);
      gmFieldsJson = JSON.stringify(sealed.gmFields);
    }
    // CT-11, the journal's `updateEntry` contract verbatim: an OMITTED `inWorldDate` leaves the stored date
    // alone, an explicit `null` clears it. That matters for the page editor, which PATCHes the whole draft on
    // every autosave - a rule of "absent means clear" would erase an event's date the first time its body
    // was touched from any surface that does not know about dates.
    const dated = input.inWorldDate !== undefined ? this.resolveDate(input.inWorldDate, null) : null;
    const next: PageRow = {
      ...existing,
      title: input.title === undefined ? existing.title : title(input.title),
      entity_type: nextEntityType,
      fields_json: fieldsJson,
      gm_fields_json: gmFieldsJson,
      folder: input.folder === undefined ? existing.folder : folder(input.folder),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      player_body: input.playerBody === undefined ? existing.player_body : body(input.playerBody),
      gm_body: input.gmBody === undefined ? existing.gm_body : body(input.gmBody),
      banner_asset_id: input.bannerAssetId === undefined ? existing.banner_asset_id : (input.bannerAssetId ? id(input.bannerAssetId) : null),
      in_world_label: dated ? dated.label : existing.in_world_label,
      calendar_instant: dated ? dated.instant : existing.calendar_instant,
      in_world_year: dated ? (dated.date ? dated.date.year : null) : existing.in_world_year,
      in_world_month: dated ? (dated.date ? dated.date.month : null) : existing.in_world_month,
      in_world_day: dated ? (dated.date ? dated.date.day : null) : existing.in_world_day,
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET title = ?, entity_type = ?, fields_json = ?, gm_fields_json = ?, folder = ?, tags_json = ?, player_body = ?, gm_body = ?, banner_asset_id = ?, in_world_label = ?, calendar_instant = ?, in_world_year = ?, in_world_month = ?, in_world_day = ?, rev = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.entity_type, next.fields_json, next.gm_fields_json, next.folder, next.tags_json, next.player_body, next.gm_body, next.banner_asset_id, next.in_world_label, next.calendar_instant, next.in_world_year, next.in_world_month, next.in_world_day, next.rev, next.updated_at, pageId);
      this.rebuildLinks(pageId, next.player_body, next.gm_body);
      this.indexPage(pageId, next.title, next.player_body, next.gm_body, next.fields_json, next.gm_fields_json, next.tags_json);
      this.registerFolderPath(next.folder, next.updated_at);
      /**
       * Checkpoint the state as it was BEFORE this save (`existing`), not the state this save produced
       * (`next`) - and throttle it (owner decision, 2026-07-30; see `revisionDue`).
       *
       * The two used to be nearly interchangeable, which is exactly why the direction never mattered before:
       * with EVERY save snapshotted, the set of restorable states is the same either way, shifted by one. It
       * becomes load-bearing the moment saves are skipped, and this is the change that makes skipping SAFE:
       *
       *   With new-state snapshots, a save at t=0 is snapshotted, saves through t=80 are skipped, the GM stops,
       *   and then a save that ruins the page at t=3000 snapshots the RUINED state. The good t=80 work was
       *   never captured and the GM falls back to t=0.
       *
       *   With prior-state snapshots, that ruinous save first checkpoints the good state it is about to
       *   overwrite. That is what makes "at most 90 minutes of work could be lost" true across an IDLE GAP and
       *   not only during continuous work - the gap is precisely when the naive version loses everything.
       *
       * A consequence, deliberate and not hidden: the newest revision is now normally BEHIND the page's current
       * state where it used to equal it, so `restoreRevision` on the newest entry is a real undo rather than the
       * no-op it was. That is the feature, not a side effect.
       *
       * `authorTag` still names the save that produced this revision ROW - which, under prior-state semantics,
       * is the save that DISPLACED the content rather than the one that wrote it. Nothing is lost by that: the
       * store keeps no per-save author on `codex_pages` to recover the original from, and this app has exactly
       * one authoring principal (the GM).
       */
      /**
       * `forceRevision` is the RESTORE path, and it is preserving existing behaviour rather than adding a
       * policy. Every save checkpointed before the throttle existed, so a restore always left the state it
       * discarded recoverable; with the throttle, a restore inside the window would silently drop it and
       * "I restored the wrong version" would become unrecoverable. Restoring is the one save that deliberately
       * throws the current text away, which makes it the one that most needs the state it throws away kept.
       *
       * `revisionExistsAt` still applies, so this cannot write a duplicate of a state already captured.
       *
       * D7 / director ruling R7 adds the SECOND forcing condition, and it is the same argument one case
       * further along: a TYPE-CHANGING save is the other save that deliberately throws content away. The
       * pruning a few lines above drops every field the new type does not declare, and the client's confirm
       * dialog promises "you can restore them from History" - a promise the coalescing window would break
       * roughly half the time, because a GM who types a page and then fixes its kind is inside the window by
       * construction. Forcing here turns that copy into a guarantee instead of a probability.
       *
       * It is computed here rather than passed in: no caller should be able to ask for it or forget it, and
       * "the type changed" is a fact about this save that `updatePage` already knows.
       */
      const typeChanged = nextEntityType !== existing.entity_type;
      if (this.revisionDue(pageId, forceRevision || typeChanged) && !this.revisionExistsAt(pageId, existing.rev)) {
        this.snapshotRevision(pageId, existing, authorTag);
      }
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  /**
   * CI-9: showing or hiding a page does NOT move its recency. "Recently updated" answers "what have I
   * been writing?", and a reveal sweep before a session would otherwise refill the whole list with pages
   * nobody edited. The coarse revision still bumps, so every client refetches the new reveal state.
   */
  setPageRevealed(pageId: string, revealed: boolean): CodexPageRow {
    const database = this.requireDatabase();
    if (!this.pageRow(pageId)) throw new CodexNotFoundError("That page no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, pageId);
      this.bumpRevision();
    });
    return this.getPage(pageId)!;
  }

  /**
   * Rename/move a folder: re-path every page in `fromPath` and its descendants to `toPath` (or to the top
   * level when `toPath` is empty). Reorganization, not a content edit, so it re-paths in place without
   * snapshotting a revision per page. Returns how many pages moved.
   *
   * CI-9: and, for the same reason, without moving `updated_at` - filing is not writing, and tidying one
   * folder used to shove every page in it to the top of "Recently updated". `rev` DOES still bump: that
   * is the editor's conflict token, not a recency signal, and an open editor's copy really is stale once
   * its page has been re-pathed. The two are deliberately separated here.
   */
  moveFolder(fromPath: string, toPath: string): number {
    const database = this.requireDatabase();
    const from = folder(fromPath);
    if (!from) throw new Error("Choose a folder to move.");
    const to = folder(toPath); // null => top level
    if (to !== null && (to === from || to.startsWith(`${from}/`))) throw new Error("Can't move a folder into itself.");
    // Re-path a folder value under `from` onto `to` (used for both pages and folder records).
    const repath = (value: string): string | null => folder(value === from ? (to ?? "") : to === null ? value.slice(from.length + 1) : to + value.slice(from.length));
    let moved = 0;
    this.transaction(() => {
      const stamp = this.stamp();
      const rows = database.prepare("SELECT id, folder FROM codex_pages WHERE folder = ? OR folder LIKE ?").all(from, `${from}/%`) as { id: string; folder: string }[];
      const update = database.prepare("UPDATE codex_pages SET folder = ?, rev = rev + 1 WHERE id = ?");
      for (const row of rows) { update.run(repath(row.folder), row.id); moved += 1; } // folder() re-validates depth/length + normalizes "" -> null
      // Carry the folder RECORDS along too, so a renamed/moved empty folder keeps existing at its new path.
      const recs = database.prepare("SELECT path FROM codex_folders WHERE path = ? OR path LIKE ?").all(from, `${from}/%`) as { path: string }[];
      const dropRec = database.prepare("DELETE FROM codex_folders WHERE path = ?");
      const addRec = database.prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)");
      for (const rec of recs) { dropRec.run(rec.path); const next = repath(rec.path); if (next) addRec.run(next, stamp); }
      if (moved > 0 || recs.length > 0) this.bumpRevision();
    });
    return moved;
  }

  /** Every explicitly-created folder path (records only - the tree unions these with page-derived paths). */
  listFolders(): string[] {
    return (this.requireDatabase().prepare("SELECT path FROM codex_folders ORDER BY path COLLATE NOCASE").all() as { path: string }[]).map((row) => row.path);
  }
  /** Create (or keep) an empty folder that persists with no pages in it. Returns the normalized path. */
  createFolder(path: string): string {
    const database = this.requireDatabase();
    const clean = folder(path);
    if (!clean) throw new Error("Name the folder.");
    this.transaction(() => {
      database.prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)").run(clean, this.stamp());
      this.bumpRevision();
    });
    return clean;
  }
  /** Ensure a page's folder path (and its ancestors) exist as records, so the folder persists once the page leaves. */
  private registerFolderPath(path: string | null, stamp: string): void {
    if (!path) return;
    const insert = this.requireDatabase().prepare("INSERT OR IGNORE INTO codex_folders (path, created_at) VALUES (?, ?)");
    let acc = "";
    for (const segment of path.split("/")) { acc = acc ? `${acc}/${segment}` : segment; insert.run(acc, stamp); }
  }
  /**
   * Delete a folder (and its subfolders): every page anywhere under it drops to the top level - never
   * deleted. CI-9: that drop is a folder move by another name, so it re-paths on the same terms as
   * `moveFolder` - `rev` bumps, `updated_at` does not.
   */
  deleteFolder(path: string): void {
    const database = this.requireDatabase();
    const clean = folder(path);
    if (!clean) return;
    this.transaction(() => {
      database.prepare("UPDATE codex_pages SET folder = NULL, rev = rev + 1 WHERE folder = ? OR folder LIKE ?").run(clean, `${clean}/%`);
      database.prepare("DELETE FROM codex_folders WHERE path = ? OR path LIKE ?").run(clean, `${clean}/%`);
      this.bumpRevision();
    });
  }

  deletePage(pageId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(pageId)) return;
    this.transaction(() => {
      this.unindex("page", pageId);
      // Markers and journal pins that pointed here become label-only rather than dangling.
      // Drop the deleted page from every marker's page_ids array (json_group_array is NULL for an empty set).
      database.prepare("UPDATE codex_markers SET page_ids_json = COALESCE((SELECT json_group_array(value) FROM json_each(codex_markers.page_ids_json) WHERE value != ?), '[]'), updated_at = ? WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.page_ids_json) WHERE value = ?)").run(pageId, this.stamp(), pageId);
      database.prepare("UPDATE codex_journal SET attach_page_id = NULL, updated_at = ? WHERE attach_page_id = ?").run(this.stamp(), pageId);
      /**
       * M10's quests are the THIRD referrer to a page and were not joined to this cleanup, so a deleted
       * page's id stayed inside `entity_ids_json` — a link the GM sees on the quest and cannot follow.
       * Verified before fixing: delete a linked page, and `getQuest().entityIds` still contains its id.
       *
       * Same shape as the marker clean-up two lines up, and the same reason: a reference to a record that no
       * longer exists is worse than no reference. `projectPlayerQuest` already dropped it incidentally (a
       * deleted page is never in `revealedEntityIds`), so this fixes the GM's view, which is the broken one.
       * A page's OWN links and revisions still go by FK cascade; `entity_ids_json` is a JSON array and has
       * no FK to cascade through, which is precisely why it needs saying here.
       */
      database.prepare("UPDATE codex_quests SET entity_ids_json = COALESCE((SELECT json_group_array(value) FROM json_each(codex_quests.entity_ids_json) WHERE value != ?), '[]'), updated_at = ? WHERE EXISTS (SELECT 1 FROM json_each(codex_quests.entity_ids_json) WHERE value = ?)").run(pageId, this.stamp(), pageId);
      /**
       * D12: downtime records are the FOURTH referrer to a page, and the only one that keeps its id inside
       * a JSON blob rather than a column or an array. Scrubbing it to null is what stops the tracker
       * rendering an unfollowable link; `who` survives as the display fallback, so the row still says whose
       * week it was. The chronicle RECORD survives the page, exactly as a `standing` record does - "Ireena
       * spent a month forging" stays true after her page is gone.
       *
       * `json_valid` first, as everywhere else in this file: `json_set` THROWS on a malformed blob rather
       * than returning null, and one hand-edited payload must not make a page undeletable.
       */
      database.prepare("UPDATE codex_journal SET payload_json = json_set(payload_json, '$.characterPageId', json('null')), updated_at = ? WHERE kind = 'downtime' AND json_valid(payload_json) AND json_extract(payload_json, '$.characterPageId') = ?").run(this.stamp(), pageId);
      database.prepare("DELETE FROM codex_pages WHERE id = ?").run(pageId); // cascades links + revisions
      this.bumpRevision();
    });
  }

  getPage(pageId: string): CodexPageRow | null {
    if (!ID.test(pageId)) return null;
    const row = this.pageRow(pageId);
    return row ? this.toPage(row) : null;
  }

  listPages(filter?: Readonly<{ folder?: string | null; tag?: string }>): CodexPageSummaryRow[] {
    const rows = this.requireDatabase()
      .prepare(`SELECT ${PAGE_SUMMARY_COLUMNS} FROM codex_pages ORDER BY title COLLATE NOCASE`)
      .all() as Array<Omit<PageRow, "player_body" | "gm_body">>;
    return rows
      .map((row) => ({
        id: row.id, title: row.title, entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json),
        folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
        revealedToPlayers: row.revealed === 1, bannerAssetId: row.banner_asset_id,
        inWorldLabel: row.in_world_label, calendarInstant: row.calendar_instant, inWorldDate: pageDateOf(row),
        rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
      }))
      .filter((page) => (filter?.folder === undefined || page.folder === filter.folder) && (filter?.tag === undefined || page.tags.includes(filter.tag)));
  }

  /** A full GM-only export of the whole codex for backup / round-trip (every field, both bodies). */
  exportBundle(): Readonly<{ pages: CodexPageRow[]; maps: CodexMapRow[]; markers: CodexMarkerRow[]; journal: CodexJournalRow[]; relationships: CodexRelationshipRow[]; sessions: CodexSessionRow[]; activeSessionId: string | null; quests: CodexQuestRow[]; publishedDate: CodexInWorldDate | null; standing: CodexStandingRow[]; partyMarkerId: string | null; calendar: CodexCalendar; folders: string[]; revisions: CodexPageRevisionExportRow[] }> {
    const pages = (this.requireDatabase().prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages ORDER BY title COLLATE NOCASE`).all() as PageRow[]).map((row) => this.toPage(row));
    const maps = this.listMaps();
    const markers = maps.flatMap((map) => this.listMarkers(map.id));
    // M9: sessions and the active pointer travel with the backup. A record type that exists but is not
    // exported is a silent hole in a GM's only copy of their prep - and unlike everything else here, a
    // session's `prepBody` is the one thing in the codex that exists nowhere else at all.
    //
    // M10: quests join for the same reason, stated once so it does not have to be rediscovered a third
    // time. M9 shipped without this and had to be corrected for it; a quest's `gmBody` and its objective
    // list exist nowhere else either, so an export that omitted them would look healthy in a directory
    // listing and be incomplete on restore. Appended LAST so no existing key moves.
    //
    // M11, third time, same reason: `publishedDate` lives in three columns on `codex_meta` and nowhere else
    // (D11-G), so a bundle without it restores a codex where the two clocks silently agree - the party
    // jumped forward to wherever the GM's prep had reached. A downtime's `payload` needs no key of its own:
    // it rides on the journal rows this already carries, because it is a field on the entry.
    //
    // The bundle omitted the CALENDAR ITSELF until 2026-07-30 (CLOSED below), which predated M11 and was
    // left alone at the time rather than fixed opportunistically - it was a real gap (a restored codex
    // re-derives every instant against the default 12x30 calendar), but it was not that milestone's, and
    // widening the bundle is a change every consumer of `GET /codex/export` sees.
    //
    // M12, fourth time, same reason: `codex_standing` is a table of its own and exists nowhere else, so a
    // bundle without it restores a codex where every faction is silently back at Neutral - and the
    // `kind='standing'` records ON the timeline would then be a history of movements from a position the
    // restored file no longer holds. `partyMarkerId` is technically redundant now that each marker carries
    // `isParty`, and it is here anyway: it is the one fact in this bundle that is an atlas-wide SINGLETON,
    // so a reader can check it directly instead of scanning every pin on every map and hoping exactly one
    // comes back. Both appended LAST so no existing key moves.
    //
    // 2026-07-30, fifth time and the last of the known gaps - the owner approved closing all three at once,
    // so the paragraph above is now history rather than a standing caveat. Same reason as every entry above:
    // each of these exists NOWHERE ELSE in the bundle, so a restore that lacks it is quietly wrong rather
    // than obviously broken. Appended LAST, in this order, so no existing key moves.
    //
    //  - `calendar` is the gap the M11 paragraph named. `getCalendar()` rather than the raw `calendar_json`
    //    column, for three reasons: every other key here is a mapped ROW and not a stored blob, so a JSON
    //    STRING would be the one key a reader has to parse twice; the getter normalizes and falls back to
    //    the default 12x30 calendar, which is exactly the calendar an unset column's instants were computed
    //    against, so writing it explicitly records what the bundle's own `calendarInstant` values MEAN
    //    rather than leaving the reader to guess; and it is the same read every other consumer of the
    //    calendar uses, so the backup cannot drift from the app. `publishedDate` stays its own key and is
    //    NOT duplicated in here: `calendar.currentDate` is the GM's clock and `publishedDate` is the
    //    party's, and D11-H is that the two are separate facts (see `getPublishedDate`).
    //  - `folders` is `codex_folders`, whose whole purpose is the EMPTY folder (v9): a folder that still
    //    holds pages is re-derivable from `codex_pages.folder`, an empty one is derivable from nothing at
    //    all. Without this key, restoring a backup silently deletes every folder the GM had emptied but
    //    kept - the one part of their filing that only this table remembers.
    //  - `revisions` is `codex_page_revisions`, the codex's only undo. A page save snapshots the prior state
    //    there and nothing else does, so a bundle without it restores a codex whose entire history is one
    //    revision deep. It is the ONE key here that DOMINATES the bundle's size, and it USED to be unbounded:
    //    nothing prunes the table, and a revision row weighs the same as a page row (both bodies), so the
    //    bundle grew to roughly (1 + revisions-per-page) x its old size. Measured, not estimated: a codex
    //    of 200 pages x 15 revisions x 3KB per body exports 1.25 MB before this key and 19.73 MB after
    //    (18.47 MB of it revisions).
    //    That measurement is what provoked the owner's 2026-07-30 decision, and the bound it chose was the one
    //    named right here: bound the WRITES, never the export. `revisionDue` coalesces saves inside a window
    //    and can switch history off entirely, so the table stops growing per keystroke - but nothing prunes it
    //    and this key still carries whatever rows exist, verbatim. An export that carried only SOME of the
    //    history would be a backup that lies about being one, and a codex whose history stopped growing is
    //    still a codex whose whole history must round-trip.
    return {
      pages, maps, markers, journal: this.listTimeline(), relationships: this.listAllRelationships(),
      sessions: this.listSessions(), activeSessionId: this.activeSessionId, quests: this.listQuests(),
      publishedDate: this.getPublishedDate(), standing: this.listStanding(), partyMarkerId: this.partyMarker()?.id ?? null,
      calendar: this.getCalendar(), folders: this.listFolders(), revisions: this.listAllRevisions()
    };
  }

  // ----- Relationships (typed entity edges) -----

  createRelationship(fromPageId: string, toPageId: string, type: string): CodexRelationshipRow {
    const database = this.requireDatabase();
    const from = id(fromPageId);
    const to = id(toPageId);
    if (from === to) throw new Error("An entity can't relate to itself.");
    if (!this.pageRow(from) || !this.pageRow(to)) throw new CodexNotFoundError("One of those pages no longer exists.");
    const relType = relationshipType(type);
    // Same from/to/type is idempotent. For symmetric types (ally/enemy/...) the reverse direction is the SAME edge.
    const existing = (SYMMETRIC_RELATIONSHIPS.has(relType)
      ? database.prepare("SELECT id, from_page_id, to_page_id, type, created_at FROM codex_relationships WHERE ((from_page_id = ? AND to_page_id = ?) OR (from_page_id = ? AND to_page_id = ?)) AND type = ?").get(from, to, to, from, relType)
      : database.prepare("SELECT id, from_page_id, to_page_id, type, created_at FROM codex_relationships WHERE from_page_id = ? AND to_page_id = ? AND type = ?").get(from, to, relType)) as RelationshipRowRaw | undefined;
    // An idempotent no-op is not an edit: the early return leaves both pages' recency alone on purpose.
    if (existing) return this.toRel(existing);
    const relId = this.freshId();
    this.transaction(() => {
      const stamp = this.stamp();
      database.prepare("INSERT INTO codex_relationships (id, from_page_id, to_page_id, type, created_at) VALUES (?, ?, ?, ?, ?)").run(relId, from, to, relType, stamp);
      this.touchPages([from, to], stamp);
      this.bumpRevision();
    });
    return this.toRel(database.prepare("SELECT id, from_page_id, to_page_id, type, created_at FROM codex_relationships WHERE id = ?").get(relId) as RelationshipRowRaw);
  }

  deleteRelationship(relId: string): void {
    if (!ID.test(relId)) return;
    const database = this.requireDatabase();
    // Read the endpoints BEFORE the row goes, so both pages' recency can move with the edit (CI-9).
    const existing = database.prepare("SELECT from_page_id, to_page_id FROM codex_relationships WHERE id = ?").get(relId) as { from_page_id: string; to_page_id: string } | undefined;
    this.transaction(() => {
      database.prepare("DELETE FROM codex_relationships WHERE id = ?").run(relId);
      if (existing) this.touchPages([existing.from_page_id, existing.to_page_id], this.stamp());
      this.bumpRevision();
    });
  }

  /** Every relationship touching this page, the OTHER endpoint resolved (title/type/reveal) with direction. */
  listRelationshipsFor(pageId: string): CodexRelationshipView[] {
    if (!ID.test(pageId)) return [];
    const database = this.requireDatabase();
    const view = (rows: Array<{ id: string; type: string; other_id: string; other_title: string; other_type: string; other_revealed: number }>, direction: "out" | "in"): CodexRelationshipView[] =>
      rows.map((row) => ({ id: row.id, type: row.type, direction, otherPageId: row.other_id, otherTitle: row.other_title, otherType: (row.other_type as CodexEntityType) ?? "note", otherRevealed: row.other_revealed === 1 }));
    const outgoing = database.prepare(
      "SELECT r.id, r.type, r.to_page_id AS other_id, p.title AS other_title, p.entity_type AS other_type, p.revealed AS other_revealed FROM codex_relationships r JOIN codex_pages p ON p.id = r.to_page_id WHERE r.from_page_id = ? ORDER BY r.type, p.title COLLATE NOCASE"
    ).all(pageId) as Array<{ id: string; type: string; other_id: string; other_title: string; other_type: string; other_revealed: number }>;
    const incoming = database.prepare(
      "SELECT r.id, r.type, r.from_page_id AS other_id, p.title AS other_title, p.entity_type AS other_type, p.revealed AS other_revealed FROM codex_relationships r JOIN codex_pages p ON p.id = r.from_page_id WHERE r.to_page_id = ? ORDER BY r.type, p.title COLLATE NOCASE"
    ).all(pageId) as Array<{ id: string; type: string; other_id: string; other_title: string; other_type: string; other_revealed: number }>;
    return [...view(outgoing, "out"), ...view(incoming, "in")];
  }

  /** All relationship edges (for the graph). */
  listAllRelationships(): CodexRelationshipRow[] {
    return (this.requireDatabase().prepare("SELECT id, from_page_id, to_page_id, type, created_at FROM codex_relationships").all() as RelationshipRowRaw[]).map((row) => this.toRel(row));
  }

  /**
   * CI-9: a relationship edit IS an edit of both pages it connects - the Connections section is part of
   * the page - so it moves their recency. It deliberately does NOT bump `rev`: `rev` is the editor's
   * conflict token, and bumping it would 409 a GM mid-sentence on a page whose body nobody touched.
   * Recency and conflict detection are separate concerns and this is the seam between them.
   */
  private touchPages(pageIds: readonly string[], stamp: string) {
    const update = this.requireDatabase().prepare("UPDATE codex_pages SET updated_at = ? WHERE id = ?");
    for (const pageId of pageIds) update.run(stamp, pageId);
  }

  private toRel(row: RelationshipRowRaw): CodexRelationshipRow {
    return { id: row.id, fromPageId: row.from_page_id, toPageId: row.to_page_id, type: row.type, createdAt: row.created_at };
  }

  // ----- Codex-wide settings -----

  /**
   * Every codex-wide setting, plus what the kept history COSTS (owner decision, 2026-07-30).
   *
   * The usage figures are computed here and NOT by `revisionSettings` below, which is the split that matters
   * for performance rather than tidiness: `revisionSettings` is read on EVERY page save and stays one indexed
   * lookup of the singleton meta row, while this aggregate scans `codex_page_revisions` and is only ever run
   * for the settings screen.
   */
  getSettings(): CodexSettings {
    return { revisionHistory: { ...this.revisionSettings(), ...this.revisionHistoryUsage() }, autosave: this.autosaveSettings() };
  }

  /**
   * What the kept history costs. ONE aggregate over the WHOLE table - not one page's rows - because the
   * question it answers ("is my history worth trimming?") is about the codex, and the delete it sits beside is
   * table-wide too.
   *
   * **Which columns are summed, and why those:** every column that carries a copy of the PAGE'S CONTENT -
   * `player_body` and `gm_body` (the dominant weight, and the reason a revision row weighs the same as a page
   * row), `fields_json` and `gm_fields_json` (the typed entity fields a restore needs), `title`, and
   * `tags_json`. That set is exactly "what a revision duplicates from its page", so leaving any of it out would
   * make the figure disagree with what the row is for. Everything else on the row is fixed-size bookkeeping:
   * `id`, `page_id`, `rev`, `entity_type`, `banner_asset_id`, `authored_at`, `author_tag`.
   *
   * `LENGTH()` counts CHARACTERS, not bytes - so for the mostly-ASCII prose a codex holds this equals bytes,
   * and for accented or CJK text it under-counts. Left as-is deliberately: the figure is declared approximate,
   * and it exists to be compared against ITSELF before and after a trim, not against the sqlite file. Every
   * summed column is NOT NULL, so the only null to handle is `SUM` over an empty table, which `COALESCE` does.
   */
  private revisionHistoryUsage(): CodexRevisionHistoryUsage {
    const row = this.requireDatabase().prepare(
      `SELECT COUNT(*) AS version_count,
              COALESCE(SUM(LENGTH(title) + LENGTH(player_body) + LENGTH(gm_body) + LENGTH(fields_json) + LENGTH(gm_fields_json) + LENGTH(tags_json)), 0) AS version_bytes
       FROM codex_page_revisions`
    ).get() as { version_count: number; version_bytes: number } | undefined;
    return { versionCount: row?.version_count ?? 0, versionBytes: row?.version_bytes ?? 0 };
  }

  /**
   * The two settable knobs alone (owner decision, 2026-07-30). Read on EVERY page save, so it is one indexed
   * SELECT of the singleton meta row and nothing more - the usage aggregate deliberately does not live here.
   *
   * **Both values are re-validated on the way OUT, and that is not belt-and-braces.** `getPublishedDate`
   * learned this the hard way and its comment records the incident: the write is not the only way into an
   * INTEGER column - a repair script or a hand-edited database reaches the same place - and a stored value
   * JavaScript cannot represent makes `node:sqlite` THROW rather than return something odd. Measured against
   * this build, not assumed: 2^53-1 reads back fine, 2^53 throws `RangeError: Value is too large to be
   * represented as a JavaScript number`, and it poisons the WHOLE row read, not just its own column - which is
   * why one bad column falls back to the defaults for both rather than for itself alone.
   *
   * A stored NON-INTEGER is impossible rather than merely unlikely, and it is worth saying which guard is doing
   * what: `codex_meta` is a STRICT table, so an INTEGER column REJECTS `90.5` outright ("cannot store REAL
   * value in INTEGER column") and losslessly converts `90.0` / `'45'`. Magnitude and RANGE are the only ways a
   * stored value can be wrong, so those are what the guards below actually catch - `Number.isSafeInteger` plus
   * the bounds. Reading a bad value as the DEFAULT is right rather than merely safe: an out-of-range window is
   * not a window, so the honest answer is the one the codex would have had if nobody had ever set it.
   *
   * `enabled` accepts EXACTLY 0 or 1 and reads anything else as the default (on). Fail-OPEN is the correct
   * direction here and the opposite of this file's usual reveal discipline: a garbled value must not silently
   * stop recording the GM's undo history, which is the one outcome that loses data.
   */
  private revisionSettings(): CodexRevisionSettings {
    let row: { revision_history_enabled: number; revision_window_minutes: number } | undefined;
    try {
      row = this.requireDatabase().prepare("SELECT revision_history_enabled, revision_window_minutes FROM codex_meta WHERE id = 1")
        .get() as { revision_history_enabled: number; revision_window_minutes: number } | undefined;
    } catch { return DEFAULT_REVISION_SETTINGS; }
    if (!row) return DEFAULT_REVISION_SETTINGS;
    const stored = row.revision_window_minutes;
    const inRange = Number.isSafeInteger(stored) && stored >= MIN_REVISION_WINDOW_MINUTES && stored <= MAX_REVISION_WINDOW_MINUTES;
    return {
      enabled: row.revision_history_enabled === 0 || row.revision_history_enabled === 1
        ? row.revision_history_enabled === 1
        : DEFAULT_REVISION_SETTINGS.enabled,
      windowMinutes: inRange ? stored : DEFAULT_REVISION_SETTINGS.windowMinutes
    };
  }

  /**
   * Replace the codex-wide settings and answer with the FULL READ SHAPE, re-read from the database - so a caller
   * that overshot the window's range sees the clamped value rather than believing its own number took, and gets
   * the usage figures a GET would have given it without a second round trip.
   *
   * It takes `CodexSettingsInput`, not `CodexSettings`: the usage figures are facts about a table the caller
   * cannot see, so there is no shape in which they could be sent.
   *
   * The UPDATE sits inside `this.transaction` beside `bumpRevision`, the shape `setPageRevealed` uses: one
   * `BEGIN IMMEDIATE`, one coarse revision bump, so every client refetches. No private leaf-level helper the
   * way `writeCalendar` / `writePublishedDate` have one - those exist because a SECOND caller needed to compose
   * them into an outer transaction (F-2: `transaction()` is a bare `BEGIN IMMEDIATE` and does not nest), and
   * nothing composes a settings write today. The read side is a plain SELECT and is therefore safe to call from
   * inside `updatePage`'s transaction, which is exactly where the throttle calls it.
   */
  /**
   * D6's autosave preference, read with the SAME discipline `revisionSettings` above uses and for the same
   * measured reason: the write is not the only way into an INTEGER column, and a stored value JavaScript
   * cannot represent makes `node:sqlite` throw on the WHOLE row read rather than on its own column - hence
   * one try/catch and one shared fallback rather than a guard per field.
   *
   * `enabled` accepts exactly 0 or 1 and reads anything else as the default (ON). Fail-OPEN, deliberately, and
   * for the same reason revision history does: a garbled value must not silently stop the editors saving the
   * GM's work, which is the one outcome here that loses data. An out-of-range interval reads as the default
   * rather than propagating - an interval outside the scale is not an interval.
   */
  private autosaveSettings(): CodexAutosaveSettings {
    let row: { autosave_enabled: number; autosave_interval_seconds: number } | undefined;
    try {
      row = this.requireDatabase().prepare("SELECT autosave_enabled, autosave_interval_seconds FROM codex_meta WHERE id = 1")
        .get() as { autosave_enabled: number; autosave_interval_seconds: number } | undefined;
    } catch { return DEFAULT_AUTOSAVE_SETTINGS; }
    if (!row) return DEFAULT_AUTOSAVE_SETTINGS;
    const stored = row.autosave_interval_seconds;
    const inRange = Number.isSafeInteger(stored) && stored >= MIN_AUTOSAVE_INTERVAL_SECONDS && stored <= MAX_AUTOSAVE_INTERVAL_SECONDS;
    return {
      enabled: row.autosave_enabled === 0 || row.autosave_enabled === 1 ? row.autosave_enabled === 1 : DEFAULT_AUTOSAVE_SETTINGS.enabled,
      intervalSeconds: inRange ? stored : DEFAULT_AUTOSAVE_SETTINGS.intervalSeconds
    };
  }

  setSettings(input: CodexSettingsInput): CodexSettings {
    const database = this.requireDatabase();
    // Normalized OUTSIDE the transaction: both of these throw on a value they cannot make sense of, and a
    // rejection that never opened a transaction costs nothing to roll back (`setCalendar`'s arrangement).
    //
    // `enabled` is REQUIRED to be a real boolean rather than coerced by truthiness. The read side above
    // deliberately coerces a garbled stored value to "on"; a WRITE must not, because the coercion of a missing
    // field would land on `false` and silently switch the GM's undo history off - the one outcome here that
    // loses data. A caller that means "off" can say so.
    const enabled = input?.revisionHistory?.enabled;
    if (typeof enabled !== "boolean") throw new Error("Revision history must be switched on or off explicitly.");
    const windowMinutes = revisionWindowMinutes(input?.revisionHistory?.windowMinutes);
    // D6: the same explicit-boolean rule, for the same reason one step further along - a coerced missing
    // field would land on `false` and switch AUTOSAVE off, which is the outcome that loses the GM's work.
    const autosaveEnabled = input?.autosave?.enabled;
    if (typeof autosaveEnabled !== "boolean") throw new Error("Autosave must be switched on or off explicitly.");
    const intervalSeconds = autosaveIntervalSeconds(input?.autosave?.intervalSeconds);
    this.transaction(() => {
      database.prepare("UPDATE codex_meta SET revision_history_enabled = ?, revision_window_minutes = ?, autosave_enabled = ?, autosave_interval_seconds = ? WHERE id = 1")
        .run(enabled ? 1 : 0, windowMinutes, autosaveEnabled ? 1 : 0, intervalSeconds);
      this.bumpRevision();
    });
    return this.getSettings();
  }

  /**
   * Delete every revision authored more than `olderThanDays` ago, and answer with how many rows really went
   * (owner decision, 2026-07-30: "yes" to a way of deleting existing version history).
   *
   * **`0` deletes everything, and that is ARITHMETIC rather than a magic value** - the cutoff is simply "now",
   * and nothing is younger than zero days old. Deliberately not special-cased: a branch on zero would be a
   * second rule about the same comparison, and the day someone changed one of them they would disagree.
   *
   * That is what makes the comparison `<=` rather than `<`, and it is the one boundary decision here worth
   * stating: a row authored EXACTLY at the cutoff is deleted. With a strict `<`, `olderThanDays: 0` on a codex
   * saved a moment ago deletes nothing - measured, not reasoned about, because `authored_at` and a zero-day
   * cutoff are then the same stamp to the millisecond. The inclusive boundary also matches `revisionDue`, which
   * commits a checkpoint at exactly `windowMinutes` rather than one millisecond later; both treat "exactly on
   * the boundary" as "act".
   *
   * REJECTS rather than clamps a bad `olderThanDays`, which is the deliberate opposite of
   * `revisionWindowMinutes` sitting a few lines above it in this feature. The window is a slider the GM drags,
   * where overshooting means "the end of the scale"; this is DESTRUCTIVE, so a malformed request must not be
   * interpreted generously - "-1" or "3.5" is a caller that does not know what it is asking for, and the honest
   * answer is a refusal. The upper bound exists for a blunter reason as well as symmetry: past a few hundred
   * thousand years the cutoff date is not representable and `toISOString()` throws `RangeError: Invalid time
   * value`, so an unbounded input would turn a silly request into a 500. Measured, not assumed.
   *
   * **The clock and column are the throttle's, exactly**: `authored_at` compared against `this.now()`, so "old"
   * means ONE thing in this store - when the checkpointed content was authored. A row whose stamp will not parse
   * counts as OLD and is deleted, which is the same way `revisionDue` treats one (it checkpoints rather than
   * trusting it); an empty stamp sorts below every real one, so the ordinary comparison already says so.
   *
   * The comparison is done in SQL on the TEXT stamps rather than in JavaScript, so ONE statement does the whole
   * job inside one `BEGIN IMMEDIATE` and `changes` is the authoritative row count. That is safe here because
   * every stamp is `new Date(...).toISOString()`, which is fixed-width and therefore sorts chronologically.
   *
   * It touches `codex_page_revisions` and NOTHING else. A page as it stands now is not a version of itself, so
   * no page, body or `rev` moves - and there is no cascade in either direction to worry about, because nothing
   * references this table. It also ignores the `enabled` setting completely: a GM who turned history off is
   * exactly the GM who wants the space back.
   */
  deleteRevisionsOlderThan(olderThanDays: number): number {
    const database = this.requireDatabase();
    if (!Number.isInteger(olderThanDays) || olderThanDays < 0 || olderThanDays > MAX_PRUNE_DAYS) {
      throw new Error(`Choose a whole number of days from 0 to ${MAX_PRUNE_DAYS}.`);
    }
    const cutoff = new Date(this.now() - olderThanDays * 86_400_000).toISOString();
    let deleted = 0;
    this.transaction(() => {
      deleted = database.prepare("DELETE FROM codex_page_revisions WHERE authored_at <= ?").run(cutoff).changes as number;
      this.bumpRevision();
    });
    return deleted;
  }

  // ----- Revisions -----

  listRevisions(pageId: string): CodexPageRevisionRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${REVISION_COLUMNS} FROM codex_page_revisions WHERE page_id = ? ORDER BY rev DESC`)
      .all(pageId) as RevisionRowRaw[])
      .map(toRevision);
  }

  /**
   * EVERY page's revision history in one read, for the backup bundle. `listRevisions` is per page because
   * that is how the editor asks; a backup has to carry the whole table, and `pageId` on each row is what
   * regroups them.
   *
   * Ordered `page_id, rev` (ASC, not the editor's DESC) because a backup is read as a history rather than
   * scanned newest-first, and a deterministic order makes two exports of an unchanged codex comparable.
   *
   * Carries THREE columns `listRevisions` does not - `entity_type`, `fields_json`, `gm_fields_json`, added
   * by migrations v3/v5. That is deliberate and it is why this returns a superset type rather than
   * `CodexPageRevisionRow`:
   *  - `restoreRevision` reads exactly those three columns plus the ones the base row carries, so a bundle
   *    without them holds a history that can restore a page's PROSE and silently drop its typed fields -
   *    the same shape of bug the "preserves them through export" gmFields regression guard exists for.
   *  - They cannot simply be added to `CodexPageRevisionRow`, because that row IS the wire shape of
   *    `GET /codex/pages/{id}/revisions`, whose contract component is `additionalProperties: false`. The
   *    bundle is declared opaque (`CodexExportData.codex`), so it may carry more; that endpoint may not.
   * One row-mapper (`toRevision`) still owns every shared column, so the two shapes cannot drift.
   */
  listAllRevisions(): CodexPageRevisionExportRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${REVISION_COLUMNS}, entity_type, fields_json, gm_fields_json FROM codex_page_revisions ORDER BY page_id, rev`)
      .all() as Array<RevisionRowRaw & { entity_type: string; fields_json: string; gm_fields_json: string }>)
      .map((row) => ({ ...toRevision(row), entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json), gmFields: parseFields(row.gm_fields_json) }));
  }

  /**
   * Restore a past revision by writing it forward as a new revision (history is never rewritten).
   *
   * CT-11: revisions deliberately do NOT snapshot the in-world date, and this call omits `inWorldDate`, so a
   * restore keeps the page's CURRENT chronicle placement. Restoring older prose is a content edit, not a
   * statement about when the event happened - and the alternative (snapshotting it) would silently move an
   * event years across the timeline as a side effect of undoing a typo.
   *
   * **Unchanged by the 2026-07-30 revision throttle, and checked rather than assumed.** It still restores by
   * ID, so it reaches every row in the table however sparse the history is, and it still works with
   * `enabled: false` - disabling history stops new writes, it does not lock the GM out of what exists.
   * What DID change is that restoring the NEWEST revision is now a meaningful undo: under prior-state
   * snapshots the newest checkpoint normally sits behind the page's current state, where before this it
   * equalled it and restoring it was a no-op that only bumped `rev`.
   *
   * It goes through `updatePage`, so the restore is itself a save and is itself throttled: the state it
   * overwrites is checkpointed only if the window allows. That is the same trade every save now makes, and
   * treating a restore as special would be a second policy about the same table.
   */
  restoreRevision(pageId: string, revisionId: number, authorTag: string): CodexPageRow {
    const snap = this.requireDatabase().prepare("SELECT title, entity_type, fields_json, gm_fields_json, player_body, gm_body, banner_asset_id, tags_json FROM codex_page_revisions WHERE id = ? AND page_id = ?").get(revisionId, pageId) as { title: string; entity_type: string; fields_json: string; gm_fields_json: string; player_body: string; gm_body: string; banner_asset_id: string | null; tags_json: string } | undefined;
    if (!snap) throw new CodexNotFoundError("That revision no longer exists.");
    // `forceRevision`: checkpoint the state this restore is about to discard, whatever the window says. Before
    // the throttle every save checkpointed, so a restore was always undoable; without this, restoring twice
    // inside the window would lose the text the GM restored away from and there would be no way back.
    return this.updatePage(pageId, { title: snap.title, entityType: snap.entity_type as CodexEntityType, fields: parseFields(snap.fields_json), gmFields: parseFields(snap.gm_fields_json), playerBody: snap.player_body, gmBody: snap.gm_body, bannerAssetId: snap.banner_asset_id, tags: JSON.parse(snap.tags_json) as string[] }, undefined, authorTag, true);
  }

  // ----- Links / backlinks -----

  /** Backlinks to a page: every page whose body references this page's title. Includes both layers + reveal state; the projection filters for players. */
  backlinksToPage(pageId: string): CodexBacklinkRow[] {
    const page = this.pageRow(pageId);
    if (!page) return [];
    return (this.requireDatabase().prepare(
      `SELECT l.source_page_id, l.layer, l.section, p.title AS source_title, p.revealed AS source_revealed
       FROM codex_links l JOIN codex_pages p ON p.id = l.source_page_id
       WHERE l.target_kind = 'page' AND l.target_ref = ? AND l.source_page_id != ?
       ORDER BY p.title COLLATE NOCASE`
    ).all(pageLinkKey(page.title), pageId) as Array<{ source_page_id: string; layer: "player" | "gm"; section: string | null; source_title: string; source_revealed: number }>)
      .map((row) => ({ sourcePageId: row.source_page_id, sourceTitle: row.source_title, sourceRevealed: row.source_revealed === 1, layer: row.layer, section: row.section }));
  }

  /**
   * CI-8: every `[[wiki link]]` edge BETWEEN TWO PAGES, for the whole-graph feed - the second edge kind
   * the Graph draws, beside the typed relationships.
   *
   * Deliberately RAW and UNGATED, both layers and every reveal state, exactly as `backlinksToPage` hands
   * both layers to `projectPlayerBacklinks`: `projectPlayerLinkEdges` is the single visibility gate. A
   * second predicate down here would be a lower layer that an HTTP test cannot distinguish from the
   * projection (the blind spot the CI-1 SQL tests exist to cover).
   *
   * A wiki link stores its target's TITLE key, not an id, so targets resolve through `pageLinkKey` here
   * rather than in SQL - the same function that wrote the key, so the two cannot drift. A link to a title
   * no page carries has no node to draw and is dropped; so is a page's link to itself, which
   * `backlinksToPage` drops too. ONE edge per ordered pair: when a page links the same target from both
   * of its bodies the edge counts as player-layer, because the player-facing body genuinely carries it.
   */
  listAllLinks(): CodexLinkEdgeRow[] {
    const database = this.requireDatabase();
    const idByLinkKey = new Map<string, string>();
    for (const page of database.prepare("SELECT id, title FROM codex_pages").all() as Array<{ id: string; title: string }>) idByLinkKey.set(pageLinkKey(page.title), page.id);
    const edges = new Map<string, CodexLinkEdgeRow>();
    // `layer` is in the ORDER BY so the collapse below is DETERMINISTIC rather than a bet on insertion
    // order: 'gm' sorts before 'player', so a pair present in both bodies always arrives gm-first and is
    // then upgraded. Without it the merge silently depended on which row SQLite happened to return first.
    const rows = database.prepare("SELECT source_page_id, layer, target_ref FROM codex_links WHERE target_kind = 'page' ORDER BY source_page_id, target_ref, layer").all() as Array<{ source_page_id: string; layer: "player" | "gm"; target_ref: string }>;
    for (const row of rows) {
      const toPageId = idByLinkKey.get(row.target_ref);
      if (!toPageId || toPageId === row.source_page_id) continue;
      const key = `${row.source_page_id}|${toPageId}`;
      const seen = edges.get(key);
      if (!seen) edges.set(key, { fromPageId: row.source_page_id, toPageId, layer: row.layer });
      else if (row.layer === "player" && seen.layer !== "player") edges.set(key, { ...seen, layer: "player" });
    }
    return [...edges.values()];
  }

  // ----- Search -----

  /**
   * Suite-wide full-text search over ONE audience's index (CI-1 / R8: one search, every record kind).
   *
   * Two independent things keep a player out of GM content, and both matter:
   *  1. CONTENT - the player index only ever received player-layer text (see `indexPage`/`indexEntry`),
   *     so a GM body/note simply is not in the table a player query runs against.
   *  2. VISIBILITY - `PLAYER_VISIBLE_SQL` re-checks the live row's reveal state per kind. This mirrors
   *     the pages-only precedent, where the reveal join existed so unrevealed drafts don't crowd the
   *     result cap; the audited safety gate is still `projectPlayerSearchHit`, which re-applies the
   *     same predicate on the way out. Belt and braces, deliberately.
   *
   * Resolving reveal state at READ time (rather than baking it into the index) is what makes a reveal
   * toggle - on a page, entry, marker, or the MAP A MARKER SITS ON - take effect with no reindex.
   *
   * ORDERING is `searchOrderBySql` - exact title first, then bm25 with title weighted 10x over body.
   * It is ORDER BY only: nothing about WHICH records match changed, so the reveal gates above and the
   * recall of every existing query are untouched.
   */
  searchAll(audience: "player" | "gm", query: string, kinds?: readonly CodexRecordKind[]): CodexSearchResult {
    const match = ftsQuery(query);
    if (!match) return { hits: [], truncated: false };
    // Tier 1's comparison value. `ftsQuery` already returned non-null, so the query holds at least one
    // letter or digit and this is never "" - which is what keeps journal entries and unlabelled markers
    // (both indexed with an EMPTY title) from sweeping into tier 1 on some punctuation-only query.
    const exactTitle = query.trim().toLowerCase();
    const table = audience === "gm" ? "codex_search_gm" : "codex_search_player";
    const kindFilter = kinds && kinds.length > 0 ? ` AND ${table}.kind IN (${kinds.map(() => "?").join(", ")})` : "";
    const visibility = audience === "gm" ? "" : ` AND ${PLAYER_VISIBLE_SQL}`;
    // `LIMIT 51` for a cap of 50: the 51st row is not returned, it is the SIGNAL. Asking for exactly the
    // cap can never distinguish "50 results" from "50 results and more you cannot see", and D19 requires
    // the truncation to be visible rather than silently swallowed - a search that quietly hides matches is
    // a search that reads as broken.
    const sql = `SELECT kind, record_id FROM ${table} WHERE ${table} MATCH ?${kindFilter}${visibility} ORDER BY ${searchOrderBySql(table)} LIMIT ${SEARCH_LIMIT + 1}`;
    try {
      // Bind order follows the ?s in SQL TEXT order: MATCH, then the kind filter, then tier 1's title
      // in the ORDER BY. Any new parameterised clause must be inserted at its textual position here.
      const rows = (this.requireDatabase().prepare(sql).all(match, ...(kinds ?? []), exactTitle) as Array<{ kind: string; record_id: string }>)
        .filter((row): row is { kind: CodexRecordKind; record_id: string } => (CODEX_RECORD_KINDS as readonly string[]).includes(row.kind));
      // The flag is measured BEFORE the slice and against the unfiltered row count, so a probe row dropped
      // by the unknown-kind filter above still counts as "there was more".
      return { hits: rows.slice(0, SEARCH_LIMIT).map((row) => ({ kind: row.kind, id: row.record_id })), truncated: rows.length > SEARCH_LIMIT };
    } catch { return { hits: [], truncated: false } }
  }

  /** The pages-only view of the same one index - kept so the page-search contract is provably unchanged. */
  searchPages(audience: "player" | "gm", query: string): Array<{ pageId: string }> {
    return this.searchAll(audience, query, ["page"]).hits.map((hit) => ({ pageId: hit.id }));
  }

  // ----- Maps (the atlas tree) -----

  createMap(input: CodexMapCreateInput): CodexMapRow {
    const database = this.requireDatabase();
    const mapId = this.freshId();
    const stamp = this.stamp();
    const parent = optionalId(input.parentMapId);
    if (parent && !this.mapRowRaw(parent)) throw new CodexNotFoundError("The parent map no longer exists.");
    const sortKey = ((database.prepare("SELECT MAX(sort_key) AS m FROM codex_maps").get() as { m: number | null }).m ?? 0) + 1;
    const name = mapName(input.name);
    const tagsJson = JSON.stringify(tags(input.tags));
    this.transaction(() => {
      database.prepare("INSERT INTO codex_maps (id, asset_id, name, kind, parent_map_id, revealed, sort_key, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(mapId, id(input.assetId), name, mapKind(input.kind), parent, input.revealedToPlayers ? 1 : 0, sortKey, tagsJson, stamp, stamp);
      this.indexMap(mapId, name, tagsJson);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  updateMap(mapId: string, input: Readonly<{ name?: string; kind?: CodexMapKind; tags?: readonly string[] }>): CodexMapRow {
    const database = this.requireDatabase();
    const existing = this.mapRowRaw(mapId);
    if (!existing) throw new CodexNotFoundError("That map no longer exists.");
    const name = input.name === undefined ? existing.name : mapName(input.name);
    const kind = input.kind === undefined ? existing.kind : mapKind(input.kind);
    const tagsJson = input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags));
    this.transaction(() => {
      database.prepare("UPDATE codex_maps SET name = ?, kind = ?, tags_json = ?, updated_at = ? WHERE id = ?").run(name, kind, tagsJson, this.stamp(), mapId);
      this.indexMap(mapId, name, tagsJson);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  /** Re-parent a map in the tree, rejecting self-parenting and cycles (world → region → city stays acyclic). */
  setMapParent(mapId: string, parentMapId: string | null): CodexMapRow {
    const database = this.requireDatabase();
    if (!this.mapRowRaw(mapId)) throw new CodexNotFoundError("That map no longer exists.");
    const parent = optionalId(parentMapId);
    if (parent !== null) {
      if (parent === mapId) throw new Error("A map cannot be its own parent.");
      let cursor: string | null = parent;
      const seen = new Set<string>([mapId]);
      while (cursor !== null) {
        if (seen.has(cursor)) throw new Error("That would create a loop in the map tree.");
        seen.add(cursor);
        const row: MapRowRaw | undefined = this.mapRowRaw(cursor);
        if (!row) throw new CodexNotFoundError("The parent map no longer exists.");
        cursor = row.parent_map_id;
      }
    }
    this.transaction(() => {
      database.prepare("UPDATE codex_maps SET parent_map_id = ?, updated_at = ? WHERE id = ?").run(parent, this.stamp(), mapId);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  setMapRevealed(mapId: string, revealed: boolean): CodexMapRow {
    const database = this.requireDatabase();
    if (!this.mapRowRaw(mapId)) throw new CodexNotFoundError("That map no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_maps SET revealed = ?, updated_at = ? WHERE id = ?").run(revealed ? 1 : 0, this.stamp(), mapId);
      this.bumpRevision();
    });
    return this.getMap(mapId)!;
  }

  deleteMap(mapId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(mapId)) return;
    this.transaction(() => {
      // Markers on OTHER maps that drilled into this one become label-only rather than dangling.
      database.prepare("UPDATE codex_markers SET sub_map_id = NULL, updated_at = ? WHERE sub_map_id = ?").run(this.stamp(), mapId);
      // Journal pins to this map's own (about-to-cascade) markers are released first, so they don't dangle.
      database.prepare("UPDATE codex_journal SET attach_marker_id = NULL, updated_at = ? WHERE attach_marker_id IN (SELECT id FROM codex_markers WHERE map_id = ?)").run(this.stamp(), mapId);
      // The markers cascade away in SQL, so their index rows have to be swept explicitly - an orphaned
      // marker row would keep matching searches forever with no live row left to gate it.
      for (const row of database.prepare("SELECT id FROM codex_markers WHERE map_id = ?").all(mapId) as Array<{ id: string }>) this.unindex("marker", row.id);
      this.unindex("map", mapId);
      // Own markers cascade; child maps' parent_map_id is set null by the FK.
      database.prepare("DELETE FROM codex_maps WHERE id = ?").run(mapId);
      this.bumpRevision();
    });
  }

  getMap(mapId: string): CodexMapRow | null {
    const row = this.mapRowRaw(mapId);
    return row ? this.toMap(row) : null;
  }

  listMaps(): CodexMapRow[] {
    return (this.requireDatabase().prepare(`SELECT ${MAP_COLUMNS} FROM codex_maps ORDER BY sort_key, name COLLATE NOCASE`).all() as MapRowRaw[]).map((row) => this.toMap(row));
  }

  // ----- Markers -----

  createMarker(mapId: string, input: CodexMarkerCreateInput): CodexMarkerRow {
    const database = this.requireDatabase();
    if (!this.mapRowRaw(mapId)) throw new CodexNotFoundError("That map no longer exists.");
    const markerId = this.freshId();
    const stamp = this.stamp();
    const label = markerLabel(input.label);
    const tagsJson = JSON.stringify(tags(input.tags));
    this.transaction(() => {
      database.prepare("INSERT INTO codex_markers (id, map_id, x, y, icon_id, icon_color, label, revealed, page_ids_json, sub_map_id, scene_ids_json, actor_id, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(markerId, mapId, coord(input.x), coord(input.y), iconId(input.iconId), hexColor(input.iconColor), label, input.revealedToPlayers ? 1 : 0,
          JSON.stringify(idArray(input.pageIds)), optionalId(input.subMapId), JSON.stringify(idArray(input.sceneIds)), optionalId(input.actorId), tagsJson, stamp, stamp);
      this.indexMarker(markerId, label, tagsJson);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  updateMarker(markerId: string, input: CodexMarkerUpdateInput): CodexMarkerRow {
    const database = this.requireDatabase();
    const existing = this.markerRowRaw(markerId);
    if (!existing) throw new CodexNotFoundError("That marker no longer exists.");
    const merged = {
      x: input.x === undefined ? existing.x : coord(input.x),
      y: input.y === undefined ? existing.y : coord(input.y),
      icon_id: input.iconId === undefined ? existing.icon_id : iconId(input.iconId),
      icon_color: input.iconColor === undefined ? existing.icon_color : hexColor(input.iconColor),
      label: input.label === undefined ? existing.label : markerLabel(input.label),
      revealed: input.revealedToPlayers === undefined ? existing.revealed : (input.revealedToPlayers ? 1 : 0),
      page_ids_json: input.pageIds === undefined ? existing.page_ids_json ?? "[]" : JSON.stringify(idArray(input.pageIds)),
      sub_map_id: input.subMapId === undefined ? existing.sub_map_id : optionalId(input.subMapId),
      scene_ids_json: input.sceneIds === undefined ? existing.scene_ids_json ?? "[]" : JSON.stringify(idArray(input.sceneIds)),
      actor_id: input.actorId === undefined ? existing.actor_id : optionalId(input.actorId),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags))
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_markers SET x = ?, y = ?, icon_id = ?, icon_color = ?, label = ?, revealed = ?, page_ids_json = ?, sub_map_id = ?, scene_ids_json = ?, actor_id = ?, tags_json = ?, updated_at = ? WHERE id = ?")
        .run(merged.x, merged.y, merged.icon_id, merged.icon_color, merged.label, merged.revealed, merged.page_ids_json, merged.sub_map_id, merged.scene_ids_json, merged.actor_id, merged.tags_json, this.stamp(), markerId);
      this.indexMarker(markerId, merged.label, merged.tags_json);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  /** The drag path: position only, server-validated. */
  moveMarker(markerId: string, x: number, y: number): CodexMarkerRow {
    const database = this.requireDatabase();
    if (!this.markerRowRaw(markerId)) throw new CodexNotFoundError("That marker no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_markers SET x = ?, y = ?, updated_at = ? WHERE id = ?").run(coord(x), coord(y), this.stamp(), markerId);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  setMarkerRevealed(markerId: string, revealed: boolean): CodexMarkerRow {
    const database = this.requireDatabase();
    if (!this.markerRowRaw(markerId)) throw new CodexNotFoundError("That marker no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_markers SET revealed = ?, updated_at = ? WHERE id = ?").run(revealed ? 1 : 0, this.stamp(), markerId);
      this.bumpRevision();
    });
    return this.getMarker(markerId)!;
  }

  deleteMarker(markerId: string): void {
    if (!ID.test(markerId)) return;
    this.transaction(() => {
      const database = this.requireDatabase();
      // Journal pins to this marker become label-only rather than dangling.
      database.prepare("UPDATE codex_journal SET attach_marker_id = NULL, updated_at = ? WHERE attach_marker_id = ?").run(this.stamp(), markerId);
      this.unindex("marker", markerId);
      database.prepare("DELETE FROM codex_markers WHERE id = ?").run(markerId);
      this.bumpRevision();
    });
  }

  getMarker(markerId: string): CodexMarkerRow | null {
    const row = this.markerRowRaw(markerId);
    return row ? this.toMarker(row) : null;
  }

  listMarkers(mapId: string): CodexMarkerRow[] {
    if (!ID.test(mapId)) return [];
    return (this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE map_id = ? ORDER BY created_at`).all(mapId) as MarkerRowRaw[]).map((row) => this.toMarker(row));
  }

  /**
   * CI-4, the reverse of `listMarkers`: every pin anywhere on the atlas that links THIS page, so a page
   * can offer "seen on the map" instead of the Atlas being the only way in.
   *
   * Deliberately UNGATED, like `listMarkers` - raw GM-grade rows, hidden pins and pins on secret maps
   * included, because `projectPlayerPageMarker` is the single visibility gate for this feed. Adding a
   * reveal predicate here would create a lower layer that an HTTP test could not tell apart from the
   * projection.
   */
  markersForPage(pageId: string): CodexMarkerRow[] {
    if (!ID.test(pageId)) return [];
    return (this.requireDatabase().prepare(
      `SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.page_ids_json) WHERE value = ?) ORDER BY created_at`
    ).all(pageId) as MarkerRowRaw[]).map((row) => this.toMarker(row));
  }

  /** Whether any revealed codex map uses this image asset - lets players fetch a revealed world map's image. */
  isAssetRevealedToPlayers(assetId: string): boolean {
    if (!ID.test(assetId)) return false;
    return this.requireDatabase().prepare("SELECT 1 FROM codex_maps WHERE asset_id = ? AND revealed = 1 LIMIT 1").get(assetId) !== undefined;
  }

  /** Whether a codex media asset (banner or inline image) is used by any REVEALED page's player-facing content - the gate for a player fetching page media. */
  isPageAssetVisibleToPlayers(assetId: string): boolean {
    if (!ID.test(assetId)) return false;
    // A revealed page's banner, or a revealed page whose PLAYER body references the asset id (inline image).
    return this.requireDatabase().prepare("SELECT 1 FROM codex_pages WHERE revealed = 1 AND (banner_asset_id = ? OR player_body LIKE ?) LIMIT 1").get(assetId, `%${assetId}%`) !== undefined;
  }

  /** The location marker linked to a prepared scene, if any - the combat-history bridge pins fights here. */
  markerForScene(sceneId: string): CodexMarkerRow | null {
    if (!ID.test(sceneId)) return null;
    const row = this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE EXISTS (SELECT 1 FROM json_each(codex_markers.scene_ids_json) WHERE value = ?) ORDER BY updated_at DESC, created_at DESC LIMIT 1`).get(sceneId) as MarkerRowRaw | undefined;
    return row ? this.toMarker(row) : null;
  }

  /**
   * CT-7 / M12-C: nominate the pin the party is standing on, atlas-wide. `null` clears it entirely.
   *
   * ONE marker for the WHOLE atlas, not one per map. "The party is in exactly one place" then needs no
   * reconciliation rule: one-per-map would leave the GM keeping several pins in step by hand and leave
   * "which pin is the real one?" unanswerable. Flagging a second pin therefore CLEARS the first rather
   * than erroring - the GM's action is "the party is HERE now", and refusing it to make them un-flag the
   * old pin first would be a settings knob wearing a validation error's clothes.
   *
   * ONE transaction, and the ORDER of the two writes is load-bearing rather than stylistic: v16's partial
   * unique index means clear-then-set commits and set-then-clear is rejected mid-statement (probed against
   * this build). The index is the FILE's half of the invariant and this method is the PROCESS's half - the
   * same duality every enum CHECK in this store has, and the reason a repair script cannot leave two party
   * pins behind.
   *
   * NOT a marker-shaped record of its own and NOT a pointer on `codex_meta`: it is a flag on an ordinary
   * marker, so the party pin is moved by the existing marker-move path, revealed by the existing reveal
   * switch, and deleted by the existing delete (which simply leaves the atlas with no party pin, the same
   * state a fresh codex is in). A pointer on `codex_meta` would have needed its own dangling-reference
   * sweep in `deleteMarker` and `deleteMap`; the flag cascades with the row for free.
   *
   * Reveal state is NOT touched. Marking a hidden pin as the party does not reveal it, and a party pin on
   * a hidden map stays hidden - `isParty` appears in no visibility predicate anywhere, which is what keeps
   * CT-7 out of the reveal system entirely.
   */
  setPartyMarker(markerId: string | null): CodexMarkerRow | null {
    const database = this.requireDatabase();
    if (markerId !== null && !this.markerRowRaw(markerId)) throw new CodexNotFoundError("That marker no longer exists.");
    this.transaction(() => {
      // CLEAR FIRST. With the partial unique index in place the reverse order raises
      // "UNIQUE constraint failed: codex_markers.is_party" before the clear ever runs.
      database.prepare("UPDATE codex_markers SET is_party = 0 WHERE is_party = 1").run();
      if (markerId !== null) database.prepare("UPDATE codex_markers SET is_party = 1 WHERE id = ?").run(markerId);
      this.bumpRevision();
    });
    return markerId === null ? null : this.getMarker(markerId);
  }

  /**
   * The party's pin, or `null` when the GM has not nominated one. Reads the `is_party = 1` partial index.
   *
   * UNGATED GM-grade row, exactly like `listMarkers` and `markersForPage`: `projectPlayerMarker` is the one
   * visibility gate for a marker, and a reveal predicate here would be a second, lower one that an HTTP
   * test could not tell apart from the projection. `LIMIT 1` is belt-and-braces over an index that already
   * makes a second row impossible.
   */
  partyMarker(): CodexMarkerRow | null {
    const row = this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE is_party = 1 LIMIT 1`).get() as MarkerRowRaw | undefined;
    return row ? this.toMarker(row) : null;
  }

  // ----- Calendar -----

  getCalendar(): CodexCalendar {
    const row = this.requireDatabase().prepare("SELECT calendar_json FROM codex_meta WHERE id = 1").get() as { calendar_json: string | null } | undefined;
    if (!row?.calendar_json) return DEFAULT_CALENDAR;
    try { return normalizeCalendar(JSON.parse(row.calendar_json) as CodexCalendar); } catch { return DEFAULT_CALENDAR; }
  }

  /**
   * Replace the world calendar and reflow **every dated record** in one transaction (K3).
   *
   * Reflow means: recompute the sort instant + display label from the RAW date the GM typed. Nothing reads
   * the old instant to produce the new one, so the operation is idempotent and lossless - the raw date is
   * never written here, only read. Changing month lengths/count therefore re-places existing dates on the
   * new calendar rather than corrupting them.
   *
   * CT-11 put `codex_pages` in this set beside `codex_journal`. Both loops run inside the SAME transaction
   * as the calendar write: a chronicle half-reflowed against two different calendars would order entries
   * and events against each other wrongly, and that is exactly the record set the one timeline interleaves.
   * The page predicate is `in_world_year IS NOT NULL`, NOT `entity_type = 'event'` - a page that is not an
   * event today may be one tomorrow, and its stored date must be current when it gets there.
   */
  setCalendar(input: CodexCalendar): CodexCalendar {
    const calendar = normalizeCalendar(input);
    this.transaction(() => this.writeCalendar(calendar));
    return calendar;
  }

  /**
   * `setCalendar`'s body, extracted verbatim so ONE transaction can hold a calendar write together with
   * another write - which `applyDowntime` needs and could not otherwise have (D11-F).
   *
   * **Assumes it is already inside `this.transaction`, and must never open one.** `transaction()` is a bare
   * `BEGIN IMMEDIATE` with no savepoint (F-2), so nesting it throws "cannot start a transaction within a
   * transaction" - `insertEntry` and the old `setCalendar` each opened one, which is exactly why they could
   * not compose. Making `transaction()` re-entrant would change every write path in this store and is a
   * different job; extracting the leaf is the small change that solves the actual problem.
   *
   * Takes an ALREADY-NORMALIZED calendar: `normalizeCalendar` validates (and throws), so it stays outside
   * the transaction where a rejection costs nothing to roll back.
   *
   * The `bumpRevision()` is inside deliberately, so `setCalendar` remains exactly one bump and a caller that
   * composes this with another write is covered by it - the revision is a coarse "refetch" ping, and one per
   * transaction is what every other write path here produces.
   */
  private writeCalendar(calendar: CodexCalendar): void {
    const database = this.requireDatabase();
    database.prepare("UPDATE codex_meta SET calendar_json = ? WHERE id = 1").run(JSON.stringify(calendar));
    for (const table of ["codex_journal", "codex_pages"] as const) {
      const dated = database.prepare(`SELECT id, in_world_year AS year, in_world_month AS month, in_world_day AS day FROM ${table} WHERE in_world_year IS NOT NULL`).all() as Array<{ id: string; year: number; month: number; day: number }>;
      const update = database.prepare(`UPDATE ${table} SET calendar_instant = ?, in_world_label = ? WHERE id = ?`);
      for (const row of dated) { const date = { year: row.year, month: row.month, day: row.day }; update.run(calendarInstantOf(calendar, date), formatInWorldDate(calendar, date), row.id); }
    }
    /**
     * The FIRST campaign date a codex is ever given publishes itself.
     *
     * v15 backfills `published_*` from `currentDate`, so an EXISTING campaign sees no change on upgrade
     * (K7). A campaign created after M11 has no such row to backfill, and without this the GM would set
     * "Current date - the world's now" in the calendar editor and every player's date would stay blank,
     * with the only explanation living on a different screen. That is a silent regression against the
     * behaviour every pre-M11 campaign had, and nobody approved removing it.
     *
     * Publishing here cannot leak anything: the prep clock exists to run AHEAD of the party, and there is
     * no "ahead" of a date they have never been given. Only the transition from "no published date" to
     * "a published date" is automatic - once players have a date, every later move of the GM's clock is
     * private until published, which is the whole of O-1.
     */
    if (calendar.currentDate && this.getPublishedDate() === null) this.writePublishedDate(calendar.currentDate);
    this.bumpRevision();
  }

  /**
   * O-1's PREP CLOCK, read side: the date PLAYERS currently see.
   *
   * There are two clocks from M11 on. `getCalendar().currentDate` is the **GM's** - the authoritative
   * campaign "now" that every internal reader already uses (`appendCombatEntry` dates a logged fight by it,
   * unchanged). This is the **players'**, and it only moves when the GM explicitly publishes (D11-H).
   * Advancing the GM clock - by hand or via `applyDowntime` - never touches it.
   *
   * All three parts or none, the same rule `toEntry` applies to a stored entry date: a half-written date is
   * not a date. Migration v15 backfilled these from `currentDate`, so an existing codex starts with the two
   * clocks in agreement and nothing visibly changes until the GM first runs ahead.
   */
  getPublishedDate(): CodexInWorldDate | null {
    /**
     * Read inside a `try`, because an INTEGER column can hold a value JavaScript cannot represent.
     *
     * `node:sqlite` throws `RangeError: Value is too large to be represented as a JavaScript number` for
     * anything past 2^53-1, and v15's backfill guards the JSON's TYPE but not its magnitude — so a
     * hand-edited `calendar_json` carrying a huge year lands in `published_year` and the migration
     * COMPLETES. After that, this read threw, and it is on the path of `exportBundle` (the GM's only
     * backup), both calendar reads, publish, the timeline and apply-downtime. A codex that opens fine and
     * cannot be backed up is the worst shape this could take, and nothing surfaced until backup time.
     *
     * Reading it as "nothing published" is right rather than merely safe: an unrepresentable year is not a
     * date, which is exactly what the all-three-parts-or-none rule below already says about a half-written
     * one. The GM's own clock is untouched, so publishing again repairs it. The guard lives on the READ
     * because the write is not the only way in — a repair script or a hand-edited `codex_standing.value`
     * reaches the same place, and one guard at the door covers all of them.
     *
     * Found by the final QA data-integrity pass; threshold measured, not assumed (2^53-1 reads, 2^53 throws).
     */
    let row: { published_year: number | null; published_month: number | null; published_day: number | null } | undefined;
    try {
      row = this.requireDatabase().prepare("SELECT published_year, published_month, published_day FROM codex_meta WHERE id = 1")
        .get() as { published_year: number | null; published_month: number | null; published_day: number | null } | undefined;
    } catch { return null; }
    if (!row || row.published_year === null || row.published_month === null || row.published_day === null) return null;
    if (![row.published_year, row.published_month, row.published_day].every((part) => Number.isSafeInteger(part))) return null;
    return { year: row.published_year, month: row.published_month, day: row.published_day };
  }

  /**
   * O-1 / D11-H: copy the GM's clock to the players'. **The only thing that publishes.** Advancing the
   * clock does not, and neither does `applyDowntime` - a GM who runs the clock forward while prepping has
   * not told the party anything until they say so.
   *
   * Publishing while the GM clock is unset CLEARS the published date rather than leaving a stale one
   * behind: the published date means "what the GM's clock said when they last published", and if that is
   * nothing, players are back to an undated campaign - which is the state a codex with no `currentDate` is
   * in anyway. Returns the calendar so a caller can round-trip the result without a second read.
   */
  publishCampaignDate(): CodexCalendar {
    const calendar = this.getCalendar();
    this.transaction(() => {
      this.writePublishedDate(calendar.currentDate ?? null);
      this.bumpRevision();
    });
    return calendar;
  }

  /**
   * The one write of the published date. Leaf-level: assumes it is already inside a transaction, the same
   * contract `writeCalendar` follows and for the same reason - `writeCalendar` calls it (first-publish) and
   * `publishCampaignDate` calls it, and `this.transaction` does not nest (F-2).
   *
   * A null clears it: a GM who removes the campaign date entirely and publishes has published "no date".
   */
  private writePublishedDate(date: CodexInWorldDate | null): void {
    this.requireDatabase().prepare("UPDATE codex_meta SET published_year = ?, published_month = ?, published_day = ? WHERE id = 1")
      .run(date ? date.year : null, date ? date.month : null, date ? date.day : null);
  }

  /**
   * The GM's clock as a sortable instant, or null when unset - what a GM-facing reader compares a deadline
   * against (`deadlineFired`). Never hand this to a player projection; that is what `publishedInstant()` is
   * for, and the two being separate calls is the point.
   */
  campaignInstant(): number | null {
    const calendar = this.getCalendar();
    return calendar.currentDate ? calendarInstantOf(calendar, calendar.currentDate) : null;
  }

  /** The PUBLISHED date as a sortable instant, or null - the only clock a player-facing reader may use. */
  publishedInstant(): number | null {
    const date = this.getPublishedDate();
    return date ? calendarInstantOf(this.getCalendar(), date) : null;
  }

  /** Convert a stored instant back to calendar date parts, for re-editing a dated entry. */
  dateForInstant(instant: number): CodexInWorldDate {
    const calendar = this.getCalendar();
    const perYear = calendarDaysPerYear(calendar);
    const year = Math.floor(instant / perYear);
    let remainder = instant - year * perYear;
    let month = 0;
    while (month < calendar.months.length - 1 && remainder >= calendar.months[month].days) { remainder -= calendar.months[month].days; month += 1; }
    return { year, month, day: remainder + 1 };
  }

  /**
   * Resolve a dated record's date: a structured in-world date wins (computes instant + label + keeps the raw
   * date); else free-text label, no instant.
   *
   * Used by journal entries AND, since CT-11, by pages - one function, so both share one dating contract.
   * A page passes `label: null`: an event's placement on the chronicle is the structured date or nothing,
   * because a free-text "when" cannot be sorted or reflowed. (Event pages keep their prose `when` FIELD for
   * colour; it is content, not a sort key, and the two are deliberately not the same thing.)
   */
  private resolveDate(date: CodexInWorldDate | null | undefined, label: string | null | undefined): { instant: number | null; label: string | null; date: CodexInWorldDate | null } {
    if (date && Number.isFinite(date.year) && Number.isFinite(date.month) && Number.isFinite(date.day)) {
      const calendar = this.getCalendar();
      const normalized = { year: Math.trunc(date.year), month: Math.trunc(date.month), day: Math.trunc(date.day) };
      return { instant: calendarInstantOf(calendar, normalized), label: formatInWorldDate(calendar, normalized), date: normalized };
    }
    return { instant: null, label: shortLabel(label, 120, "in-world date"), date: null };
  }

  // ----- Journal / timeline -----

  /**
   * M9 auto-linking: an entry written with NO `sessionNumber` is filed under the ACTIVE session, so the
   * GM gets the by-session grouping for free instead of retyping the number on every note. An explicitly
   * supplied value always wins - including an explicit `null`, which is how a caller says "this belongs
   * to no session" and is why the test is `=== undefined` rather than a falsy check. With no active
   * session `activeSessionNumber()` is null, which is today's behaviour exactly.
   */
  createEntry(input: CodexJournalCreateInput): CodexJournalRow {
    const dated = this.resolveDate(input.inWorldDate, input.inWorldLabel);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "note",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId), realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload: null
    });
  }

  /**
   * The combat-history bridge: a logged encounter drops a timeline entry, optionally pinned to a location.
   * Best-effort. The fight is dated at the campaign's **current in-world date** so it lands in the right
   * year on the timeline; previously every auto-logged battle was hardcoded undated and sank below every
   * dated entry forever. If the GM has not set a current date there is nothing to date it by, and
   * `resolveDate(null, null)` yields the old undated behaviour unchanged.
   *
   * M9 does for the SESSION number what the line above does for the in-world date: a fight logged during
   * a live session is filed under that session, resolved the same way and from the same "what is now?"
   * state. A hardcoded `null` here is what made auto-logged battles the one record kind that never
   * appeared in the by-session lens, however diligently the GM numbered everything else.
   */
  appendCombatEntry(input: CodexCombatEntryInput): CodexJournalRow {
    const dated = this.resolveDate(this.getCalendar().currentDate ?? null, null);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "combat",
      sourceEncounterId: input.sourceEncounterId, sessionId: this.activeSessionId, realDate: null,
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, payload: null
    });
  }

  /**
   * CT-5: a DEADLINE - "the duke's ultimatum expires on the 14th". A timeline record like any other, with
   * one extra rule and no payload at all (D11-C).
   *
   * The extra rule: a structured `inWorldDate` is REQUIRED. A deadline is defined by the day it fires, so
   * one with no date is not an under-specified deadline, it is a note - and it would sit on the timeline
   * forever in a state no clock can ever reach. A free-text `inWorldLabel` does not satisfy it: prose cannot
   * be compared to a clock. Rejected with the store's plain validation error, which the router maps to 400.
   *
   * Why no payload. The spec sketched `{ what, targetDate, fired }` and all three dissolve on contact with
   * what this record already is: `what` IS `playerText` (a deadline is its text), `targetDate` IS the
   * entry's own date (a second date inside a JSON blob would be a second date for one record, sitting
   * OUTSIDE `setCalendar`'s reflow - exactly the corruption K3 exists to prevent), and `fired` is derived by
   * `deadlineFired` on every read rather than stored.
   *
   * Created UNREVEALED like every other record (O-2 / P2), and revealed by the ordinary reveal switch. There
   * is deliberately no kind-based visibility rule anywhere: a revealed deadline is as visible as a revealed
   * note, and an unrevealed one is as invisible.
   */
  createDeadline(input: CodexJournalCreateInput): CodexJournalRow {
    const dated = this.resolveDate(input.inWorldDate, input.inWorldLabel);
    if (!dated.date) throw new Error("A deadline needs an in-world date - the date is when it fires.");
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "deadline",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId),
      realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload: null
    });
  }

  /**
   * CT-10: DOWNTIME - "Vex spends 30 days brewing poison". Carries the one payload in the journal
   * (D11-D), and **does not move the clock** (O-3).
   *
   * That last point is the whole design. The GM's answer to "should downtime pass time automatically?" was
   * "ask me to confirm", so this records the intent and `applyDowntime` is the confirmation. Creating
   * downtime is a note about the world; advancing the campaign date is a decision about the table, and the
   * GM makes it explicitly, having seen the date it lands on (`proposedDateFor`).
   *
   * Dated at the GM's clock when the caller does not say otherwise - the same rule `appendCombatEntry`
   * already uses for a logged fight, so downtime lands where it HAPPENED rather than sinking below every
   * dated record forever. An explicit `null` is treated as "not given" here rather than as "undated",
   * because there is no meaningful undated downtime: with no clock set, `resolveDate` yields undated anyway.
   *
   * `outcome` is not stored. It is prose, and this record already has two prose layers with a reveal split
   * between them - a third inside a JSON blob would sit outside that split (K1).
   */
  createDowntime(input: CodexDowntimeCreateInput): CodexJournalRow {
    const payload = downtimePayload(input.downtime);
    // D12: an id must name a live page, or the tracker renders a link nobody can follow. The TYPE is not
    // enforced - a GM may legitimately track downtime for an NPC or a hireling page - which is the
    // standing rule's opposite half, and deliberately so: standing is *about* a faction, downtime is
    // about a person the GM has some record for.
    if (payload.characterPageId !== null && !this.pageRow(payload.characterPageId)) throw new CodexNotFoundError("That page no longer exists.");
    const dated = this.resolveDate(input.inWorldDate ?? this.getCalendar().currentDate ?? null, input.inWorldLabel);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "downtime",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId),
      realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload
    });
  }

  /**
   * CT-8: a MILESTONE - "the party reached level 5 after the crypt". A timeline record like any other,
   * carrying `{ level, reason }` (spec §2.2).
   *
   * Deliberately NOT a table, and this is the one place to say why: a level history is an append-only list
   * of dated facts with two prose layers and a reveal flag, which is precisely what a journal entry already
   * is. `codex_standing` earns its table because "where do we stand NOW" is a question with one answer that
   * has to be queryable and editable; "what level were we in Marpenoth" is a question the timeline already
   * answers by being ordered. A `codex_milestones` table would be a second timeline to sort, reflow and
   * reveal-gate.
   *
   * Dated at the GM's clock when the caller does not say otherwise - the rule `appendCombatEntry` and
   * `createDowntime` already follow, so a milestone lands where it HAPPENED rather than sinking below every
   * dated record forever. An explicit `null` is "not given" here for the reason `createDowntime` states.
   *
   * Created UNREVEALED like every other record (O-2 / P2). There is no kind-based visibility rule: a
   * revealed milestone is exactly as visible as a revealed note.
   */
  createMilestone(input: CodexMilestoneCreateInput): CodexJournalRow {
    const payload = milestonePayload(input.milestone);
    const dated = this.resolveDate(input.inWorldDate ?? this.getCalendar().currentDate ?? null, input.inWorldLabel);
    return this.insertEntry({
      playerText: entryText(input.playerText), gmText: entryGmText(input.gmText), revealed: input.revealedToPlayers ? 1 : 0,
      attachMarkerId: optionalId(input.attachMarkerId), attachPageId: optionalId(input.attachPageId), kind: "milestone",
      sourceEncounterId: null, sessionId: this.resolveEntrySession(input.sessionId),
      realDate: shortLabel(input.realDate, 40, "date"),
      inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, tags: input.tags, payload
    });
  }

  /**
   * O-3: the date the clock WOULD move to, so the GM confirms a date rather than an arithmetic promise.
   * "Advance the campaign clock to Highsun 3, 1492" is a decision; "advance 30 days" is a request to do
   * mental arithmetic against a calendar the GM invented.
   *
   * No new date maths: `dateForInstant(instant + days)` reuses the month-walking arithmetic that already
   * rounds trips a dated entry, so month and year rollover come from the same code the rest of the calendar
   * uses rather than a second implementation to get wrong.
   *
   * `null` when the record is not downtime, is already applied (there is nothing left to propose), or when
   * the GM has no current date at all (nothing to advance FROM).
   */
  proposedDateFor(entry: CodexJournalRow): CodexInWorldDate | null {
    // `downtimePayloadOf` rather than `entry.payload` directly: M12 widened the payload to a union, and the
    // kind check IS the narrowing - reading `.days` off a milestone's payload would be a cast away otherwise.
    const payload = downtimePayloadOf(entry);
    if (!payload || payload.applied) return null;
    const from = this.campaignInstant();
    return from === null ? null : this.dateForInstant(from + payload.days);
  }

  /**
   * O-3's confirmation: mark the downtime applied AND move the GM's clock forward by its days, in **one**
   * transaction (D11-F). Publishing is separate and deliberate - this moves the GM's clock only, so a GM
   * resolving downtime during prep does not thereby tell the party what day it is (O-1).
   *
   * The two writes are one unit because half of this is worse than neither: an applied flag with an unmoved
   * clock silently swallows the days, and a moved clock with an unapplied flag lets the next confirmation
   * move them again. `writeCalendar` exists precisely so both can sit under one `BEGIN IMMEDIATE` (F-2).
   *
   * Idempotence is a GUARD, not a no-op: applying twice throws rather than returning quietly, because the
   * second call is a double-submit or a stale page, and silently doing nothing would tell the GM their
   * click worked. `CodexRevisionConflictError` -> 409, which is what a stale page deserves.
   */
  applyDowntime(entryId: string): Readonly<{ entry: CodexJournalRow; calendar: CodexCalendar }> {
    const database = this.requireDatabase();
    const existing = this.getEntry(entryId);
    if (!existing) throw new CodexNotFoundError("That journal entry no longer exists.");
    if (existing.kind !== "downtime") throw new Error("Only a downtime record can pass time.");
    const payload = downtimePayloadOf(existing);
    if (!payload) throw new Error("That downtime record has no activity to apply.");
    if (payload.applied) throw new CodexRevisionConflictError("That downtime has already passed - the clock has already moved.");
    const target = this.proposedDateFor(existing);
    if (!target) throw new Error("Set the campaign's current date before passing time.");
    const calendar = this.getCalendar();
    const applied: CodexDowntimePayload = { ...payload, applied: true };
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET payload_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(applied), this.stamp(), entryId);
      // Same transaction, leaf-level: `writeCalendar` never opens one, and bumps the revision for both.
      this.writeCalendar(normalizeCalendar({ ...calendar, currentDate: target }));
    });
    return { entry: this.getEntry(entryId)!, calendar: this.getCalendar() };
  }

  updateEntry(entryId: string, input: CodexJournalUpdateInput): CodexJournalRow {
    const database = this.requireDatabase();
    const existing = this.journalRowRaw(entryId);
    if (!existing) throw new CodexNotFoundError("That journal entry no longer exists.");
    // A structured date (or a changed free-text label) recomputes the sort instant + display label together.
    const dated = (input.inWorldDate !== undefined || input.inWorldLabel !== undefined) ? this.resolveDate(input.inWorldDate ?? null, input.inWorldLabel) : null;
    /**
     * A deadline may not have its date taken away (D11-C / CT-5).
     *
     * `createDeadline` enforces "a deadline IS its date" and this route did not, so an EDIT could clear
     * the date while leaving `kind = 'deadline'` - producing a row that reads "Deadline - Approaching"
     * on the GM journal, the dashboard card AND every player's timeline, and can never fire, because
     * `deadlineFired` needs an instant to compare. The one invariant the kind exists for, unenforced at
     * the one door that is used more often than create.
     *
     * Rejected rather than ignored: silently keeping the old date would answer a PATCH with something
     * other than what it asked for, and the GM would not learn that the field they just cleared is not
     * optional. The composer disables Save and says so, so this is the second line, not the first.
     */
    if (existing.kind === "deadline" && dated && dated.instant === null) {
      throw new Error("A deadline needs an in-world date - that is what makes it a deadline. Change its date, or delete it and write a note instead.");
    }
    const next = {
      player_text: input.playerText === undefined ? existing.player_text : entryText(input.playerText),
      gm_text: input.gmText === undefined ? existing.gm_text : entryGmText(input.gmText),
      attach_marker_id: input.attachMarkerId === undefined ? existing.attach_marker_id : optionalId(input.attachMarkerId),
      attach_page_id: input.attachPageId === undefined ? existing.attach_page_id : optionalId(input.attachPageId),
      // D9: an OMITTED `sessionId` leaves the filing alone (the journal's existing update contract); an
      // explicit `null` files the entry under no session; an id must name a live session. Unlike a CREATE,
      // an omitted value does NOT auto-file - editing an entry's text must not silently move it into
      // whatever session happens to be active now.
      session_id: input.sessionId === undefined ? existing.session_id : (input.sessionId === null ? null : this.requireSession(input.sessionId)),
      real_date: input.realDate === undefined ? existing.real_date : shortLabel(input.realDate, 40, "date"),
      in_world_label: dated ? dated.label : existing.in_world_label,
      calendar_instant: dated ? dated.instant : existing.calendar_instant,
      in_world_year: dated ? (dated.date ? dated.date.year : null) : existing.in_world_year,
      in_world_month: dated ? (dated.date ? dated.date.month : null) : existing.in_world_month,
      in_world_day: dated ? (dated.date ? dated.date.day : null) : existing.in_world_day,
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags))
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET player_text = ?, gm_text = ?, attach_marker_id = ?, attach_page_id = ?, session_id = ?, real_date = ?, in_world_label = ?, calendar_instant = ?, in_world_year = ?, in_world_month = ?, in_world_day = ?, tags_json = ?, updated_at = ? WHERE id = ?")
        .run(next.player_text, next.gm_text, next.attach_marker_id, next.attach_page_id, next.session_id, next.real_date, next.in_world_label, next.calendar_instant, next.in_world_year, next.in_world_month, next.in_world_day, next.tags_json, this.stamp(), entryId);
      this.indexEntry(entryId, next.player_text, next.gm_text, next.tags_json);
      this.bumpRevision();
    });
    return this.getEntry(entryId)!;
  }

  setEntryRevealed(entryId: string, revealed: boolean): CodexJournalRow {
    const database = this.requireDatabase();
    if (!this.journalRowRaw(entryId)) throw new CodexNotFoundError("That journal entry no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_journal SET revealed = ?, updated_at = ? WHERE id = ?").run(revealed ? 1 : 0, this.stamp(), entryId);
      this.bumpRevision();
    });
    return this.getEntry(entryId)!;
  }

  deleteEntry(entryId: string): void {
    if (!ID.test(entryId)) return;
    this.transaction(() => {
      this.unindex("journal", entryId);
      this.requireDatabase().prepare("DELETE FROM codex_journal WHERE id = ?").run(entryId);
      this.bumpRevision();
    });
  }

  getEntry(entryId: string): CodexJournalRow | null {
    const row = this.journalRowRaw(entryId);
    return row ? this.toEntry(row) : null;
  }

  /** The global campaign timeline, ordered by in-world instant (later), then session number, then time. */
  listTimeline(): CodexJournalRow[] {
    return (this.requireDatabase().prepare(
      `SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} ORDER BY (j.calendar_instant IS NULL), j.calendar_instant, (live_session_number IS NULL), live_session_number, j.created_at`
    ).all() as JournalRowRaw[]).map((row) => this.toEntry(row));
  }

  /**
   * CT-11: the dated `event` pages, the second half of the one chronicle. Undated event pages are simply
   * not on it - a page with no date has no place in a chronology, and inventing one (created-at, say) would
   * scatter the GM's wiki through the timeline in the order they happened to write it.
   *
   * Filtering on `entity_type` here rather than clearing the date on a type switch keeps the type switch
   * lossless: an event demoted to a note and promoted back arrives with its date intact.
   */
  listDatedEventPages(): CodexPageRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE entity_type = 'event' AND calendar_instant IS NOT NULL ORDER BY calendar_instant, created_at`)
      .all() as PageRow[]).map((row) => this.toPage(row));
  }

  /**
   * CT-11 / CT-12: **the one chronicle** - every journal entry and every dated `event` page, interleaved in
   * one chronological order.
   *
   * **Deliberately UNGATED.** It returns every record for both audiences; `projectPlayerChronicleRecord`
   * is the ONLY visibility gate (K1), exactly as M7's page->marker reverse lookup is gated only by its
   * projection. A second filter here would let a broken projection keep passing its tests because this
   * layer quietly caught the leak - which is how M6's SQL predicate bug survived 787 tests. A store test
   * asserts this ungatedness on purpose, so a later "hardening" cannot reintroduce the blind spot.
   */
  listChronicle(): CodexChronicleRecord[] {
    const records: CodexChronicleRecord[] = [
      ...this.listTimeline().map((entry) => ({ kind: "entry", entry }) as const),
      ...this.listDatedEventPages().map((page) => ({ kind: "event", page }) as const)
    ];
    return records.sort((a, b) => compareChronicle(chronicleSortKey(a), chronicleSortKey(b)));
  }

  /** Entries pinned to a specific marker or page (the per-entity mini-timeline). */
  listEntriesFor(attach: Readonly<{ markerId?: string; pageId?: string }>): CodexJournalRow[] {
    const database = this.requireDatabase();
    if (attach.markerId && ID.test(attach.markerId)) return (database.prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.attach_marker_id = ? ORDER BY j.created_at`).all(attach.markerId) as JournalRowRaw[]).map((row) => this.toEntry(row));
    if (attach.pageId && ID.test(attach.pageId)) return (database.prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.attach_page_id = ? ORDER BY j.created_at`).all(attach.pageId) as JournalRowRaw[]).map((row) => this.toEntry(row));
    return [];
  }

  /** The ordinary one-record create: `writeEntry` in its own transaction. See `writeEntry` for the rest. */
  private insertEntry(fields: EntryFields): CodexJournalRow {
    let entryId = "";
    this.transaction(() => { entryId = this.writeEntry(fields); });
    return this.getEntry(entryId)!;
  }

  /**
   * The one INSERT into `codex_journal`, leaf-level: it assumes it is ALREADY inside a transaction, exactly
   * as `writeCalendar` / `writePublishedDate` do and for exactly the same reason - `this.transaction` is a
   * bare `BEGIN IMMEDIATE` and does not nest (F-7).
   *
   * M12 is what forced the split. `setStanding` writes the standing table AND appends this record, and half
   * of that is worse than neither: a value with no record loses the history the spec puts on the timeline,
   * and a record with no value leaves the bar disagreeing with its own chronicle. `insertEntry` above is now
   * this plus a transaction, so every pre-M12 caller behaves byte-for-byte as it did.
   *
   * `indexEntry` runs here, which is what makes a deadline, a downtime, a milestone and a standing record
   * searchable on exactly the terms a note is - no per-kind search path, no per-kind visibility rule (O-2).
   * Verified rather than assumed: store tests search for a deadline's and a milestone's own text. Payload
   * text is deliberately NOT indexed for ANY kind - a downtime's `who`, a milestone's `reason`, a standing's
   * `reason` - because `indexEntry` receives `playerText`/`gmText`/`tags` and nothing else, and adding the
   * payload here would put GM-authored text into the PLAYER index with only the reveal gate behind it.
   */
  private writeEntry(fields: EntryFields): string {
    const database = this.requireDatabase();
    const entryId = this.freshId();
    const stamp = this.stamp();
    const sortKey = ((database.prepare("SELECT MAX(sort_key) AS m FROM codex_journal").get() as { m: number | null }).m ?? 0) + 1;
    const date = fields.inWorldDate;
    const tagsJson = JSON.stringify(tags(fields.tags));
    database.prepare("INSERT INTO codex_journal (id, player_text, gm_text, revealed, attach_marker_id, attach_page_id, kind, source_encounter_id, session_id, real_date, in_world_label, calendar_instant, in_world_year, in_world_month, in_world_day, sort_key, tags_json, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(entryId, fields.playerText, fields.gmText, fields.revealed, fields.attachMarkerId, fields.attachPageId, fields.kind, fields.sourceEncounterId, fields.sessionId, fields.realDate, fields.inWorldLabel, fields.calendarInstant, date ? date.year : null, date ? date.month : null, date ? date.day : null, sortKey, tagsJson, fields.payload ? JSON.stringify(fields.payload) : null, stamp, stamp);
    this.indexEntry(entryId, fields.playerText, fields.gmText, tagsJson);
    this.bumpRevision();
    return entryId;
  }

  private toEntry(row: JournalRowRaw): CodexJournalRow {
    // PARSED, not coerced: before M11 this line read `row.kind === "combat" ? "combat" : "note"`, which
    // silently turns any kind it does not recognise into an ordinary note - so a deadline would have
    // rendered as a note with zero compile errors anywhere. `journalKind` still fails closed to "note", but
    // it does so for exactly the values that are not one of the four, not for everything but "combat".
    const kind = journalKind(row.kind);
    return {
      id: row.id, playerText: row.player_text, gmText: row.gm_text, revealedToPlayers: row.revealed === 1,
      attachMarkerId: row.attach_marker_id, attachPageId: row.attach_page_id, kind,
      sourceEncounterId: row.source_encounter_id, sessionId: row.session_id,
      // D9: the LIVE number from the joined session, falling back to the bare label the row stores. After
      // v19 that fallback fires for exactly one thing: a revealed session that was deleted and stamped its
      // number back onto its entries (director ruling R2).
      sessionNumber: row.live_session_number ?? row.session_number,
      realDate: row.real_date,
      inWorldLabel: row.in_world_label, calendarInstant: row.calendar_instant,
      inWorldDate: row.in_world_year !== null && row.in_world_month !== null && row.in_world_day !== null ? { year: row.in_world_year, month: row.in_world_month, day: row.in_world_day } : null,
      sortKey: row.sort_key, tags: parseTags(row.tags_json),
      // Read ONLY for the kind that owns one, and with THAT kind's parser. A stray payload on a note is
      // ignored rather than surfaced, so a hand-edited or future-version row cannot smuggle one kind's
      // payload onto another kind's record - and `null` is what makes "no payload" the same value for the
      // three kinds that have none. This switch is the single home of the kind -> payload mapping;
      // `downtimePayloadOf` / `milestonePayloadOf` / `standingPayloadOf` are how every reader above asks it.
      payload: payloadOf(kind, row.payload_json),
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }
  private journalRowRaw(entryId: string): JournalRowRaw | undefined {
    if (!ID.test(entryId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${JOURNAL_COLUMNS} FROM ${JOURNAL_FROM} WHERE j.id = ?`).get(entryId) as JournalRowRaw | undefined;
  }

  private toMap(row: MapRowRaw): CodexMapRow {
    return { id: row.id, assetId: row.asset_id, name: row.name, kind: mapKind(row.kind), parentMapId: row.parent_map_id, revealedToPlayers: row.revealed === 1, sortKey: row.sort_key, tags: parseTags(row.tags_json), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private toMarker(row: MarkerRowRaw): CodexMarkerRow {
    return { id: row.id, mapId: row.map_id, x: row.x, y: row.y, iconId: row.icon_id, iconColor: row.icon_color, label: row.label, revealedToPlayers: row.revealed === 1, pageIds: parseIdArray(row.page_ids_json), subMapId: row.sub_map_id, sceneIds: parseIdArray(row.scene_ids_json), actorId: row.actor_id, tags: parseTags(row.tags_json), isParty: row.is_party === 1, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  private mapRowRaw(mapId: string): MapRowRaw | undefined {
    if (!ID.test(mapId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${MAP_COLUMNS} FROM codex_maps WHERE id = ?`).get(mapId) as MapRowRaw | undefined;
  }
  private markerRowRaw(markerId: string): MarkerRowRaw | undefined {
    if (!ID.test(markerId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${MARKER_COLUMNS} FROM codex_markers WHERE id = ?`).get(markerId) as MarkerRowRaw | undefined;
  }

  // ----- Sessions (M9: the GM's prep on one side, the players' recap on the other) -----
  //
  // Modelled on `codex_pages` throughout, because a session is the only OTHER record with an editor
  // behind it: `rev` is the editor's conflict token (stale `expectedRev` -> 409), create stamps
  // `created_at === updated_at`, and every write runs inside `this.transaction` with a `bumpRevision()`
  // so clients refetch. Where sessions differ from pages they differ deliberately, and each difference
  // is commented at the method that makes it.

  createSession(input: CodexSessionCreateInput): CodexSessionRow {
    const database = this.requireDatabase();
    const sessionId = this.freshId();
    const stamp = this.stamp();
    const row: SessionRowRaw = {
      id: sessionId,
      session_number: sessionNo(input.sessionNumber),
      real_date: shortLabel(input.realDate, 40, "date"),
      attendees_json: JSON.stringify(attendees(input.attendees)),
      prep_body: body(input.prepBody),
      recap_body: body(input.recapBody),
      revealed: input.revealedToPlayers ? 1 : 0,
      status: sessionStatus(input.status),
      rev: 1, created_at: stamp, updated_at: stamp,
      tags_json: JSON.stringify(tags(input.tags))
    };
    this.guardSessionNumber(row.session_number, () => {
      this.transaction(() => {
        database.prepare(`INSERT INTO codex_sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.id, row.session_number, row.real_date, row.attendees_json, row.prep_body, row.recap_body, row.revealed, row.status, row.rev, row.created_at, row.updated_at, row.tags_json);
        this.indexSession(row);
        this.bumpRevision();
      });
    });
    return this.getSession(sessionId)!;
  }

  /**
   * Omitted-field-means-unchanged, the page/journal update contract verbatim: the session console PATCHes
   * a whole draft on every autosave, and a rule of "absent means clear" would wipe the recap the first
   * time prep was edited from a surface that does not carry it.
   *
   * `authorTag` is accepted for signature symmetry with `updatePage` and is deliberately unused: sessions
   * keep no revision history (there is no `codex_session_revisions` table), so there is nothing to attribute.
   */
  updateSession(sessionId: string, input: CodexSessionUpdateInput, expectedRev: number | undefined, authorTag: string): CodexSessionRow {
    void authorTag;
    const database = this.requireDatabase();
    const existing = this.sessionRowRaw(sessionId);
    if (!existing) throw new CodexNotFoundError("That session no longer exists.");
    if (expectedRev !== undefined && expectedRev !== existing.rev) throw new CodexRevisionConflictError("This session was changed somewhere else after you opened it.");
    const next: SessionRowRaw = {
      ...existing,
      session_number: input.sessionNumber === undefined ? existing.session_number : sessionNo(input.sessionNumber),
      real_date: input.realDate === undefined ? existing.real_date : shortLabel(input.realDate, 40, "date"),
      attendees_json: input.attendees === undefined ? existing.attendees_json : JSON.stringify(attendees(input.attendees)),
      prep_body: input.prepBody === undefined ? existing.prep_body : body(input.prepBody),
      recap_body: input.recapBody === undefined ? existing.recap_body : body(input.recapBody),
      status: input.status === undefined ? existing.status : sessionStatus(input.status),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      // `rev` and `updated_at` move TOGETHER on an edit: the conflict token and the recency stamp both
      // describe "this record was written", and splitting them is what CI-9's exceptions below are for.
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.guardSessionNumber(next.session_number, () => {
      this.transaction(() => {
        database.prepare("UPDATE codex_sessions SET session_number = ?, real_date = ?, attendees_json = ?, prep_body = ?, recap_body = ?, status = ?, tags_json = ?, rev = ?, updated_at = ? WHERE id = ?")
          .run(next.session_number, next.real_date, next.attendees_json, next.prep_body, next.recap_body, next.status, next.tags_json, next.rev, next.updated_at, sessionId);
        this.indexSession(next);
        this.bumpRevision();
      });
    });
    return this.getSession(sessionId)!;
  }

  /**
   * CI-9, exactly `setPageRevealed`: publishing a recap is not an EDIT of it, so this moves neither `rev`
   * (an open console would 409 on a reveal nobody typed) nor `updated_at`.
   *
   * A consequence worth stating, because the obvious guess is wrong in BOTH directions: `updated_at` is
   * not a usable signal for CT-3's "new since you last looked" badge. It does not move here, so the one
   * event the badge exists for - a recap becoming visible - would never fire it; and it DOES move when the
   * GM edits `prep_body`, so it would fire on GM prep activity the player is not supposed to know about.
   * The badge therefore keys on WHICH revealed sessions this reader has already opened, by id, which is
   * already in the player projection and leaks nothing new.
   */
  setSessionRevealed(sessionId: string, revealed: boolean): CodexSessionRow {
    const database = this.requireDatabase();
    if (!this.sessionRowRaw(sessionId)) throw new CodexNotFoundError("That session no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_sessions SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, sessionId);
      this.bumpRevision();
    });
    return this.getSession(sessionId)!;
  }

  /**
   * Idempotent, and an early return on a malformed id - every other codex delete behaves this way.
   *
   * **The entries it leaves behind (director ruling R2).** `session_id` has no foreign key, so this scrubs
   * the join itself - and what it writes in the number's place is CONDITIONAL, because the two cases have
   * opposite right answers:
   *
   *  - The deleted session was REVEALED and numbered: its number is stamped back onto its entries as a bare
   *    display label. Behaviour-preserving - the players were already reading "Session 4" on those entries,
   *    and deleting the record must not silently erase the history's own numbering.
   *  - The deleted session was HIDDEN (or unnumbered): the entries get NO label. A bare label passes through
   *    the player projection by construction - there is no record left to gate on - so stamping a hidden
   *    session's number back would tell the table that a session they were never shown existed. Secret by
   *    default wins, and losing a label the players never saw costs nothing.
   */
  deleteSession(sessionId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(sessionId)) return;
    const existing = this.sessionRowRaw(sessionId);
    const stampBack = existing && existing.revealed === 1 ? existing.session_number : null;
    this.transaction(() => {
      if (stampBack !== null) database.prepare("UPDATE codex_journal SET session_id = NULL, session_number = ? WHERE session_id = ?").run(stampBack, sessionId);
      else database.prepare("UPDATE codex_journal SET session_id = NULL WHERE session_id = ?").run(sessionId);
      database.prepare("DELETE FROM codex_sessions WHERE id = ?").run(sessionId);
      this.unindex("session", sessionId);
      // Clearing the pointer is PART of the delete, not a separate tidy-up: there is no FK doing it (see
      // migration v13), and a dangling `active_session_id` would have `activeSessionId` name a record that
      // no longer exists - which the sessions list hands straight to the GM.
      database.prepare("UPDATE codex_meta SET active_session_id = NULL WHERE active_session_id = ?").run(sessionId);
      this.bumpRevision();
    });
  }

  getSession(sessionId: string): CodexSessionRow | null {
    const row = this.sessionRowRaw(sessionId);
    return row ? this.toSession(row) : null;
  }

  /**
   * Numbered sessions first in number order, then the unnumbered ones oldest-first. The leading
   * `(session_number IS NULL)` is the same tier-separator idiom `listTimeline`'s ORDER BY and
   * `compareChronicle` use for undated records, so the codex has ONE way of saying "these sort below
   * those" rather than a new one per table.
   */
  listSessions(): CodexSessionRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${SESSION_COLUMNS} FROM codex_sessions ORDER BY (session_number IS NULL), session_number, created_at`)
      .all() as SessionRowRaw[]).map((row) => this.toSession(row));
  }

  /**
   * The session IDS the players have NOT been shown. The resolution every player journal read needs before
   * it may hand a player an entry's session link OR its number - a session's very EXISTENCE is GM
   * information (`GET /codex/sessions/:id` 404s a player on an unrevealed one rather than 403ing, and the
   * list omits it), so either half of the link would announce it.
   *
   * D9 changed the KEY from number to id, and that is what closes the gap the number version could not: an
   * unnumbered hidden session could not appear in a set of numbers at all, so an entry filed under one had
   * nothing to gate on. Now the gate is the join, which every filed entry has.
   *
   * Deliberately the UNREVEALED set rather than the revealed one, and the asymmetry is still the rule: an
   * entry with a bare LABEL and no join (director ruling R2's stamp-back, the only writer left) is in
   * neither set and keeps travelling, because there is no record left whose existence it could give away -
   * and R2 only ever stamps a number the players had already been shown.
   */
  unrevealedSessionIds(): ReadonlySet<string> {
    const rows = this.requireDatabase()
      .prepare("SELECT id FROM codex_sessions WHERE revealed = 0")
      .all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  /** The session the table is currently playing, or null. One meta row, therefore one pointer (v13). */
  get activeSessionId(): string | null {
    return (this.requireDatabase().prepare("SELECT active_session_id FROM codex_meta WHERE id = 1").get() as { active_session_id: string | null } | undefined)?.active_session_id ?? null;
  }

  /**
   * Point the table at a session (or clear it with `null`). Writes `codex_meta` ONLY, and that is the
   * whole design: activating is a statement about the TABLE, not an edit of the record, so it must not
   * move the session's `rev` (409ing an open console) or its `updated_at` (lighting the recap badge on a
   * session nobody wrote). Same seam CI-9 draws between recency and conflict detection everywhere else.
   */
  setActiveSession(sessionId: string | null): string | null {
    const database = this.requireDatabase();
    const next = sessionId === null ? null : id(sessionId);
    if (next !== null && !this.sessionRowRaw(next)) throw new CodexNotFoundError("That session no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_meta SET active_session_id = ? WHERE id = 1").run(next);
      this.bumpRevision();
    });
    return next;
  }

  /**
   * D9's write-resolution rule, in one place so every journal creator obeys it identically.
   *
   *  - OMITTED (`undefined`) -> auto-file under the ACTIVE session, by id.
   *  - explicit `null`       -> no session.
   *  - an id                 -> that session, which must exist.
   *
   * This is strictly better than the number-stamping it replaces. Auto-linking used to resolve the active
   * session's NUMBER, so an UNNUMBERED active session could not auto-link at all; now the entry joins the
   * record and its number appears on every entry the moment the GM numbers it.
   */
  private resolveEntrySession(sessionId: string | null | undefined): string | null {
    if (sessionId === undefined) return this.activeSessionId;
    if (sessionId === null) return null;
    return this.requireSession(sessionId);
  }

  /** The id of a session that must exist. Not-found rather than a silent null: a write naming a session that is gone is a mistake worth hearing about. */
  private requireSession(sessionId: string): string {
    const resolved = id(sessionId);
    if (!this.sessionRowRaw(resolved)) throw new CodexNotFoundError("That session no longer exists.");
    return resolved;
  }

  /**
   * Run a session write that could collide on `session_number`, translating the partial-unique-index
   * violation into copy the GM can act on. The INDEX is the enforcement, not a pre-check `SELECT`: a
   * read-then-write would be a second answer to the same question and a race against itself, and the
   * whole reason v13 has the constraint is that the by-session lens needs the resolution to be total.
   *
   * Matching on the message is the only handle `node:sqlite` offers (`err.code` is the generic
   * `ERR_SQLITE_ERROR` for every constraint), and it is safe HERE specifically: the only unique
   * constraints on `codex_sessions` are the primary key - which is a freshly minted uuid - and this
   * index. Anything else rethrows untouched.
   */
  private guardSessionNumber(sessionNumber: number | null, work: () => void): void {
    try { work(); }
    catch (error) {
      if (sessionNumber !== null && error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        throw new Error(`Session ${sessionNumber} already exists. Give this one a different number.`);
      }
      throw error;
    }
  }

  private toSession(row: SessionRowRaw): CodexSessionRow {
    return {
      id: row.id, sessionNumber: row.session_number, realDate: row.real_date,
      // `parseTags` is the codex's defensive "read a stored JSON string array" reader (a malformed value
      // degrades to empty rather than throwing); attendees are stored the same way, so it is reused rather
      // than copied. It does NOT slug - that happens on the way in, and attendees deliberately skip it.
      attendees: parseTags(row.attendees_json),
      prepBody: row.prep_body, recapBody: row.recap_body,
      revealedToPlayers: row.revealed === 1,
      // Anything unrecognised reads as `planned`, the harmless half of the enum - the same fail-safe
      // `toEntry` applies to a journal row's `kind`.
      status: row.status === "played" ? "played" : "planned",
      tags: parseTags(row.tags_json),
      rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private sessionRowRaw(sessionId: string): SessionRowRaw | undefined {
    if (!ID.test(sessionId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${SESSION_COLUMNS} FROM codex_sessions WHERE id = ?`).get(sessionId) as SessionRowRaw | undefined;
  }

  // ----- Quests (M10 / CT-4: what is still open) -----
  //
  // The session section directly above is the model, one milestone later, and deliberately so: a quest is
  // the third record with an editor behind it, so `rev` is the editor's conflict token (stale
  // `expectedRev` -> 409), create stamps `created_at === updated_at`, and every write runs inside
  // `this.transaction` with a `bumpRevision()` so clients refetch. Where quests differ from sessions they
  // differ for a stated reason, at the method that makes the difference.
  //
  // The ONE structural difference: a quest joins the suite-wide search index and a session does not, so
  // every write here has an `indexQuest` twin inside the same transaction and `deleteQuest` unindexes.

  createQuest(input: CodexQuestCreateInput): CodexQuestRow {
    const database = this.requireDatabase();
    const questId = this.freshId();
    const stamp = this.stamp();
    const row: QuestRowRaw = {
      id: questId,
      title: title(input.title),
      status: questStatus(input.status),
      player_body: body(input.playerBody),
      gm_body: body(input.gmBody),
      objectives_json: JSON.stringify(questObjectives(input.objectives)),
      // `idArray` validates, caps at 24 and drops duplicates - the marker link contract verbatim. Dropping
      // duplicates is right HERE and wrong for `objectives`: a linked entity is a SET (linking Strahd twice
      // means nothing), while two objectives may legitimately read the same and still be two steps.
      entity_ids_json: JSON.stringify(idArray(input.entityIds)),
      revealed: input.revealedToPlayers ? 1 : 0,
      rev: 1, created_at: stamp, updated_at: stamp,
      tags_json: JSON.stringify(tags(input.tags))
    };
    this.transaction(() => {
      database.prepare(`INSERT INTO codex_quests (${QUEST_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.title, row.status, row.player_body, row.gm_body, row.objectives_json, row.entity_ids_json, row.revealed, row.rev, row.created_at, row.updated_at, row.tags_json);
      this.indexQuest(row.id, row.title, row.player_body, row.gm_body, row.objectives_json, row.tags_json);
      this.bumpRevision();
    });
    return this.getQuest(questId)!;
  }

  /**
   * Omitted-field-means-unchanged, the page/journal/session update contract verbatim: the quest editor
   * PATCHes a whole draft on every autosave, and a rule of "absent means clear" would wipe the objectives
   * the first time the body was edited from a surface that does not carry them.
   *
   * An `objectives` array that IS supplied replaces the stored list WHOLESALE - it is not merged item by
   * item and no index is matched across the write. That is what makes reordering, deleting and inserting a
   * row all the same operation, and it is why nothing in this file needs a per-objective identity.
   */
  updateQuest(questId: string, input: CodexQuestUpdateInput, expectedRev: number | undefined): CodexQuestRow {
    const database = this.requireDatabase();
    const existing = this.questRowRaw(questId);
    if (!existing) throw new CodexNotFoundError("That quest no longer exists.");
    if (expectedRev !== undefined && expectedRev !== existing.rev) throw new CodexRevisionConflictError("This quest was changed somewhere else after you opened it.");
    const next: QuestRowRaw = {
      ...existing,
      title: input.title === undefined ? existing.title : title(input.title),
      status: input.status === undefined ? existing.status : questStatus(input.status),
      player_body: input.playerBody === undefined ? existing.player_body : body(input.playerBody),
      gm_body: input.gmBody === undefined ? existing.gm_body : body(input.gmBody),
      objectives_json: input.objectives === undefined ? existing.objectives_json : JSON.stringify(questObjectives(input.objectives)),
      entity_ids_json: input.entityIds === undefined ? existing.entity_ids_json : JSON.stringify(idArray(input.entityIds)),
      tags_json: input.tags === undefined ? existing.tags_json : JSON.stringify(tags(input.tags)),
      // `rev` and `updated_at` move TOGETHER on an edit, exactly as `updateSession` does - the conflict
      // token and the recency stamp both mean "this record was written". `setQuestRevealed` is the
      // documented exception (CI-9).
      rev: existing.rev + 1,
      updated_at: this.stamp()
    };
    this.transaction(() => {
      database.prepare("UPDATE codex_quests SET title = ?, status = ?, player_body = ?, gm_body = ?, objectives_json = ?, entity_ids_json = ?, tags_json = ?, rev = ?, updated_at = ? WHERE id = ?")
        .run(next.title, next.status, next.player_body, next.gm_body, next.objectives_json, next.entity_ids_json, next.tags_json, next.rev, next.updated_at, questId);
      // The indexed TEXT really can change here (title, player body, objective text), so this write has an
      // index twin; `setQuestRevealed` below deliberately does not, because reveal is resolved at read time.
      this.indexQuest(questId, next.title, next.player_body, next.gm_body, next.objectives_json, next.tags_json);
      this.bumpRevision();
    });
    return this.getQuest(questId)!;
  }

  /**
   * CI-9, exactly `setPageRevealed` / `setSessionRevealed`: publishing a quest is not an EDIT of it, so
   * this moves neither `rev` (an open editor would 409 on a reveal nobody typed) nor `updated_at`.
   *
   * It also does NOT reindex, and that is not an omission: reveal state is resolved against the live row
   * at read time by `PLAYER_VISIBLE_SQL`, so the index rows are already correct for both audiences the
   * instant this returns. Reindexing here would be a no-op that implied the opposite.
   */
  setQuestRevealed(questId: string, revealed: boolean): CodexQuestRow {
    const database = this.requireDatabase();
    if (!this.questRowRaw(questId)) throw new CodexNotFoundError("That quest no longer exists.");
    this.transaction(() => {
      database.prepare("UPDATE codex_quests SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, questId);
      this.bumpRevision();
    });
    return this.getQuest(questId)!;
  }

  /** Idempotent, and an early return on a malformed id - every other codex delete behaves this way. */
  deleteQuest(questId: string): void {
    const database = this.requireDatabase();
    if (!ID.test(questId)) return;
    this.transaction(() => {
      database.prepare("DELETE FROM codex_quests WHERE id = ?").run(questId);
      // Unindexing is PART of the delete: an orphaned index row keeps matching forever with no live row
      // left for `PLAYER_VISIBLE_SQL` to gate it on - and `ELSE 0`-style safety does not apply, because
      // the row's `kind` is still a recognised one. The map-delete cascade taught this the hard way.
      this.unindex("quest", questId);
      this.bumpRevision();
    });
  }

  getQuest(questId: string): CodexQuestRow | null {
    const row = this.questRowRaw(questId);
    return row ? this.toQuest(row) : null;
  }

  /**
   * Oldest-first. A quest has no number and no in-world date, so the order it was STARTED in is the only
   * intrinsic one it has - alphabetical (the page list's rule) would scatter a campaign's arc, and
   * status-first would make a quest jump position the moment it was completed, which is exactly when the
   * GM is looking at it.
   *
   * Note what this deliberately is NOT: the dashboard's "what is still open" is a `status` FILTER over
   * this list, not a different order. That filter is what migration v14's `codex_quests_status` index
   * serves; ordering by status as well would bake one caller's view into every caller's read.
   */
  listQuests(): CodexQuestRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests ORDER BY created_at, id`)
      .all() as QuestRowRaw[]).map((row) => this.toQuest(row));
  }

  private toQuest(row: QuestRowRaw): CodexQuestRow {
    return {
      id: row.id, title: row.title,
      // Anything unrecognised reads as `active`, the same fail-safe `toSession` applies to a status and
      // `toEntry` to a journal kind. A quest that cannot be classified is one that is still open.
      status: row.status === "completed" ? "completed" : row.status === "failed" ? "failed" : "active",
      playerBody: row.player_body, gmBody: row.gm_body,
      objectives: parseObjectives(row.objectives_json),
      entityIds: parseIdArray(row.entity_ids_json),
      revealedToPlayers: row.revealed === 1,
      tags: parseTags(row.tags_json), rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private questRowRaw(questId: string): QuestRowRaw | undefined {
    if (!ID.test(questId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests WHERE id = ?`).get(questId) as QuestRowRaw | undefined;
  }

  // ----- Standing (M12 / CT-6: where the party stands with each faction) -----
  //
  // TWO records per change, and the split is the design (spec §2.1): `codex_standing` holds where things
  // stand NOW, one row per faction; the timeline holds what HAPPENED, one `kind='standing'` record per
  // change. Neither is derivable from the other - summing the timeline would make a deleted record silently
  // move the bar, and the table alone would answer "where are we" while forgetting "how did we get here".
  //
  // The two also reveal INDEPENDENTLY, on purpose. A GM can tell the party "you did the Harpers a favour"
  // (reveal the record) without showing them the bar, or publish the bar without narrating every step that
  // built it. One shared flag would have quietly coupled two different disclosure decisions.

  /**
   * Oldest-first, `listQuests`' rule and for its reason: a standing has no number and no in-world date, so
   * the order it was first recorded in is the only intrinsic one it has. Sorting by VALUE would make a
   * faction jump position the moment the GM adjusted it - exactly when they are looking at it - and sorting
   * by faction NAME belongs to whoever renders the card, which has the titles this row deliberately does not.
   */
  listStanding(): CodexStandingRow[] {
    return (this.requireDatabase()
      .prepare(`SELECT ${STANDING_COLUMNS} FROM codex_standing ORDER BY created_at, id`)
      .all() as StandingRowRaw[]).map((row) => this.toStanding(row));
  }

  /** One faction's standing, or `null` when the GM has never set one (which reads as Neutral, not as an error). */
  getStanding(factionPageId: string): CodexStandingRow | null {
    const row = this.standingRowRaw(factionPageId);
    return row ? this.toStanding(row) : null;
  }

  /**
   * CT-6's one write: set where the party stands with a faction, AND record what changed, in **one**
   * transaction (F-7).
   *
   * The two writes are one unit because half of this is worse than neither: a moved bar with no record
   * loses the history the spec puts on the timeline (and there is nowhere else it exists), while a record
   * with no moved bar leaves the campaign's history disagreeing with the campaign's state. `writeEntry` and
   * `writeStanding` are leaf-level for exactly this - `this.transaction` is a bare `BEGIN IMMEDIATE` and
   * does not nest, the same shape `applyDowntime` uses with `writeCalendar`.
   *
   * `value` is ABSOLUTE and the record's `delta` is the CHANGE. That asymmetry is the spec's (§2.2) and it
   * is the right way round: the GM's action is "put the Harpers here", which is a position, while the
   * history's question is "what happened", which is a movement. Computing the delta here rather than
   * accepting one is what keeps them consistent - a caller-supplied delta could disagree with the value it
   * was supposed to explain.
   *
   * A faction with no row yet counts as 0 (Neutral), so the first ever set records the full move from
   * neutral rather than a mysterious delta of nothing.
   *
   * A record is written on EVERY set, including one that changes nothing. Suppressing the delta-0 case
   * would be a hidden rule ("your reason was not saved because the number happened to match"), and
   * "we held the line; nothing moved" is a legitimate thing for a GM to record.
   *
   * The faction must be a page of entity type `faction` (spec §2.1: "FK to a `codex_pages` row with
   * `entity_type = 'faction'`"). SQLite cannot express that in a foreign key - a CHECK may not subquery -
   * so this is the only place it can be enforced, and it is enforced with a message a GM can read rather
   * than left to the FK's "FOREIGN KEY constraint failed".
   *
   * Reveal state is NEVER touched here. Adjusting a number is not a disclosure decision, and an update that
   * silently published the bar would be the worst possible way to find that out.
   */
  setStanding(factionPageId: string, value: number, reason: string): CodexStandingRow {
    const pageId = id(factionPageId);
    const page = this.pageRow(pageId);
    if (!page) throw new CodexNotFoundError("That faction page no longer exists.");
    const existing = this.standingRowRaw(pageId);
    /**
     * The entity type is required to START tracking standing, not to keep tracking it.
     *
     * The spec asks for `faction_page_id` to reference a page "with `entity_type = 'faction'`", which SQLite
     * cannot express (a CHECK may not subquery), so it is enforced here. But enforcing it on EVERY write
     * created a trap: change a faction page's type afterwards and its standing row becomes permanently
     * uneditable while STILL being projected to players — a player-visible number the GM could not zero,
     * hide or correct. Found by adversarial review and reproduced through the real routes.
     *
     * Grandfathering an existing row keeps the bad state repairable, which matters more than refusing it
     * tidily: the GM can always zero it, unreveal it, or delete the page. Creating a new row still requires
     * a faction, so the rule holds where it is actually doing work.
     */
    if (!existing && page.entity_type !== "faction") throw new Error("Standing is tracked against a faction - pick a faction page.");
    const next = standingValue(value);
    // Measured against the CLAMPED previous value (`toStanding`'s), not the raw column, so the deltas on the
    // timeline always sum to the number the bar shows. A hand-edited row holding 500 reads as 100
    // everywhere; a delta computed from 500 would describe a move nobody could see.
    const payload = standingPayload({ factionPageId: pageId, delta: next - (existing ? this.toStanding(existing).value : 0), reason });
    // Dated at the GM's clock, `appendCombatEntry` / `createDowntime` / `createMilestone`'s rule: a standing
    // change lands on the timeline where it happened rather than sinking below every dated record forever.
    const dated = this.resolveDate(this.getCalendar().currentDate ?? null, null);
    const stamp = this.stamp();
    this.transaction(() => {
      this.writeStanding(pageId, next, existing, stamp);
      this.writeEntry({
        // The record's prose lives in the payload's `reason` and NOWHERE else. Copying it into `playerText`
        // as well would give one sentence two homes with two different reveal gates in front of them, which
        // is the leak shape K1 exists to prevent - and it would put a GM-authored reason into the PLAYER
        // search index, which `indexEntry` feeds from `playerText`. A GM who wants a two-layer narrative
        // around a standing change writes an ordinary note; this record is the structured fact.
        playerText: "", gmText: null, revealed: 0,
        attachMarkerId: null, attachPageId: null, kind: "standing",
        sourceEncounterId: null, sessionId: this.activeSessionId, realDate: null,
        inWorldLabel: dated.label, calendarInstant: dated.instant, inWorldDate: dated.date, payload
      });
    });
    return this.getStanding(pageId)!;
  }

  /**
   * CI-9, exactly `setQuestRevealed` / `setPageRevealed`: publishing a standing is not an EDIT of it, so
   * this moves neither `updated_at` nor anything else. It writes no chronicle record either - `setStanding`
   * records CHANGES to the number, and choosing to show the party a number that did not move is not one.
   */
  setStandingRevealed(factionPageId: string, revealed: boolean): CodexStandingRow {
    const database = this.requireDatabase();
    const pageId = id(factionPageId);
    if (!this.standingRowRaw(pageId)) throw new CodexNotFoundError("That faction has no standing recorded yet.");
    this.transaction(() => {
      database.prepare("UPDATE codex_standing SET revealed = ? WHERE faction_page_id = ?").run(revealed ? 1 : 0, pageId);
      this.bumpRevision();
    });
    return this.getStanding(pageId)!;
  }

  /**
   * The one write of the standing table. Leaf-level: assumes it is already inside a transaction, the
   * `writeCalendar` / `writePublishedDate` contract (F-7).
   *
   * The UPDATE branch names its columns and `revealed` is not among them, which is what makes "adjusting a
   * number never changes who can see it" structural rather than a rule every caller has to remember.
   * `created_at` likewise survives an update, so `listStanding`'s order is stable as values move.
   */
  private writeStanding(factionPageId: string, value: number, existing: StandingRowRaw | undefined, stamp: string): void {
    const database = this.requireDatabase();
    if (existing) database.prepare("UPDATE codex_standing SET value = ?, updated_at = ? WHERE faction_page_id = ?").run(value, stamp, factionPageId);
    // O-2 / P2: a brand-new standing starts HIDDEN, like every other record in this codex.
    else database.prepare(`INSERT INTO codex_standing (${STANDING_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`).run(this.freshId(), factionPageId, value, 0, stamp, stamp);
  }

  private toStanding(row: StandingRowRaw): CodexStandingRow {
    return {
      id: row.id, factionPageId: row.faction_page_id,
      // Clamped on the way OUT as well as in, the fail-closed discipline `toQuest`/`toEntry` apply to their
      // enums: v16 puts no CHECK on this column (a scale is a product decision, not a structural one), so a
      // hand-edited row reads back as the nearest legal position rather than driving a bar off its track.
      value: Math.min(MAX_STANDING, Math.max(MIN_STANDING, Math.trunc(row.value))),
      revealedToPlayers: row.revealed === 1,
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private standingRowRaw(factionPageId: string): StandingRowRaw | undefined {
    if (!ID.test(factionPageId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${STANDING_COLUMNS} FROM codex_standing WHERE faction_page_id = ?`).get(factionPageId) as StandingRowRaw | undefined;
  }

  // ----- internals -----

  private pageRow(pageId: string): PageRow | undefined {
    if (!ID.test(pageId)) return undefined;
    return this.requireDatabase().prepare(`SELECT ${PAGE_COLUMNS} FROM codex_pages WHERE id = ?`).get(pageId) as PageRow | undefined;
  }

  private toPage(row: PageRow): CodexPageRow {
    return {
      id: row.id, title: row.title, entityType: (row.entity_type as CodexEntityType) ?? "note", fields: parseFields(row.fields_json), gmFields: parseFields(row.gm_fields_json),
      folder: row.folder, tags: JSON.parse(row.tags_json) as string[],
      playerBody: row.player_body, gmBody: row.gm_body, revealedToPlayers: row.revealed === 1,
      bannerAssetId: row.banner_asset_id,
      inWorldLabel: row.in_world_label, calendarInstant: row.calendar_instant, inWorldDate: pageDateOf(row),
      rev: row.rev, createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  private rebuildLinks(pageId: string, playerBody: string, gmBody: string) {
    const database = this.requireDatabase();
    database.prepare("DELETE FROM codex_links WHERE source_page_id = ?").run(pageId);
    const links = [...parseWikiLinks(playerBody, "player"), ...parseWikiLinks(gmBody, "gm")];
    const insert = database.prepare("INSERT INTO codex_links (source_page_id, layer, target_kind, target_ref, section) VALUES (?, ?, ?, ?, ?)");
    for (const link of links) insert.run(pageId, link.layer, link.targetKind, link.targetRef, link.section);
  }

  // ----- Search index upkeep (the ONE index, both audiences) -----
  //
  // Every method that changes a record's indexed TEXT calls its `index*` twin inside the same
  // transaction; every delete calls `unindex`. Reveal flags are NOT indexed (resolved at read time),
  // so `set*Revealed` and `moveMarker` deliberately do not reindex.

  /** Replace one record's row in both indexes. `player` must contain player-layer text ONLY. */
  private indexRecord(kind: CodexRecordKind, recordId: string, player: { title: string; body: string }, gm: { title: string; body: string }) {
    const database = this.requireDatabase();
    this.unindex(kind, recordId);
    database.prepare("INSERT INTO codex_search_player (kind, record_id, title, body) VALUES (?, ?, ?, ?)").run(kind, recordId, player.title, player.body);
    database.prepare("INSERT INTO codex_search_gm (kind, record_id, title, body) VALUES (?, ?, ?, ?)").run(kind, recordId, gm.title, gm.body);
  }

  private unindex(kind: CodexRecordKind, recordId: string) {
    const database = this.requireDatabase();
    database.prepare("DELETE FROM codex_search_player WHERE kind = ? AND record_id = ?").run(kind, recordId);
    database.prepare("DELETE FROM codex_search_gm WHERE kind = ? AND record_id = ?").run(kind, recordId);
  }

  private indexPage(pageId: string, pageTitle: string, playerBody: string, gmBody: string, fieldsJson: string, gmFieldsJson: string, tagsJson: string) {
    const fieldText = Object.values(parseFields(fieldsJson)).join(" ");     // public field VALUES (race, ruler, ...)
    const gmFieldText = Object.values(parseFields(gmFieldsJson)).join(" ");  // GM-only field values (secret motives)
    // Tags are indexed for pages too. Maps, markers and journal entries all index theirs, so leaving pages
    // out made ONE search box answer a tag query differently depending on what happened to carry the tag —
    // which reads as a broken search, not as a boundary. R8 ("one result list, all record types") plus CI-2
    // ("tags on all record types") only hold together if a tag matches uniformly. This DOES widen existing
    // page search: a page tagged `villain` now matches "villain". Deliberate; see the decision log.
    const tagText = parseTags(tagsJson).join(" ");
    // Player index carries ONLY player-facing text (body + public fields + tags, which are already
    // player-visible on a revealed page): a player search can never surface gm content.
    this.indexRecord("page", pageId,
      { title: pageTitle, body: `${playerBody}\n${fieldText}\n${tagText}` },
      { title: pageTitle, body: `${playerBody}\n${gmBody}\n${fieldText}\n${gmFieldText}\n${tagText}` });
  }

  /** A map's name + tags. Single-layer text (no GM-only half), so both audiences index the same string. */
  private indexMap(mapId: string, name: string, tagsJson: string) {
    const row = { title: name, body: parseTags(tagsJson).join(" ") };
    this.indexRecord("map", mapId, row, row);
  }

  /** A marker's label + tags. Single-layer text; a hidden pin is hidden by the read-time predicate. */
  private indexMarker(markerId: string, label: string | null, tagsJson: string) {
    const row = { title: label ?? "", body: parseTags(tagsJson).join(" ") };
    this.indexRecord("marker", markerId, row, row);
  }

  /**
   * A quest is two-layer like a page: `gmBody` goes ONLY into the GM index. This is search gate 1 (see
   * `CodexRecordKind`), and the one with no second line of defence - `PLAYER_VISIBLE_SQL` and
   * `projectPlayerSearchHit` both PASS a revealed quest, so if `gmBody` were in the player row a player
   * typing a GM-only phrase would get a hit on a quest they are entitled to see. The body is never
   * returned, but the hit's EXISTENCE is the leak: it confirms the phrase appears somewhere secret.
   *
   * Objective text goes in the PLAYER row on purpose. An objective lives beside `playerBody`, not
   * `gmBody` - it is the checklist the party is working from, and it ships with the quest on reveal, so
   * indexing it for players matches what they already receive. The GM row carries it too, or the GM's
   * search would be strictly weaker than the player's on the same record.
   *
   * D10 gives quests tags, so the tag text is appended to BOTH audience rows. Tags are single-layer by
   * CI-2 - there is no GM-only tag - and every other kind already indexes theirs, so leaving quests out
   * would make ONE search box answer a tag query differently depending on what carried the tag.
   */
  private indexQuest(questId: string, questTitle: string, playerBody: string, gmBody: string, objectivesJson: string, tagsJson: string) {
    const objectiveText = parseObjectives(objectivesJson).map((objective) => objective.text).join(" ");
    const tagText = parseTags(tagsJson).join(" ");
    this.indexRecord("quest", questId,
      { title: questTitle, body: `${playerBody}\n${objectiveText}\n${tagText}` },
      { title: questTitle, body: `${playerBody}\n${gmBody}\n${objectiveText}\n${tagText}` });
  }

  /**
   * D10: a session in the ONE search index. GATE 1 (see `CodexRecordKind`), and the gate with no second
   * line of defence - so the split between the two audience rows is the whole safety argument here:
   *
   *  - PLAYER: recap, real date, tags. Every one of those is already emitted by `projectPlayerSession` on a
   *    revealed session, so a player's query can only match text they could already read.
   *  - GM: the same PLUS `prep_body` and the attendee names. Prep is the single most important secret this
   *    record carries and attendees are real-world personal data. Either in the player row would make a
   *    player's query on a GM-only phrase MATCH, and the hit's EXISTENCE is the leak even though the body
   *    is never returned - gates 2 and 3 would both pass it, because the session really is revealed and
   *    really did match.
   *
   * The title is the number, which is player-visible on a revealed session. Reveal itself is resolved at
   * READ time, so `setSessionRevealed` deliberately does not reindex - `setQuestRevealed`'s rule verbatim.
   */
  private indexSession(row: SessionRowRaw) {
    const title = row.session_number === null ? "" : `Session ${row.session_number}`;
    const tagText = parseTags(row.tags_json).join(" ");
    const attendeeText = parseTags(row.attendees_json).join(" ");
    this.indexRecord("session", row.id,
      { title, body: `${row.recap_body}\n${row.real_date ?? ""}\n${tagText}` },
      { title, body: `${row.prep_body}\n${row.recap_body}\n${row.real_date ?? ""}\n${attendeeText}\n${tagText}` });
  }

  /** A journal entry is two-layer like a page: `gmText` goes ONLY into the GM index. */
  private indexEntry(entryId: string, playerText: string, gmText: string | null, tagsJson: string) {
    const tagText = parseTags(tagsJson).join(" ");
    this.indexRecord("journal", entryId,
      { title: "", body: `${playerText}\n${tagText}` },
      { title: "", body: `${playerText}\n${gmText ?? ""}\n${tagText}` });
  }

  /**
   * Write one checkpoint of `row` into `codex_page_revisions`. `authored_at` is the SNAPSHOTTED ROW's
   * `updated_at`, never the moment the snapshot was taken - so the column means "when the checkpointed content
   * was last authored", which is the clock `revisionDue` compares against. See `revisionDue` for why that is
   * the right clock and not merely a convenient one.
   */
  private snapshotRevision(pageId: string, row: PageRow, authorTag: string) {
    this.requireDatabase().prepare("INSERT INTO codex_page_revisions (page_id, rev, title, entity_type, fields_json, gm_fields_json, player_body, gm_body, banner_asset_id, tags_json, authored_at, author_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(pageId, row.rev, row.title, row.entity_type, row.fields_json, row.gm_fields_json, row.player_body, row.gm_body, row.banner_asset_id, row.tags_json, row.updated_at, authorTag);
  }

  /**
   * Is this page due a new checkpoint? The owner's throttle (2026-07-30), in three lines and one comparison.
   *
   * "if a previous version exists and is less than 90 minutes old, it does not commit a versioned history,
   * this means that at most, 90 minutes of work could be lost."
   *
   * **Which clock "age" is measured against, and why it is `authored_at` rather than a new column.** Since
   * `updatePage` snapshots the PRIOR state, `authored_at` is when the checkpointed CONTENT was last authored -
   * not when the snapshot row was written. That is exactly the quantity the owner's sentence is about: if the
   * page is ruined now and the GM falls back to this checkpoint, what they lose is everything authored after
   * `authored_at`. Measuring instead from "when the snapshot was taken" would break the guarantee outright, and
   * the arithmetic is worth spelling out because it is not obvious: a checkpoint written at t=95 holds content
   * authored at t=80, so at t=180 a capture-time clock reads an age of 85 and skips - while the work actually
   * at risk runs from t=80, which is 100 minutes. The existing column is not just sufficient, it is the correct
   * one, so NO new column was added.
   *
   * `MAX(authored_at)` rather than "the newest row by `rev` or `id`": it says what it means, and it does not
   * depend on rev/id order tracking authoring order (which holds today, but only because every writer appends).
   * TEXT comparison is chronological here because every stamp is `new Date(...).toISOString()`, which is
   * fixed-width - and legacy rows carrying `''` sort below every real stamp, which is the harmless direction.
   *
   * The clock is `this.now()`, the injected one, never a bare `Date.now()` - that is what lets a test drive the
   * window deterministically instead of sleeping.
   *
   * Called from `updatePage` ONLY. `createPage` is never throttled by the WINDOW - a page with no history at
   * all is the one case with nothing to fall back to - but it does honour the `enabled` switch, because "off"
   * that still leaves a row per page is not off.
   */
  private revisionDue(pageId: string, force = false): boolean {
    // `revisionSettings`, NOT `getSettings`: this runs on every page save, and `getSettings` also computes the
    // usage aggregate over the whole revision table, which belongs to the settings screen and not to a save.
    const settings = this.revisionSettings();
    // `enabled: false` writes nothing NEW. It deletes nothing, and `listRevisions` / `restoreRevision` keep
    // working on what is already there - disabling a feature must not destroy the GM's only undo.
    if (!settings.enabled) return false;
    // `force` (the restore path) bypasses the WINDOW and never the SWITCH. Ordering matters here and it was
    // wrong first: forcing above this line let a restore write a checkpoint into a codex whose history the GM
    // had switched off, which is precisely the "off means off" the switch promises. The window is a policy
    // about frequency; the switch is a policy about whether to keep history at all, and only one of them has
    // an exception.
    if (force) return true;
    const newest = (this.requireDatabase().prepare("SELECT MAX(authored_at) AS newest FROM codex_page_revisions WHERE page_id = ?")
      .get(pageId) as { newest: string | null } | undefined)?.newest ?? null;
    if (newest === null) return true; // no checkpoint at all: there is no "previous version" to coalesce into
    const age = this.now() - Date.parse(newest);
    // Write UNLESS the newest checkpoint can be positively shown to be recent. A `windowMinutes` of 0 therefore
    // snapshots every save (no age is less than 0), which is the pre-2026-07-30 behaviour and is deliberately
    // NOT what `enabled: false` means. An unparseable stamp (NaN) or one in the future both fail this test and
    // snapshot, which is the safe direction: an extra revision costs a row, a missing one costs the GM's work.
    return !(age >= 0 && age < settings.windowMinutes * 60_000);
  }

  /**
   * Does a checkpoint for this page's CURRENT `rev` already exist? Three callers need it, for three reasons.
   *
   * It exists because `createPage` checkpoints the row it just made at rev 1, and the first `updatePage` then
   * checkpoints the state it is overwriting - still rev 1, byte-identical. Two identical entries in the GM's
   * history list, always present at `windowMinutes: 0` and whenever a page is stubbed and first edited after
   * the window has elapsed. Skipping it does NOT weaken "0 checkpoints every save": a duplicate of a state
   * already captured loses nothing, so the set of states the GM can return to is unchanged. What `0` promises
   * is that no state is lost, not that a row is written per save regardless of whether it says anything new.
   *
   * `(page_id, rev)` identifies a state exactly, because `rev` increments on every write that changes the page
   * - including a restore, which goes through `updatePage` like any other save.
   */
  private revisionExistsAt(pageId: string, rev: number): boolean {
    return (this.requireDatabase().prepare("SELECT 1 FROM codex_page_revisions WHERE page_id = ? AND rev = ? LIMIT 1")
      .get(pageId, rev) as { 1: number } | undefined) !== undefined;
  }

  private bumpRevision() {
    this.requireDatabase().prepare("UPDATE codex_meta SET codex_revision = codex_revision + 1 WHERE id = 1").run();
  }

  private transaction(work: () => void) {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try { work(); database.exec("COMMIT"); }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  }

  private migrate() {
    const database = this.requireDatabase();
    const applied = new Set((database.prepare("SELECT version FROM codex_schema_migrations").all() as Array<{ version: number }>).map(({ version }) => version));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        database.prepare("INSERT INTO codex_schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, this.stamp());
        database.exec("COMMIT");
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    }
  }

  private stamp(): string { return new Date(this.now()).toISOString(); }

  private freshId(): string { return randomUUID(); }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error("CodexStore has not been initialized.");
    return this.database;
  }
}

/** Turn a free-text query into a safe FTS5 prefix MATCH; returns null when nothing usable remains. */
function ftsQuery(raw: string): string | null {
  const terms = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!terms || terms.length === 0) return null;
  return terms.slice(0, 12).map((term) => `"${term}"*`).join(" ");
}
