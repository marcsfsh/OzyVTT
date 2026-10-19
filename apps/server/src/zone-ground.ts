import type { GameState } from "@vtt/domain";
import { areEnemies } from "./creature-sides.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { insideTest, liveZones, movesFreelyOn, speedHalvingAt, type ZoneDeps } from "./spell-zones.js";
import type { MovementCostOptions } from "./terrain.js";
import { barredStepFor } from "./zone-barriers.js";

type Point = Readonly<{ x: number; y: number }>;
type Inside = (position: Point, sizeCells: number) => boolean;

/**
 * What the standing spell areas do to the ground under one mover (SRD 5.2.1: Web's webs, Entangle's plants and Ice
 * Storm's hailstones are Difficult Terrain; Plant Growth's overgrowth and Wall of Thorns cost 4 feet of movement for
 * every foot), with Spirit Guardians' halved Speed, as the tests the movement cost reads: where a cell is Difficult
 * Terrain for it, and where a step costs double again. A creature that crosses the ground's kind freely (Web Walker in
 * webs, Ice Walk on ice) and one the area spares (an ally on Conjure Minor Elementals' ground) pays nothing extra. The
 * barriers that bar it a step come too (`zone-barriers.ts`).
 */
export function zoneMovementOptions(
  state: GameState,
  actorId: string,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): Pick<MovementCostOptions, "difficultAt" | "halvedAt" | "costlyGroundAt" | "barredStep"> {
  const mover = state.actors.find((actor) => actor.id === actorId);
  if (!mover) return {};
  const difficult: Inside[] = [];
  const doubled: Inside[] = [];
  const halving = speedHalvingAt(state, actorId, deps);
  for (const zone of liveZones(state)) {
    const content = zoneContentOf(zone, deps.catalog);
    const terrain = content?.trigger.terrain;
    if (!content || !terrain) continue;
    const caster = state.actors.find((actor) => actor.id === zone.casterId);
    if (terrain.for === "enemies" && (!caster || !areEnemies(caster, mover, deps.resolveDefinition))) continue;
    if (terrain.kind && movesFreelyOn(mover, terrain.kind, deps)) continue;
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    if (!inside) continue;
    difficult.push(inside);
    // 4 feet for every foot: Difficult Terrain's 2, doubled.
    if (terrain.cost === 4) doubled.push(inside);
  }
  const barredStep = barredStepFor(state, actorId, deps);
  return {
    ...(barredStep ? { barredStep } : {}),
    ...(difficult.length > 0 ? { difficultAt: (point: Point) => difficult.some((inside) => inside(point, 1)) } : {}),
    ...(halving ? { halvedAt: halving } : {}),
    ...(doubled.length > 0
      ? { costlyGroundAt: (point: Point, sizeCells: number) => doubled.some((inside) => inside(point, sizeCells)) }
      : {})
  };
}
