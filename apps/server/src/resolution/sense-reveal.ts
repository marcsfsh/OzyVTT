import { laterRowOf } from "../item-actions.js";
import { spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * A spell's later action that looks at what its sense finds (Detect Magic: "you can take the Magic action to see a faint
 * aura around any visible creature or object in the area that bears the magic, and if an effect was created by a
 * spell, you learn the spell's school of magic"): the caster's effect of that spell shows it from now on, to the
 * caster's player alone (`vision/detect.ts`).
 */
export function revealSense(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  if (!spell || ctx.input.commit === false || laterRowOf(spell, ctx.action.id)?.reveals !== true) return;
  const { attacker } = ctx;
  attacker.effects = attacker.effects.map((effect) =>
    effect.spell?.id === spell.id && effect.detects
      ? { ...effect, detects: { ...effect.detects, revealed: true } }
      : effect
  );
  ctx.tableNarration.push(
    tableLineOf(ctx, { kind: "effect", text: `${attacker.name} looks for the auras of magic.`, actorId: attacker.id })
  );
}
