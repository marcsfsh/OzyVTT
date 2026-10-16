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

export type SpellRange = SpellReference["range"];

/** A spell range in feet, or null for Touch, Self and the ranges a map can't measure. */
export function spellRangeFeet(range: SpellRange): number | null {
  return range.unit === "feet" && range.distance !== null && range.distance >= 5 ? range.distance : null;
}

/**
 * How a cast's spell attack reaches: a melee spell attack is made within the caster's reach (5 feet, for a Touch or
 * Self spell), or 5 feet past the spell's range when a summoned thing makes it ("within 5 feet of the force"); a
 * ranged one out to the spell's range. The text says which; without it, a Touch or Self spell is melee. Null when a
 * ranged attack has no measurable range.
 */
export function spellAttackRangeOf(description: string, range: SpellRange): SpellEffect["attackRange"] | null {
  const feet = spellRangeFeet(range);
  const kind = /\bmelee spell attack/i.test(description)
    ? "melee"
    : /\branged spell attack/i.test(description) || feet !== null
      ? "ranged"
      : "melee";
  if (kind === "ranged") return feet === null ? null : { kind, feet: Math.min(5280, feet) };
  const summoned = feet !== null && /\bwithin 5 feet of (?:it|the \w+)\b/i.test(description);
  return { kind, feet: summoned ? Math.min(5280, feet + 5) : 5 };
}

/** A homebrew spell's cast model from what its author set: the attack box, the damage roll and its first type,
 *  and the healing its text names. Damage needs a valid roll and type, so a healing roll is never read as damage. */
export function spellEffectFromColumns(spell: SpellReference): SpellEffect {
  const healing = healingOfText(spell.description);
  const formula = DiceFormulaSchema.safeParse(spell.damage.roll);
  const type = DamageTypeSchema.safeParse(spell.damage.types[0]);
  const attackRange = spell.attackRoll ? spellAttackRangeOf(spell.description, spell.range) : null;
  return {
    attacks: spell.attackRoll ? 1 : 0,
    ...(attackRange ? { attackRange } : {}),
    damage: !healing && formula.success && type.success ? [{ formula: formula.data, type: type.data }] : [],
    healing
  };
}
