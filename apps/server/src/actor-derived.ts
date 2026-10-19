import type {
  AbilityId,
  Actor,
  ActorDerivedSheet,
  ContentSkillSummary,
  DerivedAbilityRow,
  DerivedSkillRow,
  DerivedToolRow
} from "@vtt/domain";
import { aggregateRollMode, collectRiders, sumRiders } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { checkPlan, passivePerception, toolAbility, toolProficiencies, type CheckNames } from "./ability-checks.js";
import {
  checkRiderBonus,
  EMPTY_DERIVATION,
  skillTierSources,
  type EquipmentCatalog,
  type EquipmentDerivation
} from "./equipment-derivation.js";
import type { ClassReference } from "@vtt/content-srd-5.2.1";
import { choiceOverrideDefenses } from "./choice-overrides.js";
import { classColumnsOf } from "./class-columns.js";
import { autoFailsPhysicalSaves } from "./condition-rules.js";
import { standingDefences } from "./hit-points.js";
import { auraBonusOf, saveRollSources, saveTotalFor } from "./saving-throws.js";
import { currentSpeedFeet } from "./speed.js";
import { weaponMasteriesOf } from "./weapon-masteries.js";

/**
 * The numbers a character sheet shows next to its roll buttons, derived server-side with the same
 * functions the resolver uses, so a chip and a GM-forced roll never disagree and item riders apply.
 *
 * Delivered on `actor:available-actions`, a request that authorizes its caller for one actor before
 * anything is derived, and is never on the broadcast `PlayerView`. That keeps one authorization gate
 * where a per-actor strip would have to stay right in both `projections.ts` and `PlayerActor`, and the
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
  skills: readonly ContentSkillSummary[],
  catalog?: Partial<Pick<EquipmentCatalog, "featureRecord" | "equipmentRecord">>,
  classRecord: (id: string) => ClassReference | undefined = () => undefined
): ActorDerivedSheet {
  const proficiencyBonus = definition?.proficiencyBonus ?? 0;
  const proficientSaves = new Set(definition?.proficiencies?.saves ?? []);
  const names: CheckNames = {
    skill: (id) => skills.find((skill) => skill.id === id)?.name,
    tool: (id) => catalog?.equipmentRecord?.(id)?.name
  };
  // The Paladin's own aura always reaches it; an ally's depends on where they stand, so it joins the save when rolled.
  const aura = auraBonusOf(actor, definition) ?? 0;

  const abilities = ABILITIES.map((ability): DerivedAbilityRow => {
    const check = checkPlan(actor, definition, derivation, { ability }, { names });
    // The save the resolver would roll. Cover is excluded: it belongs to one attack's line of sight.
    const save = saveTotalFor(definition, actor, ability, derivation) + aura;
    const saveSources = saveRollSources(actor, ability, derivation);
    return {
      ability,
      check: check.modifier,
      checkMode: check.rollMode,
      save,
      saveMode: aggregateRollMode(saveSources.advantage, saveSources.disadvantage),
      // An item-granted save proficiency shows on the proficiency dot too.
      saveProficient: proficientSaves.has(ability) || derivation.saves.some((entry) => entry.id === ability),
      // The equipment's share, isolated by re-asking with the empty derivation so there is one sum.
      saveFromItems: save - aura - saveTotalFor(definition, actor, ability, EMPTY_DERIVATION),
      saveAutoFails: ability === "str" || ability === "dex" ? autoFailsPhysicalSaves(actor) : null
    };
  });

  const derivedSkills = skills.map((skill): DerivedSkillRow => {
    const ability = (skill.ability ?? null) as AbilityId | null;
    const plan = ability ? checkPlan(actor, definition, derivation, { ability, skill: skill.id }, { names }) : null;
    return {
      id: skill.id,
      name: skill.name,
      ability,
      tier: skillTier(definition, derivation, skill.id),
      bonus: plan?.modifier ?? null,
      sources: skillTierSources(derivation, skill.id),
      mode: plan?.rollMode ?? { mode: "normal", advantage: [], disadvantage: [] },
      reliableTalent: plan?.reliableTalent ?? false
    };
  });

  // Tools the SRD gives an ability ("Ability: Dexterity"); a proficiency the catalog can't name has no check to roll.
  const tools = toolProficiencies(definition, derivation).flatMap((id): DerivedToolRow[] => {
    const record = catalog?.equipmentRecord?.(id);
    const ability = toolAbility(record?.description);
    if (!record || !ability) return [];
    const plan = checkPlan(actor, definition, derivation, { ability, tool: id }, { names });
    return [
      { id, name: record.name, ability, bonus: plan.modifier, mode: plan.rollMode, reliableTalent: plan.reliableTalent }
    ];
  });

  return {
    proficiencyBonus,
    // `actor.armorClass` is reconciled on every inventory write and content change; a bare token falls back to
    // the stat block.
    armorClass: actor.armorClass ?? definition?.armorClass ?? 0,
    // Initiative is not reconciled onto the actor, so the live value is computed here; `actor.initiative`
    // still holds the instantiation-time number. `initiativeBonus` already includes Dexterity (a built
    // character's Dex modifier plus feats, a stat block's printed bonus).
    // Initiative is a Dexterity check, so a bonus to ability checks reaches it too (a Stone of Good Luck).
    initiative:
      (definition?.initiativeBonus ?? 0) + derivation.initiative + checkRiderBonus(derivation, { ability: "dex" }),
    abilities,
    skills: derivedSkills,
    tools,
    passivePerception: passivePerception(
      checkPlan(actor, definition, derivation, { ability: "wis", skill: "perception" }, { names })
    ),
    speedFeet: currentSpeedFeet(actor, derivation),
    defences: standingDefences(
      definition,
      choiceOverrideDefenses(definition, actor.choiceOverrides, catalog?.featureRecord),
      derivation
    ),
    // The same standing sum `effectiveActions` folds into every spell-save-DC action.
    spellSaveDcBonus: sumRiders(
      collectRiders(derivation.carriers, { ...derivation.context, moment: null }),
      "spell-save-dc"
    ),
    // The SRD's three, plus what an `attunement-slots` rider adds (Use Magic Device).
    attunementSlots: 3 + derivation.attunementSlots,
    weaponMasteries: weaponMasteriesOf(definition, catalog?.equipmentRecord),
    classColumns: classColumnsOf(definition, classRecord)
  };
}

/** The skill's effective tier, for the proficiency dot: the sheet's base raised by any item grant, and a monster's
 *  printed skill (its stat block lists only the skills it is proficient in). */
function skillTier(
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  skillId: string
): DerivedSkillRow["tier"] {
  const base = definition?.proficiencies?.skills.find((entry) => entry.id === skillId)?.proficiency ?? "none";
  const tiers = [base, ...derivation.skills.filter((entry) => entry.id === skillId).map((entry) => entry.proficiency)];
  if (tiers.includes("expertise")) return "expertise";
  if (tiers.includes("proficient")) return "proficient";
  const printed = (definition?.extensions["open5e.srd-2024"] as { skills?: Record<string, unknown> } | undefined)
    ?.skills?.[skillId];
  return definition?.proficiencies === undefined && typeof printed === "number" ? "proficient" : "none";
}
