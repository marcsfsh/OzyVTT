/**
 * The remaster's reads and writes over `/api/v1/codex`: pages and quests as player text with hidden blocks, who sees
 * each block, field and objective, the filtered and sorted search, and the home aggregates. The server projects
 * every read for the token, so a player token gets the player shapes from the same routes.
 */

import type { CodexEntityType, CodexInWorldDate, CodexQuestStatus } from "@vtt/domain";
import { apiRequest, type ApiRequest } from "../lib/api";
import { newId } from "../lib/ids";
import type {
  CodexAudience,
  CodexFieldAudience,
  CodexHome,
  CodexPage,
  CodexPageConnection,
  CodexQuest,
  CodexSearchResult,
  CodexSearchType,
  CodexSearchVisibility,
  PlayerCodexHome,
  PlayerCodexPage,
  PlayerCodexPageConnection,
  PlayerCodexSearchResult
} from "./contract";

const BASE = "/api/v1/codex";

function request<T>(token: string, path: string, init: Omit<ApiRequest, "token" | "failure"> = {}): Promise<T> {
  return apiRequest<T>(`${BASE}${path}`, { ...init, token, failure: "The codex request failed." });
}

/** Every write carries a fresh idempotency key, so a retry after a dropped reply changes nothing twice. */
const write = <T>(token: string, path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown) =>
  request<T>(token, path, {
    method,
    ...(body === undefined ? {} : { body: { ...(body as object), commandId: newId() } })
  });

/** A block as the editor places it: every block of the record once, in document order, with its anchor. */
export type CodexBlockLayout = ReadonlyArray<Readonly<{ id: string; anchor: number }>>;

export type CodexPageWrite = Readonly<{
  title?: string;
  entityType?: CodexEntityType;
  /** Every field value, whatever its audience. */
  fields?: Readonly<Record<string, string>>;
  folder?: string | null;
  tags?: readonly string[];
  playerBody?: string;
  layout?: CodexBlockLayout;
  bannerAssetId?: string | null;
  inWorldDate?: CodexInWorldDate | null;
  expectedRev?: number;
}>;

export type CodexAudienceWrite = Readonly<{ audience: CodexAudience; characterIds?: readonly string[] }>;

/** The block routes, the same for a page and a quest. */
function blockRoutes<TRecord>(collection: "pages" | "quests", key: "page" | "quest") {
  type Answer = Record<string, TRecord>;
  const pick = (data: Answer) => data[key];
  return {
    add: (
      token: string,
      recordId: string,
      input: Readonly<{ anchor: number; slot?: number; title?: string | null; text: string; expectedRev?: number }>
    ) =>
      write<Answer & { block: { id: string } }>(token, `/${collection}/${recordId}/blocks`, "POST", input).then(
        (data) => ({ record: data[key], blockId: data.block.id })
      ),
    update: (
      token: string,
      recordId: string,
      blockId: string,
      input: Readonly<{ title?: string | null; text?: string; expectedRev?: number }>
    ) => write<Answer>(token, `/${collection}/${recordId}/blocks/${blockId}`, "PATCH", input).then(pick),
    move: (
      token: string,
      recordId: string,
      blockId: string,
      input: Readonly<{ anchor: number; slot?: number; expectedRev?: number }>
    ) => write<Answer>(token, `/${collection}/${recordId}/blocks/${blockId}/move`, "POST", input).then(pick),
    remove: (token: string, recordId: string, blockId: string) =>
      write<Answer>(token, `/${collection}/${recordId}/blocks/${blockId}`, "DELETE").then(pick),
    /** Not an edit: no `rev`, so an open editor's next save never conflicts with a reveal. */
    setAudience: (token: string, recordId: string, blockId: string, input: CodexAudienceWrite) =>
      write<Answer>(token, `/${collection}/${recordId}/blocks/${blockId}/audience`, "PUT", input).then(pick)
  };
}

export const pageRecordApi = {
  get: (token: string, id: string) =>
    request<{ page: CodexPage; connections: CodexPageConnection[] }>(token, `/pages/${id}`),
  getForPlayer: (token: string, id: string) =>
    request<{ page: PlayerCodexPage; connections: PlayerCodexPageConnection[] }>(token, `/pages/${id}`),
  update: (token: string, id: string, input: CodexPageWrite) =>
    write<{ page: CodexPage }>(token, `/pages/${id}`, "PATCH", input).then((data) => data.page),
  /** Not an edit. `key` must be a field of the page's kind. */
  setFieldAudience: (token: string, id: string, key: string, audience: CodexFieldAudience) =>
    write<{ page: CodexPage }>(token, `/pages/${id}/fields/${encodeURIComponent(key)}/audience`, "PUT", {
      audience
    }).then((data) => data.page),
  blocks: blockRoutes<CodexPage>("pages", "page")
};

export type CodexObjectiveWrite = Readonly<{
  /** Send it for an objective the server gave; leave it out for a new one. */
  id?: string;
  text: string;
  done: boolean;
  /** Only on a new objective. */
  audience?: CodexAudience;
  characterIds?: readonly string[];
}>;

export type CodexQuestWrite = Readonly<{
  title?: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  layout?: CodexBlockLayout;
  objectives?: readonly CodexObjectiveWrite[];
  entityIds?: readonly string[];
  tags?: readonly string[];
  expectedRev?: number;
}>;

export const questRecordApi = {
  get: (token: string, id: string) => request<{ quest: CodexQuest }>(token, `/quests/${id}`).then((data) => data.quest),
  update: (token: string, id: string, input: CodexQuestWrite) =>
    write<{ quest: CodexQuest }>(token, `/quests/${id}`, "PATCH", input).then((data) => data.quest),
  setObjectiveAudience: (token: string, id: string, objectiveId: string, input: CodexAudienceWrite) =>
    write<{ quest: CodexQuest }>(token, `/quests/${id}/objectives/${objectiveId}/audience`, "PUT", input).then(
      (data) => data.quest
    ),
  blocks: blockRoutes<CodexQuest>("quests", "quest")
};

// ----- Search and home -----

export type CodexSearchParams = Readonly<{
  q?: string;
  types?: readonly CodexSearchType[] | null;
  visibility?: CodexSearchVisibility;
  modifiedFrom?: string | null;
  modifiedTo?: string | null;
  /** `key` or `key:asc` / `key:desc`, first key first, at most 4. */
  sort?: readonly string[];
  limit?: number;
}>;

function searchQuery(params: CodexSearchParams): string {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.types && params.types.length > 0) query.set("types", params.types.join(","));
  if (params.visibility && params.visibility !== "all") query.set("visibility", params.visibility);
  if (params.modifiedFrom) query.set("modifiedFrom", params.modifiedFrom);
  if (params.modifiedTo) query.set("modifiedTo", params.modifiedTo);
  if (params.sort && params.sort.length > 0) query.set("sort", params.sort.join(","));
  if (params.limit) query.set("limit", String(params.limit));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const findApi = {
  search: (token: string, params: CodexSearchParams) =>
    request<CodexSearchResult>(token, `/search${searchQuery(params)}`),
  /** The player's search ignores `visibility`, so it is never sent. */
  searchAsPlayer: (token: string, params: CodexSearchParams) =>
    request<PlayerCodexSearchResult>(token, `/search${searchQuery({ ...params, visibility: "all" })}`),
  home: (token: string) => request<{ home: CodexHome }>(token, "/home").then((data) => data.home),
  /** What the player can read that is new or changed after `since`, their last visit. */
  homeForPlayer: (token: string, since: string | null) =>
    request<{ home: PlayerCodexHome }>(token, since ? `/home?since=${encodeURIComponent(since)}` : "/home").then(
      (data) => data.home
    )
};
