import { SLOWED_TAG } from "../effects.js";
import type { ResolveContext } from "./context.js";

/** SRD Slow: "If it casts a spell with a Somatic component, there is a 25 percent chance the spell fails." Rolled
 *  once, when the cast is committed, as a d4 that fails on a 1; the slot and the action are spent all the same. True
 *  when the spell fails. */
export function slowedSpellFails(ctx: ResolveContext): boolean {
  const { action, attacker, deps, input } = ctx;
  if (input.commit === false || input.economyPaid === true || action.spellId === undefined) return false;
  const slowed = attacker.effects.find((effect) => effect.tags.includes(SLOWED_TAG));
  if (!slowed) return false;
  const spell = deps.catalog?.spellRecord?.(action.spellId);
  if (spell?.components.somatic !== true) return false;
  if (deps.random(4) !== 1) return false;
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name}'s ${spell.name} fails, its gestures made too slowly under ${slowed.name}.`,
    actorIds: [attacker.id]
  });
  return true;
}
