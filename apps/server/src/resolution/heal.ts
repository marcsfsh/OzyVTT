import { isDead } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { setCondition } from "../actor-conditions.js";
import { conditionLabel } from "../condition-rules.js";
import { CommandRejectedError } from "../game-store.js";
import { endEffect } from "../effects.js";
import { deadCantHealLine, healActor } from "../hit-points.js";
import { useCostOf } from "../use-cost.js";
import { recordRoll, tableLineOf, type LiveActor, type ResolveContext } from "./context.js";

/** Healing (Cure Wounds): rolled once, and every target regains it on the resolve. A willing creature's healing has
 *  nothing to gate, so it applies here instead of waiting on an Apply tap as damage does. Second Wind heals its user;
 *  Preserve Life divides one roll among its targets, none past half its maximum; Lay on Hands regains its formula once
 *  per point spent. */
export function applyHealing(ctx: ResolveContext): void {
  const { action, state, deps, tableNarration } = ctx;
  const healing = action.healing;
  const targets = healing?.self ? [ctx.attacker] : ctx.targets;
  if (!healing || targets.length === 0) return;
  // SRD "Dead": a heal that reaches only the dead would do nothing, so it is refused before its points or slot
  // are spent.
  if (targets.every((target) => isDead(target)))
    throw new CommandRejectedError(targets.map((target) => deadCantHealLine(target.name)).join(" "));
  let total = 0;
  for (let use = 0; use < (healing.perUse ? useCostOf(action) : 1); use += 1) {
    const rolled = rollDice(healing.formula, deps.random);
    // A flat amount ("1" a point) is no roll for the dice log.
    if (rolled.terms.some((term) => term.kind === "dice")) recordRoll(ctx, rolled, "healing");
    total += rolled.total;
  }
  const shares = healingShares(targets, Math.max(0, total), healing);
  const healed = targets.map((target, index) => {
    // A dead target among living ones regains nothing until it is revived; the others still heal.
    if (isDead(target)) {
      tableNarration.push({ kind: "heal", text: deadCantHealLine(target.name), actorIds: [target.id] });
      return { targetId: target.id, targetName: target.name, regained: 0 };
    }
    const before = target.hp.current;
    // The cast is already authorized; the caster heals whoever it targeted.
    const events = healActor(state, target.id, shares[index], { role: "gm" });
    const regained = target.hp.current - before;
    tableNarration.push({
      kind: "heal",
      text: `${target.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${action.name}).`,
      actorIds: [target.id]
    });
    for (const event of events) tableNarration.push(tableLineOf(ctx, event, "heal"));
    // "The wound closes ... after a spell restores Hit Points to the target."
    if (action.spellId !== undefined && regained > 0)
      for (const effect of target.effects.filter((candidate) => candidate.endsOnSpellHealing))
        for (const event of endEffect(state, target.id, effect.id))
          tableNarration.push(tableLineOf(ctx, event, "heal"));
    return { targetId: target.id, targetName: target.name, regained };
  });
  ctx.healing = { total, targets: healed };
}

/** What each target may regain: the whole roll each, or one pool split as evenly as each target's room allows. A cap
 *  ("no more than half its Hit Point maximum") limits both. */
export function healingShares(
  targets: readonly Pick<LiveActor, "hp">[],
  total: number,
  healing: NonNullable<ResolveContext["action"]["healing"]>
): number[] {
  const room = targets.map((target) =>
    healing.upToFractionOfMaximum === undefined
      ? total
      : Math.max(0, Math.floor(target.hp.maximum * healing.upToFractionOfMaximum) - Math.max(0, target.hp.current))
  );
  if (!healing.divided) return room.map((space) => Math.min(space, total));
  const shares = targets.map(() => 0);
  let left = total;
  // Even shares, handing what a full target can't take to the others.
  for (let open = room.filter((space) => space > 0).length; left > 0 && open > 0;) {
    const each = Math.max(1, Math.floor(left / open));
    open = 0;
    for (let index = 0; index < targets.length && left > 0; index += 1) {
      const take = Math.min(each, room[index] - shares[index], left);
      shares[index] += take;
      left -= take;
      if (room[index] - shares[index] > 0) open += 1;
    }
  }
  return shares;
}

/** Conditions an action ends on its targets (Lay on Hands: Poisoned). Spent on a target with none of them, it is
 *  refused before anything is paid. */
export function applyConditionCures(ctx: ResolveContext): void {
  const { action, state, tableNarration } = ctx;
  const cures = action.endsConditions;
  if (!cures) return;
  for (const target of ctx.targets) {
    const present = cures.filter((id) => target.conditions.some((condition) => condition.id === id));
    if (present.length === 0)
      throw new CommandRejectedError(
        `${target.name} isn't ${cures.map((id) => conditionLabel(id)).join(" or ")} - ${action.name} would do nothing.`
      );
    for (const id of present) {
      // The action is already authorized; it ends the condition whoever imposed it.
      setCondition(state, target.id, id, false, undefined, { role: "gm" });
      tableNarration.push({
        kind: "effect",
        text: `${target.name} is no longer ${conditionLabel(id)} (${action.name}).`,
        actorIds: [target.id]
      });
    }
  }
}
