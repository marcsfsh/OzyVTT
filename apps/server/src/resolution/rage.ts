import { endEffect, RAGE_ROUNDS, RAGING_TAG, turnEndDuration } from "../effects.js";
import type { ResolveContext } from "./context.js";

/** SRD Persistent Rage: "When you roll Initiative, you can regain all expended uses of Rage", its once per Long
 *  Rest spent by the action itself. */
function regainRageUses(ctx: ResolveContext): void {
  const { attacker, action, siblings, warnings } = ctx;
  if (action.id !== "persistent-rage") return;
  const key = siblings.find((sibling) => sibling.id === "rage")?.uses?.pool ?? "rage";
  if (attacker.actionUses[key] === undefined) return;
  const { [key]: _spent, ...rest } = attacker.actionUses;
  attacker.actionUses = rest;
  warnings.push(`${attacker.name} regains every expended use of Rage.`);
}

/**
 * SRD Rage: it lasts until the end of the Barbarian's next turn, and each attack roll against another creature or
 * saving throw forced on one extends it to the end of the next turn again (so does taking a Bonus Action to extend
 * it, which is Rage itself re-declared: see `checkLimitedUse`), for up to 10 minutes. It ends early in Heavy armor.
 */
export function applyRageRules(ctx: ResolveContext): void {
  const { state, attacker, targets, action, derivation, warnings } = ctx;
  regainRageUses(ctx);
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
  if (!(attacked || forcedSave) || rage.duration.type !== "until-source-turn-end") return;
  if (state.combat.round - rage.startedRound >= RAGE_ROUNDS - 1) {
    warnings.push(`${attacker.name}'s Rage has lasted 10 minutes, so it isn't extended.`);
    return;
  }
  attacker.effects = attacker.effects.map((effect) =>
    effect.id === rage.id
      ? { ...effect, duration: turnEndDuration(state, "until-source-turn-end", attacker.id) }
      : effect
  );
}
