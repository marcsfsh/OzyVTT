import type {
  CodexJournalEntry,
  CodexLiveBoard,
  CodexLiveClue,
  CodexMarker,
  CodexPrepTemplate,
  CodexPrepTemplateList,
  CodexPrepTemplateSectionInput,
  CodexSession,
  CodexSessionHappened
} from "@vtt/domain";
import { apiRequest } from "../../lib/api";
import { newId } from "../../lib/ids";

/**
 * The GM-only reads and writes behind prep that `api.ts` doesn't carry: the template library, making a session from
 * a template, the live board, the recap's sources and the party's position. A session's own reads and saves are
 * `sessionApi`. Every write carries a `commandId`, so a retried request replays.
 */

const BASE = "/api/v1/codex";

function call<T>(
  token: string,
  path: string,
  init: Readonly<{ method?: "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown }> = {}
) {
  const body =
    init.body !== undefined && typeof init.body === "object" && init.body !== null
      ? { commandId: newId(), ...init.body }
      : init.body;
  return apiRequest<T>(`${BASE}${path}`, { token, method: init.method, body, failure: "The codex request failed." });
}

export const templateApi = {
  list: (token: string) => call<CodexPrepTemplateList>(token, "/prep-templates"),
  create: (token: string, input: Readonly<{ name: string; sections?: readonly CodexPrepTemplateSectionInput[] }>) =>
    call<{ template: CodexPrepTemplate }>(token, "/prep-templates", { method: "POST", body: input }).then(
      (data) => data.template
    ),
  update: (
    token: string,
    id: string,
    input: Readonly<{ name?: string; sections?: readonly CodexPrepTemplateSectionInput[]; expectedRev?: number }>
  ) =>
    call<{ template: CodexPrepTemplate }>(token, `/prep-templates/${id}`, { method: "PATCH", body: input }).then(
      (data) => data.template
    ),
  remove: (token: string, id: string) =>
    call<{ deleted: boolean }>(token, `/prep-templates/${id}`, { method: "DELETE" }),
  duplicate: (token: string, id: string, name?: string) =>
    call<{ template: CodexPrepTemplate }>(token, `/prep-templates/${id}/duplicate`, {
      method: "POST",
      body: name ? { name } : {}
    }).then((data) => data.template),
  setDefault: (token: string, id: string) =>
    call<{ defaultTemplateId: string }>(token, `/prep-templates/${id}/default`, { method: "POST", body: {} }).then(
      (data) => data.defaultTemplateId
    )
};

export type NewSessionInput = Readonly<{
  sessionNumber: number | null;
  realDate?: string | null;
  /** Omitted copies the default template; null starts with no sections. */
  templateId?: string | null;
}>;

export const prepSessionApi = {
  create: (token: string, input: NewSessionInput) =>
    call<{ session: CodexSession }>(token, "/sessions", {
      method: "POST",
      body: { status: "planned", ...input }
    }).then((data) => data.session),
  /** Copies the template's sections in its order and keeps what each matching section holds. */
  applyTemplate: (token: string, id: string, templateId: string, expectedRev?: number) =>
    call<{ session: CodexSession }>(token, `/sessions/${id}/apply-template`, {
      method: "POST",
      body: { templateId, ...(expectedRev === undefined ? {} : { expectedRev }) }
    }).then((data) => data.session)
};

export const liveApi = {
  /** The active session's board, or null when no session is active. */
  board: (token: string) => call<{ board: CodexLiveBoard | null }>(token, "/board").then((data) => data.board),
  happened: (token: string, sessionId: string) =>
    call<{ happened: CodexSessionHappened }>(token, `/sessions/${sessionId}/happened`).then((data) => data.happened),
  /** Files a note under the session, dated at the GM's date. Hidden unless `revealedToPlayers`. */
  log: (token: string, sessionId: string, text: string, revealedToPlayers = false) =>
    call<{ entry: CodexJournalEntry }>(token, `/sessions/${sessionId}/log`, {
      method: "POST",
      body: { text, revealedToPlayers }
    }).then((data) => data.entry),
  tick: (token: string, sessionId: string, itemId: string, done: boolean) =>
    call<{ session: CodexSession; clue: CodexLiveClue }>(token, `/sessions/${sessionId}/tick`, {
      method: "POST",
      body: { itemId, done }
    }),
  currentScene: (token: string, sessionId: string, sceneId: string | null) =>
    call<{ session: CodexSession }>(token, `/sessions/${sessionId}/current-scene`, {
      method: "POST",
      body: { sceneId }
    }).then((data) => data.session)
};

export const partyApi = {
  /** Moves the party pin to this point in one write, or makes one there when the atlas has none. */
  set: (token: string, input: Readonly<{ mapId: string; x: number; y: number }>) =>
    call<{ marker: CodexMarker; created: boolean }>(token, "/party", { method: "POST", body: input })
};
