import type { SpellZone as ZoneTrigger } from "@vtt/content-srd-5.2.1";
import type { Actor, GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { bestCover, type CoverDegree } from "./cover.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { insideTest, liveZones, type ZoneDeps } from "./spell-zones.js";

/**
 * The spell walls that stand between two creatures without blocking the way outright (SRD 5.2.1): Blade Barrier
 * "provides Three-Quarters Cover", and Wind Wall deflects "arrows, bolts, and other ordinary projectiles launched at
 * targets behind the wall", which "miss automatically". A wall is between them when the line from one's centre to
 * the other's crosses its area outside both their spaces.
 */

type Point = Readonly<{ x: number; y: number }>;
type Deps = Pick<ZoneDeps, "geometry" | "catalog">;

/** The standing zones whose areas lie on the line between the two creatures, with what each does there. */
function zonesBetween(
  state: GameState,
  fromId: string,
  toId: string,
  deps: Deps,
  wanted: (trigger: ZoneTrigger) => boolean
): Array<Readonly<{ name: string; trigger: ZoneTrigger }>> {
  const calibration = deps.geometry?.calibration;
  if (!calibration) return [];
  const spaceOf = (actorId: string) => {
    const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
    return token ? { at: token.position!, half: (calibration.cellSizePx * token.sizeCells) / 2 } : null;
  };
  const from = spaceOf(fromId);
  const to = spaceOf(toId);
  if (!from || !to) return [];
  const within = (point: Point, space: NonNullable<typeof from>) =>
    Math.abs(point.x - space.at.x) < space.half && Math.abs(point.y - space.at.y) < space.half;
  const length = Math.hypot(to.at.x - from.at.x, to.at.y - from.at.y);
  const steps = Math.max(1, Math.ceil(length / (calibration.cellSizePx / 4)));
  const points: Point[] = [];
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const point = { x: from.at.x + (to.at.x - from.at.x) * t, y: from.at.y + (to.at.y - from.at.y) * t };
    if (!within(point, from) && !within(point, to)) points.push(point);
  }
  if (points.length === 0) return [];
  return liveZones(state).flatMap((zone) => {
    const content = zoneContentOf(zone, deps.catalog);
    if (!content || !wanted(content.trigger) || content.trigger.around !== undefined) return [];
    const inside = insideTest(state, zone, content.trigger, content, deps.geometry);
    return inside && points.some((point) => inside(point, 1)) ? [{ name: zone.name, trigger: content.trigger }] : [];
  });
}

/** The cover the spell walls between them give the target from the attacker (Blade Barrier), or null. */
export function zoneCover(state: GameState, fromId: string, targetId: string, deps: Deps): CoverDegree | null {
  const walls = zonesBetween(state, fromId, targetId, deps, (trigger) => trigger.cover !== undefined);
  return bestCover(...walls.map((wall) => wall.trigger.cover));
}

/** The weapons whose shots and throws are ordinary projectiles, by the names stat blocks give them; a giant's Rock and
 *  a catapult's boulder are not among them. */
const PROJECTILE_NAMES =
  /\b(?:bow|longbow|shortbow|crossbow|sling|darts?|javelins?|blowgun|spears?|daggers?|handaxes?|arrows?|bolts?|needles?|tridents?|light hammer)\b/i;

/** Whether an attack launches an ordinary projectile: a ranged weapon attack that isn't a spell's, made with a weapon
 *  that shoots or is thrown, or a stat block's shot named for such a weapon. */
export function launchesProjectile(
  action: Pick<ActorAction, "attack" | "spellId" | "name">,
  attacker: Pick<Actor, "inventory">,
  weaponRowId: string | null
): boolean {
  if (action.attack?.rangeFeet === undefined || action.spellId !== undefined) return false;
  const row = weaponRowId === null ? undefined : attacker.inventory.find((candidate) => candidate.id === weaponRowId);
  // A character's weapon says by its properties; a stat block's shot names what it fires.
  const properties = row?.weapon?.properties;
  if (row?.weapon) return properties?.some((property) => property === "ammunition" || property === "thrown") === true;
  return PROJECTILE_NAMES.test(action.name);
}

/** The wall that deflects an ordinary projectile launched from one creature at the other (Wind Wall), or null. */
export function deflectingWall(state: GameState, fromId: string, targetId: string, deps: Deps): string | null {
  return zonesBetween(state, fromId, targetId, deps, (trigger) => trigger.deflects === true)[0]?.name ?? null;
}
