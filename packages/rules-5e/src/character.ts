// Pure SRD 5e character math over plain numbers, shared by the server rules engine and the client sheet so each
// formula lives in one place.

import { effectiveSlot } from "./riders.js";

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

/** How proficient a creature is in a save or skill (SRD: none / proficient / Expertise). */
export type ProficiencyTier = "none" | "proficient" | "expertise";

/** SRD ability modifier: floor((score - 10) / 2). Holds for any integer score (1-30 in practice). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Ability modifier a weapon attack uses (SRD 2024): finesse takes the better of Str and Dex; otherwise ranged
 * uses Dex and melee Str, and a thrown weapon (Javelin) stays Str despite having a range. The server's attack
 * and the sheet's preview both call this so they cannot disagree.
 */
export function weaponAbilityModifierFrom(
  properties: readonly string[],
  rangeFeet: number | null | undefined,
  str: number,
  dex: number
): number {
  const ranged = rangeFeet !== null && rangeFeet !== undefined && !properties.includes("thrown");
  return properties.includes("finesse") ? Math.max(str, dex) : ranged ? dex : str;
}

/** Whether a weapon is a Melee weapon (SRD Weapons table): the recorded band when there is one, else no range or
 *  the Thrown property. A thrown Dagger is melee; a Dart, a ranged weapon with Thrown, is not. */
export function isMeleeWeapon(
  properties: readonly string[],
  rangeFeet: number | null | undefined,
  melee?: boolean
): boolean {
  return melee ?? (rangeFeet === null || rangeFeet === undefined || properties.includes("thrown"));
}

/** SRD Monk weapon: a Simple melee weapon, or a Martial melee weapon with the Light property. A thrown weapon
 *  (Dagger, Handaxe) is still a melee weapon. */
export function isMonkWeapon(
  category: string,
  properties: readonly string[],
  rangeFeet: number | null | undefined,
  melee?: boolean
): boolean {
  return (
    isMeleeWeapon(properties, rangeFeet, melee) &&
    (category === "simple" || (category === "martial" && properties.includes("light")))
  );
}

/** SRD proficiency bonus by total level: +2 at 1-4, +1 every 4 levels to +6 at 17-20. Clamps level to 1-20. */
export function proficiencyBonusForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(20, level));
  return 2 + Math.floor((clamped - 1) / 4);
}

/** Saving-throw bonus = ability modifier, plus the proficiency bonus when the creature is proficient. */
export function saveBonus(score: number, proficiencyBonus: number, proficient: boolean): number {
  return abilityModifier(score) + (proficient ? proficiencyBonus : 0);
}

/** Skill bonus = ability modifier + proficiency bonus (x2 with Expertise, x0 untrained). */
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
/** Structural item shape so callers can pass their own item type. */
export type EquippedItem = Readonly<{
  equipped?: boolean;
  category?: string;
  slot?: string;
  armor?: ItemArmorStats | undefined;
}>;

/** Unarmored Defense as the arithmetic needs it: the modifier added to 10 + Dex (already resolved by the caller),
 * and whether a shield keeps it (Barbarian: yes; Monk: no). */
export type UnarmoredDefense = Readonly<{ bonus: number; allowShield: boolean }>;

/** The equipped body armor with an armor block, if any (only one is ever worn). */
export function wornBodyArmor<T extends EquippedItem>(items: readonly T[]): T | undefined {
  return items.find((item) => item.equipped && item.armor && effectiveSlot(item) === "armor");
}

/**
 * SRD Armor Class from equipped armor and shields, or null with neither (the caller keeps its base AC: natural
 * armor, Unarmored Defense, a stat block). Armor: acBase + Dex per addDexModifier/dexModifierCap. Shield alone:
 * 10 + Dex, plus `unarmored.bonus` if that feature allows a shield. Only the best equipped shield counts, and only
 * for a bearer with Shield training (SRD: "You gain the Armor Class benefit of a Shield only if you have training
 * with it"). Slots come from `effectiveSlot`, so a homebrew category with an explicit slot derives AC too.
 */
export function armorClassFromEquipment(
  dexModifier: number,
  items: readonly EquippedItem[],
  unarmored?: UnarmoredDefense | null,
  training: Readonly<{ shield: boolean }> = { shield: true }
): number | null {
  const worn = items.filter((item) => item.equipped && item.armor);
  const equippedArmor = wornBodyArmor(worn);
  const shieldWorn = worn.some((item) => effectiveSlot(item) === "shield");
  const shieldBonus = training.shield
    ? worn.reduce((best, item) => (effectiveSlot(item) === "shield" ? Math.max(best, item.armor!.acBase) : best), 0)
    : 0;
  if (!equippedArmor && !shieldWorn) return null;
  const dexAllowed = (armor: ItemArmorStats) =>
    armor.addDexModifier ? Math.min(dexModifier, armor.dexModifierCap ?? Number.POSITIVE_INFINITY) : 0;
  // Unarmored Defense requires no armor, so it applies only in the shield-only branch.
  const base = equippedArmor
    ? equippedArmor.armor!.acBase + dexAllowed(equippedArmor.armor!)
    : 10 + dexModifier + (unarmored?.allowShield ? unarmored.bonus : 0);
  return base + shieldBonus;
}
