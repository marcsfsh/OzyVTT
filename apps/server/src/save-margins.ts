import type { GameState, PendingSave } from "@vtt/domain";
import type { FailureMargin } from "@vtt/schemas";
import { conditionLabel } from "./condition-rules.js";
import {
  addEffect,
  effectDurationOf,
  makeEffect,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";

/**
 * A save failed by a printed margin or more ("Failure by 5 or More": a homunculus's Bite, a pseudodragon's Sting). The
 * band's conditions and duration stand in for the failure's, and what it adds while the failure lasts (Unconscious
 * while Poisoned) is an effect of its own that ends with the failure's and may end sooner: on damage, or when another
 * creature takes an action to wake it.
 */

type OnFail = NonNullable<PendingSave["onFailEffect"]>;

/** The failure's effect carries this while a margin's companion rides it, which ends with it. */
export const WHILE_FAILED_TAG = "while-failed";

/** The band this save falls in: one it failed by the band's margin or more. */
export function marginBandOf(
  pending: Pick<PendingSave, "failureByMargin" | "dc">,
  total: number
): FailureMargin | null {
  const band = pending.failureByMargin;
  return band && pending.dc - total >= band.by ? band : null;
}

/** The failure's effect as the band leaves it: its conditions and duration in place of the failure's, carrying the tag
 *  its companion ends with. */
export function withMarginBand(onFail: OnFail, band: FailureMargin): OnFail {
  return {
    ...onFail,
    ...(band.conditions ? { linkedConditionIds: [...band.conditions] } : {}),
    ...(band.duration ? { duration: { ...band.duration } } : {}),
    tags: band.whileFailed ? [...new Set([...onFail.tags, WHILE_FAILED_TAG])].slice(0, 8) : [...onFail.tags]
  };
}

/** What the band adds while the failure lasts, as its own effect on the target. */
export function applyMarginCompanion(
  state: GameState,
  targetId: string,
  onFail: OnFail,
  band: FailureMargin,
  id: string,
  immunities?: ConditionImmunitySource
): EffectNarration[] {
  const companion = band.whileFailed;
  if (!companion) return [];
  const events: EffectNarration[] = [];
  addEffect(
    state,
    targetId,
    makeEffect({
      id,
      name: `${companion.conditions.map(conditionLabel).join(" and ")} by ${onFail.sourceName ?? "its source"}`.slice(
        0,
        120
      ),
      sourceActorId: onFail.sourceActorId,
      sourceName: onFail.sourceName,
      // Its own action key, so it stands beside the failure's effect and doesn't replace it.
      sourceActionId: onFail.sourceActionId ? `${onFail.sourceActionId}:while`.slice(0, 120) : null,
      startedRound: state.combat.round,
      // As long as the failure's own, and over with it if that ends first.
      duration: effectDurationOf(state, band.duration ?? onFail.duration, targetId, onFail.sourceActorId),
      endsWithTag: WHILE_FAILED_TAG,
      linkedConditionIds: [...companion.conditions],
      ...(companion.endsOnDamage ? { endsOnDamage: true } : {}),
      ...(companion.endedBy ? { endedBy: structuredClone(companion.endedBy) } : {})
    }),
    events,
    immunities
  );
  return events;
}
