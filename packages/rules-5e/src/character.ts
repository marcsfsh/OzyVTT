/**
 * Pure SRD 5e character math. Like the rest of `@vtt/rules-5e`, these are stateless functions
 * over plain numbers - no game-state, schema, or content knowledge. Callers (the server rules
 * engine and the client sheet) pass raw ability scores / levels and get the derived number back,
 * so the formula lives in exactly one place instead of being re-implemented per call site.
 */

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

/** How proficient a creature is in a save or skill (SRD: none / proficient / Expertise). */
export type ProficiencyTier = "none" | "proficient" | "expertise";

/** SRD ability modifier: floor((score - 10) / 2). Holds for any integer score (1-30 in practice). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
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
