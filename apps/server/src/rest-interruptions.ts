import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { storedDefinition } from "./actor-roster.js";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { interruptLongRest, type RestApplier } from "./long-rest.js";
import { applyRest } from "./rests.js";

/**
 * SRD 5.2.1 Interrupting the Rest: rolling Initiative, casting a spell other than a cantrip and taking any damage stop a
 * Short Rest, and "an interrupted Short Rest confers no benefits"; they stop a Long Rest too, which gives a Short Rest's
 * benefits to a creature that rested an hour first (`long-rest.ts`). Each rest under way loses whoever one of these
 * happens to, with a line saying why.
 */

export type InterruptDeps = Readonly<{
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** A Short Rest's benefits for an interrupted Long Rest's member, read from its sheet. */
export function restApplier(deps: InterruptDeps = {}): RestApplier {
  return (state, actorId, kind, options) =>
    applyRest(
      state,
      actorId,
      kind,
      (definitionId) => deps.resolveDefinition?.(definitionId) ?? storedDefinition(state, definitionId),
      deps.catalog,
      undefined,
      options.clockMoved,
      options.interrupted
    );
}

/** These creatures rolled Initiative, cast a spell above a cantrip or took damage: the rests they are in stop. */
export function interruptRests(
  state: GameState,
  actorIds: ReadonlySet<string>,
  why: string,
  deps: InterruptDeps = {}
): EffectNarration[] {
  return [...leaveShortRest(state, actorIds, why), ...interruptLongRest(state, actorIds, why, restApplier(deps))];
}

/** A member of the party's Short Rest whom an interruption happens to leaves it, with no benefits; the rest closes when
 *  nobody is left in it. */
function leaveShortRest(state: GameState, actorIds: ReadonlySet<string>, why: string): EffectNarration[] {
  const rest = state.rest.shortRest;
  const leaving = rest?.actorIds.filter((actorId) => actorIds.has(actorId)) ?? [];
  if (!rest || leaving.length === 0) return [];
  const staying = rest.actorIds.filter((actorId) => !actorIds.has(actorId));
  state.rest = {
    ...state.rest,
    shortRest:
      staying.length > 0 ? { actorIds: staying, done: rest.done.filter((actorId) => !actorIds.has(actorId)) } : null
  };
  return leaving.map((actorId) => ({
    kind: "effect" as const,
    text: `${state.actors.find((actor) => actor.id === actorId)?.name ?? "Someone"} ${why}, which ends their Short Rest without its benefits.`,
    actorId
  }));
}
