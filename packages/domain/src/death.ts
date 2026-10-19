/** The tag on an effect that keeps a monster alive at 0 Hit Points without Unconscious (a vampire's mist form). */
export const ALIVE_AT_ZERO_TAG = "alive-at-zero";

/** What deciding life and death reads off a creature: the same fields on a stored actor and the GM's view. */
export type MortalCreature = Readonly<{
  kind: "player-character" | "monster" | "npc";
  hp: Readonly<{ current: number }>;
  deathSaves: Readonly<{ failures: number }> | null;
  conditions: ReadonlyArray<Readonly<{ id: string; level?: number }>>;
  effects?: ReadonlyArray<Readonly<{ tags: readonly string[] }>>;
}>;

/**
 * SRD 5.2.1 "Dead": the one rule for who is dead, shared so healing, rests, Hit Dice and the sheets agree. A
 * character dies on a third failed death save (massive damage counts as three) or at Exhaustion 6. A monster or NPC
 * dies the instant it drops to 0 Hit Points ("Monster Death"), unless it lies Unconscious there, which is how a
 * creature the GM treats like a character, or knocked out before the 1 HP rule, is told apart, or a trait holds it up
 * (a vampire's Misty Escape). A dead creature regains no hit points until something revives it.
 */
export function isDead(creature: MortalCreature): boolean {
  if ((creature.conditions.find((condition) => condition.id === "exhaustion")?.level ?? 0) >= 6) return true;
  if (creature.kind === "player-character") return (creature.deathSaves?.failures ?? 0) >= 3;
  if (creature.effects?.some((effect) => effect.tags.includes(ALIVE_AT_ZERO_TAG))) return false;
  return creature.hp.current <= 0 && !creature.conditions.some((condition) => condition.id === "unconscious");
}
