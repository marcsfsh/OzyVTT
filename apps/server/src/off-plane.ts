import type { GameState } from "@vtt/domain";
import { footprintOrigin } from "@vtt/rules-5e";
import { setAltitude } from "./altitude.js";
import { addEffect, makeEffect, type EffectNarration } from "./effects.js";
import { imageToGrid } from "./grid-calibration.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * Leaving the fight's plane (SRD 5.2.1 Banishment, Etherealness, Blink, Imprisonment, Maze, Hurl Through Hell): one
 * mechanism for all. A creature with an effect tagged `off-plane` leaves the map, keeping its place in the initiative,
 * and the space it left is kept (`combat.offPlane`). It can't be seen or targeted from the plane, nor target anyone on
 * it. When the effect ends it comes back to that space, or the nearest unoccupied one if another creature is there.
 * The pipeline's settle step does both after every command, so any way the effect starts or ends moves the token.
 */

export const OFF_PLANE_TAG = "off-plane";
/** Blink's effect on its caster: a d6 at the end of each of its turns sends it to the Ethereal Plane on a 4 or more. */
export const BLINK_TAG = "blink";

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

export const isOffPlane = (actor: Pick<Actor, "effects">): boolean =>
  actor.effects.some((effect) => effect.tags.includes(OFF_PLANE_TAG));

/** Whether a creature must leave the map or come back to it now. */
export function needsPlaneSettling(state: GameState): boolean {
  if (!state.combat.mapAssetId) return false;
  return state.actors.some((actor) => {
    const away = state.combat.offPlane.some((entry) => entry.actorId === actor.id);
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actor.id);
    return isOffPlane(actor) ? token?.position != null : away;
  });
}

/** Moves creatures off the map as they leave the plane and back as they return; returns what the table hears. */
export function settlePlanes(state: GameState, geometry: TokenMapGeometry): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const actor of state.actors) {
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actor.id);
    if (!token) continue;
    if (isOffPlane(actor) && token.position) {
      state.combat = {
        ...state.combat,
        offPlane: [
          ...state.combat.offPlane.filter((entry) => entry.actorId !== actor.id),
          {
            actorId: actor.id,
            position: { ...token.position },
            ...(token.altitudeFeet ? { altitudeFeet: token.altitudeFeet } : {}),
            ...(token.airborne ? { airborne: token.airborne } : {})
          }
        ]
      };
      setAltitude(state, actor.id, 0, undefined);
      moveEncounterToken(state, actor.id, null, geometry);
      events.push({ kind: "effect", text: `${actor.name} vanishes from this plane.`, actorId: actor.id });
      continue;
    }
    const away = state.combat.offPlane.find((entry) => entry.actorId === actor.id);
    if (!away || isOffPlane(actor)) continue;
    state.combat = {
      ...state.combat,
      offPlane: state.combat.offPlane.filter((entry) => entry.actorId !== actor.id)
    };
    const landing = nearestOpenSpace(state, actor.id, away.position, geometry);
    moveEncounterToken(state, actor.id, landing, geometry);
    if (landing === away.position) setAltitude(state, actor.id, away.altitudeFeet ?? 0, away.airborne);
    events.push({
      kind: "effect",
      text:
        landing === away.position
          ? `${actor.name} returns to the space it left.`
          : `${actor.name} returns to the nearest unoccupied space.`,
      actorId: actor.id
    });
  }
  return events;
}

/** The space it left, or on a grid the nearest one no other creature fills, searched ring by ring. */
function nearestOpenSpace(state: GameState, actorId: string, at: Point, geometry: TokenMapGeometry): Point {
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
  const filled = new Set(
    state.combat.tokens.flatMap((token) =>
      token.actorId === actorId || !token.position ? [] : cellsAt(token.position, token.sizeCells ?? 1)
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
  if (!actor || isOffPlane(actor) || !actor.effects.some((effect) => effect.tags.includes(BLINK_TAG))) return;
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
      tags: [OFF_PLANE_TAG],
      duration: { type: "until-source-next-turn" },
      sourceActorId: actorId,
      sourceName: actor.name,
      startedRound: state.combat.round,
      endsWithTag: BLINK_TAG
    })
  );
}
