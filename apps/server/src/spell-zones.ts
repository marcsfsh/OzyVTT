import type { SpellReference, SpellZone as ZoneTrigger } from "@vtt/content-srd-5.2.1";
import type { GameState, SpellZone } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { catalogIdOf, type ActorAction, type ActorDefinition } from "@vtt/schemas";
import { shapeGeometry } from "./annotations.js";
import { footprintInTemplate } from "./area-targeting.js";
import { holdsFeature } from "./class-features.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { areAllies, areEnemies } from "./creature-sides.js";
import { CONCENTRATING_TAG, endEffectIfPresent, type EffectNarration } from "./effects.js";
import { itemIsActive, type EquipmentCatalog } from "./equipment-derivation.js";
import { applyDamageDetailed, damageAdjustmentDetail, healActor } from "./hit-points.js";
import { laterRowOf, laterSpellAction, upcastAction } from "./item-actions.js";
import { creatureDistance, DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import { CommandRejectedError } from "./game-store.js";
import { failureEffectFor } from "./resolution/pending.js";
import { createPendingSaves } from "./saving-throws.js";
import { countZoneDamage, endZone, removeZone, zoneContentOf, type ZoneContent } from "./spell-zone-state.js";
import type { TokenMapGeometry } from "./token-placement.js";
import { withArticle } from "@vtt/domain";
import { altitudeOf, heightSpan } from "./altitude.js";
import { bandTest, ringTest } from "./zone-shapes.js";

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
  | "is caught in";

/** The later action whose zone this spell leaves, if any: the one its cast picked among the spell's options (Wall of
 *  Fire's ring), else the first. */
export function zoneRowOf(spell: SpellReference, optionId?: string) {
  const rows = (spell.effect?.laterActions ?? []).filter((row) => row.zone !== undefined);
  return (optionId !== undefined ? rows.find((row) => row.option?.id === optionId) : undefined) ?? rows[0];
}

/** The options a spell's cast picks its zone by (Wall of Fire's forms, a Symbol's glyphs), each with the area the
 *  cast is placed as when it differs from the spell's own (a ring). Empty for a spell with none. */
export function zoneOptionsOf(
  spell: SpellReference
): Array<Readonly<{ id: string; name: string; area?: NonNullable<SpellReference["area"]> }>> {
  return (spell.effect?.laterActions ?? []).flatMap((row) =>
    row.zone && row.option
      ? [{ id: row.option.id, name: row.option.name, ...(row.area ? { area: row.area } : {}) }]
      : []
  );
}

/** What a use offers its user to pick, as the sheet lists it: the effects it picks one of (Enlarge or Reduce), or for a
 *  spell's cast the forms of the area it leaves (Wall of Fire's ring). */
export function castOptionsOf(
  action: Pick<ActorAction, "id" | "effectOptions" | "spellId">,
  spell: SpellReference | undefined
): Readonly<{ options?: ReturnType<typeof zoneOptionsOf> }> {
  if (action.effectOptions)
    return { options: action.effectOptions.map((option) => ({ id: option.id, name: option.name })) };
  if (!spell || action.spellId !== spell.id || laterRowOf(spell, action.id)) return {};
  const options = zoneOptionsOf(spell);
  return options.length > 0 ? { options } : {};
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
    return creature && tokenOf(state, id) ? [creature] : [];
  });
}

/** "Is a creature of this size, this high, at this point inside the zone?", or null when the map can't say (no grid,
 *  the area not placed, its caster off the map). `casterAt` stands the caster of an Emanation somewhere else. A
 *  creature's height is 0 when the caller doesn't give it: on the ground. */
export function insideTest(
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
    return footprintInTemplate(calibration, area.geometry, shape, source.area?.widthFeet ?? null, position, sizeCells);
  };
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
  return creaturesOnMap(state).flatMap((creature) => {
    // "You and your allies": an aura its caster carries reaches the caster too.
    const own = creature.id === zone.casterId;
    if (trigger.around === "caster" && own && trigger.affects !== "allies") return [];
    // A Line that blasts from its caster (Gust of Wind) starts beside it, not on it.
    if (own && trigger.towardCaster) return [];
    if (trigger.affects === "enemies" && (!caster || !areEnemies(caster, creature, deps.resolveDefinition))) return [];
    if (trigger.affects === "allies" && !own && (!caster || !areAllies(caster, creature, deps.resolveDefinition)))
      return [];
    if (kind && movesFreelyOn(creature, kind, deps, true)) return [];
    // "Each creature on the ground in the area": one in the air above it is spared.
    if (trigger.grounded && altitudeOf(tokenOf(state, creature.id)) > 0) return [];
    if (trigger.types && !trigger.types.includes(typeOf(creature, deps) ?? "")) return [];
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
  // "If the spirit has no creature Restrained": while one is still held by the cast, the zone waits.
  if (trigger.holdsOne && zone.castId !== null && holdsACreature(state, zone.castId)) return;
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
    events.push(...endZoneAndItsSpell(state, zone.id));
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
  const onFail = failureEffectFor(
    { action, attacker: caster, castId: zone.castId, riderItemId: null, deps: { catalog: deps.catalog } },
    conditionIds,
    content.spell ? { spell: content.spell, level: zone.level } : undefined
  );
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
    const { save, damage } = zone.rule;
    action = {
      id: zone.laterActionId,
      name: zone.name,
      activation: "other",
      description: zone.name,
      damage: structuredClone(damage),
      ...(save ? { save: { ...structuredClone(save), dc: zone.dc } } : {})
    };
  } else return undefined;
  const chosen = zone.damageType;
  return {
    ...action,
    damage: action.damage.map((part, index) => ({
      formula: index === 0 && (zone.grown ?? 0) > 0 ? withMoreDice(part.formula, zone.grown ?? 0) : part.formula,
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

/** "12d6" with `extra` more dice of its size: "15d6". A formula with no dice term stays as it is. */
function withMoreDice(formula: string, extra: number): string {
  const match = /^(\d+)d(\d+)(.*)$/.exec(formula.trim());
  return match ? `${Number(match[1]) + extra}d${match[2]}${match[3]}` : formula;
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
    // An Emanation moves with its caster, over whoever it reaches.
    if (trigger.around === "caster" && zone.casterId === mover.id && !zone.anchor) {
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
    if (!content || !content.trigger.on.includes("enter")) continue;
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

/** The zones a creature ending its turn inside sets off, before the next turn begins. A zone whose damage grows as its
 *  caster's turns end gains its die (SRD Delayed Blast Fireball: "the damage increases by 1d6 whenever your turn ends
 *  and the spell hasn't ended"). */
export function zonesAtTurnEnd(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  for (const zone of liveZones(state))
    if (zone.casterId === actorId && zoneContentOf(zone, deps.catalog)?.trigger.grows)
      zone.grown = Math.min(100, (zone.grown ?? 0) + 1);
  return [...zonesWhereItStands(state, actorId, "end-turn", deps), ...zonesAtCasterTurnEnd(state, actorId, deps)];
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
 * A turn's start: a spell that lasts its duration ends once its caster's turn comes round after it (`rounds`), a cloud
 * its caster's turn moves drifts away from it, and the zones the incoming creature starts its turn inside act on it.
 * Each zone's marks are cleared first: "once per turn" counts afresh.
 */
export function zonesAtTurnStart(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const zone of [...state.combat.spellZones]) {
    zone.entered = [];
    zone.affected = [];
    if (zone.casterId !== actorId || zone.bursting) continue;
    if (zone.rounds !== null && state.combat.round - zone.startedRound >= zone.rounds) {
      endZone(state, zone.id);
      events.push({ kind: "effect", text: `${zone.name} ends.`, actorId: zone.casterId });
      continue;
    }
    const drifts = zoneContentOf(zone, deps.catalog)?.trigger.drifts;
    if (drifts !== undefined && zoneHeld(state, zone)) events.push(...drift(state, zone, drifts, deps));
  }
  events.push(...zonesWhereItStands(state, actorId, "start-turn", deps));
  events.push(...zonesAtCasterTurnStart(state, actorId, deps));
  return events;
}

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
  const away = area && caster ? { x: area.geometry.origin.x - caster.x, y: area.geometry.origin.y - caster.y } : null;
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
  const moved = shapeGeometry(
    calibration,
    area.shape,
    { x: before.origin.x + shift.x, y: before.origin.y + shift.y },
    { x: before.target.x + shift.x, y: before.target.y + shift.y }
  );
  area.geometry = moved;
  const casterName = state.actors.find((actor) => actor.id === zone.casterId)?.name ?? "its caster";
  return [
    {
      kind: "effect",
      text: `${zone.name} drifts ${feet} feet away from ${casterName}.`,
      actorId: zone.casterId
    },
    ...zonesAfterAreaMove(state, area.id, before, deps)
  ];
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
