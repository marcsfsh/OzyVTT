import type { GameState, SpellZone } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { laterRowOf } from "./item-actions.js";

/** The spell and its zone row a live zone names; undefined when the catalog no longer has them. */
export function zoneContentOf(zone: SpellZone, catalog: EquipmentCatalog | undefined) {
  const spell = catalog?.spellRecord?.(zone.spellId);
  const row = spell ? laterRowOf(spell, zone.laterActionId) : undefined;
  return spell && row?.zone ? { spell, row, trigger: row.zone } : undefined;
}

/** Removes a spell's zone (`combat.spellZones`) and the area it placed on the map. A zone that acts as its spell ends
 *  (Delayed Blast Fireball's bead) is left `bursting` instead, for `burstEndedZones` to raise its saves and remove, in a
 *  fight or out of one. */
export function endZone(state: GameState, zoneId: string): void {
  const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
  if (!zone) return;
  if (zone.burstsOnEnd && !zone.bursting) {
    zone.bursting = true;
    return;
  }
  removeZone(state, zone);
}

/** Takes a zone and its area off the table, whatever it does as it ends. */
export function removeZone(state: GameState, zone: SpellZone): void {
  state.combat = {
    ...state.combat,
    spellZones: state.combat.spellZones.filter((candidate) => candidate.id !== zone.id),
    annotations:
      zone.annotationId === null
        ? state.combat.annotations
        : state.combat.annotations.filter((annotation) => annotation.id !== zone.annotationId)
  };
}

/** The zones a Concentration cast holds end with it. */
export function endZonesOfCast(state: GameState, castId: string): void {
  for (const zone of state.combat.spellZones) if (zone.castId === castId) endZone(state, zone.id);
}

/** Counts damage a zone dealt toward the cap its spell prints, and ends it there (SRD Guardian of Faith: "The guardian
 *  vanishes when it has dealt a total of 60 damage"). */
export function countZoneDamage(
  state: GameState,
  zoneId: string | undefined,
  amount: number,
  catalog: EquipmentCatalog | undefined
): EffectNarration[] {
  const zone = zoneId ? state.combat.spellZones.find((candidate) => candidate.id === zoneId) : undefined;
  if (!zone || amount <= 0) return [];
  zone.damageDealt = Math.min(100000, zone.damageDealt + amount);
  const cap = zoneContentOf(zone, catalog)?.trigger.damageCap;
  if (cap === undefined || zone.damageDealt < cap) return [];
  endZone(state, zone.id);
  return [{ kind: "effect", text: `${zone.name} ends after dealing ${cap} damage.`, actorId: zone.casterId }];
}
