import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { mapCover, standingCover } from "./cover.js";
import { areEnemies } from "./creature-sides.js";
import { endEffect, type EffectNarration } from "./effects.js";

/** SRD Supreme Sneak (Thief 9), Stealth Attack: "If you have the Invisible condition from the Hide action, this attack
 *  doesn't end that condition on you if you end the turn behind Three-Quarters Cover or Total Cover." */
const stealthAttackKey = (actorId: string) => `${actorId}:stealth-attack`;

/** The attack kept the Hide action's Invisible: the turn's end decides whether it stays. */
export function markStealthAttack(state: GameState, actorId: string): void {
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [stealthAttackKey(actorId)]: 1 } }
  };
}

const COVERED = new Set(["three-quarters", "total"]);

/**
 * As the Rogue's turn ends after a Stealth Attack, the Hide action's Invisible ends unless it has Three-Quarters or
 * Total Cover from every enemy on the map, from the walls and creatures between them or the GM's mark. With dynamic
 * vision off the map measures nothing, so only the GM's mark keeps it, and without one it is left to the GM.
 */
export function stealthAttackAtTurnEnd(
  state: GameState,
  actorId: string,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): EffectNarration[] {
  if ((state.combat.turn.turnUses[stealthAttackKey(actorId)] ?? 0) === 0) return [];
  const rogue = state.actors.find((actor) => actor.id === actorId);
  const hidden = rogue?.effects.find((effect) => effect.tags.includes("hidden"));
  if (!rogue || !hidden || !state.combat.vision?.enabled) return [];
  if (COVERED.has(standingCover(rogue) ?? "")) return [];
  const placed = new Set(state.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId));
  if (!placed.has(rogue.id)) return [];
  const exposed = state.actors.some(
    (enemy) =>
      enemy.hp.current > 0 &&
      placed.has(enemy.id) &&
      areEnemies(rogue, enemy, resolveDefinition) &&
      !COVERED.has(mapCover(state, enemy.id, rogue.id) ?? "")
  );
  if (!exposed) return [];
  return [
    ...endEffect(state, rogue.id, hidden.id),
    {
      kind: "condition",
      text: `${rogue.name} ends the turn without Three-Quarters Cover or Total Cover, so the Stealth Attack reveals it.`,
      actorId: rogue.id
    }
  ];
}
