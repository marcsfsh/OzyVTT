/**
 * Bearer-authorized fetch helpers for the GM-only homebrew API (`/api/v1/homebrew/*`), typed
 * against `HOMEBREW_PATHS` and the `Homebrew*Schema` shapes in `@vtt/api-contract`. Players see
 * homebrew only through the merged `/api/v1/content/*` catalogs (published, visible, not deleted).
 * A 404 on the collection means the surface is not mounted; the panel says so rather than
 * showing an empty library.
 */

import type { HomebrewType } from "./types";

const BASE = "/api/v1/homebrew";

export type HomebrewState = "draft" | "published";

/** The offending field as a path, so an editor can point at it. */
export type HomebrewValidationIssue = Readonly<{
  path: ReadonlyArray<string | number>;
  message: string;
  recordId: string | null;
}>;
export type HomebrewValidity = Readonly<{ valid: boolean; issues: readonly HomebrewValidationIssue[] }>;

/** Flat list row; the polymorphic body is fetched per record. */
export type HomebrewRecordSummary = Readonly<{
  id: string;
  type: HomebrewType;
  name: string;
  source: "homebrew";
  state: HomebrewState;
  visibleToPlayers: boolean;
  deletedAt: string | null;
  rev: number;
  updatedAt: string;
  valid: boolean;
  usageCount: number;
}>;

/** One record with its row state and full validity report. */
export type HomebrewRecordDocument = Readonly<{
  id: string;
  type: HomebrewType;
  state: HomebrewState;
  visibleToPlayers: boolean;
  deletedAt: string | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  validity: HomebrewValidity;
  record: Readonly<Record<string, unknown>>;
}>;

export type HomebrewContentList = Readonly<{
  records: readonly HomebrewRecordSummary[];
  nextCursor: string | null;
  total: number;
}>;

export type HomebrewUsage = Readonly<{ actorId: string; actorName: string; kind: string; detail: string | null }>;
export type HomebrewUsages = Readonly<{ id: string; usages: readonly HomebrewUsage[]; safeToDelete: boolean }>;

export type HomebrewPack = Readonly<{
  schemaId: "vtt.homebrew-pack";
  schemaVersion: 1;
  name: string;
  attribution: string | null;
  exportedAt: string;
  records: ReadonlyArray<Readonly<Record<string, unknown>>>;
}>;

export type HomebrewPackImportReport = Readonly<{
  imported: ReadonlyArray<{ id: string; type: HomebrewType; name: string; originalId: string }>;
  reminted: ReadonlyArray<{ originalId: string; id: string; reason: "srd-collision" | "homebrew-collision" }>;
  overwritten: ReadonlyArray<{ id: string; type: HomebrewType; name: string }>;
  rejected: ReadonlyArray<{ originalId: string; issues: readonly HomebrewValidationIssue[] }>;
  dryRun: boolean;
}>;

export type HomebrewListQuery = Readonly<{
  type?: HomebrewType;
  state?: HomebrewState;
  visibleToPlayers?: boolean;
  /** Case-insensitive name substring. */
  q?: string;
  includeDeleted?: boolean;
  limit?: number;
  /** Opaque keyset cursor; never construct or parse one. */
  cursor?: string;
}>;

/** A failed homebrew request: HTTP status (404 = surface not mounted), stable error code, the
    row's revision on a 409, and the raw `details` (where `invalid.issues` lives on a rejected publish). */
export class HomebrewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly currentRevision: number | null = null,
    readonly details: Readonly<Record<string, unknown>> | null = null
  ) {
    super(message);
    this.name = "HomebrewRequestError";
  }

  /** Optimistic-concurrency conflict: the row changed under us. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** A publish the stored state refuses: `details.invalid.issues` lists every blocker. */
  get invalidIssues(): readonly HomebrewValidationIssue[] {
    const invalid = this.details?.invalid as { issues?: readonly HomebrewValidationIssue[] } | undefined;
    return invalid?.issues ?? [];
  }
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
    });
  } catch {
    // A network failure has no status or message; report it plainly.
    throw new HomebrewRequestError("Couldn't reach the server.", 0, "offline");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new HomebrewRequestError(
      body?.error?.message ?? `The homebrew request failed (${response.status}).`,
      response.status,
      body?.error?.code ?? "error",
      typeof body?.error?.currentRevision === "number" ? body.error.currentRevision : null,
      body?.error?.details ?? null
    );
  }
  return body.data as T;
}

function query(params: HomebrewListQuery): string {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.state) search.set("state", params.state);
  if (params.visibleToPlayers !== undefined) search.set("visibleToPlayers", String(params.visibleToPlayers));
  if (params.q) search.set("q", params.q);
  if (params.includeDeleted) search.set("includeDeleted", "true");
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Optional optimistic concurrency; omitted means last writer wins. */
const withRev = (expectedRev?: number) => (expectedRev === undefined ? {} : { expectedRev });

export const homebrewApi = {
  /** GET /content — flat summaries. Keyset paging: pass back `nextCursor` verbatim. */
  list: (token: string, params: HomebrewListQuery = {}) =>
    request<HomebrewContentList>(token, `/content${query(params)}`),

  /** POST /content — always lands as `state: "draft"`, `visibleToPlayers: false`. */
  create: (token: string, record: Readonly<Record<string, unknown>>) =>
    request<{ record: HomebrewRecordDocument }>(token, "/content", { method: "POST", body: JSON.stringify({ record }) }).then((data) => data.record),

  /** GET /content/{id} — the record plus its full validity report. */
  get: (token: string, id: string) =>
    request<{ record: HomebrewRecordDocument }>(token, `/content/${encodeURIComponent(id)}`).then((data) => data.record),

  /** PATCH /content/{id} — replaces the whole authored body (no partial merge); leaves state,
      visibility and deletedAt alone. */
  update: (token: string, id: string, record: Readonly<Record<string, unknown>>, expectedRev?: number) =>
    request<{ record: HomebrewRecordDocument }>(token, `/content/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ record, ...withRev(expectedRev) })
    }).then((data) => data.record),

  /** DELETE /content/{id} — soft delete, idempotent. Restorable; nothing is destroyed. */
  remove: (token: string, id: string) =>
    request<{ id: string; deleted: true; deletedAt: string }>(token, `/content/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** POST /content/{id}/restore — the explicit inverse of soft delete, never a PATCH of `deletedAt: null`. */
  restore: (token: string, id: string) =>
    request<{ record: HomebrewRecordDocument }>(token, `/content/${encodeURIComponent(id)}/restore`, { method: "POST" }).then((data) => data.record),

  /** POST /content/{id}/duplicate — `{id}` may be an SRD id. The copy lands as a draft hidden from players. */
  duplicate: (token: string, id: string, name?: string) =>
    request<{ record: HomebrewRecordDocument }>(token, `/content/${encodeURIComponent(id)}/duplicate`, {
      method: "POST",
      body: JSON.stringify(name === undefined ? {} : { name })
    }).then((data) => data.record),

  /** POST /content/{id}/publish — requires validity. Publishing does not show it to players. */
  publish: (token: string, id: string, expectedRev?: number) =>
    request<{ record: HomebrewRecordDocument }>(token, `/content/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      body: JSON.stringify(withRev(expectedRev))
    }).then((data) => data.record),

  /** POST /content/{id}/unpublish — back to draft; it leaves the merged catalogs at once. */
  unpublish: (token: string, id: string, expectedRev?: number) =>
    request<{ record: HomebrewRecordDocument }>(token, `/content/${encodeURIComponent(id)}/unpublish`, {
      method: "POST",
      body: JSON.stringify(withRev(expectedRev))
    }).then((data) => data.record),

  /** POST /content/{id}/visibility — orthogonal to `state`; asking for it on a draft is a loud 409. */
  setVisibility: (token: string, id: string, visibleToPlayers: boolean, expectedRev?: number) =>
    request<{ record: HomebrewRecordDocument }>(token, `/content/${encodeURIComponent(id)}/visibility`, {
      method: "POST",
      body: JSON.stringify({ visibleToPlayers, ...withRev(expectedRev) })
    }).then((data) => data.record),

  /** GET /content/{id}/usages — which characters took this, computed on demand. */
  usages: (token: string, id: string) =>
    request<HomebrewUsages>(token, `/content/${encodeURIComponent(id)}/usages`),

  /** GET /packs/export — published, non-deleted records as a shareable pack. */
  exportPack: (token: string, params: Readonly<{ type?: HomebrewType; ids?: readonly string[] }> = {}) => {
    const search = new URLSearchParams();
    if (params.type) search.set("type", params.type);
    for (const id of params.ids ?? []) search.append("id", id);
    const text = search.toString();
    return request<{ pack: HomebrewPack }>(token, `/packs/export${text ? `?${text}` : ""}`).then((data) => data.pack);
  },

  /** POST /packs/import — everything lands as a hidden draft. `dryRun` returns the same report
      without writing, so the plan can be shown before an overwrite runs. */
  importPack: (
    token: string,
    pack: HomebrewPack,
    options: Readonly<{ onIdCollision?: "remint" | "overwrite"; dryRun?: boolean }> = {}
  ) =>
    request<HomebrewPackImportReport>(token, "/packs/import", {
      method: "POST",
      body: JSON.stringify({ pack, onIdCollision: options.onIdCollision ?? "remint", dryRun: options.dryRun ?? false })
    })
};

/** Reads every keyset page. Fetching the whole library, removed rows included, keeps every derived
    count in the modebar and rail exact, including "N removed records are hidden". */
export async function listAllHomebrew(token: string, params: HomebrewListQuery = {}): Promise<readonly HomebrewRecordSummary[]> {
  const rows: HomebrewRecordSummary[] = [];
  let cursor: string | null = null;
  // Page ceiling so a server that always returns a cursor cannot loop forever.
  for (let page = 0; page < 50; page += 1) {
    const result: HomebrewContentList = await homebrewApi.list(token, {
      includeDeleted: true,
      limit: 200,
      ...params,
      ...(cursor ? { cursor } : {})
    });
    rows.push(...result.records);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return rows;
}
