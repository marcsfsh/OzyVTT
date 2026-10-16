/**
 * Reading a spell's cast model (`SpellReference.effect`) from its record: the healing its text names, and a
 * homebrew spell's model from the columns its author set. The SRD build reads its own reviewed table on top
 * (`scripts/spell-effects.ts`). Pure, so the homebrew catalog can run it as it is built.
 */
import { DamageTypeSchema, DiceFormulaSchema } from "@vtt/schemas";
import type { SpellEffect, SpellReference } from "./schemas.js";

/** The hit points a cast restores, from "regains Hit Points equal to 2d8 plus your spellcasting ability
 *  modifier", "regains 4d8 + 15 Hit Points" or "restoring 70 Hit Points". Null when it restores none. */
export function healingOfText(description: string): SpellEffect["healing"] {
  const withModifier =
    /regains? (?:a number of )?Hit Points equal to (\d+d\d+(?:\s*\+\s*\d+)?) plus your spellcasting ability modifier/i.exec(
      description
    );
  if (withModifier) return { formula: withModifier[1], addsModifier: true };
  const flat = /(?:regains?|restoring) (\d+d\d+(?:\s*\+\s*\d+)?|\d+) Hit Points/i.exec(description);
  return flat ? { formula: flat[1], addsModifier: false } : null;
}

/** A homebrew spell's cast model from what its author set: the attack box, the damage roll and its first type,
 *  and the healing its text names. Damage needs a valid roll and type, so a healing roll is never read as damage. */
export function spellEffectFromColumns(spell: SpellReference): SpellEffect {
  const healing = healingOfText(spell.description);
  const formula = DiceFormulaSchema.safeParse(spell.damage.roll);
  const type = DamageTypeSchema.safeParse(spell.damage.types[0]);
  return {
    attacks: spell.attackRoll ? 1 : 0,
    damage: !healing && formula.success && type.success ? [{ formula: formula.data, type: type.data }] : [],
    healing
  };
}
