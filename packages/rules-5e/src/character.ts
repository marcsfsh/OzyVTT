/**
 * Pure SRD 5e character math. Like the rest of `@vtt/rules-5e`, these are stateless functions
 * over plain numbers - no game-state, schema, or content knowledge. Callers (the server rules
 * engine and the client sheet) pass raw ability scores / levels and get the derived number back,
 * so the formula lives in exactly one place instead of being re-implemented per call site.
 */

import { effectiveSlot } from "./riders.js";

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

/** How proficient a creature is in a save or skill (SRD: none / proficient / Expertise). */
export type ProficiencyTier = "none" | "proficient" | "expertise";

/** SRD ability modifier: floor((score - 10) / 2). Holds for any integer score (1-30 in practice). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * WHICH ABILITY A WEAPON ATTACK ROLLS OFF, from the SRD weapon properties (2024 rules).
 *
 * Finesse takes the better of Strength and Dexterity - it is the player's choice, and no sheet has
 * ever wanted the worse one. Otherwise a ranged weapon rolls Dexterity and a melee weapon Strength,
 * and `thrown` is what makes those two not the same question as "does it have a range": a Javelin
 * has a range and is still a Strength weapon, because throwing one is a melee weapon used at range.
 *
 * It lives HERE, in the dependency-free rules package, because it has two callers that must not
 * disagree: the server derives the authoritative attack from it, and the character sheet derives
 * the tap-to-roll preview beside it. The sheet's copy of this rule was `rangeFeet != null ? dex :
 * str` under a comment claiming finesse "isn't vendored in the SRD weapon table" - true when it was
 * written, false the moment the `properties` column shipped, and wrong on both axes afterwards. A
 * preview mirrors the server result; it does not get its own arithmetic.
 *
 * Takes primitives rather than an item so it can sit below both the domain types and the wire
 * schema, which is what lets both sides call it.
 */
export function weaponAbilityModifierFrom(properties: readonly string[], rangeFeet: number | null | undefined, str: number, dex: number): number {
  const ranged = rangeFeet !== null && rangeFeet !== undefined && !properties.includes("thrown");
  return properties.includes("finesse") ? Math.max(str, dex) : ranged ? dex : str;
}

/** Total character level for multiclass sheets = the sum of class levels; never below 1. */
export function characterLevel(classLevels: readonly number[]): number {
  const total = classLevels.reduce((sum, level) => sum + level, 0);
  return total < 1 ? 1 : total;
}

/**
 * SRD proficiency bonus by total character level: +2 at levels 1-4, then +1 every 4 levels up to
 * +6 at 17-20. Levels are clamped to 1-20 so out-of-range input still yields a legal bonus.
 */
export function proficiencyBonusForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(20, level));
  return 2 + Math.floor((clamped - 1) / 4);
}

/** Saving-throw bonus = ability modifier, plus the proficiency bonus when the creature is proficient. */
export function saveBonus(score: number, proficiencyBonus: number, proficient: boolean): number {
  return abilityModifier(score) + (proficient ? proficiencyBonus : 0);
}

/**
 * Skill bonus = ability modifier, plus the proficiency bonus once when proficient or twice with
 * Expertise (SRD). An untrained skill is just the ability modifier.
 */
export function skillBonus(score: number, proficiencyBonus: number, tier: ProficiencyTier): number {
  const multiplier = tier === "expertise" ? 2 : tier === "proficient" ? 1 : 0;
  return abilityModifier(score) + proficiencyBonus * multiplier;
}

/** Spell save DC = 8 + proficiency bonus + spellcasting-ability modifier (SRD). */
export function spellSaveDc(spellcastingAbilityScore: number, proficiencyBonus: number): number {
  return 8 + proficiencyBonus + abilityModifier(spellcastingAbilityScore);
}

/** Spell attack bonus = proficiency bonus + spellcasting-ability modifier (SRD). */
export function spellAttackBonus(spellcastingAbilityScore: number, proficiencyBonus: number): number {
  return proficiencyBonus + abilityModifier(spellcastingAbilityScore);
}

/** The armor/shield fields an item carries (from the SRD catalog) that drive Armor Class. */
export type ItemArmorStats = Readonly<{ acBase: number; addDexModifier: boolean; dexModifierCap: number | null }>;
/** Minimal shape of an equipped inventory item this math needs (kept structural so callers can pass their own item type). */
export type EquippedItem = Readonly<{ equipped?: boolean; category?: string; slot?: string; armor?: ItemArmorStats | undefined }>;

/**
 * Unarmored Defense as the ARITHMETIC needs it, which is all this package is allowed to know: the
 * modifier the feature adds on top of 10 + Dex, and whether a Shield keeps it. The caller resolves
 * WHICH ability the feature names and looks the score up - `bonus` arrives already a modifier.
 *
 * `allowShield` is the whole Barbarian/Monk difference and it is authored content, not a constant:
 * the Barbarian's prints "You can use a Shield and still gain this benefit" and the Monk's prints
 * "while you aren't wearing armor or wielding a Shield".
 */
export type UnarmoredDefense = Readonly<{ bonus: number; allowShield: boolean }>;

/**
 * SRD Armor Class from equipped armor + shields. Returns null when the character has no equipped armor OR
 * shield (so the caller keeps the character's stored/base AC - natural armor, mage armor, Unarmored
 * Defense bare-handed, a monster's stat-block AC). When armor IS equipped: acBase + Dex (capped for
 * medium, none for heavy - the SRD rule is encoded directly by the item's addDexModifier /
 * dexModifierCap). A shield adds its own acBase (+2).
 *
 * `unarmored` is what a SHIELD ALONE needs, and leaving it out is the bug U28 fixed: a shield with no
 * body armor used to read a flat 10 + Dex + shield, so a Barbarian who picked one up traded their
 * Constitution for +2 and got STRICTLY WORSE (measured: AC 15 bare-handed, 14 holding a shield). The
 * decision belongs here rather than at each of the four call sites because it is one SRD rule and this
 * file exists so the formula lives in exactly one place. Callers with no such feature pass nothing and
 * get the old arithmetic unchanged - a monster, a PDF import and every non-Barbarian are untouched.
 *
 * The armor/shield hook is `effectiveSlot` (the explicit `slot` field, falling back to the three
 * engine-known `category` literals), so a homebrew category with an explicit slot derives AC too.
 * ONE shield counts - the best equipped one. Body armor was already de-duped by the builder; shields
 * never were, so three equipped shields used to read +6.
 */
export function armorClassFromEquipment(dexModifier: number, items: readonly EquippedItem[], unarmored?: UnarmoredDefense | null): number | null {
  const worn = items.filter((item) => item.equipped && item.armor);
  const equippedArmor = worn.find((item) => effectiveSlot(item) === "armor");
  const shieldBonus = worn.reduce((best, item) => effectiveSlot(item) === "shield" ? Math.max(best, item.armor!.acBase) : best, 0);
  if (!equippedArmor && shieldBonus === 0) return null;
  const dexAllowed = (armor: ItemArmorStats) => (armor.addDexModifier ? Math.min(dexModifier, armor.dexModifierCap ?? Number.POSITIVE_INFINITY) : 0);
  // Unarmored Defense sets a BASE Armor Class, so body armor replaces it outright (both printings say
  // "while you aren't wearing armor") - which is why it is read only in the second branch. Reaching
  // that branch means a shield IS held, the bare-handed case having returned null above, so the only
  // question left is whether this feature's own printing keeps the benefit while wielding one.
  const base = equippedArmor
    ? equippedArmor.armor!.acBase + dexAllowed(equippedArmor.armor!)
    : 10 + dexModifier + (unarmored?.allowShield ? unarmored.bonus : 0);
  return base + shieldBonus;
}
