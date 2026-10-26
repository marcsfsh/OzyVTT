import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { breakOpenDc, burstOpen, dissolveGlue, fixRod, glueDoor, isHiddenDoor } from "../doors.js";
import { deriveEquipment, sourceItemOf } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { liveZones } from "../spell-zones.js";
import { zoneContentOf } from "../spell-zone-state.js";
import { nearestPointOf } from "../spell-walls.js";
import { distance, nearestOnSegment, type Point } from "../vision/geometry.js";
import { segmentOf } from "../vision/sight.js";
import { recordRoll, tableLineOf, type ResolveContext } from "./context.js";
import { checkWallReach } from "./object-targets.js";

/**
 * What magic items do to the doors on the map (SRD 5.2.1): an Immovable Rod fixed against a door holds it shut until its
 * button is pushed or a DC 30 Strength (Athletics) check moves it; Sovereign Glue glues one shut, which only Universal
 * Solvent undoes; a Ring of the Ram's Strength check, +5 for each charge, breaks one open; and a Wand of Secrets points
 * at the nearest secret door or hidden trap. The door is the one the action is aimed at (`wallId`), within its reach.
 */

/** The door the action works on, checked before anything is spent. */
export function checkDoorWork(ctx: ResolveContext): void {
  const work = ctx.action.doorWork;
  if (!work) return;
  const { state, input } = ctx;
  const wall = input.wallId ? state.combat.vision.walls.find((candidate) => candidate.id === input.wallId) : undefined;
  if (!wall || wall.kind !== "door" || (isHiddenDoor(wall) && ctx.deps.initiatorRole === "player"))
    throw new CommandRejectedError("Choose a door on the map.");
  checkWallReach(ctx, wall);
  if (work.does === "force") breakOpenDc(state, wall.id, ctx.attacker.id);
  if ((work.does === "fix-rod" || work.does === "glue") && wall.open === true)
    throw new CommandRejectedError("Close the door first.");
}

/** Does the action's work on its door. */
export function applyDoorWork(ctx: ResolveContext): void {
  const work = ctx.action.doorWork;
  const wallId = ctx.input.wallId;
  if (!work || !wallId || ctx.input.commit === false) return;
  const { state, attacker, deps } = ctx;
  const told = (text: string) =>
    ctx.tableNarration.push(tableLineOf(ctx, { kind: "effect", text, actorId: attacker.id }));
  switch (work.does) {
    case "fix-rod": {
      const rowId = sourceItemOf(
        ctx.action,
        deriveEquipment(attacker, deps.definition, deps.catalog),
        attacker.inventory
      );
      if (!rowId) throw new CommandRejectedError(`${attacker.name} isn't carrying the rod.`);
      fixRod(state, wallId, attacker, rowId);
      told(`${attacker.name} fixes an Immovable Rod against the door, holding it shut.`);
      return;
    }
    case "glue":
      glueDoor(state, wallId);
      told(`${attacker.name} glues the door shut with Sovereign Glue; it sets in a minute.`);
      return;
    case "dissolve":
      told(
        dissolveGlue(state, wallId)
          ? `${attacker.name}'s Universal Solvent dissolves the glue on the door.`
          : `${attacker.name} pours Universal Solvent on the door, but no glue holds it.`
      );
      return;
    case "force": {
      const dc = breakOpenDc(state, wallId, attacker.id);
      const bonus = work.bonus ?? 0;
      const thrown = resolveDice(parseDiceFormula(bonus > 0 ? `1d20 + ${bonus}` : "1d20"), deps.random);
      recordRoll(ctx, thrown, "check", `${ctx.action.name}: Strength check`);
      if (thrown.total < dc) {
        told(`${ctx.action.name} strikes the door (${thrown.total}), and it holds.`);
        return;
      }
      burstOpen(state, wallId);
      told(`${ctx.action.name} breaks the door open (${thrown.total}).`);
    }
  }
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"] as const;

/** The way from one point to another on the map, as a compass point (north up). */
function wayTo(from: Point, to: Point): string {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const index = Math.round(angle / (Math.PI / 4));
  return COMPASS[(index + 8) % 8]!;
}

/** SRD Wand of Secrets: "if a secret door or trap is within 60 feet of you, the wand pulses and points at the one nearest
 *  to you". Secret doors on the map and hidden areas (traps, glyphs) count; the table hears which way it points. */
export function findSecrets(ctx: ResolveContext): void {
  const finds = ctx.action.findsSecrets;
  if (!finds || ctx.input.commit === false) return;
  const { state, attacker, deps } = ctx;
  const at = state.combat.tokens.find((token) => token.actorId === attacker.id)?.position;
  const pixelsPerFoot = state.combat.vision.measure?.pixelsPerFoot;
  const told = (text: string, gmOnly = false) =>
    ctx.tableNarration.push(
      tableLineOf(ctx, { kind: "effect", text, actorId: attacker.id, ...(gmOnly ? { gmOnly: true as const } : {}) })
    );
  if (!at || !pixelsPerFoot) {
    told(`${ctx.action.name}: the map can't measure the way, so the GM says where the wand points.`);
    return;
  }
  const doors = state.combat.vision.walls.filter(isHiddenDoor).map((wall) => ({
    name: "a secret door",
    point: nearestPointOf(state, wall, attacker.id) ?? nearestOnSegment(at, segmentOf(wall))
  }));
  const traps = liveZones(state).flatMap((zone) => {
    if (zoneContentOf(zone, deps.catalog)?.trigger.hidden !== true) return [];
    const area = state.combat.annotations.find((annotation) => annotation.id === zone.annotationId);
    return area ? [{ name: zone.name, point: area.geometry.origin }] : [];
  });
  const nearest = [...doors, ...traps]
    .map((found) => ({ ...found, feet: distance(at, found.point) / pixelsPerFoot }))
    .filter((found) => found.feet <= finds.feet + 2.5)
    .sort((a, b) => a.feet - b.feet)[0];
  if (!nearest) {
    told(`${ctx.action.name}: the wand stays still.`);
    return;
  }
  told(`${ctx.action.name}: the wand pulses and points ${wayTo(at, nearest.point)}.`);
  told(`The wand points at ${nearest.name}, ${Math.round(nearest.feet)} feet away.`, true);
}
