import { rollDice } from "@vtt/rules-5e";
import { healActor } from "../hit-points.js";
import { recordRoll, type ResolveContext } from "./context.js";

/** Healing (Cure Wounds): rolled once, and every target regains it on the resolve. A willing creature's healing has
 *  nothing to gate, so it applies here instead of waiting on an Apply tap as damage does. */
export function applyHealing(ctx: ResolveContext): void {
  const { action, state, targets, deps, tableNarration } = ctx;
  if (!action.healing || targets.length === 0) return;
  const rolled = rollDice(action.healing.formula, deps.random);
  recordRoll(ctx, rolled, "healing");
  const healed = targets.map((target) => {
    const before = target.hp.current;
    // The cast is already authorized; the caster heals whoever it targeted.
    const events = healActor(state, target.id, rolled.total, { role: "gm" });
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
