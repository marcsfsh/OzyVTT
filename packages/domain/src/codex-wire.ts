// The Codex's HTTP shapes (`/api/v1/codex/*`): one definition that the server's projections are typed
// against, the client reads and the OpenAPI document is generated from. The GM shape of a record is the stored
// row; its player twin is a separate allow-list, so a field added to the GM side stays off the player wire until
// it is added here too. Every key is present on both sides (nullable where unused), so the document's
// role-projected `oneOf` matches exactly one branch. Each field's `.describe()` is its prose in the OpenAPI
// document.

import { z } from "zod";
import { CodexInWorldDateSchema } from "./codex-calendar.js";
import { CODEX_ENTITY_TYPES } from "./codex-entities.js";
import { CodexPrepLinkSchema, CodexPrepChecklistItemSchema, CodexPrepSectionSchema } from "./codex-prep-wire.js";
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
/** Who sees a hidden block or a quest objective: the GM only, everyone, or the chosen party characters. */
const CodexAudienceSchema = z.enum(["hidden", "everyone", "characters"]);
export type CodexAudience = z.infer<typeof CodexAudienceSchema>;
/** Who sees a page's field: a key in the page's `hiddenFields` is Hidden, any other is shown to everyone. */
export type CodexFieldAudience = "hidden" | "everyone";
/** A blank `text` is a legitimate transient state (a row just added), so blank rows are never stripped. */
export const CodexQuestObjectiveSchema = z
  .strictObject({
    id: z.uuid().describe("Stable across edits: send it back with the objective so it keeps its audience."),
    text: z
      .string()
      .max(120)
      .describe(
        "What the party has to do, in one line. Deliberately not `minLength: 1`: the checklist's real flow is add-a-row-then-type-into-it and the editor autosaves the whole draft, so a minimum would reject the first save after \"Add item\", and dropping the blank row server-side would renumber the list under the GM's cursor. A blank objective is a legitimate transient state."
      ),
    done: z.boolean(),
    audience: CodexAudienceSchema.describe(
      "Who sees it: `hidden` (the GM only), `everyone`, or `characters` (the party characters in `characterIds`)."
    ),
    /** Non-empty exactly when `audience` is `characters`. */
    characterIds: z
      .array(z.uuid())
      .max(12)
      .describe(
        "The party characters it is shown to, by actor id. Present exactly when `audience` is `characters`, and then at least one."
      )
  })
  .describe(
    "One tickable step of a quest, with its own audience. A player receives only the objectives shown to everyone or to a character they hold, so a count built from their list counts only those."
  );
export type CodexQuestObjective = Wire<z.infer<typeof CodexQuestObjectiveSchema>>;
/** Only the objectives the reader may see reach them, so this carries no audience. */
export const PlayerCodexQuestObjectiveSchema = z
  .strictObject({ text: z.string().max(120), done: z.boolean() })
  .describe("An objective as a player receives it: only one they may read, so it carries no audience.");
export type PlayerCodexQuestObjective = Wire<z.infer<typeof PlayerCodexQuestObjectiveSchema>>;
/** The kinds the suite-wide search indexes. */
const CodexRecordKindSchema = z.enum(["page", "journal", "map", "marker", "quest", "session"]);
export type CodexRecordKind = z.infer<typeof CodexRecordKindSchema>;
/** Every surface the reveal audit reports on. */
const CodexRevealAuditKindSchema = z.enum(["date", "page", "map", "marker", "journal", "session", "quest", "standing"]);
export type CodexRevealAuditKind = z.infer<typeof CodexRevealAuditKindSchema>;

const tags = () => z.array(z.string());
const timestamp = () => z.iso.datetime();

// ----- Reveal stamps and hidden blocks -----

/**
 * When something first reached an audience: the moment, the session active then, and the players' published date
 * then (never the GM's). Set by the write after which that audience could read it, and never moved after.
 */
export const CodexRevealStampSchema = z
  .strictObject({
    at: timestamp(),
    sessionId: z.uuid().nullable().describe("The session active at that moment, or null."),
    /** The session's number now, or the number it had when it was deleted. */
    sessionNumber: z
      .number()
      .int()
      .nullable()
      .describe("That session's number now, or the number it had when it was deleted."),
    inWorldDate: CodexInWorldDateSchema.nullable().describe(
      "The players' published date at that moment, never the GM's clock. Null when none was published."
    ),
    inWorldLabel: z.string().nullable().describe("Display form of the in-world date, derived from the calendar.")
  })
  .describe(
    "When something first reached an audience. Set once, by the write after which that audience could read it, and never moved after: a hide keeps it and a second reveal does not replace it."
  );
export type CodexRevealStamp = Wire<z.infer<typeof CodexRevealStampSchema>>;
/** A stamp as a player receives it: the session's number only while that session is revealed. */
export const PlayerCodexRevealStampSchema = z
  .strictObject({
    at: timestamp(),
    sessionNumber: z
      .number()
      .int()
      .nullable()
      .describe("Only while that session exists and is revealed; null otherwise."),
    inWorldDate: CodexInWorldDateSchema.nullable().describe("The players' published date at that moment."),
    inWorldLabel: z.string().nullable()
  })
  .describe("A stamp as a player receives it.");
export type PlayerCodexRevealStamp = Wire<z.infer<typeof PlayerCodexRevealStampSchema>>;

/** One audience a block reached: `everyone`, or a character id. */
export const CodexBlockRevealSchema = CodexRevealStampSchema.extend({
  to: z.union([z.literal("everyone"), z.uuid()]).describe("`everyone`, or the character id it reached.")
}).describe("One audience a block reached.");
export type CodexBlockReveal = Wire<z.infer<typeof CodexBlockRevealSchema>>;

/**
 * A hidden block: markdown placed in a page's or quest's text with its own audience. `anchor` is the number of
 * player-text paragraphs before it (`codexParagraphs`); blocks come in document order.
 */
export const CodexBlockSchema = z
  .strictObject({
    id: z.uuid(),
    anchor: z
      .number()
      .int()
      .min(0)
      .describe(
        "Where the block sits: the number of player-text paragraphs before it. Paragraphs split at blank lines (`codexParagraphs` in `@vtt/domain`). An anchor past the last paragraph reads as the end."
      ),
    title: z
      .string()
      .max(160)
      .nullable()
      .describe("Optional, one line. It reads as a level 2 heading over the text once the block is shown."),
    text: z.string().describe("The block's markdown."),
    audience: CodexAudienceSchema.describe(
      "Who sees it: `hidden` (the GM only), `everyone`, or `characters` (the party characters in `characterIds`)."
    ),
    /** Non-empty exactly when `audience` is `characters`. */
    characterIds: z
      .array(z.uuid())
      .max(12)
      .describe(
        "The party characters it is shown to, by actor id. Present exactly when `audience` is `characters`, and then at least one."
      ),
    /** One per audience the block has reached, oldest first. A hide keeps them. */
    reveals: z
      .array(CodexBlockRevealSchema)
      .describe("One stamp per audience the block has reached, oldest first. A hide keeps them.")
  })
  .describe(
    "A hidden block: markdown placed in a page's or quest's player text with its own audience. A player receives a block only when it is shown to everyone or to a character they hold, and only after its record is revealed."
  );
export type CodexBlock = Wire<z.infer<typeof CodexBlockSchema>>;
/** A block as a page revision keeps it: content and place, no audience. */
export const CodexBlockContentSchema = z
  .strictObject({
    id: z.uuid(),
    anchor: z
      .number()
      .int()
      .min(0)
      .describe(
        "Where the block sits: the number of player-text paragraphs before it. Paragraphs split at blank lines (`codexParagraphs` in `@vtt/domain`). An anchor past the last paragraph reads as the end."
      ),
    title: z.string().max(160).nullable(),
    text: z.string()
  })
  .describe(
    "A block as a revision keeps it: content and place, no audience, since a revision is content and a restore never shows players anything new."
  );
export type CodexBlockContentRow = Wire<z.infer<typeof CodexBlockContentSchema>>;
/**
 * A block a player may read, as it sits in their assembled `body`. No id, anchor or audience, and nothing about a
 * block they may not read.
 */
export const PlayerCodexBlockSchema = z
  .strictObject({
    title: z.string().nullable(),
    /** UTF-16 offsets of the block's markdown in `body`, `end` exclusive. */
    start: z.number().int().min(0).describe("Where the block's markdown starts in `body`, as a UTF-16 offset."),
    end: z.number().int().min(0).describe("Where it ends in `body`, exclusive."),
    /** Which of the reader's characters it is shown to; empty when it is shown to everyone. */
    characterIds: z
      .array(z.uuid())
      .describe("Which of the reader's characters it is shown to; empty when it is shown to everyone."),
    /** When it first reached the reader. */
    revealed: PlayerCodexRevealStampSchema.describe(
      "When it first reached the reader: the earliest stamp for everyone or for one of their characters."
    )
  })
  .describe(
    "A block the reader may read, as it sits in their assembled `body`. No id, anchor or audience, and nothing about a block they may not read."
  );
export type PlayerCodexBlock = Wire<z.infer<typeof PlayerCodexBlockSchema>>;

// ----- Pages -----

/** Derived from `inWorldDate`, the date the GM typed, against the live calendar. */
const dating = {
  inWorldLabel: z
    .string()
    .nullable()
    .describe(
      "The in-world date as text, derived from the calendar. The chronicle's by-date lens groups its rows under it."
    ),
  calendarInstant: z.number().nullable().describe("Sortable absolute day index derived from the calendar."),
  inWorldDate: CodexInWorldDateSchema.nullable().describe(
    "The raw in-world date the GM typed. The instant and the label are derived from it."
  )
};

export const CodexPageSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  entityType: CodexEntityTypeSchema,
  /** Every field value, whatever its audience. */
  fields: z
    .record(z.string(), z.string())
    .describe("Every field value, whatever its audience. `hiddenFields` says which only the GM sees."),
  /** The field keys only the GM sees. */
  hiddenFields: z
    .array(z.string())
    .describe("The field keys only the GM sees. A key absent here is shown to everyone who can read the page."),
  folder: z
    .string()
    .nullable()
    .describe(
      "GM-only. The folder path the page is filed under, null at the top level. It is the GM's own filing, so no player shape carries it."
    ),
  tags: tags(),
  revealedToPlayers: z.boolean(),
  bannerAssetId: z.uuid().nullable(),
  ...dating,
  rev: z.number().int().min(0),
  createdAt: timestamp(),
  /** Moves on every save. */
  updatedAt: timestamp().describe("GM-only. Moves on every save, including one that changes only the GM half."),
  /** Moves only when something everyone who can read the page sees changes. */
  playerUpdatedAt: timestamp().describe(
    "When something everyone who can read the page sees last changed: the title, kind, player text, fields shown to everyone, tags or banner, an event page's date, a block shown to everyone, or a reveal or hide. A player receives the later of this and `characterUpdatedAt` for each character they hold, the only edit time they get, since `updatedAt` also moves on GM-only saves."
  ),
  /** By character id: when something shown only to some characters last changed for that character. */
  characterUpdatedAt: z
    .record(z.uuid(), timestamp())
    .describe(
      "GM-only. For each character id, when something shown only to some characters last changed for that character."
    ),
  /** When players could first read the page; null until then. Never moves after, through a hide or a re-reveal. */
  firstShownAt: timestamp()
    .nullable()
    .describe(
      "When players could first read the record: set by the write that first lets them read it, and never moved after, so a hide and a re-reveal keep it. Null until then. A record players could read before this date existed takes its `createdAt`."
    )
});
export type CodexPageSummary = Wire<z.infer<typeof CodexPageSummarySchema>>;
export const CodexPageSchema = CodexPageSummarySchema.extend({
  /** The text everyone who can read the page reads, with no block in it. */
  playerBody: z.string().describe("The text everyone who can read the page reads, with no block in it."),
  blocks: z.array(CodexBlockSchema).describe("The page's hidden blocks, in document order.")
});
export type CodexPage = Wire<z.infer<typeof CodexPageSchema>>;

/**
 * Only when revealed. No blocks they may not read, no Hidden fields, reveal flag, date or `rev`. No `folder`, which
 * is the GM's private filing, and no `updatedAt`, which a GM-only save moves. `playerUpdatedAt` is the reader's own.
 */
export const PlayerCodexPageSummarySchema = z
  .strictObject({
    id: z.uuid(),
    title: z.string(),
    entityType: CodexEntityTypeSchema,
    tags: tags(),
    bannerAssetId: z.uuid().nullable(),
    playerUpdatedAt: timestamp().describe(
      "When something this reader can see last changed: the page's `playerUpdatedAt`, or a later change to a block shown only to one of their characters. A change only another character sees never moves it."
    )
  })
  .describe(
    "A page summary as a player receives it. A strict subset of the GM summary: no `fields`, no dating trio, no `rev`, no `revealedToPlayers`, no `createdAt`, no `folder` and no `updatedAt`."
  );
export type PlayerCodexPageSummary = Wire<z.infer<typeof PlayerCodexPageSummarySchema>>;
/** `body` is the player text with the blocks the reader may see in place. */
export const PlayerCodexPageSchema = PlayerCodexPageSummarySchema.extend({
  fields: z.record(z.string(), z.string()).describe("The fields shown to everyone."),
  body: z
    .string()
    .describe(
      "The page's player text with the reader's blocks inserted at their anchors. A `[[link]]` to a page the reader cannot open reads as plain text."
    ),
  firstShownAt: timestamp().describe(
    "When players could first read the record. It stands in for `createdAt`, which would tell them when the GM prepared it, and a hide and a re-reveal never move it."
  ),
  blocks: z
    .array(PlayerCodexBlockSchema)
    .describe("The blocks in `body`, in document order, with when each reached the reader.")
}).describe(
  "A page as a player receives it: the player text with the blocks this reader may read in place, the fields shown to everyone, and no Hidden field, block, `rev`, `revealedToPlayers`, `createdAt`, `folder` or `updatedAt`. Nothing marks where a block they may not read sits. An unrevealed page is never projected at all; it 404s."
);
export type PlayerCodexPage = Wire<z.infer<typeof PlayerCodexPageSchema>>;

/** GM-only: the state a save checkpointed. */
export const CodexPageRevisionSchema = z.strictObject({
  id: z.number().int().min(1),
  pageId: z.uuid(),
  rev: z.number().int().min(0),
  title: z.string(),
  playerBody: z.string(),
  blocks: z.array(CodexBlockContentSchema),
  bannerAssetId: z.uuid().nullable(),
  tags: tags(),
  authoredAt: timestamp(),
  authorTag: z.string()
});
export type CodexPageRevision = Wire<z.infer<typeof CodexPageRevisionSchema>>;

// ----- Connections: declared edges and `[[wiki link]]` mentions are one system -----

/** When a declared connection began in the world: a date, or before the campaign. */
export const CodexRelationshipBeganSchema = z
  .strictObject({
    /** Null when it began before the campaign. */
    inWorldDate: CodexInWorldDateSchema.nullable().describe(
      "The date it began; null when it began before the campaign."
    ),
    beforeCampaign: z.boolean().describe("It began before the campaign."),
    inWorldLabel: z.string().nullable().describe("Display form of the in-world date, derived from the calendar."),
    calendarInstant: z.number().nullable().describe("Sortable absolute day index derived from the calendar.")
  })
  .describe("When a declared connection began in the world.");
export type CodexRelationshipBegan = Wire<z.infer<typeof CodexRelationshipBeganSchema>>;

/** One graph edge. `id` is null exactly for a mention, which is edited through its source text. */
export const CodexConnectionSchema = z
  .strictObject({
    id: z
      .uuid()
      .nullable()
      .describe(
        "Null exactly when `origin` is `mention`: a derived edge has no row of its own, so it is deleted by editing the text that produced it."
      ),
    fromKind: CodexConnectionSourceKindSchema.describe(
      "Which record the connection comes from. Session, quest and journal bodies join the graph."
    ),
    fromId: z.uuid(),
    toPageId: z
      .uuid()
      .describe(
        "Connections v1 are edges into pages. `[[map:...]]`/`[[marker:...]]` targets still parse and persist but get no graph exposure."
      ),
    /** The out-label ("ally of"); null for an unlabelled connection. */
    label: z
      .string()
      .min(1)
      .max(40)
      .nullable()
      .describe('The out-label ("ally of", "located in"). Null for an unlabelled connection.'),
    origin: CodexConnectionOriginSchema,
    layer: CodexConnectionLayerSchema.describe(
      "Which layer the connection lives on. A `mention` takes the layer of the text it was written in: player text and blocks shown to everyone are the player layer, and any other block is the GM layer. A `declared` one is chosen at create (default `player`)."
    ),
    /** A GM-layer mention from a block shown to these characters; empty otherwise. */
    characterIds: z
      .array(z.uuid())
      .describe(
        "A GM-layer mention from a block shown to these characters: a reader holding one of them receives it. Empty otherwise."
      ),
    /** Declared connections only. */
    began: CodexRelationshipBeganSchema.nullable().describe(
      "When the tie began in the world. Declared connections only."
    ),
    /** When players could first read it. Declared connections only; null for one players read before stamps existed. */
    learned: CodexRevealStampSchema.nullable().describe(
      "When players could first read it: on the player layer, between two revealed pages. Declared connections only. Null until then, and for one players could read before stamps existed."
    ),
    createdAt: timestamp().nullable().describe("Null for a mention row.")
  })
  .describe(
    "One edge in the codex graph, GM view. One shape for both origins: a connection the GM declared and a connection derived from `[[wiki link]]` text differ only by an `origin` attribute, in one system with one panel and one edge kind."
  );
export type CodexConnection = Wire<z.infer<typeof CodexConnectionSchema>>;
/** Edges between records the reader can see, on the player layer or from a block shown to their characters. */
export const PlayerCodexConnectionSchema = z
  .strictObject({
    fromKind: CodexConnectionSourceKindSchema,
    fromId: z.uuid(),
    toPageId: z.uuid(),
    label: z.string().min(1).max(40).nullable(),
    origin: CodexConnectionOriginSchema,
    began: CodexRelationshipBeganSchema.nullable(),
    learned: PlayerCodexRevealStampSchema.nullable().describe("When the party learned it, as a player stamp.")
  })
  .describe(
    "A connection as a player receives it: one on the player layer, or a mention from a block shown to a character they hold. No `id` (a player never addresses one), no `layer`, no `characterIds` and no `createdAt`. The list comes in a fixed order of its own, never the order connections were made in."
  );
export type PlayerCodexConnection = Wire<z.infer<typeof PlayerCodexConnectionSchema>>;

/** One row of a page's Connections panel: the other end resolved, plus the edge's direction. */
export const CodexPageConnectionSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    direction: z.enum(["out", "in"]),
    otherKind: CodexConnectionSourceKindSchema,
    otherId: z.uuid(),
    /** A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry's player text. */
    otherTitle: z
      .string()
      .describe(
        'A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry\'s player text, the reveal-audit naming rule.'
      ),
    otherEntityType: CodexEntityTypeSchema.nullable().describe("Pages only; null for every other kind."),
    /** The other record's own reveal flag. */
    otherRevealed: z
      .boolean()
      .describe(
        "GM-only; not declared on `CodexPageConnectionPlayer` (a player only ever receives connections to records they can see)."
      ),
    label: z.string().nullable(),
    origin: CodexConnectionOriginSchema,
    layer: CodexConnectionLayerSchema,
    characterIds: z.array(z.uuid()).describe("As on `CodexConnection`."),
    /** The heading a mention sits under; null for a declared connection. */
    section: z.string().nullable().describe("The heading the mention sits under; null for a declared connection."),
    began: CodexRelationshipBeganSchema.nullable(),
    learned: CodexRevealStampSchema.nullable()
  })
  .describe(
    "One row of a page's Connections panel: the other endpoint resolved, plus which way the edge points. Folds in what used to be two separate views (backlinks and typed relationships)."
  );
export type CodexPageConnection = Wire<z.infer<typeof CodexPageConnectionSchema>>;
/** Gated like the graph feed; no `id`, `layer`, `characterIds` or `otherRevealed`. */
export const PlayerCodexPageConnectionSchema = z
  .strictObject({
    direction: z.enum(["out", "in"]),
    otherKind: CodexConnectionSourceKindSchema,
    otherId: z.uuid(),
    otherTitle: z.string(),
    otherEntityType: CodexEntityTypeSchema.nullable(),
    label: z.string().nullable(),
    origin: CodexConnectionOriginSchema,
    section: z.string().nullable(),
    began: CodexRelationshipBeganSchema.nullable(),
    learned: PlayerCodexRevealStampSchema.nullable()
  })
  .describe(
    "A page's Connections panel as a player receives it: revealed others only, so `otherRevealed` would be a constant, and no `id`, `layer` or `characterIds`."
  );
export type PlayerCodexPageConnection = Wire<z.infer<typeof PlayerCodexPageConnectionSchema>>;

// ----- The atlas: maps and their pins -----

export const CodexMapSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid(),
  name: z.string(),
  kind: CodexMapKindSchema,
  parentMapId: z
    .uuid()
    .nullable()
    .describe("Parent map in the atlas tree; for a player, nulled when the parent is not itself revealed."),
  revealedToPlayers: z.boolean(),
  sortKey: z.number(),
  tags: tags(),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  /** When players could first read the map; null until then. Orders the players' list. */
  firstShownAt: timestamp()
    .nullable()
    .describe(
      "When players could first read the record: set by the write that first lets them read it, and never moved after, so a hide and a re-reveal keep it. Null until then. A record players could read before this date existed takes its `createdAt`. It orders the players' list, which never carries it."
    )
});
export type CodexMap = Wire<z.infer<typeof CodexMapSchema>>;
/** Only when revealed. `parentMapId` is null unless the parent is revealed too. */
export const PlayerCodexMapSchema = z
  .strictObject({
    id: z.uuid(),
    assetId: z.uuid(),
    name: z.string(),
    kind: CodexMapKindSchema,
    parentMapId: z.uuid().nullable().describe("Nulled when the parent map is not itself revealed."),
    tags: tags()
  })
  .describe(
    "An atlas map as a player receives it. `parentMapId` survives only when the parent is itself revealed; otherwise a revealed child would leak the id of a still-secret ancestor."
  );
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
  isParty: z
    .boolean()
    .describe(
      "Whether this is the party's pin. At most one marker in the whole atlas carries it. Player-facing: the party pin is for the players, and it is the one such key on the player marker projection, but it grants no visibility of its own: a hidden party pin, or one on a hidden map, is exactly as hidden as any other pin, because `isParty` is not part of any reveal predicate anywhere."
    ),
  pageIds: z.array(z.uuid()).describe("Linked pages; for a player, filtered to the revealed subset."),
  subMapId: z.uuid().nullable().describe("Drill-down sub-map; nulled for a player when that map is not revealed."),
  /** Scenes staged from this pin: GM-only in every projection. */
  sceneIds: z.array(z.uuid()).describe("Linked prepared scenes; GM-only, stripped from a player projection."),
  actorId: z.uuid().nullable(),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  /** When players could first read the pin (it and its map revealed); null until then. Orders the players' lists. */
  firstShownAt: timestamp()
    .nullable()
    .describe(
      "When players could first read the record: set by the write that first lets them read it, and never moved after, so a hide and a re-reveal keep it. Null until then. A record players could read before this date existed takes its `createdAt`. A pin is read once it and its map are revealed. It orders the players' lists."
    )
});
export type CodexMarker = Wire<z.infer<typeof CodexMarkerSchema>>;
/** Only when the pin and its map are revealed. No scene or actor links; page and sub-map links only when revealed. */
export const PlayerCodexMarkerSchema = z
  .strictObject({
    id: z.uuid(),
    mapId: z.uuid(),
    x: z.number(),
    y: z.number(),
    iconId: z.string(),
    iconColor: hexColor(),
    label: z.string().nullable(),
    pageIds: z.array(z.uuid()).describe("Filtered to the revealed subset."),
    subMapId: z.uuid().nullable().describe("Nulled when that map is not revealed."),
    tags: tags(),
    isParty: z.boolean()
  })
  .describe(
    "A pin as a player receives it: no `sceneIds`, no `actorId`, no `revealedToPlayers`, no timestamps, and page/sub-map links only when those targets are themselves revealed. `isParty` is here (the party pin is for the players), but it grants no visibility: a hidden party pin, or one on a hidden map, is exactly as hidden as any other."
  );
export type PlayerCodexMarker = Wire<z.infer<typeof PlayerCodexMarkerSchema>>;

// ----- Journal payloads, one per kind that carries structured facts -----

/** `applied` (has the GM confirmed the clock move?) makes applying idempotent and is GM workflow state. */
export const CodexDowntimePayloadSchema = z
  .strictObject({
    who: z.string().describe("Who spent the time. Free text: a character, the whole party, an NPC."),
    activity: z.string().describe("What they did with it."),
    days: z
      .number()
      .int()
      .min(0)
      .describe("The time cost in in-world days: what the clock moves by when the GM confirms."),
    applied: z
      .boolean()
      .describe(
        "GM workflow state: whether the clock move has been confirmed. Never present in a player projection, because it is a fact about the GM's prep."
      ),
    /** Links the row to a character page; `who` is the fallback. No foreign key: deleting the page nulls it. */
    characterPageId: z
      .uuid()
      .nullable()
      .describe(
        "the character page this downtime belongs to, or null. Always present, including on records written before the field existed; the stored-payload reader supplies the null, so no consumer branches on key presence. A plain id with no foreign key: the record outlives the page, and deleting the page nulls this while `who` survives as the display fallback."
      )
  })
  .describe(
    "What a downtime record stores beyond its prose: who spent how many days doing what, and whether the GM has confirmed the clock move it proposes. The GM's shape. Deliberately not here: an `outcome`, which is prose, and this record already has two prose layers with the reveal split between them (`playerText`/`gmText`); a third prose channel inside a JSON blob would sit outside that split."
  );
export type CodexDowntimePayload = Wire<z.infer<typeof CodexDowntimePayloadSchema>>;
/** The level reached. `reason` has no reveal split, so GM-only detail belongs in `gmText`. Both
 *  audiences get the same shape. */
export const CodexMilestonePayloadSchema = z
  .strictObject({
    level: z
      .number()
      .int()
      .min(1)
      .max(20)
      .describe(
        "The level reached. A delta would make the party's current level a sum over the whole timeline that a single deleted record silently changes."
      ),
    reason: z
      .string()
      .max(120)
      .describe(
        'Why, in one line ("cleared the crypt"). May be empty; the record\'s own prose carries it when this does not.'
      )
  })
  .describe(
    "What a milestone record carries beyond its prose: the level the party reached, and why. Identical for both audiences: a party knows its own level, and a revealed milestone with its two facts removed would be a dated row that says nothing. There is no GM-only half here at all; a milestone needing one writes it in the record's `gmText`, like every other journal row. No XP: progression is milestone-based by design and this record carries no arithmetic."
  );
export type CodexMilestonePayload = Wire<z.infer<typeof CodexMilestonePayloadSchema>>;
/** `delta` is the change from the old value. No foreign key, so history survives a deleted faction. */
export const CodexStandingPayloadSchema = z
  .strictObject({
    factionPageId: z
      .uuid()
      .describe(
        "The faction page this record is about. A plain id with no foreign key behind it: deleting a faction page removes its standing row but must leave its history standing, so a reader resolves this defensively: a missing page is a name it cannot show, and raises no error."
      ),
    delta: z.number().int().describe('How far the standing moved, signed. `-15` reads "fell fifteen".'),
    reason: z.string().max(120).describe("Why, in one line. May be empty.")
  })
  .describe(
    "What a standing record carries: which faction, how much it moved, and why. The GM's shape. `delta` and not the resulting value, deliberately: the `codex_standing` table says where things stand and this says what happened, so a deleted record cannot leave a history that no longer adds up to the table."
  );
export type CodexStandingPayload = Wire<z.infer<typeof CodexStandingPayloadSchema>>;
/** A quest reached `status`, written on quest create and status change. No foreign key, so history survives the quest. */
export const CodexQuestEventPayloadSchema = z
  .strictObject({
    questId: z.uuid(),
    status: CodexQuestStatusSchema.describe(
      'The status reached: the fact a GM states and the one a reader wants. A `failed` -> `active` transition records `active`; a reader words it as "reopened".'
    )
  })
  .describe(
    "a quest changed state. The quest record says where a quest stands; this says what happened, exactly as a `standing` record does beside the standing table. Written automatically, in the same transaction as the quest write, when a quest is created (its initial status; a quest entering the log is an event, whether or not the party has begun it) and whenever a PATCH changes its status. Editing a quest's prose writes nothing. There is no cached title: readers resolve `questId` against the live quest, so a renamed quest reads correctly and a deleted one is a name they cannot show and raises no error; the history outlives the quest."
  );
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
export const PlayerCodexDowntimePayloadSchema = z
  .strictObject({
    who: z.string(),
    activity: z.string(),
    days: z.number().int().min(0),
    characterPageId: z
      .uuid()
      .nullable()
      .describe(
        "carried only when that character page is itself revealed, else null: the `factionPageId` rule on a standing payload verbatim. Unlike a standing record the row is not hidden when the link is nulled: a downtime row stands on its own player-visible content (`who`, `activity`, `days`, and usually prose), so a nulled link leaves a row that still means something."
      )
  })
  .describe("A revealed downtime record as a player sees it: the campaign facts, and `applied` allow-listed away.");
export type PlayerCodexDowntimePayload = Wire<z.infer<typeof PlayerCodexDowntimePayloadSchema>>;
export type PlayerCodexMilestonePayload = CodexMilestonePayload;
/** `factionPageId` is null unless the faction's page is revealed. */
export const PlayerCodexStandingPayloadSchema = z
  .strictObject({
    factionPageId: z.uuid().nullable().describe("The faction page, or null when that page is not revealed to players."),
    delta: z.number().int(),
    reason: z.string().max(120)
  })
  .describe(
    "A revealed standing record as a player sees it. `delta` and `reason` travel whole: the delta is the entire point of a record the GM chose to publish (\"the Harpers fell fifteen\"), and a published record with its number stripped would say that something changed with someone. `factionPageId` is the one field that is conditional: it is nulled unless that page is itself revealed, the same filter a quest's `entityIds` and a map's `parentMapId` pass, so a published record can never advertise a faction the party has never met. A record whose faction page is not revealed is not projected to a player at all; it is hidden whole, exactly as the standing table row is: a standing record carries no prose of its own (the store writes an empty player text), so a row with the id stripped would still tell the party that an unnamed faction moved and why."
  );
export type PlayerCodexStandingPayload = Wire<z.infer<typeof PlayerCodexStandingPayloadSchema>>;
/** `questId` is null unless the quest is revealed. */
export const PlayerCodexQuestEventPayloadSchema = z
  .strictObject({
    questId: z
      .uuid()
      .nullable()
      .describe(
        "Nulled unless that quest is revealed: a second line of defence behind the whole-row gate, the same arrangement a standing payload's `factionPageId` uses."
      ),
    status: CodexQuestStatusSchema.describe(
      "In lifecycle order. `not-started` and `active` are the open states (a quest the party can still do) and `completed`, `failed` and `canceled` are three different ways of being finished with one. `canceled` is not a synonym for `failed`: a lead the party never took up did not fail. A quest created without a status is `not-started`."
    )
  })
  .describe(
    'A quest-history record as a player sees it. The whole row is hidden unless the quest itself is revealed, because a quest record carries empty player text, so it cannot stand on its own prose, and a row reading "Quest · completed" for a quest the party has never heard of would announce both its existence and its ending. When it does travel, `status` is the record\'s only content and the reader can already read it on the quest itself.'
  );
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
  gmText: z.string().nullable().describe("GM-only note; stripped from a player projection."),
  revealedToPlayers: z.boolean(),
  attachMarkerId: z.uuid().nullable(),
  attachPageId: z.uuid().nullable(),
  kind: CodexJournalKindSchema.describe(
    "What the row is. `deadline`, `downtime`, `milestone` and `standing` are the structured kinds. Visibility never depends on this: every kind is gated by `revealedToPlayers` alone."
  ),
  sourceEncounterId: z.number().int().nullable(),
  /** The session this entry is filed under, or null. */
  sessionId: z
    .uuid()
    .nullable()
    .describe(
      "the session this entry belongs to, by identity. Null when it is filed under no session. This is what a write sets; `sessionNumber` beside it is what a reader displays."
    ),
  /** The session's live number, or the number a deleted revealed session left behind (with `sessionId` null). */
  sessionNumber: z
    .number()
    .int()
    .nullable()
    .describe(
      "The linked session's number, resolved live from that record, so renumbering a session updates every one of its entries with no journal write. Server-owned display data: a write body that carries it is a 400. It survives its session in exactly one case: deleting a revealed numbered session stamps its number back onto its entries as a bare label, because the players were already reading it."
    ),
  realDate: z.string().nullable(),
  /** `inWorldDate` is the literal date the GM entered, so instants can be recomputed when the calendar changes. */
  ...dating,
  sortKey: z.number(),
  tags: tags(),
  /** Kind-specific structured data; null for kinds without one. */
  payload: CodexJournalPayloadSchema.describe(
    'Kind-specific structured data, discriminated by `kind`: the downtime payload, the milestone payload, the standing payload, and null for the other three kinds. GM-only; the player journal projection carries no payload at all (a revealed record\'s facts are read on the chronicle). A deadline deliberately has none: its text is the "what" and its `inWorldDate` is the "when".'
  ),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  /** When players could first read the entry; null until then. Never moves after, through a hide or a re-reveal. */
  firstShownAt: timestamp()
    .nullable()
    .describe(
      "When players could first read the record: set by the write that first lets them read it, and never moved after, so a hide and a re-reveal keep it. Null until then. A record players could read before this date existed takes its `createdAt`."
    )
});
export type CodexJournalEntry = Wire<z.infer<typeof CodexJournalEntrySchema>>;
/**
 * Only when revealed. `sessionId` and `sessionNumber` are both null unless the session is revealed, since
 * either half says the session exists. No `createdAt`, which would tell players when the GM wrote the entry;
 * `firstShownAt` is when they could first read it.
 */
export const PlayerCodexJournalEntrySchema = z
  .strictObject({
    id: z.uuid(),
    text: z.string().describe("The entry's `playerText`."),
    kind: CodexJournalKindSchema.describe(
      "Visibility never depends on this: every kind is gated by `revealedToPlayers` alone."
    ),
    sessionId: z
      .uuid()
      .nullable()
      .describe(
        "The session this entry belongs to, so a player can navigate from an entry to its recap. Present only when that session is revealed, in which case the player can already list and open it, so this adds no information. Nulled together with `sessionNumber` when the session is hidden: either half of the link would announce that a session they have not been shown exists."
      ),
    sessionNumber: z
      .number()
      .int()
      .nullable()
      .describe(
        "Nulled together with `sessionId` when the linked session has not been revealed, because a session's very existence is GM information. A bare label with no link survives only where the number was already player-visible."
      ),
    realDate: z.string().nullable(),
    inWorldLabel: z.string().nullable(),
    tags: tags(),
    firstShownAt: timestamp().describe(
      "When players could first read the record. It stands in for `createdAt`, which would tell them when the GM prepared it, and a hide and a re-reveal never move it."
    )
  })
  .describe(
    "A journal entry as a player receives it: the mini-timeline row on a page or a pin. The player text (renamed `text`), and no `gmText`, `revealedToPlayers`, attachments, `sourceEncounterId`, `payload`, `sortKey`, dating internals, `createdAt` or `updatedAt`. A downtime's facts and a deadline's fired state are read on the chronicle, which carries them; a player-facing field the player Codex does not read is a field with no reason to travel."
  );
export type PlayerCodexJournalEntry = Wire<z.infer<typeof PlayerCodexJournalEntrySchema>>;

/**
 * One chronicle row: a journal entry, or a dated `event` page (`id` is then the page id and the texts are
 * bounded excerpts of its bodies). Every key is present on every kind.
 */
export const CodexChronicleRecordSchema = z
  .strictObject({
    kind: CodexChronicleKindSchema.describe(
      "What the row is, read by icon and word. Colour alone never carries it. A discriminator for display only: it never decides visibility, which is `revealedToPlayers` and nothing else."
    ),
    id: z.uuid().describe("The record's own id: a journal entry's for `entry`/`combat`, a page's for `event`."),
    title: z.string().nullable().describe("An event page's title; null for a journal entry, which has no name."),
    text: z
      .string()
      .describe(
        "The player-facing layer: a journal entry's full text, or a bounded excerpt of an event page's player body."
      ),
    gmText: z
      .string()
      .nullable()
      .describe(
        "GM-only: an entry's GM note, or an excerpt of an event page's hidden blocks. Not declared at all on `CodexChronicleRecordPlayer`."
      ),
    revealedToPlayers: z
      .boolean()
      .describe(
        "GM-only field; not declared on `CodexChronicleRecordPlayer` (a player only ever receives revealed records)."
      ),
    sessionId: z
      .uuid()
      .nullable()
      .describe("the session this row belongs to, by identity. Null for an `event` page and for an unfiled entry."),
    sessionNumber: z.number().int().nullable().describe("The linked session's number, resolved live from that record."),
    realDate: z.string().nullable(),
    ...dating,
    tags: tags(),
    attachPageId: z.uuid().nullable().describe("GM-only; not declared on `CodexChronicleRecordPlayer`."),
    attachMarkerId: z.uuid().nullable().describe("GM-only; not declared on `CodexChronicleRecordPlayer`."),
    sourceEncounterId: z
      .number()
      .int()
      .nullable()
      .describe("GM-only replay linkage. `CodexChronicleRecordPlayer` does not declare it."),
    /** Has the GM's clock reached this deadline's date? Derived server-side, so rewinding the clock un-fires it. */
    fired: z
      .boolean()
      .describe(
        "Whether the campaign clock has reached this deadline's own date. Derived on every read from `inWorldDate` against the clock, never stored, so rewinding the clock correctly un-fires a deadline. `false` for every kind that is not a dated deadline. Measured against whose clock is a viewer-safety decision: the GM's row uses the GM's clock, a player's row uses the published date, so this boolean can never tell the party that a date they have not been shown has already gone by."
      ),
    payload: CodexJournalPayloadSchema.describe(
      "The kind's structured facts, discriminated by `kind`; null for the kinds that carry none. Allow-listed per kind, never a spread of the stored blob: the GM receives the full downtime payload including `applied`, a milestone's `{ level, reason }`, and a standing change's `delta`/`reason`."
    ),
    /** Where confirming this downtime would move the clock. Null once applied and for other kinds. */
    proposedDate: CodexInWorldDateSchema.nullable().describe(
      "GM-only (not declared on `CodexChronicleRecordPlayer`): for an unapplied downtime, the date `apply-downtime` would move the clock to. Null once applied, and for every other kind. A clock move the GM has not confirmed (and may never confirm) is prep."
    ),
    createdAt: timestamp(),
    updatedAt: timestamp().describe("GM-only; not declared on `CodexChronicleRecordPlayer`.")
  })
  .describe(
    "One row on the one chronicle as the **GM** receives it, in the single row shape every timeline record uses. `kind` says what it is and therefore what opening it means: `entry`/`combat`/`deadline`/`downtime` carry a journal-entry id, `event` carries a page id. Every key is present on every kind (null where it does not apply), so no reader branches on key presence. The player's row is the separate `CodexChronicleRecordPlayer`; the two are joined by `CodexChronicleRecordProjected`."
  );
export type CodexChronicleRecord = Wire<z.infer<typeof CodexChronicleRecordSchema>>;
/**
 * No GM text, attachments, encounter id or proposed date. `fired` is measured against the published date. No
 * `createdAt`, which would tell players when the GM wrote the record; `firstShownAt` is when they could first read it.
 */
export const PlayerCodexChronicleRecordSchema = z
  .strictObject({
    kind: CodexChronicleKindSchema,
    id: z.uuid(),
    title: z.string().nullable(),
    text: z.string(),
    sessionId: z
      .uuid()
      .nullable()
      .describe("Present only when the linked session is revealed; nulled together with `sessionNumber` otherwise."),
    sessionNumber: z.number().int().nullable(),
    realDate: z.string().nullable(),
    inWorldLabel: z.string().nullable(),
    inWorldDate: CodexInWorldDateSchema.nullable().describe(
      "the row's raw in-world date, so a calendar view can place it on a day without re-parsing prose. Information-equivalent to `inWorldLabel` beside it, which already spells out weekday, day, month and year; the structured parts add no bits and remove a client parse. Not the campaign's \"now\": the GM's clock is `CodexCalendarPlayer.currentDate`, which is the published date."
    ),
    /** Use this for placement and sorting; never re-derive it client-side. */
    calendarInstant: z
      .number()
      .nullable()
      .describe(
        "the sortable day index for `inWorldDate` against the calendar the player already holds: a pure function of two things they have, computed once on the server. It is here so the client never re-derives it: the two derivations disagreed on a day that overflows its month, and one authority for one number is the fix. Null exactly when `inWorldDate` is."
      ),
    tags: tags(),
    fired: z.boolean().describe("Derived against the published date."),
    payload: PlayerCodexJournalPayloadSchema.describe(
      "The player half of the kind's structured facts: downtime without `applied`, a milestone's `{ level, reason }` unchanged, a standing change with `factionPageId` nulled unless that faction page is revealed."
    ),
    firstShownAt: timestamp().describe(
      "When players could first read the record. It stands in for `createdAt`, which would tell them when the GM prepared it, and a hide and a re-reveal never move it."
    )
  })
  .describe(
    "One chronicle row as a player receives it. Absent by construction: `gmText`, `revealedToPlayers`, `attachPageId`, `attachMarkerId`, `sourceEncounterId`, `proposedDate`, `createdAt` and `updatedAt`. `fired` is measured against the published date, never the GM's clock, so it can never tell the party that a date they have not been shown has gone by."
  );
export type PlayerCodexChronicleRecord = Wire<z.infer<typeof PlayerCodexChronicleRecordSchema>>;

// ----- Sessions: prep is the GM half, the recap the player half -----

export const CodexSessionSchema = z
  .strictObject({
    id: z.uuid(),
    sessionNumber: z
      .number()
      .int()
      .nullable()
      .describe(
        '"Session 12": the session\'s display number. Unique across sessions; null until the GM assigns one. Journal entries link to the session by ID and resolve this live, so renumbering a session relabels every one of its entries with no journal write.'
      ),
    /** The real-world date the group met, free text. */
    realDate: z
      .string()
      .nullable()
      .describe(
        "The real-world date the group played, as the GM typed it. Free text with no calendar instant; a session sits on the real calendar, never the world's, which is why sessions are their own route, apart from `/codex/timeline`."
      ),
    attendees: z.array(z.string()).describe("Who was at the table. GM-only; absent from a player projection."),
    /** The session's own copy of its template's sections; editing the template never changes it. */
    prep: z
      .array(CodexPrepSectionSchema)
      .describe(
        "GM-only: the session's prep sections, its own copy of a template's. Never present in a player projection, revealed or not; revealing a session publishes its recap, never its prep."
      ),
    /** The template the prep was last copied from. It may name a deleted template. */
    prepTemplateId: z
      .uuid()
      .nullable()
      .describe("GM-only: the template the prep was last copied from. It may name a deleted template."),
    /** The live board's current scene: a scene id inside one of the prep's Scenes sections. */
    currentSceneId: z
      .uuid()
      .nullable()
      .describe("GM-only: the live board's current scene, a scene id in one of the prep's Scenes sections."),
    recapBody: z
      .string()
      .describe("The player-facing recap (markdown). Reaches a revealed session's player projection as `recap`."),
    revealedToPlayers: z
      .boolean()
      .describe("GM-only field; absent from a player projection (a player only ever receives revealed sessions)."),
    status: CodexSessionStatusSchema.describe("GM-only; absent from a player projection."),
    tags: tags().describe(
      "the codex-wide tag vocabulary, so sessions filter and cross-link like every other record. Single-layer (there is no GM-only tag) and player-facing on a revealed session."
    ),
    /** Scenes staged for this session. A dangling id is expected. */
    sceneIds: z
      .array(z.uuid())
      .describe(
        "the prepared scenes staged for this session, so the GM can put any of them live in one tap at the table. GM-only, always: stricter than the session's own reveal, because a revealed session publishes its recap and tonight's planned fights are spoilers even then."
      ),
    rev: z
      .number()
      .int()
      .min(0)
      .describe(
        "GM-only optimistic-concurrency counter; absent from a player projection. Pass it back as `expectedRev` to reject a stale edit."
      ),
    createdAt: timestamp().describe("GM-only; absent from a player projection."),
    updatedAt: timestamp().describe(
      "GM-only; absent from a player projection. Moves on an edit, but not on a reveal or an activate, because neither is an edit."
    ),
    /** When players could first read the session; null until then. Orders the players' unnumbered sessions. */
    firstShownAt: timestamp()
      .nullable()
      .describe(
        "When players could first read the record: set by the write that first lets them read it, and never moved after, so a hide and a re-reveal keep it. Null until then. A record players could read before this date existed takes its `createdAt`. It orders the players' unnumbered sessions."
      )
  })
  .describe(
    "One play session: the GM's prep for an evening at the table, and the recap of it afterwards. Two layers in one record: `recapBody` is the player-facing half and the `prep` sections are the GM's. A player projection is deliberately narrow: a revealed session reduces to exactly `id`, `sessionNumber`, `realDate`, `recap` (the recap body, renamed the way a page's `playerBody` becomes `body` and a journal entry's `playerText` becomes `text`) and `tags`, with every `[[link]]` to a page the reader cannot open as plain text. Everything else here is GM-only. `sessionNumber` is the join to the journal: entries carry the same number, which is what the journal's by-session lens groups on, so it is unique across sessions, and a number already in use is refused, so no group silently turns ambiguous."
  );
export type CodexSession = Wire<z.infer<typeof CodexSessionSchema>>;
/**
 * Only when revealed. No prep (the GM's plan), attendees (real-world personal data), status, scenes or `rev`;
 * `recapBody` arrives as `recap`.
 */
export const PlayerCodexSessionSchema = z
  .strictObject({
    id: z.uuid(),
    sessionNumber: z.number().int().nullable(),
    realDate: z.string().nullable(),
    recap: z.string().describe("The session's `recapBody`."),
    tags: tags().describe(
      "tags are single-layer in this codex (there is no GM-only tag) and every other record kind already ships its tags to players. A revealed session's tags are its player-facing categorization, and they are already in the player search index by the same rule."
    )
  })
  .describe(
    "A session as a player receives it: the tightest projection in the Codex, and every omission is a decision. `prep` is the GM's plan for the evening and has no player form; `attendees` is real-world personal data; `status` is the GM's own scheduling state; `rev` is the editor's conflict token. `recapBody` arrives renamed `recap`, because with only one layer left the prefix means nothing."
  );
export type PlayerCodexSession = Wire<z.infer<typeof PlayerCodexSessionSchema>>;

// ----- Quests: the player body is what the party was told, hidden blocks where it is really going -----

export const CodexQuestSchema = z
  .strictObject({
    id: z.uuid(),
    title: z.string().describe("The quest's name: the line that appears on the dashboard's open-quests card."),
    status: CodexQuestStatusSchema.describe(
      "Player-facing (unlike a session's `status`). Queryable server-side: the dashboard counts the open ones: `not-started` and `active`."
    ),
    /** The text everyone who can read the quest reads, with no block in it. */
    playerBody: z.string().describe("The text everyone who can read the quest reads, with no block in it."),
    blocks: z
      .array(CodexBlockSchema)
      .describe(
        "The quest's hidden blocks, in document order. A block reaches a player only when it is shown to everyone or to a character they hold; one they may not read is also kept out of their search, because a hit on a hidden phrase leaks the phrase."
      ),
    /** Ordered: the GM's sequence is the meaning. */
    objectives: z
      .array(CodexQuestObjectiveSchema)
      .max(24)
      .describe("The ordered checklist, each objective with its own audience; the order is content."),
    /** Pages this quest concerns. */
    entityIds: z
      .array(z.uuid())
      .max(24)
      .describe(
        "Codex pages this quest involves (the NPC who gave it, the location it points at). Player-facing, but filtered to the revealed subset, the same rule a marker's `pageIds` follows, so a quest can never name a page the player cannot open."
      ),
    revealedToPlayers: z
      .boolean()
      .describe("GM-only field; absent from a player projection (a player only ever receives revealed quests)."),
    tags: tags().describe(
      "the codex-wide tag vocabulary, so quests filter and cross-link like every other record. Single-layer, and player-facing on a revealed quest."
    ),
    rev: z
      .number()
      .int()
      .min(0)
      .describe(
        "GM-only optimistic-concurrency counter; absent from a player projection. Pass it back as `expectedRev` to reject a stale edit."
      ),
    createdAt: timestamp().describe("GM-only; absent from a player projection."),
    updatedAt: timestamp().describe(
      "GM-only; absent from a player projection. Moves on an edit. A reveal or an audience change is not an edit and does not move it."
    ),
    /** When players could first read the quest; null until then. Orders the players' list. */
    firstShownAt: timestamp()
      .nullable()
      .describe(
        "When players could first read the record: set by the write that first lets them read it, and never moved after, so a hide and a re-reveal keep it. Null until then. A record players could read before this date existed takes its `createdAt`. It orders the players' list."
      )
  })
  .describe(
    "One quest: a thread the party is pulling on, and whether it is still open. `playerBody` is what the table may read and hidden blocks hold the GM's own half (who is really behind it, what happens if they fail), each with its own audience. A player projection of a revealed quest is exactly `id`, `title`, `status`, `body` (the player text with the reader's blocks in place), `blocks`, the objectives the reader may see, and `entityIds`; everything else here is GM-only. `status` is the one field that is player-facing here but GM-only on a session: \"what is still open\" is the whole point of the feature. Objectives are an ordered mutable list: the array is stored and returned exactly as given, never sorted or deduped."
  );
export type CodexQuest = Wire<z.infer<typeof CodexQuestSchema>>;
/**
 * Only when revealed. No hidden block or objective the reader may not see, and no `rev`; `entityIds` only for
 * revealed pages. `body` is the player text with the reader's blocks in place.
 */
export const PlayerCodexQuestSchema = z
  .strictObject({
    id: z.uuid(),
    title: z.string(),
    status: CodexQuestStatusSchema.describe(
      "In lifecycle order. `not-started` and `active` are the open states (a quest the party can still do) and `completed`, `failed` and `canceled` are three different ways of being finished with one. `canceled` is not a synonym for `failed`: a lead the party never took up did not fail. A quest created without a status is `not-started`."
    ),
    body: z.string().describe("The quest's player text with the reader's blocks inserted at their anchors."),
    blocks: z
      .array(PlayerCodexBlockSchema)
      .describe("The blocks in `body`, in document order, with when each reached the reader."),
    objectives: z
      .array(PlayerCodexQuestObjectiveSchema)
      .max(24)
      .describe("Only the objectives the reader may see, in order; a count of them counts only those."),
    entityIds: z.array(z.uuid()).max(24).describe("Filtered to the revealed subset."),
    tags: tags().describe(
      "the `CodexSessionPlayer.tags` rule verbatim: tags are single-layer, and the quest's own reveal flag remains the whole predicate."
    )
  })
  .describe(
    'A quest as a player receives it. `status` is kept: this is the one place a quest differs from a session, because "what is still open" is the entire point of the feature. Hidden blocks and objectives the reader may not see and `rev` never travel, and `entityIds` is filtered to the revealed subset so a quest can never name a page the player cannot open.'
  );
export type PlayerCodexQuest = Wire<z.infer<typeof PlayerCodexQuestSchema>>;

// ----- Faction standing -----

/** One row per faction page. `value` runs -100 (Hostile) to +100 (Allied); the history is `standing` journal rows. */
export const CodexStandingSchema = z
  .strictObject({
    id: z.uuid(),
    factionPageId: z
      .uuid()
      .describe(
        "The faction page. Unique across standings (one row per faction), which is why every standing route is addressed by this id."
      ),
    value: z
      .number()
      .int()
      .min(-100)
      .max(100)
      .describe(
        "Signed: -100 hostile, 0 neutral, +100 allied. Signed because a faction can be actively against the party, which an unsigned favour scale cannot say. The word a reader shows beside the bar is a presentation of this number and is deliberately not stored."
      ),
    revealedToPlayers: z
      .boolean()
      .describe("GM-only field; absent from a player projection (a player only ever receives revealed standings)."),
    createdAt: timestamp().describe("GM-only; absent from a player projection."),
    updatedAt: timestamp().describe(
      'GM-only; absent from a player projection. "When did this move" is a question the chronicle answers, with the reason attached.'
    ),
    /** When players could first read it (it and its faction page revealed); null until then. Orders the players' list. */
    firstShownAt: timestamp()
      .nullable()
      .describe(
        "When players could first read the record: set by the write that first lets them read it, and never moved after, so a hide and a re-reveal keep it. Null until then. A record players could read before this date existed takes its `createdAt`. A standing is read once it and its faction page are revealed. It orders the players' list."
      )
  })
  .describe(
    "Where the party stands with one faction, GM view. Four facts, and what is absent is the point: no history (every change writes a `kind='standing'` chronicle record, so the timeline is the one history in this codex), no `rev` (a standing is a number set in one action; there is no draft to go stale), and no cached faction title (the live page is the one name, so a rename cannot leave a stale copy behind). A player projection of a revealed standing is exactly `factionPageId` and `value`, and only when the faction page is revealed too."
  );
export type CodexStanding = Wire<z.infer<typeof CodexStandingSchema>>;
/** Only when both the standing and its faction page are revealed. The faction page id identifies it. */
export const PlayerCodexStandingSchema = z
  .strictObject({
    factionPageId: z.uuid(),
    value: z
      .number()
      .int()
      .min(-100)
      .max(100)
      .describe(
        "Signed -100..100. It travels unchanged: a revealed standing whose number the player cannot see would say nothing."
      )
  })
  .describe(
    'A standing as a player receives it: two keys. The row\'s own `id` is noise (a player never addresses a standing, and `factionPageId` is unique), and "when did this last move" is a question the chronicle answers with the reason attached. A standing reaches a player only when the standing and its faction page are both revealed.'
  );
export type PlayerCodexStanding = Wire<z.infer<typeof PlayerCodexStandingSchema>>;

// ----- The calendar: the GM's prep clock and the players' published clock -----

export const CodexCalendarMonthSchema = z.strictObject({ name: z.string(), days: z.number().int().min(1).max(400) });
export const CodexCalendarEraSchema = z
  .strictObject({
    name: z.string().max(40),
    startYear: z.number().int().min(-100_000).max(100_000)
  })
  .describe(
    "A named era, running from `startYear` until the next era begins (`5f`). A date's era is derived (the last era whose `startYear` the date's year has reached) and is never stored on the date, so adding one re-labels existing records without rewriting any of them. Sorted ascending by `startYear` on the way in."
  );
/** The calendar's structure is public, so both audiences share it. */
const calendarStructure = {
  yearName: z.string(),
  eras: z
    .array(CodexCalendarEraSchema)
    .max(20)
    .describe(
      "The world's named eras, ascending by `startYear`. Empty on every calendar written before eras existed, which is exactly today's rendering: `yearName` stays the trailing suffix. Where an era applies it leads the year instead (\"Third Age 1492\")."
    ),
  months: z.array(CodexCalendarMonthSchema).min(1).max(24),
  weekdays: z.array(z.string()).max(20)
};
/** `currentDate` is the GM's clock; `publishedDate` is what players currently see as theirs. */
export const GmCodexCalendarSchema = z
  .strictObject({
    ...calendarStructure,
    currentDate: CodexInWorldDateSchema.nullable().describe(
      "The GM's own clock: where the campaign is now. Null until a date is set. Never reaches a player by any path."
    ),
    publishedDate: CodexInWorldDateSchema.nullable().describe(
      "What the party currently sees as 'now'. Equal to `currentDate` until the GM runs ahead while prepping, and moved only by `POST /codex/calendar/publish`. Not declared on `CodexCalendarPlayer`, where `currentDate` already is this value."
    )
  })
  .describe(
    "The world's calendar as the **GM** receives it. The campaign has two clocks: the GM's, which they run ahead while prepping, and the published one the party sees. The player's calendar is the separate `CodexCalendarPlayer`, where `currentDate` is sourced from the published date and `publishedDate` is not declared at all; the two are joined by `CodexCalendarProjected`."
  );
export type GmCodexCalendar = Wire<z.infer<typeof GmCodexCalendarSchema>>;
/** `currentDate` is the published date. */
export const PlayerCodexCalendarSchema = z
  .strictObject({
    ...calendarStructure,
    currentDate: CodexInWorldDateSchema.nullable().describe("The published date. Null until the GM publishes one.")
  })
  .describe(
    'The world calendar as a player receives it. `currentDate` keeps its name and its meaning ("where the campaign is now, as far as this reader is concerned") and only its source changes: it is read from the published date, and the GM\'s clock is not reachable from this payload at all. `publishedDate` is deliberately not echoed; for a player `currentDate` already is it, so a second key could only duplicate it or lie.'
  );
export type PlayerCodexCalendar = Wire<z.infer<typeof PlayerCodexCalendarSchema>>;

// ----- Suite-wide search -----

/** What the search's type filter, the home's collections and a hit's `type` name: a page's entity type, else its
 *  record kind. In this order, which is also the `type` sort's. */
export const CODEX_SEARCH_TYPES = [...CODEX_ENTITY_TYPES, "journal", "map", "marker", "quest", "session"] as const;
const CodexSearchTypeSchema = z.enum(CODEX_SEARCH_TYPES);
export type CodexSearchType = z.infer<typeof CodexSearchTypeSchema>;
/** The search's `visibility` filter, the GM's only. */
export const CODEX_SEARCH_VISIBILITIES = ["all", "revealed", "hidden"] as const;
export type CodexSearchVisibility = (typeof CODEX_SEARCH_VISIBILITIES)[number];
/** The sort keys that are not column keys. Any other key names a column. */
export const CODEX_SEARCH_SORT_KEYS = ["relevance", "name", "type", "modified", "visibility"] as const;

/** A hit's table columns by key: a page's field values, a quest's status, and so on. A key with no value is absent. */
const columns = () => z.record(z.string(), z.string());
const hitBase = {
  kind: CodexRecordKindSchema.describe("Which record matched; decides where the client navigates."),
  id: z.uuid(),
  title: z
    .string()
    .describe(
      "Page title, map name, marker label, or quest title; for a journal entry, a bounded one-line excerpt of its text; for a session, `Session {n}`, else a recap excerpt, else `Untitled session`. Never an empty string."
    ),
  tags: tags().describe("Always present, so no consumer branches on key presence."),
  /** Pages only. */
  entityType: CodexEntityTypeSchema.nullable().describe("The page's entity type; null for every other kind."),
  /** Markers only, so a pin hit can open its map. */
  mapId: z
    .uuid()
    .nullable()
    .describe(
      "The map a marker sits on; null for every other kind. Never names an unrevealed map, because a player only ever receives a marker hit when that map is revealed."
    ),
  type: CodexSearchTypeSchema.describe(
    "A page's entity type, else the record kind: what the `types` filter and the `type` sort read."
  )
};

/**
 * The GM's hit. `match.hidden` says the line is text not every player reads: a block or objective not shown to
 * everyone, a Hidden field, an entry's GM note, prep, attendees.
 */
export const CodexSearchHitSchema = z
  .strictObject({
    ...hitBase,
    /** Whether players can read the record, by its kind's player read (a pin needs its map too). */
    revealedToPlayers: z
      .boolean()
      .describe(
        "Whether players can read the record, by its kind's player read: a pin also needs its map. What the `visibility` filter reads."
      ),
    modifiedAt: timestamp().describe("When the GM last saved the record."),
    columns: columns().describe(
      "The values the record's kind shows as table columns, by column key: a page's fields (hidden ones included), a quest's `status`, a session's `number`, `date` and `status`, an entry's `kind` and `date`, a pin's `map`, a map's `kind` and `parent`. A column with no value is absent."
    ),
    match: z
      .strictObject({ line: z.string(), hidden: z.boolean() })
      .nullable()
      .describe(
        "The line that matched, cut to about 160 characters; null without `q` or when only the title or tags matched. `hidden` is true when the line is text not every player reads: a block not shown to everyone, a Hidden field, an objective not shown to everyone, a journal entry's GM note, prep or attendees."
      )
  })
  .describe(
    "One row of the single suite-wide result list. Uniform across record types: every key is present on every kind, null where it does not apply, so a consumer never branches on key presence. Deliberately narrow: enough to render a row and open the record, and nothing more. A player's hit list is gated by exactly the reveal predicate that kind's list endpoint applies (a marker additionally requires its map to be revealed), and a journal `title` is excerpted from the player text alone."
  );
export type CodexSearchHit = Wire<z.infer<typeof CodexSearchHitSchema>>;
/**
 * A player's hit, built from what that player reads, so its line quotes only text that reaches them. `modifiedAt` is
 * a page's `playerUpdatedAt` as this player reads it, else the record's `firstShownAt`.
 */
export const PlayerCodexSearchHitSchema = z
  .strictObject({
    ...hitBase,
    modifiedAt: timestamp()
      .nullable()
      .describe(
        "A page's `playerUpdatedAt` as this player reads it, else the record's `firstShownAt`. Never when the GM saved the record."
      ),
    columns: columns().describe(
      "As the GM's, from the player's own read: a page's fields are the ones the player can read."
    ),
    match: z
      .strictObject({ line: z.string() })
      .nullable()
      .describe(
        "The line of the player's own text that matched; null without `q` or when only the title or tags matched."
      )
  })
  .describe(
    "One search hit as a player receives it, built from what that player reads: the blocks, fields and objectives that reach their characters, with every `[[link]]` to a page they cannot open as plain text. No `revealedToPlayers`, and its line never comes from text that does not reach them."
  );
export type PlayerCodexSearchHit = Wire<z.infer<typeof PlayerCodexSearchHitSchema>>;
/** The Codex is unpaginated; `truncated` means the list was cut at the limit, and `total` counts every match. */
export const CodexSearchResultSchema = z.strictObject({
  hits: z.array(CodexSearchHitSchema),
  truncated: z.boolean(),
  total: z.number().int().min(0)
});
export type CodexSearchResult = Wire<z.infer<typeof CodexSearchResultSchema>>;
export const PlayerCodexSearchResultSchema = z.strictObject({
  hits: z.array(PlayerCodexSearchHitSchema),
  truncated: z.boolean(),
  total: z.number().int().min(0)
});
export type PlayerCodexSearchResult = Wire<z.infer<typeof PlayerCodexSearchResultSchema>>;

// ----- The live board and the recap's sources (GM-only) -----

/** A checklist item as the board shows it, with what its link names. */
export const CodexLiveClueSchema = CodexPrepChecklistItemSchema.extend({
  /** The linked page's or quest's title; null without a link or when the record is gone. */
  linkTitle: z.string().nullable(),
  /** The linked block's title, when the item links a block. */
  blockTitle: z.string().nullable(),
  /**
   * A record link: whether players can read the record. A block link: whether anyone but the GM can read it (its
   * record revealed and its audience not Hidden). Null when the link names nothing that still exists.
   */
  linkRevealed: z.boolean().nullable()
});
export type CodexLiveClue = Wire<z.infer<typeof CodexLiveClueSchema>>;

export const CodexLiveBoardSchema = z
  .strictObject({
    sessionId: z.uuid(),
    sessionNumber: z.number().int().nullable(),
    /** The session's `rev`, so an open editor can stay current. */
    rev: z.number().int().min(0).describe("The session's `rev`, so an open editor can stay current."),
    currentSceneId: z.uuid().nullable(),
    scenes: z.array(
      z.strictObject({
        sectionId: z.uuid(),
        id: z.uuid(),
        title: z.string(),
        placePageId: z.uuid().nullable(),
        placeTitle: z.string().nullable(),
        notes: z.string(),
        current: z.boolean()
      })
    ),
    pageGroups: z
      .array(
        z.strictObject({
          sectionId: z.uuid(),
          title: z.string(),
          pages: z.array(
            z.strictObject({
              id: z.uuid(),
              title: z.string(),
              entityType: CodexEntityTypeSchema,
              revealedToPlayers: z.boolean()
            })
          )
        })
      )
      .describe("One group per Linked pages section. A page that no longer exists is left out."),
    checklists: z.array(
      z.strictObject({ sectionId: z.uuid(), title: z.string(), items: z.array(CodexLiveClueSchema) })
    ),
    clocks: z
      .array(
        z.strictObject({
          id: z.uuid(),
          text: z.string(),
          inWorldLabel: z.string().nullable(),
          calendarInstant: z.number().nullable(),
          fired: z.boolean(),
          revealedToPlayers: z.boolean()
        })
      )
      .describe("The deadlines of every Clocks section, deduped. `fired` is measured against the GM's date."),
    quests: z.array(
      z.strictObject({
        id: z.uuid(),
        title: z.string(),
        status: CodexQuestStatusSchema,
        revealedToPlayers: z.boolean()
      })
    ),
    encounterSceneIds: z.array(z.uuid()),
    logged: z
      .array(
        z.strictObject({
          id: z.uuid(),
          kind: CodexJournalKindSchema,
          text: z.string(),
          revealedToPlayers: z.boolean(),
          createdAt: timestamp()
        })
      )
      .describe("The 50 latest journal entries filed under the session, oldest first.")
  })
  .describe("The active session's live board, read from its prep. GM-only.");
export type CodexLiveBoard = Wire<z.infer<typeof CodexLiveBoardSchema>>;

/** What happened in a session, for the recap step. `reveals` are blocks revealed while it was active. */
export const CodexSessionHappenedSchema = z.strictObject({
  sessionId: z.uuid(),
  entries: z.array(CodexJournalEntrySchema),
  cluesTicked: z.array(CodexLiveClueSchema.extend({ sectionId: z.uuid(), sectionTitle: z.string() })),
  reveals: z.array(
    z.strictObject({
      recordKind: CodexPrepLinkSchema.shape.recordKind,
      recordId: z.uuid(),
      recordTitle: z.string(),
      blockId: z.uuid(),
      blockTitle: z.string().nullable(),
      /** Who it reached: everyone, or one character by actor id. */
      to: z.union([z.literal("everyone"), z.uuid()]),
      /** When it reached them, and the players' date then. */
      at: timestamp(),
      inWorldLabel: z.string().nullable()
    })
  )
});
export type CodexSessionHappened = Wire<z.infer<typeof CodexSessionHappenedSchema>>;

// ----- Home -----

/** One revealed record that points at something players can't read. */
export const CodexRevealCheckRowSchema = z.strictObject({
  reason: z.enum(["link", "placeholder", "hidden-pin"]),
  kind: CodexRecordKindSchema,
  id: z.uuid(),
  title: z.string(),
  /** The pin's map, when `kind` is marker. */
  mapId: z.uuid().nullable(),
  targetKind: z.enum(["page", "map", "marker"]).nullable(),
  targetId: z.uuid().nullable(),
  targetTitle: z.string().nullable(),
  fieldKey: z.string().nullable()
});
export type CodexRevealCheckRow = Wire<z.infer<typeof CodexRevealCheckRowSchema>>;

/** Who sees a change: players can read it, only the GM can, or chosen characters can. */
const CodexChangeAudienceSchema = z.enum(["everyone", "hidden", "characters"]);
export type CodexChangeAudience = z.infer<typeof CodexChangeAudienceSchema>;
/** What a change was. Only a page tells a reveal or a hide apart from an edit. */
const CodexChangeKindSchema = z.enum(["created", "edited", "revealed", "hidden"]);
export type CodexChangeKind = z.infer<typeof CodexChangeKindSchema>;

/** The GM's home. */
export const CodexHomeSchema = z
  .strictObject({
    collections: z
      .array(
        z.strictObject({
          type: CodexSearchTypeSchema,
          revealed: z.number().int().min(0),
          hidden: z.number().int().min(0)
        })
      )
      .describe(
        "Every search type in a fixed order, zeros included. `revealed` counts what players can read by each kind's player read; `hidden` is the rest. The same split as the search's `visibility` filter."
      ),
    recent: z
      .array(
        z.strictObject({
          kind: CodexRecordKindSchema,
          id: z.uuid(),
          title: z.string(),
          type: CodexSearchTypeSchema,
          mapId: z.uuid().nullable(),
          changedAt: timestamp(),
          change: CodexChangeKindSchema,
          audience: CodexChangeAudienceSchema,
          characterIds: z.array(z.uuid())
        })
      )
      .describe(
        "The 12 latest changed records, newest first. `change` says what it was; only a page tells a reveal or a hide from an edit. `audience` is who sees the change: `everyone` when players can read the record and, for a page, the change moved what they all read; `characters` when, on a revealed page, it moved only what some characters read (a block or field shown to them), named in `characterIds`; `hidden` otherwise."
      ),
    revealCheck: z
      .strictObject({ rows: z.array(CodexRevealCheckRowSchema), total: z.number().int().min(0) })
      .describe(
        "Revealed records that point at something players can't read: a link to a hidden page or map, a field players read that holds a placeholder, a hidden pin on a revealed map. Players get plain text there, so each is safe. At most 100 rows; `total` counts them all."
      )
  })
  .describe("The GM's front page aggregates.");
export type CodexHome = Wire<z.infer<typeof CodexHomeSchema>>;

/** A player's home: what they can read that is new or changed since their last visit. */
export const PlayerCodexHomeSchema = z
  .strictObject({
    newSince: z
      .array(
        z.strictObject({
          kind: CodexRecordKindSchema,
          id: z.uuid(),
          title: z.string(),
          type: CodexSearchTypeSchema,
          mapId: z.uuid().nullable(),
          at: timestamp(),
          change: z.enum(["new", "updated"])
        })
      )
      .describe(
        "Newest first, at most 50: pages by their `playerUpdatedAt` as this player reads it, every other record by its `firstShownAt`. `change` is `new` when the record was first shown after `since`, else `updated`. Built from this player's own reads, so it lists, names and dates only what reaches them."
      ),
    truncated: z.boolean()
  })
  .describe("A player's front page: what they can read that is new or changed since `since`.");
export type PlayerCodexHome = Wire<z.infer<typeof PlayerCodexHomeSchema>>;

// ----- Settings (GM-only) -----

/** `enabled: false` stops new revisions but deletes none; `windowMinutes: 0` keeps every save. */
const CodexRevisionHistorySettingsSchema = z.strictObject({
  enabled: z.boolean().describe("Whether a page save may write a new revision at all."),
  windowMinutes: z
    .number()
    .int()
    .min(0)
    .max(10_080)
    .describe("Coalescing window in minutes; `0` keeps every save. See `CodexRevisionHistoryInput.windowMinutes`.")
});
export type CodexRevisionHistorySettings = Wire<z.infer<typeof CodexRevisionHistorySettingsSchema>>;
/** What kept history costs; `versionBytes` is an approximate character count; disk usage differs. */
const CodexRevisionHistoryUsageSchema = z.strictObject({
  versionCount: z
    .number()
    .int()
    .min(0)
    .describe(
      "How many revision rows exist, across the whole codex: the same set `DELETE /codex/page-revisions` operates on. Read-only: it is a fact about the table, so it is never accepted on a write."
    ),
  versionBytes: z
    .number()
    .int()
    .min(0)
    .describe(
      "Roughly how much text that history holds: the summed length of the content columns a revision duplicates from its page (both bodies, both field maps, the title and the tags). Deliberately approximate and deliberately not disk usage or the export's serialized size; it exists to be compared against itself before and after a trim, and a figure precise enough to invite comparison against the sqlite file's size would be a figure that disagrees with it. Render it as \"about 8.0 MB of text\". Read-only, like `versionCount`."
    )
});
export type CodexRevisionHistoryUsage = Wire<z.infer<typeof CodexRevisionHistoryUsageSchema>>;
export const CodexRevisionHistorySchema = CodexRevisionHistorySettingsSchema.extend(
  CodexRevisionHistoryUsageSchema.shape
).describe(
  "How much page version history the codex keeps, and what keeping it costs. The two knobs are exactly `CodexRevisionHistoryInput`'s; the two usage figures are server-computed and read-only, and they ride along here in one object because a settings screen wants the cost beside the control that changes it."
);
/** A preference stored server-side so it follows the GM across devices. */
export const CodexAutosaveSettingsSchema = z
  .strictObject({
    enabled: z
      .boolean()
      .describe(
        "Default `true`. `false` does not slow autosave down, it stops it: the editors then require an explicit Save and warn about unsaved changes."
      ),
    intervalSeconds: z
      .number()
      .min(1)
      .max(600)
      .describe(
        'How long the editors wait after you stop typing before saving. Seconds, and the unit is the same everywhere (wire, column, and store), so nothing converts at a boundary. Default `1`, which is what the shipping editors already did (an 800 ms debounce) expressed on this scale, so an upgraded codex saves exactly as often as it used to. `0` is not in range: a zero-second autosave is a save per keystroke, which is not a cadence anyone means; a GM who wants none says `enabled: false`. The 600 ceiling is ten minutes, past which the setting stops meaning "save while I work".'
      )
  })
  .describe(
    "Whether the Codex's editors save your work as you type, and how often. The server stores a preference and nothing else; there is no server-side draft, so the behaviour (and the explicit Save plus unsaved-changes warning when it is off) is the editor's. Storing it here is what makes the setting follow the GM from a phone to a laptop."
  );
export type CodexAutosaveSettings = Wire<z.infer<typeof CodexAutosaveSettingsSchema>>;
export const CodexSettingsSchema = z
  .strictObject({
    revisionHistory: CodexRevisionHistorySchema,
    autosave: CodexAutosaveSettingsSchema
  })
  .describe(
    "Every codex-wide setting as a reader sees it, nested by area, including the read-only usage figures. The nesting by area is what gives a later codex-wide setting a home without inventing fields for it today: `codex_meta` is the codex's singleton settings row, and this is that row as a caller sees it."
  );
export type CodexSettings = Wire<z.infer<typeof CodexSettingsSchema>>;
/** The writable half, sent whole: usage figures are server facts. */
export type CodexSettingsInput = Readonly<{
  revisionHistory: CodexRevisionHistorySettings;
  autosave: CodexAutosaveSettings;
}>;

// ----- Calendar check (GM-only): what a calendar change would move in front of players -----

/** A revealed dated record a proposed calendar would move: its date resolves to another day, or a deadline players
 *  saw pass would read as approaching again. */
export const CodexCalendarMoveSchema = z
  .strictObject({
    kind: z.enum(["page", "journal"]).describe("A dated page, or a journal entry."),
    id: z.uuid().describe("The record's id."),
    /** The page's title, or the start of the journal entry's player text, else its kind. */
    title: z.string().describe("The page's title, or the start of the journal entry's player text, else its kind."),
    /** The date as players read it now, and as they would. */
    before: z.string().describe("The date as players read it under the current calendar."),
    after: z.string().describe("The date as they would read it under the proposed one."),
    unpasses: z.boolean().describe("A deadline players have seen pass that would read as approaching again.")
  })
  .describe("A record the party can see that the proposed calendar would move.");
export type CodexCalendarMove = Wire<z.infer<typeof CodexCalendarMoveSchema>>;

// ----- The reveal audit (GM-only): what the player projections currently emit -----

/** `id` is what the kind's reveal route takes, which for `standing` is the faction page id. The `date` row's
 *  routes are the calendar's publish and unpublish, which take none. */
export const CodexRevealAuditRowSchema = z
  .strictObject({
    kind: CodexRevealAuditKindSchema.describe(
      "Which reveal surface this row belongs to, and therefore which existing reveal route un-reveals it. The `date` row is the published campaign date, hidden by `POST /codex/calendar/unpublish` and shown by `POST /codex/calendar/publish`."
    ),
    id: z
      .union([z.uuid(), z.literal("published-date")])
      .describe(
        "The record's own id, which is exactly the id that kind's existing reveal route takes. For a `standing` row this is the faction page id, because `POST /codex/standing/{factionPageId}/reveal` is addressed that way. The `date` row's is the fixed `published-date`, since the calendar routes take none."
      ),
    title: z
      .string()
      .describe(
        "One line naming the record, taken from the record's own player projection: the published date as the calendar writes it, a page title, a map name, a marker label, a bounded excerpt of a journal entry's player text, \"Session 4\", a quest title, a faction name. Empty string when the record has no name (an unlabelled pin)."
      ),
    /** Set on `journal` rows only, since `title` is the record's prose and cannot identify its kind. */
    journalKind: CodexJournalKindSchema.nullable().describe(
      'Which kind of journal record this is: the same seven-value vocabulary `CodexJournalEntry.kind` uses. Set on every `kind: "journal"` row and `null` on all seven other kinds, present either way so no consumer branches on key presence. Render it as a badge beside `title`, never by parsing `title`: the title is the record\'s own prose whenever it has any, and only names the kind when the record is silent.'
    )
  })
  .describe("One record the party can currently see.");
export type CodexRevealAuditRow = Wire<z.infer<typeof CodexRevealAuditRowSchema>>;
/** Always present: `revealed: 0` and no rows when the party can see none of it. */
export const CodexRevealAuditSectionSchema = z
  .strictObject({
    kind: CodexRevealAuditKindSchema,
    revealed: z
      .number()
      .int()
      .min(0)
      .describe(
        "How many records of this kind the party can currently see, which is not always the same as how many carry a reveal flag. A marker flagged revealed on a hidden map is not counted, because the player-facing marker read does not return it either."
      ),
    /** How many exist at all. */
    total: z.number().int().min(0).describe('How many exist at all, so "3 of 40" reads as deliberate.'),
    rows: z.array(CodexRevealAuditRowSchema)
  })
  .describe(
    'One reveal surface\'s report. Always present, empty ones included with `revealed: 0` and `rows: []`, because "nothing is revealed here" and "this did not load" must not look the same.'
  );
export type CodexRevealAuditSection = Wire<z.infer<typeof CodexRevealAuditSectionSchema>>;
export const CodexRevealAuditSchema = z
  .strictObject({
    sections: z
      .array(CodexRevealAuditSectionSchema)
      .describe("All eight surfaces, in a fixed order, always all present."),
    revealed: z.number().int().min(0).describe("Total records the party can see, across every surface."),
    total: z.number().int().min(0).describe("Total records that exist, across every surface.")
  })
  .describe(
    "Everything the party can currently see across every reveal surface in the Codex. A read-only aggregation of the existing player projections; it restates no visibility rule and writes nothing, which is why it agrees with the player-facing endpoints exactly."
  );
export type CodexRevealAudit = Wire<z.infer<typeof CodexRevealAuditSchema>>;

// ----- Table scenes the Codex names (GM-only) -----

/** One table scene and the Codex records that name it: sessions (staged for the session or in its prep's Encounters)
 *  and pins on the atlas. Scene ids are GM-only everywhere, so this read is too. */
export const CodexSceneLinkSchema = z.strictObject({
  sceneId: z.uuid(),
  sessions: z.array(
    z.strictObject({
      id: z.uuid(),
      sessionNumber: z.number().int().nullable(),
      status: CodexSessionStatusSchema,
      /** Staged for the session itself, or picked in one of its prep's Encounters sections. */
      via: z.enum(["session", "prep"])
    })
  ),
  pins: z.array(z.strictObject({ id: z.uuid(), label: z.string().nullable(), mapId: z.uuid(), mapName: z.string() }))
});
export type CodexSceneLink = Wire<z.infer<typeof CodexSceneLinkSchema>>;
export const CodexSceneLinksSchema = z.strictObject({ links: z.array(CodexSceneLinkSchema) });
export type CodexSceneLinks = Wire<z.infer<typeof CodexSceneLinksSchema>>;

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
export const CodexImportCountsSchema = z
  .strictObject({
    pages: count(),
    folders: count(),
    maps: count(),
    markers: count(),
    journal: count(),
    /** Declared connections only; mentions are rebuilt from body text. */
    connections: count().describe(
      "Declared connections. Mention edges are derived from body text and are rebuilt by the restore, so counting them would double-count the rebuild's own output."
    ),
    sessions: count(),
    quests: count(),
    standing: count(),
    revisions: count()
  })
  .describe(
    "What the database actually holds after the restore: its own row counts, which can differ from what the bundle claimed."
  );
export type CodexImportCounts = Wire<z.infer<typeof CodexImportCountsSchema>>;
