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

/** Removes a spell's zone (`combat.spellZones`) and the area it placed on the map. */
export function endZone(state: GameState, zoneId: string): void {
  const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
  if (!zone) return;
  state.combat = {
    ...state.combat,
    spellZones: state.combat.spellZones.filter((candidate) => candidate.id !== zoneId),
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

/** Counts damage a zone dealt toward the cap its spell prints, ending it there (SRD Guardian of Faith: "The guardian
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
  return [{ kind: "effect", text: `${zone.name} ends, having dealt ${cap} damage.`, actorId: zone.casterId }];
}
