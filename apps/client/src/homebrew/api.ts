/**
 * Bearer-authorized fetch helpers for the GM-only homebrew API (`/api/v1/homebrew/*`), typed against
 * `HOMEBREW_PATHS` and the `Homebrew*Schema` shapes in `@vtt/api-contract`. Players read homebrew only through the
 * content catalogs and the Compendium built for them (`/api/v1/content/*`); nothing here is ever called with a
 * player's token. A 404 on the collection means the surface is not mounted, and the page says so.
 */

import {
  HOMEBREW_PATHS,
  type HomebrewAudience,
  type HomebrewConflict,
  type HomebrewContentList,
  type HomebrewContentType,
  type HomebrewImportDecision,
  type HomebrewOverview,
  type HomebrewPack,
  type HomebrewPackImport,
  type HomebrewPackInfo,
  type HomebrewPackList,
  type HomebrewRecordDocument,
  type HomebrewRecordSummary,
  type HomebrewRevisionList,
  type HomebrewRevisionRead,
  type HomebrewSearch,
  type HomebrewSrdRecord,
  type HomebrewTable,
  type HomebrewUsages,
  type HomebrewValidationIssue
} from "@vtt/api-contract";
import type { ContentCompendium, ContentCompendiumKind, HomebrewSeeAsRecord } from "@vtt/domain";
import { apiRequest, type ApiError, type ApiRequest } from "../lib/api";

export type {
  HomebrewAudience,
  HomebrewConflict,
  HomebrewImportDecision,
  HomebrewOverview,
  HomebrewPack,
  HomebrewPackImport,
  HomebrewPackInfo,
  HomebrewPackList,
  HomebrewRecordDocument,
  HomebrewRecordSummary,
  HomebrewSearch,
  HomebrewSrdRecord,
  HomebrewTable,
  HomebrewUsages,
  HomebrewValidationIssue
};
export type HomebrewState = HomebrewRecordDocument["state"];
export type HomebrewValidity = HomebrewRecordDocument["validity"];
export type HomebrewDependent = HomebrewUsages["dependents"]["ifRemoved"][number];
export type HomebrewTableRow = HomebrewTable["rows"][number];
export type HomebrewRevisionSummary = HomebrewRevisionList["revisions"][number];
export type HomebrewImportRecord = HomebrewPackImport["records"][number];
/** Who the See as read reads as: everyone, or one party character by actor id. */
export type SeeAs = "everyone" | (string & {});

/** Who sees a record, as one value: the audience and, for `characters`, who. */
export type RecordAudience = Readonly<{ audience: HomebrewAudience; characterIds: readonly string[] }>;

export type HomebrewListQuery = Readonly<{
  type?: HomebrewContentType;
  state?: HomebrewState;
  audience?: HomebrewAudience;
  packId?: string;
  /** Case-insensitive name substring. */
  q?: string;
  includeDeleted?: boolean;
  limit?: number;
  /** Opaque keyset cursor; never construct or parse one. */
  cursor?: string;
}>;

/** A publish the stored state refuses carries every blocker in `details.invalid.issues`. */
export function invalidIssuesOf(error: ApiError): readonly HomebrewValidationIssue[] {
  const invalid = error.details?.invalid as { issues?: readonly HomebrewValidationIssue[] } | undefined;
  return invalid?.issues ?? [];
}

/** What the server's copy changed since this editor's revision, on a 409 for a stale `expectedRev`. */
export function conflictOf(error: ApiError): HomebrewConflict | null {
  const conflict = error.details?.conflict as HomebrewConflict | undefined;
  return conflict && Array.isArray(conflict.changes) ? conflict : null;
}

const path = (template: string, params: Readonly<Record<string, string | number>>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(params[key])));

const request = <T>(token: string, url: string, init: Omit<ApiRequest, "token" | "failure"> = {}) =>
  apiRequest<T>(url, { ...init, token, failure: "The homebrew request failed." });

function search(params: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === false) continue;
    if (Array.isArray(value)) for (const entry of value) query.append(key, entry);
    else query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** Optional optimistic concurrency; omitted means last writer wins. */
const withRev = (expectedRev?: number) => (expectedRev === undefined ? {} : { expectedRev });

type One = { record: HomebrewRecordDocument };
const one = (data: One) => data.record;

export const homebrewApi = {
  /** GET /content: flat summaries. Keyset paging: pass back `nextCursor` verbatim. */
  list: (token: string, params: HomebrewListQuery = {}) =>
    request<HomebrewContentList>(token, `${HOMEBREW_PATHS.content}${search(params)}`),

  /** POST /content: a Hidden draft in this table's pack, its id minted from the name it carries. */
  create: (token: string, record: Readonly<Record<string, unknown>>) =>
    request<One>(token, HOMEBREW_PATHS.content, { method: "POST", body: { record } }).then(one),

  get: (token: string, id: string) => request<One>(token, path(HOMEBREW_PATHS.contentById, { id })).then(one),

  /** PATCH /content/{id}: replaces the whole authored body; leaves state, audience and archive alone. */
  update: (token: string, id: string, record: Readonly<Record<string, unknown>>, expectedRev?: number) =>
    request<One>(token, path(HOMEBREW_PATHS.contentById, { id }), {
      method: "PATCH",
      body: { record, ...withRev(expectedRev) }
    }).then(one),

  /** DELETE /content/{id}: archive. Restore brings it back; nothing is destroyed. */
  remove: (token: string, id: string) =>
    request<{ id: string; deleted: true; deletedAt: string }>(token, path(HOMEBREW_PATHS.contentById, { id }), {
      method: "DELETE"
    }),

  restore: (token: string, id: string) =>
    request<One>(token, path(HOMEBREW_PATHS.contentRestore, { id }), { method: "POST" }).then(one),

  /** POST /content/{id}/duplicate: `id` may be an SRD id. The copy is a Hidden draft that keeps `basedOn`. */
  duplicate: (token: string, id: string, name: string) =>
    request<One>(token, path(HOMEBREW_PATHS.contentDuplicate, { id }), { method: "POST", body: { name } }).then(one),

  publish: (token: string, id: string, expectedRev?: number) =>
    request<One>(token, path(HOMEBREW_PATHS.contentPublish, { id }), {
      method: "POST",
      body: withRev(expectedRev)
    }).then(one),

  /** POST /content/{id}/discard: drops a published record's changes that are not live. */
  discard: (token: string, id: string, expectedRev?: number) =>
    request<One>(token, path(HOMEBREW_PATHS.contentDiscard, { id }), {
      method: "POST",
      body: withRev(expectedRev)
    }).then(one),

  /** POST /content/{id}/unpublish: back to a draft, which is always Hidden. */
  unpublish: (token: string, id: string, expectedRev?: number) =>
    request<One>(token, path(HOMEBREW_PATHS.contentUnpublish, { id }), {
      method: "POST",
      body: withRev(expectedRev)
    }).then(one),

  /** PUT /content/{id}/audience: Hidden, Everyone, or chosen party characters. A draft can only be Hidden. */
  setAudience: (token: string, id: string, audience: RecordAudience, expectedRev?: number) =>
    request<One>(token, path(HOMEBREW_PATHS.contentAudience, { id }), {
      method: "PUT",
      body: {
        audience: audience.audience,
        ...(audience.audience === "characters" ? { characterIds: audience.characterIds } : {}),
        ...withRev(expectedRev)
      }
    }).then(one),

  /** POST /sharing: one audience for many records, all of them or none. */
  setSharing: (
    token: string,
    records: ReadonlyArray<Readonly<{ id: string; expectedRev?: number }>>,
    audience: RecordAudience
  ) =>
    request<{ records: HomebrewRecordSummary[] }>(token, HOMEBREW_PATHS.sharing, {
      method: "POST",
      body: {
        records,
        audience: audience.audience,
        ...(audience.audience === "characters" ? { characterIds: audience.characterIds } : {})
      }
    }).then((data) => data.records),

  /** GET /content/{id}/usages: which characters took this, and which published records depend on it. */
  usages: (token: string, id: string) => request<HomebrewUsages>(token, path(HOMEBREW_PATHS.contentUsages, { id })),

  revisions: (token: string, id: string) =>
    request<HomebrewRevisionList>(token, path(HOMEBREW_PATHS.contentRevisions, { id })).then((data) => data.revisions),
  revision: (token: string, id: string, revisionId: number) =>
    request<HomebrewRevisionRead>(token, path(HOMEBREW_PATHS.contentRevision, { id, revisionId })).then(
      (data) => data.revision
    ),
  /** Puts an old version back as the editor's copy: changes not live for a published record. */
  restoreRevision: (token: string, id: string, revisionId: number, expectedRev?: number) =>
    request<One>(token, path(HOMEBREW_PATHS.contentRevisionRestore, { id, revisionId }), {
      method: "POST",
      body: withRev(expectedRev)
    }).then(one),

  /** GET /table: the SRD rows and the homebrew of one kind, in one shape. */
  table: (token: string, kind: HomebrewContentType, includeArchived = false) =>
    request<HomebrewTable>(token, `${HOMEBREW_PATHS.table}${search({ kind, includeArchived })}`),
  overview: (token: string) => request<HomebrewOverview>(token, HOMEBREW_PATHS.overview),
  /** GET /search: homebrew names and text, with the line that matched. */
  search: (token: string, q: string, params: Readonly<{ kind?: HomebrewContentType; limit?: number }> = {}) =>
    request<HomebrewSearch>(token, `${HOMEBREW_PATHS.search}${search({ q, ...params })}`),
  /** GET /srd/{id}: an SRD record as an authorable body, for its card and for Compare. */
  srdRecord: (token: string, id: string) => request<HomebrewSrdRecord>(token, path(HOMEBREW_PATHS.srdRecord, { id })),

  packs: (token: string) => request<HomebrewPackList>(token, HOMEBREW_PATHS.packs),
  updatePack: (
    token: string,
    packId: string,
    patch: Readonly<{ name?: string; credit?: string | null; enabled?: boolean }>
  ) =>
    request<{ pack: HomebrewPackInfo }>(token, path(HOMEBREW_PATHS.packById, { packId }), {
      method: "PATCH",
      body: patch
    }).then((data) => data.pack),

  /** GET /packs/export: the chosen published records as one pack under a name. */
  exportPack: (
    token: string,
    params: Readonly<{ ids?: readonly string[]; packId?: string; name?: string; credit?: string }> = {}
  ) =>
    request<{ pack: HomebrewPack }>(
      token,
      `${HOMEBREW_PATHS.packsExport}${search({ id: params.ids, packId: params.packId, name: params.name, credit: params.credit })}`
    ).then((data) => data.pack),

  /** POST /packs/import with a decision per record. An empty list in a dry run asks for each record's default. */
  importPack: (token: string, pack: HomebrewPack, decisions: readonly HomebrewImportDecision[], dryRun = false) =>
    request<HomebrewPackImport>(token, HOMEBREW_PATHS.packsImport, {
      method: "POST",
      body: { pack, decisions, dryRun }
    }),

  /** What one player gets of one record: whether it reaches them, and the Compendium row they get. */
  seeAsContent: (token: string, id: string, as: SeeAs) =>
    request<HomebrewSeeAsRecord>(token, `${path(HOMEBREW_PATHS.seeAsContent, { id })}${search({ as })}`),
  seeAsCompendium: (token: string, as: SeeAs, kind: ContentCompendiumKind) =>
    request<ContentCompendium>(token, `${HOMEBREW_PATHS.seeAsCompendium}${search({ as, kind })}`)
};

/** Reads every keyset page, archived rows included, so every count the page shows is exact. */
export async function listAllHomebrew(
  token: string,
  params: HomebrewListQuery = {}
): Promise<readonly HomebrewRecordSummary[]> {
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
