import type { Actor, GameState, PendingSave } from "@vtt/domain";
import type { SaveFailureDuration } from "@vtt/schemas";
import { applyCondition, endEffect, type ConditionImmunitySource, type EffectNarration } from "./effects.js";

/**
 * Two SRD hazards a failed save can start (`save.failureHazard`). Burning (Rules Glossary): "A burning creature or
 * object takes 1d4 Fire damage at the start of each of its turns. As an action, you can extinguish fire on yourself
 * by giving yourself the Prone condition and rolling on the ground." Oil: "If the target takes Fire damage before the
 * oil dries (after 1 minute), the target takes an extra 5 Fire damage from burning oil."
 */

export const BURNING_TAG = "burning";
export const OILED_TAG = "oiled";
/** The builtin action that puts out the fire on its user (`builtin-actions.ts`). */
export const PUT_OUT_FIRE_ACTION_ID = "extinguish-fire";

type FailureEffect = NonNullable<PendingSave["onFailEffect"]>;

export type HazardEffect = Readonly<{
  name: string;
  tag: string;
  duration?: SaveFailureDuration;
  ongoingDamage?: FailureEffect["ongoingDamage"];
}>;

export const HAZARDS: Readonly<Record<"burning" | "oil", HazardEffect>> = {
  // Until it is put out: the GM ends it when the fire is doused, submerged or suffocated.
  burning: {
    name: "Burning",
    tag: BURNING_TAG,
    ongoingDamage: { damage: [{ formula: "1d4", type: "fire" }], at: "bearer-turn-start" }
  },
  oil: { name: "Covered in oil", tag: OILED_TAG, duration: { type: "rounds", rounds: 10 } }
};

/** A creature burns or not, and a second coat of oil is the same coat: a hazard that lands again replaces the one the
 *  creature already has. Only a hazard on its own, so one riding a condition keeps it. */
export function withoutSameHazard(target: Actor, onFail: FailureEffect): void {
  if (onFail.linkedConditionIds.length > 0) return;
  const tag = onFail.tags.find((candidate) => candidate === BURNING_TAG || candidate === OILED_TAG);
  if (!tag) return;
  target.effects = target.effects.filter(
    (effect) => !(effect.tags.includes(tag) && effect.linkedConditionIds.length === 0)
  );
}

/** The extra 5 Fire damage burning oil adds to Fire damage the oiled creature takes. */
export function oilIgnition<T extends Readonly<{ amount: number; type: string }>>(
  actor: Pick<Actor, "effects">,
  parts: readonly T[]
): Readonly<{ amount: number; type: string }> | null {
  const oiled = actor.effects.some((effect) => effect.tags.includes(OILED_TAG));
  const fire = parts.some((part) => part.amount > 0 && part.type.trim().toLowerCase() === "fire");
  return oiled && fire ? { amount: 5, type: "fire" } : null;
}

/**
 * Rolling on the ground puts out the fire on its bearer: a Burning effect of its own ends, and one riding conditions
 * only stops burning. The bearer drops Prone, which it gave itself. Returns the names of the fires put out.
 */
export function putOutFire(
  state: GameState,
  actor: Actor,
  options: Readonly<{ selfApplied: boolean; immunities?: ConditionImmunitySource }>
): Readonly<{ ended: string[]; events: EffectNarration[] }> {
  const ended: string[] = [];
  const events: EffectNarration[] = [];
  for (const effect of actor.effects.filter((candidate) => candidate.tags.includes(BURNING_TAG))) {
    ended.push(effect.name);
    if (effect.linkedConditionIds.length === 0) {
      events.push(...endEffect(state, actor.id, effect.id));
      continue;
    }
    const { ongoingDamage: _fire, ...rest } = effect;
    actor.effects = actor.effects.map((candidate) =>
      candidate.id === effect.id ? { ...rest, tags: rest.tags.filter((tag) => tag !== BURNING_TAG) } : candidate
    );
  }
  if (applyCondition(actor, "prone", options) === "applied")
    events.push({ kind: "condition", text: `${actor.name} drops Prone and rolls on the ground.`, actorId: actor.id });
  return { ended, events };
}
