/** Bearer-authorized fetch helpers for `/api/v1/codex/*`. The server projects every response by role (`codex-projections.ts`). */

import { type EntityType } from "./entities";

export type CodexPageSummary = Readonly<{
  id: string;
  title: string;
  entityType: EntityType;
  fields: Readonly<Record<string, string>>;
  folder: string | null;
  tags: readonly string[];
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  /** `inWorldDate` is what the GM typed and is the source of truth; the label and instant are derived server-side. */
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexPage = CodexPageSummary &
  Readonly<{ playerBody: string; gmBody: string; gmFields: Readonly<Record<string, string>> }>;

// ----- Connections (typed relationships and [[wiki-links]] are one system) -----

/** Every connection points into a page, so there is no `toKind`. */
export type CodexConnectionSourceKind = "page" | "session" | "quest" | "journal";
export type CodexConnectionOrigin = "declared" | "mention";
/** A GM-layer edge never travels to a player. */
export type CodexConnectionLayer = "player" | "gm";

/** GM view. `id` is null exactly when `origin === "mention"`: a derived edge is edited through its source text. */
export type CodexPageConnection = Readonly<{
  id: string | null;
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  otherTitle: string;
  otherEntityType: EntityType | null;
  otherRevealed: boolean;
  label: string | null;
  origin: CodexConnectionOrigin;
  layer: CodexConnectionLayer;
  section: string | null;
}>;
/** Player view: players only receive connections to records they can see. */
export type PlayerCodexPageConnection = Readonly<{
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  otherTitle: string;
  otherEntityType: EntityType | null;
  label: string | null;
  origin: CodexConnectionOrigin;
  section: string | null;
}>;
export type CodexConnection = Readonly<{
  id: string | null;
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  label: string | null;
  origin: CodexConnectionOrigin;
  layer: CodexConnectionLayer;
  createdAt: string | null;
}>;
export type PlayerCodexConnection = Readonly<{
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  label: string | null;
  origin: CodexConnectionOrigin;
}>;
/** Restated from the server so an input can refuse rather than earn a 400. */
export const CONNECTION_LABEL_MAX = 40;
export type CodexPageRevision = Readonly<{
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

/** `enabled: false` stops new revisions but keeps old ones; `windowMinutes: 0` keeps every save. */
export type CodexRevisionHistorySettings = Readonly<{ enabled: boolean; windowMinutes: number }>;
/** A preference only; the editor's `autosave.ts` does the work. Stored server-side so it follows the GM across devices. */
export type CodexAutosaveSettings = Readonly<{ enabled: boolean; intervalSeconds: number }>;
export const AUTOSAVE_INTERVAL_MIN = 1;
export const AUTOSAVE_INTERVAL_MAX = 600;
/** Any other stored value renders as a "custom" option. */
export const AUTOSAVE_INTERVAL_CHOICES: readonly number[] = [1, 10, 60, 300];
export const AUTOSAVE_DEFAULT: CodexAutosaveSettings = { enabled: true, intervalSeconds: 1 };
/** `versionCount`/`versionBytes` are server-computed and read-only; `versionBytes` is approximate, not disk usage. */
export type CodexSettings = Readonly<{
  revisionHistory: CodexRevisionHistorySettings & Readonly<{ versionCount: number; versionBytes: number }>;
  autosave: CodexAutosaveSettings;
}>;
/** The PUT is wholesale: both groups are required. */
export type CodexSettingsInput = Readonly<{
  revisionHistory: CodexRevisionHistorySettings;
  autosave: CodexAutosaveSettings;
}>;
/** Server-enforced bounds. The server also truncates fractions, so display what it answers. */
export const REVISION_WINDOW_MIN = 0;
export const REVISION_WINDOW_MAX = 10_080;

// ----- Suite-wide search -----

/** Mirrors the server's `CodexRecordKind`. A session hit's `title` is built server-side. */
export type CodexRecordKind = "page" | "journal" | "map" | "marker" | "quest" | "session";
/**
 * Mirrors `CodexSearchHit` in `codex-projections.ts`; every key is present on every kind. A player's hits
 * are projected server-side, so the client never filters visibility itself.
 */
export type CodexSearchHit = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  /** Pages only. */
  entityType: EntityType | null;
  /** Markers only: lets a marker hit open its map before selecting the pin. */
  mapId: string | null;
}>;

/** The codex is unpaginated; `truncated` means "narrow the search". */
export type CodexSearchResult = Readonly<{ hits: readonly CodexSearchHit[]; truncated: boolean }>;
export const SEARCH_HIT_CAP = 50;

export type CodexPageInput = Readonly<{
  title?: string;
  entityType?: EntityType;
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

export class CodexRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string
  ) {
    super(message);
  }
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new CodexRequestError(
      body?.error?.message ?? `The codex request failed (${response.status}).`,
      response.status,
      body?.error?.code ?? "error"
    );
  }
  return body.data as T;
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
      body: JSON.stringify(input)
    }).then((data) => data.connection),
  /** Mentions have no id and are not patchable. */
  updateConnection: (
    token: string,
    id: string,
    input: Readonly<{ label?: string | null; layer?: CodexConnectionLayer; commandId?: string }>
  ) =>
    request<{ connection: CodexConnection }>(token, `/connections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
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
    request<{ page: CodexPage }>(token, "/pages", { method: "POST", body: JSON.stringify(input) }).then(
      (data) => data.page
    ),
  updatePage: (token: string, id: string, input: CodexPageInput) =>
    request<{ page: CodexPage }>(token, `/pages/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then(
      (data) => data.page
    ),
  revealPage: (token: string, id: string, revealed: boolean) =>
    request<{ page: CodexPage }>(token, `/pages/${id}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed })
    }).then((data) => data.page),
  deletePage: (token: string, id: string) => request<{ deleted: boolean }>(token, `/pages/${id}`, { method: "DELETE" }),
  moveFolder: (token: string, from: string, to: string) =>
    request<{ moved: number }>(token, "/folders/move", { method: "POST", body: JSON.stringify({ from, to }) }).then(
      (data) => data.moved
    ),
  listFolders: (token: string) => request<{ folders: string[] }>(token, "/folders").then((data) => data.folders),
  createFolder: (token: string, path: string) =>
    request<{ path: string }>(token, "/folders", { method: "POST", body: JSON.stringify({ path }) }).then(
      (data) => data.path
    ),
  deleteFolder: (token: string, path: string) =>
    request<{ deleted: boolean }>(token, "/folders/delete", { method: "POST", body: JSON.stringify({ path }) }),
  listRevisions: (token: string, id: string) =>
    request<{ revisions: CodexPageRevision[] }>(token, `/pages/${id}/revisions`).then((data) => data.revisions),
  restoreRevision: (token: string, id: string, revisionId: number) =>
    request<{ page: CodexPage }>(token, `/pages/${id}/revisions/${revisionId}/restore`, { method: "POST" }).then(
      (data) => data.page
    ),
  getSettings: (token: string) =>
    request<{ settings: CodexSettings }>(token, "/settings").then((data) => data.settings),
  setSettings: (token: string, input: CodexSettingsInput) =>
    request<{ settings: CodexSettings }>(token, "/settings", { method: "PUT", body: JSON.stringify(input) }).then(
      (data) => data.settings
    ),
  /** Destructive and irreversible. `olderThanDays: 0` deletes every version; current pages are untouched. */
  deleteRevisions: (token: string, olderThanDays: number) =>
    request<{ deleted: number }>(token, "/page-revisions", {
      method: "DELETE",
      body: JSON.stringify({ olderThanDays })
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
      body: JSON.stringify(bundle)
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
export type CodexImportCounts = Readonly<{
  pages: number;
  folders: number;
  maps: number;
  markers: number;
  journal: number;
  /** Declared connections only; mentions are rebuilt from body text. */
  connections: number;
  sessions: number;
  quests: number;
  standing: number;
  revisions: number;
}>;

/** A page title reduced to a stable [[wiki-link]] key (must match the server's `pageLinkKey`). */
export function pageLinkKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Sends raw bytes with the file's content-type (not JSON, so express.raw handles it). */
export async function uploadCodexAsset(
  token: string,
  file: File
): Promise<{ id: string; width: number; height: number }> {
  const response = await fetch(`/api/v1/codex-assets?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": file.type || "application/octet-stream" },
    body: file
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok)
    throw new CodexRequestError(
      body?.error?.message ?? "The image upload failed.",
      response.status,
      body?.error?.code ?? "error"
    );
  return body.data.asset as { id: string; width: number; height: number };
}

// ----- Player-facing projections (same endpoints, stripped by the server for a player token) -----

export type PlayerCodexPageSummary = Readonly<{
  id: string;
  title: string;
  entityType: EntityType;
  folder: string | null;
  tags: readonly string[];
  bannerAssetId: string | null;
  updatedAt: string;
}>;
export type PlayerCodexPage = PlayerCodexPageSummary &
  Readonly<{ fields: Readonly<Record<string, string>>; body: string }>;
export type PlayerCodexMap = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: "battlemap" | "regional" | "world";
  parentMapId: string | null;
  tags: readonly string[];
}>;
export type PlayerCodexMarker = Readonly<{
  id: string;
  mapId: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  pageIds: string[];
  subMapId: string | null;
  isParty: boolean;
  tags: readonly string[];
}>;
export type PlayerCodexJournalEntry = Readonly<{
  id: string;
  text: string;
  kind: CodexJournalKind;
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  tags: readonly string[];
  createdAt: string;
}>;
/** No `prepBody`, `rev`, `status` or `attendees`; `recapBody` arrives as `recap`. */
export type PlayerCodexSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  realDate: string | null;
  recap: string;
  tags: readonly string[];
}>;

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
  calendar: (token: string) => request<{ calendar: CodexCalendar }>(token, "/calendar").then((data) => data.calendar)
};

// ----- Atlas: maps + markers -----

export type CodexMapKind = "battlemap" | "regional" | "world";
/** Tags follow the page-tag slug rules; the server rejects a non-slug, so editors keep `TagInput`'s slugify normalizer. */
export type CodexMap = Readonly<{
  id: string;
  assetId: string;
  name: string;
  kind: CodexMapKind;
  parentMapId: string | null;
  revealedToPlayers: boolean;
  sortKey: number;
  tags: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
export type CodexMarker = Readonly<{
  id: string;
  mapId: string;
  x: number;
  y: number;
  iconId: string;
  iconColor: string;
  label: string | null;
  revealedToPlayers: boolean;
  pageIds: string[];
  subMapId: string | null;
  sceneIds: string[];
  actorId: string | null;
  /** At most one party pin per atlas; the server clears the previous one. Does not change the pin's reveal gate. */
  isParty: boolean;
  tags: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
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
  listAssets: async (token: string): Promise<MapAsset[]> => {
    const response = await fetch("/api/v1/map-assets", { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok)
      throw new CodexRequestError(
        body?.error?.message ?? "Could not load your maps.",
        response.status,
        body?.error?.code ?? "error"
      );
    return body.data.assets as MapAsset[];
  },
  listMaps: (token: string) => request<{ maps: CodexMap[] }>(token, "/maps").then((data) => data.maps),
  createMap: (token: string, input: CodexMapInput & { assetId: string; name: string; kind: CodexMapKind }) =>
    request<{ map: CodexMap }>(token, "/maps", { method: "POST", body: JSON.stringify(input) }).then(
      (data) => data.map
    ),
  // Narrower than CodexMapInput: the server's MapUpdateSchema is strict.
  updateMap: (token: string, id: string, input: { name?: string; kind?: CodexMapKind; tags?: readonly string[] }) =>
    request<{ map: CodexMap }>(token, `/maps/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then(
      (data) => data.map
    ),
  setMapParent: (token: string, id: string, parentMapId: string | null) =>
    request<{ map: CodexMap }>(token, `/maps/${id}/parent`, {
      method: "POST",
      body: JSON.stringify({ parentMapId })
    }).then((data) => data.map),
  revealMap: (token: string, id: string, revealed: boolean) =>
    request<{ map: CodexMap }>(token, `/maps/${id}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed })
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
      body: JSON.stringify(input)
    }).then((data) => data.marker),
  updateMarker: (token: string, id: string, input: CodexMarkerInput) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then(
      (data) => data.marker
    ),
  moveMarker: (token: string, id: string, x: number, y: number) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ x, y })
    }).then((data) => data.marker),
  revealMarker: (token: string, id: string, revealed: boolean) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed })
    }).then((data) => data.marker),
  /** Clears any previous party pin server-side, so callers re-read the markers. Move the party with `moveMarker`. */
  setPartyMarker: (token: string, id: string, isParty: boolean) =>
    request<{ marker: CodexMarker }>(token, `/markers/${id}/party`, {
      method: "PUT",
      body: JSON.stringify({ isParty })
    }).then((data) => data.marker),
  deleteMarker: (token: string, id: string) =>
    request<{ deleted: boolean }>(token, `/markers/${id}`, { method: "DELETE" })
};

// ----- Journal / timeline -----

/** All kinds are ordinary journal rows discriminated for display. Mirrors the server's `CodexJournalKind`. */
export type CodexJournalKind = "note" | "combat" | "deadline" | "downtime" | "milestone" | "standing" | "quest";
/** `applied` (has the GM confirmed the clock move?) is GM workflow state, dropped from the player projection. */
export type CodexDowntimeSummary = Readonly<{
  who: string;
  activity: string;
  days: number;
  /** Always present. `who` is the display fallback when the page is gone or unrevealed. */
  characterPageId: string | null;
}>;
export type CodexDowntimePayload = CodexDowntimeSummary & Readonly<{ applied: boolean }>;
/** The level reached and why. No XP arithmetic by design. */
export type CodexMilestonePayload = Readonly<{ level: number; reason: string }>;
/** `delta` is the change, not the new value; `codex_standing` holds current values. */
export type CodexStandingPayload = Readonly<{ factionPageId: string; delta: number; reason: string }>;
/** The server nulls `factionPageId` when the faction's page is unrevealed, so the id never advertises a secret. */
export type PlayerCodexStandingPayload = Readonly<{ factionPageId: string | null; delta: number; reason: string }>;
/** What `standingOf` returns; callers must handle a null faction id. */
export type CodexStandingChange = PlayerCodexStandingPayload;
/** Written by the server on quest create and status change. `questId` is nulled for players until the quest is revealed. */
export type CodexQuestEventPayload = Readonly<{ questId: string; status: CodexQuestStatus }>;
export type PlayerCodexQuestEventPayload = Readonly<{ questId: string | null; status: CodexQuestStatus }>;
/** Read it through `chronicle.ts`'s kind-gated helpers (`downtimeOf`, `milestoneOf`, `standingOf`). */
export type CodexJournalPayload =
  CodexDowntimePayload | CodexMilestonePayload | CodexStandingPayload | CodexQuestEventPayload;
export type CodexJournalEntry = Readonly<{
  id: string;
  playerText: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  attachMarkerId: string | null;
  attachPageId: string | null;
  kind: CodexJournalKind;
  sourceEncounterId: number | null;
  /**
   * `sessionNumber` is resolved live by the server and never written. `sessionId: null` with a number is
   * expected (a deleted, previously revealed session); render the number without a link.
   */
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  payload: CodexJournalPayload | null;
  sortKey: number;
  tags: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
export type CodexInWorldDate = Readonly<{ year: number; month: number; day: number }>;
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

// ----- Calendar (the world's own months / weekdays / eras) -----
export type CodexCalendarMonth = Readonly<{ name: string; days: number }>;
/** Runs from `startYear` until the next era. Derived from a date's year, never stored on it. */
export type CodexCalendarEra = Readonly<{ name: string; startYear: number }>;
export type CodexCalendar = Readonly<{
  yearName: string;
  eras?: readonly CodexCalendarEra[];
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  currentDate?: CodexInWorldDate | null;
}>;
/**
 * The calendar as the GM reads it. `currentDate` is the GM's clock; `publishedDate` is what players see as
 * their `currentDate`. Separate from `CodexCalendar` because that is the strict PUT body.
 */
export type GmCodexCalendar = CodexCalendar & Readonly<{ publishedDate: CodexInWorldDate | null }>;
export function calendarDaysPerYear(calendar: CodexCalendar): number {
  return calendar.months.reduce((sum, month) => sum + month.days, 0);
}
/**
 * Inverse of `instantToDate`. Clamps the day into its month at both ends, matching the server's
 * `calendarInstantOf`. Prefer a server-computed `calendarInstant` wherever one exists.
 */
export function dateToInstant(calendar: CodexCalendar, date: CodexInWorldDate): number {
  const monthIdx = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  let dayOfYear = 0;
  for (let i = 0; i < monthIdx; i += 1) dayOfYear += calendar.months[i].days;
  const daysInMonth = calendar.months[monthIdx]?.days ?? 1;
  const day = Math.min(Math.max(1, Math.trunc(date.day)), Math.max(1, daysInMonth));
  return Math.trunc(date.year) * (calendarDaysPerYear(calendar) || 1) + dayOfYear + (day - 1);
}
export function calendarYearOf(calendar: CodexCalendar, instant: number): number {
  const perYear = calendarDaysPerYear(calendar) || 1;
  return Math.floor(instant / perYear);
}
/** Mirrors the server's `eraForYear`; eras arrive sorted ascending. */
export function eraForYear(calendar: CodexCalendar, year: number): CodexCalendarEra | null {
  let found: CodexCalendarEra | null = null;
  for (const era of calendar.eras ?? []) {
    if (Math.trunc(year) >= era.startYear) found = era;
    else break;
  }
  return found;
}
/** "Third Age 1492 DR": era leading, `yearName` trailing. Must match the server's `formatWorldYear`. */
export function formatWorldYear(calendar: CodexCalendar, year: number): string {
  const era = eraForYear(calendar, year);
  return `${era ? `${era.name} ` : ""}${year}${calendar.yearName ? ` ${calendar.yearName}` : ""}`;
}
export function formatWorldDate(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const month = calendar.months[Math.max(0, Math.min(date.month, calendar.months.length - 1))];
  return `${month?.name ?? ""} ${date.day}, ${formatWorldYear(calendar, date.year)}`;
}
export function instantToDate(calendar: CodexCalendar, instant: number): CodexInWorldDate {
  const perYear = calendarDaysPerYear(calendar) || 1;
  const year = Math.floor(instant / perYear);
  let remainder = instant - year * perYear;
  let month = 0;
  while (month < calendar.months.length - 1 && remainder >= calendar.months[month].days) {
    remainder -= calendar.months[month].days;
    month += 1;
  }
  return { year, month, day: remainder + 1 };
}
export const calendarApi = {
  /** The GM's clock plus `publishedDate`. Players read the same route via `playerCodexApi.calendar`. */
  get: (token: string) => request<{ calendar: GmCodexCalendar }>(token, "/calendar").then((data) => data.calendar),
  /** Never the published date; see `GmCodexCalendar`. */
  set: (token: string, calendar: CodexCalendar) =>
    request<{ calendar: CodexCalendar }>(token, "/calendar", { method: "PUT", body: JSON.stringify(calendar) }).then(
      (data) => data.calendar
    ),
  /** Copy the GM's clock onto the players' clock. Nothing else publishes it. */
  publish: (token: string) =>
    request<{ calendar: GmCodexCalendar }>(token, "/calendar/publish", { method: "POST" }).then((data) => data.calendar)
};

// ----- The chronicle (journal entries plus dated `event` pages) -----

/** `combat` is a journal entry discriminated for display. */
export type CodexChronicleKind =
  "entry" | "combat" | "event" | "deadline" | "downtime" | "milestone" | "standing" | "quest";

/**
 * GM view; mirrors `GmCodexChronicleRecord` in `codex-projections.ts`. `id` is a journal-entry id, or a
 * page id for `event` rows. For an event, `text`/`gmText` are bounded excerpts of the page's bodies.
 */
export type CodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  gmText: string | null;
  revealedToPlayers: boolean;
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
  /** Read through `chronicle.ts`'s kind-gated helpers. */
  payload: CodexJournalPayload | null;
  /** Derived server-side, so rewinding the clock un-fires a deadline. Read it through `deadlineFired`. */
  fired: boolean;
  /** Where applying this downtime would put the clock, per the server. Null once applied. */
  proposedDate: CodexInWorldDate | null;
  createdAt: string;
  updatedAt: string;
}>;

/** Downtime arrives without `applied`, and a standing change has a nullable `factionPageId`. */
export type CodexPlayerChroniclePayload =
  CodexDowntimeSummary | CodexMilestonePayload | PlayerCodexStandingPayload | PlayerCodexQuestEventPayload;

/** Player view (`projectPlayerChronicleRecord`); already filtered server-side. */
export type PlayerCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  /** Nulled together with `sessionNumber` when the session is unrevealed. */
  sessionId: string | null;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  /** Use `calendarInstant` for placement and sorting; never re-derive it client-side. */
  inWorldDate: CodexInWorldDate | null;
  calendarInstant: number | null;
  tags: readonly string[];
  payload: CodexPlayerChroniclePayload | null;
  fired: boolean;
  createdAt: string;
}>;

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
    request<{ entry: CodexJournalEntry }>(token, "/journal", { method: "POST", body: JSON.stringify(input) }).then(
      (data) => data.entry
    ),
  /** A deadline's date is when it fires, so `inWorldDate` is required. */
  createDeadline: (token: string, input: CodexJournalInput & { inWorldDate: CodexInWorldDate }) =>
    request<{ entry: CodexJournalEntry }>(token, "/journal/deadline", {
      method: "POST",
      body: JSON.stringify(input)
    }).then((data) => data.entry),
  /** Never moves the clock; returns the proposed date. `applyDowntime` moves it. */
  createDowntime: (token: string, input: CodexJournalInput & { downtime: CodexDowntimeInput }) =>
    request<{ entry: CodexJournalEntry; proposedDate: CodexInWorldDate | null }>(token, "/journal/downtime", {
      method: "POST",
      body: JSON.stringify(input)
    }),
  /** Undated is fine: the store dates it at the GM's clock. */
  createMilestone: (token: string, input: CodexJournalInput & { milestone: CodexMilestoneInput }) =>
    request<{ entry: CodexJournalEntry }>(token, "/journal/milestone", {
      method: "POST",
      body: JSON.stringify(input)
    }).then((data) => data.entry),
  /** Marks the downtime applied and advances the clock in one transaction; applying twice is rejected. */
  applyDowntime: (token: string, id: string) =>
    request<{ entry: CodexJournalEntry; calendar: CodexCalendar }>(token, `/journal/${id}/apply-downtime`, {
      method: "POST"
    }),
  update: (token: string, id: string, input: CodexJournalInput & { downtime?: CodexDowntimeEditInput }) =>
    request<{ entry: CodexJournalEntry }>(token, `/journal/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }).then((data) => data.entry),
  reveal: (token: string, id: string, revealed: boolean) =>
    request<{ entry: CodexJournalEntry }>(token, `/journal/${id}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed })
    }).then((data) => data.entry),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/journal/${id}`, { method: "DELETE" })
};

// ----- Sessions (prep is the GM half, recap is the player half) -----

export type CodexSessionStatus = "planned" | "played";
/** Mirrors `CodexSessionRow`. `prepBody` never leaves the GM projection; `rev` is the optimistic-concurrency token. */
export type CodexSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  /** Real-world date, free text. */
  realDate: string | null;
  attendees: readonly string[];
  prepBody: string;
  recapBody: string;
  revealedToPlayers: boolean;
  status: CodexSessionStatus;
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
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
    request<{ session: CodexSession }>(token, "/sessions", { method: "POST", body: JSON.stringify(input) }).then(
      (data) => data.session
    ),
  update: (token: string, id: string, input: CodexSessionInput & { expectedRev?: number }) =>
    request<{ session: CodexSession }>(token, `/sessions/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then(
      (data) => data.session
    ),
  reveal: (token: string, id: string, revealed: boolean) =>
    request<{ session: CodexSession }>(token, `/sessions/${id}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed })
    }).then((data) => data.session),
  /** Activation does not change the session row, so only the pointer returns. */
  activate: (token: string, id: string) =>
    request<{ activeSessionId: string | null }>(token, `/sessions/${id}/activate`, { method: "POST" }).then(
      (data) => data.activeSessionId
    ),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/sessions/${id}`, { method: "DELETE" })
};

// ----- Quests -----

/** Lifecycle order. `not-started` and `active` are open; the rest are done. */
export type CodexQuestStatus = "not-started" | "active" | "completed" | "failed" | "canceled";
/** A blank `text` is a legitimate transient state (add a row, then type), so never strip blank rows before sending. */
export type CodexQuestObjective = Readonly<{ text: string; done: boolean }>;
/**
 * Mirrors `CodexQuestRow`. `gmBody` never leaves the GM projection. `objectives` order is content and is
 * sent back exactly as rendered. `entityIds` are filtered to revealed pages for players.
 */
export type CodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  playerBody: string;
  gmBody: string;
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
  revealedToPlayers: boolean;
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
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
/** `gmBody` and `rev` stripped, `playerBody` arrives as `body`. Unlike a session, `status` is player-visible. */
export type PlayerCodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  body: string;
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
  tags: readonly string[];
}>;

export const questApi = {
  list: (token: string) => request<{ quests: CodexQuest[] }>(token, "/quests").then((data) => data.quests),
  get: (token: string, id: string) => request<{ quest: CodexQuest }>(token, `/quests/${id}`).then((data) => data.quest),
  create: (token: string, input: CodexQuestInput & { title: string; revealedToPlayers?: boolean }) =>
    request<{ quest: CodexQuest }>(token, "/quests", { method: "POST", body: JSON.stringify(input) }).then(
      (data) => data.quest
    ),
  update: (token: string, id: string, input: CodexQuestInput & { expectedRev?: number }) =>
    request<{ quest: CodexQuest }>(token, `/quests/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then(
      (data) => data.quest
    ),
  reveal: (token: string, id: string, revealed: boolean) =>
    request<{ quest: CodexQuest }>(token, `/quests/${id}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed })
    }).then((data) => data.quest),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/quests/${id}`, { method: "DELETE" })
};

// ----- Faction standing -----

/** Keyed by `factionPageId` (unique). `value` is -100..+100. History lives in `kind='standing'` chronicle records. */
export type CodexStanding = Readonly<{
  id: string;
  factionPageId: string;
  value: number;
  revealedToPlayers: boolean;
  createdAt: string;
  updatedAt: string;
}>;
export type PlayerCodexStanding = Readonly<{ factionPageId: string; value: number }>;

export const standingApi = {
  list: (token: string) => request<{ standing: CodexStanding[] }>(token, "/standing").then((data) => data.standing),
  /** `value` is absolute; the server computes the delta and writes the chronicle record in the same transaction. */
  set: (token: string, factionPageId: string, value: number, reason: string) =>
    request<{ standing: CodexStanding }>(token, `/standing/${factionPageId}`, {
      method: "PUT",
      body: JSON.stringify({ value, reason })
    }).then((data) => data.standing),
  reveal: (token: string, factionPageId: string, revealed: boolean) =>
    request<{ standing: CodexStanding }>(token, `/standing/${factionPageId}/reveal`, {
      method: "POST",
      body: JSON.stringify({ revealed })
    }).then((data) => data.standing)
};

// ----- The reveal audit -----

export type CodexRevealAuditKind = "page" | "map" | "marker" | "journal" | "session" | "quest" | "standing";

/** `id` is what the record's reveal route takes, which for `standing` is the faction page id. */
export type CodexRevealAuditRow = Readonly<{
  kind: CodexRevealAuditKind;
  id: string;
  title: string;
  /** Set on `journal` rows only. Render as a badge; `title` is the record's prose and can't identify the kind. */
  journalKind: CodexJournalKind | null;
}>;

/** `revealed` counts what the player projections emit, not reveal flags (a revealed pin on a hidden map is not visible). */
export type CodexRevealAuditSection = Readonly<{
  kind: CodexRevealAuditKind;
  revealed: number;
  total: number;
  rows: readonly CodexRevealAuditRow[];
}>;

/**
 * GM-only and read-only, built from the existing player projections. All sections are always present, so a
 * missing one is malformed, not empty. Codex records only; table visibility is separate.
 */
export type CodexRevealAudit = Readonly<{
  sections: readonly CodexRevealAuditSection[];
  /** The server's totals; summing sections under-counts if one is missing. */
  revealed: number;
  total: number;
}>;

export const revealAuditApi = {
  get: (token: string) => request<{ audit: CodexRevealAudit }>(token, "/reveal-audit").then((data) => data.audit)
};
