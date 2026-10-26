import { isDead } from "@vtt/domain";
import { itemActionId } from "../item-actions.js";
import { DISTANCE_TOLERANCE_FEET } from "../movement-narration.js";
import { preventRestoration } from "../timed-revival.js";
import { tableLineOf, type LiveActor, type ResolveContext } from "./context.js";

/**
 * What stops a dead creature's return when it reaches its remains (SRD 5.2.1): "unless Dispel Evil and Good is cast on
 * its remains" (a guardian naga), "or its remains are sprinkled with Holy Water" (a lemure). Dispel Evil and Good reaches
 * the remains its caster touches as it casts the spell or uses it; Holy Water, the remains it is thrown at.
 */
export function stopReturnsAtRemains(ctx: ResolveContext): void {
  const resolveDefinition = ctx.deps.resolveDefinition;
  if (ctx.input.commit === false || !resolveDefinition) return;
  const { action, attacker, state, deps } = ctx;
  const holyWater = action.id.startsWith(itemActionId("holy-water"));
  const dispel = action.spellId === "dispel-evil-and-good";
  if (!holyWater && !dispel) return;
  const reached: LiveActor[] = dispel
    ? state.actors.filter((actor) => {
        if (!isDead(actor) || !actor.death?.returns) return false;
        const apart = deps.distanceFeet?.(attacker.id, actor.id) ?? null;
        return (
          ctx.targets.some((target) => target.id === actor.id) ||
          (apart !== null && apart <= 5 + DISTANCE_TOLERANCE_FEET)
        );
      })
    : [...ctx.targets];
  for (const remains of reached) {
    const line = preventRestoration(remains, holyWater ? "holy-water" : "dispel-evil-and-good", { resolveDefinition });
    if (line) ctx.tableNarration.push(tableLineOf(ctx, line));
  }
}
