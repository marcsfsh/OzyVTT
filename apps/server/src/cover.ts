import type { Actor, GameState } from "@vtt/domain";
import { clearLine } from "./vision/geometry.js";
import { segmentsOf } from "./vision/sight.js";

/** SRD Cover: half and three-quarters raise AC and Dexterity saves; total can't be targeted directly. */
export type CoverDegree = "half" | "three-quarters" | "total";

/** The effect tag the GM's cover marker carries on a creature. */
export const COVER_TAGS: Readonly<Record<CoverDegree, string>> = {
  half: "cover-half",
  "three-quarters": "cover-three-quarters",
  total: "cover-total"
};

const ORDER: readonly CoverDegree[] = ["total", "three-quarters", "half"];

/**
 * The cover the GM has marked a creature with ("The GM determines whether the target has Cover"): an effect tagged
 * for it, which every attack and Dexterity save against the creature reads, a player's included. The best degree
 * wins. Null when unmarked.
 */
export function standingCover(actor: Pick<Actor, "effects">): CoverDegree | null {
  return ORDER.find((degree) => actor.effects.some((effect) => effect.tags.includes(COVER_TAGS[degree]))) ?? null;
}

/** The cover for one target of a resolve: the GM's choice for this resolve, else the target's standing marker. */
export function coverFor(chosen: CoverDegree | null | undefined, target: Pick<Actor, "effects">): CoverDegree | null {
  return chosen ?? standingCover(target);
}

/** Cover's bonus to AC and Dexterity saves: +2 half, +5 three-quarters. */
export const coverBonusOf = (cover: CoverDegree | null): number =>
  cover === "half" ? 2 : cover === "three-quarters" ? 5 : 0;

/** The better of two degrees of cover. */
export function bestCover(...degrees: ReadonlyArray<CoverDegree | null | undefined>): CoverDegree | null {
  return ORDER.find((degree) => degrees.includes(degree)) ?? null;
}

type Point = Readonly<{ x: number; y: number }>;
type Token = GameState["combat"]["tokens"][number];

/** A token's space: its centre and half its side, in pixels. */
const spaceOf = (token: Token) => ({
  at: token.position!,
  half: Math.max(token.sizePx, (token.gridSizePx ?? 0) * token.sizeCells) / 2
});

/** The four corners of a space, a little inside it so a wall along its edge doesn't count twice. */
function cornersOf(at: Point, half: number): Point[] {
  const inset = half * 0.9;
  return [
    { x: at.x - inset, y: at.y - inset },
    { x: at.x + inset, y: at.y - inset },
    { x: at.x - inset, y: at.y + inset },
    { x: at.x + inset, y: at.y + inset }
  ];
}

/** Whether a segment passes through a square space. */
export function crossesSpace(from: Point, to: Point, at: Point, half: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (const [p, q] of [
    [-dx, from.x - (at.x - half)],
    [dx, at.x + half - from.x],
    [-dy, from.y - (at.y - half)],
    [dy, at.y + half - from.y]
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return t1 > 0.02 && t0 < 0.98;
}

/**
 * SRD Cover from the map, with dynamic vision on (walls only matter then): an obstacle covers the target by how much
 * of it the walls, closed doors and windows hide from where the attack or effect comes from. From the corner of the
 * attacker's space (or the effect's point of origin) that sees the most of it, lines are drawn to the target's four
 * corners: one or two blocked is Half Cover, three Three-Quarters, all four from every corner Total. Another creature
 * in the way, not Tiny, gives Half Cover. Null with vision off, or a token off the map; the GM's marks still count.
 */
export function mapCover(state: GameState, fromActorId: string, targetId: string, origin?: Point): CoverDegree | null {
  const vision = state.combat.vision;
  if (!vision?.enabled) return null;
  const tokens = state.combat.tokens;
  const target = tokens.find((token) => token.actorId === targetId && token.position !== null);
  const source = tokens.find((token) => token.actorId === fromActorId && token.position !== null);
  if (!target || (!source && !origin)) return null;
  // Bars (Forcecage's cage) stop no line: attacks, spells and areas go between them.
  const obstacles = vision.walls
    .filter((wall) => (wall.kind !== "door" || wall.open !== true) && wall.bars !== true)
    .flatMap(segmentsOf);
  const space = spaceOf(target);
  const targetCorners = cornersOf(space.at, space.half);
  const from = origin ? [origin] : cornersOf(spaceOf(source!).at, spaceOf(source!).half);
  let fewest = targetCorners.length;
  for (const point of from) {
    const blocked = targetCorners.filter((corner) => !clearLine(point, corner, obstacles)).length;
    fewest = Math.min(fewest, blocked);
  }
  const walls: CoverDegree | null =
    fewest >= 4 ? "total" : fewest === 3 ? "three-quarters" : fewest >= 1 ? "half" : null;
  // A creature between them covers the target: any of its space on the line from one centre to the other.
  const centre = origin ?? spaceOf(source!).at;
  const between = tokens.some((token) => {
    if (token.position === null || token.actorId === targetId || token.actorId === fromActorId) return false;
    const actor = state.actors.find((candidate) => candidate.id === token.actorId);
    if (!actor || actor.size === "tiny") return false;
    const other = spaceOf(token);
    return crossesSpace(centre, space.at, other.at, other.half * 0.8);
  });
  return bestCover(walls, between ? "half" : null);
}
