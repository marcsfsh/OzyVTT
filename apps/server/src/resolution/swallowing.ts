import { swallowOutright } from "../swallow.js";
import { tableLineOf, type ResolveContext } from "./context.js";
import { forceMove } from "./hit-rider-outcomes.js";

/** An action that swallows its target with no save ("The toad swallows a Medium or smaller target it is grappling"):
 *  the target is swallowed as the action resolves (`swallow.ts`). A save's swallow lands with its failure instead. */
export function swallowOnAction(ctx: ResolveContext): void {
  const { state, action, attacker, targets, input } = ctx;
  if (!action.swallow?.conditions || action.save || input.commit === false) return;
  for (const target of targets)
    for (const event of swallowOutright(state, attacker, action, target, `${input.commandId}:${target.id}:swallow`))
      ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** An action that reels its targets in ("The roper pulls each creature Grappled by it up to 30 feet straight toward
 *  it"): each is pulled toward the user, stopping beside it, as forced movement. */
export function pullOnAction(ctx: ResolveContext): void {
  const { action, targets, input } = ctx;
  if (!action.pull || input.commit === false) return;
  for (const target of targets) forceMove(ctx, target, action.name, action.pull, true);
}
