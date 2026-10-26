import { isDead, type CombatState, type GameState } from "@vtt/domain";
import { parseDiceFormula, pointInRects, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { altitudeOf } from "./altitude.js";
import { footprintCellCenters } from "./area-targeting.js";
import { HOLDING_BREATH_TAG, startHoldingBreath } from "./breath.js";
import { endEffect, type EffectNarration } from "./effects.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { gridToImage, type SquareGridCalibration } from "./grid-calibration.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { walksOnLiquid } from "./speed.js";
import { traitMechanicsOf, traitOf } from "./statblock-traits.js";

/**
 * Water on the map (SRD 5.2.1 Swimming; the monsters that fear or need it). The GM paints still and running water
 * (`terrain.ts`); a creature is in water when any square of its space is, at ground level, unless it walks on the
 * surface (Water Walk, Acrobatic Movement). What reads it: swimming costs (`movementCost`), a fire elemental's Water
 * Susceptibility as it moves, a vampire's Running Water as its turn ends and its Shape-Shift and Misty Escape, which
 * fail in running water, and a sahuagin's Limited Amphibiousness, which counts its time out of water on the game clock.
 */

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;
export type WaterKind = "still" | "running";

/** The tag on the held breath a creature starts when it has been out of water too long (Limited Amphibiousness). */
export const OUT_OF_WATER_TAG = "out-of-water";

export type WaterDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  rollDie: RandomSource;
  newId?: () => string;
  now?: () => string;
}>;

/** The water under a creature of this size at this point and height: running when any square of its space is in
 *  running water, still when any is in still water, none when none is or it is off the ground. Without a grid, its
 *  centre is read. */
export function waterAt(
  terrain: Pick<CombatState["terrain"], "water" | "runningWater">,
  calibration: SquareGridCalibration | null | undefined,
  position: Point,
  sizeCells: number,
  altitudeFeet = 0
): WaterKind | null {
  if (altitudeFeet > 0 || (terrain.water.length === 0 && terrain.runningWater.length === 0)) return null;
  const points = calibration
    ? footprintCellCenters(calibration, position, sizeCells).map((center) => gridToImage(calibration, center))
    : [position];
  if (points.some((point) => pointInRects(point, terrain.runningWater))) return "running";
  if (points.some((point) => pointInRects(point, terrain.water))) return "still";
  return null;
}

/** The water a creature is in on the live map: none for one off the ground, off the map, or walking on the surface. */
export function waterOf(
  state: GameState,
  actorId: string,
  calibration?: SquareGridCalibration | null,
  deps?: Pick<WaterDeps, "resolveDefinition" | "catalog">
): WaterKind | null {
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!token?.position || !actor) return null;
  const kind = waterAt(state.combat.terrain, calibration, token.position, token.sizeCells, altitudeOf(token));
  if (kind === null) return null;
  const definition = actor.definitionId ? deps?.resolveDefinition(actor.definitionId) : undefined;
  const offTurn = state.combat.active && state.combat.turnActorId !== actorId;
  return walksOnLiquid(actor, deps ? deriveEquipment(actor, definition, deps.catalog) : undefined, offTurn)
    ? null
    : kind;
}

/** Whether a creature is submerged: in water on the map, or fighting in a fight the GM marked as underwater. */
export function submerged(state: GameState, actorId: string, calibration?: SquareGridCalibration | null): boolean {
  const fighting = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId);
  if (fighting && state.combat.underwater) return true;
  return waterOf(state, actorId, calibration) !== null;
}

/** One trait's damage, dealt by the creature's surroundings. */
function hurtBy(
  state: GameState,
  actor: Actor,
  traitName: string,
  parts: ReadonlyArray<{ amount: number; type: string }>,
  why: string,
  deps: WaterDeps
): EffectNarration[] {
  const amount = parts.reduce((sum, part) => sum + part.amount, 0);
  if (amount <= 0) return [];
  const { application, events } = applyDamageDetailed(
    state,
    actor.id,
    { amount, parts, sourceName: traitName, sourceActorId: null },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.rollDie,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.newId ? { newId: deps.newId } : {}),
      ...(deps.now ? { now: deps.now } : {})
    }
  );
  const type = parts[0]!.type;
  return [
    {
      kind: "damage",
      text: `${actor.name} takes ${application.totalApplied} ${type[0]!.toUpperCase()}${type.slice(1)} damage ${why} (${traitName})${damageAdjustmentDetail(application)}.`,
      actorId: actor.id
    },
    ...events
  ];
}

/**
 * SRD Water Susceptibility (the fire elemental): "The elemental takes 3 (1d6) Cold damage for every 5 feet the
 * elemental moves in water." Each step of its way that ends in water counts, a square's worth of feet at a time.
 */
export function waterAlongMove(
  state: GameState,
  moverId: string,
  path: readonly Point[],
  calibration: SquareGridCalibration,
  deps: WaterDeps
): EffectNarration[] {
  const mover = state.actors.find((actor) => actor.id === moverId);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === moverId);
  if (!mover || !token || path.length < 2 || isDead(mover)) return [];
  const definition = mover.definitionId ? deps.resolveDefinition(mover.definitionId) : undefined;
  const trait = traitMechanicsOf(definition).find(
    (candidate): candidate is Extract<typeof candidate, { kind: "water-weakness" }> =>
      candidate.kind === "water-weakness" && candidate.moving !== undefined
  );
  if (!trait?.moving) return [];
  const offTurn = state.combat.active && state.combat.turnActorId !== moverId;
  if (walksOnLiquid(mover, deriveEquipment(mover, definition, deps.catalog), offTurn)) return [];
  const steps = path
    .slice(1)
    .filter(
      (point) => waterAt(state.combat.terrain, calibration, point, token.sizeCells, altitudeOf(token)) !== null
    ).length;
  const fives = Math.round((steps * calibration.distancePerCell) / 5);
  if (fives <= 0) return [];
  let amount = 0;
  for (let five = 0; five < fives; five += 1)
    amount += Math.max(0, resolveDice(parseDiceFormula(trait.moving.formula), deps.rollDie).total);
  return hurtBy(
    state,
    mover,
    trait.name,
    [{ amount, type: trait.moving.type }],
    `moving ${fives * 5} feet through water`,
    deps
  );
}

/** SRD Vampire Weakness: "The vampire takes 20 Acid damage if it ends its turn in running water." */
export function runningWaterAtTurnEnd(
  state: GameState,
  actorId: string,
  calibration: SquareGridCalibration | null | undefined,
  deps: WaterDeps
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || isDead(actor)) return [];
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const trait = traitMechanicsOf(definition).find(
    (candidate): candidate is Extract<typeof candidate, { kind: "water-weakness" }> =>
      candidate.kind === "water-weakness" && candidate.endsTurnInRunning !== undefined
  );
  if (!trait?.endsTurnInRunning || waterOf(state, actorId, calibration, deps) !== "running") return [];
  return hurtBy(
    state,
    actor,
    trait.name,
    [{ amount: trait.endsTurnInRunning.amount, type: trait.endsTurnInRunning.type }],
    "ending its turn in running water",
    deps
  );
}

/**
 * SRD Limited Amphibiousness (the sahuagin): "it must be submerged at least once every 4 hours to avoid suffocating
 * outside water." Its time out of water counts on the game clock; once it reaches the trait's hours, it starts to run
 * out of breath as Suffocation says (`breath.ts`), and being submerged again lets it breathe and starts the count over.
 */
export function drynessOverTime(
  state: GameState,
  actorIds: ReadonlySet<string>,
  minutes: number,
  deps: Pick<WaterDeps, "resolveDefinition">
): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    if (!actorIds.has(actor.id) || isDead(actor)) continue;
    const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
    const trait = traitOf(definition, "dries-out");
    if (!trait) continue;
    if (submerged(state, actor.id)) {
      events.push(...wetAgain(state, actor));
      continue;
    }
    const dry = (actor.exposure?.dryMinutes ?? 0) + minutes;
    actor.exposure = { ...actor.exposure, dryMinutes: Math.min(10_000_000, dry) };
    if (dry < trait.hours * 60 || actor.effects.some((effect) => effect.breath !== undefined)) continue;
    events.push({
      kind: "effect",
      text: `${actor.name} has been out of water for ${trait.hours} hours (${trait.name}).`,
      actorId: actor.id
    });
    events.push(...startHoldingBreath(state, actor, definition, { outOfWater: true }));
  }
  return events;
}

/** A creature that must be submerged now and then is in water: its count starts over and it breathes again. */
function wetAgain(state: GameState, actor: Actor): EffectNarration[] {
  if (actor.exposure?.dryMinutes) actor.exposure = { ...actor.exposure, dryMinutes: 0 };
  const breath = actor.effects.find(
    (effect) => effect.tags.includes(OUT_OF_WATER_TAG) && effect.tags.includes(HOLDING_BREATH_TAG)
  );
  return breath ? endEffect(state, actor.id, breath.id) : [];
}

/** As a turn ends in water, a creature that must be submerged now and then is wet again. */
export function submergedAtTurnEnd(
  state: GameState,
  actorId: string,
  calibration: SquareGridCalibration | null | undefined,
  deps: Pick<WaterDeps, "resolveDefinition">
): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  if (!traitOf(definition, "dries-out") || !submerged(state, actorId, calibration)) return [];
  return wetAgain(state, actor);
}
