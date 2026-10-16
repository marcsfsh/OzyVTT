import { rollDice } from "@vtt/rules-5e";
import { healActor } from "../hit-points.js";
import { recordRoll, type LiveActor, type ResolveContext } from "./context.js";

/** Healing (Cure Wounds): rolled once, and every target regains it on the resolve. A willing creature's healing has
 *  nothing to gate, so it applies here instead of waiting on an Apply tap as damage does. Second Wind heals its user;
 *  Preserve Life divides one roll among its targets, none past half its maximum. */
export function applyHealing(ctx: ResolveContext): void {
  const { action, state, deps, tableNarration } = ctx;
  const healing = action.healing;
  const targets = healing?.self ? [ctx.attacker] : ctx.targets;
  if (!healing || targets.length === 0) return;
  const rolled = rollDice(healing.formula, deps.random);
  recordRoll(ctx, rolled, "healing");
  const shares = sharesOf(targets, Math.max(0, rolled.total), healing);
  const healed = targets.map((target, index) => {
    const before = target.hp.current;
    // The cast is already authorized; the caster heals whoever it targeted.
    const events = healActor(state, target.id, shares[index], { role: "gm" });
    const regained = target.hp.current - before;
    tableNarration.push({
      kind: "heal",
      text: `${target.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${action.name}).`,
      actorIds: [target.id]
    });
    for (const event of events) tableNarration.push({ kind: "heal", text: event.text, actorIds: [event.actorId] });
    return { targetId: target.id, targetName: target.name, regained };
  });
  ctx.healing = { total: rolled.total, targets: healed };
}

/** What each target may regain: the whole roll each, or one pool split as evenly as each target's room allows. A cap
 *  ("no more than half its Hit Point maximum") limits both. */
function sharesOf(
  targets: readonly LiveActor[],
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
