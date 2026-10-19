import type { GameState } from "@vtt/domain";
import { footprintOrigin } from "@vtt/rules-5e";
import { setAltitude } from "./altitude.js";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { ETHEREAL_SHUNT_TAG, ETHEREAL_TAG, isEthereal, onOtherPlanes, planeTravelBarred } from "./ethereal.js";
import type { FallDeps } from "./falling.js";
import { removeCombatant } from "./encounter.js";
import { clockMinutesOf } from "./game-time.js";
import { grantTeleport } from "./granted-moves.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { imageToGrid } from "./grid-calibration.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "./hit-points.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * Leaving the fight's plane (SRD 5.2.1 Banishment, Imprisonment, Maze, Hurl Through Hell): one mechanism for all. A
 * creature with an effect tagged `off-plane` leaves the map, keeping its place in the initiative, and the space it left
 * is kept (`combat.offPlane`). It can't be seen or targeted from the plane, nor target anyone on it. When the effect
 * ends it comes back to that space, or the nearest unoccupied one if another creature is there.
 *
 * The Border Ethereal overlaps the map (`ethereal.ts`): a creature there keeps its token and moves through the world
 * it left. Coming back where its token stands, a creature in that space shunts it to the nearest unoccupied one, with
 * 2 Force damage a foot for the Etherealness spell. The pipeline's settle step does all of it after every command, so
 * any way the effect starts or ends moves the token.
 */

export const OFF_PLANE_TAG = "off-plane";
/** Blink's effect on its caster: a d6 at the end of each of its turns sends it to the Ethereal Plane on a 4 or more. */
export const BLINK_TAG = "blink";
/** Blink: "You return to an unoccupied space of your choice that you can see within 10 feet of the space you left." */
const BLINK_RETURN_FEET = 10;
/** On Banishment's effect: "If the target is an Aberration, a Celestial, an Elemental, a Fey, or a Fiend, the target
 *  doesn't return if the spell lasts for 1 minute." */
export const BANISHED_HOME_TAG = "banished-home";
const HOME_PLANE_TYPES: ReadonlySet<string> = new Set(["aberration", "celestial", "elemental", "fey", "fiend"]);

type Actor = GameState["actors"][number];
type Token = GameState["combat"]["tokens"][number];
type Point = Readonly<{ x: number; y: number }>;
type OffPlaneEntry = GameState["combat"]["offPlane"][number];

export const isOffPlane = (actor: Pick<Actor, "effects">): boolean =>
  actor.effects.some((effect) => effect.tags.includes(OFF_PLANE_TAG));

/** On an effect: it ends once its bearer and its source are on different planes (an aboleth's Dominate Mind lasts
 *  "until the aboleth dies or is on a different plane of existence from the target"). */
export const ENDS_ACROSS_PLANES_TAG = "ends-across-planes";

/** The effects whose bearer and source are on different planes now, which end. */
function splitAcrossPlanes(state: GameState): Array<{ actorId: string; effectId: string }> {
  return state.actors.flatMap((actor) =>
    actor.effects.flatMap((effect) => {
      if (!effect.tags.includes(ENDS_ACROSS_PLANES_TAG)) return [];
      const source = state.actors.find((candidate) => candidate.id === effect.sourceActorId);
      return source && onOtherPlanes(source, actor) ? [{ actorId: actor.id, effectId: effect.id }] : [];
    })
  );
}

/** Whether a creature must leave the map, come back to it, or cross to or from the Border Ethereal now. */
export function needsPlaneSettling(state: GameState): boolean {
  if (!state.combat.mapAssetId) return false;
  if (splitAcrossPlanes(state).length > 0) return true;
  return state.actors.some((actor) => {
    const kept = state.combat.offPlane.find((entry) => entry.actorId === actor.id);
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actor.id);
    if (isOffPlane(actor)) return token?.position != null;
    if (isEthereal(actor)) return token?.position != null && kept?.ethereal !== true;
    return kept !== undefined;
  });
}

/** Moves creatures off the map as they leave the plane and back as they return, and marks those that cross to the
 *  Border Ethereal; returns what the table hears. Without `deps` a shunt deals no damage. */
export function settlePlanes(state: GameState, geometry: TokenMapGeometry, deps?: FallDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const { actorId, effectId } of splitAcrossPlanes(state)) events.push(...endEffect(state, actorId, effectId));
  for (const actor of state.actors) {
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actor.id);
    if (!token) continue;
    const kept = state.combat.offPlane.find((entry) => entry.actorId === actor.id);
    if (isOffPlane(actor) && token.position) {
      leave(state, actor.id, token, kept?.ethereal ? kept.position : token.position, staysGoneAt(state, actor, deps));
      moveEncounterToken(state, actor.id, null, geometry);
      events.push({ kind: "effect", text: `${actor.name} vanishes from this plane.`, actorId: actor.id });
      continue;
    }
    if (isEthereal(actor) && !isOffPlane(actor) && token.position && kept?.ethereal !== true) {
      etherealEntry(state, actor, token.position);
      events.push({ kind: "effect", text: `${actor.name} fades into the Border Ethereal.`, actorId: actor.id });
      continue;
    }
    if (!kept || isOffPlane(actor) || isEthereal(actor)) continue;
    state.combat = {
      ...state.combat,
      offPlane: state.combat.offPlane.filter((entry) => entry.actorId !== actor.id)
    };
    if (kept.ethereal) {
      if (token.position) events.push(...returnFromEthereal(state, actor, token.position, kept, geometry, deps));
      continue;
    }
    if (kept.staysGone && minuteRanOut(state, kept.staysGone)) {
      events.push(...sentHome(state, actor, deps));
      continue;
    }
    const landing = nearestOpenSpace(state, actor.id, kept.position, geometry);
    moveEncounterToken(state, actor.id, landing, geometry);
    if (landing === kept.position) setAltitude(state, actor.id, kept.altitudeFeet ?? 0, kept.airborne);
    events.push({
      kind: "effect",
      text:
        landing === kept.position
          ? `${actor.name} returns to the space it left.`
          : `${actor.name} returns to the nearest unoccupied space.`,
      actorId: actor.id
    });
  }
  return events;
}

/** Keeps the space a creature leaves the map from, and its height there. */
function leave(
  state: GameState,
  actorId: string,
  token: Token,
  position: Point,
  staysGone: OffPlaneEntry["staysGone"]
): void {
  state.combat = {
    ...state.combat,
    offPlane: [
      ...state.combat.offPlane.filter((entry) => entry.actorId !== actorId),
      {
        actorId,
        position: { ...position },
        ...(token.altitudeFeet ? { altitudeFeet: token.altitudeFeet } : {}),
        ...(token.airborne ? { airborne: token.airborne } : {}),
        ...(staysGone ? { staysGone } : {})
      }
    ]
  };
  setAltitude(state, actorId, 0, undefined);
}

/** When a banished Aberration, Celestial, Elemental, Fey or Fiend has been gone the full minute: the round 10 rounds
 *  on in a fight, or the game-clock minute after this one outside one. Undefined for any other creature. */
function staysGoneAt(state: GameState, actor: Actor, deps: FallDeps | undefined): OffPlaneEntry["staysGone"] {
  const banished = actor.effects.find((effect) => effect.tags.includes(BANISHED_HOME_TAG));
  if (!banished) return undefined;
  const definition = actor.definitionId ? deps?.resolveDefinition(actor.definitionId) : undefined;
  const type = creatureTypeOf(actor, definition);
  if (type === null || !HOME_PLANE_TYPES.has(type)) return undefined;
  return state.combat.active ? { round: banished.startedRound + 10 } : { minute: clockMinutesOf(state) + 1 };
}

const minuteRanOut = (state: GameState, at: NonNullable<OffPlaneEntry["staysGone"]>) =>
  at.round !== undefined
    ? state.combat.active && state.combat.round >= at.round
    : at.minute !== undefined && clockMinutesOf(state) >= at.minute;

/** "The target is instead transported to a random location on a plane (GM's choice) associated with its creature
 *  type": it stays off the map and leaves the fight. */
function sentHome(state: GameState, actor: Actor, deps: FallDeps | undefined): EffectNarration[] {
  const events: EffectNarration[] = [
    {
      kind: "effect",
      text: `${actor.name} doesn't return: the banishment held for its full minute.`,
      actorId: actor.id
    }
  ];
  const fighting = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id);
  if (fighting && deps && state.combat.turnActorId !== actor.id && state.combat.initiative.length > 1)
    events.push(...removeCombatant(state, actor.id, deps.resolveDefinition));
  else state.combat = { ...state.combat, tokens: state.combat.tokens.filter((token) => token.actorId !== actor.id) };
  return events;
}

/** Marks a creature as on the Border Ethereal, with what its return will do: a shunt that hurts (the Etherealness
 *  spell), or Blink's pick of a space within 10 feet. */
function etherealEntry(state: GameState, actor: Actor, position: Point): void {
  const ethereal = actor.effects.filter((effect) => effect.tags.includes(ETHEREAL_TAG));
  const blink = ethereal.some((effect) => effect.endsWithTag === BLINK_TAG);
  state.combat = {
    ...state.combat,
    offPlane: [
      ...state.combat.offPlane.filter((entry) => entry.actorId !== actor.id),
      {
        actorId: actor.id,
        position: { ...position },
        ethereal: true as const,
        ...(ethereal.some((effect) => effect.tags.includes(ETHEREAL_SHUNT_TAG)) ? { shunt: true as const } : {}),
        ...(blink ? { returnFeet: BLINK_RETURN_FEET } : {})
      }
    ]
  };
}

/** Etherealness: "When the spell ends, you return to the plane you left in the spot that corresponds to your space in
 *  the Border Ethereal. If you appear in an occupied space, you are shunted to the nearest unoccupied space and take
 *  Force damage equal to twice the number of feet you are moved." */
function returnFromEthereal(
  state: GameState,
  actor: Actor,
  at: Point,
  kept: OffPlaneEntry,
  geometry: TokenMapGeometry,
  deps: FallDeps | undefined
): EffectNarration[] {
  const events: EffectNarration[] = [];
  const landing = nearestOpenSpace(state, actor.id, at, geometry);
  if (landing === at)
    events.push({ kind: "effect", text: `${actor.name} returns from the Border Ethereal.`, actorId: actor.id });
  else {
    moveEncounterToken(state, actor.id, landing, geometry);
    const feet = feetBetween(geometry, at, landing);
    events.push({
      kind: "effect",
      text: `${actor.name} returns from the Border Ethereal into a filled space and is shunted ${feet} ft to the nearest unoccupied one.`,
      actorId: actor.id
    });
    if (kept.shunt && deps && feet > 0) events.push(...shuntDamage(state, actor, feet * 2, deps));
  }
  // Blink: a space of its choice that it can see within 10 feet of the one it left, taken as a teleport.
  if (kept.returnFeet && deps && state.combat.active)
    grantTeleport(state, actor, { id: deps.newId(), name: "Blink", teleport: { feet: kept.returnFeet } });
  return events;
}

/** Feet between two points as the grid counts them, each diagonal step one square. */
export function feetBetween(geometry: TokenMapGeometry, from: Point, to: Point): number {
  const calibration = geometry.calibration;
  if (!calibration) return 0;
  const a = imageToGrid(calibration, from);
  const b = imageToGrid(calibration, to);
  return Math.round(Math.max(Math.abs(a.column - b.column), Math.abs(a.row - b.row))) * calibration.distancePerCell;
}

function shuntDamage(state: GameState, actor: Actor, amount: number, deps: FallDeps): EffectNarration[] {
  const { application, events } = applyDamageDetailed(
    state,
    actor.id,
    {
      amount,
      parts: [{ amount, type: "force" }],
      sourceName: "the shunt from the Border Ethereal",
      sourceActorId: null
    },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.random,
      newId: deps.newId,
      now: deps.now,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
      ...(deps.commandId ? { commandId: deps.commandId } : {})
    }
  );
  return [
    {
      kind: "damage",
      text: `${actor.name} takes ${application.totalApplied} Force damage from the shunt${damageAdjustmentDetail(application)}.`,
      actorId: actor.id
    },
    ...events
  ];
}

/** The space it left, or on a grid the nearest one no other creature fills, searched ring by ring. */
export function nearestOpenSpace(state: GameState, actorId: string, at: Point, geometry: TokenMapGeometry): Point {
  const calibration = geometry.calibration;
  if (!calibration) return at;
  const sizeCells = state.combat.tokens.find((token) => token.actorId === actorId)?.sizeCells ?? 1;
  const cellsAt = (point: Point, size: number) => {
    const origin = footprintOrigin(imageToGrid(calibration, point), size);
    const cells: string[] = [];
    for (let column = 0; column < size; column++)
      for (let row = 0; row < size; row++) cells.push(`${origin.column + column},${origin.row + row}`);
    return cells;
  };
  // A spell's force (Spiritual Weapon's) fills no space, nor does a creature on another plane than the mover's.
  const mover = state.actors.find((actor) => actor.id === actorId);
  const intangible = new Set(
    state.actors
      .filter((actor) => actor.summon?.intangible || (mover !== undefined && onOtherPlanes(actor, mover)))
      .map((actor) => actor.id)
  );
  const filled = new Set(
    state.combat.tokens.flatMap((token) =>
      token.actorId === actorId || !token.position || intangible.has(token.actorId)
        ? []
        : cellsAt(token.position, token.sizeCells ?? 1)
    )
  );
  const open = (point: Point) =>
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= geometry.width &&
    point.y <= geometry.height &&
    cellsAt(point, sizeCells).every((cell) => !filled.has(cell));
  if (open(at)) return at;
  const step = calibration.cellSizePx;
  const cos = Math.cos(calibration.rotationRadians);
  const sin = Math.sin(calibration.rotationRadians);
  for (let ring = 1; ring <= 20; ring++)
    for (let dx = -ring; dx <= ring; dx++)
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const point = { x: at.x + (dx * cos - dy * sin) * step, y: at.y + (dx * sin + dy * cos) * step };
        if (open(point)) return point;
      }
  return at;
}

/** Blink: at the end of each of its caster's turns, a d6 of 4 or more sends it to the Ethereal Plane until the start
 *  of its next turn, or until the spell ends. */
export function blinkAway(
  state: GameState,
  actorId: string,
  rollDie: (sides: number) => number,
  newId: () => string,
  events: EffectNarration[]
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (
    !actor ||
    isOffPlane(actor) ||
    isEthereal(actor) ||
    planeTravelBarred(actor) ||
    !actor.effects.some((effect) => effect.tags.includes(BLINK_TAG))
  )
    return;
  const face = rollDie(6);
  const vanishes = face >= 4;
  events.push({
    kind: "effect",
    text: `${actor.name} rolls ${face} for Blink${vanishes ? " and blinks onto the Ethereal Plane" : ""}.`,
    actorId
  });
  if (!vanishes) return;
  addEffect(
    state,
    actorId,
    makeEffect({
      id: newId(),
      name: "Ethereal (Blink)",
      tags: [ETHEREAL_TAG],
      duration: { type: "until-source-next-turn" },
      sourceActorId: actorId,
      sourceName: actor.name,
      startedRound: state.combat.round,
      endsWithTag: BLINK_TAG
    })
  );
}
