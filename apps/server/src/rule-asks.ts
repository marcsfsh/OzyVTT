import type { GameState, PendingRuleAsk } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

/**
 * THE ASK-THE-GM QUEUE (D8/D9). Before this, a player whose action the rules engine refused hit a
 * silent dead end: the server threw, the player runner showed nothing, and the only way forward was to
 * say something out loud and hope the GM reached for the right menu. Now the block carries one button;
 * this is where the tap lands.
 *
 * It follows the `pendingSaves`/`pendingReactions` idiom exactly, and for the same reasons: the queue
 * lives on `combat` so it parks and resumes with a scene and dies with the fight, the OWNER is never
 * stored (it is the parked character's live `ownerSessionId`), and the projection - not a filter at the
 * call site - decides whose question is whose.
 */

/** Never let a runaway client turn the GM's queue into a wall. Matches the schema's own `.max(10)`. */
const MAX_ASKS = 10;

/**
 * Park one ask. A second ask for the same character REPLACES the first: a player who taps a blocked
 * action twice is asking the same question, and two rows would make the GM answer it twice.
 */
export function parkRuleAsk(state: GameState, ask: PendingRuleAsk): PendingRuleAsk {
  const others = state.combat.pendingRuleAsks.filter((entry) => entry.actorId !== ask.actorId);
  if (others.length >= MAX_ASKS) throw new CommandRejectedError("The GM already has ten questions waiting - give them a moment.");
  state.combat = { ...state.combat, pendingRuleAsks: [...others, ask] };
  return ask;
}

/** One parked ask by id, or null. */
export function findRuleAsk(state: GameState, askId: string): PendingRuleAsk | null {
  return state.combat.pendingRuleAsks.find((entry) => entry.id === askId) ?? null;
}

/**
 * Remove one parked ask. Missing is a REJECTION, not a silent success: an ask that expired (the fight
 * ended, the scene changed, another GM tap answered it) must tell the answering GM so, rather than
 * letting them believe they allowed something that never ran.
 */
export function clearRuleAsk(state: GameState, askId: string): PendingRuleAsk {
  const ask = findRuleAsk(state, askId);
  if (!ask) throw new CommandRejectedError("That question is no longer waiting - the fight moved on.");
  state.combat = { ...state.combat, pendingRuleAsks: state.combat.pendingRuleAsks.filter((entry) => entry.id !== askId) };
  return ask;
}

/**
 * The payload to REPLAY on Allow, from the one the player originally sent.
 *
 * Two edits, both load-bearing:
 * - `expectedRevision` is STRIPPED. Every command schema carries it, and the parked value is the
 *   revision at ask time - which the ask itself, the GM's own reads, and any play since have all moved
 *   past. Replaying it would make every single Allow fail with a 409 stale-revision conflict. The
 *   re-run's idempotency comes from the server-minted commandId below, not from optimistic concurrency.
 * - `commandId` becomes the ASK's id - a server-minted uuid, stable for this ask. A duplicated
 *   `rules.answer` therefore replays a command the store has already receipted and returns the stored
 *   outcome instead of firing the action a second time.
 */
export function rerunPayload(ask: PendingRuleAsk, reason: string | undefined): Record<string, unknown> {
  return { ...withoutStaleRevision(ask.command.payload), commandId: ask.id, override: { ...(reason === undefined ? {} : { reason }) } };
}

/**
 * The payload to re-run when the ASK arrives (before anything is parked). Same `expectedRevision`
 * strip, same reason: the revision the player's blocked tap carried is already behind the table by the
 * time they reach for the button, and answering "Ask the GM" with a stale-revision conflict would be a
 * second silent dead end where the first one was. The optimistic-concurrency guard already did its job
 * on the original attempt; this is that same command being retried, not a new intent.
 */
export function askRerunPayload(payload: unknown): Record<string, unknown> {
  return withoutStaleRevision(payload);
}

function withoutStaleRevision(payload: unknown): Record<string, unknown> {
  const { expectedRevision: _stale, ...rest } = (payload ?? {}) as Record<string, unknown>;
  return rest;
}
