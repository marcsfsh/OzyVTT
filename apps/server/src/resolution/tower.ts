import type { GameState, VisionWall } from "@vtt/domain";
import { catalogIdOf } from "@vtt/schemas";
import { derivedUuid } from "../vision/cast-sight.js";
import { deriveEquipment, sourceItemOf } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { objectFrom } from "../objects.js";
import type { Point } from "../vision/geometry.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Instant Fortress: "cause it to grow rapidly into a square adamantine tower", "Each creature in the area where
 * the tower appears is pushed to an unoccupied space outside but next to the tower", "When created, the tower has a
 * single door at ground level on the side facing you. The door opens only at your command ... It is immune to the Knock
 * spell", "The roof, the door, and the walls each have AC 20; HP 100", and "Repeating the command word causes the tower
 * to revert to statuette form, which works only if the tower is empty." The tower stands on the square its use places:
 * four walls that are objects, with a 5-foot door in the middle of the side nearest its user, held shut against all but
 * the user, who shrinks it again while no creature stands inside.
 */

/** The door is a 5-foot stretch of its side. */
const DOOR_FEET = 5;

type Placed = NonNullable<ResolveContext["input"]["placedArea"]>;

/** The towers standing on the map that this creature raised with this item, by their walls. */
function towerWalls(state: GameState, ownerId: string, itemId: string): VisionWall[] {
  return state.combat.vision.walls.filter(
    (wall) => wall.raisedBy?.ownerId === ownerId && wall.raisedBy.itemId === itemId
  );
}

/** The catalog id of the item the action is on, as its user carries it. */
function itemIdOf(ctx: ResolveContext): string {
  const rowId = sourceItemOf(
    ctx.action,
    deriveEquipment(ctx.attacker, ctx.deps.definition, ctx.deps.catalog),
    ctx.attacker.inventory
  );
  const row = rowId ? ctx.attacker.inventory.find((candidate) => candidate.id === rowId) : undefined;
  return row ? catalogIdOf(row) : ctx.action.id;
}

/** The square's corners, in order round it. */
function cornersOf(placed: Placed): Point[] {
  const left = Math.min(placed.origin.x, placed.target.x);
  const right = Math.max(placed.origin.x, placed.target.x);
  const top = Math.min(placed.origin.y, placed.target.y);
  const bottom = Math.max(placed.origin.y, placed.target.y);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];
}

/** Whether a point lies inside the square the walls enclose. */
function inside(walls: readonly VisionWall[], point: Point): boolean {
  const xs = walls.flatMap((wall) => [wall.a.x, wall.b.x]);
  const ys = walls.flatMap((wall) => [wall.a.y, wall.b.y]);
  return (
    point.x > Math.min(...xs) && point.x < Math.max(...xs) && point.y > Math.min(...ys) && point.y < Math.max(...ys)
  );
}

/** Checked before anything is spent: a tower needs its square placed and none of the user's already standing, and one
 *  shrinks only when it stands and is empty. */
export function checkTower(ctx: ResolveContext): void {
  const { action, state, attacker, input } = ctx;
  if (action.raisesTower) {
    if (!input.placedArea || input.placedArea.shape !== "square" || !state.combat.vision.measure?.pixelsPerFoot)
      throw new CommandRejectedError(`Place ${action.name}'s square on a measured map.`);
    if (towerWalls(state, attacker.id, itemIdOf(ctx)).length > 0)
      throw new CommandRejectedError(`${attacker.name}'s tower already stands. Shrink it first.`);
  }
  if (action.dismissesTower) {
    const walls = towerWalls(state, attacker.id, itemIdOf(ctx));
    if (walls.length === 0) throw new CommandRejectedError(`${attacker.name} has no tower standing.`);
    const within = state.combat.tokens.find((token) => token.position && inside(walls, token.position));
    if (within) throw new CommandRejectedError("The tower shrinks only when it is empty.");
  }
}

/** Raises the tower, or shrinks it back to its statuette. */
export function applyTower(ctx: ResolveContext): void {
  const { action, state, attacker, input } = ctx;
  if (input.commit === false) return;
  const told = (text: string) =>
    ctx.tableNarration.push(tableLineOf(ctx, { kind: "effect", text, actorId: attacker.id }));
  const itemId = itemIdOf(ctx);
  if (action.dismissesTower) {
    const gone = new Set(towerWalls(state, attacker.id, itemId).map((wall) => wall.id));
    state.combat = {
      ...state.combat,
      vision: { ...state.combat.vision, walls: state.combat.vision.walls.filter((wall) => !gone.has(wall.id)) }
    };
    told(`${attacker.name}'s tower shrinks back to a statuette.`);
    return;
  }
  const tower = action.raisesTower;
  const placed = input.placedArea;
  const pixelsPerFoot = state.combat.vision.measure?.pixelsPerFoot;
  if (!tower || !placed || !pixelsPerFoot) return;
  const corners = cornersOf(placed);
  const sides = corners.map((corner, index) => [corner, corners[(index + 1) % 4]!] as const);
  const userAt = state.combat.tokens.find((token) => token.actorId === attacker.id)?.position ?? corners[0]!;
  const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const apart = (side: readonly [Point, Point]) =>
    Math.hypot(middle(...side).x - userAt.x, middle(...side).y - userAt.y);
  const facing = sides.reduce((best, side, index) => (apart(side) < apart(sides[best]!) ? index : best), 0);
  const raisedBy = { ownerId: attacker.id, itemId, towerId: input.commandId };
  const object = objectFrom(tower.panel);
  const walls: VisionWall[] = [];
  for (const [index, [a, b]] of sides.entries()) {
    const id = (part: string) => derivedUuid(input.commandId, `tower-${index}-${part}`);
    if (index !== facing) {
      walls.push({ id: id("wall"), kind: "wall", a, b, object, raisedBy });
      continue;
    }
    // The door in the middle of the side facing its user, with wall either side.
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const half = Math.min(length / 2, (DOOR_FEET * pixelsPerFoot) / 2);
    const at = (along: number) => ({
      x: a.x + ((b.x - a.x) * along) / length,
      y: a.y + ((b.y - a.y) * along) / length
    });
    const doorA = at(length / 2 - half);
    const doorB = at(length / 2 + half);
    walls.push(
      { id: id("left"), kind: "wall", a, b: doorA, object, raisedBy },
      {
        id: id("door"),
        kind: "door",
        a: doorA,
        b: doorB,
        open: false,
        object: { ...object, name: "Door" },
        door: { fastenings: [{ kind: "command", ownerId: attacker.id }] },
        raisedBy
      },
      { id: id("right"), kind: "wall", a: doorB, b, object, raisedBy }
    );
  }
  state.combat = {
    ...state.combat,
    vision: {
      ...state.combat.vision,
      walls: [...state.combat.vision.walls.filter((wall) => !walls.some((made) => made.id === wall.id)), ...walls]
    }
  };
  told(`${attacker.name}'s statuette grows into an adamantine tower.`);
  pushOut(ctx, corners, pixelsPerFoot, told);
}

/** Each creature in the square goes to the nearest free square just outside it. */
function pushOut(ctx: ResolveContext, corners: readonly Point[], pixelsPerFoot: number, told: (text: string) => void) {
  const { state } = ctx;
  const cell = 5 * pixelsPerFoot;
  const left = corners[0]!.x;
  const top = corners[0]!.y;
  const right = corners[2]!.x;
  const bottom = corners[2]!.y;
  const within = (point: Point) => point.x > left && point.x < right && point.y > top && point.y < bottom;
  const taken = (point: Point, self: string) =>
    state.combat.tokens.some(
      (token) =>
        token.actorId !== self &&
        token.position &&
        Math.abs(token.position.x - point.x) < cell / 2 &&
        Math.abs(token.position.y - point.y) < cell / 2
    );
  // The squares that ring the tower, a square's half in from each edge.
  const ring: Point[] = [];
  for (let x = left - cell / 2; x <= right + cell / 2; x += cell) {
    ring.push({ x, y: top - cell / 2 }, { x, y: bottom + cell / 2 });
  }
  for (let y = top + cell / 2; y <= bottom - cell / 2; y += cell) {
    ring.push({ x: left - cell / 2, y }, { x: right + cell / 2, y });
  }
  for (const token of [...state.combat.tokens]) {
    if (!token.position || !within(token.position)) continue;
    const from = token.position;
    const spot = ring
      .filter((point) => !taken(point, token.actorId))
      .sort((p, q) => Math.hypot(p.x - from.x, p.y - from.y) - Math.hypot(q.x - from.x, q.y - from.y))[0];
    if (!spot) continue;
    state.combat = {
      ...state.combat,
      tokens: state.combat.tokens.map((candidate) =>
        candidate.actorId === token.actorId ? { ...candidate, position: spot } : candidate
      )
    };
    const name = state.actors.find((actor) => actor.id === token.actorId)?.name ?? "A creature";
    told(`${name} is pushed out of the tower's way.`);
  }
}
