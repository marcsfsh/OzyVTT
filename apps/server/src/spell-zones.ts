import { CREATURE_TYPE_IDS, type SpellReference, type SpellZone as ZoneTrigger } from "@vtt/content-srd-5.2.1";
import type { GameState, SpellZone } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { catalogIdOf, type ActorAction, type ActorDefinition } from "@vtt/schemas";
import { shapeGeometry } from "./annotations.js";
import { footprintCellCenters, footprintInTemplate } from "./area-targeting.js";
import { gridToImage } from "./grid-calibration.js";
import { holdsFeature } from "./class-features.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { areAllies, areEnemies } from "./creature-sides.js";
import { CONCENTRATING_TAG, endEffectIfPresent, type EffectNarration } from "./effects.js";
import { itemIsActive, type EquipmentCatalog } from "./equipment-derivation.js";
import { applyDamageDetailed, damageAdjustmentDetail, healActor } from "./hit-points.js";
import { laterRowOf, laterSpellAction, laterSpellActionId, upcastAction } from "./item-actions.js";
import { creatureDistance, DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import { CommandRejectedError } from "./game-store.js";
import { failureEffectFor } from "./resolution/pending.js";
import { createPendingSaves } from "./saving-throws.js";
import { countZoneDamage, endZone, removeZone, zoneContentOf, type ZoneContent } from "./spell-zone-state.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
import { withArticle } from "@vtt/domain";
import { altitudeOf, heightSpan } from "./altitude.js";
import { bandTest, ringTest } from "./zone-shapes.js";
import { pullTokenToward } from "./forced-movement.js";
import { AURA_IMMUNE_TAG } from "./statblock-traits.js";
import { breakTimeStop } from "./time-stop.js";
import { applyCastSight } from "./vision/cast-sight.js";
import { harmObjectsUnderZone } from "./resolution/object-targets.js";
import { prismaticWallLayers } from "./resolution/prismatic.js";
import { sceneSight } from "./vision/sight.js";
import { spellWardOf } from "./resolution/spell-wards.js";
import { planeOf } from "./ethereal.js";
import { burnedOutAtTurnEnd } from "./zone-kindling.js";
import { waterOf } from "./water.js";

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

/**
 * SRD spells that act after the cast on a creature that enters an area or starts or ends its turn there (Spirit
 * Guardians, Moonbeam, Web, a wall of fire). The cast leaves a zone (`combat.spellZones`) on the area it placed on the
 * map, or around its caster for an Emanation; the server watches token moves, the area moving, and the turn's start
 * and end, and raises the save or deals the damage for the creature then, once a turn where the text says so. A zone
 * ends with the Concentration that holds it (`effects.ts`), with its duration, at the fight's end, or by the GM.
 */

export type ZoneDeps = Readonly<{
  /** The live map's geometry; without a calibrated grid nothing is measured and the GM runs the zone by hand. */
  geometry: TokenMapGeometry | null;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  rollDie: (sides: number) => number;
  newId: () => string;
  /** ISO time for the prompts it opens. */
  now: () => string;
}>;

/** How a creature met the zone, for its narration and its marks. */
type Meeting =
  | "enters"
  | "is caught by"
  | "ends its turn in"
  | "starts its turn in"
  | "moves through"
  | "is set upon by"
  | "is caught in the blast of"
  | "is caught in"
  | "is swept up by"
  | "is bathed in";

/** An area that acts as it is cast acts on each creature the cast caught (SRD Conjure Celestial: "For each creature
 *  you can see in the Cylinder, choose which of these lights shines on it"), marked so it isn't affected again this
 *  turn. */
export function actOnCast(
  state: GameState,
  zone: SpellZone,
  creatureIds: readonly string[],
  deps: ZoneDeps,
  meeting: Extract<Meeting, "is bathed in" | "is caught by"> = "is bathed in"
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const content = zoneContentOf(zone, deps.catalog);
  if (!content) return events;
  for (const creature of exposed(state, zone, content.trigger, deps))
    if (creatureIds.includes(creature.id)) act(state, zone, creature, meeting, deps, events);
  return events;
}

/** The plural a picked creature type is offered as ("Antipathy (humanoids)"). */
const TYPE_PLURALS: Readonly<Record<string, string>> = { fey: "fey", monstrosity: "monstrosities", undead: "undead" };
const pluralOf = (type: string) => TYPE_PLURALS[type] ?? `${type}s`;

/** The zone rows a spell's cast picks among, with the creature type picked with it (`picksType`: Antipathy/Sympathy's
 *  "specify a kind of creature" makes one option per type). */
type LaterRow = NonNullable<NonNullable<SpellReference["effect"]>["laterActions"]>[number];
type ZonePick = Readonly<{ id: string; name: string; row: LaterRow; type?: string; parts?: readonly string[] }>;
function zoneRowPicks(spell: SpellReference): ZonePick[] {
  return (spell.effect?.laterActions ?? []).flatMap((row): ZonePick[] => {
    const option = row.option;
    if (row.zone?.picks) return partPicks(row, row.zone.picks);
    if (!row.zone || !option) return [];
    if (!row.zone.picksType) return [{ id: option.id, name: option.name, row }];
    return CREATURE_TYPE_IDS.map((type) => ({
      id: `${option.id}-${type}`,
      name: `${option.name} (${pluralOf(type)})`,
      row,
      type
    }));
  });
}

/** The options a zone row's picks make: each part (`one`: Hallow's extra effect), or every set of them, largest first
 *  (`any`: Private Sanctum's properties, "Fog and no teleporting"). */
function partPicks(row: LaterRow, picks: NonNullable<ZoneTrigger["picks"]>): ZonePick[] {
  const parts = picks.parts;
  if (picks.pick === "one") return parts.map((part) => ({ id: part.id, name: part.name, row, parts: [part.id] }));
  const sets: Array<typeof parts> = [];
  for (let mask = (1 << parts.length) - 1; mask > 0; mask--) sets.push(parts.filter((_, index) => mask & (1 << index)));
  sets.sort((a, b) => b.length - a.length);
  const listed = (names: readonly string[]) =>
    names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!.toLowerCase()}`;
  return sets.map((set) => ({
    id: set.map((part) => part.id).join("--"),
    name: listed(set.map((part, index) => (index === 0 ? part.name : part.name.toLowerCase()))).slice(0, 60),
    row,
    parts: set.map((part) => part.id)
  }));
}

/** The parts a cast's option picked for its zone (Private Sanctum's properties), or, with no option, every part of a
 *  row that picks any of them and the first of one that picks one. */
export function pickedZoneParts(spell: SpellReference, optionId: string | undefined): string[] | undefined {
  const picked = optionId === undefined ? undefined : zoneRowPicks(spell).find((pick) => pick.id === optionId);
  if (picked?.parts) return [...picked.parts];
  const picks = zoneRowOf(spell)?.zone?.picks;
  if (!picks) return undefined;
  return picks.pick === "any" ? picks.parts.map((part) => part.id) : [picks.parts[0]!.id];
}

/** The later action whose zone this spell leaves, if any: the one its cast picked among the spell's options (Wall of
 *  Fire's ring), else the first. */
export function zoneRowOf(spell: SpellReference, optionId?: string) {
  const rows = (spell.effect?.laterActions ?? []).filter((row) => row.zone !== undefined);
  const picked = optionId !== undefined ? zoneRowPicks(spell).find((pick) => pick.id === optionId) : undefined;
  return picked?.row ?? rows[0];
}

/** The creature type a cast's option picked for its zone to act on (Antipathy/Sympathy's goblins), if any. */
export const pickedZoneType = (spell: SpellReference, optionId: string | undefined): string | undefined =>
  optionId === undefined ? undefined : zoneRowPicks(spell).find((pick) => pick.id === optionId)?.type;

/** The options a spell's cast picks its zone by (Wall of Fire's forms, a Symbol's glyphs), each with the area the
 *  cast is placed as when it differs from the spell's own (a ring). Empty for a spell with none. */
export function zoneOptionsOf(
  spell: SpellReference
): Array<Readonly<{ id: string; name: string; area?: NonNullable<SpellReference["area"]> }>> {
  return zoneRowPicks(spell).map(({ id, name, row }) => ({
    id,
    name,
    ...(row.area && row.option ? { area: row.area } : {})
  }));
}

/** What a use offers its user to pick, as the sheet lists it: the effects it picks one of (Enlarge or Reduce), or for a
 *  spell's cast the forms of the area it leaves (Wall of Fire's ring). */
export function castOptionsOf(
  action: Pick<ActorAction, "id" | "effectOptions" | "spellId">,
  spell: SpellReference | undefined
): Readonly<{ options?: ReturnType<typeof zoneOptionsOf>; wardTypes?: string[] }> {
  if (action.effectOptions)
    return { options: action.effectOptions.map((option) => ({ id: option.id, name: option.name })) };
  if (!spell || action.spellId !== spell.id || laterRowOf(spell, action.id)) return {};
  const options = zoneOptionsOf(spell);
  // The types its barrier may ward, for the caster to pick among (Magic Circle, Hallow).
  const row = zoneRowOf(spell);
  const wardTypes = row?.zone?.choosesTypes ? row.zone.bars?.types : undefined;
  return {
    ...(options.length > 0 ? { options } : {}),
    ...(wardTypes ? { wardTypes: [...wardTypes] } : {})
  };
}

/** The zone row a cast's option names, refusing one the spell doesn't offer. Undefined for a spell with no options or
 *  a cast that names none. */
export function pickedZoneRow(spell: SpellReference, optionId: string | undefined) {
  const options = zoneOptionsOf(spell);
  if (options.length === 0 || optionId === undefined) return undefined;
  if (!options.some((option) => option.id === optionId))
    throw new CommandRejectedError(
      `${spell.name} offers ${options.map((option) => option.name).join(" or ")}. Choose one of them.`
    );
  return zoneRowOf(spell, optionId);
}

/** Whether a zone still stands: its caster holds the Concentration it belongs to, or still carries the effect a spell
 *  with no Concentration left on it (which lasts its duration in a fight and on the game clock outside one). */
export function zoneHeld(state: GameState, zone: SpellZone): boolean {
  const caster = state.actors.find((actor) => actor.id === zone.casterId);
  if (!caster) return false;
  if (zone.castId !== null)
    return caster.effects.some((effect) => effect.castId === zone.castId && effect.tags.includes(CONCENTRATING_TAG));
  if (zone.effectId !== undefined) return caster.effects.some((effect) => effect.id === zone.effectId);
  return true;
}

/** Ends every zone whose Concentration or effect has gone, with its area; runs after every command, so an area leaves
 *  the map as its spell ends however that happened (time passing, a fight's end, Dispel Magic). */
export function pruneEndedZones(state: GameState): void {
  for (const zone of [...state.combat.spellZones])
    if (!zone.bursting && !zoneHeld(state, zone)) endZone(state, zone.id);
}

/** Ends a zone by a ruling (webs burned away, a glyph that went off), and with it a spell with no Concentration whose
 *  effect on the caster only kept the area. A Concentration spell's caster keeps concentrating. */
export function endZoneAndItsSpell(state: GameState, zoneId: string): EffectNarration[] {
  const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
  if (!zone) return [];
  endZone(state, zone.id);
  return zone.effectId !== undefined ? endEffectIfPresent(state, zone.casterId, zone.effectId) : [];
}

/** The zones still standing; one whose Concentration has gone is removed on the way, and one bursting as its spell
 *  ended acts only in `burstEndedZones`. */
export function liveZones(state: GameState): SpellZone[] {
  pruneEndedZones(state);
  return state.combat.spellZones.filter((zone) => !zone.bursting);
}

const tokenOf = (state: GameState, actorId: string) =>
  state.combat.tokens.find((token) => token.actorId === actorId && token.position !== null);

/** The creatures an area can reach: the fight's, in turn order; outside a fight, everyone with a token on the map. */
function creaturesOnMap(state: GameState): Actor[] {
  const ids = state.combat.active
    ? state.combat.initiative.map((entry) => entry.actorId)
    : state.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId);
  return ids.flatMap((id) => {
    const creature = state.actors.find((actor) => actor.id === id);
    // A spell's area is on the plane it was cast on; a creature on the Border Ethereal is out of its reach.
    return creature && tokenOf(state, id) && planeOf(creature) === "material" ? [creature] : [];
  });
}

/** "Is a creature of this size, this high, at this point inside the zone?", or null when the map can't say (no grid,
 *  the area not placed, its caster off the map). `casterAt` stands the caster of an Emanation, or the target an area
 *  is round, somewhere else. A
 *  creature's height is 0 when the caller doesn't give it: on the ground. */
export function insideTest(
  state: GameState,
  zone: SpellZone,
  trigger: ZoneTrigger,
  source: Pick<ZoneContent, "area">,
  geometry: TokenMapGeometry | null,
  casterAt?: Point
): ((position: Point, sizeCells: number, altitudeFeet?: number) => boolean) | null {
  const whole = wholeAreaTest(state, zone, trigger, source, geometry, casterAt);
  const calibration = geometry?.calibration;
  if (!whole || !calibration || !zone.cut?.length) return whole;
  // The ground left out of it (Plant Growth's spared squares) or burned away (Web's) is no longer in it.
  const cut = new Set(zone.cut);
  return (position, sizeCells, altitudeFeet = 0) =>
    footprintCellCenters(calibration, position, sizeCells).some(
      (center) =>
        !cut.has(`${Math.floor(center.column)},${Math.floor(center.row)}`) &&
        whole(gridToImage(calibration, center), 1, altitudeFeet)
    );
}

/** The test for the whole of a zone's area, before any of it is left out. */
function wholeAreaTest(
  state: GameState,
  zone: SpellZone,
  trigger: ZoneTrigger,
  source: Pick<ZoneContent, "area">,
  geometry: TokenMapGeometry | null,
  casterAt?: Point
): ((position: Point, sizeCells: number, altitudeFeet?: number) => boolean) | null {
  const calibration = geometry?.calibration ?? null;
  if (!geometry || !calibration) return null;
  const cell = { sizeCells: 1, sizePx: calibration.cellSizePx };
  // Measured in three dimensions, so a flier far above an Emanation is out of it.
  const within =
    (from: Readonly<{ position: Point; sizeCells: number; sizePx: number; altitudeFeet?: number }>, feet: number) =>
    (position: Point, sizeCells: number, altitudeFeet = 0) => {
      const apart = creatureDistance(geometry, from, {
        position,
        sizeCells,
        sizePx: calibration.cellSizePx * sizeCells,
        altitudeFeet
      });
      return apart !== null && apart.value <= feet + DISTANCE_TOLERANCE_FEET;
    };
  if (trigger.around === "caster") {
    const caster = tokenOf(state, zone.casterId);
    // An Emanation that stays where its caster stood is measured from there, wherever the caster goes.
    const at = zone.anchor ?? casterAt ?? caster?.position;
    if (!at) return null;
    return within(
      {
        position: at,
        sizeCells: caster?.sizeCells ?? 1,
        sizePx: caster?.sizePx ?? calibration.cellSizePx,
        altitudeFeet: zone.anchor ? 0 : altitudeOf(caster)
      },
      trigger.feet ?? 5
    );
  }
  // Round the creature its cast targeted, wherever it goes (Antipathy/Sympathy's 120 feet).
  if (trigger.around === "target") {
    const anchor = zone.targetId ? tokenOf(state, zone.targetId) : undefined;
    const at = casterAt ?? anchor?.position;
    if (!anchor || !at) return null;
    return within(
      {
        position: at,
        sizeCells: anchor.sizeCells,
        sizePx: anchor.sizePx,
        altitudeFeet: altitudeOf(anchor)
      },
      trigger.feet ?? 5
    );
  }
  const area = zone.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  if (!area || area.shape === null) return null;
  if (trigger.around === "point") return within({ ...cell, position: area.geometry.origin }, trigger.feet ?? 5);
  const shape = area.shape;
  const heights = areaHeights(source.area);
  // A ringed wall stands on its circle's edge alone.
  const onRing = trigger.ring && shape === "circle" ? ringTest(calibration, area.geometry) : null;
  return (position, sizeCells, altitudeFeet = 0) => {
    if (heights) {
      const span = heightSpan({ altitudeFeet, sizeCells }, calibration.distancePerCell);
      if (span.high <= heights.low || span.low >= heights.high) return false;
    }
    if (onRing) return onRing(position, sizeCells);
    if (trigger.nearFeet !== undefined)
      return nearTemplate(calibration, area.geometry, shape, source.area?.widthFeet ?? null, trigger.nearFeet, {
        position,
        sizeCells
      });
    return footprintInTemplate(calibration, area.geometry, shape, source.area?.widthFeet ?? null, position, sizeCells);
  };
}

/** Whether a creature's space comes within `nearFeet` of a placed template: of a Line's length and width, a circle's
 *  edge, a square's sides. A Cone takes no reach. */
function nearTemplate(
  calibration: NonNullable<TokenMapGeometry["calibration"]>,
  geometry: Parameters<typeof footprintInTemplate>[1],
  shape: "circle" | "cone" | "line" | "square",
  widthFeet: number | null,
  nearFeet: number,
  at: Readonly<{ position: Point; sizeCells: number }>
): boolean {
  const pixelsPerFoot = calibration.cellSizePx / calibration.distancePerCell;
  const reach = (nearFeet + DISTANCE_TOLERANCE_FEET) * pixelsPerFoot + (calibration.cellSizePx * at.sizeCells) / 2;
  const { origin, target } = geometry;
  const { x, y } = at.position;
  if (shape === "circle")
    return Math.hypot(x - origin.x, y - origin.y) <= Math.hypot(target.x - origin.x, target.y - origin.y) + reach;
  if (shape === "square")
    return (
      x >= Math.min(origin.x, target.x) - reach &&
      x <= Math.max(origin.x, target.x) + reach &&
      y >= Math.min(origin.y, target.y) - reach &&
      y <= Math.max(origin.y, target.y) + reach
    );
  if (shape === "line") {
    const length = Math.hypot(target.x - origin.x, target.y - origin.y);
    const along =
      length === 0 ? 0 : ((x - origin.x) * (target.x - origin.x) + (y - origin.y) * (target.y - origin.y)) / length;
    const clamped = Math.max(0, Math.min(length, along));
    const nearest =
      length === 0
        ? origin
        : {
            x: origin.x + ((target.x - origin.x) / length) * clamped,
            y: origin.y + ((target.y - origin.y) / length) * clamped
          };
    return Math.hypot(x - nearest.x, y - nearest.y) <= ((widthFeet ?? 5) / 2) * pixelsPerFoot + reach;
  }
  return footprintInTemplate(calibration, geometry, shape, widthFeet, at.position, at.sizeCells);
}

/** Whether a creature can see a zone's placed area (Prismatic Wall's glare): not Blinded, and with dynamic vision on,
 *  seeing one of its ends or its middle. */
function seesArea(
  state: GameState,
  zone: SpellZone,
  creature: Actor,
  deps: Pick<ZoneDeps, "resolveDefinition" | "catalog">
) {
  if (creature.conditions.some((condition) => condition.id === "blinded")) return false;
  const area = zone.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  if (!area) return true;
  const sight = sceneSight(state, {
    definition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  });
  if (!sight.enabled) return true;
  const { origin, target } = area.geometry;
  return [origin, target, { x: (origin.x + target.x) / 2, y: (origin.y + target.y) / 2 }].some((point) =>
    sight.seesPoint(creature.id, point)
  );
}

/** The ground within reach of a wall's burning side (Wall of Fire: "each creature that ends its turn within 10 feet of
 *  that side or inside the wall"), as a test like `insideTest`'s; null for a zone with no such side or no placed area. */
function burningSideTest(
  state: GameState,
  zone: SpellZone,
  trigger: ZoneTrigger,
  source: Pick<ZoneContent, "area">,
  geometry: TokenMapGeometry | null
): ((position: Point, sizeCells: number) => boolean) | null {
  const calibration = geometry?.calibration ?? null;
  const area = zone.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  if (!calibration || !trigger.band || !area || area.shape === null || trigger.around !== undefined) return null;
  return bandTest(
    calibration,
    area.geometry,
    area.shape,
    source.area?.widthFeet ?? null,
    trigger.band,
    trigger.ring === true
  );
}

/** The heights a placed area spans, from the ground it was placed on: a Sphere its radius above and below its centre,
 *  a Cube its side, a Cylinder its printed height. Null when the shape sets no top (a wall's Line, an unknown height). */
function areaHeights(area: ZoneContent["area"]): Readonly<{ low: number; high: number }> | null {
  if (!area) return null;
  if (area.shape === "sphere") return { low: -area.sizeFeet, high: area.sizeFeet };
  if (area.shape === "cube") return { low: 0, high: area.sizeFeet };
  if (area.shape === "cylinder" && area.heightFeet !== undefined) return { low: 0, high: area.heightFeet };
  return null;
}

/** The traits that free a creature from a kind of ground (SRD Web Walker: it "ignores movement restrictions caused by
 *  webs", so webs neither slow nor hold it; Ice Walk: "Difficult Terrain composed of ice or snow doesn't cost it extra
 *  movement"). */
const FREE_ON: Readonly<Record<string, Readonly<{ id: string; name: string; uncaught: boolean }>>> = {
  webs: { id: "web-walker", name: "Web Walker", uncaught: true },
  ice: { id: "ice-walk", name: "Ice Walk", uncaught: false }
};

/** Whether the creature crosses this kind of ground at no extra cost; with `caught`, whether the ground can't hold it
 *  either. A worn item tagged with the trait's id frees its wearer from being held, as Cloak of Arachnida's Spider Walk
 *  does ("You can't be caught in webs of any sort"), and leaves the ground as costly as it is. */
export function movesFreelyOn(
  creature: Actor,
  kind: string,
  deps: Pick<ZoneDeps, "resolveDefinition"> & Readonly<{ catalog?: EquipmentCatalog }>,
  caught = false
): boolean {
  const trait = FREE_ON[kind];
  if (!trait || (caught && !trait.uncaught)) return false;
  if (creature.definitionId && holdsFeature(deps.resolveDefinition(creature.definitionId), trait.id, trait.name))
    return true;
  return (
    caught &&
    creature.inventory.some((row) => {
      const record = deps.catalog?.equipmentRecord(catalogIdOf(row));
      return record?.tags.includes(trait.id) === true && itemIsActive(row, record);
    })
  );
}

/** A creature's type, as its stat block prints it ("humanoid" for a character). */
export const typeOf = (creature: Actor, deps: Pick<ZoneDeps, "resolveDefinition">): string | null =>
  creatureTypeOf(creature, creature.definitionId ? deps.resolveDefinition(creature.definitionId) : undefined);

/** The creatures a zone can act on: those on the map (in the fight, during one), except an Emanation's anchor, only
 *  the caster's enemies where the spell spares the rest, only the creature types it names, and none that its ground
 *  can't hold (a spider in the webs). */
export function exposed(
  state: GameState,
  zone: SpellZone,
  trigger: ZoneTrigger,
  deps: Pick<ZoneDeps, "resolveDefinition" | "catalog">
): Actor[] {
  const caster = state.actors.find((actor) => actor.id === zone.casterId);
  const kind = trigger.terrain?.kind;
  // Spilled oil harms no one until it is lit.
  if (trigger.kindled && !zone.litUntil) return [];
  return creaturesOnMap(state).flatMap((creature) => {
    // "You and your allies": an aura its caster carries reaches the caster too.
    const own = creature.id === zone.casterId;
    if (trigger.around === "caster" && own && trigger.affects !== "allies" && !trigger.antimagic) return [];
    // A Line that blasts from its caster (Gust of Wind) starts beside it, and a djinni's whirlwind spares the djinni.
    if (own && (trigger.towardCaster || trigger.sparesUser)) return [];
    // The creature an area is round (Antipathy/Sympathy's target) is the one it keeps others from or draws them to.
    if (creature.id === zone.targetId) return [];
    if (trigger.affects === "enemies" && (!caster || !areEnemies(caster, creature, deps.resolveDefinition))) return [];
    if (trigger.affects === "allies" && !own && (!caster || !areAllies(caster, creature, deps.resolveDefinition)))
      return [];
    if (kind && movesFreelyOn(creature, kind, deps, true)) return [];
    // "Each creature on the ground in the area": one in the air above it is spared.
    if (trigger.grounded && altitudeOf(tokenOf(state, creature.id)) > 0) return [];
    if (trigger.seenOnly && !seesArea(state, zone, creature, deps)) return [];
    // The kind its caster picked as it cast (Antipathy/Sympathy), else the types the spell names.
    const types = zone.types ?? trigger.types;
    if (types && !types.includes(typeOf(creature, deps) ?? "")) return [];
    if (trigger.sizes && !trigger.sizes.includes(creature.size ?? "medium")) return [];
    // A spell that can't reach the creature leaves it out (a Ring of Mind Shielding in Zone of Truth).
    // An Antimagic Field's own aura is no spell reaching in.
    const spell = zone.rule === undefined && !trigger.antimagic ? deps.catalog?.spellRecord?.(zone.spellId) : undefined;
    if (spell && spellWardOf(state, creature, spell, zone.casterId, deps) !== null) return [];
    // A defeated creature takes no more; a dying character does (damage at 0 HP is a failed death save).
    if (creature.hp.current <= 0 && (creature.kind !== "player-character" || (creature.deathSaves?.failures ?? 0) >= 3))
      return [];
    return [creature];
  });
}

/**
 * Where a spell's area halves the mover's Speed (Spirit Guardians: "Any other creature's Speed is halved in the
 * Emanation"), as a test of its centre, so moving there costs double. Null when no standing area it is exposed to
 * does so, or the map can't place one.
 */
export function speedHalvingAt(
  state: GameState,
  actorId: string,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">,
  zones: readonly SpellZone[] = liveZones(state)
): ((position: Point, sizeCells: number) => boolean) | null {
  const tests: Array<(position: Point, sizeCells: number) => boolean> = [];
  for (const zone of zones) {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content?.trigger.halvesSpeed) continue;
    if (!exposed(state, zone, content.trigger, deps).some((creature) => creature.id === actorId)) continue;
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (inside) tests.push(inside);
  }
  return tests.length > 0 ? (position, sizeCells) => tests.some((inside) => inside(position, sizeCells)) : null;
}

const capitalised = (text: string) => (text.length > 0 ? `${text[0].toUpperCase()}${text.slice(1)}` : text);

/**
 * The zone acts on one creature: its save, with the damage rolled now at the cast's level, or its damage outright
 * (`times` over for every 5 feet travelled in Spike Growth). Marked so a creature enters once a turn, and is affected
 * once a turn where the spell says so.
 */
function act(
  state: GameState,
  zone: SpellZone,
  creature: Actor,
  meeting: Meeting,
  deps: ZoneDeps,
  events: EffectNarration[],
  times = 1
): void {
  const content = zoneContentOf(zone, deps.catalog);
  const caster = state.actors.find((actor) => actor.id === zone.casterId);
  if (!content || !caster || times < 1) return;
  const { trigger } = content;
  // A glyph not yet set off acts on no one (`glow`).
  if (trigger.glyph && !zone.glowing) return;
  // SRD Time Stop ends if "any effects that you create during it, affects a creature other than you".
  if (zone.inTimeStop && creature.id !== zone.casterId)
    events.push(...breakTimeStop(state, zone.casterId, `made ${content.name}, which affected another creature`));
  // "If the spirit has no creature Restrained": while one is still held by the cast, the zone waits.
  if (trigger.holdsOne && zone.castId !== null && holdsACreature(state, zone.castId)) return;
  // Round a target (Antipathy/Sympathy): a creature already under its effect, or immune after saving, is left be.
  const anchorId = trigger.around === "target" ? (zone.targetId ?? null) : null;
  if (anchorId !== null && heldByAnchor(creature, zone, anchorId)) return;
  const travelling = meeting === "moves through";
  // Outside a fight there are no turns to count once in: each time a creature comes into the area counts.
  const marks = state.combat.active;
  if (!travelling && marks) {
    if ((meeting === "enters" || meeting === "is caught by") && zone.entered.includes(creature.id)) return;
    if (trigger.oncePerTurn && zone.affected.includes(creature.id)) return;
  }
  if (marks) {
    zone.entered = meeting === "enters" || meeting === "is caught by" ? [...zone.entered, creature.id] : zone.entered;
    zone.affected = zone.affected.includes(creature.id) ? zone.affected : [...zone.affected, creature.id];
  }
  // SRD Alarm: "an alarm alerts you whenever a creature touches or enters the warded area". The GM is told who, and
  // passes on the bell or the ping.
  if (trigger.alerts) {
    events.push({
      kind: "effect",
      text: `${content.name}: ${creature.name} ${meeting} ${caster.name}'s warded area.`,
      actorId: creature.id,
      gmOnly: true
    });
    return;
  }
  // A glyph that bursts over its whole area once set off (Glyph of Warding's explosive rune): its spell ends, and the
  // burst follows (`burstEndedZones`).
  if (trigger.once && trigger.on.includes("spell-end")) {
    events.push({
      kind: "effect",
      text: `${creature.name} sets off ${content.name}.`,
      actorId: creature.id,
      source: { actorId: caster.id, name: caster.name }
    });
    // A spell glyph releases its spell on the creature that set it off (`stored-cast-release.ts`).
    if (zone.storedCast)
      state.combat = {
        ...state.combat,
        spellZones: state.combat.spellZones.map((entry) =>
          entry.id === zone.id ? { ...entry, setOffBy: creature.id } : entry
        )
      };
    events.push(...endZoneAndItsSpell(state, zone.id));
    return;
  }
  // Conjure Celestial's Healing Light on the caster and its allies, or on everyone, as the cast picked.
  const heals = trigger.heals;
  if (
    heals &&
    (heals.who === "all" || creature.id === caster.id || areAllies(caster, creature, deps.resolveDefinition))
  ) {
    const extra = (trigger.dicePerSlot ?? 0) * Math.max(0, zone.level - (content.spell?.level ?? zone.level));
    const formula = withMoreDice(zone.healing ?? heals.formula, extra);
    const amount = Math.max(0, resolveDice(parseDiceFormula(formula), deps.rollDie).total);
    events.push(
      {
        kind: "effect",
        text: `${creature.name} ${meeting} ${content.name} and regains ${amount} Hit Points.`,
        actorId: creature.id,
        source: { actorId: caster.id, name: caster.name }
      },
      ...healActor(state, creature.id, amount, { role: "gm" })
    );
    return;
  }
  const action = zoneAction(zone, content);
  if (!action) return;
  if (trigger.once) events.push(...endZoneAndItsSpell(state, zone.id));
  const parts = Array.from({ length: times }, () =>
    action.damage.map((part) => ({
      amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
      type: part.type
    }))
  )
    .flat()
    .reduce<Array<{ amount: number; type: string }>>((merged, part) => {
      const same = merged.find((entry) => entry.type === part.type);
      if (same) same.amount += part.amount;
      else merged.push({ ...part });
      return merged;
    }, []);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const source = { source: { actorId: caster.id, name: caster.name } };
  const save = action.save;
  if (!save) {
    if (total <= 0) return;
    const { application, events: landed } = applyDamageDetailed(
      state,
      creature.id,
      { amount: total, parts, sourceName: content.name, sourceActorId: caster.id },
      { role: "gm" },
      {
        resolveDefinition: deps.resolveDefinition,
        ...(deps.catalog ? { catalog: deps.catalog } : {}),
        newId: deps.newId,
        now: deps.now
      }
    );
    const typed = parts.length === 1 ? ` ${capitalised(parts[0].type)}` : "";
    events.push(
      {
        kind: "damage",
        text: `${creature.name} ${meeting} ${content.name} and takes ${application.totalApplied}${typed} damage${damageAdjustmentDetail(application)}.`,
        actorId: creature.id,
        ...source
      },
      ...landed
    );
    events.push(...countZoneDamage(state, zone.id, application.totalApplied, deps.catalog));
    return;
  }
  const conditionIds = save.failureConditions;
  // Frightened of, or Charmed by, the target the area is round, which its repeat saves measure from.
  const anchor = anchorId !== null ? state.actors.find((actor) => actor.id === anchorId) : undefined;
  const onFail = failureEffectFor(
    {
      action,
      attacker: anchor ?? caster,
      castId: zone.castId,
      riderItemId: null,
      deps: { catalog: deps.catalog }
    },
    conditionIds,
    content.spell ? { spell: content.spell, level: zone.level } : undefined
  );
  // A flight from the area itself (a Symbol of Fear: "at least 30 feet away from the glyph") measures from its origin.
  const origin =
    onFail?.compelled?.fromArea && zone.annotationId
      ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)?.geometry.origin
      : undefined;
  if (onFail?.compelled && origin) onFail.compelled = { ...onFail.compelled, point: { x: origin.x, y: origin.y } };
  // A save at the start of the creature's own turn that lasts "until the end of that turn" ends with this one.
  const currentTurn = meeting === "starts its turn in" && save.failureDuration?.type === "until-bearer-turn-end";
  createPendingSaves(state, {
    sourceActorId: caster.id,
    sourceName: caster.name,
    actionName: content.name,
    ability: save.ability,
    dc: save.dc,
    targetIds: [creature.id],
    proposedDamage: total,
    proposedDamageParts: parts,
    halfOnSuccess: save.successDamage === "half",
    conditionIds,
    // A save against a spell, which Magic Resistance meets with Advantage.
    magical: true,
    ...(onFail ? { onFailEffect: currentTurn ? { ...onFail, currentTurn: true as const } : onFail } : {}),
    extra: {
      zoneId: zone.id,
      ...(save.breaksConcentration ? { breaksConcentration: true as const } : {}),
      // Moonbeam: a shape-shifted creature that fails reverts to its true form.
      ...(save.failureEndsForm ? { endsForm: true as const } : {})
    },
    // A creature can owe this zone a second save before answering the first (entering, then ending its turn there).
    replaceExisting: false,
    // Gust of Wind's push away from its caster.
    ...(save.failurePush ? { failurePush: save.failurePush } : {}),
    // "A creature that successfully saves against this effect is immune to it" (Antipathy/Sympathy).
    ...(save.immuneOnSuccess ? { immuneOnSuccess: true } : {}),
    ...(save.immuneMinutes !== undefined ? { immuneMinutes: save.immuneMinutes } : {}),
    // A Sphere of Annihilation obliterates a creature its damage drops to 0.
    ...(action.drain ? { drain: structuredClone(action.drain) } : {}),
    // Heightened Spell's target has Disadvantage on every save against the spell.
    ...(zone.heightened === creature.id ? { disadvantage: { targetId: creature.id, from: "Heightened Spell" } } : {}),
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  events.push({
    kind: "effect",
    text: `${creature.name} ${meeting} ${content.name} and makes ${withArticle(`${save.ability.toUpperCase()} save`)} (DC ${save.dc}).`,
    actorId: creature.id,
    ...source
  });
}

/** The action a zone acts with: its spell's later action at the cast's level, or the rule an item left (Caltrops'
 *  save), in the damage type chosen at the cast (Conjure Elemental's element), with the dice it has gained (Delayed
 *  Blast Fireball's 1d6 a turn). */
export function zoneAction(zone: SpellZone, content: ZoneContent): ActorAction | undefined {
  let action: ActorAction;
  if (content.spell && content.row) {
    const { spell, row } = content;
    const built = laterSpellAction(spell, row, { attackBonus: 0, saveDc: zone.dc, bearersDc: false, modifier: 0 });
    action = zone.level > spell.level ? upcastAction(built, spell, zone.level) : built;
  } else if (zone.rule) {
    const { save, damage, drain } = zone.rule;
    action = {
      id: zone.laterActionId,
      name: zone.name,
      activation: "other",
      description: zone.name,
      damage: structuredClone(damage),
      ...(save ? { save: { ...structuredClone(save), dc: zone.dc } } : {}),
      ...(drain ? { drain: structuredClone(drain) } : {})
    };
  } else return undefined;
  const chosen = zone.damageType;
  // Dice it has gained (Delayed Blast Fireball) less those it has lost (Tsunami's 1d10 a round), and those a higher
  // slot gives where the area says so (Conjure Celestial's 1d12).
  const slotDice = content.spell
    ? (content.trigger.dicePerSlot ?? 0) * Math.max(0, zone.level - content.spell.level)
    : 0;
  const extra = (zone.grown ?? 0) - (zone.faded ?? 0) + slotDice;
  return {
    ...action,
    damage: action.damage.map((part, index) => ({
      formula: index === 0 && extra !== 0 ? withMoreDice(part.formula, extra) : part.formula,
      type: chosen ?? part.type
    })),
    // A failed repeat's damage is the chosen element's too (Conjure Elemental's 4d8 "of the spirit's type").
    ...(action.save?.repeatFailureDamage && chosen
      ? {
          save: {
            ...action.save,
            repeatFailureDamage: action.save.repeatFailureDamage.map((part) => ({
              ...part,
              type: chosen as typeof part.type
            }))
          }
        }
      : {})
  };
}

/** "12d6" with `extra` more dice of its size: "15d6"; fewer with a negative `extra`, and "0" once none is left. A
 *  formula with no dice term stays as it is. */
function withMoreDice(formula: string, extra: number): string {
  const match = /^(\d+)d(\d+)(.*)$/.exec(formula.trim());
  if (!match) return formula;
  const count = Number(match[1]) + extra;
  return count > 0 ? `${count}d${match[2]}${match[3]}` : "0";
}

/** Whether a creature already bears what an area round a target leaves (Frightened of it), or saved against it and is
 *  immune for now. The immunity is named for the save it won: the spell's, or its effect's repeat (Antipathy). */
function heldByAnchor(creature: Actor, zone: SpellZone, anchorId: string): boolean {
  const effectName = zone.laterActionId.split("-then-")[1];
  return creature.effects.some(
    (effect) =>
      (effect.sourceActorId === anchorId && effect.sourceActionId === zone.laterActionId) ||
      (effect.tags.includes(AURA_IMMUNE_TAG) &&
        (effect.sourceActorId === anchorId || effect.sourceActorId === zone.casterId) &&
        (effect.name.includes(zone.name) ||
          (effectName !== undefined && effect.name.toLowerCase().includes(effectName))))
  );
}

/** Whether a creature still bears what the cast restrained it with (Conjure Elemental's spirit holds one). */
function holdsACreature(state: GameState, castId: string): boolean {
  return state.actors.some((actor) =>
    actor.effects.some((effect) => effect.castId === castId && effect.linkedConditionIds.includes("restrained"))
  );
}

/** The zones a move sets off for the creature that moved: entering an area along the way (or an Emanation it carries
 *  passing over others), and Spike Growth's damage for every 5 feet travelled in it. A teleport only arrives. */
export function zonesAfterMove(
  state: GameState,
  input: Readonly<{ moverId: string; path: readonly Point[]; teleported?: boolean }>,
  deps: ZoneDeps
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const mover = state.actors.find((actor) => actor.id === input.moverId);
  const moverToken = tokenOf(state, input.moverId);
  if (!mover || !moverToken || input.path.length < 2) return events;
  const path = input.teleported ? [input.path[0]!, input.path[input.path.length - 1]!] : input.path;
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content) continue;
    const { trigger } = content;
    // A hidden glyph waits for a creature to come onto it (Symbol).
    if (trigger.glyph && !zone.glowing) {
      if (mover.id === zone.casterId) continue;
      const glyph = insideTest(
        state,
        zone,
        { on: [], around: "point", feet: trigger.glyph.feet },
        content,
        deps.geometry
      );
      const height = altitudeOf(moverToken);
      if (
        glyph &&
        !glyph(path[0]!, moverToken.sizeCells, height) &&
        path.slice(1).some((point) => glyph(point, moverToken.sizeCells, height))
      )
        events.push(...glow(state, zone, mover, deps));
      continue;
    }
    // An Emanation moves with its caster, and an area round a target with the target, over whoever it reaches.
    const carrier =
      trigger.around === "caster" && !zone.anchor
        ? zone.casterId
        : trigger.around === "target"
          ? zone.targetId
          : undefined;
    if (carrier === mover.id) {
      const tests = path.map((point) => insideTest(state, zone, trigger, content, deps.geometry, point));
      if (!trigger.on.includes("enter") || tests.some((test) => test === null)) continue;
      for (const creature of exposed(state, zone, trigger, deps)) {
        const at = tokenOf(state, creature.id)!;
        const hits = tests.map((test) => test!(at.position!, at.sizeCells, altitudeOf(at)));
        if (!hits[0] && hits.slice(1).some(Boolean)) act(state, zone, creature, "is caught by", deps, events);
      }
      continue;
    }
    if (!exposed(state, zone, trigger, deps).some((creature) => creature.id === mover.id)) continue;
    const inside = insideTest(state, zone, trigger, content, deps.geometry);
    if (!inside) continue;
    const hits = path.map((point) => inside(point, moverToken.sizeCells, altitudeOf(moverToken)));
    if (trigger.layers) events.push(...passesLayers(state, zone, content, mover, path, deps));
    if (trigger.on.includes("enter") && !hits[0] && hits.slice(1).some(Boolean))
      act(state, zone, mover, "enters", deps, events);
    if (trigger.on.includes("travel") && !input.teleported && deps.geometry) {
      let feet = 0;
      for (let index = 1; index < path.length; index++)
        if (hits[index]) feet += mapDistance(deps.geometry, path[index - 1]!, path[index]!)?.value ?? 0;
      act(state, zone, mover, "moves through", deps, events, Math.floor((feet + DISTANCE_TOLERANCE_FEET) / 5));
    }
  }
  events.push(...warnings(state, mover, path, deps), ...leashedZones(state, deps));
  return events;
}

/** A creature moving into a wall of layers (Prismatic Wall) makes each layer's save, once a move. */
function passesLayers(
  state: GameState,
  zone: SpellZone,
  content: ZoneContent,
  mover: Actor,
  path: readonly Point[],
  deps: ZoneDeps
): EffectNarration[] {
  const { nearFeet: _near, ...bare } = content.trigger;
  const wall = insideTest(state, zone, bare, content, deps.geometry);
  const token = tokenOf(state, mover.id);
  const caster = state.actors.find((actor) => actor.id === zone.casterId);
  if (!wall || !token || !caster) return [];
  const on = path.map((point) => wall(point, token.sizeCells, altitudeOf(token)));
  if (on[0] || !on.slice(1).some(Boolean)) return [];
  return prismaticWallLayers(state, {
    zone,
    caster,
    creature: mover,
    random: deps.rollDie,
    newId: deps.newId,
    now: deps.now
  });
}

/**
 * SRD Symbol: "Once triggered, the glyph glows, filling a 60-foot-radius Sphere with Dim Light for 10 minutes, after
 * which time the spell ends. Each creature in the Sphere when the glyph activates is targeted by its effect." The glyph
 * grows to its Sphere, drawn now for everyone, its Dim Light fills it, the spell's time runs from now, and it acts on
 * each creature in it.
 */
function glow(state: GameState, zone: SpellZone, setter: Actor, deps: ZoneDeps): EffectNarration[] {
  const content = zoneContentOf(zone, deps.catalog);
  const glyph = content?.trigger.glyph;
  const calibration = deps.geometry?.calibration;
  if (!content || !glyph) return [];
  zone.glowing = true;
  const events: EffectNarration[] = [
    { kind: "effect", text: `${setter.name} sets off ${content.name}, and the glyph glows.`, actorId: setter.id }
  ];
  const annotation = state.combat.annotations.find((candidate) => candidate.id === zone.annotationId);
  if (annotation && calibration) {
    const reach = (glyph.growsToFeet / calibration.distancePerCell) * calibration.cellSizePx;
    const origin = annotation.geometry.origin;
    state.combat = {
      ...state.combat,
      annotations: state.combat.annotations.map((candidate) =>
        candidate.id === annotation.id
          ? {
              ...annotation,
              visibility: "public",
              visibleToActorId: null,
              geometry: shapeGeometry(calibration, "circle", origin, { x: origin.x + reach, y: origin.y })
            }
          : candidate
      )
    };
    applyCastSight(state, {
      commandId: annotation.id,
      casterId: zone.casterId,
      sight: { light: { on: "area", brightFeet: 0, dimFeet: glyph.growsToFeet } },
      spellId: zone.spellId,
      level: zone.level,
      castId: zone.castId,
      effectId: zone.effectId ?? null,
      targetIds: [],
      areaPlaced: true
    });
  }
  // Its time now runs, in a fight or on the game clock: the effect that keeps it lasts that long from here.
  const keeper = zone.effectId
    ? state.actors.find((actor) => actor.id === zone.casterId)?.effects.find((effect) => effect.id === zone.effectId)
    : undefined;
  if (keeper) keeper.duration = { type: "rounds", remaining: glyph.rounds };
  zone.area = { shape: "sphere", sizeFeet: glyph.growsToFeet, widthFeet: null };
  const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
  if (inside)
    for (const creature of exposed(state, zone, content.trigger, deps)) {
      const token = tokenOf(state, creature.id)!;
      if (inside(token.position!, token.sizeCells, altitudeOf(token)))
        act(state, zone, creature, "is caught in", deps, events);
    }
  return events;
}

/** SRD Faithful Hound: "When a Small or larger creature comes within 30 feet of it ... the hound starts barking
 *  loudly." A zone that warns tells the GM who came within its reach, with no save; the password is the GM's. */
function warnings(state: GameState, mover: Actor, path: readonly Point[], deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    const warns = content?.trigger.warns;
    if (!content || !warns || zone.casterId === mover.id || !warns.sizes.includes(mover.size ?? "medium")) continue;
    const near = insideTest(state, zone, { on: [], around: "point", feet: warns.feet }, content, deps.geometry);
    const token = tokenOf(state, mover.id);
    if (!near || !token) continue;
    const height = altitudeOf(token);
    if (!near(path[0]!, token.sizeCells, height) && near(path[path.length - 1]!, token.sizeCells, height))
      events.push({
        kind: "effect",
        text: `${content.name}: ${mover.name} comes within ${warns.feet} feet, and the hound starts barking.`,
        actorId: mover.id,
        gmOnly: true
      });
  }
  return events;
}

/** SRD Faithful Hound: "The hound remains for the duration or until the two of you are more than 300 feet apart from
 *  each other." A zone on a leash ends, with its spell, once its caster is farther than that from its point. */
export function leashedZones(state: GameState, deps: Pick<ZoneDeps, "geometry" | "catalog">): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (!deps.geometry?.calibration) return events;
  for (const zone of liveZones(state)) {
    const leash = zoneContentOf(zone, deps.catalog)?.trigger.leash;
    const area = zone.annotationId
      ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
      : undefined;
    const caster = tokenOf(state, zone.casterId);
    if (leash === undefined || !area || !caster?.position) continue;
    const apart = mapDistance(deps.geometry, caster.position, area.geometry.origin)?.value ?? 0;
    if (apart <= leash + DISTANCE_TOLERANCE_FEET) continue;
    const casterName = state.actors.find((actor) => actor.id === zone.casterId)?.name ?? "its caster";
    events.push(
      {
        kind: "effect",
        text: `${zone.name} ends: ${casterName} is more than ${leash} feet from it.`,
        actorId: zone.casterId
      },
      ...endZoneAndItsSpell(state, zone.id)
    );
  }
  return events;
}

/** A placed area moved (Moonbeam's Cylinder, a cloud drifting): it acts on each creature it now covers that it
 *  didn't before ("when the spell's area moves into its space"). `before` is where it was. */
export function zonesAfterAreaMove(
  state: GameState,
  annotationId: string,
  before: Readonly<{ origin: Point; target: Point }>,
  deps: ZoneDeps
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const area = state.combat.annotations.find((annotation) => annotation.id === annotationId);
  if (!area) return events;
  for (const zone of liveZones(state)) {
    if (zone.annotationId !== annotationId) continue;
    const content = zoneContentOf(zone, deps.catalog);
    const carry = () =>
      content?.trigger.carriesHeld ? carryHeld(state, zone, before.origin, area.geometry.origin, deps) : [];
    if (!content || !content.trigger.on.includes("enter")) {
      events.push(...carry());
      continue;
    }
    const { trigger } = content;
    const now = insideTest(state, zone, trigger, content, deps.geometry);
    const after = area.geometry;
    area.geometry = { ...after, origin: before.origin, target: before.target };
    const then = insideTest(state, zone, trigger, content, deps.geometry);
    const wasInside = new Set(
      then === null
        ? []
        : exposed(state, zone, trigger, deps)
            .filter((creature) => {
              const token = tokenOf(state, creature.id)!;
              return then(token.position!, token.sizeCells, altitudeOf(token));
            })
            .map((creature) => creature.id)
    );
    area.geometry = after;
    // What it holds goes with it, and so is in it still.
    events.push(...carry());
    if (!now) continue;
    for (const creature of exposed(state, zone, trigger, deps)) {
      const token = tokenOf(state, creature.id)!;
      if (!wasInside.has(creature.id) && now(token.position!, token.sizeCells, altitudeOf(token)))
        act(state, zone, creature, "is caught by", deps, events);
    }
  }
  events.push(...leashedZones(state, deps));
  return events;
}

/** Moves the creatures an area holds with it (a djinni's whirlwind: "the target has the Restrained condition and moves
 *  with the whirlwind"), by as far as the area moved. */
function carryHeld(state: GameState, zone: SpellZone, from: Point, to: Point, deps: ZoneDeps): EffectNarration[] {
  const shift = { x: to.x - from.x, y: to.y - from.y };
  if (!deps.geometry || (shift.x === 0 && shift.y === 0)) return [];
  const held = state.actors.filter(
    (actor) =>
      tokenOf(state, actor.id) &&
      actor.effects.some(
        (effect) =>
          effect.linkedConditionIds.includes("restrained") &&
          (zone.castId !== null
            ? effect.castId === zone.castId
            : effect.sourceActorId === zone.casterId && effect.sourceActionId === zone.laterActionId)
      )
  );
  for (const creature of held) {
    const at = tokenOf(state, creature.id)!.position!;
    moveEncounterToken(state, creature.id, { x: at.x + shift.x, y: at.y + shift.y }, deps.geometry);
  }
  return held.length > 0
    ? [
        {
          kind: "effect",
          text: `${zone.name} carries ${held.map((creature) => creature.name).join(", ")} with it.`,
          actorId: zone.casterId
        }
      ]
    : [];
}

/** The zones a creature ending its turn inside sets off, before the next turn begins. A zone whose damage grows as its
 *  caster's turns end gains its die (SRD Delayed Blast Fireball: "the damage increases by 1d6 whenever your turn ends
 *  and the spell hasn't ended"). */
export function zonesAtTurnEnd(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  const unsteered: EffectNarration[] = [];
  for (const zone of liveZones(state)) {
    if (zone.casterId !== actorId) continue;
    const trigger = zoneContentOf(zone, deps.catalog)?.trigger;
    if (trigger?.grows) zone.grown = Math.min(100, (zone.grown ?? 0) + 1);
    // A cloud its caster didn't steer this turn drifts straight away from it.
    if (zone.driftFrom && trigger?.drifts !== undefined) {
      delete zone.driftFrom;
      unsteered.push(...drift(state, zone, trigger.drifts, deps));
    }
  }
  return [
    ...unsteered,
    ...zonesWhereItStands(state, actorId, "end-turn", deps),
    ...zonesAtCasterTurnEnd(state, actorId, deps),
    // Lit oil whose rounds are up burns out once this turn's end has burned whoever stood in it.
    ...burnedOutAtTurnEnd(state, actorId)
  ];
}

/** SRD Earthquake: "at the end of each of your turns for the duration, each creature on the ground in the area makes a
 *  Dexterity saving throw". A zone that acts as its caster's turn ends acts on every creature in it then. */
function zonesAtCasterTurnEnd(state: GameState, casterId: string, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (!state.combat.active) return events;
  for (const zone of liveZones(state)) {
    if (zone.casterId !== casterId) continue;
    const content = zoneContentOf(zone, deps.catalog);
    if (!content || !content.trigger.on.includes("caster-turn-end")) continue;
    const objectDamage = deps.catalog?.spellRecord?.(zone.spellId)?.effect?.objectDamage;
    if (objectDamage) events.push(...harmObjectsUnderZone(state, zone, objectDamage, deps.rollDie));
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (!inside) continue;
    for (const creature of exposed(state, zone, content.trigger, deps)) {
      const token = tokenOf(state, creature.id)!;
      if (inside(token.position!, token.sizeCells, altitudeOf(token)))
        act(state, zone, creature, "is caught in", deps, events);
    }
  }
  return events;
}

/**
 * SRD Storm of Vengeance: "At the start of each of your later turns, the storm produces different effects." The spell's
 * turn is counted at each of its caster's turn starts, and on a turn its schedule names the area becomes that later row
 * (acid, then lightning, hail and freezing rain), its area Heavily Obscured from a row that obscures.
 */
function nextStage(state: GameState, zone: SpellZone, deps: ZoneDeps): EffectNarration[] {
  const spell = deps.catalog?.spellRecord?.(zone.spellId);
  const schedule = spell ? zoneRowOf(spell)?.zone?.schedule : undefined;
  if (!spell || !schedule || !state.combat.active) return [];
  zone.stage = Math.min(1000, (zone.stage ?? 1) + 1);
  const entry = schedule.find((candidate) => candidate.turn === zone.stage);
  const row = entry ? (spell.effect?.laterActions ?? []).find((candidate) => candidate.name === entry.row) : undefined;
  if (!entry || !row) return [];
  zone.laterActionId = laterSpellActionId(spell.id, row.name);
  if (row.zone?.obscures && zone.annotationId)
    applyCastSight(state, {
      commandId: zone.annotationId,
      casterId: zone.casterId,
      sight: { area: { kind: "heavily-obscured" } },
      spellId: zone.spellId,
      level: zone.level,
      castId: zone.castId,
      effectId: zone.effectId ?? null,
      targetIds: [],
      areaPlaced: true
    });
  return [{ kind: "effect", text: `${spell.name} turns to its ${row.name}.`, actorId: zone.casterId }];
}

/**
 * A turn's start: a spell that lasts its duration ends once its caster's turn comes round after it (`rounds`), a cloud
 * its caster's turn moves drifts away from it, and the zones the incoming creature starts its turn inside act on it.
 * Each zone's marks are cleared first: "once per turn" counts afresh.
 */
export function zonesAtTurnStart(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const zone of [...state.combat.spellZones]) {
    zone.entered = [];
    zone.affected = [];
    // A Sphere of Annihilation's control lasts until the start of its controller's next turn, which it starts in
    // control (what a Talisman of the Sphere asks).
    if (zone.controllerId === actorId) {
      zone.heldAtTurnStart = actorId;
      delete zone.controllerId;
    } else delete zone.heldAtTurnStart;
    if (zone.casterId !== actorId || zone.bursting) continue;
    if (zone.rounds !== null && state.combat.round - zone.startedRound >= zone.rounds) {
      endZone(state, zone.id);
      events.push({ kind: "effect", text: `${zone.name} ends.`, actorId: zone.casterId });
      continue;
    }
    if (zoneHeld(state, zone)) events.push(...nextStage(state, zone, deps));
    const trigger = zoneContentOf(zone, deps.catalog)?.trigger;
    const drifts = trigger?.drifts;
    if (drifts === undefined || !zoneHeld(state, zone)) continue;
    // A cloud its caster steers waits for the caster's pick of way (Incendiary Cloud).
    const area = zone.annotationId
      ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
      : undefined;
    if (trigger?.steered && area) {
      zone.driftFrom = { origin: { ...area.geometry.origin }, target: { ...area.geometry.target } };
      events.push({
        kind: "effect",
        text: `${zone.name} drifts ${drifts} feet the way its caster picks, or straight away as its caster's turn ends.`,
        actorId: zone.casterId
      });
    } else events.push(...drift(state, zone, drifts, deps));
  }
  events.push(...pulledIn(state, actorId, deps));
  events.push(...zonesWhereItStands(state, actorId, "start-turn", deps));
  events.push(...zonesAtCasterTurnStart(state, actorId, deps));
  return events;
}

/**
 * A vortex's pull as a creature's turn starts (SRD 5.2.1 Control Water's Whirlpool: "A creature or object in the water
 * and within 25 feet of the vortex is pulled 10 feet toward it"): each area that pulls draws the creature, within its
 * reach of the area's middle, that many feet toward the middle, and the creature meets whatever it is pulled into.
 * Where the GM painted water on the map, only a creature in it is pulled; a map with none painted is taken as all water.
 */
function pulledIn(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  const geometry = deps.geometry;
  const creature = state.actors.find((actor) => actor.id === actorId);
  if (!geometry?.calibration || !creature || !state.combat.active) return [];
  const events: EffectNarration[] = [];
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    const pulls = content?.trigger.pulls;
    const area = zone.annotationId
      ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
      : undefined;
    const from = tokenOf(state, actorId)?.position;
    if (!content || !pulls || !area || !from) continue;
    const painted = state.combat.terrain.water.length > 0 || state.combat.terrain.runningWater.length > 0;
    if (painted && waterOf(state, actorId, geometry.calibration, deps) === null) continue;
    if (!exposed(state, zone, content.trigger, deps).some((candidate) => candidate.id === actorId)) continue;
    const middle = area.shape === "circle" ? area.geometry.origin : midpointOf(area.geometry);
    const apart = mapDistance(geometry, from, middle)?.value ?? null;
    if (apart === null || apart < 5 - DISTANCE_TOLERANCE_FEET || apart > pulls.withinFeet + DISTANCE_TOLERANCE_FEET)
      continue;
    const moved = pullTokenToward(state, actorId, middle, Math.min(pulls.feet, apart), geometry);
    const to = tokenOf(state, actorId)?.position;
    if (!moved || moved.value <= 0 || !to) continue;
    events.push({
      kind: "effect",
      text: `${content.name} pulls ${creature.name} ${moved.value} feet toward it.`,
      actorId,
      source: { actorId: zone.casterId, name: state.actors.find((actor) => actor.id === zone.casterId)?.name ?? null }
    });
    events.push(...zonesAfterMove(state, { moverId: actorId, path: [from, to] }, deps));
  }
  return events;
}

const midpointOf = (geometry: Readonly<{ origin: Point; target: Point }>): Point => ({
  x: (geometry.origin.x + geometry.target.x) / 2,
  y: (geometry.origin.y + geometry.target.y) / 2
});

/**
 * SRD Cloudkill: "The Sphere moves 10 feet away from you at the start of each of your turns" (Incendiary Cloud's too):
 * the area moves `feet` straight away from its caster, snapped as a placed area is, and acts on the creatures it moves
 * onto. When the map can't say which way that is (no grid, the area unplaced, the caster at its centre or off the
 * map), the GM is told to move it.
 */
function drift(state: GameState, zone: SpellZone, feet: number, deps: ZoneDeps): EffectNarration[] {
  const calibration = deps.geometry?.calibration ?? null;
  const area = zone.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  const caster = tokenOf(state, zone.casterId)?.position;
  // Away from the caster through the area's middle, so a wall moves square to its caster.
  const middle =
    area && (area.shape === "line" || area.shape === "square")
      ? {
          x: (area.geometry.origin.x + area.geometry.target.x) / 2,
          y: (area.geometry.origin.y + area.geometry.target.y) / 2
        }
      : area?.geometry.origin;
  const away = middle && caster ? { x: middle.x - caster.x, y: middle.y - caster.y } : null;
  const length = away ? Math.hypot(away.x, away.y) : 0;
  if (!calibration || !area || area.shape === null || !away || length < 1)
    return [
      {
        kind: "effect",
        text: `${zone.name} moves ${feet} feet away from its caster: drag its area on the map.`,
        actorId: zone.casterId,
        gmOnly: true
      }
    ];
  const pixels = (feet / calibration.distancePerCell) * calibration.cellSizePx;
  const shift = { x: (away.x / length) * pixels, y: (away.y / length) * pixels };
  const before = { origin: area.geometry.origin, target: area.geometry.target };
  const content = zoneContentOf(zone, deps.catalog);
  // Tsunami: "the wall, along with any creatures in it, moves 50 feet away from you".
  const carries = content?.trigger.carries === true;
  const insideBefore = carries && content ? insideTest(state, zone, content.trigger, content, deps.geometry) : null;
  const carried = insideBefore
    ? creaturesOnMap(state).filter((creature) => {
        const token = tokenOf(state, creature.id)!;
        return insideBefore(token.position!, token.sizeCells, altitudeOf(token));
      })
    : [];
  const moved = shapeGeometry(
    calibration,
    area.shape,
    { x: before.origin.x + shift.x, y: before.origin.y + shift.y },
    { x: before.target.x + shift.x, y: before.target.y + shift.y }
  );
  area.geometry = moved;
  const casterName = state.actors.find((actor) => actor.id === zone.casterId)?.name ?? "its caster";
  const events: EffectNarration[] = [
    {
      kind: "effect",
      text: `${zone.name} drifts ${feet} feet away from ${casterName}${carried.length > 0 ? `, carrying ${carried.map((creature) => creature.name).join(", ")}` : ""}.`,
      actorId: zone.casterId
    }
  ];
  if (!carries || !content || !deps.geometry) return [...events, ...zonesAfterAreaMove(state, area.id, before, deps)];
  for (const creature of carried) {
    const at = tokenOf(state, creature.id)!.position!;
    moveEncounterToken(state, creature.id, { x: at.x + shift.x, y: at.y + shift.y }, deps.geometry);
  }
  zone.driftedThisTurn = true;
  // Each creature it now holds, carried or newly caught, makes the save.
  const holding = insideTest(state, zone, content.trigger, content, deps.geometry);
  if (holding)
    for (const creature of exposed(state, zone, content.trigger, deps)) {
      const token = tokenOf(state, creature.id)!;
      if (holding(token.position!, token.sizeCells, altitudeOf(token)))
        act(state, zone, creature, "is swept up by", deps, events);
    }
  return events;
}

/** SRD Faithful Hound: "At the start of each of your turns, the hound attempts to bite one enemy within 5 feet of it."
 *  A zone that acts as its caster's turn starts acts on the one creature it can reach nearest its point (the earlier
 *  in the initiative order on a tie). Without a measurable map the GM runs it from the caster's list. */
function zonesAtCasterTurnStart(state: GameState, casterId: string, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (!state.combat.active) return events;
  for (const zone of liveZones(state)) {
    if (zone.casterId !== casterId) continue;
    const content = zoneContentOf(zone, deps.catalog);
    if (!content || !content.trigger.on.includes("caster-turn-start")) continue;
    const { trigger } = content;
    const inside = insideTest(state, zone, trigger, content, deps.geometry);
    const area = zone.annotationId
      ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
      : undefined;
    if (!inside || !area || !deps.geometry) {
      events.push({
        kind: "effect",
        text: `${zone.name} acts as its caster's turn starts: place its area on the map, or run it by hand.`,
        actorId: zone.casterId,
        gmOnly: true
      });
      continue;
    }
    const reached = exposed(state, zone, trigger, deps).filter((creature) => {
      const token = tokenOf(state, creature.id)!;
      return inside(token.position!, token.sizeCells, altitudeOf(token));
    });
    // Storm of Vengeance's rain falls on "each creature under the cloud".
    if (trigger.everyone) {
      for (const creature of reached) act(state, zone, creature, "is caught in", deps, events);
      continue;
    }
    const origin = area.geometry.origin;
    const nearest = reached
      .map((creature) => {
        const at = tokenOf(state, creature.id)!.position!;
        return { creature, apart: Math.hypot(at.x - origin.x, at.y - origin.y) };
      })
      .sort((left, right) => left.apart - right.apart)[0];
    if (nearest) act(state, zone, nearest.creature, "is set upon by", deps, events);
  }
  return events;
}

/**
 * A spell area that acts as its spell ends (SRD Delayed Blast Fireball: "When the spell ends, the bead explodes, and
 * each creature in a 20-foot-radius Sphere centered on that point makes a Dexterity saving throw"), run once the
 * spell has ended, by whatever ended it: every creature in the area owes the save against the damage, rolled once with
 * the dice it gained. Without a measurable map the GM is told to name who was caught. The area then goes.
 */
export function burstEndedZones(state: GameState, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const zone of state.combat.spellZones.filter((candidate) => candidate.bursting)) {
    const content = zoneContentOf(zone, deps.catalog);
    const caster = state.actors.find((actor) => actor.id === zone.casterId);
    if (content && caster) {
      const { trigger } = content;
      // The burst fills the whole area the cast placed, whatever set it off (a glyph stepped on).
      const { around: _around, ...whole } = trigger;
      const inside = insideTest(state, zone, whole, content, deps.geometry);
      const caught = inside
        ? creaturesOnMap(state).filter((creature) => {
            const token = tokenOf(state, creature.id)!;
            return inside(token.position!, token.sizeCells, altitudeOf(token));
          })
        : [];
      if (zone.inTimeStop && caught.some((creature) => creature.id !== zone.casterId))
        events.push(...breakTimeStop(state, zone.casterId, `made ${content.name}, which affected another creature`));
      const action = zoneAction(zone, content);
      const parts = (action?.damage ?? []).map((part) => ({
        amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
        type: part.type
      }));
      const save = action?.save;
      if (save && caught.length > 0)
        createPendingSaves(state, {
          sourceActorId: caster.id,
          sourceName: caster.name,
          actionName: content.name,
          ability: save.ability,
          dc: save.dc,
          targetIds: caught.map((creature) => creature.id),
          proposedDamage: parts.reduce((sum, part) => sum + part.amount, 0),
          proposedDamageParts: parts,
          halfOnSuccess: save.successDamage === "half",
          conditionIds: save.failureConditions,
          magical: true,
          newSaveId: deps.newId,
          createdAt: Date.parse(deps.now())
        });
      events.push({
        kind: "effect",
        text: inside
          ? caught.length > 0
            ? `${zone.name} explodes: ${caught.map((creature) => creature.name).join(", ")} ${caught.length === 1 ? "makes" : "make"} ${withArticle(`${(save?.ability ?? "dex").toUpperCase()} save`)} (DC ${save?.dc ?? zone.dc}).`
            : `${zone.name} explodes, and no creature is caught in it.`
          : `${zone.name} explodes: its area isn't on the map, so call the saves for the creatures it catches.`,
        actorId: zone.casterId,
        source: { actorId: caster.id, name: caster.name }
      });
    }
    removeZone(state, zone);
  }
  return events;
}

function zonesWhereItStands(
  state: GameState,
  actorId: string,
  when: "start-turn" | "end-turn",
  deps: ZoneDeps
): EffectNarration[] {
  const events: EffectNarration[] = [];
  if (!state.combat.active) return events;
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content || !content.trigger.on.includes(when)) continue;
    const { trigger } = content;
    const creature = exposed(state, zone, trigger, deps).find((candidate) => candidate.id === actorId);
    const token = creature ? tokenOf(state, creature.id) : undefined;
    const inside = insideTest(state, zone, trigger, content, deps.geometry);
    // A turn that ends beside a wall's burning side counts as one ending inside it.
    const beside = when === "end-turn" ? burningSideTest(state, zone, trigger, content, deps.geometry) : null;
    const reached =
      token !== undefined &&
      ((inside !== null && inside(token.position!, token.sizeCells, altitudeOf(token))) ||
        (beside !== null && beside(token.position!, token.sizeCells)));
    if (!creature || !token || !reached) continue;
    // SRD Aura of Life: "When an ally with 0 Hit Points starts its turn in the aura, that ally regains 1 Hit Point."
    if (when === "start-turn" && trigger.revives && creature.hp.current <= 0) {
      events.push(
        { kind: "effect", text: `${creature.name} regains ${trigger.revives} Hit Point in ${content.name}.`, actorId },
        ...healActor(state, creature.id, trigger.revives, { role: "gm" })
      );
      continue;
    }
    act(state, zone, creature, when === "start-turn" ? "starts its turn in" : "ends its turn in", deps, events);
  }
  return events;
}

/** The GM places (or moves) a zone's area: the annotation it now stands on. Nothing is caught by the placing itself,
 *  since the cast already made its save. */
export function placeZone(state: GameState, zoneId: string, annotationId: string): SpellZone {
  const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
  if (!zone) throw new CommandRejectedError("That spell's area has already ended.");
  if (zone.annotationId !== null && zone.annotationId !== annotationId)
    state.combat = {
      ...state.combat,
      annotations: state.combat.annotations.filter((annotation) => annotation.id !== zone.annotationId)
    };
  zone.annotationId = annotationId;
  return zone;
}
