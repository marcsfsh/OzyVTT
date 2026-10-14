import type { ClientToServerEvents } from "@vtt/domain";

export type SaveAnswerPayload = Parameters<ClientToServerEvents["save:answer"]>[0];

/**
 * The `save:answer` payload, in a plain module so `save-damage.mirror.test.ts` can run the server's
 * `answerSave` on it. A named excess property is a type error; a conditional spread is not.
 */
export function saveAnswerPayload(
  input: Readonly<{
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
  }>
): SaveAnswerPayload {
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
 * The damage field as an amend, or `undefined`: no field (no-damage saves), empty (the roll stands)
 * or equal to the proposal. Out-of-range numbers are sent anyway so the server's bound message shows.
 */
export function saveDamageAmend(proposedDamage: number, typed: string | null): number | undefined {
  if (proposedDamage <= 0) return undefined;
  if (typed === null || typed.trim() === "") return undefined;
  const amount = Number(typed);
  if (!Number.isInteger(amount)) return undefined;
  return amount === proposedDamage ? undefined : amount;
}
