import type {
  AbilityId,
  Actor,
  ActorDerivedSheet,
  ContentSkillSummary,
  DerivedAbilityRow,
  DerivedSkillRow
} from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import {
  checkRiderBonus,
  effectiveSkillTier,
  EMPTY_DERIVATION,
  skillTierSources,
  type EquipmentDerivation
} from "./equipment-derivation.js";
import { saveTotalFor } from "./saving-throws.js";

/**
 * The numbers a character sheet shows next to its roll buttons, derived server-side with the same
 * functions the resolver uses, so a chip and a GM-forced roll never disagree and item riders apply.
 *
 * Delivered on `actor:available-actions`, a request that authorizes its caller for one actor before
 * anything is derived, rather than on the broadcast `PlayerView`. That keeps one authorization gate
 * instead of a per-actor strip that must stay right in both `projections.ts` and `PlayerActor`, and the
 * block is never computed for an actor the caller may not see.
 */

/** Re-exported so server callers need not reach into @vtt/domain for the shape they just built. */
export type { ActorDerivedSheet, DerivedAbilityRow, DerivedSkillRow };

const ABILITIES: readonly AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Builds the whole block. Pure and recomputed on every read, so removing an item returns the base
 *  numbers on the next call. */
export function deriveActorSheet(
  actor: Actor,
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  skills: readonly ContentSkillSummary[]
): ActorDerivedSheet {
  const scores = definition?.abilityScores;
  const proficiencyBonus = definition?.proficiencyBonus ?? 0;
  const proficientSaves = new Set(definition?.proficiencies?.saves ?? []);

  const abilities = ABILITIES.map((ability): DerivedAbilityRow => {
    const modifier = scores ? abilityModifier(scores[ability]) : 0;
    const check = modifier + checkRiderBonus(derivation, { ability });
    // The save the resolver would roll. Cover is excluded: it belongs to one attack's line of sight.
    const save = saveTotalFor(definition, actor, ability, derivation);
    return {
      ability,
      check,
      checkWithProficiency: check + proficiencyBonus,
      save,
      // An item-granted save proficiency shows on the proficiency dot too.
      saveProficient: proficientSaves.has(ability) || derivation.saves.some((entry) => entry.id === ability),
      // The equipment's share, isolated by re-asking with the empty derivation so there is one sum.
      saveFromItems: save - saveTotalFor(definition, actor, ability, EMPTY_DERIVATION)
    };
  });

  const derivedSkills = skills.map((skill): DerivedSkillRow => {
    const ability = (skill.ability ?? null) as AbilityId | null;
    const tier = effectiveSkillTier(definition, derivation, skill.id);
    const override = definition?.proficiencies?.skillOverrides?.[skill.id];
    let bonus: number | null = null;
    if (typeof override === "number") {
      // A GM-typed total replaces the base, but item riders still apply on top.
      bonus = override + (ability ? checkRiderBonus(derivation, { ability, skill: skill.id }) : 0);
    } else if (ability && scores) {
      const multiplier = tier === "expertise" ? 2 : tier === "proficient" ? 1 : 0;
      bonus =
        abilityModifier(scores[ability]) +
        proficiencyBonus * multiplier +
        checkRiderBonus(derivation, { ability, skill: skill.id });
    }
    return { id: skill.id, name: skill.name, ability, tier, bonus, sources: skillTierSources(derivation, skill.id) };
  });

  return {
    proficiencyBonus,
    // `actor.armorClass` is reconciled on every inventory write; a bare token falls back to the stat block.
    armorClass: actor.armorClass ?? definition?.armorClass ?? 0,
    // Initiative is not reconciled onto the actor, so the live value is computed here; `actor.initiative`
    // still holds the instantiation-time number.
    initiative: (scores ? abilityModifier(scores.dex) : 0) + (definition?.initiativeBonus ?? 0) + derivation.initiative,
    abilities,
    skills: derivedSkills
  };
}
