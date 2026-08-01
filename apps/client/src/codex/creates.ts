import { questApi, sessionApi, type CodexQuest, type CodexSession } from "./api";
import type { SessionRef } from "./sessions";
import { newId } from "../lib/ids";

/**
 * D7 — **one create per record type, wherever the create is started from.**
 *
 * `QuickCreate` is that door for pages (name + kind, one step). Sessions and quests need no dialog —
 * their create is a single call with a sensible default — but they still had only ONE door each: the
 * "New" button on their own rail. The command palette offered rows labelled "New session" and "New
 * quest" that merely navigated to the list, which is the same target as the "Go to Sessions"/"Go to
 * Quests" rows six lines below them, so the GM still had to find the rail button. A verb that does not
 * do the thing it is named for is worse than no verb.
 *
 * These two functions are what both doors call now, so "create a session" means one thing in the app —
 * including the number suggestion, which is a reading rule about the list rather than a rule of the
 * route, and the idempotency key, which a double-tapped phone button needs and the rail's create was
 * missing (D19).
 *
 * Deliberately here and not in `sessions.ts` / `quests.ts`: those are pure reading rules with no
 * network in them, and both the GM record and the player projection satisfy their types. A create is a
 * GM write, so it does not belong in a module a player surface imports.
 */

/** The number to suggest for the next session: one past the highest that exists. */
export function nextSessionNumber(sessions: readonly SessionRef[]): number {
  return sessions.reduce((best, session) => Math.max(best, session.sessionNumber ?? 0), 0) + 1;
}

/**
 * Create a session and hand it back for the caller to open.
 *
 * The number is *suggested*, not demanded — a duplicate is a clean 400 whose message is written for a GM
 * to read, so the suggestion can be wrong without being destructive.
 */
export function createSession(gmToken: string, sessions: readonly SessionRef[]): Promise<CodexSession> {
  return sessionApi.create(gmToken, { sessionNumber: nextSessionNumber(sessions), status: "planned", commandId: newId() });
}

/**
 * Create a quest and hand it back for the caller to open.
 *
 * A title is required by the route (`min(1)`), so one is supplied rather than sending a blank and
 * letting the server 400 at a GM who has not typed anything yet — the editor opens on it immediately.
 */
export function createQuest(gmToken: string): Promise<CodexQuest> {
  return questApi.create(gmToken, { title: "Untitled quest", commandId: newId() });
}
