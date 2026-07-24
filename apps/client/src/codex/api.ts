/**
 * Bearer-authorized fetch helpers for the codex REST surface (`/api/v1/codex/*`). These mirror the
 * server's GM projections (`codex-projections.ts`); the client never sees a player projection here
 * because this module is used only from the GM Codex workspace. Player-facing reads (the Atlas) will
 * use the same routes with a player token and receive the stripped shapes.
 */

export type CodexPageSummary = Readonly<{
  id: string;
  title: string;
  folder: string | null;
  tags: readonly string[];
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;

export type CodexPage = CodexPageSummary & Readonly<{ playerBody: string; gmBody: string }>;
export type CodexBacklink = Readonly<{ sourcePageId: string; sourceTitle: string; section: string | null }>;
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

export type CodexPageInput = Readonly<{
  title?: string;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  gmBody?: string;
  revealedToPlayers?: boolean;
  bannerAssetId?: string | null;
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
  search: (token: string, query: string) => request<{ results: CodexPageSummary[] }>(token, `/search?q=${encodeURIComponent(query)}`).then((data) => data.results),
  getPage: (token: string, id: string) => request<{ page: CodexPage; backlinks: CodexBacklink[] }>(token, `/pages/${id}`),
  createPage: (token: string, input: CodexPageInput) => request<{ page: CodexPage }>(token, "/pages", { method: "POST", body: JSON.stringify(input) }).then((data) => data.page),
  updatePage: (token: string, id: string, input: CodexPageInput) => request<{ page: CodexPage }>(token, `/pages/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.page),
  revealPage: (token: string, id: string, revealed: boolean) => request<{ page: CodexPage }>(token, `/pages/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.page),
  deletePage: (token: string, id: string) => request<{ deleted: boolean }>(token, `/pages/${id}`, { method: "DELETE" }),
  listRevisions: (token: string, id: string) => request<{ revisions: CodexPageRevision[] }>(token, `/pages/${id}/revisions`).then((data) => data.revisions),
  restoreRevision: (token: string, id: string, revisionId: number) => request<{ page: CodexPage }>(token, `/pages/${id}/revisions/${revisionId}/restore`, { method: "POST" }).then((data) => data.page)
};

/** A page title reduced to a stable [[wiki-link]] key (must match the server's `pageLinkKey`). */
export function pageLinkKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

// ----- Atlas: maps + markers -----

export type CodexMapKind = "battlemap" | "regional" | "world";
export type CodexMap = Readonly<{
  id: string; assetId: string; name: string; kind: CodexMapKind; parentMapId: string | null;
  revealedToPlayers: boolean; sortKey: number; createdAt: string; updatedAt: string;
}>;
export type CodexMarker = Readonly<{
  id: string; mapId: string; x: number; y: number; iconId: string; iconColor: string; label: string | null;
  revealedToPlayers: boolean; pageId: string | null; subMapId: string | null; sceneId: string | null; actorId: string | null;
  createdAt: string; updatedAt: string;
}>;
export type CodexMapInput = Readonly<{ assetId?: string; name?: string; kind?: CodexMapKind; parentMapId?: string | null; revealedToPlayers?: boolean }>;
export type CodexMarkerInput = Readonly<{
  x?: number; y?: number; iconId?: string; iconColor?: string; label?: string | null; revealedToPlayers?: boolean;
  pageId?: string | null; subMapId?: string | null; sceneId?: string | null; actorId?: string | null;
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
  updateMap: (token: string, id: string, input: { name?: string; kind?: CodexMapKind }) => request<{ map: CodexMap }>(token, `/maps/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.map),
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
  sessionNumber: number | null; realDate: string | null; inWorldLabel: string | null; calendarInstant: number | null;
  sortKey: number; createdAt: string; updatedAt: string;
}>;
export type CodexJournalInput = Readonly<{
  playerText?: string; gmText?: string | null; revealedToPlayers?: boolean; attachMarkerId?: string | null;
  attachPageId?: string | null; sessionNumber?: number | null; realDate?: string | null; inWorldLabel?: string | null;
}>;

export const journalApi = {
  timeline: (token: string) => request<{ entries: CodexJournalEntry[] }>(token, "/journal").then((data) => data.entries),
  forPage: (token: string, pageId: string) => request<{ entries: CodexJournalEntry[] }>(token, `/journal?pageId=${pageId}`).then((data) => data.entries),
  forMarker: (token: string, markerId: string) => request<{ entries: CodexJournalEntry[] }>(token, `/journal?markerId=${markerId}`).then((data) => data.entries),
  create: (token: string, input: CodexJournalInput) => request<{ entry: CodexJournalEntry }>(token, "/journal", { method: "POST", body: JSON.stringify(input) }).then((data) => data.entry),
  update: (token: string, id: string, input: CodexJournalInput) => request<{ entry: CodexJournalEntry }>(token, `/journal/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((data) => data.entry),
  reveal: (token: string, id: string, revealed: boolean) => request<{ entry: CodexJournalEntry }>(token, `/journal/${id}/reveal`, { method: "POST", body: JSON.stringify({ revealed }) }).then((data) => data.entry),
  remove: (token: string, id: string) => request<{ deleted: boolean }>(token, `/journal/${id}`, { method: "DELETE" })
};
