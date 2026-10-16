import { endEffect, RAGING_TAG, turnEndDuration } from "../effects.js";
import type { ResolveContext } from "./context.js";

/**
 * SRD Rage: it lasts until the end of the Barbarian's next turn, and each attack roll against another creature or
 * saving throw forced on one extends it to the end of the next turn again (so does taking a Bonus Action to extend
 * it, which is Rage itself re-declared: see `checkLimitedUse`). It ends early in Heavy armor.
 */
export function applyRageRules(ctx: ResolveContext): void {
  const { state, attacker, targets, action, derivation, warnings } = ctx;
  const rage = attacker.effects.find((effect) => effect.tags.includes(RAGING_TAG));
  if (!rage) return;
  if (derivation.context.armorWeight === "heavy") {
    for (const effect of attacker.effects.filter((candidate) => candidate.tags.includes(RAGING_TAG)))
      endEffect(state, attacker.id, effect.id);
    warnings.push(`${attacker.name} is wearing Heavy armor, so its Rage ends.`);
    return;
  }
  const others = targets.some((target) => target.id !== attacker.id);
  const attacked = ctx.attack !== null && others;
  const forcedSave = (action.save !== undefined || ctx.builtinSave !== null) && others;
  if ((attacked || forcedSave) && rage.duration.type === "until-source-turn-end")
    attacker.effects = attacker.effects.map((effect) =>
      effect.id === rage.id
        ? { ...effect, duration: turnEndDuration(state, "until-source-turn-end", attacker.id) }
        : effect
    );
}
