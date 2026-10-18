import { vi, type Mock } from "vitest";
import type {
  CodexBlock,
  CodexHome,
  CodexPage,
  CodexQuest,
  CodexSearchHit,
  PlayerCodexBlock,
  PlayerCodexHome,
  PlayerCodexPage,
  PlayerCodexQuest,
  PlayerCodexSearchHit
} from "../src/codex/contract";

/**
 * One set of fakes for every Codex read and write, so a test mocks the whole API surface the same way and sets only
 * the answers it cares about. Wire them in with
 *
 *   vi.mock("./api", async (actual) => (await import("../../test/codex-fakes")).fakeApiModule(await actual()));
 *   vi.mock("./api-records", async () => (await import("../../test/codex-fakes")).fakeRecordsModule());
 *
 * and call `resetFakes()` in a `beforeEach`. Every fake starts with an empty answer: no pages, no hits, no sessions.
 */

const fakes = <K extends string>(names: readonly K[]) =>
  Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<K, Mock>;

export const api = {
  codexApi: fakes([
    "listPages",
    "search",
    "getPage",
    "addConnection",
    "updateConnection",
    "removeConnection",
    "listConnections",
    "party",
    "marker",
    "markersForPage",
    "createPage",
    "updatePage",
    "revealPage",
    "deletePage",
    "moveFolder",
    "listFolders",
    "createFolder",
    "deleteFolder",
    "listRevisions",
    "restoreRevision",
    "getSettings",
    "setSettings",
    "deleteRevisions",
    "createPreviewSession",
    "exportBundle",
    "importBundle"
  ]),
  playerCodexApi: fakes([
    "listPages",
    "getPage",
    "search",
    "listConnections",
    "listMaps",
    "listMarkers",
    "party",
    "chronicle",
    "sessions",
    "quests",
    "standing",
    "calendar"
  ]),
  atlasApi: fakes([
    "listAssets",
    "uploadAsset",
    "listMaps",
    "createMap",
    "updateMap",
    "setMapParent",
    "revealMap",
    "deleteMap",
    "listMarkers",
    "createMarker",
    "updateMarker",
    "moveMarker",
    "revealMarker",
    "setPartyMarker",
    "deleteMarker"
  ]),
  calendarApi: fakes(["get", "check", "set", "publish", "unpublish"]),
  journalApi: fakes([
    "chronicle",
    "timeline",
    "forPage",
    "forMarker",
    "create",
    "createDeadline",
    "createDowntime",
    "createMilestone",
    "applyDowntime",
    "update",
    "reveal",
    "remove"
  ]),
  sessionApi: fakes(["list", "get", "create", "update", "reveal", "activate", "remove"]),
  questApi: fakes(["list", "get", "create", "update", "reveal", "remove"]),
  standingApi: fakes(["list", "set", "reveal"])
};

const blockFakes = () => fakes(["add", "update", "move", "remove", "setAudience"]);
export const records = {
  pageRecordApi: { ...fakes(["get", "getForPlayer", "update", "setFieldAudience"]), blocks: blockFakes() },
  questRecordApi: { ...fakes(["get", "update", "setObjectiveAudience"]), blocks: blockFakes() },
  findApi: fakes(["search", "searchAsPlayer", "home", "homeForPlayer"])
};

/** The `./api` module with every API object swapped for the fakes above; constants and helpers stay real. */
export function fakeApiModule(actual: unknown) {
  return { ...(actual as object), ...api };
}

export function fakeRecordsModule() {
  return records;
}

export const CALENDAR = {
  yearName: "DR",
  months: [{ name: "Hammer", days: 30 }],
  weekdays: [],
  currentInstant: 0,
  publishedInstant: 0,
  currentDate: { year: 1, month: 1, day: 1 },
  publishedDate: { year: 1, month: 1, day: 1 }
};

export const EMPTY_HOME: CodexHome = { collections: [], recent: [], revealCheck: { rows: [], total: 0 } };
export const EMPTY_PLAYER_HOME: PlayerCodexHome = { newSince: [], truncated: false };
const noHits = { hits: [], truncated: false, total: 0 };

/** Puts every fake back to its empty answer. Writes resolve to nothing until a test says otherwise. */
export function resetFakes(): void {
  const groups: object[] = [
    ...Object.values(api),
    records.findApi,
    records.pageRecordApi,
    records.questRecordApi,
    records.pageRecordApi.blocks,
    records.questRecordApi.blocks
  ];
  for (const group of groups)
    for (const fake of Object.values(group)) if (typeof fake === "function") (fake as Mock).mockReset();

  const { codexApi, playerCodexApi, atlasApi, calendarApi, journalApi, sessionApi, questApi, standingApi } = api;
  codexApi.listPages.mockResolvedValue([]);
  codexApi.listFolders.mockResolvedValue([]);
  codexApi.listConnections.mockResolvedValue([]);
  codexApi.party.mockResolvedValue(null);
  codexApi.markersForPage.mockResolvedValue([]);
  codexApi.listRevisions.mockResolvedValue([]);
  codexApi.getSettings.mockResolvedValue({
    autosave: { enabled: true, intervalSeconds: 1 },
    revisionHistory: { enabled: true, windowMinutes: 0 }
  });
  codexApi.search.mockResolvedValue({ hits: [], truncated: false });
  codexApi.createPreviewSession.mockResolvedValue("preview-token");
  codexApi.exportBundle.mockResolvedValue({ version: 1, pages: [], counts: {} });

  playerCodexApi.listPages.mockResolvedValue([]);
  playerCodexApi.listMaps.mockResolvedValue([]);
  playerCodexApi.listMarkers.mockResolvedValue([]);
  playerCodexApi.chronicle.mockResolvedValue([]);
  playerCodexApi.listConnections.mockResolvedValue([]);
  playerCodexApi.calendar.mockResolvedValue(null);
  playerCodexApi.sessions.mockResolvedValue([]);
  playerCodexApi.quests.mockResolvedValue([]);
  playerCodexApi.standing.mockResolvedValue([]);
  playerCodexApi.party.mockResolvedValue(null);
  playerCodexApi.search.mockResolvedValue({ hits: [], truncated: false });

  atlasApi.listMaps.mockResolvedValue([]);
  atlasApi.listAssets.mockResolvedValue([]);
  atlasApi.listMarkers.mockResolvedValue([]);
  calendarApi.get.mockResolvedValue(CALENDAR);
  journalApi.chronicle.mockResolvedValue([]);
  journalApi.timeline.mockResolvedValue([]);
  journalApi.forPage.mockResolvedValue([]);
  journalApi.forMarker.mockResolvedValue([]);
  sessionApi.list.mockResolvedValue({ sessions: [], activeSessionId: null });
  questApi.list.mockResolvedValue([]);
  standingApi.list.mockResolvedValue([]);

  records.findApi.search.mockResolvedValue(noHits);
  records.findApi.searchAsPlayer.mockResolvedValue(noHits);
  records.findApi.home.mockResolvedValue(EMPTY_HOME);
  records.findApi.homeForPlayer.mockResolvedValue(EMPTY_PLAYER_HOME);
  records.pageRecordApi.get.mockRejectedValue(new Error("That page does not exist."));
  records.pageRecordApi.getForPlayer.mockRejectedValue(new Error("That page does not exist."));
  records.questRecordApi.get.mockRejectedValue(new Error("That quest does not exist."));
}

// ----- Records -----

const AT = "2026-07-28T00:00:00.000Z";

export function block(over: Partial<CodexBlock> = {}): CodexBlock {
  return {
    id: "b1",
    anchor: 1,
    title: "The debt",
    text: "Ysolde owes the Tidebound four thousand gold.",
    audience: "hidden",
    characterIds: [],
    reveals: [],
    ...over
  };
}

export function page(over: Partial<CodexPage> = {}): CodexPage {
  return {
    id: "p1",
    title: "Ysolde Varn",
    entityType: "character",
    fields: {},
    hiddenFields: [],
    folder: null,
    tags: [],
    revealedToPlayers: true,
    bannerAssetId: null,
    inWorldLabel: null,
    calendarInstant: null,
    inWorldDate: null,
    rev: 1,
    createdAt: AT,
    updatedAt: AT,
    playerUpdatedAt: AT,
    characterUpdatedAt: {},
    firstShownAt: AT,
    playerBody: "The harbourmaster of Saltmere.",
    blocks: [],
    ...over
  };
}

/** The page as the list feed sends it: the page without its text. */
export function summary(over: Partial<CodexPage> = {}) {
  const { playerBody: _body, blocks: _blocks, ...rest } = page(over);
  return rest;
}

export function playerBlock(over: Partial<PlayerCodexBlock> = {}): PlayerCodexBlock {
  return {
    title: null,
    start: 0,
    end: 0,
    characterIds: [],
    revealed: { at: AT, sessionNumber: null, inWorldDate: null, inWorldLabel: null },
    ...over
  };
}

export function playerPage(over: Partial<PlayerCodexPage> = {}): PlayerCodexPage {
  return {
    id: "p1",
    title: "Ysolde Varn",
    entityType: "character",
    tags: [],
    bannerAssetId: null,
    playerUpdatedAt: AT,
    fields: {},
    body: "The harbourmaster of Saltmere.",
    firstShownAt: AT,
    blocks: [],
    ...over
  };
}

export function quest(over: Partial<CodexQuest> = {}): CodexQuest {
  return {
    id: "q1",
    title: "The Sunless Crown",
    status: "active",
    playerBody: "The burgomaster wants the crown returned.",
    blocks: [],
    objectives: [
      { id: "o1", text: "Find the crypt", done: true, audience: "everyone", characterIds: [] },
      { id: "o2", text: "Open the sarcophagus", done: false, audience: "everyone", characterIds: [] }
    ],
    entityIds: [],
    revealedToPlayers: true,
    tags: [],
    rev: 3,
    createdAt: AT,
    updatedAt: AT,
    firstShownAt: AT,
    ...over
  };
}

export function playerQuest(over: Partial<PlayerCodexQuest> = {}): PlayerCodexQuest {
  return {
    id: "q1",
    title: "The Sunless Crown",
    status: "active",
    body: "The burgomaster wants the crown returned.",
    blocks: [],
    objectives: [
      { text: "Find the crypt", done: true },
      { text: "Open the sarcophagus", done: false }
    ],
    entityIds: [],
    tags: [],
    ...over
  };
}

export function hit(over: Partial<CodexSearchHit> = {}): CodexSearchHit {
  return {
    kind: "page",
    id: "p1",
    title: "Ysolde Varn",
    tags: [],
    entityType: "character",
    mapId: null,
    type: "character",
    revealedToPlayers: true,
    modifiedAt: AT,
    columns: {},
    match: null,
    ...over
  };
}

export function playerHit(over: Partial<PlayerCodexSearchHit> = {}): PlayerCodexSearchHit {
  return {
    kind: "page",
    id: "p1",
    title: "Ysolde Varn",
    tags: [],
    entityType: "character",
    mapId: null,
    type: "character",
    modifiedAt: AT,
    columns: {},
    match: null,
    ...over
  };
}

/** The table's party: Lyra and Borin play, Old Tam is retired, and the wolf is a monster. */
export const ACTORS = [
  { id: "a-lyra", name: "Lyra Emberwise", kind: "player-character" },
  { id: "a-borin", name: "Borin Stoneguard", kind: "player-character" },
  { id: "a-old", name: "Old Tam", kind: "player-character", archived: true },
  { id: "a-wolf", name: "Wolf", kind: "monster" }
];
