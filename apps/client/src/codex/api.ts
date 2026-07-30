/**
 * Bearer-authorized fetch helpers for the codex REST surface (`/api/v1/codex/*`). These mirror the
 * server's GM projections (`codex-projections.ts`); the client never sees a player projection here
 * because this module is used only from the GM Codex workspace. Player-facing reads (the Atlas) will
 * use the same routes with a player token and receive the stripped shapes.
 */

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
  /**
   * CT-11 dating — the SAME contract journal entries use. `inWorldDate` is the raw date the GM typed and
   * is the source of truth; `inWorldLabel` and `calendarInstant` are DERIVED server-side and recomputed
   * for every dated record whenever the calendar changes. Edit from `inWorldDate`, never from the label.
   * Only a dated `event` page appears on the chronicle; the fields exist on every page so switching a
   * page's type away and back loses nothing.
   */
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexPage = CodexPageSummary & Readonly<{ playerBody: string; gmBody: string; gmFields: Readonly<Record<string, string>> }>;
export type CodexBacklink = Readonly<{ sourcePageId: string; sourceTitle: string; section: string | null }>;
/** A relationship as listed against one page: the OTHER endpoint resolved, plus which way the edge points. */
export type CodexRelationship = Readonly<{ id: string; type: string; direction: "out" | "in"; otherPageId: string; otherTitle: string; otherType: EntityType; otherRevealed: boolean }>;
export type CodexRelationshipEdge = Readonly<{ id: string; fromPageId: string; toPageId: string; type: string; createdAt: string }>;
/**
 * CI-8: one `[[wiki link]]` edge between two pages — the Graph's SECOND edge kind, beside the typed
 * relationships above. Mirrors the server's `CodexLinkEdge` (`codex-projections.ts`) exactly, including
 * its deliberate narrowness: endpoints and nothing else. A wiki-link has no type, no author and no id of
 * its own — it is a fact derived from a body, not a stored record — so there is nothing else to carry,
 * and the same pair written twice is the same edge.
 */
export type CodexLinkEdge = Readonly<{ fromPageId: string; toPageId: string }>;
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

/**
 * OWNER DECISION (2026-07-30) — how much version history the codex keeps.
 *
 * Every page save used to write a revision row, nothing ever pruned the table, and a revision row weighs
 * the same as a page row (both bodies). Measured while completing the export bundle: 200 pages × 15
 * revisions exported 20.8 MB against 1.24 MB without the history. So the GM gets two knobs.
 *
 *  - `enabled: false` writes no new revisions at all. It does **not** delete what exists — disabling a
 *    feature must not destroy the GM's only undo — so old revisions stay listable and restorable.
 *  - `windowMinutes` coalesces: a save within this long of the last checkpoint does not write one. **`0`
 *    means every save is kept** (the old behaviour) and is deliberately NOT the same as `enabled: false`.
 *    The owner's default is 90, chosen so at most 90 minutes of work can be lost.
 *
 * Nested under `revisionHistory` on purpose: `codex_meta` is the codex's settings row, so this gives later
 * codex-wide settings a home without inventing fields for them today.
 */
export type CodexRevisionHistorySettings = Readonly<{ enabled: boolean; windowMinutes: number }>;
/**
 * What the GM READS: the two settings plus what the history currently costs. The usage figures are
 * server-computed and read-only, which is why they are not on `CodexSettingsInput` below — a client that
 * could send them could disagree with the table they describe.
 *
 * `versionBytes` is the summed LENGTH of the stored bodies, not disk usage. Named and rendered as
 * approximate on purpose: it exists to answer "is my history worth trimming?", and a figure precise enough
 * to invite comparison against the sqlite file's size would be a figure that disagrees with it.
 */
export type CodexSettings = Readonly<{ revisionHistory: CodexRevisionHistorySettings & Readonly<{ versionCount: number; versionBytes: number }> }>;
/** What the GM WRITES. Deliberately narrower than the read: the usage figures are the server's to report. */
export type CodexSettingsInput = Readonly<{ revisionHistory: CodexRevisionHistorySettings }>;
/** Bounds the server clamps to, restated so a control can refuse a value rather than hand back a 400. */
export const REVISION_WINDOW_MIN = 0;
export const REVISION_WINDOW_MAX = 10_080;

// ----- Suite-wide search (CI-1 / R8: one index, one result list, every record kind) -----

/** The five things the codex indexes. Mirrors the server's `CodexRecordKind` (`codex-store.ts`). */
export type CodexRecordKind = "page" | "journal" | "map" | "marker" | "quest";
/**
 * One row of the single result list, discriminated by `kind`. Mirrors `CodexSearchHit` in
 * `apps/server/src/codex-projections.ts` EXACTLY, including the deliberate narrowness: it carries only
 * what a row needs to render and to open its record. Every key is present on every kind (null where it
 * does not apply), so nothing here branches on key *presence*.
 *
 * `title` is the page title / map name / marker label ("" when a pin is unlabelled) / a bounded excerpt
 * of a journal entry — and a PLAYER's journal excerpt is drawn from `playerText` alone. The server
 * projects a player's hits through `projectPlayerSearchHit`, so this client never filters visibility
 * itself: a client-side filter could only ever disagree with the gate that actually matters.
 */
export type CodexSearchHit = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  /** Pages only — null on every other kind. */
  entityType: EntityType | null;
  /** Markers only — the map that pin lives on, which is what lets a marker hit open the map BEFORE selecting the pin. */
  mapId: string | null;
}>;

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
  /** CT-11: omitted leaves the stored date alone; `null` clears it (the journal's contract exactly). */
  inWorldDate?: CodexInWorldDate | null;
  expectedRev?: number;
}>;

const BASE = "/api/v1/codex";

export class CodexRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) { super(message); }
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new CodexRequestError(body?.error?.message ?? `The codex request failed (${response.status}).`, response.status, body?.error?.code ?? "error");
  }
  return body.data as T;
}

export const codexApi = {
  listPages: (token: string) => request<{ pages: CodexPageSummary[] }>(token, "/pages").then((data) => data.pages),
  // CI-1: reads `hits` (all four record kinds), never the legacy page-only `results` the route still
  // returns for the transition. Two lists off one route is the second parallel path this overhaul removes.
  search: (token: string, query: string) => request<{ hits: CodexSearchHit[] }>(token, `/search?q=${encodeURIComponent(query)}`).then((data) => data.hits),
  getPage: (token: string, id: string) => request<{ page: CodexPage; backlinks: CodexBacklink[]; relationships: CodexRelationship[] }>(token, `/pages/${id}`),
  addRelationship: (token: string, pageId: string, toPageId: string, type: string) => request<{ relationship: CodexRelationshipEdge }>(token, `/pages/${pageId}/relationships`, { method: "POST", body: JSON.stringify({ toPageId, type }) }).then((data) => data.relationship),
  removeRelationship: (token: string, relId: string) => request<{ deleted: boolean }>(token, `/relationships/${relId}`, { method: "DELETE" }),
  listRelationships: (token: string) => request<{ relationships: CodexRelationshipEdge[] }>(token, "/relationships").then((data) => data.relationships),
  /**
   * CI-8: every wiki-link edge in the codex, GM-scoped — the sibling of `listRelationships`, and its
   * neighbour here for the same reason it is the `/relationships` route's neighbour on the server.
   */
  listLinks: (token: string) => request<{ links: CodexLinkEdge[] }>(token, "/links").then((data) => data.links),
  /**
   * CI-4: the REVERSE of `atlasApi.listMarkers` — every atlas pin that links THIS page, so an open page
   * can point back at the map instead of the Atlas being the only way to find out. GM projection (full
   * `CodexMarker` rows, `mapId` included), which is what lets the jump name both halves of its
   * destination — the pin's map AND the pin — without the Atlas having to resolve anything.
   */
  markersForPage: (token: string, pageId: string) => request<{ markers: CodexMarker[] }>(token, `/pages/${pageId}/markers`).then((data) => data.markers),
  createPage: (token: string, input: CodexPageInput) => request<{ page: CodexPage }>(token, "/pages", { method: "POST", body: JSON.stringify(input) }).then((data) => data.page),
  updatePage: (token: string, id: string, input: CodexPageInput) => request<{ page: CodexPage }>(token, `/pages/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.page),
  revealPage: (token: string, id: string, revealed: boolean) => request<{ page: CodexPage }>(token, `/pages/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.page),
  deletePage: (token: string, id: string) => request<{ deleted: boolean }>(token, `/pages/${id}`, { method: "DELETE" }),
  moveFolder: (token: string, from: string, to: string) => request<{ moved: number }>(token, "/folders/move", { method: "POST", body: JSON.stringify({ from, to }) }).then((data) => data.moved),
  listFolders: (token: string) => request<{ folders: string[] }>(token, "/folders").then((data) => data.folders),
  createFolder: (token: string, path: string) => request<{ path: string }>(token, "/folders", { method: "POST", body: JSON.stringify({ path }) }).then((data) => data.path),
  deleteFolder: (token: string, path: string) => request<{ deleted: boolean }>(token, "/folders/delete", { method: "POST", body: JSON.stringify({ path }) }),
  listRevisions: (token: string, id: string) => request<{ revisions: CodexPageRevision[] }>(token, `/pages/${id}/revisions`).then((data) => data.revisions),
  restoreRevision: (token: string, id: string, revisionId: number) => request<{ page: CodexPage }>(token, `/pages/${id}/revisions/${revisionId}/restore`, { method: "POST" }).then((data) => data.page),
  /**
   * OWNER DECISION (2026-07-30): codex-wide settings, GM-only. Server state rather than a device
   * preference, and it has to be: these govern what the SERVER writes, so a per-device copy would let two
   * GM devices disagree about a codex they share.
   */
  getSettings: (token: string) => request<{ settings: CodexSettings }>(token, "/settings").then((data) => data.settings),
  setSettings: (token: string, input: CodexSettingsInput) => request<{ settings: CodexSettings }>(token, "/settings", { method: "PUT", body: JSON.stringify(input) }).then((data) => data.settings),
  /**
   * OWNER DECISION (2026-07-30): trim the version history. **Destructive and irreversible** — the one such
   * action on the settings screen, which is why the caller confirms with the real count first.
   *
   * `olderThanDays: 0` deletes every version, and that is arithmetic rather than a magic number: nothing is
   * younger than zero days old. It is still reached from its own button behind its own confirm, never by
   * winding a day field down to zero.
   *
   * Never touches `codex_pages` — a page as it stands now is not a version of itself.
   */
  deleteRevisions: (token: string, olderThanDays: number) =>
    request<{ deleted: number }>(token, "/page-revisions", { method: "DELETE", body: JSON.stringify({ olderThanDays }) }),
  /** Mints a short-lived PLAYER token so the GM can preview the player Codex through the real player projection. */
  createPreviewSession: (token: string) => request<{ token: string }>(token, "/preview-session", { method: "POST" }).then((data) => data.token),
  exportBundle: (token: string) => request<{ codex: unknown; exportedAt: string }>(token, "/export")
};

/** A page title reduced to a stable [[wiki-link]] key (must match the server's `pageLinkKey`). */
export function pageLinkKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Upload a page image (banner or inline). Sends raw bytes with the file's content-type (never JSON, so express.raw handles it). */
export async function uploadCodexAsset(token: string, file: File): Promise<{ id: string; width: number; height: number }> {
  const response = await fetch(`/api/v1/codex-assets?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": file.type || "application/octet-stream" },
    body: file
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new CodexRequestError(body?.error?.message ?? "The image upload failed.", response.status, body?.error?.code ?? "error");
  return body.data.asset as { id: string; width: number; height: number };
}

// ----- Player-facing projections (same endpoints, stripped by the server for a player token) -----

export type PlayerCodexPageSummary = Readonly<{ id: string; title: string; entityType: EntityType; folder: string | null; tags: readonly string[]; bannerAssetId: string | null; updatedAt: string }>;
export type PlayerCodexPage = PlayerCodexPageSummary & Readonly<{ fields: Readonly<Record<string, string>>; body: string }>;
// CI-2: `tags` is player-visible on all four record types. It rides the same allow-list as every other
// field in these projections (`codex-projections.ts`), so a tag only ever arrives on a record the player
// was already permitted to see — a tag is never a side channel onto a secret map, pin, or entry.
export type PlayerCodexMap = Readonly<{ id: string; assetId: string; name: string; kind: "battlemap" | "regional" | "world"; parentMapId: string | null; tags: readonly string[] }>;
// M12 / CT-7: `isParty` is the one key this projection gains, and it is player-visible on purpose — the
// party pin is FOR the players. Nothing else about a marker's gate changes: an unrevealed pin, or a pin
// on an unrevealed map, is absent from this list whether or not it is the party's.
export type PlayerCodexMarker = Readonly<{ id: string; mapId: string; x: number; y: number; iconId: string; iconColor: string; label: string | null; pageIds: string[]; subMapId: string | null; isParty: boolean; tags: readonly string[] }>;
export type PlayerCodexJournalEntry = Readonly<{ id: string; text: string; kind: CodexJournalKind; sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; tags: readonly string[]; createdAt: string }>;
/**
 * M9: a session as a PLAYER sees it — the tightest projection the server has (`projectPlayerSession`),
 * FOUR keys and nothing else. `prepBody` (the GM's plan), `rev`, `status` and `attendees` are absent by
 * design, and `recapBody` arrives renamed `recap` — the layer prefix only means something where there
 * are two layers, and here only one is left. An unrevealed session is not in this list at all.
 */
export type PlayerCodexSession = Readonly<{ id: string; sessionNumber: number | null; realDate: string | null; recap: string }>;

export const playerCodexApi = {
  listPages: (token: string) => request<{ pages: PlayerCodexPageSummary[] }>(token, "/pages").then((data) => data.pages),
  getPage: (token: string, id: string) => request<{ page: PlayerCodexPage; backlinks: CodexBacklink[]; relationships: CodexRelationship[] }>(token, `/pages/${id}`),
  // Same route, same `hits` key, same row type — the server has already dropped everything this player
  // may not see (`projectPlayerSearchHit`), so a player result list is narrower, never differently shaped.
  search: (token: string, query: string) => request<{ hits: CodexSearchHit[] }>(token, `/search?q=${encodeURIComponent(query)}`).then((data) => data.hits),
  listRelationships: (token: string) => request<{ relationships: CodexRelationshipEdge[] }>(token, "/relationships").then((data) => data.relationships),
  /**
   * CI-8, the PLAYER's wiki-link feed. Same route as `codexApi.listLinks`; the server has already
   * dropped every edge with an endpoint this player cannot see AND every edge written in a GM body
   * (`projectPlayerLinkEdges`). The player Graph must read THIS and never the GM method — a client-side
   * filter over the GM feed could only ever disagree with the gate that actually counts.
   */
  listLinks: (token: string) => request<{ links: CodexLinkEdge[] }>(token, "/links").then((data) => data.links),
  listMaps: (token: string) => request<{ maps: PlayerCodexMap[] }>(token, "/maps").then((data) => data.maps),
  listMarkers: (token: string, mapId: string) => request<{ markers: PlayerCodexMarker[] }>(token, `/maps/${mapId}/markers`).then((data) => data.markers),
  /**
   * CT-11: the player's chronicle — revealed journal entries AND revealed dated `event` pages, in one
   * list. This replaces the old journal-only `timeline` read here: the moment `event` pages resolved onto
   * the chronicle, a player Journal that kept reading `/journal` would have been the ONLY surface in the
   * app showing a different set of records than the timeline it claims to be.
   */
  chronicle: (token: string) => request<{ records: PlayerCodexChronicleRecord[] }>(token, "/timeline").then((data) => data.records),
  /**
   * M9 / CT-3: the revealed sessions, recap-only. Same route as `sessionApi.list`; the server filters the
   * unrevealed ones out and always answers a player `activeSessionId: null`, which is why only `sessions`
   * is unwrapped here — a pointer that is constantly null is not state worth carrying.
   */
  sessions: (token: string) => request<{ sessions: PlayerCodexSession[] }>(token, "/sessions").then((data) => data.sessions),
  /**
   * M10 / CT-4: the revealed quests. Same route as `questApi.list`; the server drops every unrevealed
   * quest, strips `gmBody` and `rev`, and filters each quest's `entityIds` down to the pages this player
   * may also see. `PlayerCodexQuest` and the rest of the quest surface live in the QUESTS section at the
   * bottom of this file — one home for the whole record, rather than half of it up here.
   */
  quests: (token: string) => request<{ quests: PlayerCodexQuest[] }>(token, "/quests").then((data) => data.quests),
  /**
   * M12 / CT-6: the revealed standings. Same route as `standingApi.list`; the server drops every
   * unrevealed one and strips the row to two keys (`PlayerCodexStanding`). The player Codex must read
   * THIS and never `standingApi.list` — the GM method's return type says `revealedToPlayers` is present,
   * and a player surface typed as the GM's would be one careless render from showing the table which of
   * its own standings it is not supposed to know about.
   */
  standing: (token: string) => request<{ standing: PlayerCodexStanding[] }>(token, "/standing").then((data) => data.standing),
  /**
   * M11 / O-1: the campaign calendar as a PLAYER receives it. Same route as `calendarApi.get`, and the
   * reason this entry exists at all: since the prep clock, `/codex/calendar` is projected by role, and
   * the player's `currentDate` is the **published** date — never the GM's clock, which has no field on
   * this shape to arrive in.
   *
   * The player Codex must read THIS and never `calendarApi.get`. That is not a style preference: the GM
   * method's return type says `publishedDate` is present, and a player surface that typed its calendar
   * as the GM's would be one careless render away from putting the GM's prep clock on the table.
   */
  calendar: (token: string) => request<{ calendar: CodexCalendar }>(token, "/calendar").then((data) => data.calendar)
};

// ----- Atlas: maps + markers -----

export type CodexMapKind = "battlemap" | "regional" | "world";
/** CI-2: `tags` carries the SAME vocabulary and the same rules as page tags — at most 24, each a
    lowercase slug (`/^[a-z0-9][a-z0-9-]*$/`). The server validates with the very same `tags()` helper
    the page path uses and THROWS on a non-slug rather than sanitising, which is why every tag editor
    here keeps `TagInput`'s default slugify normalizer instead of overriding it. */
export type CodexMap = Readonly<{
  id: string; assetId: string; name: string; kind: CodexMapKind; parentMapId: string | null;
  revealedToPlayers: boolean; sortKey: number; tags: readonly string[]; createdAt: string; updatedAt: string;
}>;
export type CodexMarker = Readonly<{
  id: string; mapId: string; x: number; y: number; iconId: string; iconColor: string; label: string | null;
  revealedToPlayers: boolean; pageIds: string[]; subMapId: string | null; sceneIds: string[]; actorId: string | null;
  /**
   * M12 / CT-7: is this the party's pin? **One flag on an ordinary marker**, never a marker type of its
   * own (spec: "an ordinary marker with a flag"), and M12-C makes it one pin for the WHOLE atlas — the
   * server clears the previous one when a new one is set, so this client never has to reconcile two.
   *
   * Player-visible: it appears on `PlayerCodexMarker` too, because the party pin exists for the players.
   * It changes nothing about the pin's own gate — a party pin on a hidden map is exactly as hidden as
   * any other pin there.
   */
  isParty: boolean;
  tags: readonly string[]; createdAt: string; updatedAt: string;
}>;
/** On every write below, omitting `tags` leaves the stored tags alone; sending `[]` genuinely clears them. */
export type CodexMapInput = Readonly<{ assetId?: string; name?: string; kind?: CodexMapKind; parentMapId?: string | null; revealedToPlayers?: boolean; tags?: readonly string[] }>;
export type CodexMarkerInput = Readonly<{
  x?: number; y?: number; iconId?: string; iconColor?: string; label?: string | null; revealedToPlayers?: boolean;
  pageIds?: string[]; subMapId?: string | null; sceneIds?: string[]; actorId?: string | null; tags?: readonly string[];
}>;

/** A map asset the GM has uploaded (from the existing map catalog); the raw material for an atlas map node. */
export type MapAsset = Readonly<{ id: string; name: string; kind: CodexMapKind; width: number; height: number }>;

export const atlasApi = {
  listAssets: async (token: string): Promise<MapAsset[]> => {
    const response = await fetch("/api/v1/map-assets", { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) throw new CodexRequestError(body?.error?.message ?? "Could not load your maps.", response.status, body?.error?.code ?? "error");
    return body.data.assets as MapAsset[];
  },
  listMaps: (token: string) => request<{ maps: CodexMap[] }>(token, "/maps").then((data) => data.maps),
  createMap: (token: string, input: CodexMapInput & { assetId: string; name: string; kind: CodexMapKind }) => request<{ map: CodexMap }>(token, "/maps", { method: "POST", body: JSON.stringify(input) }).then((data) => data.map),
  // Deliberately narrower than CodexMapInput: the server's MapUpdateSchema is strict and accepts only
  // these three, so widening this would let a caller send a field the PATCH rejects outright.
  updateMap: (token: string, id: string, input: { name?: string; kind?: CodexMapKind; tags?: readonly string[] }) => request<{ map: CodexMap }>(token, `/maps/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.map),
  setMapParent: (token: string, id: string, parentMapId: string | null) => request<{ map: CodexMap }>(token, `/maps/${id}/parent`, { method: "POST", body: JSON.stringify({ parentMapId }) }).then((data) => data.map),
  revealMap: (token: string, id: string, revealed: boolean) => request<{ map: CodexMap }>(token, `/maps/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.map),
  deleteMap: (token: string, id: string) => request<{ deleted: boolean }>(token, `/maps/${id}`, { method: "DELETE" }),
  listMarkers: (token: string, mapId: string) => request<{ markers: CodexMarker[] }>(token, `/maps/${mapId}/markers`).then((data) => data.markers),
  createMarker: (token: string, mapId: string, input: CodexMarkerInput & { x: number; y: number; iconId: string; iconColor: string }) => request<{ marker: CodexMarker }>(token, `/maps/${mapId}/markers`, { method: "POST", body: JSON.stringify(input) }).then((data) => data.marker),
  updateMarker: (token: string, id: string, input: CodexMarkerInput) => request<{ marker: CodexMarker }>(token, `/markers/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.marker),
  moveMarker: (token: string, id: string, x: number, y: number) => request<{ marker: CodexMarker }>(token, `/markers/${id}/move`, { method: "POST", body: JSON.stringify({ x, y }) }).then((data) => data.marker),
  revealMarker: (token: string, id: string, revealed: boolean) => request<{ marker: CodexMarker }>(token, `/markers/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.marker),
  /**
   * M12 / CT-7. Its OWN route, exactly as reveal is, and for the same reason: marking the party's
   * position is not an edit to the pin, so it does not travel on the PATCH that rewrites its label and
   * links. M12-C: setting a new party pin clears the old one server-side, wherever in the atlas it was —
   * which is why the caller re-reads rather than patching the answer into its list.
   *
   * There is deliberately no move-the-party route. The party pin is moved by moving the PIN
   * (`moveMarker`), which is the marker-move path every other pin already uses; a second way to move one
   * marker is exactly the "two ways to say one thing" shape this programme exists to remove.
   */
  setPartyMarker: (token: string, id: string, isParty: boolean) => request<{ marker: CodexMarker }>(token, `/markers/${id}/party`, { method: "PUT", body: JSON.stringify({ isParty }) }).then((data) => data.marker),
  deleteMarker: (token: string, id: string) => request<{ deleted: boolean }>(token, `/markers/${id}`, { method: "DELETE" })
};

// ----- Journal / timeline -----

/**
 * M12: SIX kinds. `deadline`, `downtime`, `milestone` and `standing` are ordinary journal rows — same
 * table, same two layers, same reveal flag, same in-world dating — discriminated for display. Mirrors
 * the server's `CodexJournalKind` (`codex-store.ts`), which M12 widened to exactly this set; the DB's
 * CHECK has admitted all six since M11's v15, so no table was rebuilt for the two new ones.
 */
export type CodexJournalKind = "note" | "combat" | "deadline" | "downtime" | "milestone" | "standing";
/**
 * M11 / CT-10: what a downtime record carries beyond its prose. Mirrors the server's
 * `CodexDowntimePayload` (`codex-store.ts`) exactly.
 *
 * `applied` is GM WORKFLOW state — "has the GM confirmed the clock move?" (O-3) — and is the one field
 * the player projection drops (`CodexDowntimeSummary` below is what a player receives). It is real
 * stored state, not something derived: the whole point of O-3 is that creating downtime proposes a date
 * and a separate explicit action applies it.
 *
 * There is deliberately no `outcome` field. A downtime's prose already has two layers on this record
 * (`playerText` / `gmText`); a third prose channel inside a payload would sit outside the reveal split.
 */
export type CodexDowntimeSummary = Readonly<{ who: string; activity: string; days: number }>;
export type CodexDowntimePayload = CodexDowntimeSummary & Readonly<{ applied: boolean }>;
/**
 * M12 / CT-8. What a level-up record carries beyond its prose. Mirrors the server's
 * `CodexMilestonePayload` (`codex-store.ts`) exactly — and it is exactly two fields, because CT-8 is
 * "milestone / level history … **no XP arithmetic**". There is no XP total, no threshold and no next
 * level: the GM says which level the party reached and why, and the record is the history.
 */
export type CodexMilestonePayload = Readonly<{ level: number; reason: string }>;
/**
 * M12 / CT-6. What a standing CHANGE carries. `delta` is the change, not the new value — the record says
 * what happened, the `codex_standing` table says where things stand. A chronicle of new values could not
 * answer "how much did that betrayal cost us", which is the only question a history of standing is for.
 */
export type CodexStandingPayload = Readonly<{ factionPageId: string; delta: number; reason: string }>;
/**
 * The same record as a PLAYER receives it, and the one field that differs: `factionPageId` is **nullable**.
 * The server nulls it when the faction's own page is unrevealed — the identical rule `projectPlayerQuest`
 * applies to a quest's `entityIds` and `projectPlayerMap` to a parent map: a link to a page the party
 * cannot open is not a link, and an id they cannot resolve is only the advertisement of a secret.
 *
 * The delta and the reason survive, because a revealed standing record with its number stripped would say
 * nothing at all — see `PlayerCodexChronicleRecord.payload`.
 */
export type PlayerCodexStandingPayload = Readonly<{ factionPageId: string | null; delta: number; reason: string }>;
/**
 * The widest of the two, and what the shared reader (`standingOf`) hands back: whichever projection a
 * surface is holding, it must be prepared for the id to be absent. A GM surface simply never sees null.
 */
export type CodexStandingChange = PlayerCodexStandingPayload;
/**
 * M12: the payload is a **union discriminated by `kind`**, mirroring the server's widened
 * `CodexJournalRow.payload`. Read it through `chronicle.ts`'s `downtimeOf` / `milestoneOf` /
 * `standingOf` rather than directly: those apply the kind gate, which is what stops a record's payload
 * being rendered as a kind it is not. Widening this to a union is deliberate — it makes a call site that
 * forgot the gate a compile error rather than a silent mis-render.
 */
export type CodexJournalPayload = CodexDowntimePayload | CodexMilestonePayload | CodexStandingPayload;
export type CodexJournalEntry = Readonly<{
  id: string; playerText: string; gmText: string | null; revealedToPlayers: boolean;
  attachMarkerId: string | null; attachPageId: string | null; kind: CodexJournalKind; sourceEncounterId: number | null;
  sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; calendarInstant: number | null; inWorldDate: CodexInWorldDate | null;
  /** M12: `null` for every kind except `downtime`, `milestone` and `standing` — the store parses
      `payload_json` only for those three. */
  payload: CodexJournalPayload | null;
  sortKey: number; tags: readonly string[]; createdAt: string; updatedAt: string;
}>;
export type CodexInWorldDate = Readonly<{ year: number; month: number; day: number }>;
export type CodexJournalInput = Readonly<{
  playerText?: string; gmText?: string | null; revealedToPlayers?: boolean; attachMarkerId?: string | null;
  attachPageId?: string | null; sessionNumber?: number | null; realDate?: string | null; inWorldLabel?: string | null;
  inWorldDate?: CodexInWorldDate | null; tags?: readonly string[];
}>;
/**
 * M11: the downtime triple, sent NESTED beside the ordinary journal input — the server's
 * `createDowntime(input & { downtime: { who, activity, days } })`. Bounded here as well as on the
 * server (`who`/`activity` at 120 chars, `days` an integer 0…3650) so the composer cannot hand a GM a
 * generic save failure for something the field could have prevented.
 */
export type CodexDowntimeInput = Readonly<{ who: string; activity: string; days: number }>;
/**
 * M12 / CT-8: the milestone pair, sent NESTED beside the ordinary journal input — `createDowntime`'s
 * shape verbatim, because it is the same kind of thing (a payload that is not prose riding alongside a
 * record that is). Bounded here as well as on the server so a slip is a disabled field rather than a
 * generic 400.
 */
export type CodexMilestoneInput = Readonly<{ level: number; reason: string }>;

// ----- Calendar (the world's own months / weekdays / era) -----
export type CodexCalendarMonth = Readonly<{ name: string; days: number }>;
export type CodexCalendar = Readonly<{ yearName: string; months: readonly CodexCalendarMonth[]; weekdays: readonly string[]; currentDate?: CodexInWorldDate | null }>;
/**
 * M11 / O-1 — the PREP CLOCK. The calendar as the **GM** reads it (`projectGmCalendar`).
 *
 * There are two clocks now and this type is the only place both are visible at once:
 *  - `currentDate` (inherited above) is the **GM's own** clock — the authoritative campaign "now", the
 *    one a logged battle is dated at, the one a deadline fires against, the one downtime advances.
 *  - `publishedDate` is what the **players** are currently on. A player's read of the very same route
 *    receives a `CodexCalendar` whose `currentDate` IS this value, which is why the player-facing field
 *    keeps its name and no player surface needed changing: only its source moved.
 *
 * So the GM can run the clock ahead while prepping and the table sees nothing until they publish
 * (`calendarApi.publish`). `null` means players have no date at all yet.
 *
 * Deliberately a SEPARATE type from `CodexCalendar` rather than an optional field on it, because
 * `CodexCalendar` is also the PUT body (`calendarApi.set`) and the server's `CalendarSchema` is
 * `.strict()`: a caller that echoed a fetched GM calendar straight back would be sending a key the
 * route rejects outright. The published date is written by exactly one route, and it is not that one.
 */
export type GmCodexCalendar = CodexCalendar & Readonly<{ publishedDate: CodexInWorldDate | null }>;
export function calendarDaysPerYear(calendar: CodexCalendar): number { return calendar.months.reduce((sum, month) => sum + month.days, 0); }
/** Absolute day-instant for a date (inverse of instantToDate) - used to place the "now" marker on the timeline. */
export function dateToInstant(calendar: CodexCalendar, date: CodexInWorldDate): number {
  const monthIdx = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  let dayOfYear = 0;
  for (let i = 0; i < monthIdx; i += 1) dayOfYear += calendar.months[i].days;
  return Math.trunc(date.year) * (calendarDaysPerYear(calendar) || 1) + dayOfYear + (Math.max(1, Math.trunc(date.day)) - 1);
}
export function calendarYearOf(calendar: CodexCalendar, instant: number): number { const perYear = calendarDaysPerYear(calendar) || 1; return Math.floor(instant / perYear); }
export function formatWorldYear(calendar: CodexCalendar, year: number): string { return `${year}${calendar.yearName ? ` ${calendar.yearName}` : ""}`; }
/**
 * A raw in-world date rendered as "Month Day, Year Era". It lived inside `JournalView` until CI-7 gave
 * the Campaign dashboard the same readout — two copies of a date format is exactly how the journal's
 * "Now" chip and the dashboard's would drift apart.
 */
export function formatWorldDate(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const month = calendar.months[Math.max(0, Math.min(date.month, calendar.months.length - 1))];
  return `${month?.name ?? ""} ${date.day}, ${formatWorldYear(calendar, date.year)}`;
}
export function instantToDate(calendar: CodexCalendar, instant: number): CodexInWorldDate {
  const perYear = calendarDaysPerYear(calendar) || 1;
  const year = Math.floor(instant / perYear);
  let remainder = instant - year * perYear;
  let month = 0;
  while (month < calendar.months.length - 1 && remainder >= calendar.months[month].days) { remainder -= calendar.months[month].days; month += 1; }
  return { year, month, day: remainder + 1 };
}
export const calendarApi = {
  /**
   * The GM's read. Same route the player reads (`playerCodexApi.calendar`) — the server projects it by
   * role (M11 / F-6), so this one carries the GM's clock plus `publishedDate` and the player's carries
   * only the published date, under the name `currentDate`.
   */
  get: (token: string) => request<{ calendar: GmCodexCalendar }>(token, "/calendar").then((data) => data.calendar),
  /** The world's SHAPE plus the GM's clock. Never the published date — see `GmCodexCalendar`. */
  set: (token: string, calendar: CodexCalendar) => request<{ calendar: CodexCalendar }>(token, "/calendar", { method: "PUT", body: JSON.stringify(calendar) }).then((data) => data.calendar),
  /**
   * O-1 / D11-H: copy the GM's clock onto the players' clock. The ONLY thing that publishes it —
   * advancing the clock, editing the calendar and applying downtime all deliberately leave the table
   * where it was until the GM says so.
   */
  publish: (token: string) => request<{ calendar: GmCodexCalendar }>(token, "/calendar/publish", { method: "POST" }).then((data) => data.calendar)
};

// ----- The chronicle (CT-11 / CT-12: ONE timeline — journal entries + dated `event` pages) -----

/**
 * What a chronicle row IS. R2: one row shape for every record, the kind read by icon + label (never by
 * colour alone). `combat` is split from `entry` because a battle already renders with its own badge and
 * its replay edge; it is the same store row, discriminated for display.
 */
export type CodexChronicleKind = "entry" | "combat" | "event" | "deadline" | "downtime" | "milestone" | "standing";

/**
 * One chronicle row, GM view. Mirrors `GmCodexChronicleRecord` in `apps/server/src/codex-projections.ts`
 * exactly, including the deliberate uniformity: every key is present on every kind (null where it does
 * not apply), so nothing here branches on key *presence*.
 *
 * `id` is the record's OWN id — a journal-entry id for `entry`/`combat`, a PAGE id for `event` — and
 * `kind` is what says which, so "open this row" has exactly one thing to look at.
 *
 * `text`/`gmText` are the row's two layers: a journal entry's full text (an entry IS its text), or a
 * bounded excerpt of an event page's two bodies (the page is where those are read).
 */
export type CodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  gmText: string | null;
  revealedToPlayers: boolean;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  tags: readonly string[];
  attachPageId: string | null;
  attachMarkerId: string | null;
  sourceEncounterId: number | null;
  /**
   * M11: the downtime payload, full — `applied` included, because whether the GM has confirmed the
   * clock move is precisely what the GM's row has to show.
   *
   * M12 widens it to the same `kind`-discriminated union the journal row carries, so a milestone's
   * `{ level, reason }` and a standing change's `{ factionPageId, delta, reason }` arrive here too.
   * `null` on every other kind. Read it through `chronicle.ts`'s kind-gated helpers, never directly.
   */
  payload: CodexJournalPayload | null;
  /**
   * M11 / CT-5: has the campaign clock passed this deadline? **Derived server-side, never stored** —
   * it is `calendarInstant <= the campaign clock`, so rewinding the clock un-fires a deadline, which is
   * correct. Meaningful only on a `deadline` row; read it through `deadlineFired` in `chronicle.ts`
   * rather than directly, so "has this fired" has exactly one answer on this client.
   */
  fired: boolean;
  /**
   * M11 / O-3: where applying this downtime would put the campaign clock — **the server's answer**, not
   * ours. GM rows only; `null` on every other kind and on a downtime already applied.
   *
   * The client can compute this (`downtimeProposedDate`), and for the composer's live preview it must,
   * because the record does not exist yet. But once a row exists the server is the authority on where
   * its own clock lands, and the Confirm affordance promises a date out loud. Two implementations of one
   * answer is the "two ways to say one thing" shape this overhaul exists to remove — they agree today
   * only because `downtimeProposedDate` hand-clamps a case `dateToInstant` does not.
   */
  proposedDate: CodexInWorldDate | null;
  createdAt: string;
  updatedAt: string;
}>;

/**
 * The player's half of the payload union. It differs from the GM's in exactly two members — a downtime
 * arrives as `CodexDowntimeSummary`, without the GM's `applied` workflow flag, and a standing change
 * arrives with a nullable `factionPageId` — which is why the two unions are named separately rather than
 * one being reused for both.
 */
export type CodexPlayerChroniclePayload = CodexDowntimeSummary | CodexMilestonePayload | PlayerCodexStandingPayload;

/**
 * One chronicle row, PLAYER view — `PlayerCodexJournalEntry` plus `title`, and nothing else. The server
 * has already applied the only gate there is (`projectPlayerChronicleRecord`, which delegates to the
 * journal and page player projections), so this client never filters visibility itself.
 */
export type PlayerCodexChronicleRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  sessionNumber: number | null;
  realDate: string | null;
  inWorldLabel: string | null;
  tags: readonly string[];
  /**
   * M11: the downtime payload **without `applied`** (`CodexDowntimeSummary`). Who did what, and for how
   * long, is campaign fact once the record is revealed; whether the GM has confirmed the clock move is
   * GM workflow and has no player-facing meaning, so the server's allow-list simply never emits it.
   * There is no field here to leak it into.
   *
   * M12 adds the two new payloads on the same terms. A milestone's `{ level, reason }` is what the
   * record IS, so a revealed milestone carries it whole. A standing change carries its `delta` too — the
   * delta is the entire point of a revealed standing record ("we lost twenty with the Zhentarim"), and a
   * record the GM chose to reveal with its number stripped would say nothing at all. Both are gated by
   * the record's own reveal flag exactly as its prose is; neither is a new visibility rule.
   */
  payload: CodexPlayerChroniclePayload | null;
  /** M11: a revealed deadline the campaign has passed must read as passed. Derived server-side. */
  fired: boolean;
  createdAt: string;
}>;

export const journalApi = {
  /** CT-11/CT-12: the one chronicle, GM view. BOTH lenses read this — "by session" regroups these records. */
  chronicle: (token: string) => request<{ records: CodexChronicleRecord[] }>(token, "/timeline").then((data) => data.records),
  timeline: (token: string) => request<{ entries: CodexJournalEntry[] }>(token, "/journal").then((data) => data.entries),
  forPage: (token: string, pageId: string) => request<{ entries: CodexJournalEntry[] }>(token, `/journal?pageId=${pageId}`).then((data) => data.entries),
  forMarker: (token: string, markerId: string) => request<{ entries: CodexJournalEntry[] }>(token, `/journal?markerId=${markerId}`).then((data) => data.entries),
  create: (token: string, input: CodexJournalInput) => request<{ entry: CodexJournalEntry }>(token, "/journal", { method: "POST", body: JSON.stringify(input) }).then((data) => data.entry),
  /**
   * M11 / CT-5. A deadline stores NO payload of its own: what will happen is the entry's own text, and
   * when it will happen is the entry's own in-world date — which is why `inWorldDate` is REQUIRED here
   * where `create` leaves it optional. A deadline with no date could never fire.
   */
  createDeadline: (token: string, input: CodexJournalInput & { inWorldDate: CodexInWorldDate }) =>
    request<{ entry: CodexJournalEntry }>(token, "/journal/deadline", { method: "POST", body: JSON.stringify(input) }).then((data) => data.entry),
  /**
   * M11 / CT-10. Creating downtime NEVER moves the clock (O-3) — it comes back with the date it would
   * move it to, and `applyDowntime` below is the separate, explicit thing that actually moves it.
   */
  createDowntime: (token: string, input: CodexJournalInput & { downtime: CodexDowntimeInput }) =>
    request<{ entry: CodexJournalEntry; proposedDate: CodexInWorldDate | null }>(token, "/journal/downtime", { method: "POST", body: JSON.stringify(input) }),
  /**
   * M12 / CT-8. A milestone is an ordinary journal row with a `{ level, reason }` payload — the same
   * two layers, the same reveal flag, the same in-world dating — so this is `createDowntime`'s shape
   * exactly, with the payload nested under its own key beside the journal input.
   *
   * Undated is legitimate here where it is not for a deadline: a deadline with no date can never fire,
   * but "the party reached 5" is a thing that happened, and the store dates it at the GM's clock when no
   * explicit date is given.
   */
  createMilestone: (token: string, input: CodexJournalInput & { milestone: CodexMilestoneInput }) =>
    request<{ entry: CodexJournalEntry }>(token, "/journal/milestone", { method: "POST", body: JSON.stringify(input) }).then((data) => data.entry),
  /**
   * O-3's confirmation: mark the downtime applied AND advance the campaign clock by its days, in one
   * server-side transaction. Applying twice is rejected by the store and moves nothing.
   *
   * It returns the calendar as well as the entry because one action changed both, but this client
   * re-reads rather than trusting the echo — the Journal's chronicle, its dated rows and its clock
   * readout all shift when the clock does.
   */
  applyDowntime: (token: string, id: string) =>
    request<{ entry: CodexJournalEntry; calendar: CodexCalendar }>(token, `/journal/${id}/apply-downtime`, { method: "POST" }),
  update: (token: string, id: string, input: CodexJournalInput) => request<{ entry: CodexJournalEntry }>(token, `/journal/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.entry),
  reveal: (token: string, id: string, revealed: boolean) => request<{ entry: CodexJournalEntry }>(token, `/journal/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.entry),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/journal/${id}`, { method: "DELETE" })
};

// ----- Sessions (M9: prep is the GM half, recap is the player half) -----

export type CodexSessionStatus = "planned" | "played";
/**
 * One session, GM view. Mirrors `CodexSessionRow` in `apps/server/src/codex-store.ts` exactly.
 *
 * Two bodies, two audiences: `prepBody` is the GM's plan for the evening and never leaves the GM
 * projection at all; `recapBody` is the player-facing half and reaches the table only once
 * `revealedToPlayers` is set. `rev` is the same optimistic-concurrency token pages carry — the only
 * other Codex record with one — so an edit sends it back as `expectedRev` and a stale one is a 409.
 */
export type CodexSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  /** The real-world date the group met ("2026-07-26"), free text — the campaign calendar is the IN-WORLD one. */
  realDate: string | null;
  attendees: readonly string[];
  prepBody: string;
  recapBody: string;
  revealedToPlayers: boolean;
  status: CodexSessionStatus;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
/**
 * The fields BOTH writes share. Deliberately narrower than `CodexSession` at each end, because the
 * server's two schemas are `.strict()` and differ (`codex-http.ts`): create takes `revealedToPlayers`
 * but no `expectedRev`, update takes `expectedRev` but no `revealedToPlayers` — reveal is its own route,
 * so a PATCH can never publish a recap as a side effect of an edit. Each call site below intersects the
 * one extra key it may legitimately send, exactly as `atlasApi.createMap` does; a single wide input type
 * would let a caller send a field the other endpoint rejects outright.
 */
export type CodexSessionInput = Readonly<{
  sessionNumber?: number | null;
  realDate?: string | null;
  attendees?: readonly string[];
  prepBody?: string;
  recapBody?: string;
  status?: CodexSessionStatus;
}>;

export const sessionApi = {
  /**
   * The session log plus the pointer at the ACTIVE session. Both travel together because they are one
   * answer: `activeSessionId` names a row in the very list beside it, and fetching them apart is how a
   * console ends up pointing at a session the list no longer contains. GM-only value — a player token
   * is always answered `null` (`codex-http.ts`), which is why `playerCodexApi.sessions` drops it.
   */
  list: (token: string) => request<{ sessions: CodexSession[]; activeSessionId: string | null }>(token, "/sessions"),
  get: (token: string, id: string) => request<{ session: CodexSession }>(token, `/sessions/${id}`).then((data) => data.session),
  create: (token: string, input: CodexSessionInput & { revealedToPlayers?: boolean }) => request<{ session: CodexSession }>(token, "/sessions", { method: "POST", body: JSON.stringify(input) }).then((data) => data.session),
  update: (token: string, id: string, input: CodexSessionInput & { expectedRev?: number }) => request<{ session: CodexSession }>(token, `/sessions/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.session),
  /** The SHARED reveal body (`{ revealed }`) pages, maps, markers and journal entries all use. */
  reveal: (token: string, id: string, revealed: boolean) => request<{ session: CodexSession }>(token, `/sessions/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.session),
  /**
   * Point the table at this session. Returns only the pointer: activating changes nothing ABOUT the
   * session (no `rev` bump, no `updatedAt` move), so there is no fresher row to echo back.
   */
  activate: (token: string, id: string) => request<{ activeSessionId: string | null }>(token, `/sessions/${id}/activate`, { method: "POST" }).then((data) => data.activeSessionId),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/sessions/${id}`, { method: "DELETE" })
};

// ----- Quests (M10 / CT-4: what is still open) -----

export type CodexQuestStatus = "active" | "completed" | "failed";
/**
 * One line on a quest's checklist. Deliberately exactly `{ text, done }` — the store, the route schema
 * and `@vtt/ui`'s `Checklist` all publish this same pair, and anything richer is unapproved scope.
 *
 * A blank `text` is a LEGITIMATE transient state, not a bug to filter out: the editor's flow is
 * "add a row, then type into it", so the server's `ObjectiveSchema` deliberately omits `.min(1)`. Never
 * strip blank rows before sending — dropping one would delete a row the GM is in the middle of writing.
 */
export type CodexQuestObjective = Readonly<{ text: string; done: boolean }>;
/**
 * One quest, GM view. Mirrors `CodexQuestRow` in `apps/server/src/codex-store.ts` exactly.
 *
 * Two bodies, two audiences, like a page and a session: `playerBody` is what the party was actually
 * told, `gmBody` is where the quest is really going and never leaves the GM projection. `rev` is the
 * same optimistic-concurrency token pages and sessions carry, so an edit sends it back as `expectedRev`.
 *
 * `objectives` is ORDERED and the order is content — the GM's sequence is the meaning. Nothing on this
 * client sorts, dedupes or re-keys it; it is sent back exactly as it was rendered.
 *
 * `entityIds` are codex PAGE ids this quest concerns. The server filters them to the revealed subset on
 * the way to a player, so a revealed quest never advertises the id of a still-secret page.
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
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
/**
 * The fields BOTH writes share — narrower than `CodexQuest` at each end, exactly as `CodexSessionInput`
 * is, because the server's two schemas are `.strict()` and differ: create takes `revealedToPlayers` but
 * no `expectedRev`, update takes `expectedRev` but no `revealedToPlayers` (reveal is its own route, so a
 * PATCH can never publish a quest as a side effect of an edit). Each call site below intersects the one
 * extra key it may legitimately send.
 */
export type CodexQuestInput = Readonly<{
  title?: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  gmBody?: string;
  objectives?: readonly CodexQuestObjective[];
  entityIds?: readonly string[];
}>;
/**
 * A quest as a PLAYER sees it — the server's `projectPlayerQuest`, six keys. `gmBody` and `rev` are
 * absent by design, and `playerBody` arrives renamed `body` (the layer prefix only means something where
 * there are two layers). An unrevealed quest is not in this list at all.
 *
 * `status` is KEPT, and that is the one place a quest differs from a session, whose status is GM-only:
 * "what is still open" is the whole point of the feature, so a revealed quest whose state the player
 * cannot see would tell them nothing.
 */
export type PlayerCodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  body: string;
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
}>;

export const questApi = {
  list: (token: string) => request<{ quests: CodexQuest[] }>(token, "/quests").then((data) => data.quests),
  get: (token: string, id: string) => request<{ quest: CodexQuest }>(token, `/quests/${id}`).then((data) => data.quest),
  create: (token: string, input: CodexQuestInput & { title: string; revealedToPlayers?: boolean }) => request<{ quest: CodexQuest }>(token, "/quests", { method: "POST", body: JSON.stringify(input) }).then((data) => data.quest),
  update: (token: string, id: string, input: CodexQuestInput & { expectedRev?: number }) => request<{ quest: CodexQuest }>(token, `/quests/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.quest),
  /** The SHARED reveal body (`{ revealed }`) pages, maps, markers, journal entries and sessions all use. */
  reveal: (token: string, id: string, revealed: boolean) => request<{ quest: CodexQuest }>(token, `/quests/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.quest),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/quests/${id}`, { method: "DELETE" })
};

// ----- Faction standing (M12 / CT-6: where the party stands, and what moved it) -----

/**
 * One faction's standing, GM view. Mirrors `CodexStandingRow` in `apps/server/src/codex-store.ts`.
 *
 * `factionPageId` is the KEY, not `id`: the store carries a unique index on it, so a faction has at most
 * one standing row and every route below is addressed by the faction's page id rather than the row's.
 * `value` is signed, −100…+100 (M12-B) — see `standing.ts` for what a number reads as.
 *
 * There is no history here on purpose (spec §2.1): every change writes a `kind='standing'` chronicle
 * record instead, so the timeline is the history and this table is only "where things stand".
 */
export type CodexStanding = Readonly<{
  id: string; factionPageId: string; value: number; revealedToPlayers: boolean;
  createdAt: string; updatedAt: string;
}>;
/**
 * Standing as a PLAYER sees it — which faction, and where they stand. `revealedToPlayers` is absent for
 * the reason it is absent from every other player projection (an unrevealed standing is not in the list
 * at all, so the flag would be a constant), and so are the row's own id and its timestamps: nothing on
 * the player's side opens a standing row or sorts by when it changed.
 */
export type PlayerCodexStanding = Readonly<{ factionPageId: string; value: number }>;

export const standingApi = {
  /**
   * Every faction's standing, GM view. Role-projected on the server — the very same route answers a
   * player with the revealed ones only (`playerCodexApi.standing`).
   */
  list: (token: string) => request<{ standing: CodexStanding[] }>(token, "/standing").then((data) => data.standing),
  /**
   * Set where a faction stands, and say WHY. The reason is not decoration: the server writes the value
   * and appends the `kind='standing'` chronicle record carrying `{ factionPageId, delta, reason }` in one
   * transaction, so a change that reached the table without reaching the timeline is not a state this
   * client can produce. `value` is the new absolute standing; the server works out the delta.
   */
  set: (token: string, factionPageId: string, value: number, reason: string) =>
    request<{ standing: CodexStanding }>(token, `/standing/${factionPageId}`, { method: "PUT", body: JSON.stringify({ value, reason }) }).then((data) => data.standing),
  /** The SHARED reveal body (`{ revealed }`) every other Codex record uses. */
  reveal: (token: string, factionPageId: string, revealed: boolean) =>
    request<{ standing: CodexStanding }>(token, `/standing/${factionPageId}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.standing)
};

// ----- The reveal audit (M12 / CT-9: one view of everything players can currently see) -----

/**
 * The seven Codex record types the audit enumerates. Every one has a reveal flag and a player
 * projection; nothing else in the Codex does.
 */
export type CodexRevealAuditKind = "page" | "map" | "marker" | "journal" | "session" | "quest" | "standing";

/**
 * One row of the audit. Uniform across all seven kinds — `CodexSearchHit`'s discipline verbatim: it
 * carries only what a row needs to render and to name the record it is about, and nothing branches on
 * key *presence*.
 *
 * `id` is the address that record's own reveal route takes, which for `standing` is the FACTION PAGE's
 * id (`PUT /codex/standing/{factionPageId}/reveal`) and not the standing row's own.
 */
export type CodexRevealAuditRow = Readonly<{
  kind: CodexRevealAuditKind;
  id: string;
  title: string;
  /**
   * WHICH kind of journal record this is, on a `kind: "journal"` row; `null` on all six other kinds
   * (present-and-null, so nothing here branches on key presence — the same shape `CodexSearchHit` uses for
   * `entityType` and `mapId`). Added 2026-07-30.
   *
   * `title` could not carry it: it is the record's own player prose whenever the record has any, and only
   * names the kind when the record is silent — so a revealed deadline WITH prose and a revealed note with
   * prose read identically on the one screen whose whole job is answering "is that deadline visible?".
   * Render it as a badge (`chronicleKindOfJournal` crosses to the chronicle's own vocabulary), never by
   * parsing the title.
   */
  journalKind: CodexJournalKind | null;
}>;

/**
 * One section: what players can actually see of this record type, and how much of it exists.
 *
 * `revealed` is **not** "how many have their reveal flag set". Membership is decided by running the
 * PLAYER projections — the audit reports what a player would genuinely receive, proven by the same code
 * path that serves them. That distinction is the whole point of the screen: two kinds are not
 * player-visible even with their own flag set (a revealed pin on a hidden map; a revealed standing for
 * an unrevealed faction), and an audit built on the flags alone would tell the GM their players can see
 * things the players demonstrably cannot.
 */
export type CodexRevealAuditSection = Readonly<{
  kind: CodexRevealAuditKind;
  revealed: number;
  total: number;
  rows: readonly CodexRevealAuditRow[];
}>;

/**
 * What `GET /codex/reveal-audit` answers. **GM-only**, and a READ-ONLY AGGREGATION: it calls the existing
 * store lists and the existing player projections and restates no visibility rule of its own. It writes
 * nothing — un-revealing from the audit goes back out through each record type's OWN reveal route (there
 * is no unreveal route and no bulk operation, by design).
 *
 * **All seven sections are always present**, empty ones included (the `CodexSearchHit` precedent). That
 * is what lets the surface tell "nothing of this kind is revealed" from "this did not load" — a section
 * that is simply absent is a malformed answer, not an empty one, and the audit says so rather than
 * rendering it as empty (the CF-2 lesson).
 *
 * M12-A: **Codex records only.** Tokens, fog and the shared table viewer are deliberately not here. The
 * table has its own visibility system with different rules, and folding it in would make this the second
 * place that decides what a player can see — precisely the risk CT-9 is written against.
 */
export type CodexRevealAudit = Readonly<{
  sections: readonly CodexRevealAuditSection[];
  /**
   * The server's own whole-codex totals. Mirrored because they exist and are `required` in the published
   * document — the client was re-deriving `revealed` by summing sections, which is the same number only
   * while every section is present. This surface explicitly handles a malformed answer with sections
   * missing, and in exactly that case the sum under-counts where the server's figure is right.
   */
  revealed: number;
  total: number;
}>;

export const revealAuditApi = {
  get: (token: string) => request<{ audit: CodexRevealAudit }>(token, "/reveal-audit").then((data) => data.audit)
};
