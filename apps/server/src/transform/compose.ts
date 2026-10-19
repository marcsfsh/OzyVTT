import { SRD_SKILL_ABILITY } from "@vtt/content-srd-5.2.1";
import { abilityModifier } from "@vtt/rules-5e";
import type { AbilityId, ActorAction, ActorDefinition, Form, FormSpeeds } from "@vtt/schemas";
import { STATBLOCK_EXTENSION } from "../statblock-facts.js";
import { SIZE_FOOTPRINT, type CreatureSize } from "./forms.js";

/** The id of the action a form offers to leave it early (Wild Shape's Bonus Action). */
export const LEAVE_FORM_ACTION_ID = "leave-form";

const ABILITIES: readonly AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];
const PHYSICAL: ReadonlySet<AbilityId> = new Set(["str", "dex", "con"]);

type Bag = Record<string, unknown>;
const bagOf = (definition: ActorDefinition): Bag => {
  const bag = (definition.extensions ?? {})[STATBLOCK_EXTENSION];
  return bag && typeof bag === "object" ? (bag as Bag) : {};
};

/** The creature type a definition has: its stat block's, else Humanoid for a character (every SRD species is one). */
function creatureTypeIn(definition: ActorDefinition): string | null {
  const type = bagOf(definition).type;
  if (typeof type === "string" && type.length > 0) return type;
  return definition.schemaId === "vtt.actor-character" ? "humanoid" : null;
}

/** A form's speeds in the stat block's own shape, so every reader of speeds (`speed.ts`) reads them. */
function speedsBag(speeds: FormSpeeds): Bag {
  return {
    walk: speeds.walk,
    swim: speeds.swim ?? null,
    fly: speeds.fly ?? null,
    climb: speeds.climb ?? null,
    burrow: speeds.burrow ?? null,
    hover: speeds.hover === true
  };
}

/** The action that ends the form early, offered while it lasts. */
function leaveFormAction(form: Form): ActorAction | null {
  if (!form.leaveAs) return null;
  return {
    id: LEAVE_FORM_ACTION_ID,
    name: `Leave ${form.name}`,
    activation: form.leaveAs,
    description: `End ${form.name} early and return to your true form.`,
    damage: [],
    endsForm: true
  };
}

/** A printed number in the stat block's bag (`skills`, `savingThrows`). */
function printedNumber(bag: Bag, key: "skills" | "savingThrows", id: string): number | null {
  const table = bag[key];
  if (!table || typeof table !== "object") return null;
  const value = (table as Record<string, unknown>)[id];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Wild Shape's proficiencies: "You also retain your skill and saving throw proficiencies and use your Proficiency Bonus
 * for them, in addition to gaining the proficiencies of the creature. If a skill or saving throw modifier in the
 * Beast's stat block is higher than yours, use the one in the stat block." Own proficiencies stay at its own Proficiency
 * Bonus with the form's scores, the form's printed skills and saves become proficiencies too, and a printed modifier
 * that is higher becomes the number used.
 */
function keptProficiencies(
  own: ActorDefinition,
  statBlock: ActorDefinition,
  scores: ActorDefinition["abilityScores"]
): ActorDefinition["proficiencies"] {
  const base = own.proficiencies ?? { saves: [], skills: [] };
  const printed = bagOf(statBlock);
  const bonus = own.proficiencyBonus;
  const saves = new Set(base.saves);
  const saveOverrides: Partial<Record<AbilityId, number>> = {};
  for (const ability of ABILITIES) {
    const listed = printedNumber(printed, "savingThrows", ability);
    const mine = abilityModifier(scores[ability]) + (saves.has(ability) ? bonus : 0);
    if (listed !== null && listed > abilityModifier(statBlock.abilityScores[ability])) saves.add(ability);
    const withProficiency = abilityModifier(scores[ability]) + (saves.has(ability) ? bonus : 0);
    if (listed !== null && listed > Math.max(mine, withProficiency)) saveOverrides[ability] = listed;
  }
  const skills = new Map(base.skills.map((entry) => [entry.id, entry.proficiency]));
  const skillOverrides: Record<string, number> = {};
  const printedSkills = printed.skills && typeof printed.skills === "object" ? Object.keys(printed.skills) : [];
  for (const skill of new Set([...skills.keys(), ...printedSkills])) {
    const ability = SRD_SKILL_ABILITY[skill];
    if (!ability) continue;
    const listed = printedNumber(printed, "skills", skill);
    if (listed !== null && !skills.has(skill)) skills.set(skill, "proficient");
    const tier = skills.get(skill);
    const mine = abilityModifier(scores[ability]) + bonus * (tier === "expertise" ? 2 : tier === "proficient" ? 1 : 0);
    if (listed !== null && listed > mine) skillOverrides[skill] = listed;
  }
  return {
    ...base,
    saves: ABILITIES.filter((ability) => saves.has(ability)),
    skills: [...skills].map(([id, proficiency]) => ({ id, proficiency })),
    ...(Object.keys(saveOverrides).length > 0 ? { saveOverrides } : {}),
    ...(Object.keys(skillOverrides).length > 0 ? { skillOverrides } : {})
  };
}

/** The character half of a creature that keeps none of its features: its identity, with no features, feats or picks
 *  that would still act through the sheet. */
function identityOnly(character: NonNullable<ActorDefinition["character"]>): ActorDefinition["character"] {
  const { martialArts: _martialArts, ...rest } = character;
  return { ...rest, features: [], feats: [], choices: [] };
}

/**
 * The definition a creature reads while it has taken a stat block's form (SRD Shape-Shifting, as each effect's text
 * says): the stat block's statistics (its size, scores, Armor Class, speeds, senses, defences, traits and actions) with
 * what the creature keeps of its own. Its Hit Points, Hit Point Dice and name always stay its own. `keeps` adds its
 * Intelligence, Wisdom and Charisma (`mental`), its class features, feats and the actions they give with its
 * proficiencies (`features`), its proficiencies alone, its Spellcasting feature and spell actions (`spellcasting`), and
 * its creature type (`type`).
 */
export function composeStatBlockForm(own: ActorDefinition, statBlock: ActorDefinition, form: Form): ActorDefinition {
  const keeps = new Set(form.keeps);
  const features = keeps.has("features");
  const spellcasting = features || keeps.has("spellcasting");
  const abilityScores = Object.fromEntries(
    ABILITIES.map((ability) => [
      ability,
      PHYSICAL.has(ability) || !keeps.has("mental") ? statBlock.abilityScores[ability] : own.abilityScores[ability]
    ])
  ) as ActorDefinition["abilityScores"];
  const keptActions = features ? own.actions : spellcasting ? own.actions.filter((action) => action.spellId) : [];
  const formActions = statBlock.actions.filter((action) => !keptActions.some((kept) => kept.id === action.id));
  const leave = leaveFormAction(form);
  const bag: Bag = { ...bagOf(statBlock) };
  if (keeps.has("type")) bag.type = creatureTypeIn(own) ?? bag.type;
  if (form.speeds) bag.speeds = speedsBag(form.speeds);
  const footprint = SIZE_FOOTPRINT[statBlock.size as CreatureSize] ?? 1;
  const proficiencies =
    features || keeps.has("proficiencies") ? keptProficiencies(own, statBlock, abilityScores) : undefined;
  const {
    proficiencies: _ownProficiencies,
    spellcasting: _ownSpellcasting,
    damageResistances: _resistances,
    damageImmunities: _immunities,
    damageVulnerabilities: _vulnerabilities,
    conditionImmunities: _conditionImmunities,
    legendary: _legendary,
    traitMechanics: _traits,
    character: ownCharacter,
    ...ownRest
  } = own;
  return {
    ...ownRest,
    // A printed total Armor Class (the stat block's), so worn armor isn't counted on top of natural armor.
    source: statBlock.source,
    summary: statBlock.summary,
    size: statBlock.size,
    abilityScores,
    proficiencyBonus: features || keeps.has("proficiencies") ? own.proficiencyBonus : statBlock.proficiencyBonus,
    armorClass: statBlock.armorClass,
    hitPoints: own.hitPoints,
    initiativeBonus: statBlock.initiativeBonus,
    speedFeet: form.speeds?.walk ?? statBlock.speedFeet,
    actions: [...formActions, ...keptActions, ...(leave ? [leave] : [])],
    token: { disposition: own.token.disposition, footprint: { width: footprint, height: footprint } },
    extensions: { ...own.extensions, [STATBLOCK_EXTENSION]: bag },
    ...(statBlock.damageResistances ? { damageResistances: [...statBlock.damageResistances] } : {}),
    ...(statBlock.damageImmunities ? { damageImmunities: [...statBlock.damageImmunities] } : {}),
    ...(statBlock.damageVulnerabilities ? { damageVulnerabilities: [...statBlock.damageVulnerabilities] } : {}),
    ...(statBlock.conditionImmunities ? { conditionImmunities: [...statBlock.conditionImmunities] } : {}),
    ...(statBlock.legendary ? { legendary: { ...statBlock.legendary } } : {}),
    ...(statBlock.traitMechanics ? { traitMechanics: structuredClone(statBlock.traitMechanics) } : {}),
    ...(ownCharacter ? { character: features ? ownCharacter : identityOnly(ownCharacter) } : {}),
    ...(proficiencies ? { proficiencies } : {}),
    ...(spellcasting && own.spellcasting ? { spellcasting: own.spellcasting } : {})
  };
}

/**
 * The definition a creature reads in one of its own printed forms, or a form that changes only how it moves: "Its game
 * statistics, other than its size, are the same in each form". Its size, footprint and speeds are the form's, and the
 * action that leaves the form is offered when the form names one.
 */
export function composeOwnForm(own: ActorDefinition, form: Form): ActorDefinition {
  const bag: Bag = { ...bagOf(own) };
  if (form.speeds) bag.speeds = speedsBag(form.speeds);
  const size = form.size ?? own.size;
  const footprint = form.size ? (SIZE_FOOTPRINT[form.size as CreatureSize] ?? 1) : undefined;
  const leave = leaveFormAction(form);
  return {
    ...own,
    size,
    ...(form.speeds ? { speedFeet: form.speeds.walk } : {}),
    ...(footprint ? { token: { ...own.token, footprint: { width: footprint, height: footprint } } } : {}),
    actions: leave ? [...own.actions.filter((action) => action.id !== LEAVE_FORM_ACTION_ID), leave] : own.actions,
    extensions: { ...own.extensions, [STATBLOCK_EXTENSION]: bag }
  };
}
