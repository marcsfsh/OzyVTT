import { laterRowOf } from "../item-actions.js";
import { stabilizeBySpell } from "../stabilize.js";
import { spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/** SRD Spare the Dying: "Choose a creature within range that has 0 Hit Points and isn't dead. The creature becomes
 *  Stable." Each target that is dying becomes Stable, and the table is told; one that isn't is the GM's note. */
export function stabilizeOnCast(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  if (!spell?.effect?.stabilizes || laterRowOf(spell, ctx.action.id) !== undefined) return;
  for (const target of ctx.targets) {
    if (stabilizeBySpell(target))
      ctx.tableNarration.push(
        tableLineOf(ctx, { kind: "condition", text: `${target.name} is stable.`, actorId: target.id })
      );
    else ctx.warnings.push(`${target.name} isn't dying, so ${spell.name} does nothing to it.`);
  }
}
