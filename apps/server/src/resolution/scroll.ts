import { scrollCheckOf, scrollLostLine, scrollOfAction, scrollReading } from "../scrolls.js";
import { rollCheck } from "./builtins.js";
import type { ResolveContext } from "./context.js";

/** SRD Spell Scroll: a spell above the levels the reader can cast is cast only after a check, and a failure loses
 *  the spell and the scroll with nothing else happening. Rolled once, when the cast is committed. True when lost. */
export function readScroll(ctx: ResolveContext): boolean {
  const { action, attacker, deps, input } = ctx;
  if (input.commit === false || input.economyPaid === true) return false;
  const scroll = scrollOfAction(action, attacker.inventory, deps.catalog);
  if (!scroll) return false;
  const reading = scrollReading(deps.definition, scroll.spell, deps.catalog);
  if (!reading.readable || reading.check === null) return false;
  const check = scrollCheckOf(reading.check, scroll.spell.name);
  if (rollCheck(ctx, check.subject, reading.check.dc, check.label)) return false;
  ctx.tableNarration.push({
    kind: "effect",
    text: scrollLostLine(attacker.name, scroll.spell.name),
    actorIds: [attacker.id]
  });
  return true;
}
