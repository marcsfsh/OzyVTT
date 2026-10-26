import type { AnnotationPoint, AnnotationShapeKind, GameState, SpellZone } from "@vtt/domain";
import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { footprintCellCenters, footprintInTemplate } from "./area-targeting.js";
import type { EffectNarration } from "./effects.js";
import { gridToImage, imageToGrid } from "./grid-calibration.js";
import { BURNING_TAG } from "./hazards.js";
import { applyDamageDetailed } from "./hit-points.js";
import { endSpellZone } from "./spell-endings.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { insideTest, liveZones, zoneAction, type ZoneDeps } from "./spell-zones.js";
import { lightZone } from "./zone-kindling.js";

/**
 * Webs burning (SRD 5.2.1 Web: "The webs are flammable. Any 5-foot Cube of webs exposed to fire burns away in 1 round,
 * dealing 2d4 Fire damage to any creature that starts its turn in the fire"). Fire reaches the webs where Fire damage
 * lands on a creature standing in them, where a fire's area covers them (a Fireball, a Wall of Fire), and where a
 * burning creature starts its turn in them. Each cell it reaches burns until the same point of the next round, then is
 * gone from the area; out of a fight it burns away at once. With nothing left, the spell ends.
 */

type Deps = Pick<ZoneDeps, "geometry" | "resolveDefinition" | "catalog" | "rollDie" | "newId" | "now">;
type Cell = Readonly<{ column: number; row: number }>;

const keyOf = (cell: Cell) => `${cell.column},${cell.row}`;
const cellOf = (center: Readonly<{ column: number; row: number }>): Cell => ({
  column: Math.floor(center.column),
  row: Math.floor(center.row)
});

/** The cells of a flammable area still standing, as grid cells, within a box round its placed template. */
function areaCells(state: GameState, zone: SpellZone, deps: Deps): Cell[] {
  const calibration = deps.geometry?.calibration;
  const content = zoneContentOf(zone, deps.catalog);
  const area = state.combat.annotations.find((annotation) => annotation.id === zone.annotationId);
  const inside = content ? insideTest(state, zone, content.trigger, content, deps.geometry) : null;
  if (!calibration || !area || !inside) return [];
  const origin = imageToGrid(calibration, area.geometry.origin);
  const target = imageToGrid(calibration, area.geometry.target);
  const reach = Math.ceil(Math.hypot(target.column - origin.column, target.row - origin.row)) + 1;
  const cells: Cell[] = [];
  for (let column = Math.floor(origin.column) - reach; column <= Math.floor(origin.column) + reach; column++)
    for (let row = Math.floor(origin.row) - reach; row <= Math.floor(origin.row) + reach; row++)
      if (inside(gridToImage(calibration, { column: column + 0.5, row: row + 0.5 }), 1)) cells.push({ column, row });
  return cells;
}

/** Sets these cells of a flammable area burning; out of a fight they burn away at once. Spilled oil lights whole. */
function ignite(state: GameState, zone: SpellZone, cells: readonly Cell[], deps: Deps): boolean {
  if (zoneContentOf(zone, deps.catalog)?.trigger.kindled) {
    if (cells.length === 0 || zone.litUntil) return false;
    lightZone(state, zone, deps.catalog);
    return true;
  }
  const burning = new Set((zone.burning ?? []).flatMap((entry) => entry.cells));
  const fresh = cells.map(keyOf).filter((key) => !burning.has(key) && !(zone.cut ?? []).includes(key));
  if (fresh.length === 0) return false;
  if (!state.combat.active) {
    zone.cut = [...(zone.cut ?? []), ...fresh].slice(-4000);
    return true;
  }
  zone.burning = [
    ...(zone.burning ?? []),
    { cells: fresh.slice(0, 400), untilRound: state.combat.round + 1, actorId: state.combat.turnActorId }
  ].slice(-50);
  return true;
}

/** Ends a flammable area with nothing left standing, with its spell. */
function burnedOut(state: GameState, zone: SpellZone, deps: Deps): EffectNarration[] {
  if (!zone.cut?.length || (zone.burning?.length ?? 0) > 0 || areaCells(state, zone, deps).length > 0) return [];
  return [{ kind: "effect", text: `${zone.name} burns away.`, actorId: zone.casterId }, ...endSpellZone(state, zone)];
}

/** Sets burning the cells of each flammable area that a fire's template covers (a Fireball, Burning Hands). */
export function igniteUnder(
  state: GameState,
  placed: Readonly<{
    origin: AnnotationPoint;
    target: AnnotationPoint;
    shape: AnnotationShapeKind;
    widthFeet: number | null;
  }>,
  deps: Deps
): EffectNarration[] {
  const calibration = deps.geometry?.calibration;
  if (!calibration) return [];
  const events: EffectNarration[] = [];
  for (const zone of liveZones(state)) {
    if (!zone.flammable) continue;
    const reached = areaCells(state, zone, deps).filter((cell) =>
      footprintInTemplate(
        calibration,
        placed,
        placed.shape,
        placed.widthFeet,
        gridToImage(calibration, { column: cell.column + 0.5, row: cell.row + 0.5 }),
        1
      )
    );
    if (ignite(state, zone, reached, deps))
      events.push({ kind: "effect", text: `Fire catches ${zone.name}, and it burns.`, actorId: zone.casterId });
    events.push(...burnedOut(state, zone, deps));
  }
  return events;
}

/**
 * Settles where fire has reached the flammable areas since the last command: under a creature Fire damage landed on,
 * and under a standing area that deals Fire damage (a Wall of Fire, Incendiary Cloud, Flaming Sphere).
 */
export function settleFire(state: GameState, deps: Deps): EffectNarration[] {
  const calibration = deps.geometry?.calibration;
  const events: EffectNarration[] = [];
  if (!calibration) return events;
  const fires = liveZones(state).flatMap((zone) => {
    const content = zoneContentOf(zone, deps.catalog);
    const action = content ? zoneAction(zone, content) : undefined;
    // Spilled oil is no fire until it is lit.
    const burns =
      action?.damage.some((part) => part.type === "fire") === true && !(content?.trigger.kindled && !zone.litUntil);
    const inside = burns && content ? insideTest(state, zone, content.trigger, content, deps.geometry) : null;
    return inside ? [inside] : [];
  });
  for (const zone of liveZones(state)) {
    if (!zone.flammable) continue;
    const cells = areaCells(state, zone, deps);
    const under = new Set(
      (zone.fireAt ?? []).flatMap((spot) =>
        footprintCellCenters(calibration, spot, spot.sizeCells).map((center) => keyOf(cellOf(center)))
      )
    );
    delete zone.fireAt;
    const reached = cells.filter(
      (cell) =>
        under.has(keyOf(cell)) ||
        fires.some((inside) => inside(gridToImage(calibration, { column: cell.column + 0.5, row: cell.row + 0.5 }), 1))
    );
    if (ignite(state, zone, reached, deps))
      events.push({ kind: "effect", text: `Fire catches ${zone.name}, and it burns.`, actorId: zone.casterId });
    events.push(...burnedOut(state, zone, deps));
  }
  return events;
}

/**
 * As a creature's turn starts: cells that have burned a full round are gone, a creature starting its turn in the fire
 * takes its damage, and a burning creature in the webs sets them alight.
 */
export function fireAtTurnStart(state: GameState, actorId: string, deps: Deps): EffectNarration[] {
  const calibration = deps.geometry?.calibration;
  const events: EffectNarration[] = [];
  if (!calibration || !state.combat.active) return events;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  const creature = state.actors.find((candidate) => candidate.id === actorId);
  for (const zone of liveZones(state)) {
    if (!zone.flammable) continue;
    const content = zoneContentOf(zone, deps.catalog);
    // A burning creature standing in spilled oil lights it.
    if (
      content?.trigger.kindled &&
      !zone.litUntil &&
      creature?.effects.some((effect) => effect.tags.includes(BURNING_TAG))
    ) {
      const feet = token ? footprintCellCenters(calibration, token.position!, token.sizeCells).map(cellOf) : [];
      const standing = new Set(areaCells(state, zone, deps).map(keyOf));
      if (
        ignite(
          state,
          zone,
          feet.filter((cell) => standing.has(keyOf(cell))),
          deps
        )
      )
        events.push({ kind: "effect", text: `${creature.name}'s fire catches ${zone.name}.`, actorId: creature.id });
    }
    if (!content?.trigger.burns) continue;
    // A round on from when it caught: from the turn of the creature whose turn it was then, or any later in the order.
    const round = state.combat.round;
    const order = state.combat.initiative.map((entry) => entry.actorId);
    const done = (zone.burning ?? []).filter(
      (entry) =>
        round > entry.untilRound ||
        (round === entry.untilRound &&
          (entry.actorId === null ||
            entry.actorId === actorId ||
            order.indexOf(actorId) >= Math.max(0, order.indexOf(entry.actorId))))
    );
    if (done.length > 0) {
      zone.cut = [...(zone.cut ?? []), ...done.flatMap((entry) => entry.cells)].slice(-4000);
      zone.burning = (zone.burning ?? []).filter((entry) => !done.includes(entry));
    }
    const feet =
      token && creature ? footprintCellCenters(calibration, token.position!, token.sizeCells).map(cellOf) : [];
    const burning = new Set((zone.burning ?? []).flatMap((entry) => entry.cells));
    if (creature && feet.some((cell) => burning.has(keyOf(cell)))) {
      const amount = Math.max(0, resolveDice(parseDiceFormula(content.trigger.burns.formula), deps.rollDie).total);
      const { application, events: landed } = applyDamageDetailed(
        state,
        creature.id,
        { amount, parts: [{ amount, type: "fire" }], sourceName: `${zone.name} burning`, sourceActorId: zone.casterId },
        { role: "gm" },
        {
          resolveDefinition: deps.resolveDefinition,
          ...(deps.catalog ? { catalog: deps.catalog } : {}),
          newId: deps.newId,
          now: deps.now
        }
      );
      events.push(
        {
          kind: "damage",
          text: `${creature.name} starts its turn in burning ${zone.name} and takes ${application.totalApplied} Fire damage.`,
          actorId: creature.id
        },
        ...landed
      );
    }
    // A creature on fire sets the webs it stands in alight.
    if (creature?.effects.some((effect) => effect.tags.includes(BURNING_TAG))) {
      const standing = new Set(areaCells(state, zone, deps).map(keyOf));
      if (
        ignite(
          state,
          zone,
          feet.filter((cell) => standing.has(keyOf(cell))),
          deps
        )
      )
        events.push({ kind: "effect", text: `${creature.name}'s fire catches ${zone.name}.`, actorId: creature.id });
    }
    events.push(...burnedOut(state, zone, deps));
  }
  return events;
}
