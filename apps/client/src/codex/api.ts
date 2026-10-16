/**
 * The `/api/v1/codex` client, typed by `@vtt/domain`'s `codex-wire.ts`. The server projects every response
 * for the token's role, so a player token gets the player shapes from the same routes.
 */

import type {
  CodexAutosaveSettings,
  CodexCalendar,
  CodexCalendarMove,
  CodexChronicleRecord,
  CodexConnection,
  CodexConnectionLayer,
  CodexEntityType,
  CodexImportCounts,
  CodexInWorldDate,
  CodexJournalEntry,
  CodexMap,
  CodexMapKind,
  CodexMarker,
  CodexPage,
  CodexPageConnection,
  CodexPageRevision,
  CodexPageSummary,
  CodexQuest,
  CodexQuestObjective,
  CodexQuestStatus,
  CodexRevealAudit,
  CodexSearchResult,
  CodexSession,
  CodexSessionStatus,
  CodexSettings,
  CodexSettingsInput,
  CodexStanding,
  GmCodexCalendar,
  PlayerCodexCalendar,
  PlayerCodexChronicleRecord,
  PlayerCodexConnection,
  PlayerCodexMap,
  PlayerCodexMarker,
  PlayerCodexPage,
  PlayerCodexPageConnection,
  PlayerCodexPageSummary,
  PlayerCodexQuest,
  PlayerCodexSession,
  PlayerCodexStanding
} from "@vtt/domain";
import { apiBlob, apiRequest, type ApiRequest } from "../lib/api";

/** Restated from the server so an input can refuse rather than earn a 400. */
export const CONNECTION_LABEL_MAX = 40;
export const AUTOSAVE_INTERVAL_MIN = 1;
export const AUTOSAVE_INTERVAL_MAX = 600;
/** Any other stored value renders as a "custom" option. */
export const AUTOSAVE_INTERVAL_CHOICES: readonly number[] = [1, 10, 60, 300];
export const AUTOSAVE_DEFAULT: CodexAutosaveSettings = { enabled: true, intervalSeconds: 1 };
/** Server-enforced bounds. The server also truncates fractions, so display what it answers. */
export const REVISION_WINDOW_MIN = 0;
export const REVISION_WINDOW_MAX = 10_080;

/** The server's cap on one search's hits. */
export const SEARCH_HIT_CAP = 50;

export type CodexPageInput = Readonly<{
  title?: string;
  entityType?: CodexEntityType;
  fields?: Readonly<Record<string, string>>;
  gmFields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
  /** Omitted leaves the stored date alone; `null` clears it. */
  inWorldDate?: CodexInWorldDate | null;
  expectedRev?: number;
  /** Optional idempotency key: resending the same id replays the original response. */
  commandId?: string;
}>;

const BASE = "/api/v1/codex";

function request<T>(token: string, path: string, init: Omit<ApiRequest, "token" | "failure"> = {}): Promise<T> {
  return apiRequest<T>(`${BASE}${path}`, { ...init, token, failure: "The codex request failed." });
}

export const codexApi = {
  listPages: (token: string) => request<{ pages: CodexPageSummary[] }>(token, "/pages").then((data) => data.pages),
  search: (token: string, query: string) => request<CodexSearchResult>(token, `/search?q=${encodeURIComponent(query)}`),
  getPage: (token: string, id: string) =>
    request<{ page: CodexPage; connections: CodexPageConnection[] }>(token, `/pages/${id}`),
  /** Idempotent on `(from, to, label)`, and on the reverse pair for a symmetric label. */
  addConnection: (
    token: string,
    pageId: string,
    input: Readonly<{ toPageId: string; label?: string | null; layer?: CodexConnectionLayer; commandId?: string }>
  ) =>
    request<{ connection: CodexConnection }>(token, `/pages/${pageId}/connections`, {
      method: "POST",
      body: input
    }).then((data) => data.connection),
  /** Mentions have no id and are not patchable. */
  updateConnection: (
    token: string,
    id: string,
    input: Readonly<{ label?: string | null; layer?: CodexConnectionLayer; commandId?: string }>
  ) =>
    request<{ connection: CodexConnection }>(token, `/connections/${id}`, {
      method: "PATCH",
      body: input
    }).then((data) => data.connection),
  removeConnection: (token: string, id: string) =>
    request<{ deleted: boolean }>(token, `/connections/${id}`, { method: "DELETE" }),
  listConnections: (token: string) =>
    request<{ connections: CodexConnection[] }>(token, "/connections").then((data) => data.connections),
  /** `party` is null when no pin carries the flag; never 404s. */
  party: (token: string) =>
    request<{ party: { marker: CodexMarker; mapName: string } | null }>(token, "/party").then((data) => data.party),
  /** For a player, a hidden pin and a bogus id both 404. */
  marker: (token: string, id: string) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}`).then((data) => data.marker),
  /** Every atlas pin that links this page. */
  markersForPage: (token: string, pageId: string) =>
    request<{ markers: CodexMarker[] }>(token, `/pages/${pageId}/markers`).then((data) => data.markers),
  createPage: (token: string, input: CodexPageInput) =>
    request<{ page: CodexPage }>(token, "/pages", { method: "POST", body: input }).then((data) => data.page),
  updatePage: (token: string, id: string, input: CodexPageInput) =>
    request<{ page: CodexPage }>(token, `/pages/${id}`, { method: "PATCH", body: input }).then((data) => data.page),
  revealPage: (token: string, id: string, revealed: boolean) =>
    request<{ page: CodexPage }>(token, `/pages/${id}/reveal`, {
      method: "POST",
      body: { revealed }
    }).then((data) => data.page),
  deletePage: (token: string, id: string) => request<{ deleted: boolean }>(token, `/pages/${id}`, { method: "DELETE" }),
  moveFolder: (token: string, from: string, to: string) =>
    request<{ moved: number }>(token, "/folders/move", { method: "POST", body: { from, to } }).then(
      (data) => data.moved
    ),
  listFolders: (token: string) => request<{ folders: string[] }>(token, "/folders").then((data) => data.folders),
  createFolder: (token: string, path: string) =>
    request<{ path: string }>(token, "/folders", { method: "POST", body: { path } }).then((data) => data.path),
  deleteFolder: (token: string, path: string) =>
    request<{ deleted: boolean }>(token, "/folders/delete", { method: "POST", body: { path } }),
  listRevisions: (token: string, id: string) =>
    request<{ revisions: CodexPageRevision[] }>(token, `/pages/${id}/revisions`).then((data) => data.revisions),
  restoreRevision: (token: string, id: string, revisionId: number) =>
    request<{ page: CodexPage }>(token, `/pages/${id}/revisions/${revisionId}/restore`, { method: "POST" }).then(
      (data) => data.page
    ),
  getSettings: (token: string) =>
    request<{ settings: CodexSettings }>(token, "/settings").then((data) => data.settings),
  setSettings: (token: string, input: CodexSettingsInput) =>
    request<{ settings: CodexSettings }>(token, "/settings", { method: "PUT", body: input }).then(
      (data) => data.settings
    ),
  /** Destructive and irreversible. `olderThanDays: 0` deletes every version; current pages are untouched. */
  deleteRevisions: (token: string, olderThanDays: number) =>
    request<{ deleted: number }>(token, "/page-revisions", {
      method: "DELETE",
      body: { olderThanDays }
    }),
  /** A short-lived player token so the GM can preview the player Codex through the real player projection. */
  createPreviewSession: (token: string) =>
    request<{ token: string }>(token, "/preview-session", { method: "POST" }).then((data) => data.token),
  /** Save the whole object; `importBundle` accepts it back verbatim. */
  exportBundle: (token: string) => request<CodexExportBundle>(token, "/export"),
  /**
   * Destructive: every codex table is wiped and reloaded in one transaction, so a bad bundle is a 400 with
   * nothing touched. `counts` are the database's own post-import counts.
   */
  importBundle: (token: string, bundle: CodexImportBundle) =>
    request<{ replaced: true; counts: CodexImportCounts }>(token, "/import", {
      method: "POST",
      body: bundle
    })
};

export type CodexExportBundle = Readonly<{ codex: unknown; exportedAt: string; bundleVersion: number }>;
/** `bundleVersion`/`exportedAt` are optional so a pre-versioning backup restores unedited. */
export type CodexImportBundle = Readonly<{
  codex: unknown;
  exportedAt?: string;
  bundleVersion?: number;
  commandId?: string;
}>;

/** Sends the file's bytes with its own content-type; the server stores them content-addressed. */
export const uploadCodexAsset = (token: string, file: File) =>
  apiRequest<{ asset: Readonly<{ id: string; width: number; height: number }> }>(
    `/api/v1/codex-assets?filename=${encodeURIComponent(file.name)}`,
    {
      token,
      method: "POST",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
      failure: "The image upload failed."
    }
  ).then((data) => data.asset);

/** A Codex image's bytes. Bearer tokens can't ride an `<img src>`, so the caller renders an object URL. */
export const codexAssetContent = (token: string, assetId: string, signal?: AbortSignal) =>
  apiBlob(`/api/v1/codex-assets/${encodeURIComponent(assetId)}/content`, { token, signal });

// ----- Player reads: the same routes, projected by the server for a player token -----

export const playerCodexApi = {
  listPages: (token: string) =>
    request<{ pages: PlayerCodexPageSummary[] }>(token, "/pages").then((data) => data.pages),
  getPage: (token: string, id: string) =>
    request<{ page: PlayerCodexPage; connections: PlayerCodexPageConnection[] }>(token, `/pages/${id}`),
  search: (token: string, query: string) => request<CodexSearchResult>(token, `/search?q=${encodeURIComponent(query)}`),
  /** Already filtered server-side. Never derive the player graph by filtering the GM feed. */
  listConnections: (token: string) =>
    request<{ connections: PlayerCodexConnection[] }>(token, "/connections").then((data) => data.connections),
  listMaps: (token: string) => request<{ maps: PlayerCodexMap[] }>(token, "/maps").then((data) => data.maps),
  listMarkers: (token: string, mapId: string) =>
    request<{ markers: PlayerCodexMarker[] }>(token, `/maps/${mapId}/markers`).then((data) => data.markers),
  /** `null` covers both "no party pin" and "the party pin is hidden from you". */
  party: (token: string) =>
    request<{ party: { marker: PlayerCodexMarker; mapName: string } | null }>(token, "/party").then(
      (data) => data.party
    ),
  /** Revealed journal entries and revealed dated `event` pages, as one list. */
  chronicle: (token: string) =>
    request<{ records: PlayerCodexChronicleRecord[] }>(token, "/timeline").then((data) => data.records),
  sessions: (token: string) =>
    request<{ sessions: PlayerCodexSession[] }>(token, "/sessions").then((data) => data.sessions),
  /** `gmBody` and `rev` stripped; `entityIds` filtered to pages this player can see. */
  quests: (token: string) => request<{ quests: PlayerCodexQuest[] }>(token, "/quests").then((data) => data.quests),
  standing: (token: string) =>
    request<{ standing: PlayerCodexStanding[] }>(token, "/standing").then((data) => data.standing),
  /** `currentDate` here is the published date. Player surfaces must never use `calendarApi.get`, which carries the GM's clock. */
  calendar: (token: string) =>
    request<{ calendar: PlayerCodexCalendar }>(token, "/calendar").then((data) => data.calendar)
};

// ----- Atlas: maps + markers -----

/** On every write, omitting `tags` leaves them alone; `[]` clears them. */
export type CodexMapInput = Readonly<{
  assetId?: string;
  name?: string;
  kind?: CodexMapKind;
  parentMapId?: string | null;
  revealedToPlayers?: boolean;
  tags?: readonly string[];
}>;
export type CodexMarkerInput = Readonly<{
  x?: number;
  y?: number;
  iconId?: string;
  iconColor?: string;
  label?: string | null;
  revealedToPlayers?: boolean;
  pageIds?: string[];
  subMapId?: string | null;
  sceneIds?: string[];
  actorId?: string | null;
  tags?: readonly string[];
}>;

export type MapAsset = Readonly<{ id: string; name: string; kind: CodexMapKind; width: number; height: number }>;

export const atlasApi = {
  /** The shared map-image library (`/api/v1/map-assets`), the same one Scenes uses. */
  listAssets: (token: string) =>
    apiRequest<{ assets: MapAsset[] }>("/api/v1/map-assets", { token, failure: "Could not load your maps." }).then(
      (data) => data.assets
    ),
  uploadAsset: (token: string, file: File) =>
    apiRequest<unknown>(`/api/v1/map-assets?filename=${encodeURIComponent(file.name)}`, {
      token,
      method: "POST",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
      failure: "The upload failed."
    }),
  listMaps: (token: string) => request<{ maps: CodexMap[] }>(token, "/maps").then((data) => data.maps),
  createMap: (token: string, input: CodexMapInput & { assetId: string; name: string; kind: CodexMapKind }) =>
    request<{ map: CodexMap }>(token, "/maps", { method: "POST", body: input }).then((data) => data.map),
  // Narrower than CodexMapInput: the server's MapUpdateSchema is strict.
  updateMap: (token: string, id: string, input: { name?: string; kind?: CodexMapKind; tags?: readonly string[] }) =>
    request<{ map: CodexMap }>(token, `/maps/${id}`, { method: "PATCH", body: input }).then((data) => data.map),
  setMapParent: (token: string, id: string, parentMapId: string | null) =>
    request<{ map: CodexMap }>(token, `/maps/${id}/parent`, {
      method: "POST",
      body: { parentMapId }
    }).then((data) => data.map),
  revealMap: (token: string, id: string, revealed: boolean) =>
    request<{ map: CodexMap }>(token, `/maps/${id}/reveal`, {
      method: "POST",
      body: { revealed }
    }).then((data) => data.map),
  deleteMap: (token: string, id: string) => request<{ deleted: boolean }>(token, `/maps/${id}`, { method: "DELETE" }),
  listMarkers: (token: string, mapId: string) =>
    request<{ markers: CodexMarker[] }>(token, `/maps/${mapId}/markers`).then((data) => data.markers),
  createMarker: (
    token: string,
    mapId: string,
    input: CodexMarkerInput & { x: number; y: number; iconId: string; iconColor: string }
  ) =>
    request<{ marker: CodexMarker }>(token, `/maps/${mapId}/markers`, {
      method: "POST",
      body: input
    }).then((data) => data.marker),
  updateMarker: (token: string, id: string, input: CodexMarkerInput) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}`, { method: "PATCH", body: input }).then(
      (data) => data.marker
    ),
  moveMarker: (token: string, id: string, x: number, y: number) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}/move`, {
      method: "POST",
      body: { x, y }
    }).then((data) => data.marker),
  revealMarker: (token: string, id: string, revealed: boolean) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}/reveal`, {
      method: "POST",
      body: { revealed }
    }).then((data) => data.marker),
  /** Clears any previous party pin server-side, so callers re-read the markers. Move the party with `moveMarker`. */
  setPartyMarker: (token: string, id: string, isParty: boolean) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}/party`, {
      method: "PUT",
      body: { isParty }
    }).then((data) => data.marker),
  deleteMarker: (token: string, id: string) =>
    request<{ deleted: boolean }>(token, `/markers/${id}`, { method: "DELETE" })
};

// ----- Journal -----

export type CodexJournalInput = Readonly<{
  playerText?: string;
  gmText?: string | null;
  revealedToPlayers?: boolean;
  attachMarkerId?: string | null;
  attachPageId?: string | null;
  /** Omitted on create files it under the active session; `null` files it under none. `sessionNumber` is a 400 on writes. */
  sessionId?: string | null;
  realDate?: string | null;
  inWorldLabel?: string | null;
  inWorldDate?: CodexInWorldDate | null;
  tags?: readonly string[];
  commandId?: string;
}>;
/** 400 on non-downtime entries, and `days` is not editable because it is what the clock was moved by. */
export type CodexDowntimeEditInput = Readonly<{ who?: string; activity?: string; characterPageId?: string | null }>;
/** Bounds match the server: `who`/`activity` 120 chars, `days` 0..3650. */
export type CodexDowntimeInput = Readonly<{
  who: string;
  activity: string;
  days: number;
  characterPageId?: string | null;
}>;
export type CodexMilestoneInput = Readonly<{ level: number; reason: string }>;

// ----- Calendar -----

export const calendarApi = {
  /** The GM's clock plus `publishedDate`. Players read the same route via `playerCodexApi.calendar`. */
  get: (token: string) => request<{ calendar: GmCodexCalendar }>(token, "/calendar").then((data) => data.calendar),
  /** The revealed dated records saving this calendar would move in front of players; changes nothing. */
  check: (token: string, calendar: CodexCalendar) =>
    request<{ moves: readonly CodexCalendarMove[] }>(token, "/calendar/check", { method: "POST", body: calendar }).then(
      (data) => data.moves
    ),
  /** Replaces the structure and the GM's clock; it never publishes. */
  set: (token: string, calendar: CodexCalendar) =>
    request<{ calendar: GmCodexCalendar }>(token, "/calendar", { method: "PUT", body: calendar }).then(
      (data) => data.calendar
    ),
  /** Copy the GM's clock onto the players' clock. Nothing else publishes it. */
  publish: (token: string) =>
    request<{ calendar: GmCodexCalendar }>(token, "/calendar/publish", { method: "POST" }).then(
      (data) => data.calendar
    ),
  /** Take the date away from the players until the next publish. */
  unpublish: (token: string) =>
    request<{ calendar: GmCodexCalendar }>(token, "/calendar/unpublish", { method: "POST" }).then(
      (data) => data.calendar
    )
};

export const journalApi = {
  /** Both lenses read this; "by session" regroups the same records. */
  chronicle: (token: string) =>
    request<{ records: CodexChronicleRecord[] }>(token, "/timeline").then((data) => data.records),
  timeline: (token: string) =>
    request<{ entries: CodexJournalEntry[] }>(token, "/journal").then((data) => data.entries),
  forPage: (token: string, pageId: string) =>
    request<{ entries: CodexJournalEntry[] }>(token, `/journal?pageId=${pageId}`).then((data) => data.entries),
  forMarker: (token: string, markerId: string) =>
    request<{ entries: CodexJournalEntry[] }>(token, `/journal?markerId=${markerId}`).then((data) => data.entries),
  create: (token: string, input: CodexJournalInput) =>
    request<{ entry: CodexJournalEntry }>(token, "/journal", { method: "POST", body: input }).then(
      (data) => data.entry
    ),
  /** A deadline's date is when it fires, so `inWorldDate` is required. */
  createDeadline: (token: string, input: CodexJournalInput & { inWorldDate: CodexInWorldDate }) =>
    request<{ entry: CodexJournalEntry }>(token, "/journal/deadline", {
      method: "POST",
      body: input
    }).then((data) => data.entry),
  /** Never moves the clock; returns the proposed date. `applyDowntime` moves it. */
  createDowntime: (token: string, input: CodexJournalInput & { downtime: CodexDowntimeInput }) =>
    request<{ entry: CodexJournalEntry; proposedDate: CodexInWorldDate | null }>(token, "/journal/downtime", {
      method: "POST",
      body: input
    }),
  /** Undated is fine: the store dates it at the GM's clock. */
  createMilestone: (token: string, input: CodexJournalInput & { milestone: CodexMilestoneInput }) =>
    request<{ entry: CodexJournalEntry }>(token, "/journal/milestone", {
      method: "POST",
      body: input
    }).then((data) => data.entry),
  /** Marks the downtime applied and advances the clock in one transaction; applying twice is rejected. */
  applyDowntime: (token: string, id: string) =>
    request<{ entry: CodexJournalEntry; calendar: GmCodexCalendar }>(token, `/journal/${id}/apply-downtime`, {
      method: "POST"
    }),
  update: (token: string, id: string, input: CodexJournalInput & { downtime?: CodexDowntimeEditInput }) =>
    request<{ entry: CodexJournalEntry }>(token, `/journal/${id}`, {
      method: "PATCH",
      body: input
    }).then((data) => data.entry),
  reveal: (token: string, id: string, revealed: boolean) =>
    request<{ entry: CodexJournalEntry }>(token, `/journal/${id}/reveal`, {
      method: "POST",
      body: { revealed }
    }).then((data) => data.entry),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/journal/${id}`, { method: "DELETE" })
};

// ----- Sessions (prep is the GM half, recap is the player half) -----

/** Create and update schemas are strict and differ, so each call site adds its one extra key. Reveal is its own route. */
export type CodexSessionInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  status?: CodexSessionStatus;
  /** Slug-normalized server-side. */
  tags?: readonly string[];
  commandId?: string;
}>;

export const sessionApi = {
  /** Fetched together so the active pointer always names a row in the list. Players always get `null`. */
  list: (token: string) => request<{ sessions: CodexSession[]; activeSessionId: string | null }>(token, "/sessions"),
  get: (token: string, id: string) =>
    request<{ session: CodexSession }>(token, `/sessions/${id}`).then((data) => data.session),
  create: (token: string, input: CodexSessionInput & { revealedToPlayers?: boolean }) =>
    request<{ session: CodexSession }>(token, "/sessions", { method: "POST", body: input }).then(
      (data) => data.session
    ),
  update: (token: string, id: string, input: CodexSessionInput & { expectedRev?: number }) =>
    request<{ session: CodexSession }>(token, `/sessions/${id}`, { method: "PATCH", body: input }).then(
      (data) => data.session
    ),
  reveal: (token: string, id: string, revealed: boolean) =>
    request<{ session: CodexSession }>(token, `/sessions/${id}/reveal`, {
      method: "POST",
      body: { revealed }
    }).then((data) => data.session),
  /** Activation does not change the session row, so only the pointer returns. */
  activate: (token: string, id: string) =>
    request<{ activeSessionId: string | null }>(token, `/sessions/${id}/activate`, { method: "POST" }).then(
      (data) => data.activeSessionId
    ),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/sessions/${id}`, { method: "DELETE" })
};

// ----- Quests -----

/** Same split as `CodexSessionInput`. */
export type CodexQuestInput = Readonly<{
  title?: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  gmBody?: string;
  objectives?: readonly CodexQuestObjective[];
  entityIds?: readonly string[];
  /** Slug-normalized server-side. */
  tags?: readonly string[];
  commandId?: string;
}>;
export const questApi = {
  list: (token: string) => request<{ quests: CodexQuest[] }>(token, "/quests").then((data) => data.quests),
  get: (token: string, id: string) => request<{ quest: CodexQuest }>(token, `/quests/${id}`).then((data) => data.quest),
  create: (token: string, input: CodexQuestInput & { title: string; revealedToPlayers?: boolean }) =>
    request<{ quest: CodexQuest }>(token, "/quests", { method: "POST", body: input }).then((data) => data.quest),
  update: (token: string, id: string, input: CodexQuestInput & { expectedRev?: number }) =>
    request<{ quest: CodexQuest }>(token, `/quests/${id}`, { method: "PATCH", body: input }).then((data) => data.quest),
  reveal: (token: string, id: string, revealed: boolean) =>
    request<{ quest: CodexQuest }>(token, `/quests/${id}/reveal`, {
      method: "POST",
      body: { revealed }
    }).then((data) => data.quest),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/quests/${id}`, { method: "DELETE" })
};

// ----- Faction standing -----

export const standingApi = {
  list: (token: string) => request<{ standing: CodexStanding[] }>(token, "/standing").then((data) => data.standing),
  /** `value` is absolute; the server computes the delta and writes the chronicle record in the same transaction. */
  set: (token: string, factionPageId: string, value: number, reason: string) =>
    request<{ standing: CodexStanding }>(token, `/standing/${factionPageId}`, {
      method: "PUT",
      body: { value, reason }
    }).then((data) => data.standing),
  reveal: (token: string, factionPageId: string, revealed: boolean) =>
    request<{ standing: CodexStanding }>(token, `/standing/${factionPageId}/reveal`, {
      method: "POST",
      body: { revealed }
    }).then((data) => data.standing)
};

// ----- The reveal audit -----

export const revealAuditApi = {
  get: (token: string) => request<{ audit: CodexRevealAudit }>(token, "/reveal-audit").then((data) => data.audit)
};
