import type { ActorMovementReply, GameState, SpellZone } from "@vtt/domain";
import { footprintCenter, footprintOrigin } from "@vtt/rules-5e";
import { gridToImage, imageToGrid } from "./grid-calibration.js";
import { zoneHeld, type ZoneDeps } from "./spell-zones.js";
import { zoneGround } from "./zone-ground.js";

type AreaGround = NonNullable<ActorMovementReply["areaGround"]>;
type Cell = AreaGround["difficult"][number];

/** How far round the mover the preview reads the ground, in cells: farther than a Dash at 60 feet. */
const REACH_CELLS = 30;

/**
 * The ground the spell areas change for one mover, in grid cells near it, for the client's move preview: the same tests
 * the server charges a move with (`zone-ground.ts`), read at each cell. Only the areas `seen` passes are read, so an
 * area hidden from the asker stays hidden until a move meets it. Undefined when no area changes this mover's ground.
 */
export function areaGroundFor(
  state: GameState,
  actorId: string,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">,
  seen: (zone: SpellZone) => boolean
): AreaGround | undefined {
  const calibration = deps.geometry?.calibration;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
  if (!calibration || !token?.position) return undefined;
  const zones = state.combat.spellZones.filter((zone) => !zone.bursting && zoneHeld(state, zone) && seen(zone));
  if (zones.length === 0) return undefined;
  const ground = zoneGround(state, actorId, deps, zones);
  if (
    !ground ||
    (ground.difficult.length === 0 && ground.doubled.length === 0 && ground.toward.length === 0 && !ground.halving)
  )
    return undefined;
  const sizeCells = token.sizeCells;
  const at = footprintOrigin(imageToGrid(calibration, token.position), sizeCells);
  const difficult: Cell[] = [];
  const halved: Cell[] = [];
  const costlyGround: Cell[] = [];
  const toward = ground.toward.map((entry) => ({ caster: entry.caster, inside: entry.inside, cells: [] as Cell[] }));
  for (let column = at.column - REACH_CELLS; column <= at.column + REACH_CELLS; column++)
    for (let row = at.row - REACH_CELLS; row <= at.row + REACH_CELLS; row++) {
      const cell = { column, row };
      const center = gridToImage(calibration, { column: column + 0.5, row: row + 0.5 });
      if (ground.difficult.some((inside) => inside(center, 1))) difficult.push(cell);
      // A footprint's own tests, read at its centre with its size, as the server reads them.
      const footprint = gridToImage(calibration, footprintCenter(cell, sizeCells));
      if (ground.halving?.(footprint, sizeCells) === true) halved.push(cell);
      if (ground.doubled.some((inside) => inside(footprint, sizeCells))) costlyGround.push(cell);
      for (const entry of toward) if (entry.inside(footprint, sizeCells)) entry.cells.push(cell);
    }
  return {
    difficult,
    halved,
    costlyGround,
    toward: toward.filter((entry) => entry.cells.length > 0).map(({ caster, cells }) => ({ caster, cells }))
  };
}
