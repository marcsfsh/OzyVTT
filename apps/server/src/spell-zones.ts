import type { SpellReference, SpellZone as ZoneTrigger } from "@vtt/content-srd-5.2.1";
import type { GameState, SpellZone } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { footprintInTemplate } from "./area-targeting.js";
import { areEnemies } from "./creature-sides.js";
import { CONCENTRATING_TAG, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { laterSpellAction, upcastAction } from "./item-actions.js";
import { creatureDistance, DISTANCE_TOLERANCE_FEET, mapDistance } from "./movement-narration.js";
import { CommandRejectedError } from "./game-store.js";
import { failureEffectFor } from "./resolution/pending.js";
import { createPendingSaves } from "./saving-throws.js";
import { countZoneDamage, endZone, zoneContentOf } from "./spell-zone-state.js";
import type { TokenMapGeometry } from "./token-placement.js";

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
type Meeting = "enters" | "is caught by" | "ends its turn in" | "starts its turn in" | "moves through";

/** The later action whose zone this spell leaves, if any. */
export function zoneRowOf(spell: SpellReference) {
  return (spell.effect?.laterActions ?? []).find((row) => row.zone !== undefined);
}

/** Whether a zone still stands: its caster holds the Concentration it belongs to. */
function holds(state: GameState, zone: SpellZone): boolean {
  if (zone.castId === null) return state.actors.some((actor) => actor.id === zone.casterId);
  return state.actors.some(
    (actor) =>
      actor.id === zone.casterId &&
      actor.effects.some((effect) => effect.castId === zone.castId && effect.tags.includes(CONCENTRATING_TAG))
  );
}

/** The zones still standing; one whose Concentration has gone is removed on the way. */
function liveZones(state: GameState): SpellZone[] {
  for (const zone of state.combat.spellZones) if (!holds(state, zone)) endZone(state, zone.id);
  return [...state.combat.spellZones];
}

const tokenOf = (state: GameState, actorId: string) =>
  state.combat.tokens.find((token) => token.actorId === actorId && token.position !== null);

/** "Is a creature of this size at this point inside the zone?", or null when the map can't say (no grid, the area
 *  not placed, its caster off the map). `casterAt` stands the caster of an Emanation somewhere else. */
function insideTest(
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

/** The creatures a zone can act on: those in the fight, on the map, not the anchor of an Emanation, and only the
 *  caster's enemies where the spell spares the rest. */
function exposed(
  state: GameState,
  zone: SpellZone,
  trigger: ZoneTrigger,
  deps: Pick<ZoneDeps, "resolveDefinition">
): Actor[] {
  const caster = state.actors.find((actor) => actor.id === zone.casterId);
  return state.combat.initiative.flatMap((entry) => {
    const creature = state.actors.find((actor) => actor.id === entry.actorId);
    if (!creature || !tokenOf(state, creature.id)) return [];
    if (trigger.around === "caster" && creature.id === zone.casterId) return [];
    if (trigger.affects === "enemies" && (!caster || !areEnemies(caster, creature, deps.resolveDefinition))) return [];
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

/** SRD Sleet Storm: a failure "and lose Concentration". */
const BREAKS_CONCENTRATION: ReadonlySet<string> = new Set(["sleet-storm"]);

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
  const travelling = meeting === "moves through";
  if (!travelling) {
    if ((meeting === "enters" || meeting === "is caught by") && zone.entered.includes(creature.id)) return;
    if (trigger.oncePerTurn && zone.affected.includes(creature.id)) return;
  }
  zone.entered = meeting === "enters" || meeting === "is caught by" ? [...zone.entered, creature.id] : zone.entered;
  zone.affected = zone.affected.includes(creature.id) ? zone.affected : [...zone.affected, creature.id];
  const built = laterSpellAction(spell, row, { attackBonus: 0, saveDc: zone.dc, bearersDc: false, modifier: 0 });
  const action = zone.level > spell.level ? upcastAction(built, spell, zone.level) : built;
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
    conditionIds
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
      ...(BREAKS_CONCENTRATION.has(spell.id) ? { breaksConcentration: true as const } : {})
    },
    // A creature can owe this zone a second save before answering the first (entering, then ending its turn there).
    replaceExisting: false,
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  events.push({
    kind: "effect",
    text: `${creature.name} ${meeting} ${spell.name} and makes a ${save.ability.toUpperCase()} save (DC ${save.dc}).`,
    actorId: creature.id,
    ...source
  });
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
  if (!mover || !moverToken || input.path.length < 2 || !state.combat.active) return events;
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
  if (!area || !state.combat.active) return events;
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

/** The zones a creature ending its turn inside sets off, before the next turn begins. */
export function zonesAtTurnEnd(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  return zonesWhereItStands(state, actorId, "end-turn", deps);
}

/**
 * A turn's start: a spell that lasts its duration ends once its caster's turn comes round after it (`rounds`), the
 * GM is reminded to move a cloud its caster's turn moves, and the zones the incoming creature starts its turn inside
 * act on it. Each zone's marks are cleared first: "once per turn" counts afresh.
 */
export function zonesAtTurnStart(state: GameState, actorId: string, deps: ZoneDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const zone of state.combat.spellZones) {
    zone.entered = [];
    zone.affected = [];
    if (zone.casterId !== actorId) continue;
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
