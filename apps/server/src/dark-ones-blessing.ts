import type { GameState } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import { areEnemies } from "./creature-sides.js";
import type { EffectNarration } from "./effects.js";

type Actor = GameState["actors"][number];

/** How far from the fallen enemy the Warlock may stand when someone else drops it: "within 10 feet of you". */
const BLESSING_REACH_FEET = 10;

/**
 * SRD Dark One's Blessing: "When you reduce an enemy to 0 Hit Points, you gain Temporary Hit Points equal to your
 * Charisma modifier plus your Warlock level (minimum of 1 Temporary Hit Point). You also gain this benefit if someone
 * else reduces an enemy within 10 feet of you to 0 Hit Points." Run once a creature has dropped to 0; the Warlock keeps
 * the higher of its Temporary Hit Points. Someone else's kill needs the map's distance.
 */
export function blessOnTheKill(
  state: GameState,
  fallen: Actor,
  sourceActorId: string | null | undefined,
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  }>
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const warlock of state.actors) {
    if (warlock.id === fallen.id || warlock.hp.current <= 0) continue;
    const definition = warlock.definitionId ? deps.resolveDefinition(warlock.definitionId) : undefined;
    if (!holdsFeature(definition, "dark-ones-blessing", "Dark One's Blessing")) continue;
    if (!areEnemies(warlock, fallen, deps.resolveDefinition)) continue;
    const distance = deps.distanceFeet?.(warlock.id, fallen.id) ?? null;
    if (warlock.id !== sourceActorId && (distance === null || distance > BLESSING_REACH_FEET + 0.5)) continue;
    const level = definition?.character?.classes.find((entry) => entry.id === "warlock")?.level ?? 0;
    const amount = Math.max(1, (definition ? abilityModifier(definition.abilityScores.cha) : 0) + level);
    if (amount <= warlock.hp.temporary) continue;
    warlock.hp = { ...warlock.hp, temporary: amount };
    events.push({
      kind: "effect",
      text: `${warlock.name} gains ${amount} Temporary Hit Points (Dark One's Blessing).`,
      actorId: warlock.id
    });
  }
  return events;
}
