import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState, SpellZone } from "@vtt/domain";
import type { ActionArea, AreaTrigger } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { laterRowOf } from "./item-actions.js";

/** A spell's area at the level it is cast: its size grows by the spell's `areaPerSlot` feet for each slot level above
 *  its own (Fog Cloud's radius by 20, Confusion's by 5, Create or Destroy Water's Cube by 5). */
export function areaAtLevel(
  area: ActionArea,
  spell: Pick<SpellReference, "level" | "effect">,
  level: number | undefined
): ActionArea {
  const grows = spell.effect?.areaPerSlot;
  const above = Math.max(0, (level ?? spell.level) - spell.level);
  return grows && above > 0 ? { ...area, sizeFeet: Math.min(1000, area.sizeFeet + grows * above) } : area;
}

type LaterRow = NonNullable<NonNullable<SpellReference["effect"]>["laterActions"]>[number];

/** What a live zone acts by: its trigger, its name in narration and the template it stands on, and for a spell's area
 *  the spell and its zone row. */
export type ZoneContent = Readonly<{
  trigger: AreaTrigger;
  name: string;
  area: ActionArea | null;
  spell?: SpellReference;
  row?: LaterRow;
}>;

/** What a live zone acts by: an item's or a creature's area carries its rule, a spell's area names its spell and zone
 *  row; undefined when the catalog no longer has them. */
export function zoneContentOf(zone: SpellZone, catalog: EquipmentCatalog | undefined): ZoneContent | undefined {
  if (zone.rule) return { trigger: zone.rule.trigger, name: zone.name, area: zone.area };
  const spell = catalog?.spellRecord?.(zone.spellId);
  const row = spell ? laterRowOf(spell, zone.laterActionId) : undefined;
  return spell && row?.zone
    ? { spell, row, trigger: row.zone, name: spell.name, area: zone.area ?? spell.area }
    : undefined;
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

/** The zone an item's use left, as one for each area the use placed (a Ring of Shooting Stars' lightning spheres): each
 *  on its own area, acting and ending on its own, with the damage its trigger gives for that many areas. */
export function zoneForEachArea(state: GameState, zoneId: string, moreAreaIds: readonly string[]): void {
  const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
  if (!zone?.rule) return;
  const byCount = zone.rule.trigger.damageByCount;
  const formula = byCount?.[Math.min(moreAreaIds.length + 1, byCount.length) - 1];
  if (formula)
    zone.rule = {
      ...zone.rule,
      damage: zone.rule.damage.map((part, index) => (index === 0 ? { ...part, formula } : part))
    };
  const copies = moreAreaIds.map((id) => ({ ...structuredClone(zone), id, annotationId: id }));
  state.combat = { ...state.combat, spellZones: [...state.combat.spellZones, ...copies].slice(-20) };
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
