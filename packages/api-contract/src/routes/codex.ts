import { z } from "zod";
import * as wire from "@vtt/domain";
import { CODEX_ASSET_PATHS, CODEX_PATHS } from "../index.js";
import * as codex from "../schemas/codex.js";
import { named } from "./components.js";
import { binary, defineRoute, GM_SESSION, gmGrade, json, noBody, ok, refused, type ApiResponse } from "./define.js";

/**
 * The worldbuilding Codex (`codex-http.ts`). A GM session or a `codex:read` credential reads every record at GM grade;
 * a player session reads the projection built for the characters it holds, where a hidden record is a 404, the same
 * as one that does not exist. Every write is the GM's, and a JSON-body write takes an optional `commandId`.
 */

const READ = { gm: true, player: true, scope: "codex:read" } as const;
const GM_READ = gmGrade("codex:read");
const WRITE = gmGrade("codex:write");

const NOT_MODIFIED = noBody("Not modified: the weak ETag sent in `If-None-Match` is still current.");
const stale = (what: string) =>
  refused(`\`expectedRev\` is stale. \`error.currentRevision\` carries the ${what}'s current revision.`);
/** A read's answers: every Codex GET sends a weak ETag and answers a matching `If-None-Match` with a 304. */
const read = (answer: ApiResponse, more: Readonly<Record<number, ApiResponse>> = {}) => ({
  200: answer,
  304: NOT_MODIFIED,
  401: refused(),
  403: refused(),
  ...more
});
const write = (status: 200 | 201, answer: ApiResponse, more: Readonly<Record<number, ApiResponse>> = {}) => ({
  [status]: answer,
  400: refused(),
  401: refused(),
  403: refused(),
  ...more
});

const byId = (what: string) => z.object({ id: z.uuid().describe(`The ${what}'s id.`) });
const blockOf = (what: string) =>
  z.object({ id: z.uuid().describe(`The ${what}'s id.`), blockId: z.uuid().describe("The block's id.") });

/** Role-projected: `Codex<X>` for a GM-grade caller, `Codex<X>Player` for a player session. */
function projected(base: string, gm: z.ZodType, player: z.ZodType) {
  return named(
    `${base}Projected`,
    z
      .xor([gm, player])
      .describe(
        `A GM session or a \`codex:read\` credential receives \`${base}\`, and a player session \`${base}Player\`, the parts that reach its characters. A body matches exactly one of the two.`
      )
  );
}
const PageSummaryProjected = projected(
  "CodexPageSummary",
  wire.CodexPageSummarySchema,
  wire.PlayerCodexPageSummarySchema
);
const PageProjected = projected("CodexPage", wire.CodexPageSchema, wire.PlayerCodexPageSchema);
const PageConnectionProjected = projected(
  "CodexPageConnection",
  wire.CodexPageConnectionSchema,
  wire.PlayerCodexPageConnectionSchema
);
const ConnectionProjected = projected("CodexConnection", wire.CodexConnectionSchema, wire.PlayerCodexConnectionSchema);
const MapProjected = projected("CodexMap", wire.CodexMapSchema, wire.PlayerCodexMapSchema);
const MarkerProjected = projected("CodexMarker", wire.CodexMarkerSchema, wire.PlayerCodexMarkerSchema);
const JournalEntryProjected = projected(
  "CodexJournalEntry",
  wire.CodexJournalEntrySchema,
  wire.PlayerCodexJournalEntrySchema
);
const ChronicleRecordProjected = projected(
  "CodexChronicleRecord",
  wire.CodexChronicleRecordSchema,
  wire.PlayerCodexChronicleRecordSchema
);
const SessionProjected = projected("CodexSession", wire.CodexSessionSchema, wire.PlayerCodexSessionSchema);
const QuestProjected = projected("CodexQuest", wire.CodexQuestSchema, wire.PlayerCodexQuestSchema);
const StandingProjected = projected("CodexStanding", wire.CodexStandingSchema, wire.PlayerCodexStandingSchema);
const CalendarProjected = projected("CodexCalendar", wire.GmCodexCalendarSchema, wire.PlayerCodexCalendarSchema);
const SearchHitProjected = projected("CodexSearchHit", wire.CodexSearchHitSchema, wire.PlayerCodexSearchHitSchema);
const HomeProjected = projected("CodexHome", wire.CodexHomeSchema, wire.PlayerCodexHomeSchema);

const data = (name: string, shape: z.ZodRawShape) => named(name, z.strictObject(shape));
const Deleted = data("CodexDeletedData", { deleted: z.literal(true) });
const PageList = data("CodexPageListData", { pages: z.array(PageSummaryProjected) });
const Search = data("CodexSearchData", {
  hits: z.array(SearchHitProjected),
  truncated: z.boolean().describe("The list was cut at `limit`. A player's list is counted after every player gate."),
  total: z.number().int().min(0).describe("Every match before the cut.")
});
const Home = data("CodexHomeData", { home: HomeProjected });
const PageDocument = data("CodexPageDocumentData", {
  page: PageProjected,
  connections: z.array(PageConnectionProjected)
});
const Page = data("CodexPageData", { page: wire.CodexPageSchema });
const PageBlockCreated = data("CodexPageBlockCreatedData", {
  page: wire.CodexPageSchema,
  block: wire.CodexBlockSchema
});
const FolderList = data("CodexFolderListData", { folders: z.array(z.string()) });
const FolderCreated = data("CodexFolderCreatedData", { path: z.string() });
const FolderMoved = data("CodexFolderMovedData", {
  moved: z.number().int().min(0).describe("How many pages moved.")
});
const PreviewSession = data("CodexPreviewSessionData", { token: z.string() });
const RevisionList = data("CodexRevisionListData", { revisions: z.array(wire.CodexPageRevisionSchema) });
const Connection = data("CodexConnectionData", { connection: wire.CodexConnectionSchema });
const ConnectionList = data("CodexConnectionListData", { connections: z.array(ConnectionProjected) });
const MapList = data("CodexMapListData", { maps: z.array(MapProjected) });
const Map_ = data("CodexMapData", { map: wire.CodexMapSchema });
const MarkerList = data("CodexMarkerListData", { markers: z.array(MarkerProjected) });
const Marker = data("CodexMarkerData", { marker: wire.CodexMarkerSchema });
const MarkerProjectedData = data("CodexMarkerProjectedData", { marker: MarkerProjected });
const PartyLocation = named(
  "CodexPartyLocation",
  z
    .strictObject({ marker: MarkerProjected, mapName: z.string() })
    .describe(
      "The party pin and the name of the map it is on. `marker.mapId` is the map to jump to, and `mapName` labels the card with no second read."
    )
);
const PartyLocationData = data("CodexPartyLocationData", {
  party: PartyLocation.nullable().describe(
    "Null when no pin carries the party flag, and for a player when the party pin is not visible to them."
  )
});
const PartyPlaced = data("CodexPartyPlacedData", {
  marker: wire.CodexMarkerSchema,
  created: z.boolean().describe("True when no party pin existed, so one was made.")
});
const JournalList = data("CodexJournalListData", { entries: z.array(JournalEntryProjected) });
const ChronicleList = data("CodexChronicleListData", { records: z.array(ChronicleRecordProjected) });
const JournalEntry = data("CodexJournalEntryData", { entry: wire.CodexJournalEntrySchema });
const DowntimeCreated = data("CodexDowntimeCreatedData", {
  entry: wire.CodexJournalEntrySchema,
  proposedDate: wire.CodexInWorldDateSchema.nullable().describe(
    "Where the GM's clock would land if the GM applies the downtime. Null when there is no current date to count from. Nothing has moved yet."
  )
});
const DowntimeApplied = named(
  "CodexDowntimeAppliedData",
  z
    .strictObject({ entry: wire.CodexJournalEntrySchema, calendar: wire.GmCodexCalendarSchema })
    .describe(
      "The applied downtime and the moved calendar. They changed in one transaction and come back together, so a reader never holds one without the other. The calendar is the GM's; the players' published date has not moved."
    )
);
const SessionList = data("CodexSessionListData", {
  sessions: z.array(SessionProjected),
  activeSessionId: z
    .uuid()
    .nullable()
    .describe(
      "The session new journal entries are filed under. GM-only: always null for a player, since the active session is often the hidden one being prepared."
    )
});
const Session = data("CodexSessionData", { session: wire.CodexSessionSchema });
const SessionProjectedData = data("CodexSessionProjectedData", { session: SessionProjected });
const SessionActive = data("CodexSessionActiveData", { activeSessionId: z.uuid().nullable() });
const SessionHappened = data("CodexSessionHappenedData", { happened: wire.CodexSessionHappenedSchema });
const SessionTick = data("CodexSessionTickData", { session: wire.CodexSessionSchema, clue: wire.CodexLiveClueSchema });
const LiveBoard = data("CodexLiveBoardData", {
  board: wire.CodexLiveBoardSchema.nullable().describe("Null when no session is active.")
});
const PrepTemplate = data("CodexPrepTemplateData", { template: wire.CodexPrepTemplateSchema });
const PrepTemplateDefault = data("CodexPrepTemplateDefaultData", { defaultTemplateId: z.uuid() });
const QuestList = data("CodexQuestListData", { quests: z.array(QuestProjected) });
const Quest = data("CodexQuestData", { quest: wire.CodexQuestSchema });
const QuestBlockCreated = data("CodexQuestBlockCreatedData", {
  quest: wire.CodexQuestSchema,
  block: wire.CodexBlockSchema
});
const QuestProjectedData = data("CodexQuestProjectedData", { quest: QuestProjected });
const StandingList = data("CodexStandingListData", { standing: z.array(StandingProjected) });
const Standing = data("CodexStandingData", { standing: wire.CodexStandingSchema });
const RevealAudit = data("CodexRevealAuditData", { audit: wire.CodexRevealAuditSchema });
const SceneLinks = data("CodexSceneLinksData", { links: z.array(wire.CodexSceneLinkSchema) });
const Calendar = data("CodexCalendarData", { calendar: wire.GmCodexCalendarSchema });
const CalendarProjectedData = data("CodexCalendarProjectedData", { calendar: CalendarProjected });
const CalendarCheck = data("CodexCalendarCheckData", { moves: z.array(wire.CodexCalendarMoveSchema) });
const Settings = data("CodexSettingsData", { settings: wire.CodexSettingsSchema });
const RevisionsDeleted = data("CodexRevisionsDeletedData", {
  deleted: z
    .number()
    .int()
    .min(0)
    .describe("How many revisions were removed: the database's own count, which can be fewer than asked for.")
});
const Export = data("CodexExportData", {
  codex: z
    .record(z.string(), z.unknown())
    .describe("The backup bundle. Post this whole `data` object back to `POST /codex/import` to restore it."),
  exportedAt: z.iso.datetime(),
  bundleVersion: z
    .literal(codex.CODEX_BUNDLE_VERSION)
    .describe(
      "The bundle format's version: a fact about the file, so it sits beside `codex`. `POST /codex/import` restores this version and version 1, and refuses a newer one."
    )
});
const Imported = data("CodexImportedData", { replaced: z.literal(true), counts: wire.CodexImportCountsSchema });
const AssetUpload = data("CodexAssetUploadData", { asset: wire.CodexAssetSchema });

// ----- Pages -----

export const listCodexPages = defineRoute({
  method: "get",
  path: CODEX_PATHS.pages,
  operationId: "listCodexPages",
  tag: "Codex",
  summary: "List the pages",
  description:
    "Every page's summary; a player sees the revealed pages. Folders are the GM's own filing, so a player's `folder` filter is ignored.",
  access: READ,
  query: codex.CodexPageListQuerySchema,
  responses: read(ok(PageList, "The pages."), { 400: refused("A filter is repeated.") })
});

export const createCodexPage = defineRoute({
  method: "post",
  path: CODEX_PATHS.pages,
  operationId: "createCodexPage",
  tag: "Codex",
  summary: "Create a page",
  access: WRITE,
  body: json(codex.PageCreateSchema, {
    example: { title: "The Gilded Wyvern", entityType: "location", playerBody: "A busy inn by the north gate." }
  }),
  responses: write(201, ok(Page, "The new page."))
});

export const searchCodex = defineRoute({
  method: "get",
  path: CODEX_PATHS.search,
  operationId: "searchCodex",
  tag: "Codex",
  summary: "Search the Codex",
  description:
    "Searches every kind of record, filtered, and sorted by up to 4 columns. A GM's hit says whether players can read the record and whether its matching line is GM-only text. A player's search reads only what reaches that player's characters: a hit never matches, quotes or ranks on text that does not reach them. It has no visibility filter, and its modified date is the page's `playerUpdatedAt` as that player reads it, else the record's `firstShownAt`.",
  access: READ,
  query: codex.CodexSearchQuerySchema,
  responses: read(ok(Search, "The hits."), { 400: refused("A parameter is malformed; the message names it.") })
});

export const getCodexHome = defineRoute({
  method: "get",
  path: CODEX_PATHS.home,
  operationId: "getCodexHome",
  tag: "Codex",
  summary: "Read the Codex's front page",
  description:
    "A GM gets the revealed and hidden count of every search type, the latest changes with who sees each, and the reveal check: revealed records that point at something players cannot read. A player gets what they can read that is new or changed after `since`, from pages' `playerUpdatedAt` and the first-shown dates.",
  access: READ,
  query: codex.CodexHomeQuerySchema,
  responses: read(ok(Home, "The front page."), { 400: refused("`since` is not an ISO date and time.") })
});

export const getCodexPage = defineRoute({
  method: "get",
  path: CODEX_PATHS.pageById,
  operationId: "getCodexPage",
  tag: "Codex",
  summary: "Read a page",
  description: "One page with its connections, projected for the caller.",
  access: READ,
  params: byId("page"),
  responses: read(ok(PageDocument, "The page and its connections."), { 404: refused() })
});

export const updateCodexPage = defineRoute({
  method: "patch",
  path: CODEX_PATHS.pageById,
  operationId: "updateCodexPage",
  tag: "Codex",
  summary: "Edit a page",
  description: "Changes the fields sent and leaves the rest. A stale `expectedRev` is refused with 409.",
  access: WRITE,
  params: byId("page"),
  body: json(codex.PageUpdateSchema),
  responses: write(200, ok(Page, "The page."), { 404: refused(), 409: stale("page") })
});

export const deleteCodexPage = defineRoute({
  method: "delete",
  path: CODEX_PATHS.pageById,
  operationId: "deleteCodexPage",
  tag: "Codex",
  summary: "Delete a page",
  description: "Deleting a page that is already gone answers the same.",
  access: WRITE,
  params: byId("page"),
  responses: { 200: ok(Deleted, "The page is gone."), 401: refused(), 403: refused() }
});

export const revealCodexPage = defineRoute({
  method: "post",
  path: CODEX_PATHS.pageReveal,
  operationId: "revealCodexPage",
  tag: "Codex",
  summary: "Show or hide a page",
  access: WRITE,
  params: byId("page"),
  body: json(codex.RevealSchema, { example: { revealed: true } }),
  responses: write(200, ok(Page, "The page."), { 404: refused() })
});

export const addCodexPageBlock = defineRoute({
  method: "post",
  path: CODEX_PATHS.pageBlocks,
  operationId: "addCodexPageBlock",
  tag: "Codex",
  summary: "Add a hidden block to a page",
  description:
    "Adds a block at an anchor in the page's text. It starts Hidden: no player receives it until its audience route shows it. An edit, so `rev` and `updatedAt` move.",
  access: WRITE,
  params: byId("page"),
  body: json(codex.BlockAddSchema),
  responses: write(201, ok(PageBlockCreated, "The page and the new block."), { 404: refused(), 409: stale("page") })
});

export const editCodexPageBlock = defineRoute({
  method: "patch",
  path: CODEX_PATHS.pageBlockById,
  operationId: "editCodexPageBlock",
  tag: "Codex",
  summary: "Edit a hidden block",
  description: "Changes a block's title or text. Its audience stays. An edit.",
  access: WRITE,
  params: blockOf("page"),
  body: json(codex.BlockEditSchema),
  responses: write(200, ok(Page, "The page."), { 404: refused(), 409: stale("page") })
});

export const deleteCodexPageBlock = defineRoute({
  method: "delete",
  path: CODEX_PATHS.pageBlockById,
  operationId: "deleteCodexPageBlock",
  tag: "Codex",
  summary: "Delete a hidden block",
  description:
    "Deletes a block and answers the page. A block that is already gone answers the page as it is; 404 only when the page is gone.",
  access: WRITE,
  params: blockOf("page"),
  responses: { 200: ok(Page, "The page."), 401: refused(), 403: refused(), 404: refused() }
});

export const moveCodexPageBlock = defineRoute({
  method: "post",
  path: CODEX_PATHS.pageBlockMove,
  operationId: "moveCodexPageBlock",
  tag: "Codex",
  summary: "Move a hidden block",
  description: "Moves a block to another anchor, or another slot at its anchor. An edit.",
  access: WRITE,
  params: blockOf("page"),
  body: json(codex.BlockMoveSchema),
  responses: write(200, ok(Page, "The page."), { 404: refused(), 409: stale("page") })
});

export const setCodexPageBlockAudience = defineRoute({
  method: "put",
  path: CODEX_PATHS.pageBlockAudience,
  operationId: "setCodexPageBlockAudience",
  tag: "Codex",
  summary: "Set who sees a hidden block",
  description:
    "Sets a block's audience: Hidden, everyone, or chosen party characters. It is not an edit, so neither `rev` nor `updatedAt` moves. Once the page is revealed, the write stamps each audience the block reaches for the first time with the moment, the active session and the players' date. A player receives the block only when it is shown to everyone or to a character they hold, and a `[[link]]` in it reaches them only then.",
  access: WRITE,
  params: blockOf("page"),
  body: json(codex.AudienceSetSchema, { example: { audience: "everyone" } }),
  responses: write(200, ok(Page, "The page."), { 404: refused() })
});

export const setCodexPageFieldAudience = defineRoute({
  method: "put",
  path: CODEX_PATHS.pageFieldAudience,
  operationId: "setCodexPageFieldAudience",
  tag: "Codex",
  summary: "Set who sees a page's field",
  description:
    "Sets one field's audience: everyone or Hidden. It is not an edit. The key must be a field of the page's kind, else 400. A field with no value yet keeps its audience for when it gets one.",
  access: WRITE,
  params: z.object({
    id: z.uuid().describe("The page's id."),
    key: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .describe("The field's key.")
  }),
  body: json(codex.FieldAudienceSchema, { example: { audience: "hidden" } }),
  responses: write(200, ok(Page, "The page."), { 404: refused() })
});

export const createCodexConnection = defineRoute({
  method: "post",
  path: CODEX_PATHS.pageConnections,
  operationId: "createCodexConnection",
  tag: "Codex",
  summary: "Connect a page to another",
  description:
    "Declares a connection from this page to another. It counts as an edit of both pages for recently updated, but neither page's `rev` moves, so an open editor meets no conflict. Declaring the same `(from, to, label)` again returns the existing connection, and so does the reverse pair for a two-way label (ally of, enemy of, rival of, related to).",
  access: WRITE,
  params: byId("page"),
  body: json(codex.ConnectionCreateSchema),
  responses: write(201, ok(Connection, "The connection."), { 404: refused() })
});

export const listCodexPageMarkers = defineRoute({
  method: "get",
  path: CODEX_PATHS.pageMarkers,
  operationId: "listCodexPageMarkers",
  tag: "Codex",
  summary: "List the map pins that link a page",
  description:
    "Every atlas pin that links this page, so an open page can point back at the map: the reverse of `GET /codex/maps/{id}/markers`, gated the same way. A player must be able to read the page, else 404, and then receives the revealed pins on revealed maps, each with its links cut to what the player can read.",
  access: READ,
  params: byId("page"),
  responses: read(ok(MarkerList, "The pins."), { 404: refused() })
});

export const listCodexPageRevisions = defineRoute({
  method: "get",
  path: CODEX_PATHS.pageRevisions,
  operationId: "listCodexPageRevisions",
  tag: "Codex",
  summary: "List a page's saved versions",
  access: GM_READ,
  params: byId("page"),
  responses: read(ok(RevisionList, "The page's saved versions."), { 404: refused() })
});

export const restoreCodexPageRevision = defineRoute({
  method: "post",
  path: CODEX_PATHS.pageRevisionRestore,
  operationId: "restoreCodexPageRevision",
  tag: "Codex",
  summary: "Restore a page's saved version",
  access: WRITE,
  params: z.object({
    id: z.uuid().describe("The page's id."),
    revisionId: z.coerce.number().int().min(1).describe("The saved version's id.")
  }),
  responses: {
    200: ok(Page, "The restored page."),
    400: refused("The revision id is malformed."),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const createCodexPreviewSession = defineRoute({
  method: "post",
  path: CODEX_PATHS.previewSession,
  operationId: "createCodexPreviewSession",
  tag: "Codex",
  summary: "Start a preview as players",
  description:
    "Mints a short-lived player session token, so the GM previews the player Codex as everyone or as one party character. It is a real player principal, and the GM's own session carries no flag: every read then walks the authorization and projection a player's does, so a preview as Lyra reads what Lyra's player reads. The token only reads. Game commands and token uploads refuse it with 403, and it holds no character. A credential cannot mint one.",
  access: GM_SESSION,
  body: json(codex.PreviewSessionSchema, { required: false }),
  responses: {
    201: ok(PreviewSession, "The preview session's token."),
    400: refused("The character is not in the party."),
    401: refused(),
    403: refused()
  }
});

// ----- Folders -----

export const listCodexFolders = defineRoute({
  method: "get",
  path: CODEX_PATHS.folders,
  operationId: "listCodexFolders",
  tag: "Codex",
  summary: "List the folders",
  description: "Every folder made on its own, so an empty folder stays.",
  access: GM_READ,
  responses: read(ok(FolderList, "The folders."))
});

export const createCodexFolder = defineRoute({
  method: "post",
  path: CODEX_PATHS.folders,
  operationId: "createCodexFolder",
  tag: "Codex",
  summary: "Make a folder",
  description: "Makes an empty folder, or keeps the one that exists.",
  access: WRITE,
  body: json(codex.FolderPathSchema),
  responses: write(201, ok(FolderCreated, "The folder."))
});

export const moveCodexFolder = defineRoute({
  method: "post",
  path: CODEX_PATHS.foldersMove,
  operationId: "moveCodexFolder",
  tag: "Codex",
  summary: "Rename or move a folder",
  description: "Renames or moves a folder and everything under it, and every page in it with them.",
  access: WRITE,
  body: json(codex.FolderMoveSchema),
  responses: write(200, ok(FolderMoved, "How many pages moved."))
});

export const deleteCodexFolder = defineRoute({
  method: "post",
  path: CODEX_PATHS.foldersDelete,
  operationId: "deleteCodexFolder",
  tag: "Codex",
  summary: "Delete a folder",
  description: "Deletes a folder and its subfolders. Every page in them moves to the top level and is kept.",
  access: WRITE,
  body: json(codex.FolderPathSchema),
  responses: write(200, ok(Deleted, "The folder is gone."))
});

// ----- Connections -----

export const listCodexConnections = defineRoute({
  method: "get",
  path: CODEX_PATHS.connections,
  operationId: "listCodexConnections",
  tag: "Codex",
  summary: "List every connection",
  description:
    "Every connection in the Codex: one kind of edge for the whole graph. A declared relationship and a `[[wiki link]]` are the same thing with a different `origin`, and a connection may carry a `label`. A player receives a connection only when three things hold: the target page is revealed, the record it comes from is revealed by its own kind's player rule, and the connection sits on the `player` layer or is a mention from a block shown to a character the player holds. A link written in a hidden block is the GM's note about a connection the party has not been shown. A player's list comes in a fixed order of its own, apart from the order connections were made in.",
  access: READ,
  responses: read(ok(ConnectionList, "The connections."))
});

export const updateCodexConnection = defineRoute({
  method: "patch",
  path: CODEX_PATHS.connectionById,
  operationId: "updateCodexConnection",
  tag: "Codex",
  summary: "Relabel or redate a connection",
  description:
    "Changes a declared connection's label, layer or start. A mention has no id: it comes from a body's text, and editing that text edits it.",
  access: WRITE,
  params: byId("connection"),
  body: json(codex.ConnectionUpdateSchema),
  responses: write(200, ok(Connection, "The connection."), { 404: refused() })
});

export const deleteCodexConnection = defineRoute({
  method: "delete",
  path: CODEX_PATHS.connectionById,
  operationId: "deleteCodexConnection",
  tag: "Codex",
  summary: "Remove a connection",
  description:
    "Removes one declared connection; removing one that is gone answers the same. It counts as an edit of both pages for recently updated, and neither page's `rev` moves.",
  access: WRITE,
  params: byId("connection"),
  responses: { 200: ok(Deleted, "The connection is gone."), 401: refused(), 403: refused() }
});

// ----- The atlas -----

export const listCodexMaps = defineRoute({
  method: "get",
  path: CODEX_PATHS.maps,
  operationId: "listCodexMaps",
  tag: "Codex",
  summary: "List the atlas maps",
  description:
    "The atlas's map tree. A player sees the revealed maps, and a revealed map keeps its parent only when the parent is revealed too.",
  access: READ,
  responses: read(ok(MapList, "The maps."))
});

export const createCodexMap = defineRoute({
  method: "post",
  path: CODEX_PATHS.maps,
  operationId: "createCodexMap",
  tag: "Codex",
  summary: "Add a map to the atlas",
  description: "Makes an uploaded map image a map in the atlas.",
  access: WRITE,
  body: json(codex.MapCreateSchema),
  responses: write(201, ok(Map_, "The new map."), { 404: refused() })
});

export const updateCodexMap = defineRoute({
  method: "patch",
  path: CODEX_PATHS.mapById,
  operationId: "updateCodexMap",
  tag: "Codex",
  summary: "Rename or retype a map",
  access: WRITE,
  params: byId("map"),
  body: json(codex.MapUpdateSchema),
  responses: write(200, ok(Map_, "The map."), { 404: refused() })
});

export const deleteCodexMap = defineRoute({
  method: "delete",
  path: CODEX_PATHS.mapById,
  operationId: "deleteCodexMap",
  tag: "Codex",
  summary: "Delete a map",
  description: "Deletes a map and its pins. Deleting one that is gone answers the same.",
  access: WRITE,
  params: byId("map"),
  responses: { 200: ok(Deleted, "The map is gone."), 401: refused(), 403: refused() }
});

export const setCodexMapParent = defineRoute({
  method: "post",
  path: CODEX_PATHS.mapParent,
  operationId: "setCodexMapParent",
  tag: "Codex",
  summary: "Move a map in the atlas tree",
  description: "Sets the map's parent; `null` makes it a top-level map.",
  access: WRITE,
  params: byId("map"),
  body: json(codex.MapParentSchema),
  responses: write(200, ok(Map_, "The map."), { 404: refused() })
});

export const revealCodexMap = defineRoute({
  method: "post",
  path: CODEX_PATHS.mapReveal,
  operationId: "revealCodexMap",
  tag: "Codex",
  summary: "Show or hide a map",
  access: WRITE,
  params: byId("map"),
  body: json(codex.RevealSchema),
  responses: write(200, ok(Map_, "The map."), { 404: refused() })
});

export const listCodexMarkers = defineRoute({
  method: "get",
  path: CODEX_PATHS.mapMarkers,
  operationId: "listCodexMarkers",
  tag: "Codex",
  summary: "List a map's pins",
  description:
    "The pins on a map. A player reads them only on a revealed map, and each pin's links are cut to what the player can read.",
  access: READ,
  params: byId("map"),
  responses: read(ok(MarkerList, "The pins."), { 404: refused() })
});

export const createCodexMarker = defineRoute({
  method: "post",
  path: CODEX_PATHS.mapMarkers,
  operationId: "createCodexMarker",
  tag: "Codex",
  summary: "Drop a pin on a map",
  access: WRITE,
  params: byId("map"),
  body: json(codex.MarkerCreateSchema),
  responses: write(201, ok(Marker, "The new pin."), { 404: refused() })
});

export const placeCodexParty = defineRoute({
  method: "post",
  path: CODEX_PATHS.party,
  operationId: "placeCodexParty",
  tag: "Codex",
  summary: "Put the party at a point on a map",
  description:
    "Moves the party pin there in one write, across maps if it must. It keeps its label, icon, links and reveal state unless `revealedToPlayers` is sent. With no party pin, one is made there (`created: true`), labelled The party and revealed when the map is, unless `revealedToPlayers` says otherwise.",
  access: WRITE,
  body: json(codex.PartyPlaceSchema),
  responses: write(200, ok(PartyPlaced, "The party pin."), { 404: refused() })
});

export const getCodexPartyLocation = defineRoute({
  method: "get",
  path: CODEX_PATHS.party,
  operationId: "getCodexPartyLocation",
  tag: "Codex",
  summary: "Read where the party is",
  description:
    "The party pin and the name of the map it sits on, for the front page's party card and the atlas's jump. `party` is null when no pin carries the flag. For a player it is also null when the party pin fails the ordinary reveal gate, the pin and its map both revealed, so a hidden party pin reads the same as none. The flag gives no visibility of its own.",
  access: READ,
  responses: read(ok(PartyLocationData, "Where the party is, or null."))
});

export const getCodexMarker = defineRoute({
  method: "get",
  path: CODEX_PATHS.markerById,
  operationId: "getCodexMarker",
  tag: "Codex",
  summary: "Read a pin",
  description:
    "One pin, projected for the caller. A player receives it only when the pin and its map are both revealed, the gate `GET /codex/maps/{id}/markers` applies, with `pageIds` cut to the revealed pages and scene and actor links left out. Either half failing is a 404, so a pin id cannot probe for what is there.",
  access: READ,
  params: byId("pin"),
  responses: read(ok(MarkerProjectedData, "The pin."), { 404: refused() })
});

export const updateCodexMarker = defineRoute({
  method: "patch",
  path: CODEX_PATHS.markerById,
  operationId: "updateCodexMarker",
  tag: "Codex",
  summary: "Edit a pin",
  description: "Changes a pin's place, icon, label or links: the fields sent.",
  access: WRITE,
  params: byId("pin"),
  body: json(codex.MarkerUpdateSchema),
  responses: write(200, ok(Marker, "The pin."), { 404: refused() })
});

export const deleteCodexMarker = defineRoute({
  method: "delete",
  path: CODEX_PATHS.markerById,
  operationId: "deleteCodexMarker",
  tag: "Codex",
  summary: "Delete a pin",
  description: "Deleting a pin that is gone answers the same.",
  access: WRITE,
  params: byId("pin"),
  responses: { 200: ok(Deleted, "The pin is gone."), 401: refused(), 403: refused() }
});

export const moveCodexMarker = defineRoute({
  method: "post",
  path: CODEX_PATHS.markerMove,
  operationId: "moveCodexMarker",
  tag: "Codex",
  summary: "Move a pin",
  description: "Moves a pin to a point in the map image's pixels.",
  access: WRITE,
  params: byId("pin"),
  body: json(codex.MarkerMoveSchema),
  responses: write(200, ok(Marker, "The pin."), { 404: refused() })
});

export const revealCodexMarker = defineRoute({
  method: "post",
  path: CODEX_PATHS.markerReveal,
  operationId: "revealCodexMarker",
  tag: "Codex",
  summary: "Show or hide a pin",
  access: WRITE,
  params: byId("pin"),
  body: json(codex.RevealSchema),
  responses: write(200, ok(Marker, "The pin."), { 404: refused() })
});

export const setCodexPartyMarker = defineRoute({
  method: "put",
  path: CODEX_PATHS.markerParty,
  operationId: "setCodexPartyMarker",
  tag: "Codex",
  summary: "Mark a pin as where the party is",
  description:
    "Sets or clears the party flag on this pin. One pin in the whole atlas carries it, so setting it here clears it from the pin that had it, in one step. `isParty: false` clears it from this pin only. The flag is the pin's only party-specific part: the pin moves, takes a label and links, shows and hides and is deleted through the ordinary pin routes. The party pin is for the players, but the flag gives it no visibility: a hidden party pin, or one on a hidden map, stays hidden like any other.",
  access: WRITE,
  params: byId("pin"),
  body: json(codex.MarkerPartySchema),
  responses: write(200, ok(Marker, "The pin."), { 404: refused() })
});

// ----- The journal and the chronicle -----

export const listCodexTimeline = defineRoute({
  method: "get",
  path: CODEX_PATHS.timeline,
  operationId: "listCodexTimeline",
  tag: "Codex",
  summary: "Read the chronicle",
  description:
    "Every journal entry and every dated `event` page, in one in-world order and one row shape, told apart by `kind`. The by-session lens regroups these same records. A player receives the revealed entries and revealed event pages, without the GM-only text, the replay link or the raw sort key. The rows come from the journal's and the page's own player projections, so this read is never weaker than either.",
  access: READ,
  responses: read(ok(ChronicleList, "The chronicle."))
});

export const listCodexJournal = defineRoute({
  method: "get",
  path: CODEX_PATHS.journal,
  operationId: "listCodexJournal",
  tag: "Codex",
  summary: "Read the journal",
  description:
    "The campaign's journal, or a place's own entries by `markerId` or `pageId`. A player reads a place's entries only when its pin or page is visible, else 404, and receives the revealed entries.",
  access: READ,
  query: codex.CodexJournalQuerySchema,
  responses: read(ok(JournalList, "The entries."), { 400: refused("An id is not a UUID."), 404: refused() })
});

const SESSION_ID_404 = "`sessionId` names no session, or a downtime's `characterPageId` names no page.";

export const createCodexJournalEntry = defineRoute({
  method: "post",
  path: CODEX_PATHS.journal,
  operationId: "createCodexJournalEntry",
  tag: "Codex",
  summary: "Write a journal entry",
  description:
    "Adds an entry to the journal. A `sessionId` naming no session is a 404: the body is well formed, and the record it points at is gone.",
  access: WRITE,
  body: json(codex.JournalWriteSchema, {
    example: { playerText: "The party reached Phandalin at dusk.", revealedToPlayers: true }
  }),
  responses: write(201, ok(JournalEntry, "The new entry."), { 404: refused("`sessionId` names no session.") })
});

export const createCodexDeadline = defineRoute({
  method: "post",
  path: CODEX_PATHS.journalDeadline,
  operationId: "createCodexDeadline",
  tag: "Codex",
  summary: "Set a deadline",
  description:
    "Adds a deadline: something that will happen at an in-world date the campaign clock can reach. Its text says what and its `inWorldDate` says when, which is why `inWorldDate` is required here. Whether it has `fired` is worked out from that date and the clock on every read, so turning the clock back un-fires it. It starts hidden and is shown by the ordinary `POST /codex/journal/{id}/reveal`; no kind of entry has a reveal of its own.",
  access: WRITE,
  body: json(codex.DeadlineCreateSchema),
  responses: write(201, ok(JournalEntry, "The new deadline."), { 404: refused("`sessionId` names no session.") })
});

export const createCodexDowntime = defineRoute({
  method: "post",
  path: CODEX_PATHS.journalDowntime,
  operationId: "createCodexDowntime",
  tag: "Codex",
  summary: "Record downtime",
  description:
    "Records who spent how many days doing what between adventures. Recording it moves no clock: the answer's `proposedDate` is where the clock would go, so the GM's confirm can say what it will do. `POST /codex/journal/{id}/apply-downtime` moves the clock. Without an `inWorldDate` it is dated at the GM's current date, as a battle's automatic entry is.",
  access: WRITE,
  body: json(codex.DowntimeCreateSchema),
  responses: write(201, ok(DowntimeCreated, "The new downtime and where the clock would go."), {
    404: refused(SESSION_ID_404)
  })
});

export const createCodexMilestone = defineRoute({
  method: "post",
  path: CODEX_PATHS.journalMilestone,
  operationId: "createCodexMilestone",
  tag: "Codex",
  summary: "Record a milestone",
  description:
    "Records that the party reached a level, and why. `level` is the level reached, so deleting a record never changes what level the party is on. Progression here is by milestone and carries no XP. It starts hidden and is shown by the ordinary `POST /codex/journal/{id}/reveal`. Without an `inWorldDate` it is dated at the GM's current date.",
  access: WRITE,
  body: json(codex.MilestoneCreateSchema),
  responses: write(201, ok(JournalEntry, "The new milestone."), { 404: refused("`sessionId` names no session.") })
});

export const updateCodexJournalEntry = defineRoute({
  method: "patch",
  path: CODEX_PATHS.journalById,
  operationId: "updateCodexJournalEntry",
  tag: "Codex",
  summary: "Edit a journal entry",
  description:
    "Changes the fields sent and leaves the rest. A `downtime` group edits a downtime's `who`, `activity` and `characterPageId`, and is a 400 on any other kind of entry. `days` cannot change, since the clock already moved by it, so sending it is a 400.",
  access: WRITE,
  params: byId("entry"),
  body: json(codex.JournalUpdateSchema),
  responses: write(200, ok(JournalEntry, "The entry."), { 404: refused() })
});

export const deleteCodexJournalEntry = defineRoute({
  method: "delete",
  path: CODEX_PATHS.journalById,
  operationId: "deleteCodexJournalEntry",
  tag: "Codex",
  summary: "Delete a journal entry",
  description: "Deleting an entry that is gone answers the same.",
  access: WRITE,
  params: byId("entry"),
  responses: { 200: ok(Deleted, "The entry is gone."), 401: refused(), 403: refused() }
});

export const revealCodexJournalEntry = defineRoute({
  method: "post",
  path: CODEX_PATHS.journalReveal,
  operationId: "revealCodexJournalEntry",
  tag: "Codex",
  summary: "Show or hide a journal entry",
  description:
    "Works on every kind of entry, deadlines and downtime included. There is one reveal for all of them, so there is one gate to keep right.",
  access: WRITE,
  params: byId("entry"),
  body: json(codex.RevealSchema),
  responses: write(200, ok(JournalEntry, "The entry."), { 404: refused() })
});

export const applyCodexDowntime = defineRoute({
  method: "post",
  path: CODEX_PATHS.journalApplyDowntime,
  operationId: "applyCodexDowntime",
  tag: "Codex",
  summary: "Apply downtime to the clock",
  description:
    "Confirms a downtime's days and moves the GM's clock forward by them. The owner asked to be asked before the clock moves, and this is the GM's yes. The entry and the calendar move in one transaction and come back together. Applying a downtime again moves nothing. Moving the clock does not publish it: players see the published date until `POST /codex/calendar/publish`.",
  access: WRITE,
  params: byId("entry"),
  responses: {
    200: ok(DowntimeApplied, "The applied downtime and the calendar."),
    400: refused("The entry is not a downtime record."),
    401: refused(),
    403: refused(),
    404: refused(),
    409: refused("The downtime was already applied. No race was lost, so it carries no `error.currentRevision`.")
  }
});

// ----- Sessions and their prep -----

export const listCodexSessions = defineRoute({
  method: "get",
  path: CODEX_PATHS.sessions,
  operationId: "listCodexSessions",
  tag: "Codex",
  summary: "List the play sessions",
  description:
    "Every play session: the GM's prep and recap of one evening at the table. Numbered sessions come first in number order, then the unnumbered ones oldest first. A GM receives every session whole and `activeSessionId`. A player receives the revealed sessions reduced to the recap (`id`, `sessionNumber`, `realDate`, `recap`), and `activeSessionId` is always null for a player, since it can name a session they cannot see.",
  access: READ,
  responses: read(ok(SessionList, "The sessions."))
});

export const createCodexSession = defineRoute({
  method: "post",
  path: CODEX_PATHS.sessions,
  operationId: "createCodexSession",
  tag: "Codex",
  summary: "Create a play session",
  description:
    "Every field is optional: an empty body opens a blank planned session to prepare. The prep is copied from the default template unless `templateId` names another, or `null` asks for none. A `sessionNumber` another session carries is a 400: the journal's by-session lens resolves a number to one session, so numbers are unique.",
  access: WRITE,
  body: json(codex.SessionCreateSchema),
  responses: write(201, ok(Session, "The new session."))
});

export const getCodexSession = defineRoute({
  method: "get",
  path: CODEX_PATHS.sessionById,
  operationId: "getCodexSession",
  tag: "Codex",
  summary: "Read a play session",
  description:
    "One session, projected for the caller. A hidden session is a 404 to a player, the same as one that does not exist: that it exists at all is the GM's business.",
  access: READ,
  params: byId("session"),
  responses: read(ok(SessionProjectedData, "The session."), { 404: refused() })
});

export const updateCodexSession = defineRoute({
  method: "patch",
  path: CODEX_PATHS.sessionById,
  operationId: "updateCodexSession",
  tag: "Codex",
  summary: "Edit a play session",
  description:
    "Changes the fields sent and leaves the rest; `prep` replaces the sections whole. A stale `expectedRev` is a 409, and a `sessionNumber` another session carries is a 400.",
  access: WRITE,
  params: byId("session"),
  body: json(codex.SessionUpdateSchema),
  responses: write(200, ok(Session, "The session."), { 404: refused(), 409: stale("session") })
});

export const deleteCodexSession = defineRoute({
  method: "delete",
  path: CODEX_PATHS.sessionById,
  operationId: "deleteCodexSession",
  tag: "Codex",
  summary: "Delete a play session",
  description:
    "Deleting a session that is gone answers the same. When it was the active session, the pointer clears in the same transaction, so `activeSessionId` never names a record that is gone. Journal entries keep its `sessionNumber`: the number on an entry is a label.",
  access: WRITE,
  params: byId("session"),
  responses: { 200: ok(Deleted, "The session is gone."), 401: refused(), 403: refused() }
});

export const revealCodexSession = defineRoute({
  method: "post",
  path: CODEX_PATHS.sessionReveal,
  operationId: "revealCodexSession",
  tag: "Codex",
  summary: "Show or hide a session's recap",
  description:
    "Revealing is not an edit: neither `rev` nor `updatedAt` moves, so an open editor meets no conflict and a reveal sweep lights no recap badge for text nobody changed.",
  access: WRITE,
  params: byId("session"),
  body: json(codex.RevealSchema),
  responses: write(200, ok(Session, "The session."), { 404: refused() })
});

export const activateCodexSession = defineRoute({
  method: "post",
  path: CODEX_PATHS.sessionActivate,
  operationId: "activateCodexSession",
  tag: "Codex",
  summary: "Make a session the active one",
  description:
    "Makes this the session new journal entries are filed under when they name none, the entries a fight writes at its end included. One session is active at a time: the pointer lives on the Codex, so two active sessions cannot happen. The answer is the pointer alone. Activating says something about the table, and the record itself is unchanged: neither `rev` nor `updatedAt` moves.",
  access: WRITE,
  params: byId("session"),
  responses: {
    200: ok(SessionActive, "The active session's id."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const applyCodexPrepTemplate = defineRoute({
  method: "post",
  path: CODEX_PATHS.sessionApplyTemplate,
  operationId: "applyCodexPrepTemplate",
  tag: "Codex",
  summary: "Apply a prep template to a session",
  description:
    "Applies a template to the session's prep again and keeps what was written. Each template section takes the content of a section that still matches it: the same template section and type, else the same title and type. A section that matches nothing is kept after them when it holds anything.",
  access: WRITE,
  params: byId("session"),
  body: json(codex.SessionApplyTemplateSchema),
  responses: write(200, ok(Session, "The session."), { 404: refused(), 409: stale("session") })
});

export const getCodexSessionHappened = defineRoute({
  method: "get",
  path: CODEX_PATHS.sessionHappened,
  operationId: "getCodexSessionHappened",
  tag: "Codex",
  summary: "Read what happened in a session",
  description:
    "The sources of a session's recap: the journal entries filed under it, the clues ticked in its prep, and the blocks revealed while it was active. GM-only.",
  access: GM_READ,
  params: byId("session"),
  responses: read(ok(SessionHappened, "What happened."), { 404: refused() })
});

export const logCodexSessionLine = defineRoute({
  method: "post",
  path: CODEX_PATHS.sessionLog,
  operationId: "logCodexSessionLine",
  tag: "Codex",
  summary: "Log a line at the table",
  description:
    "Files a note under this session with the line as its player text, dated at the GM's date, and hidden unless `revealedToPlayers` is true.",
  access: WRITE,
  params: byId("session"),
  body: json(codex.SessionLogSchema, { example: { text: "Lyra bargained the ferryman down to two silver." } }),
  responses: write(201, ok(JournalEntry, "The new note."), { 404: refused() })
});

export const tickCodexPrepItem = defineRoute({
  method: "post",
  path: CODEX_PATHS.sessionTick,
  operationId: "tickCodexPrepItem",
  tag: "Codex",
  summary: "Tick a prep checklist item",
  description:
    "Ticks or unticks one checklist item of the session's prep. It changes the prep, so the session's `rev` moves. The answer has the clue as the live board shows it, link included.",
  access: WRITE,
  params: byId("session"),
  body: json(codex.SessionTickSchema),
  responses: write(200, ok(SessionTick, "The session and the clue."), { 404: refused() })
});

export const setCodexCurrentScene = defineRoute({
  method: "post",
  path: CODEX_PATHS.sessionCurrentScene,
  operationId: "setCodexCurrentScene",
  tag: "Codex",
  summary: "Set the live board's current scene",
  description: "Sets the current scene to a scene in the session's prep, or to none.",
  access: WRITE,
  params: byId("session"),
  body: json(codex.SessionCurrentSceneSchema),
  responses: write(200, ok(Session, "The session."), { 404: refused() })
});

export const getCodexLiveBoard = defineRoute({
  method: "get",
  path: CODEX_PATHS.board,
  operationId: "getCodexLiveBoard",
  tag: "Codex",
  summary: "Read the live board",
  description:
    "The active session's board, read from its prep: the scenes and the current one, the linked pages, the clues with what each links, the clocks by the GM's date, the quests in play and what has been filed under it. `board` is null when no session is active. GM-only.",
  access: GM_READ,
  responses: read(ok(LiveBoard, "The live board, or null."))
});

export const listCodexPrepTemplates = defineRoute({
  method: "get",
  path: CODEX_PATHS.prepTemplates,
  operationId: "listCodexPrepTemplates",
  tag: "Codex",
  summary: "List the prep templates",
  description:
    "The GM's library of session prep templates: the built-in starting template first, then the GM's by name. `defaultTemplateId` is the one a new session copies when it names none. GM-only.",
  access: GM_READ,
  responses: read(ok(wire.CodexPrepTemplateListSchema, "The templates."))
});

export const createCodexPrepTemplate = defineRoute({
  method: "post",
  path: CODEX_PATHS.prepTemplates,
  operationId: "createCodexPrepTemplate",
  tag: "Codex",
  summary: "Create a prep template",
  description: "The library holds at most 50.",
  access: WRITE,
  body: json(codex.PrepTemplateCreateSchema),
  responses: write(201, ok(PrepTemplate, "The new template."))
});

export const updateCodexPrepTemplate = defineRoute({
  method: "patch",
  path: CODEX_PATHS.prepTemplateById,
  operationId: "updateCodexPrepTemplate",
  tag: "Codex",
  summary: "Edit a prep template",
  description:
    "Renames a template, or replaces its sections: send the whole list to add, remove, edit or reorder them. Sessions made from it keep their own copy. The built-in template is a 400.",
  access: WRITE,
  params: byId("template"),
  body: json(codex.PrepTemplateUpdateSchema),
  responses: write(200, ok(PrepTemplate, "The template."), { 404: refused(), 409: stale("template") })
});

export const deleteCodexPrepTemplate = defineRoute({
  method: "delete",
  path: CODEX_PATHS.prepTemplateById,
  operationId: "deleteCodexPrepTemplate",
  tag: "Codex",
  summary: "Delete a prep template",
  description:
    "Deleting a template that is gone answers the same. The built-in template is a 400. Deleting the default makes the built-in the default.",
  access: WRITE,
  params: byId("template"),
  responses: {
    200: ok(Deleted, "The template is gone."),
    400: refused("The built-in template cannot be deleted."),
    401: refused(),
    403: refused()
  }
});

export const duplicateCodexPrepTemplate = defineRoute({
  method: "post",
  path: CODEX_PATHS.prepTemplateDuplicate,
  operationId: "duplicateCodexPrepTemplate",
  tag: "Codex",
  summary: "Copy a prep template",
  description:
    "Copies a template, the built-in one included, into one the GM owns. Its sections keep their ids, so a session made from the original applies the copy cleanly. `name` defaults to the original's name with copy after it.",
  access: WRITE,
  params: byId("template"),
  body: json(codex.PrepTemplateDuplicateSchema, { required: false }),
  responses: write(201, ok(PrepTemplate, "The copy."), { 404: refused() })
});

export const setDefaultCodexPrepTemplate = defineRoute({
  method: "post",
  path: CODEX_PATHS.prepTemplateDefault,
  operationId: "setDefaultCodexPrepTemplate",
  tag: "Codex",
  summary: "Make a template the default",
  description: "Makes this template the one a new session copies when it names none.",
  access: WRITE,
  params: byId("template"),
  responses: {
    200: ok(PrepTemplateDefault, "The default template's id."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

// ----- Quests -----

export const listCodexQuests = defineRoute({
  method: "get",
  path: CODEX_PATHS.quests,
  operationId: "listCodexQuests",
  tag: "Codex",
  summary: "List the quests",
  description:
    "Every quest: what the party is chasing, and whether it is still open. A GM receives every quest whole. A player receives the revealed quests reduced to the player layer (`id`, `title`, `status`, `body`, `objectives`, `entityIds`). A quest's `status` reaches players, since what is still open is the point of the list. `entityIds` is cut to the revealed pages, as a pin's `pageIds` is.",
  access: READ,
  responses: read(ok(QuestList, "The quests."))
});

export const createCodexQuest = defineRoute({
  method: "post",
  path: CODEX_PATHS.quests,
  operationId: "createCodexQuest",
  tag: "Codex",
  summary: "Create a quest",
  description:
    "Creates a quest and, in the same transaction, its first history record: a quest starting is an event, so its first status is recorded as a later change would be. That record is a hidden `quest` journal entry with no player text, dated at the GM's clock and filed under the active session, and revealing it shows nothing while the quest is hidden. Only `title` is required, so the GM can name a lead the moment it comes up and fill it in later.",
  access: WRITE,
  body: json(codex.QuestCreateSchema, { example: { title: "Find the missing caravan", status: "active" } }),
  responses: write(201, ok(Quest, "The new quest."))
});

export const getCodexQuest = defineRoute({
  method: "get",
  path: CODEX_PATHS.questById,
  operationId: "getCodexQuest",
  tag: "Codex",
  summary: "Read a quest",
  description:
    "One quest, projected for the caller. A hidden quest is a 404 to a player, the same as one that does not exist: that it exists at all is the GM's business.",
  access: READ,
  params: byId("quest"),
  responses: read(ok(QuestProjectedData, "The quest."), { 404: refused() })
});

export const updateCodexQuest = defineRoute({
  method: "patch",
  path: CODEX_PATHS.questById,
  operationId: "updateCodexQuest",
  tag: "Codex",
  summary: "Edit a quest",
  description:
    "Changes the fields sent and leaves the rest. A change of status also adds a hidden `quest` history record in the same transaction; a prose edit adds none, since nothing happened in the world. A stale `expectedRev` is a 409. `objectives` is replaced whole and kept in the order sent: the order is content, so it is never sorted or deduplicated.",
  access: WRITE,
  params: byId("quest"),
  body: json(codex.QuestUpdateSchema),
  responses: write(200, ok(Quest, "The quest."), { 404: refused(), 409: stale("quest") })
});

export const deleteCodexQuest = defineRoute({
  method: "delete",
  path: CODEX_PATHS.questById,
  operationId: "deleteCodexQuest",
  tag: "Codex",
  summary: "Delete a quest",
  description:
    "Deleting a quest that is gone answers the same. The pages in `entityIds` stay: the link is a reference.",
  access: WRITE,
  params: byId("quest"),
  responses: { 200: ok(Deleted, "The quest is gone."), 401: refused(), 403: refused() }
});

export const revealCodexQuest = defineRoute({
  method: "post",
  path: CODEX_PATHS.questReveal,
  operationId: "revealCodexQuest",
  tag: "Codex",
  summary: "Show or hide a quest",
  description:
    "Revealing is not an edit: neither `rev` nor `updatedAt` moves, so an open editor meets no conflict and a reveal sweep makes no untouched quest look changed.",
  access: WRITE,
  params: byId("quest"),
  body: json(codex.RevealSchema),
  responses: write(200, ok(Quest, "The quest."), { 404: refused() })
});

export const addCodexQuestBlock = defineRoute({
  method: "post",
  path: CODEX_PATHS.questBlocks,
  operationId: "addCodexQuestBlock",
  tag: "Codex",
  summary: "Add a hidden block to a quest",
  description: "Adds a block to a quest, as on a page. It starts Hidden. An edit.",
  access: WRITE,
  params: byId("quest"),
  body: json(codex.BlockAddSchema),
  responses: write(201, ok(QuestBlockCreated, "The quest and the new block."), {
    404: refused(),
    409: stale("quest")
  })
});

export const editCodexQuestBlock = defineRoute({
  method: "patch",
  path: CODEX_PATHS.questBlockById,
  operationId: "editCodexQuestBlock",
  tag: "Codex",
  summary: "Edit a quest's hidden block",
  description: "Changes a block's title or text. Its audience stays. An edit.",
  access: WRITE,
  params: blockOf("quest"),
  body: json(codex.BlockEditSchema),
  responses: write(200, ok(Quest, "The quest."), { 404: refused(), 409: stale("quest") })
});

export const deleteCodexQuestBlock = defineRoute({
  method: "delete",
  path: CODEX_PATHS.questBlockById,
  operationId: "deleteCodexQuestBlock",
  tag: "Codex",
  summary: "Delete a quest's hidden block",
  description: "Deletes a block and answers the quest. A block that is already gone answers the quest as it is.",
  access: WRITE,
  params: blockOf("quest"),
  responses: { 200: ok(Quest, "The quest."), 401: refused(), 403: refused(), 404: refused() }
});

export const moveCodexQuestBlock = defineRoute({
  method: "post",
  path: CODEX_PATHS.questBlockMove,
  operationId: "moveCodexQuestBlock",
  tag: "Codex",
  summary: "Move a quest's hidden block",
  description: "Moves a block to another anchor, or another slot at its anchor. An edit.",
  access: WRITE,
  params: blockOf("quest"),
  body: json(codex.BlockMoveSchema),
  responses: write(200, ok(Quest, "The quest."), { 404: refused(), 409: stale("quest") })
});

export const setCodexQuestBlockAudience = defineRoute({
  method: "put",
  path: CODEX_PATHS.questBlockAudience,
  operationId: "setCodexQuestBlockAudience",
  tag: "Codex",
  summary: "Set who sees a quest's hidden block",
  description:
    "Sets a block's audience, as on a page. It is not an edit. The quest's reveal plays the page's part: a block is stamped and read only once the quest is revealed.",
  access: WRITE,
  params: blockOf("quest"),
  body: json(codex.AudienceSetSchema),
  responses: write(200, ok(Quest, "The quest."), { 404: refused() })
});

export const setCodexQuestObjectiveAudience = defineRoute({
  method: "put",
  path: CODEX_PATHS.questObjectiveAudience,
  operationId: "setCodexQuestObjectiveAudience",
  tag: "Codex",
  summary: "Set who sees a quest objective",
  description:
    "Sets one objective's audience: Hidden, everyone, or chosen party characters. It is not an edit. A player's quest leaves out every objective they may not read, and its count counts the rest.",
  access: WRITE,
  params: z.object({
    id: z.uuid().describe("The quest's id."),
    objectiveId: z.uuid().describe("The objective's id.")
  }),
  body: json(codex.AudienceSetSchema),
  responses: write(200, ok(Quest, "The quest."), { 404: refused() })
});

// ----- Standing -----

const faction = z.object({ factionPageId: z.uuid().describe("The faction page's id, which names its standing.") });

export const listCodexStanding = defineRoute({
  method: "get",
  path: CODEX_PATHS.standing,
  operationId: "listCodexStanding",
  tag: "Codex",
  summary: "List where the party stands with each faction",
  description:
    "A GM receives every standing. A player receives those revealed whose faction page is revealed too, reduced to `factionPageId` and `value`. A standing has no title of its own: a reader names it from the faction's page, so one shown for a hidden faction would hand the party a page id they cannot open beside a bar they cannot label. `value` runs from -100 (hostile) to +100 (allied), since a faction can work against the party; show the word beside the bar.",
  access: READ,
  responses: read(ok(StandingList, "The standings."))
});

export const setCodexStanding = defineRoute({
  method: "put",
  path: CODEX_PATHS.standingByFaction,
  operationId: "setCodexStanding",
  tag: "Codex",
  summary: "Set where the party stands with a faction",
  description:
    "Sets the standing and adds the `standing` chronicle record for the change in one transaction, so the table of where things stand and the timeline of what happened always agree. The first write makes the standing: there is one per faction. `value` is the resulting value, from -100 to 100, and the chronicle record carries the change. A page that does not exist is a 404, and a page that is not a `faction` is a 400.",
  access: WRITE,
  params: faction,
  body: json(codex.StandingSetSchema, { example: { value: 25, reason: "Returned the stolen ledger." } }),
  responses: write(200, ok(Standing, "The standing."), { 404: refused() })
});

export const revealCodexStanding = defineRoute({
  method: "post",
  path: CODEX_PATHS.standingReveal,
  operationId: "revealCodexStanding",
  tag: "Codex",
  summary: "Show or hide a faction's standing",
  description:
    "Revealing a standing leaves the faction page as it is: a player sees the standing once both are revealed.",
  access: WRITE,
  params: faction,
  body: json(codex.RevealSchema),
  responses: write(200, ok(Standing, "The standing."), { 404: refused() })
});

// ----- What players can see -----

export const getCodexRevealAudit = defineRoute({
  method: "get",
  path: CODEX_PATHS.revealAudit,
  operationId: "getCodexRevealAudit",
  tag: "Codex",
  summary: "Read everything the party can see",
  description:
    "One GM view of what the party can see across the Codex: the published date, pages, maps, pins, journal entries of every kind, sessions, quests and standing. It is built from the player projections and has no visibility rule of its own, so it lists what the player reads would return: a pin flagged revealed on a hidden map is absent, since the party cannot see it either. Every section is present, an empty one with `revealed: 0`, so nothing revealed never reads as not loaded. Each row carries the id its own reveal route takes, which is how to hide it from here. The table's own exposure (tokens, fog, the table screen) has its own rules and is not listed. GM-only.",
  access: GM_READ,
  responses: read(ok(RevealAudit, "What the party can see."))
});

// ----- The table scenes the Codex names -----

export const getCodexSceneLinks = defineRoute({
  method: "get",
  path: CODEX_PATHS.sceneLinks,
  operationId: "getCodexEncounterLinks",
  tag: "Codex",
  summary: "Read the Codex records that name each table scene",
  description:
    "For each table scene the Codex names, the sessions that stage it (`via: session` on the session itself, `prep` in an Encounters section of its prep) and the atlas pins that link it, with the map each pin sits on. A scene the Codex never names is absent, and an id the table no longer has is listed as it is. GM-only, as every scene id is.",
  access: GM_READ,
  responses: read(ok(SceneLinks, "The scenes and the records that name them."))
});

// ----- The calendar -----

export const getCodexCalendar = defineRoute({
  method: "get",
  path: CODEX_PATHS.calendar,
  operationId: "getCodexCalendar",
  tag: "Codex",
  summary: "Read the calendar",
  description:
    "The world's calendar: months, weekdays, eras and the current date, projected for the caller. The campaign has two clocks: the GM's, which runs ahead while the GM prepares, and the published one the party sees. A GM receives their own clock as `currentDate` and `publishedDate` beside it, to tell whether the table is behind. A player receives the published date as `currentDate` and no `publishedDate`. Months, weekdays and eras are the world's and reach players too.",
  access: READ,
  responses: read(ok(CalendarProjectedData, "The calendar."))
});

export const setCodexCalendar = defineRoute({
  method: "put",
  path: CODEX_PATHS.calendar,
  operationId: "setCodexCalendar",
  tag: "Codex",
  summary: "Replace the calendar",
  description:
    "Replaces the world's calendar and works out every dated record's order and label again from its raw date. It moves the GM's clock only and never publishes, so the party's `currentDate` waits for `POST /codex/calendar/publish`. `publishedDate` cannot be set here: this body replaces the whole calendar, and a value players see inside a whole replacement is one careless PUT from being cleared.",
  access: WRITE,
  body: json(codex.CalendarSchema),
  responses: write(200, ok(Calendar, "The calendar."))
});

export const checkCodexCalendar = defineRoute({
  method: "post",
  path: CODEX_PATHS.calendarCheck,
  operationId: "checkCodexCalendar",
  tag: "Codex",
  summary: "Check what a calendar change would move",
  description:
    "Says what saving this calendar, the body `PUT /codex/calendar` takes, would do to records players can see, and changes nothing. A dated record keeps its raw date, but a calendar with fewer or shorter months puts a date it lacks on another day, and a deadline measured against the published date can read as approaching again after players saw it pass. The GM's calendar editor asks before saving when anything would move. GM-only; a read, so it takes no `commandId` and pings nobody.",
  access: GM_READ,
  body: json(codex.CalendarSchema),
  responses: {
    200: ok(CalendarCheck, "What would move."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const publishCodexCampaignDate = defineRoute({
  method: "post",
  path: CODEX_PATHS.calendarPublish,
  operationId: "publishCodexCampaignDate",
  tag: "Codex",
  summary: "Publish the GM's date to players",
  description:
    "Makes the party's `currentDate` the GM's. It takes no body: publishing means the table now sees where the GM is, and a published date set any other way would be a third clock to keep in step. It is the one thing that moves the players' date; neither a calendar edit nor applied downtime does. Publishing while the GM has no current date clears the published one.",
  access: WRITE,
  responses: write(200, ok(Calendar, "The calendar."))
});

export const unpublishCodexCampaignDate = defineRoute({
  method: "post",
  path: CODEX_PATHS.calendarUnpublish,
  operationId: "unpublishCodexCampaignDate",
  tag: "Codex",
  summary: "Take the published date away from players",
  description:
    "Players' `currentDate` reads null until the GM publishes again. It takes no body, and the GM's own clock and the calendar stay as they are. A deadline a player saw pass reads as not yet fired while no date is published, since `fired` is measured against the published date. The reveal audit's date row hides through this route.",
  access: WRITE,
  responses: write(200, ok(Calendar, "The calendar."))
});

// ----- Settings, history and backups -----

export const getCodexSettings = defineRoute({
  method: "get",
  path: CODEX_PATHS.settings,
  operationId: "getCodexSettings",
  tag: "Codex",
  summary: "Read the Codex settings",
  description:
    "Every Codex-wide setting, and what the kept page history costs (`versionCount`, `versionBytes`, worked out by the server). GM-only, the read as well as the write: these values describe how the GM's own history is kept and put nothing on a player's screen. A stored value out of range reads back as the default, so the answer is always usable.",
  access: GM_READ,
  responses: read(ok(Settings, "The settings."))
});

export const setCodexSettings = defineRoute({
  method: "put",
  path: CODEX_PATHS.settings,
  operationId: "setCodexSettings",
  tag: "Codex",
  summary: "Replace the Codex settings",
  description:
    "Replaces the Codex-wide settings and answers with them as a read returns them, usage figures included, so a caller sees the value stored. The body carries the settable groups only: `versionCount` and `versionBytes` describe a table the caller cannot see, so sending either is a 400. `windowMinutes` outside 0 to 10080 is a 400 too, while a fraction inside the range is truncated, since a slider makes those. Changing these settings never deletes a saved version: switching history off stops new ones, and the existing history stays listed and restorable.",
  access: WRITE,
  body: json(codex.CodexSettingsSchema),
  responses: write(200, ok(Settings, "The stored settings."))
});

export const deleteCodexPageRevisions = defineRoute({
  method: "delete",
  path: CODEX_PATHS.pageRevisionsCollection,
  operationId: "deleteCodexPageRevisions",
  tag: "Codex",
  summary: "Delete old page versions",
  description:
    "Deletes every saved page version authored more than `olderThanDays` ago, and answers how many went. `olderThanDays` is a whole number from 0 to 36500; anything else is a 400 and is never rounded, since this deletes data. `0` deletes every version. Age is measured from `authoredAt`, the clock the save throttle uses. It works whether history is on or off, and touches no page: a page as it stands is not a version of itself.",
  access: WRITE,
  body: json(codex.RevisionsDeleteSchema, { example: { olderThanDays: 90 } }),
  responses: write(200, ok(RevisionsDeleted, "How many versions went."))
});

export const exportCodex = defineRoute({
  method: "get",
  path: CODEX_PATHS.export,
  operationId: "exportCodex",
  tag: "Codex",
  summary: "Export a backup of the Codex",
  description:
    "The whole Codex as a backup bundle, every saved page version included. `POST /codex/import` restores it.",
  access: GM_READ,
  responses: read(ok(Export, "The backup."))
});

export const importCodex = defineRoute({
  method: "post",
  path: CODEX_PATHS.import,
  operationId: "importCodex",
  tag: "Codex",
  summary: "Restore a backup of the Codex",
  description:
    "Replaces the whole Codex with a backup, all or nothing: every Codex table is emptied and reloaded in one transaction, so one bad row refuses the lot with a 400 and nothing changes. It takes the `data` of a `GET /codex/export` answer as it is: `exportedAt` is ignored, so a saved export posts unchanged. A bundle with no `bundleVersion` is an older version 1 backup and restores. A version 1 page's or quest's GM text becomes Hidden blocks and its secret fields Hidden fields, as the upgrade converts them, and a newer version is a 400. The body may be up to 64 MB. This deletes data: export first.",
  access: WRITE,
  body: json(codex.CodexImportSchema),
  responses: write(200, ok(Imported, "The Codex is replaced, with counts of what it holds."), {
    413: refused("The backup is over 64 MB.")
  })
});

// ----- Page images -----

export const uploadCodexAsset = defineRoute({
  method: "post",
  path: CODEX_ASSET_PATHS.collection,
  operationId: "uploadCodexAsset",
  tag: "Codex",
  summary: "Upload a page image",
  description:
    "Takes a page banner or inline image as the raw request body, at most 11 MB, with its file name as a query parameter. Bytes already stored answer the stored image with a 200; a new one is a 201.",
  access: WRITE,
  query: z.object({ filename: z.string().optional().describe("The file's name, for its type.") }),
  body: binary("image/*", "The image file's bytes."),
  responses: {
    200: ok(AssetUpload, "These bytes were already stored. The stored image."),
    201: ok(AssetUpload, "The new image."),
    400: refused("The body is empty or not an image this server reads."),
    401: refused(),
    403: refused(),
    413: refused("The image is over 11 MB.")
  }
});

export const getCodexAssetContent = defineRoute({
  method: "get",
  path: CODEX_ASSET_PATHS.content,
  operationId: "getCodexAssetContent",
  tag: "Codex",
  summary: "Load a page image",
  description:
    "The original image bytes. A GM-grade caller may load any image; a player only one used by revealed content that reaches the player. Everyone else is refused before any lookup, so the answer never says whether the image exists. Answers with an ETag (a matching `If-None-Match` gets a 304) and `Cache-Control: private, no-store`.",
  access: READ,
  params: byId("image"),
  responses: {
    200: { kind: "other", description: "The image.", mediaType: "image/*", binary: true },
    304: noBody("Not modified: the ETag sent in `If-None-Match` is still current."),
    401: refused(),
    403: refused("This caller may not load this image."),
    404: refused()
  }
});

export const CODEX_ROUTES = [
  listCodexPages,
  createCodexPage,
  searchCodex,
  getCodexHome,
  getCodexPage,
  updateCodexPage,
  deleteCodexPage,
  revealCodexPage,
  addCodexPageBlock,
  editCodexPageBlock,
  deleteCodexPageBlock,
  moveCodexPageBlock,
  setCodexPageBlockAudience,
  setCodexPageFieldAudience,
  createCodexConnection,
  listCodexPageMarkers,
  listCodexPageRevisions,
  restoreCodexPageRevision,
  createCodexPreviewSession,
  listCodexFolders,
  createCodexFolder,
  moveCodexFolder,
  deleteCodexFolder,
  listCodexConnections,
  updateCodexConnection,
  deleteCodexConnection,
  listCodexMaps,
  createCodexMap,
  updateCodexMap,
  deleteCodexMap,
  setCodexMapParent,
  revealCodexMap,
  listCodexMarkers,
  createCodexMarker,
  placeCodexParty,
  getCodexPartyLocation,
  getCodexMarker,
  updateCodexMarker,
  deleteCodexMarker,
  moveCodexMarker,
  revealCodexMarker,
  setCodexPartyMarker,
  listCodexTimeline,
  listCodexJournal,
  createCodexJournalEntry,
  createCodexDeadline,
  createCodexDowntime,
  createCodexMilestone,
  updateCodexJournalEntry,
  deleteCodexJournalEntry,
  revealCodexJournalEntry,
  applyCodexDowntime,
  listCodexSessions,
  createCodexSession,
  getCodexSession,
  updateCodexSession,
  deleteCodexSession,
  revealCodexSession,
  activateCodexSession,
  applyCodexPrepTemplate,
  getCodexSessionHappened,
  logCodexSessionLine,
  tickCodexPrepItem,
  setCodexCurrentScene,
  getCodexLiveBoard,
  listCodexPrepTemplates,
  createCodexPrepTemplate,
  updateCodexPrepTemplate,
  deleteCodexPrepTemplate,
  duplicateCodexPrepTemplate,
  setDefaultCodexPrepTemplate,
  listCodexQuests,
  createCodexQuest,
  getCodexQuest,
  updateCodexQuest,
  deleteCodexQuest,
  revealCodexQuest,
  addCodexQuestBlock,
  editCodexQuestBlock,
  deleteCodexQuestBlock,
  moveCodexQuestBlock,
  setCodexQuestBlockAudience,
  setCodexQuestObjectiveAudience,
  listCodexStanding,
  setCodexStanding,
  revealCodexStanding,
  getCodexRevealAudit,
  getCodexSceneLinks,
  getCodexCalendar,
  setCodexCalendar,
  checkCodexCalendar,
  publishCodexCampaignDate,
  unpublishCodexCampaignDate,
  getCodexSettings,
  setCodexSettings,
  deleteCodexPageRevisions,
  exportCodex,
  importCodex,
  uploadCodexAsset,
  getCodexAssetContent
] as const;
