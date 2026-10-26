import type { GameState, VisionWall } from "@vtt/domain";
import { clockMinutesOf } from "../game-time.js";
import { CommandRejectedError } from "../game-store.js";
import { isHiddenDoor } from "../doors.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { damageObject, findObject } from "../objects.js";
import { nearestPointOf } from "../spell-walls.js";
import { policeBarrier } from "../zone-barriers.js";
import { clearLine, distance, type Point } from "../vision/geometry.js";
import { sceneSight, segmentsOf } from "../vision/sight.js";
import { spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * Objects as the targets of save actions and areas (SRD 5.2.1 Breaking Objects: an object "fails all saving throws";
 * Acid and Alchemist's Fire: "Target one creature or object"; Shatter: "A nonmagical object that isn't being worn or
 * carried also takes the damage if it's in the spell's area"). An action whose targets take objects can be aimed at a
 * door or a wall of the map that is an object: it fails the save and takes the whole of the damage. A placed area that
 * harms objects deals its damage to each such door or wall under it, where a line from the area's origin reaches it.
 * The walls a spell or an item raised are magic and left alone.
 */

/** Oil dries after 1 minute (SRD Oil). */
const OIL_ROUNDS = 10;

type Placed = NonNullable<ResolveContext["input"]["placedArea"]>;

/** Whether the resolve is aimed at an object on the map: an action whose targets take objects, given a wall. */
export const aimsAtObject = (ctx: Pick<ResolveContext, "input" | "action">): boolean =>
  ctx.input.wallId !== undefined && ctx.action.targets?.objects === true;

/** A door or a wall that is an object, as a creature on the map may aim at it. */
function aimable(ctx: ResolveContext): VisionWall {
  const wall = ctx.state.combat.vision.walls.find((candidate) => candidate.id === ctx.input.wallId);
  const hidden = wall !== undefined && isHiddenDoor(wall) && ctx.deps.initiatorRole === "player";
  if (!wall || hidden || !findObject(ctx.state, { wallId: wall.id }))
    throw new CommandRejectedError("Choose a door, or a wall that can be broken, on the map.");
  if (wall.source !== undefined) throw new CommandRejectedError(`${ctx.action.name} can't harm a wall of magic.`);
  return wall;
}

/** The object the action is aimed at, checked for range and, where the action says so, sight. Throws before anything is
 *  spent. */
export function checkObjectTarget(ctx: ResolveContext): void {
  if (!aimsAtObject(ctx)) return;
  checkWallReach(ctx, aimable(ctx));
}

/** The wall or door an action is aimed at is within its targets' range of the user and, where they say so, seen. */
export function checkWallReach(ctx: ResolveContext, wall: VisionWall): void {
  const { state, attacker, input } = ctx;
  const pixelsPerFoot = state.combat.vision.measure?.pixelsPerFoot ?? null;
  const at = nearestPointOf(state, wall, attacker.id);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === attacker.id);
  if (!at || !pixelsPerFoot || !token?.position) return;
  const range = ctx.action.targets?.rangeFeet;
  const half = ((token.gridSizePx ?? token.sizePx) * token.sizeCells) / 2;
  const feet = Math.max(0, distance(token.position, at) - half) / pixelsPerFoot;
  if (range !== undefined && feet > range + DISTANCE_TOLERANCE_FEET) {
    const said = policeBarrier(
      state,
      input.override ?? null,
      "range.out-of-range",
      `That ${wall.kind === "door" ? "door" : "wall"} is ${Math.round(feet)} ft away, beyond ${ctx.action.name}'s ${range} ft.`
    );
    if (said) ctx.warnings.push(said);
  }
  if (ctx.action.targets?.seen) {
    const sight = sceneSight(state, {
      ...(ctx.deps.resolveDefinition ? { definition: ctx.deps.resolveDefinition } : {}),
      ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
    });
    if (sight.enabled && !sight.seesPoint(attacker.id, faceToward(at, token.position))) {
      const said = policeBarrier(
        state,
        input.override ?? null,
        "target.unseen",
        `${attacker.name} can't see that ${wall.kind === "door" ? "door" : "wall"}.`
      );
      if (said) ctx.warnings.push(said);
    }
  }
}

/** A point a pixel off a wall, toward `from`: its face as seen from there. */
function faceToward(at: Point, from: Point): Point {
  const gap = distance(from, at);
  return gap > 1 ? { x: at.x + (from.x - at.x) / gap, y: at.y + (from.y - at.y) / gap } : at;
}

/** The damage the resolve rolled, as parts an object takes. */
const rolledParts = (ctx: ResolveContext) => [
  ...ctx.damage.map((part) => ({ amount: Math.max(0, part.total), type: part.type })),
  ...ctx.bonusDamage.map((part) => ({ amount: Math.max(0, part.amount), type: part.type }))
];

/** Deals the damage to one object and tells the table, coating it in oil where the action does that. */
function strike(ctx: ResolveContext, wallId: string, coats: boolean): void {
  const { state, attacker } = ctx;
  const parts = rolledParts(ctx).filter((part) => part.amount > 0);
  const label = (wall: VisionWall | undefined) => (wall?.kind === "door" ? "the door" : "the wall");
  const wall = state.combat.vision.walls.find((candidate) => candidate.id === wallId);
  const told = (text: string) =>
    ctx.tableNarration.push(tableLineOf(ctx, { kind: "effect", text, actorId: attacker.id }));
  const stats = findObject(state, { wallId })?.stats;
  if (coats && stats) {
    const oiledUntil = {
      ...(state.combat.active ? { round: state.combat.round + OIL_ROUNDS - 1 } : {}),
      minute: clockMinutesOf(state) + 1
    };
    state.combat = {
      ...state.combat,
      vision: {
        ...state.combat.vision,
        walls: state.combat.vision.walls.map((candidate) =>
          candidate.id === wallId ? { ...candidate, object: { ...stats, oiledUntil } } : candidate
        )
      }
    };
    told(`${ctx.action.name} covers ${label(wall)} in oil.`);
  }
  if (parts.length === 0) return;
  const hit = damageObject(state, { wallId }, parts);
  told(
    hit.destroyed
      ? `${ctx.action.name} deals ${hit.damage.total} damage to ${label(wall)}, and it breaks.`
      : hit.damage.belowThreshold
        ? `${ctx.action.name} doesn't get past the damage threshold of ${label(wall)}.`
        : `${ctx.action.name} deals ${hit.damage.total} damage to ${label(wall)}.`
  );
}

/** The action aimed at an object: the object fails its save and takes the damage rolled (or the oil). */
export function strikeObjectTarget(ctx: ResolveContext): void {
  if (!aimsAtObject(ctx) || ctx.input.commit === false) return;
  strike(ctx, ctx.input.wallId!, ctx.action.save?.failureHazard === "oil");
}

/** Whether a point lies in a placed template, in image space: a circle's radius, a square's box, a Line's width along
 *  it, a Cone as wide as it is far. */
function inTemplate(placed: Placed, widthPx: number, point: Point): boolean {
  const { origin, target } = placed;
  if (placed.shape === "circle") return distance(origin, point) <= distance(origin, target) + 0.5;
  if (placed.shape === "square")
    return (
      point.x >= Math.min(origin.x, target.x) - 0.5 &&
      point.x <= Math.max(origin.x, target.x) + 0.5 &&
      point.y >= Math.min(origin.y, target.y) - 0.5 &&
      point.y <= Math.max(origin.y, target.y) + 0.5
    );
  const length = distance(origin, target);
  if (length === 0) return false;
  const axis = { x: (target.x - origin.x) / length, y: (target.y - origin.y) / length };
  const along = (point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y;
  const across = Math.abs((point.x - origin.x) * -axis.y + (point.y - origin.y) * axis.x);
  if (along < -0.5 || along > length + 0.5) return false;
  return across <= (placed.shape === "cone" ? along / 2 : widthPx / 2) + 0.5;
}

/** The doors and walls that are objects under a placed area (any of five points along them inside it, reached by a
 *  straight line from the area's origin with dynamic vision on), the walls magic raised left out. */
export function objectsUnder(state: GameState, placed: Placed, widthFeet: number | null): VisionWall[] {
  const vision = state.combat.vision;
  const pixelsPerFoot = vision.measure?.pixelsPerFoot;
  if (!pixelsPerFoot) return [];
  const widthPx = (widthFeet ?? 5) * pixelsPerFoot;
  const origin =
    placed.shape === "square"
      ? { x: (placed.origin.x + placed.target.x) / 2, y: (placed.origin.y + placed.target.y) / 2 }
      : placed.origin;
  return vision.walls.filter((wall) => {
    if (wall.source !== undefined || !findObject(state, { wallId: wall.id })) return false;
    const others = vision.enabled
      ? vision.walls
          .filter((other) => other.id !== wall.id && (other.kind !== "door" || other.open !== true) && !other.bars)
          .flatMap(segmentsOf)
      : [];
    return [0, 0.25, 0.5, 0.75, 1].some((t) => {
      const point = { x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t };
      return inTemplate(placed, widthPx, point) && clearLine(origin, faceToward(point, origin), others);
    });
  });
}

/** A placed area that harms objects deals its full damage to each object under it, once whatever areas overlap it. */
export function harmObjectsInArea(ctx: ResolveContext): void {
  const { input } = ctx;
  if (!input.placedArea || input.commit === false) return;
  const spell = spellOf(ctx);
  if (spell?.effect?.harmsObjects !== true && ctx.action.targets?.objects !== true) return;
  const widthFeet = ctx.action.area?.widthFeet ?? spell?.area?.widthFeet ?? null;
  const areas = [input.placedArea, ...(input.morePlacedAreas ?? [])];
  const struck = new Set<string>();
  for (const placed of areas)
    for (const wall of objectsUnder(ctx.state, placed, widthFeet))
      if (!struck.has(wall.id)) {
        struck.add(wall.id);
        strike(ctx, wall.id, false);
      }
}
