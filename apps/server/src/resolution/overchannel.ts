import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { holdsFeature } from "../class-features.js";
import { CommandRejectedError } from "../game-store.js";
import { applyDamageDetailed } from "../hit-points.js";
import { recordRoll, tableLineOf, type ResolveContext } from "./context.js";

/**
 * SRD Overchannel (Evoker 14): "When you cast a Wizard spell with a spell slot of levels 1-5 that deals damage, you can
 * deal maximum damage with that spell on the turn you cast it. The first time you do so, you suffer no adverse effect.
 * If you use this feature again before you finish a Long Rest, you take 2d12 Necrotic damage for each level of the
 * spell slot immediately after you cast it. This damage ignores Resistance and Immunity. Each time you use this feature
 * again before finishing a Long Rest, the Necrotic damage per spell level increases by 1d12."
 * The uses since the last Long Rest are counted on the caster's uses, which a Long Rest clears.
 */
export const OVERCHANNEL_KEY = "overchannel";

/** Refuses Overchannel on anything but a damaging Wizard spell cast with a level 1 to 5 slot by a holder of it. */
export function checkOverchannel(ctx: ResolveContext): void {
  const { input, action, plan, deps } = ctx;
  if (input.overchannel !== true) return;
  if (!holdsFeature(deps.definition, "overchannel", "Overchannel"))
    throw new CommandRejectedError(`${ctx.attacker.name} doesn't have Overchannel.`);
  const spell = action.spellId ? deps.catalog?.spellRecord?.(action.spellId) : undefined;
  if (!spell || !spell.classes.includes("wizard") || action.damage.length === 0)
    throw new CommandRejectedError("Overchannel works on a Wizard spell that deals damage.");
  const slot = plan.spendSpellSlot;
  if (!slot || slot.level < 1 || slot.level > 5)
    throw new CommandRejectedError("Overchannel works on a spell cast with a level 1 to 5 spell slot.");
}

/** Counts the use, and from the second before a Long Rest deals the caster its Necrotic damage, past its defences. */
export function overchannelBacklash(ctx: ResolveContext): void {
  const { input, attacker, plan, deps, state, warnings } = ctx;
  if (input.overchannel !== true || !plan.spendSpellSlot || input.commit === false) return;
  const before = attacker.actionUses[OVERCHANNEL_KEY] ?? 0;
  attacker.actionUses = { ...attacker.actionUses, [OVERCHANNEL_KEY]: Math.min(20, before + 1) };
  if (before === 0) {
    warnings.push(`Overchannel: ${attacker.name}'s spell deals its maximum damage.`);
    return;
  }
  const perLevel = before + 1;
  const formula = `${perLevel * plan.spendSpellSlot.level}d12`;
  const rolled = resolveDice(parseDiceFormula(formula), deps.random);
  recordRoll(ctx, rolled, "damage", "Overchannel");
  // An untyped amount runs no defences, as "This damage ignores Resistance and Immunity" asks.
  const { application, events } = applyDamageDetailed(
    state,
    attacker.id,
    { amount: rolled.total, sourceName: "Overchannel", sourceActorId: attacker.id },
    { role: "gm" },
    {
      ...(deps.resolveDefinition
        ? { resolveDefinition: deps.resolveDefinition }
        : { resolveDefinition: () => undefined }),
      newId: deps.newRollId,
      now: deps.now,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      rollDie: deps.random
    }
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} takes ${application.totalApplied} Necrotic damage from Overchannel (${formula}).`,
    actorIds: [attacker.id]
  });
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}
