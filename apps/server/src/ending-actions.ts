import type { GameState } from "@vtt/domain";
import { endingsOf, type EndedBy } from "@vtt/schemas";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";

/**
 * Effects a creature ends by taking an action (SRD 5.2.1 text): waking a sleeper ("a creature within 5 feet of it takes
 * an action to wake it"), stanching an infernal wound, studying a phantasm, pulling a creature out of a gelatinous cube
 * or a water elemental, detaching a stirge, freeing a creature from a Net or a Hunting Trap, bursting a Chain, picking
 * Manacles' lock, or collecting itself to repeat the save (Irresistible Dance). The generic End an Effect action takes
 * one of them, and the bearer's own ways out are offered by name (`builtin-actions.ts`); `resolution/builtins.ts`
 * resolves them.
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** The id of the generic action that ends an effect by the means its text prints. */
export const END_EFFECT_ACTION_ID = "end-an-effect";

/** The prefix of the actions that offer a bearer each of its own ways out by name ("ended-by-burst-the-chain"). */
export const ENDED_BY_PREFIX = "ended-by-";

/** Why End an Effect can't be taken: nothing it names. */
export const NO_ENDING_OPTION = "No effect on you or a creature beside you ends by an action now.";

/** How near the creature taking the action must be, in feet, to the bearer or the effect's source, unless the text
 *  says how far (a flesh golem's creator calms it from 60 feet). */
const WITHIN_FEET = 5;

/** One way `taker` can end an effect by its action: by repeating the effect's save (`repeat`), or by one of its printed
 *  means (`ended-by`, with that means). */
export type EndingOption = Readonly<
  | { bearer: Actor; effect: Effect; kind: "repeat" }
  | { bearer: Actor; effect: Effect; kind: "ended-by"; ending: EndedBy }
>;

/** A printed means as an option id ("Burst the Chain" is "burst-the-chain"). */
export const endingSlug = (ending: Pick<EndedBy, "name">): string =>
  ending.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "end";

/**
 * The ways `taker` may end the effects on `bearer` with its action now. Where the map can measure, a creature other
 * than the bearer must be within 5 feet of the bearer, or of the effect's source when the text says so (a cube, a
 * whelm).
 */
export function endingOptions(
  taker: Actor,
  bearer: Actor,
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null
): EndingOption[] {
  const self = taker.id === bearer.id;
  const near = (otherId: string | null, feet: number) => {
    if (otherId === null) return false;
    const apart = distanceFeet?.(taker.id, otherId) ?? null;
    return apart === null || apart <= feet + DISTANCE_TOLERANCE_FEET;
  };
  return bearer.effects.flatMap((effect): EndingOption[] => {
    if (self && effect.repeatSave?.byAction) return [{ bearer, effect, kind: "repeat" }];
    return endingsOf(effect).flatMap((ending): EndingOption[] => {
      const allowed = self ? ending.by !== "others" : ending.by !== "bearer";
      if (!allowed) return [];
      if (!self && !near(ending.near === "source" ? effect.sourceActorId : bearer.id, ending.withinFeet ?? WITHIN_FEET))
        return [];
      return [{ bearer, effect, kind: "ended-by", ending }];
    });
  });
}

/** Whether `taker` has any effect to end, on itself or on another creature, whatever the distance (the turn list's
 *  answer before a target is picked). With targets, only those count. */
export function hasEndingOption(state: GameState, taker: Actor, targetIds: readonly string[] = []): boolean {
  const bearers = targetIds.length > 0 ? state.actors.filter((actor) => targetIds.includes(actor.id)) : state.actors;
  return bearers.some((bearer) => endingOptions(taker, bearer).length > 0);
}

/** The tag on the mark a failed try leaves on its taker when the means locks it out (Iron Bands: "any further attempts
 *  made by that creature automatically fail until 24 hours have elapsed"). */
export const ENDING_LOCKOUT_TAG = "ending-lockout";

/** The id of that mark, for one effect on one bearer. */
export const lockoutMarkId = (bearerId: string, effectId: string): string =>
  `${ENDING_LOCKOUT_TAG}:${bearerId}:${effectId}`.slice(0, 120);
