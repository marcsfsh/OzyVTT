import { isDead, type GameState } from "@vtt/domain";
import type { ActorDefinition, DamageDrain } from "@vtt/schemas";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { removeCombatant } from "./encounter.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { raiseCreature, type RaiseDeps } from "./summons.js";

/**
 * Creatures that rise from the dead at a rule's word (SRD Finger of Death: "A Humanoid killed by this spell rises at
 * the start of your next turn as a Zombie"): the corpse is marked as it dies, and its killer's next turn raises it on
 * the killer's side through `raiseCreature` (`summons.ts`), the one way a creature joins a side under another's orders.
 */

/** The tag on a corpse that rises as the monster it names at the start of its killer's next turn. */
const RISING_PREFIX = "rises-as-";

/**
 * Finger of Death: "A Humanoid killed by this spell rises at the start of your next turn as a Zombie ... that follows
 * your verbal orders." A creature of the named types that the damage killed is marked on its corpse, and its killer's
 * next turn raises it (`riseAtTurnStart`).
 */
export function markRising(
  state: GameState,
  corpse: GameState["actors"][number],
  definition: ActorDefinition | undefined,
  rise: NonNullable<DamageDrain["slainRise"]>,
  killerId: string | null | undefined
): EffectNarration[] {
  const killer = killerId ? state.actors.find((candidate) => candidate.id === killerId) : undefined;
  if (!killer || !state.combat.active) return [];
  const type = creatureTypeOf(corpse, definition, "true");
  if (rise.creatureTypes && (type === null || !rise.creatureTypes.includes(type))) return [];
  const monster = rise.monsterId.replace(/-/g, " ");
  addEffect(
    state,
    corpse.id,
    makeEffect({
      id: `${corpse.id}:${RISING_PREFIX}${rise.monsterId}`,
      name: `Rises as a ${monster}`,
      tags: [`${RISING_PREFIX}${rise.monsterId}`],
      sourceActorId: killer.id,
      sourceName: killer.name,
      startedRound: state.combat.round,
      duration: { type: "manual" }
    })
  );
  return [
    {
      kind: "effect",
      text: `${corpse.name} will rise as a ${monster} at the start of ${killer.name}'s next turn.`,
      actorId: corpse.id
    }
  ];
}

/** At the start of `actorId`'s turn, each corpse it marked to rise does: the creature stands in the corpse's space on
 *  its side, and the corpse leaves the fight. */
export function riseAtTurnStart(state: GameState, actorId: string, deps: RaiseDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  const maker = state.actors.find((candidate) => candidate.id === actorId);
  if (!maker || !state.combat.active) return events;
  for (const corpse of [...state.actors]) {
    const mark = corpse.effects.find(
      (effect) => effect.sourceActorId === actorId && effect.tags.some((tag) => tag.startsWith(RISING_PREFIX))
    );
    if (!mark) continue;
    events.push(...endEffect(state, corpse.id, mark.id));
    if (!isDead(corpse)) continue;
    const monsterId = mark.tags.find((tag) => tag.startsWith(RISING_PREFIX))!.slice(RISING_PREFIX.length);
    let raised: ReturnType<typeof raiseCreature>;
    try {
      raised = raiseCreature(state, { monsterId, maker, at: corpse, source: "Rises from the dead" }, deps);
    } catch {
      // A full roster leaves it to the GM.
      raised = null;
    }
    if (!raised) {
      events.push({
        kind: "effect",
        text: `${corpse.name} rises as a ${monsterId.replace(/-/g, " ")} under ${maker.name}'s orders. Add it to the fight.`,
        actorId: corpse.id,
        gmOnly: true
      });
      continue;
    }
    events.push({
      kind: "effect",
      text: `${corpse.name} rises as ${raised.name}, which follows ${maker.name}'s orders.`,
      actorId: raised.actorId
    });
    if (state.combat.initiative.some((entry) => entry.actorId === corpse.id) && state.combat.turnActorId !== corpse.id)
      events.push(...removeCombatant(state, corpse.id, deps.resolveDefinition));
  }
  return events;
}
