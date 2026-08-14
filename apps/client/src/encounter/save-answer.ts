import type { ClientToServerEvents } from "@vtt/domain";

export type SaveAnswerPayload = Parameters<ClientToServerEvents["save:answer"]>[0];

/**
 * THE `save:answer` WIRE PAYLOAD, built in one place.
 *
 * `SavePrompt` is the only emitter, so this could have stayed an inline spread - and it did, until
 * issue `4b` gave the prompt an editable damage field. The far-end proof for that field has to run
 * the SERVER's `answerSave` against the bytes the client really sends, and the prompt is a `.tsx`
 * that imports its own CSS, which the node-environment mirror project cannot load. A plain module
 * lets `save-damage.mirror.test.ts` import the real builder instead of retyping the payload beside
 * it - and a retyped payload is exactly the kind of test that passes while the app is broken.
 *
 * The shape is the domain contract's, not a copy of it: `SaveAnswerPayload` is read off
 * `ClientToServerEvents`, so a field this builder forgets is a typecheck failure rather than a
 * silently-dropped key. (A NAMED excess property errors; a conditional spread does not - which is
 * how `damageOverride` reached the server for months without the contract mentioning it.)
 */
export function saveAnswerPayload(input: Readonly<{
  commandId: string;
  saveId: string;
  method: "roll" | "manual";
  commit: boolean;
  /** The rolled save total: required by the server for `method: "manual"`, absent for a fresh roll. */
  total?: number;
  /** The answerer's explicit Adv/Disadv choice; wins over the engine's aggregated sources. */
  dieMode?: "advantage" | "disadvantage" | "normal";
  legendaryResistance?: boolean;
  damageOverride?: number;
}>): SaveAnswerPayload {
  return {
    commandId: input.commandId,
    saveId: input.saveId,
    method: input.method,
    commit: input.commit,
    ...(input.legendaryResistance ? { legendaryResistance: true } : {}),
    ...(input.total !== undefined ? { total: input.total } : {}),
    ...(input.dieMode ? { rollMode: input.dieMode } : {}),
    ...(input.damageOverride !== undefined ? { damageOverride: input.damageOverride } : {})
  };
}

/**
 * What the answerer typed into the save's damage field, as an AMEND - or `undefined` when there is
 * nothing to amend.
 *
 * Three "nothing to amend" cases, and each is deliberate:
 *  - a save that deals no damage (Grapple and Shove mint these) has no field to type into;
 *  - an empty field means "the rolled proposal stands", the same as never touching it, so clearing
 *    it is a way back rather than a way to deal 0 damage - typing `0` is how you say none;
 *  - a number equal to the proposal is not an amend, so the untouched path stays byte-identical on
 *    the wire (the guard `PendingDamagePrompt` and `ActionRunner` already use).
 *
 * OUT-OF-RANGE NUMBERS TRAVEL ON PURPOSE. The server owns the 0-1000 bound: `SaveAnswerSchema`
 * (`apps/server/src/game-commands.ts`) refuses before the command runs, and `save.answer` is one of
 * the two commands that surface the failing issue's own message, so the prompt shows **"Enter the
 * damage as a whole number from 0 to 1000."** Swallowing a typed 99999 here would silently apply the
 * ROLLED number instead - a wrong number with no complaint, which is worse than a refusal.
 *
 * This paragraph was false until 2026-08-10 and is the reason the claim is now sourced. The bound
 * was a bare `.max(1000)`, so what a GM actually read was zod's own "Number must be less than or
 * equal to 1000" - a sentence about a schema, in a prompt about a dragon.
 */
export function saveDamageAmend(proposedDamage: number, typed: string | null): number | undefined {
  if (proposedDamage <= 0) return undefined;
  if (typed === null || typed.trim() === "") return undefined;
  const amount = Number(typed);
  if (!Number.isInteger(amount)) return undefined;
  return amount === proposedDamage ? undefined : amount;
}
