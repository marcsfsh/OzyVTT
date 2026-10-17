import type { GameState, PendingRuleAsk, RuleFamily } from "@vtt/domain";
import { CommandRejectedError, type RulesBlockedError } from "./game-store.js";
import { familyOf, type RuleId, type RulesOverride } from "./rules-families.js";

/**
 * The ask-the-GM queue for actions the rules engine refused. Follows the `pendingSaves` /
 * `pendingReactions` pattern: it lives on `combat` (parks and resumes with a scene, dies with the
 * fight), the owner is never stored (it is the parked character's live `ownerSessionId`), and the
 * projection decides who sees which ask.
 */

/** Caps the GM's queue against a runaway client; matches the schema's `.max(10)`. */
const MAX_ASKS = 10;

/** Parks one ask. A second ask for the same character replaces the first (same question, one row). */
export function parkRuleAsk(state: GameState, ask: PendingRuleAsk): PendingRuleAsk {
  const others = state.combat.pendingRuleAsks.filter((entry) => entry.actorId !== ask.actorId);
  if (others.length >= MAX_ASKS)
    throw new CommandRejectedError("The GM already has ten questions waiting. Give the GM a moment.");
  state.combat = { ...state.combat, pendingRuleAsks: [...others, ask] };
  return ask;
}

/** One parked ask by id, or null. */
export function findRuleAsk(state: GameState, askId: string): PendingRuleAsk | null {
  return state.combat.pendingRuleAsks.find((entry) => entry.id === askId) ?? null;
}

/** Removes one parked ask. Missing is a rejection, so a GM answering an expired ask (fight ended, scene
 *  changed, already answered) is told rather than believing it ran. */
export function clearRuleAsk(state: GameState, askId: string): PendingRuleAsk {
  const ask = findRuleAsk(state, askId);
  if (!ask) throw new CommandRejectedError("That question is no longer waiting. The fight moved on.");
  state.combat = {
    ...state.combat,
    pendingRuleAsks: state.combat.pendingRuleAsks.filter((entry) => entry.id !== askId)
  };
  return ask;
}

/**
 * The payload to replay on Allow:
 * - `expectedRevision` is stripped: the parked value is stale by the time the GM answers, so every
 *   Allow would 409. Idempotency comes from the commandId instead.
 * - `commandId` becomes the ask's server-minted id, so a duplicated `rules.answer` returns the stored
 *   outcome instead of firing the action twice.
 * - The override waives only the family the GM was asked about, plus any an earlier Allow on this ask
 *   already covered, so allowing one kind of block never waves another through.
 */
export function rerunPayload(ask: PendingRuleAsk, reason: string | undefined): Record<string, unknown> {
  const payload = withoutStaleRevision(ask.command.payload);
  const families = allowedFamilies(ask);
  return {
    ...payload,
    commandId: ask.id,
    override: {
      ...(reason === undefined ? {} : { reason }),
      ...(families.length > 0 ? { families } : {})
    }
  };
}

/** The families an Allow on this ask covers: the one it asks about and those earlier Allows covered. */
function allowedFamilies(ask: PendingRuleAsk): readonly RuleFamily[] {
  const earlier = ((ask.command.payload as { override?: RulesOverride } | null)?.override?.families ?? []).filter(
    (family) => family !== ask.family
  );
  return ask.family === null ? earlier : [...earlier, ask.family];
}

/** Whether an Allow on this ask already covers a block of this rule; a block it covers is the command's own
 *  refusal, which no further Allow could get past. */
export function allowCovers(ask: PendingRuleAsk, rule: RuleId): boolean {
  return allowedFamilies(ask).includes(familyOf(rule));
}

/** Re-asks a command an Allow let past one block only for it to hit a block of another family: a new ask about
 *  the new block, carrying the families already allowed so the next Allow adds to them. The fresh id means a
 *  retried answer to the old ask finds nothing, rather than running the command on an Allow the GM never gave. */
export function reaskRuleAsk(
  state: GameState,
  ask: PendingRuleAsk,
  blocked: RulesBlockedError,
  id: string
): PendingRuleAsk {
  const allowed = allowedFamilies(ask);
  const payload = (ask.command.payload ?? {}) as Record<string, unknown>;
  return parkRuleAsk(state, {
    ...ask,
    id,
    rule: blocked.rule,
    family: familyOf(blocked.rule),
    message: blocked.message,
    command: { type: ask.command.type, payload: { ...payload, override: { families: allowed } } }
  });
}

/** The payload to re-run when the ask arrives. `expectedRevision` is stripped for the same reason: the
 *  original attempt already passed the concurrency guard, and this is a retry of that command. */
export function askRerunPayload(payload: unknown): Record<string, unknown> {
  return withoutStaleRevision(payload);
}

function withoutStaleRevision(payload: unknown): Record<string, unknown> {
  const { expectedRevision: _stale, ...rest } = (payload ?? {}) as Record<string, unknown>;
  return rest;
}
