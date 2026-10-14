import { questApi, sessionApi, type CodexQuest, type CodexSession } from "./api";
import type { SessionRef } from "./sessions";
import { newId } from "../lib/ids";

/** Creates shared by the rails and the command palette. GM-only, so kept out of modules player surfaces import. */

export function nextSessionNumber(sessions: readonly SessionRef[]): number {
  return sessions.reduce((best, session) => Math.max(best, session.sessionNumber ?? 0), 0) + 1;
}

/** A duplicate number is a clean 400, so the suggestion can be wrong without harm. */
export function createSession(gmToken: string, sessions: readonly SessionRef[]): Promise<CodexSession> {
  return sessionApi.create(gmToken, { sessionNumber: nextSessionNumber(sessions), status: "planned", commandId: newId() });
}

/** The route requires a title, so a default is supplied. */
export function createQuest(gmToken: string): Promise<CodexQuest> {
  return questApi.create(gmToken, { title: "Untitled quest", commandId: newId() });
}
