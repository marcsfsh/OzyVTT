import type { AbilityId, Actor, ActorDerivedSheet, ContentSkillSummary, DerivedAbilityRow, DerivedSkillRow } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { checkRiderBonus, effectiveSkillTier, EMPTY_DERIVATION, skillTierSources, type EquipmentDerivation } from "./equipment-derivation.js";
import { saveTotalFor } from "./saving-throws.js";

/**
 * ============================================================================================
 * THE SHEET'S NUMBERS, COMPUTED WHERE THE RULES LIVE
 * ============================================================================================
 *
 * Every value a character sheet shows next to a roll button, derived server-side from the same
 * functions the resolver uses.
 *
 * WHY THIS EXISTS. The sheet used to compute its own ability-check, save and skill bonuses from
 * `definition.abilityScores` + `definition.proficiencyBonus`, with no item term at all. Three things
 * were wrong with that:
 *
 *   - A circlet granting Stealth expertise changed nothing. `effectiveSkillTier` computed the right
 *     tier and had ZERO production callers - the item's whole point reached no player.
 *   - A +2-saves amulet gave +5 on a GM-forced save (the server applies riders) and +3 when the
 *     player tapped their own chip. Same save, two answers, depending on who started it.
 *   - `check-bonus` riders were summed into `derivation.checkBonus` and read by nothing.
 *
 * That is a server-authority violation by omission (CLAUDE.md rule 2): the client was deciding a
 * game number. The fix is not to teach the client about riders - it is to stop the client computing.
 *
 * WHERE IT RIDES, AND WHY NOT THE PROJECTION. This block travels on `actor:available-actions`, a
 * REQUEST that authorizes its caller for one named actor (GM-grade anyone; a player only an actor
 * whose `ownerSessionId` is theirs) before anything is derived. It is deliberately NOT on `PlayerView`.
 *
 * The projection is a BROADCAST: every connected player receives one, carrying every actor they can
 * see. A per-actor field there is guarded only by getting the strip right in BOTH `projections.ts`
 * and `PlayerActor`'s `Omit`, on every tick, forever - and a field that reaches one of those lists
 * but not the other is precisely the shape every leak in this codebase has had. Riding a request
 * that already authorizes its caller means ONE gate, already written and already tested, and the
 * block is never even COMPUTED for an actor the caller may not see.
 *
 * It also adds no actor state, so there is nothing new for a projection to leak and no strip that has
 * to stay right - the same argument `equipment-derivation.ts` makes for deriving at read.
 */

/** Re-exported so server callers need not reach into @vtt/domain for the shape they just built. */
export type { ActorDerivedSheet, DerivedAbilityRow, DerivedSkillRow };

const ABILITIES: readonly AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];

/**
 * Build the whole block. Pure in (actor, definition, derivation, skills) and recomputed on every
 * read, so taking the circlet off simply makes the next call return the base tier - the same
 * replace-whole un-grant `deriveEquipment` guarantees.
 */
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
    // The save the resolver would roll, so the chip and `answerSave` cannot disagree. Cover is
    // excluded on purpose: it is a property of one attack's line of sight, not of the character.
    const save = saveTotalFor(definition, actor, ability, derivation);
    return {
      ability,
      check,
      checkWithProficiency: check + proficiencyBonus,
      save,
      // An item that GRANTS the save proficiency makes the character proficient, so the sheet's dot
      // has to say so - the number alone ("+5 from items") would leave the row contradicting itself.
      saveProficient: proficientSaves.has(ability) || derivation.saves.some((entry) => entry.id === ability),
      // What the equipment contributes, isolated by re-asking with the EMPTY derivation rather
      // than by re-summing the rider terms - one sum, so the two halves cannot drift.
      saveFromItems: save - saveTotalFor(definition, actor, ability, EMPTY_DERIVATION)
    };
  });

  const derivedSkills = skills.map((skill): DerivedSkillRow => {
    const ability = (skill.ability ?? null) as AbilityId | null;
    const tier = effectiveSkillTier(definition, derivation, skill.id);
    const override = definition?.proficiencies?.skillOverrides?.[skill.id];
    let bonus: number | null = null;
    if (typeof override === "number") {
      // An explicit total the GM typed wins over the computed one, exactly as it does for saves -
      // but item riders still ride on top, because the override replaces the BASE, not the loadout.
      bonus = override + (ability ? checkRiderBonus(derivation, { ability, skill: skill.id }) : 0);
    } else if (ability && scores) {
      const multiplier = tier === "expertise" ? 2 : tier === "proficient" ? 1 : 0;
      bonus = abilityModifier(scores[ability]) + proficiencyBonus * multiplier + checkRiderBonus(derivation, { ability, skill: skill.id });
    }
    return { id: skill.id, name: skill.name, ability, tier, bonus, sources: skillTierSources(derivation, skill.id) };
  });

  return {
    proficiencyBonus,
    // `actor.armorClass` is already reconciled on every inventory write, so it is the live number.
    // It is optional on `Actor` (a bare token has none), so the stat block is the fallback.
    armorClass: actor.armorClass ?? definition?.armorClass ?? 0,
    // Initiative is NOT reconciled onto the actor, so the live value is computed here. Anything
    // reading `actor.initiative` directly still sees the instantiation-time number - a real
    // remaining gap, recorded rather than papered over.
    initiative: (scores ? abilityModifier(scores.dex) : 0) + (definition?.initiativeBonus ?? 0) + derivation.initiative,
    abilities,
    skills: derivedSkills
  };
}

