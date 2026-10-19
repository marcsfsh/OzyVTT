import type { GameState } from "@vtt/domain";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";

/**
 * Effects a creature ends by taking an action (SRD 5.2.1 text): waking a sleeper ("a creature within 5 feet of it takes
 * an action to wake it"), stanching an infernal wound, studying a phantasm, pulling a creature out of a gelatinous cube
 * or a water elemental, detaching a stirge, or collecting itself to repeat the save (Irresistible Dance). The generic
 * End an Effect action takes one of them; `resolution/builtins.ts` resolves it.
 */

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** The id of the generic action that ends an effect by the means its text prints. */
export const END_EFFECT_ACTION_ID = "end-an-effect";

/** Why End an Effect can't be taken: nothing it names. */
export const NO_ENDING_OPTION = "No effect on you or a creature beside you ends by an action now.";

/** How near the creature taking the action must be, in feet, to the bearer or the effect's source, unless the text
 *  says how far (a flesh golem's creator calms it from 60 feet). */
const WITHIN_FEET = 5;

/** One effect `taker` can end by its action: by repeating the effect's save (`repeat`), or by its printed means. */
export type EndingOption = Readonly<{ bearer: Actor; effect: Effect; kind: "repeat" | "ended-by" }>;

/**
 * The effects on `bearer` that `taker` may end with its action now. Where the map can measure, a creature other than the
 * bearer must be within 5 feet of the bearer, or of the effect's source when the text says so (a cube, a whelm).
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
    const ended = effect.endedBy;
    if (!ended) return [];
    const allowed = self ? ended.by !== "others" : ended.by !== "bearer";
    if (!allowed) return [];
    if (!self && !near(ended.near === "source" ? effect.sourceActorId : bearer.id, ended.withinFeet ?? WITHIN_FEET))
      return [];
    return [{ bearer, effect, kind: "ended-by" }];
  });
}

/** Whether `taker` has any effect to end, on itself or on another creature, whatever the distance (the turn list's
 *  answer before a target is picked). With targets, only those count. */
export function hasEndingOption(state: GameState, taker: Actor, targetIds: readonly string[] = []): boolean {
  const bearers = targetIds.length > 0 ? state.actors.filter((actor) => targetIds.includes(actor.id)) : state.actors;
  return bearers.some((bearer) => endingOptions(taker, bearer).length > 0);
}
