import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import {
  addEffect,
  effectDurationOf,
  endConcentrationSustainedBy,
  makeEffect,
  type EffectNarration
} from "../effects.js";
import { sizeAtMost, tableLineOf, type ResolveContext } from "./context.js";

/** What an action does to each of its targets with no roll (`ActionSchema.inflicts`): a tarrasque's shock wave ends
 *  Concentration and knocks the Medium or smaller creatures Prone. Its user is never its own target. */
export function inflictOnTargets(ctx: ResolveContext): void {
  const { state, action, attacker, targets, input, deps } = ctx;
  const inflicts = action.inflicts;
  if (!inflicts || input.commit === false) return;
  const immunities = {
    ...(deps.resolveDefinition ? { resolveDefinition: deps.resolveDefinition } : {}),
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  };
  for (const target of targets.filter((candidate) => candidate.id !== attacker.id)) {
    const events: EffectNarration[] = [];
    if (inflicts.breaksConcentration) events.push(...endConcentrationSustainedBy(state, target.id));
    const conditions = inflicts.conditions ?? [];
    const reached = inflicts.maxTargetSize === undefined || sizeAtMost(target.size, inflicts.maxTargetSize);
    if (conditions.length > 0 && reached) {
      if (inflicts.duration)
        addEffect(
          state,
          target.id,
          makeEffect({
            id: `${input.commandId}:${target.id}:inflicted`,
            name: `${conditionLabel(conditions[0]!)} by ${attacker.name} (${action.name})`.slice(0, 120),
            sourceActorId: attacker.id,
            sourceName: attacker.name,
            sourceActionId: action.id,
            startedRound: state.combat.round,
            duration: effectDurationOf(state, inflicts.duration, target.id, attacker.id),
            linkedConditionIds: [...conditions]
          }),
          events,
          immunities
        );
      else
        for (const conditionId of conditions)
          events.push(...setCondition(state, target.id, conditionId, true, undefined, { role: "gm" }, immunities));
    }
    for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
  }
}
