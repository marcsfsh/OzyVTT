import type { ClientToServerEvents } from "@vtt/domain";

/** Without `commandId`, which `command()` adds. */
export type SaveAnswerPayload = Omit<Parameters<ClientToServerEvents["save:answer"]>[0], "commandId">;

/**
 * The `save:answer` payload, in a plain module so `save-damage.mirror.test.ts` can run the server's
 * `answerSave` on it. A named excess property is a type error; a conditional spread is not.
 */
export function saveAnswerPayload(
  input: Readonly<{
    saveId: string;
    /** "fail": the creature chooses to fail without a roll. */
    method: "roll" | "manual" | "fail";
    commit: boolean;
    /** The GM's ruled save total: required by the server for `method: "manual"`, absent for a roll. */
    total?: number;
    /** The face a physical d20 shows, for `method: "roll"`; the server adds the bonus. */
    face?: number;
    /** The GM's forced Adv/Disadv, which wins over the engine's count; the server ignores a player's. */
    dieMode?: "advantage" | "disadvantage" | "normal";
    /** Throw the held die again: Heroic Inspiration for a player, free for the GM. */
    reroll?: boolean;
    legendaryResistance?: boolean;
    damageOverride?: number;
    /** An answer to the shown die (Bardic Inspiration, Indomitable), applied to the held roll. */
    answer?: Readonly<{ id: string; subtract?: boolean; face?: number }>;
  }>
): SaveAnswerPayload {
  return {
    saveId: input.saveId,
    method: input.method,
    commit: input.commit,
    ...(input.legendaryResistance ? { legendaryResistance: true } : {}),
    ...(input.total !== undefined ? { total: input.total } : {}),
    ...(input.face !== undefined ? { face: input.face } : {}),
    ...(input.dieMode ? { rollMode: input.dieMode } : {}),
    ...(input.reroll ? { reroll: true } : {}),
    ...(input.damageOverride !== undefined ? { damageOverride: input.damageOverride } : {}),
    ...(input.answer ? { answer: { ...input.answer } } : {})
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
