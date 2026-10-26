import type { GameState } from "@vtt/domain";
import { checkPlan } from "./ability-checks.js";
import { rollSettledCheck } from "./check-rolls.js";
import { addEffect, makeEffect, type EffectNarration } from "./effects.js";
import { deriveEquipment } from "./equipment-derivation.js";
import { endSpellZone } from "./spell-endings.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { exposed, insideTest, liveZones, type ZoneDeps } from "./spell-zones.js";
import { altitudeOf } from "./altitude.js";

/**
 * A wall of water that moves and wanes (SRD 5.2.1 Tsunami): "At the end of the turn, the wall's height is reduced by 50
 * feet, and the damage the wall deals on later rounds is reduced by 1d10. When the wall reaches 0 feet in height, the
 * spell ends", and "A creature caught in the wall can move by swimming. Because of the wave's force, though, the
 * creature must succeed on a Strength (Athletics) check against your spell save DC to move at all. If it fails the
 * check, it can't move." Its drift, carrying the creatures in it, is `spell-zones.ts`'s.
 */

/** The effect a creature held by the wave carries for the rest of its turn: Speed 0. */
export const WAVE_HELD_TAG = "held-by-wave";

/** At the end of its caster's turn on which it moved, the wave loses height and a die of damage, and ends at none. */
export function wavesAtTurnEnd(state: GameState, casterId: string, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const zone of liveZones(state)) {
    if (zone.casterId !== casterId || !zone.driftedThisTurn) continue;
    const content = zoneContentOf(zone, deps.catalog);
    const fades = content?.trigger.fadesFeet;
    delete zone.driftedThisTurn;
    if (!content || fades === undefined) continue;
    zone.faded = Math.min(100, (zone.faded ?? 0) + 1);
    const height = (zone.area?.heightFeet ?? content.area?.heightFeet ?? 0) - zone.faded * fades;
    if (height > 0) {
      events.push({
        kind: "effect",
        text: `${zone.name} sinks to ${height} feet high, and its damage drops by a die.`,
        actorId: zone.casterId
      });
      continue;
    }
    events.push(...endSpellZone(state, zone));
  }
  return events;
}

/** As a creature's turn starts inside a wave, it tries the Strength (Athletics) check the wave asks to move at all;
 *  on a failure it can't move this turn. */
export function wavesAtTurnStart(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (!state.combat.active) return events;
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content?.trigger.athleticsToMove) continue;
    const creature = exposed(state, zone, content.trigger, deps).find((candidate) => candidate.id === actorId);
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (!creature || !token || !inside?.(token.position!, token.sizeCells, altitudeOf(token))) continue;
    const definition = creature.definitionId ? deps.resolveDefinition(creature.definitionId) : undefined;
    const plan = checkPlan(creature, definition, deriveEquipment(creature, definition, deps.catalog), {
      ability: "str",
      skill: "athletics"
    });
    const roll = rollSettledCheck(
      state,
      creature,
      plan,
      {
        id: deps.newId(),
        commandId: deps.newId(),
        sessionId: "00000000-0000-4000-8000-000000000000",
        role: "gm",
        label: `${plan.label} to move in ${zone.name}`,
        visibility: creature.visibility === "gm-only" ? "gm-only" : "public",
        createdAt: deps.now()
      },
      deps.rollDie
    );
    const success = roll.total >= zone.dc;
    events.push({
      kind: "effect",
      text: `${creature.name} fights the wave of ${zone.name}: ${roll.total} against DC ${zone.dc}, ${success ? "and can swim this turn" : "and can't move this turn"}.`,
      actorId: creature.id
    });
    if (success) continue;
    try {
      addEffect(
        state,
        creature.id,
        makeEffect({
          id: `${zone.id}:held:${creature.id}:${state.combat.round}`,
          name: `Held by ${zone.name}`,
          tags: [WAVE_HELD_TAG],
          sourceActorId: zone.casterId,
          sourceName: state.actors.find((actor) => actor.id === zone.casterId)?.name ?? null,
          startedRound: state.combat.round,
          duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false },
          speedZero: true
        })
      );
    } catch {
      // A creature already holding as many effects as it can keeps moving.
    }
  }
  return events;
}
