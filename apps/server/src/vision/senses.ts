import type { GameState } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition, type Modifier } from "@vtt/schemas";
import { itemIsActive, type EquipmentCatalog } from "../equipment-derivation.js";

/**
 * What a creature perceives with, in feet (SRD 5.2.1 Rules Glossary: Darkvision, Blindsight, Tremorsense, Truesight;
 * the See Invisibility spell; the Devil's Sight invocation; a Ring of X-ray Vision), and the lights it carries. Read
 * live from the content and the creature's effects every time, like every other rider, so an unequipped Torch, an
 * ended True Seeing or a rebuilt sheet needs no undo.
 */
export type Senses = Readonly<{
  darkvision: number;
  blindsight: number;
  tremorsense: number;
  truesight: number;
  /** Sees Invisible creatures as if they were visible, within this range (See Invisibility). */
  seeInvisibility: number;
  /** Sees normally in Dim Light and Darkness, magical or not, within this range (Devil's Sight). */
  devilsSight: number;
  /** Sees through walls within this range (a Ring of X-ray Vision). */
  xray: number;
}>;
export const NO_SENSES: Senses = {
  darkvision: 0,
  blindsight: 0,
  tremorsense: 0,
  truesight: 0,
  seeInvisibility: 0,
  devilsSight: 0,
  xray: 0
};

/** A `see-invisibility` sense authored with 0 feet sees as far as its bearer can see (the spell names no range). */
export const UNLIMITED_FEET = 100_000;

/** What the vision engine reads from outside the game state: bundled and homebrew stat blocks, and the catalog the
 *  species features and light-shedding items are in. Absent pieces mean fewer senses, never more. */
export type SightContent = Readonly<{
  definition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

type Actor = GameState["actors"][number];
type SenseName = keyof Senses;

/** The `sense` rider names dynamic vision reads, by the field each fills. */
const SENSE_FIELDS: Readonly<Record<string, SenseName>> = {
  darkvision: "darkvision",
  blindsight: "blindsight",
  tremorsense: "tremorsense",
  truesight: "truesight",
  "see-invisibility": "seeInvisibility",
  "devils-sight": "devilsSight",
  "x-ray": "xray"
};

/** A stat block's printed senses ("darkvision 60 ft.", "Blindsight 10 ft. (blind beyond this radius)"). */
function printedSenses(definition: ActorDefinition | undefined): Partial<Record<SenseName, number>> {
  const senses = (definition?.extensions["open5e.srd-2024"] as { senses?: unknown } | undefined)?.senses;
  const found: Partial<Record<SenseName, number>> = {};
  if (!Array.isArray(senses)) return found;
  for (const entry of senses) {
    if (typeof entry !== "string") continue;
    const match = entry.trim().match(/^(darkvision|blindsight|tremorsense|truesight)\s+(\d+)/i);
    if (!match) continue;
    const name = match[1]!.toLowerCase() as SenseName;
    found[name] = Math.max(found[name] ?? 0, Number.parseInt(match[2]!, 10));
  }
  return found;
}

/** A modifier block's senses: `darkvision` riders (those that extend kept apart, to add once the best is known), and
 *  `sense` riders naming one the engine reads. */
function riderSenses(modifiers: readonly Modifier[], into: Record<SenseName, number>, extensions: number[]) {
  for (const modifier of modifiers) {
    if (modifier.type === "darkvision") {
      if (modifier.extends === true) extensions.push(modifier.feet);
      else into.darkvision = Math.max(into.darkvision, modifier.feet);
    }
    if (modifier.type === "sense") {
      const field = SENSE_FIELDS[modifier.sense];
      if (!field) continue;
      const feet = field === "seeInvisibility" && modifier.feet === 0 ? UNLIMITED_FEET : modifier.feet;
      into[field] = Math.max(into[field], feet);
    }
  }
}

export function definitionOf(state: GameState, actor: Actor, content: SightContent): ActorDefinition | undefined {
  if (!actor.definitionId) return undefined;
  return (
    state.definitions.find((entry) => entry.id === actor.definitionId)?.definition ??
    content.definition?.(actor.definitionId)
  );
}

/** The best of each sense the creature has: its stat block's printed senses, its species, lineage, class options and
 *  feats, the active items it carries, and its live effects (True Seeing, the Darkvision spell). Goggles of Night add
 *  their feet to any other Darkvision. */
export function sensesOf(state: GameState, actor: Actor, content: SightContent): Senses {
  const definition = definitionOf(state, actor, content);
  const senses: Record<SenseName, number> = { ...NO_SENSES, ...printedSenses(definition) };
  const extensions: number[] = [];
  const catalog = content.catalog;
  if (catalog) {
    for (const held of definition?.character?.features ?? []) {
      const record = catalog.featureRecord?.(held);
      if (record) riderSenses(record.modifiers, senses, extensions);
    }
    for (const held of definition?.character?.feats ?? []) {
      const record = catalog.featRecord?.(held.id);
      if (record) riderSenses(record.feature.modifiers, senses, extensions);
    }
    for (const item of actor.inventory) {
      if (item.quantity <= 0) continue;
      const record = catalog.equipmentRecord(catalogIdOf(item));
      if (record && itemIsActive(item, record)) riderSenses(record.modifiers, senses, extensions);
    }
  }
  for (const effect of actor.effects) riderSenses(effect.modifiers, senses, extensions);
  for (const feet of extensions) senses.darkvision = senses.darkvision > 0 ? senses.darkvision + feet : feet;
  return senses;
}

/** A light a creature carries: a lit item in hand, an effect on it (Produce Flame, Faerie Fire's outline), or its
 *  own body (a fire elemental's Illumination). A Bullseye Lantern's is a Cone toward `facingDegrees` (0 is to the
 *  right of the map, clockwise). `reveals`: Invisible creatures in its Bright Light are seen (Lantern of Revealing). */
export type CarriedLight = Readonly<{
  brightFeet: number;
  dimFeet: number;
  sunlight: boolean;
  reveals: boolean;
  coneFacingDegrees: number | null;
}>;

/** The tag of an effect that puts out a creature's own light while it lasts (a magmin's flames out). */
export const LIGHT_OUT_TAG = "light-out";

/** Every light the creature carries: its lit items in hand, the lights its effects give it, and its stat block's own
 *  light unless an effect has put that out. */
export function carriedLightsOf(state: GameState, actor: Actor, content: SightContent): CarriedLight[] {
  const lights: CarriedLight[] = [];
  const catalog = content.catalog;
  if (catalog)
    for (const item of actor.inventory) {
      if (!item.equipped || item.quantity <= 0) continue;
      const record = catalog.equipmentRecord(catalogIdOf(item));
      const light = record?.light;
      if (!light || (item.lit !== true && light.always !== true) || !itemIsActive(item, record)) continue;
      const shed = item.hoodLowered === true && light.hooded ? light.hooded : light;
      if (shed.brightFeet + shed.dimFeet <= 0) continue;
      lights.push({
        brightFeet: shed.brightFeet,
        dimFeet: shed.dimFeet,
        sunlight: light.sunlight === true,
        reveals: light.revealsInvisible === true,
        coneFacingDegrees: light.cone === true ? (item.facingDegrees ?? 0) : null
      });
    }
  for (const effect of actor.effects) {
    if (!effect.light || effect.light.brightFeet + effect.light.dimFeet <= 0) continue;
    lights.push({
      brightFeet: effect.light.brightFeet,
      dimFeet: effect.light.dimFeet,
      sunlight: effect.light.sunlight === true,
      reveals: false,
      coneFacingDegrees: null
    });
  }
  if (!actor.effects.some((effect) => effect.tags.includes(LIGHT_OUT_TAG)))
    for (const trait of definitionOf(state, actor, content)?.traitMechanics ?? [])
      if (trait.kind === "light")
        lights.push({
          brightFeet: trait.brightFeet,
          dimFeet: trait.dimFeet,
          sunlight: false,
          reveals: false,
          coneFacingDegrees: null
        });
  return lights;
}
