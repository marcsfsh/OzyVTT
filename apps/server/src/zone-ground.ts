import type { GameState, SpellZone } from "@vtt/domain";
import { INTERPOSING_TAG } from "./cover.js";
import { areEnemies } from "./creature-sides.js";
import { creatureDistance, DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { traitOf } from "./statblock-traits.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { insideTest, liveZones, movesFreelyOn, speedHalvingAt, type ZoneDeps } from "./spell-zones.js";
import type { MovementCostOptions } from "./terrain.js";
import { barredStepFor } from "./zone-barriers.js";

type Point = Readonly<{ x: number; y: number }>;
type Inside = (position: Point, sizeCells: number) => boolean;

/**
 * What the standing spell areas do to the ground under one mover (SRD 5.2.1: Web's webs, Entangle's plants and Ice
 * Storm's hailstones are Difficult Terrain; Plant Growth's overgrowth and Wall of Thorns cost 4 feet of movement for
 * every foot), with Spirit Guardians' halved Speed and the ground a creature makes Difficult round it (a gibbering
 * mouther's Aberrant Ground), as the tests the movement cost reads: where a cell is Difficult
 * Terrain for it, and where a step costs double again. A creature that crosses the ground's kind freely (Web Walker in
 * webs, Ice Walk on ice) and one the area spares (an ally on Conjure Minor Elementals' ground) pays nothing extra. The
 * barriers that bar it a step come too (`zone-barriers.ts`).
 */
export function zoneMovementOptions(
  state: GameState,
  actorId: string,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">
): Pick<
  MovementCostOptions,
  "difficultAt" | "clearedAt" | "halvedAt" | "costlyGroundAt" | "barredStep" | "costlyStep"
> {
  const ground = zoneGround(state, actorId, deps);
  if (!ground) return {};
  const { difficult, cleared, doubled, toward, halving } = ground;
  const barredStep = barredStepFor(state, actorId, deps);
  const closer = (from: Point, to: Point, caster: Point) =>
    Math.hypot(to.x - caster.x, to.y - caster.y) < Math.hypot(from.x - caster.x, from.y - caster.y) - 0.5;
  return {
    ...(toward.length > 0
      ? {
          costlyStep: (from: Point, to: Point, sizeCells: number) =>
            toward.some(
              ({ inside, caster }) => (inside(from, sizeCells) || inside(to, sizeCells)) && closer(from, to, caster)
            )
        }
      : {}),
    ...(barredStep ? { barredStep } : {}),
    ...(difficult.length > 0 ? { difficultAt: (point: Point) => difficult.some((inside) => inside(point, 1)) } : {}),
    ...(cleared.length > 0 ? { clearedAt: (point: Point) => cleared.some((inside) => inside(point, 1)) } : {}),
    ...(halving ? { halvedAt: halving } : {}),
    ...(doubled.length > 0
      ? { costlyGroundAt: (point: Point, sizeCells: number) => doubled.some((inside) => inside(point, sizeCells)) }
      : {})
  };
}

/** The ground round each creature whose stat block makes it Difficult Terrain (a gibbering mouther's Aberrant Ground),
 *  which moves with it. Its own ground doesn't slow it, and a defeated one's is ordinary again. `bearers` keeps only
 *  the creatures the asker can see. */
function traitGround(
  state: GameState,
  moverId: string,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition">,
  bearers: (actorId: string) => boolean
): Inside[] {
  const geometry = deps.geometry;
  const calibration = geometry?.calibration;
  if (!geometry || !calibration) return [];
  return state.combat.tokens.flatMap((token): Inside[] => {
    const bearer = state.actors.find((actor) => actor.id === token.actorId);
    if (!token.position || !bearer || bearer.id === moverId || bearer.hp.current <= 0 || !bearers(bearer.id)) return [];
    const trait = bearer.definitionId
      ? traitOf(deps.resolveDefinition(bearer.definitionId), "difficult-ground")
      : undefined;
    if (!trait) return [];
    const from = { position: token.position, sizeCells: token.sizeCells, sizePx: token.sizePx };
    return [
      (position, sizeCells) => {
        const apart = creatureDistance(geometry, from, {
          position,
          sizeCells,
          sizePx: calibration.cellSizePx * sizeCells
        });
        return apart !== null && apart.value <= trait.rangeFeet + DISTANCE_TOLERANCE_FEET;
      }
    ];
  });
}

/** The ground the given spell areas make for one mover: Difficult Terrain, ground at 4 feet for every foot, the areas
 *  where a step toward their caster costs double, and where its Speed is halved; with the Difficult Terrain creatures
 *  carry round them. Null for a creature not in the state. */
export function zoneGround(
  state: GameState,
  actorId: string,
  deps: Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog">,
  zones: readonly SpellZone[] = liveZones(state),
  bearers: (actorId: string) => boolean = () => true
): Readonly<{
  difficult: Inside[];
  cleared: Inside[];
  doubled: Inside[];
  toward: Array<Readonly<{ inside: Inside; caster: Point }>>;
  halving: ((position: Point, sizeCells: number) => boolean) | null;
}> | null {
  const mover = state.actors.find((actor) => actor.id === actorId);
  if (!mover) return null;
  const difficult: Inside[] = traitGround(state, actorId, deps, bearers);
  // Where an area lifts the painted Difficult Terrain (Speak with Plants' clearing).
  const cleared: Inside[] = [];
  const doubled: Inside[] = [];
  // Steps that cost double in an area for going toward its caster (Gust of Wind).
  const toward: Array<Readonly<{ inside: Inside; caster: Point }>> = [];
  const halving = speedHalvingAt(state, actorId, deps, zones);
  for (const zone of zones) {
    const content = zoneContentOf(zone, deps.catalog);
    if (content?.trigger.towardCaster && zone.casterId !== actorId) {
      const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
      const caster = state.combat.tokens.find((token) => token.actorId === zone.casterId)?.position;
      if (inside && caster) toward.push({ inside, caster });
    }
    if (content?.trigger.clearsTerrain) {
      const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
      if (inside) cleared.push(inside);
    }
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
  // SRD 5.2.1 Arcane Hand's Interposing Hand: "its space counts as Difficult Terrain for your enemies".
  for (const hand of state.actors) {
    if (!hand.effects.some((effect) => effect.tags.includes(INTERPOSING_TAG))) continue;
    const caster = state.actors.find((actor) => actor.id === hand.summon?.by);
    const token = state.combat.tokens.find((candidate) => candidate.actorId === hand.id)?.position;
    const size = state.combat.tokens.find((candidate) => candidate.actorId === hand.id);
    if (!caster || !token || !size || !areEnemies(caster, mover, deps.resolveDefinition)) continue;
    const half = Math.max(size.sizePx, (size.gridSizePx ?? 0) * size.sizeCells) / 2;
    difficult.push((point) => Math.abs(point.x - token.x) < half && Math.abs(point.y - token.y) < half);
  }
  return { difficult, cleared, doubled, toward, halving };
}
