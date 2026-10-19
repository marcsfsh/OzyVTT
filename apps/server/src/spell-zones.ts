import type { SpellReference, SpellZone as ZoneTrigger } from "@vtt/content-srd-5.2.1";
import type { GameState, SpellZone } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { footprintInTemplate } from "./area-targeting.js";
import { holdsFeature } from "./class-features.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { areAllies, areEnemies } from "./creature-sides.js";
import { CONCENTRATING_TAG, endEffectIfPresent, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { applyDamageDetailed, damageAdjustmentDetail, healActor } from "./hit-points.js";
import { laterSpellAction, upcastAction } from "./item-actions.js";
import { creatureDistance, DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import { CommandRejectedError } from "./game-store.js";
import { failureEffectFor } from "./resolution/pending.js";
import { createPendingSaves } from "./saving-throws.js";
import { countZoneDamage, endZone, removeZone, zoneContentOf } from "./spell-zone-state.js";
import type { TokenMapGeometry } from "./token-placement.js";
import { withArticle } from "@vtt/domain";

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

/** The later action whose zone this spell leaves, if any. */
export function zoneRowOf(spell: SpellReference) {
  return (spell.effect?.laterActions ?? []).find((row) => row.zone !== undefined);
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

/** "Is a creature of this size at this point inside the zone?", or null when the map can't say (no grid, the area
 *  not placed, its caster off the map). `casterAt` stands the caster of an Emanation somewhere else. */
export function insideTest(
  state: GameState,
  zone: SpellZone,
  trigger: ZoneTrigger,
  spell: SpellReference,
  geometry: TokenMapGeometry | null,
  casterAt?: Point
): ((position: Point, sizeCells: number) => boolean) | null {
  const calibration = geometry?.calibration ?? null;
  if (!geometry || !calibration) return null;
  const cell = { sizeCells: 1, sizePx: calibration.cellSizePx };
  const within =
    (from: Readonly<{ position: Point; sizeCells: number; sizePx: number }>, feet: number) =>
    (position: Point, sizeCells: number) => {
      const apart = creatureDistance(geometry, from, {
        position,
        sizeCells,
        sizePx: calibration.cellSizePx * sizeCells
      });
      return apart !== null && apart.value <= feet + DISTANCE_TOLERANCE_FEET;
    };
  if (trigger.around === "caster") {
    const caster = tokenOf(state, zone.casterId);
    if (!caster?.position) return null;
    return within(
      { position: casterAt ?? caster.position, sizeCells: caster.sizeCells, sizePx: caster.sizePx },
      trigger.feet ?? 5
    );
  }
  const area = zone.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  if (!area || area.shape === null) return null;
  if (trigger.around === "point") return within({ ...cell, position: area.geometry.origin }, trigger.feet ?? 5);
  const shape = area.shape;
  return (position, sizeCells) =>
    footprintInTemplate(calibration, area.geometry, shape, spell.area?.widthFeet ?? null, position, sizeCells);
}

/** The traits that free a creature from a kind of ground (SRD Web Walker: it "ignores movement restrictions caused by
 *  webs", so webs neither slow nor hold it; Ice Walk: "Difficult Terrain composed of ice or snow doesn't cost it extra
 *  movement"). */
const FREE_ON: Readonly<Record<string, Readonly<{ id: string; name: string; uncaught: boolean }>>> = {
  webs: { id: "web-walker", name: "Web Walker", uncaught: true },
  ice: { id: "ice-walk", name: "Ice Walk", uncaught: false }
};

/** Whether the creature crosses this kind of ground at no extra cost; with `caught`, whether the ground can't hold it
 *  either. */
export function movesFreelyOn(
  creature: Actor,
  kind: string,
  deps: Pick<ZoneDeps, "resolveDefinition">,
  caught = false
): boolean {
  const trait = FREE_ON[kind];
  if (!trait || !creature.definitionId || (caught && !trait.uncaught)) return false;
  return holdsFeature(deps.resolveDefinition(creature.definitionId), trait.id, trait.name);
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
  deps: Pick<ZoneDeps, "resolveDefinition">
): Actor[] {
  const caster = state.actors.find((actor) => actor.id === zone.casterId);
  const kind = trigger.terrain?.kind;
  return creaturesOnMap(state).flatMap((creature) => {
    // "You and your allies": an aura its caster carries reaches the caster too.
    const own = creature.id === zone.casterId;
    if (trigger.around === "caster" && own && trigger.affects !== "allies") return [];
    if (trigger.affects === "enemies" && (!caster || !areEnemies(caster, creature, deps.resolveDefinition))) return [];
    if (trigger.affects === "allies" && !own && (!caster || !areAllies(caster, creature, deps.resolveDefinition)))
      return [];
    if (kind && movesFreelyOn(creature, kind, deps, true)) return [];
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
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): ((position: Point, sizeCells: number) => boolean) | null {
  const tests: Array<(position: Point, sizeCells: number) => boolean> = [];
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content?.trigger.halvesSpeed) continue;
    if (!exposed(state, zone, content.trigger, deps).some((creature) => creature.id === actorId)) continue;
    const inside = insideTest(state, zone, content.trigger, content.spell, deps.geometry);
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
  const { spell, row, trigger } = content;
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
      text: `${spell.name}: ${creature.name} ${meeting} ${caster.name}'s warded area.`,
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
      text: `${creature.name} sets off ${spell.name}.`,
      actorId: creature.id,
      source: { actorId: caster.id, name: caster.name }
    });
    events.push(...endZoneAndItsSpell(state, zone.id));
    return;
  }
  if (trigger.once) events.push(...endZoneAndItsSpell(state, zone.id));
  const action = zoneAction(zone, spell, row);
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
      { amount: total, parts, sourceName: spell.name, sourceActorId: caster.id },
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
        text: `${creature.name} ${meeting} ${spell.name} and takes ${application.totalApplied}${typed} damage${damageAdjustmentDetail(application)}.`,
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
    { spell, level: zone.level }
  );
  // A save at the start of the creature's own turn that lasts "until the end of that turn" ends with this one.
  const currentTurn = meeting === "starts its turn in" && save.failureDuration?.type === "until-bearer-turn-end";
  createPendingSaves(state, {
    sourceActorId: caster.id,
    sourceName: caster.name,
    actionName: spell.name,
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
      ...(save.breaksConcentration ? { breaksConcentration: true as const } : {})
    },
    // A creature can owe this zone a second save before answering the first (entering, then ending its turn there).
    replaceExisting: false,
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  events.push({
    kind: "effect",
    text: `${creature.name} ${meeting} ${spell.name} and makes ${withArticle(`${save.ability.toUpperCase()} save`)} (DC ${save.dc}).`,
    actorId: creature.id,
    ...source
  });
}

/** The action a zone acts with: its spell's later action at the cast's level, in the damage type chosen at the cast
 *  (Conjure Elemental's element), with the dice it has gained (Delayed Blast Fireball's 1d6 a turn). */
function zoneAction(
  zone: SpellZone,
  spell: SpellReference,
  row: NonNullable<ReturnType<typeof zoneContentOf>>["row"]
): ActorAction {
  const built = laterSpellAction(spell, row, { attackBonus: 0, saveDc: zone.dc, bearersDc: false, modifier: 0 });
  const action = zone.level > spell.level ? upcastAction(built, spell, zone.level) : built;
  return {
    ...action,
    damage: action.damage.map((part, index) => ({
      formula: index === 0 && (zone.grown ?? 0) > 0 ? withMoreDice(part.formula, zone.grown ?? 0) : part.formula,
      type: zone.damageType ?? part.type
    }))
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
    const { spell, trigger } = content;
    // An Emanation moves with its caster, over whoever it reaches.
    if (trigger.around === "caster" && zone.casterId === mover.id) {
      const tests = path.map((point) => insideTest(state, zone, trigger, spell, deps.geometry, point));
      if (!trigger.on.includes("enter") || tests.some((test) => test === null)) continue;
      for (const creature of exposed(state, zone, trigger, deps)) {
        const at = tokenOf(state, creature.id)!;
        const hits = tests.map((test) => test!(at.position!, at.sizeCells));
        if (!hits[0] && hits.slice(1).some(Boolean)) act(state, zone, creature, "is caught by", deps, events);
      }
      continue;
    }
    if (!exposed(state, zone, trigger, deps).some((creature) => creature.id === mover.id)) continue;
    const inside = insideTest(state, zone, trigger, spell, deps.geometry);
    if (!inside) continue;
    const hits = path.map((point) => inside(point, moverToken.sizeCells));
    if (trigger.on.includes("enter") && !hits[0] && hits.slice(1).some(Boolean))
      act(state, zone, mover, "enters", deps, events);
    if (trigger.on.includes("travel") && !input.teleported && deps.geometry) {
      let feet = 0;
      for (let index = 1; index < path.length; index++)
        if (hits[index]) feet += mapDistance(deps.geometry, path[index - 1]!, path[index]!)?.value ?? 0;
      act(state, zone, mover, "moves through", deps, events, Math.floor((feet + DISTANCE_TOLERANCE_FEET) / 5));
    }
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
    const { spell, trigger } = content;
    const now = insideTest(state, zone, trigger, spell, deps.geometry);
    const after = area.geometry;
    area.geometry = { ...after, origin: before.origin, target: before.target };
    const then = insideTest(state, zone, trigger, spell, deps.geometry);
    const wasInside = new Set(
      then === null
        ? []
        : exposed(state, zone, trigger, deps)
            .filter((creature) => {
              const token = tokenOf(state, creature.id)!;
              return then(token.position!, token.sizeCells);
            })
            .map((creature) => creature.id)
    );
    area.geometry = after;
    if (!now) continue;
    for (const creature of exposed(state, zone, trigger, deps)) {
      const token = tokenOf(state, creature.id)!;
      if (!wasInside.has(creature.id) && now(token.position!, token.sizeCells))
        act(state, zone, creature, "is caught by", deps, events);
    }
  }
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
    const inside = insideTest(state, zone, content.trigger, content.spell, deps.geometry);
    if (!inside) continue;
    for (const creature of exposed(state, zone, content.trigger, deps)) {
      const token = tokenOf(state, creature.id)!;
      if (inside(token.position!, token.sizeCells)) act(state, zone, creature, "is caught in", deps, events);
    }
  }
  return events;
}

/**
 * A turn's start: a spell that lasts its duration ends once its caster's turn comes round after it (`rounds`), the
 * GM is reminded to move a cloud its caster's turn moves, and the zones the incoming creature starts its turn inside
 * act on it. Each zone's marks are cleared first: "once per turn" counts afresh.
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
    if (MOVES_AT_CASTER_TURN.has(zone.spellId))
      events.push({
        kind: "effect",
        text: `${zone.name} moves 10 feet away from its caster: drag its area on the map.`,
        actorId: zone.casterId,
        gmOnly: true
      });
  }
  events.push(...zonesWhereItStands(state, actorId, "start-turn", deps));
  events.push(...zonesAtCasterTurnStart(state, actorId, deps));
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
    const { spell, trigger } = content;
    const inside = insideTest(state, zone, trigger, spell, deps.geometry);
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
      return inside(token.position!, token.sizeCells);
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
      const { spell, row, trigger } = content;
      // The burst fills the whole area the cast placed, whatever set it off (a glyph stepped on).
      const { around: _around, ...whole } = trigger;
      const inside = insideTest(state, zone, whole, spell, deps.geometry);
      const caught = inside
        ? creaturesOnMap(state).filter((creature) => {
            const token = tokenOf(state, creature.id)!;
            return inside(token.position!, token.sizeCells);
          })
        : [];
      const action = zoneAction(zone, spell, row);
      const parts = action.damage.map((part) => ({
        amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie).total),
        type: part.type
      }));
      const save = action.save;
      if (save && caught.length > 0)
        createPendingSaves(state, {
          sourceActorId: caster.id,
          sourceName: caster.name,
          actionName: spell.name,
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

/** SRD Cloudkill and Incendiary Cloud: the Sphere "moves 10 feet away from you at the start of each of your turns". */
const MOVES_AT_CASTER_TURN: ReadonlySet<string> = new Set(["cloudkill", "incendiary-cloud"]);

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
    const { spell, trigger } = content;
    const creature = exposed(state, zone, trigger, deps).find((candidate) => candidate.id === actorId);
    const token = creature ? tokenOf(state, creature.id) : undefined;
    const inside = insideTest(state, zone, trigger, spell, deps.geometry);
    if (!creature || !token || !inside || !inside(token.position!, token.sizeCells)) continue;
    // SRD Aura of Life: "When an ally with 0 Hit Points starts its turn in the aura, that ally regains 1 Hit Point."
    if (when === "start-turn" && trigger.revives && creature.hp.current <= 0) {
      events.push(
        { kind: "effect", text: `${creature.name} regains ${trigger.revives} Hit Point in ${spell.name}.`, actorId },
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
