import type { GameState, PendingSave } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";
import { creatureDistance, DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import type { ResolveContext } from "./resolution/context.js";
import { createPendingSaves } from "./saving-throws.js";
import { zoneContentOf } from "./spell-zone-state.js";
import { endZoneAndItsSpell, liveZones } from "./spell-zones.js";
import type { TokenMapGeometry } from "./token-placement.js";

/**
 * Touching an area that goes off (SRD 5.2.1 Delayed Blast Fireball: "If a creature touches the bead before the interval
 * has expired, that creature makes a Dexterity saving throw. On a failed save, the spell ends, causing the bead to
 * explode. On a successful save, the creature can throw the bead up to 40 feet. When the thrown bead enters a
 * creature's space or collides with a solid object, the spell ends, and the bead explodes"). The thrower names the
 * creature it throws at as it touches the bead; naming itself sets the bead back down.
 */

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

/** The middle of a placed area: a circle's centre, a square's or a line's midpoint. */
export function areaMiddle(
  area: Readonly<{ shape: string | null; geometry: Readonly<{ origin: Point; target: Point }> }>
): Point {
  const { origin, target } = area.geometry;
  return area.shape === "circle" || area.shape === "cone"
    ? { x: origin.x, y: origin.y }
    : { x: (origin.x + target.x) / 2, y: (origin.y + target.y) / 2 };
}

/** Feet from a creature to the point an area was placed at (a bead, a Sphere of Annihilation), on the map; null when
 *  the map can't say. */
export function zonePointFeet(
  state: GameState,
  actorId: string,
  zoneId: string,
  geometry: TokenMapGeometry
): number | null {
  const calibration = geometry.calibration;
  const zone = state.combat.spellZones.find((candidate) => candidate.id === zoneId);
  const area = zone?.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  if (!calibration || !area || !token?.position) return null;
  return (
    creatureDistance(
      geometry,
      {
        position: token.position,
        sizeCells: token.sizeCells,
        sizePx: token.sizePx,
        altitudeFeet: token.altitudeFeet ?? 0
      },
      { position: areaMiddle(area), sizeCells: 1, sizePx: calibration.cellSizePx }
    )?.value ?? null
  );
}

/** The Touch the Bead action: the toucher's Dexterity save against the bead within 5 feet of it. */
export function touchBead(ctx: ResolveContext): void {
  const { state, attacker, targets, deps } = ctx;
  const within = (zoneId: string) => {
    const feet = deps.zoneFeet?.(attacker.id, zoneId) ?? null;
    return feet === null || feet <= 5 + DISTANCE_TOLERANCE_FEET;
  };
  const bead = liveZones(state).find(
    (zone) => zoneContentOf(zone, deps.catalog)?.trigger.touched !== undefined && within(zone.id)
  );
  const touched = bead ? zoneContentOf(bead, deps.catalog)?.trigger.touched : undefined;
  if (!bead || !touched) throw new CommandRejectedError("There is no bead within 5 feet to touch.");
  if (targets.length !== 1) throw new CommandRejectedError("Choose the creature to throw the bead at, or yourself.");
  const at = targets[0]!;
  if (at.id !== attacker.id) {
    const feet = deps.distanceFeet?.(attacker.id, at.id) ?? null;
    if (feet !== null && feet > touched.throwFeet + DISTANCE_TOLERANCE_FEET)
      throw new CommandRejectedError(`${at.name} is more than ${touched.throwFeet} feet away to throw the bead at.`);
  }
  const caster = state.actors.find((actor) => actor.id === bead.casterId);
  createPendingSaves(state, {
    sourceActorId: bead.casterId,
    sourceName: caster?.name ?? bead.name,
    actionName: `${bead.name}: touching the bead`.slice(0, 120),
    ability: "dex",
    dc: bead.dc,
    targetIds: [attacker.id],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    magical: true,
    extra: { touchedZone: { zoneId: bead.id, ...(at.id !== attacker.id ? { throwAtId: at.id } : {}) } },
    newSaveId: deps.newRollId,
    createdAt: Date.parse(deps.now())
  });
  ctx.builtinSave = { ability: "dex", dc: bead.dc, targets: [{ targetId: attacker.id, targetName: attacker.name }] };
}

/** The toucher's save answered: a failure sets the bead off where it is, and a success throws it at the creature it
 *  named, where it goes off (`burstEndedZones` raises the saves). */
export function settleTouchedZone(
  state: GameState,
  touched: NonNullable<PendingSave["touchedZone"]>,
  toucher: Actor,
  success: boolean
): EffectNarration[] {
  const zone = liveZones(state).find((candidate) => candidate.id === touched.zoneId);
  if (!zone) return [];
  const thrownAt = success ? state.actors.find((actor) => actor.id === touched.throwAtId) : undefined;
  if (success && !thrownAt)
    return [{ kind: "effect", text: `${toucher.name} sets ${zone.name}'s bead back down.`, actorId: toucher.id }];
  const area = zone.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  const landing = thrownAt
    ? state.combat.tokens.find((token) => token.actorId === thrownAt.id && token.position !== null)?.position
    : undefined;
  // The burst centres where the bead lands, its radius as placed.
  if (area && landing) {
    const shift = { x: landing.x - area.geometry.origin.x, y: landing.y - area.geometry.origin.y };
    area.geometry = {
      ...area.geometry,
      origin: { x: landing.x, y: landing.y },
      target: { x: area.geometry.target.x + shift.x, y: area.geometry.target.y + shift.y }
    };
  }
  return [
    {
      kind: "effect",
      text: thrownAt
        ? `${toucher.name} throws ${zone.name}'s bead at ${thrownAt.name}, and it explodes.`
        : `${toucher.name} sets off ${zone.name}'s bead.`,
      actorId: toucher.id
    },
    ...endZoneAndItsSpell(state, zone.id)
  ];
}
