/**
 * A record body as the catalog row a reader gets of it, worked out the way the server's content library works it out
 * (`content-library.ts`): the spell card's summary, the gear picker's row, the builder's class, species, background,
 * subclass and feat rows. The Compendium's card renders a draft through these, so a record being written shows in the
 * components and at the proportions of the place people meet it. An SRD record's authorable body has the same shape.
 */

import type {
  ContentBackgroundSummary,
  ContentClassSummary,
  ContentEquipmentSummary,
  ContentFeatSummary,
  ContentFeatureSummary,
  ContentSpeciesSummary,
  ContentSpellSummary,
  ContentSubclassSummary
} from "@vtt/domain";
import { cantripScalingOf, slotCastingOptionsOf, type SpellReference } from "@vtt/content-srd-5.2.1/schemas";
import { spellComponentsText } from "@vtt/content-srd-5.2.1/spell-effect";
import { getAt } from "./paths";
import type { Draft } from "./schema";

type Body = Draft;
type Source = "srd" | "homebrew";

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const objectOf = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;
const sourceOf = (body: Body): Source => (body.source === "srd" ? "srd" : "homebrew");
const nameOf = (body: Body, fallback: string) => textOrNull(body.name) ?? fallback;

/** A choice list as the wire carries it, or null when the record offers none. */
function choiceList(value: unknown) {
  const held = objectOf(value);
  if (!held) return null;
  return {
    choose: typeof held.choose === "number" ? held.choose : 0,
    from: strings(held.from),
    fromCatalog: textOrNull(held.fromCatalog)
  };
}

/** A feature as the builder lists it. Riders stay behind, as they do on the server. */
function featureOf(feature: unknown, grantedAtLevels: readonly number[] = []): ContentFeatureSummary {
  const held = objectOf(feature) ?? {};
  return {
    id: text(held.id) || "feature",
    name: textOrNull(held.name) ?? "Unnamed feature",
    level: typeof held.level === "number" ? held.level : null,
    description: text(held.description),
    tags: strings(held.tags),
    choices: [],
    grantedAtLevels: [...grantedAtLevels],
    extraPicks: []
  };
}

/** Feature id to every level row that grants it, in order. */
function grantLevels(levelTable: unknown): ReadonlyMap<string, number[]> {
  const levels = new Map<string, number[]>();
  for (const row of list<Readonly<Record<string, unknown>>>(levelTable)) {
    const level = typeof row.level === "number" ? row.level : null;
    if (level === null) continue;
    for (const id of strings(row.features)) levels.set(id, [...(levels.get(id) ?? []), level]);
  }
  return levels;
}

function spellcastingOf(value: unknown): ContentClassSummary["spellcasting"] {
  const held = objectOf(value);
  if (!held) return null;
  const progression = held.multiclassProgression;
  return {
    ability: (text(held.ability) || "int") as NonNullable<ContentClassSummary["spellcasting"]>["ability"],
    prepares: held.prepares === "known" ? "known" : "prepared",
    ritual: held.ritual === true,
    focus: textOrNull(held.focus),
    progression:
      progression === "half" || progression === "third" || progression === "pact" ? progression : ("full" as const),
    spellListId: textOrNull(held.spellListId)
  };
}

export function classSummaryOf(body: Body, id: string): ContentClassSummary {
  const grants = grantLevels(body.levelTable);
  const spellcasting = spellcastingOf(body.spellcasting);
  const skills = choiceList(body.skillChoices);
  const multiclass = objectOf(body.multiclassProficiencies);
  const prerequisites = objectOf(body.multiclassPrerequisites);
  return {
    id,
    name: nameOf(body, "Untitled class"),
    source: sourceOf(body),
    summary: textOrNull(body.summary),
    description: textOrNull(body.description),
    hitDie: (text(body.hitDie) || "d8") as ContentClassSummary["hitDie"],
    statPriority: strings(body.statPriority) as ContentClassSummary["statPriority"],
    primaryAbilities: strings(body.primaryAbilities) as ContentClassSummary["primaryAbilities"],
    savingThrows: strings(body.savingThrows) as ContentClassSummary["savingThrows"],
    skillChoiceCount: skills?.choose ?? 0,
    skillChoices: skills?.from ?? [],
    armorProficiencies: strings(body.armorProficiencies),
    weaponProficiencies: strings(body.weaponProficiencies),
    toolProficiencies: strings(body.toolProficiencies),
    toolChoices: choiceList(body.toolChoices),
    multiclassProficiencies: multiclass
      ? {
          armor: strings(multiclass.armor),
          weapons: strings(multiclass.weapons),
          tools: strings(multiclass.tools),
          skillChoices: choiceList(multiclass.skills),
          toolChoices: choiceList(multiclass.toolChoices)
        }
      : null,
    multiclassPrerequisites: prerequisites
      ? {
          mode: prerequisites.mode === "any" ? "any" : "all",
          minimums: list<{ ability: string; minimum: number }>(prerequisites.minimums).map((entry) => ({
            ability: entry.ability as ContentClassSummary["primaryAbilities"][number],
            minimum: entry.minimum
          }))
        }
      : null,
    subclassLevel: typeof body.subclassLevel === "number" ? body.subclassLevel : 3,
    subclassLabel: textOrNull(body.subclassLabel),
    asiLevels: list<number>(body.asiLevels),
    spellcastingAbility: spellcasting?.ability ?? null,
    spellcastingProgression: spellcasting?.progression ?? null,
    spellcasting,
    levelTable: list<Readonly<Record<string, unknown>>>(body.levelTable).map((row) => ({
      level: typeof row.level === "number" ? row.level : 1,
      proficiencyBonus: typeof row.proficiencyBonus === "number" ? row.proficiencyBonus : 2,
      spellSlots: Array.isArray(row.spellSlots) ? (row.spellSlots as number[]) : null,
      pactSlots: (objectOf(row.pactSlots) as { level: number; slots: number } | null) ?? null,
      cantripsKnown: typeof row.cantripsKnown === "number" ? row.cantripsKnown : null,
      spellsKnown: typeof row.spellsKnown === "number" ? row.spellsKnown : null,
      preparedFormula: textOrNull(row.preparedFormula),
      preparedCount: typeof row.preparedCount === "number" ? row.preparedCount : null,
      classResources: list<{ id: string; name: string; amount: number | string }>(row.classResources)
    })),
    startingEquipmentOptions: [],
    features: list(body.features).map((feature) => featureOf(feature, grants.get(text(objectOf(feature)?.id)) ?? []))
  };
}

export function subclassSummaryOf(body: Body, id: string): ContentSubclassSummary {
  const spellcasting = spellcastingOf(body.spellcasting);
  return {
    id,
    name: nameOf(body, "Untitled subclass"),
    source: sourceOf(body),
    classId: text(body.classId) || "class",
    summary: textOrNull(body.summary),
    description: textOrNull(body.description),
    subclassLevel: typeof body.subclassLevel === "number" ? body.subclassLevel : null,
    spellcastingAbility: spellcasting?.ability ?? null,
    spellcastingProgression: spellcasting?.progression ?? null,
    spellcasting,
    features: list(body.features).map((feature) => featureOf(feature))
  };
}

export function speciesSummaryOf(body: Body, id: string): ContentSpeciesSummary {
  const lineages = list<Readonly<Record<string, unknown>>>(body.lineages);
  return {
    id,
    name: nameOf(body, "Untitled species"),
    source: sourceOf(body),
    summary: textOrNull(body.summary),
    description: textOrNull(body.description),
    sizes: strings(body.sizes) as ContentSpeciesSummary["sizes"],
    speedFeet: typeof body.speedFeet === "number" ? body.speedFeet : 30,
    darkvisionFeet: typeof body.darkvisionFeet === "number" ? body.darkvisionFeet : null,
    creatureType: text(body.creatureType) || "humanoid",
    abilityBonuses: [],
    abilityBonusChoice: null,
    languages: strings(body.languages),
    languageChoices: choiceList(body.languageChoices),
    lineages: lineages.map((lineage) => ({
      id: text(lineage.id),
      name: text(lineage.name),
      description: textOrNull(lineage.description)
    })),
    features: [...list(body.traits), ...lineages.flatMap((lineage) => list(lineage.traits))].map((feature) =>
      featureOf(feature)
    )
  };
}

export function backgroundSummaryOf(body: Body, id: string): ContentBackgroundSummary {
  const ability = objectOf(body.abilityOptions);
  return {
    id,
    name: nameOf(body, "Untitled background"),
    source: sourceOf(body),
    summary: textOrNull(body.summary),
    description: textOrNull(body.description),
    abilityOptions: ability
      ? {
          from: strings(ability.from) as NonNullable<ContentBackgroundSummary["abilityOptions"]>["from"],
          spreads: list<number[]>(ability.spreads)
        }
      : null,
    originFeatId: textOrNull(body.originFeatId),
    skillProficiencies: strings(body.skillProficiencies),
    skillChoices: choiceList(body.skillChoices),
    toolProficiencies: strings(body.toolProficiencies),
    toolChoices: choiceList(body.toolChoices),
    languages: strings(body.languages),
    languageChoices: choiceList(body.languageChoices),
    startingEquipmentOptions: [],
    features: list(body.features).map((feature) => featureOf(feature))
  };
}

export function featSummaryOf(body: Body, id: string): ContentFeatSummary {
  const prerequisite = objectOf(body.prerequisite);
  return {
    id,
    name: nameOf(body, "Untitled feat"),
    source: sourceOf(body),
    summary: textOrNull(body.summary),
    description: textOrNull(body.description),
    category: text(body.category) || "general",
    repeatable: body.repeatable === true,
    prerequisiteLevel: typeof prerequisite?.level === "number" ? prerequisite.level : null,
    prerequisiteAbilities: list<{ ability: string; minimum: number }>(prerequisite?.abilityScores).map((entry) => ({
      ability: entry.ability as ContentFeatSummary["prerequisiteAbilities"][number]["ability"],
      minimum: entry.minimum
    })),
    prerequisiteRequires: strings(prerequisite?.requires),
    prerequisiteText: textOrNull(prerequisite?.text),
    feature: featureOf(body.feature)
  };
}

/** The spell card's summary. */
export function spellSummaryOf(body: Body, id: string): ContentSpellSummary {
  const range = objectOf(body.range) ?? {};
  const components = (objectOf(body.components) ?? {
    verbal: false,
    somatic: false,
    material: false,
    materialText: null,
    materialConsumed: false
  }) as Parameters<typeof spellComponentsText>[0];
  const roll = getAt(body, "damage.roll");
  const options = list<SpellReference["castingOptions"][number]>(body.castingOptions).filter(
    (option) => option && typeof option.type === "string"
  );
  const level = typeof body.level === "number" ? body.level : 1;
  return {
    id,
    name: nameOf(body, "Untitled spell"),
    source: sourceOf(body),
    level,
    school: text(body.school),
    castingTime: text(body.castingTime),
    rangeText: textOrNull(range.text),
    attackRoll: body.attackRoll === true,
    rangeFeet: range.unit === "feet" && typeof range.distance === "number" ? range.distance : null,
    componentsText: spellComponentsText(components),
    duration: text(body.duration),
    concentration: body.concentration === true,
    ritual: body.ritual === true,
    description: text(body.description),
    higherLevel: textOrNull(body.higherLevel),
    classes: strings(body.classes),
    damageRoll: typeof roll === "string" && roll.trim() ? roll.trim() : null,
    damageTypes: strings(getAt(body, "damage.types")),
    castingOptions: slotCastingOptionsOf(options),
    cantripScaling: level === 0 ? cantripScalingOf(options) : []
  };
}

/** The gear picker's row and the sheet's item. */
export function equipmentSummaryOf(body: Body, id: string): ContentEquipmentSummary {
  const weapon = objectOf(body.weapon) as ContentEquipmentSummary["weapon"];
  const armor = objectOf(body.armor) as ContentEquipmentSummary["armor"];
  const attunement = objectOf(body.attunement);
  return {
    id,
    name: nameOf(body, "Untitled item"),
    source: sourceOf(body),
    category: text(body.category) || "gear",
    costGp: typeof body.costGp === "number" ? body.costGp : null,
    weightLb: typeof body.weightLb === "number" ? body.weightLb : null,
    description: textOrNull(body.description),
    weapon: weapon ?? null,
    armor: armor && typeof armor.acBase === "number" ? armor : null,
    appliesTo: null,
    rarity: textOrNull(body.rarity),
    attunement: attunement
      ? { required: attunement.required === true, restrictedTo: strings(attunement.restrictedTo) }
      : null
  };
}
