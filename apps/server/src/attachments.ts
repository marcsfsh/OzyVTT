import type { GameState } from "@vtt/domain";
import type { RuleId } from "./rules-families.js";

/**
 * What a creature attached to another can't do while it holds on (SRD 5.2.1 stirge, cloaker, darkmantle), read from
 * the tags on the effect its hit left: "While attached, the stirge can't make Proboscis attacks" (`SOURCE_NO_REPEAT_TAG`),
 * "the cloaker can't make Attach attacks against other targets" (`SOURCE_TARGET_ONLY_TAG`), and "the darkmantle can
 * attack only the target but has Advantage on its attack rolls" (`SOURCE_ATTACKS_ONLY_BEARER_TAG`).
 */

export const SOURCE_NO_REPEAT_TAG = "source-no-repeat";
export const SOURCE_TARGET_ONLY_TAG = "source-target-only";
export const SOURCE_ATTACKS_ONLY_BEARER_TAG = "source-attacks-only-bearer";
/** "Its Speed becomes 0 ... and it moves with the target" (a darkmantle): the bearer carries the effect's source. */
export const CARRIES_SOURCE_TAG = "carries-source";
/** "The stirge can detach itself by spending 5 feet of its movement": the source's own way off. */
export const DETACHES_ITSELF_TAG = "detaches-itself";
/** What spending movement to detach costs, as each printing says. */
export const DETACH_FEET = 5;

type Actor = GameState["actors"][number];
type Violation = Readonly<{ rule: RuleId; message: string }>;

/** The effects this creature's hits left that hold it to their bearers, each with its bearer. */
function holds(state: GameState, attackerId: string) {
  return state.actors.flatMap((bearer) =>
    bearer.effects
      .filter((effect) => effect.sourceActorId === attackerId)
      .map((effect) => ({ bearer, effect, from: effect.sourceActionId?.split(":")[0] ?? null }))
  );
}

/** Why the attached creature can't take this action at these targets; empty when it can. */
export function attachmentViolations(
  state: GameState,
  attacker: Pick<Actor, "id" | "name">,
  action: Readonly<{ id: string; name: string; attack?: unknown }>,
  targetIds: readonly string[]
): Violation[] {
  const violations: Violation[] = [];
  for (const { bearer, effect, from } of holds(state, attacker.id)) {
    const elsewhere = targetIds.some((targetId) => targetId !== bearer.id);
    if (effect.tags.includes(SOURCE_NO_REPEAT_TAG) && from === action.id)
      violations.push({
        rule: "target.not-allowed",
        message: `${attacker.name} can't use ${action.name} while it is attached to ${bearer.name}.`
      });
    if (effect.tags.includes(SOURCE_TARGET_ONLY_TAG) && from === action.id && elsewhere)
      violations.push({
        rule: "target.not-allowed",
        message: `${attacker.name} can use ${action.name} only on ${bearer.name} while it is attached to it.`
      });
    if (effect.tags.includes(SOURCE_ATTACKS_ONLY_BEARER_TAG) && action.attack !== undefined && elsewhere)
      violations.push({
        rule: "target.not-allowed",
        message: `${attacker.name} can attack only ${bearer.name} while it is attached to it.`
      });
  }
  return violations;
}

/** Whether the attacker is attached to this target with Advantage on its attacks against it (a darkmantle). */
export function attachedAdvantage(state: GameState, attackerId: string, targetId: string): boolean {
  return holds(state, attackerId).some(
    ({ bearer, effect }) => bearer.id === targetId && effect.tags.includes(SOURCE_ATTACKS_ONLY_BEARER_TAG)
  );
}

/** The creatures attached to `bearerId` that move with it (a darkmantle on its target). */
export function carriedSourcesOf(state: GameState, bearerId: string): string[] {
  const bearer = state.actors.find((actor) => actor.id === bearerId);
  return [
    ...new Set(
      (bearer?.effects ?? [])
        .filter((effect) => effect.tags.includes(CARRIES_SOURCE_TAG) && effect.sourceActorId)
        .map((effect) => effect.sourceActorId!)
    )
  ];
}

/** The creature a darkmantle rides, when it is attached so that it moves only with it. */
export function riddenBearerOf(state: GameState, sourceId: string): Actor | undefined {
  return state.actors.find((bearer) =>
    bearer.effects.some((effect) => effect.sourceActorId === sourceId && effect.tags.includes(CARRIES_SOURCE_TAG))
  );
}

/** The attachments this creature can end by spending its own movement, each with its bearer. */
export function selfDetachments(state: GameState, sourceId: string) {
  return holds(state, sourceId).filter(({ effect }) => effect.tags.includes(DETACHES_ITSELF_TAG));
}
