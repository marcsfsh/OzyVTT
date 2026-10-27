import type { GameState, SpellZone } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { removeZone, zoneContentOf } from "./spell-zone-state.js";

/**
 * Spilled Oil (SRD 5.2.1 Oil, Dousing a Space: "If lit, the oil burns until the end of the turn 2 rounds from when the
 * oil was lit (or 12 seconds) and deals 5 Fire damage to any creature that enters the area or ends its turn there"). The
 * area waits unlit and acts on no one; fire reaching it (`zone-fire.ts`) or a Tinderbox beside it lights it, and it burns
 * out at the end of the turn it was lit on, that many rounds later. Out of a fight its 12 seconds pass at once.
 */

/** Whether an area waits for fire before it acts. */
export const waitsUnlit = (zone: SpellZone, catalog: EquipmentCatalog | undefined): boolean =>
  zoneContentOf(zone, catalog)?.trigger.kindled !== undefined && zone.litUntil === undefined;

/** Lights an area that waits for fire: it burns from now for the rounds its trigger names. Returns the table's lines. */
export function lightZone(state: GameState, zone: SpellZone, catalog: EquipmentCatalog | undefined): EffectNarration[] {
  const kindled = zoneContentOf(zone, catalog)?.trigger.kindled;
  if (!kindled || zone.litUntil) return [];
  if (!state.combat.active) {
    removeZone(state, zone);
    return [{ kind: "effect", text: `${zone.name} flares up and burns away.`, actorId: zone.casterId }];
  }
  zone.litUntil = { untilRound: state.combat.round + kindled.rounds, actorId: state.combat.turnActorId };
  return [{ kind: "effect", text: `${zone.name} catches fire.`, actorId: zone.casterId }];
}

/** As a creature's turn ends: a lit area whose time is up burns out. */
export function burnedOutAtTurnEnd(state: GameState, actorId: string): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (!state.combat.active) return events;
  const round = state.combat.round;
  for (const zone of [...state.combat.spellZones]) {
    const lit = zone.litUntil;
    if (!lit) continue;
    const over =
      round > lit.untilRound || (round === lit.untilRound && (lit.actorId === null || lit.actorId === actorId));
    if (!over) continue;
    removeZone(state, zone);
    events.push({ kind: "effect", text: `${zone.name} burns out.`, actorId: zone.casterId });
  }
  return events;
}
