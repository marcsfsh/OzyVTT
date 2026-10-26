import type { GameState } from "@vtt/domain";
import { catalogIdOf } from "@vtt/schemas";
import { moveAnnotation, type AnnotationActor } from "./annotations.js";
import type { EffectNarration } from "./effects.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { liveZones, zonesAfterAreaMove, type ZoneDeps } from "./spell-zones.js";
import { areaMiddle } from "./zone-touch.js";

/**
 * A Sphere of Annihilation on the map (SRD 5.2.1): "If you are within 60 feet of a sphere, you can take a Magic action
 * to make a DC 25 Intelligence (Arcana) check. On a successful check, you control the sphere until the start of your
 * next turn ... On a failed check, the sphere moves 10 feet toward you in a straight line. While in control of the
 * sphere, you can take a Bonus Action to cause it to move in one direction of your choice, up to a number of feet equal
 * to 5 times your Intelligence modifier (minimum 5 feet). Any creature whose space the sphere enters must succeed on a
 * DC 19 Dexterity saving throw or be touched by it, taking 8d10 Force damage". A Talisman of the Sphere gives the check
 * Advantage, and its holder that starts its turn in control can take a Magic action to move it 10 feet plus 10 times
 * its Intelligence modifier. The direction a move takes is toward a creature its controller names.
 */

type Actor = GameState["actors"][number];

/** Marks the effect a sphere's controller holds while in control, which brings Move the Sphere forward. */
export const SPHERE_CONTROL_TAG = "sphere-control";

/** Whether the creature holds an attuned Talisman of the Sphere. */
export const holdsTalisman = (creature: Actor): boolean =>
  creature.inventory.some((row) => catalogIdOf(row) === "talisman-of-the-sphere" && row.attuned);

/**
 * Moves an area straight toward a creature, up to `feet`, 5 feet at a time so each creature whose space it enters on
 * the way meets it; it stops on that creature.
 */
export function moveZoneToward(
  state: GameState,
  input: Readonly<{ zoneId: string; towardActorId: string; feet: number; actor: AnnotationActor }>,
  deps: ZoneDeps
): EffectNarration[] {
  const zone = liveZones(state).find((candidate) => candidate.id === input.zoneId);
  const area = zone?.annotationId
    ? state.combat.annotations.find((annotation) => annotation.id === zone.annotationId)
    : undefined;
  const calibration = deps.geometry?.calibration;
  const toward = state.combat.tokens.find((token) => token.actorId === input.towardActorId && token.position !== null);
  const name = state.actors.find((actor) => actor.id === input.towardActorId)?.name ?? "the creature";
  if (!zone || !area || !calibration || !deps.geometry || !toward?.position) return [];
  const stepPx = (5 / calibration.distancePerCell) * calibration.cellSizePx;
  const met: EffectNarration[] = [];
  let moved = 0;
  while (moved + 5 <= input.feet + DISTANCE_TOLERANCE_FEET) {
    const current = state.combat.annotations.find((annotation) => annotation.id === area.id);
    if (!current) break;
    const middle = areaMiddle(current);
    const dx = toward.position.x - middle.x;
    const dy = toward.position.y - middle.y;
    const length = Math.hypot(dx, dy);
    if (length < stepPx / 2) break;
    const step = Math.min(stepPx, length);
    const shift = { x: (dx / length) * step, y: (dy / length) * step };
    const before = { origin: current.geometry.origin, target: current.geometry.target };
    moveAnnotation(
      state,
      area.id,
      { x: before.origin.x + shift.x, y: before.origin.y + shift.y },
      { x: before.target.x + shift.x, y: before.target.y + shift.y },
      input.actor,
      deps.geometry
    );
    moved += 5;
    met.push(...zonesAfterAreaMove(state, area.id, before, deps));
  }
  return [
    { kind: "effect", text: `${zone.name} moves ${moved} feet toward ${name}.`, actorId: input.towardActorId },
    ...met
  ];
}
