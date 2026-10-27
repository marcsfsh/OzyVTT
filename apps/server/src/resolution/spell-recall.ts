import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { holdsFeature } from "../class-features.js";
import { recordRoll, type ResolveContext } from "./context.js";

/**
 * SRD Boon of Spell Recall, Free Casting: "Whenever you cast a spell with a level 1-4 spell slot, roll 1d4. If the
 * number you roll is the same as the slot's level, the slot isn't expended." Rolled once the slot is spent, which a
 * match gives back.
 */
export function recallSpellSlot(ctx: ResolveContext): void {
  const { attacker, plan, deps, warnings } = ctx;
  const slot = plan.spendSpellSlot;
  if (!slot || slot.level < 1 || slot.level > 4) return;
  const held =
    (deps.definition?.character?.feats ?? []).some((feat) => feat.id === "boon-of-spell-recall") ||
    holdsFeature(deps.definition, "boon-of-spell-recall", "Boon of Spell Recall");
  if (!held) return;
  const rolled = resolveDice(parseDiceFormula("1d4"), deps.random);
  recordRoll(ctx, rolled, "manual", "Boon of Spell Recall");
  if (rolled.total !== slot.level) return;
  if (slot.pact) {
    if (attacker.pactSlots?.level === slot.level)
      attacker.pactSlots = { ...attacker.pactSlots, remaining: attacker.pactSlots.remaining + 1 };
  } else
    attacker.spellSlots = (attacker.spellSlots ?? []).map((entry) =>
      entry.level === slot.level ? { ...entry, remaining: entry.remaining + 1 } : entry
    );
  warnings.push(`Boon of Spell Recall: the d4 shows ${rolled.total}, so the level ${slot.level} slot isn't expended.`);
}
