import type { GameState } from "@vtt/domain";
import type { Senses } from "./vision/senses.js";

/**
 * The Border Ethereal (SRD 5.2.1 Etherealness, Blink, a ghost's Etherealness, a phase spider's Ethereal Jaunt, a
 * nightmare's Ethereal Stride): it overlaps the map, so a creature there keeps its token. An effect tagged `ethereal`
 * puts it there. "You can affect and be affected only by creatures, objects, and effects on that plane. Creatures that
 * aren't on the Ethereal Plane can't perceive or interact with you unless a feature gives them the ability to do so."
 * Truesight and See Invisibility see into it; a ghost is seen from the Material Plane while there
 * (`seen-across-planes`). It moves through the material world's creatures and walls, and when the effect ends it is
 * back where its token stands (`off-plane.ts` shunts it from a filled space).
 */

type Actor = GameState["actors"][number];

export const ETHEREAL_TAG = "ethereal";
/** On an ethereal effect: the creature is seen from the Material Plane while on the Border Ethereal (a ghost). */
export const SEEN_ACROSS_PLANES_TAG = "seen-across-planes";
/** On an ethereal effect: returning into a filled space shunts it and deals 2 Force damage a foot (the spell's text). */
export const ETHEREAL_SHUNT_TAG = "ethereal-shunt";
/** An effect tagged so takes its creature off the map entirely (`off-plane.ts`). */
const OFF_PLANE = "off-plane";

/** Where a creature is: on the fight's plane, on the Border Ethereal over it, or off the map elsewhere. */
export type Plane = "material" | "ethereal" | "away";

const tagged = (actor: Pick<Actor, "effects">, tag: string) =>
  actor.effects.some((effect) => effect.tags.includes(tag));

export const isEthereal = (actor: Pick<Actor, "effects">): boolean => tagged(actor, ETHEREAL_TAG);

export function planeOf(actor: Pick<Actor, "effects">): Plane {
  if (tagged(actor, OFF_PLANE)) return "away";
  return isEthereal(actor) ? "ethereal" : "material";
}

/** Whether two creatures are on different planes, so neither can affect the other. */
export const onOtherPlanes = (a: Pick<Actor, "effects">, b: Pick<Actor, "effects">): boolean =>
  planeOf(a) !== planeOf(b);

/** Whether a creature on the Border Ethereal is seen from the plane it overlaps (a ghost's Etherealness). */
export const seenAcrossPlanes = (actor: Pick<Actor, "effects">): boolean => tagged(actor, SEEN_ACROSS_PLANES_TAG);

/** Whether `viewer` needs a sense that sees into the Ethereal Plane to perceive `target`: the target is there, the
 *  viewer isn't, and nothing shows it across. */
export const needsEtherealSight = (viewer: Pick<Actor, "effects">, target: Pick<Actor, "effects">): boolean =>
  isEthereal(target) && !isEthereal(viewer) && !seenAcrossPlanes(target);

/** Truesight ("see into the Ethereal Plane") or See Invisibility ("you can see into the Ethereal Plane") within
 *  range. `feet` null means the distance is unknown, which no sense reaches. */
export function seesIntoEthereal(senses: Pick<Senses, "truesight" | "seeInvisibility">, feet: number | null): boolean {
  if (feet === null) return false;
  const within = (range: number) => range > 0 && feet <= range + 0.5;
  return within(senses.truesight) || within(senses.seeInvisibility);
}
