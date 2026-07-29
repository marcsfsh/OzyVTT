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

// ----- Suite-wide search (CI-1 / R8: one index, one result list, every record kind) -----

/** The four things the codex indexes. Mirrors the server's `CodexRecordKind` (`codex-store.ts`). */
export type CodexRecordKind = "page" | "journal" | "map" | "marker";
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
export type PlayerCodexMarker = Readonly<{ id: string; mapId: string; x: number; y: number; iconId: string; iconColor: string; label: string | null; pageIds: string[]; subMapId: string | null; tags: readonly string[] }>;
export type PlayerCodexJournalEntry = Readonly<{ id: string; text: string; kind: "note" | "combat"; sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; tags: readonly string[]; createdAt: string }>;
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
  sessions: (token: string) => request<{ sessions: PlayerCodexSession[] }>(token, "/sessions").then((data) => data.sessions)
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
  deleteMarker: (token: string, id: string) => request<{ deleted: boolean }>(token, `/markers/${id}`, { method: "DELETE" })
};

// ----- Journal / timeline -----

export type CodexJournalKind = "note" | "combat";
export type CodexJournalEntry = Readonly<{
  id: string; playerText: string; gmText: string | null; revealedToPlayers: boolean;
  attachMarkerId: string | null; attachPageId: string | null; kind: CodexJournalKind; sourceEncounterId: number | null;
  sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; calendarInstant: number | null; inWorldDate: CodexInWorldDate | null;
  sortKey: number; tags: readonly string[]; createdAt: string; updatedAt: string;
}>;
export type CodexInWorldDate = Readonly<{ year: number; month: number; day: number }>;
export type CodexJournalInput = Readonly<{
  playerText?: string; gmText?: string | null; revealedToPlayers?: boolean; attachMarkerId?: string | null;
  attachPageId?: string | null; sessionNumber?: number | null; realDate?: string | null; inWorldLabel?: string | null;
  inWorldDate?: CodexInWorldDate | null; tags?: readonly string[];
}>;

// ----- Calendar (the world's own months / weekdays / era) -----
export type CodexCalendarMonth = Readonly<{ name: string; days: number }>;
export type CodexCalendar = Readonly<{ yearName: string; months: readonly CodexCalendarMonth[]; weekdays: readonly string[]; currentDate?: CodexInWorldDate | null }>;
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
  get: (token: string) => request<{ calendar: CodexCalendar }>(token, "/calendar").then((data) => data.calendar),
  set: (token: string, calendar: CodexCalendar) => request<{ calendar: CodexCalendar }>(token, "/calendar", { method: "PUT", body: JSON.stringify(calendar) }).then((data) => data.calendar)
};

// ----- The chronicle (CT-11 / CT-12: ONE timeline — journal entries + dated `event` pages) -----

/**
 * What a chronicle row IS. R2: one row shape for every record, the kind read by icon + label (never by
 * colour alone). `combat` is split from `entry` because a battle already renders with its own badge and
 * its replay edge; it is the same store row, discriminated for display.
 */
export type CodexChronicleKind = "entry" | "combat" | "event";

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
  createdAt: string;
  updatedAt: string;
}>;

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
  createdAt: string;
}>;

export const journalApi = {
  /** CT-11/CT-12: the one chronicle, GM view. BOTH lenses read this — "by session" regroups these records. */
  chronicle: (token: string) => request<{ records: CodexChronicleRecord[] }>(token, "/timeline").then((data) => data.records),
  timeline: (token: string) => request<{ entries: CodexJournalEntry[] }>(token, "/journal").then((data) => data.entries),
  forPage: (token: string, pageId: string) => request<{ entries: CodexJournalEntry[] }>(token, `/journal?pageId=${pageId}`).then((data) => data.entries),
  forMarker: (token: string, markerId: string) => request<{ entries: CodexJournalEntry[] }>(token, `/journal?markerId=${markerId}`).then((data) => data.entries),
  create: (token: string, input: CodexJournalInput) => request<{ entry: CodexJournalEntry }>(token, "/journal", { method: "POST", body: JSON.stringify(input) }).then((data) => data.entry),
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
