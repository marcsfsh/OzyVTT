import { castCheckFailedLine, castCheckLabel, castCheckSubject } from "../cast-check.js";
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

/** An item's cast that asks a check first (an Amulet of the Planes' DC 15 Intelligence (Arcana)): a failure spends
 *  the use and the spell isn't cast. Rolled once, when the cast is committed. True when it fails. */
export function failsCastCheck(ctx: ResolveContext): boolean {
  const { action, attacker, input } = ctx;
  const check = action.castCheck;
  if (!check || input.commit === false || input.economyPaid === true) return false;
  if (rollCheck(ctx, castCheckSubject(check), check.dc, castCheckLabel(check, action.name)) !== false) return false;
  ctx.tableNarration.push({
    kind: "effect",
    text: castCheckFailedLine(attacker.name, action.name),
    actorIds: [attacker.id]
  });
  return true;
}
