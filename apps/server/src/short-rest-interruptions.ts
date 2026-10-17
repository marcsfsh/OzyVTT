import type { GameState } from "@vtt/domain";
import type { EffectNarration } from "./effects.js";

/**
 * SRD Short Rest, Interrupting the Rest: rolling Initiative, casting a spell other than a cantrip and taking any damage
 * stop a Short Rest, and "an interrupted Short Rest confers no benefits". A member of the party's Short Rest whom one
 * of these happens to leaves it, with a line saying why; the rest closes when nobody is left in it.
 */
export function leaveShortRest(state: GameState, actorIds: ReadonlySet<string>, why: string): EffectNarration[] {
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
