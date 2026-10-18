import { z } from "zod";
import {
  ContentBackgroundSummarySchema,
  ContentClassSummarySchema,
  ContentConditionSummarySchema,
  ContentEquipmentSummarySchema,
  ContentFeatSummarySchema,
  ContentGlossaryEntrySchema,
  ContentLanguageSummarySchema,
  ContentMonsterBenchmarkSchema,
  ContentMonsterSummarySchema,
  ContentNameBundleSchema,
  ContentSkillSummarySchema,
  ContentSpeciesSummarySchema,
  ContentSpellSummarySchema,
  ContentSubclassSummarySchema
} from "@vtt/domain";
import { ContentActionsSchema } from "@vtt/domain/commands";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { CONTENT_PATHS } from "../index.js";
import { named } from "./components.js";
import { anySession, defineRoute, gmGrade, ok, refused, type ApiRoute } from "./define.js";

/**
 * The reference catalogs (`commands/reads.ts`): the SRD 5.2.1 bundles with the GM's published homebrew merged in,
 * each scoped to its caller, so homebrew the GM keeps hidden never reaches a player.
 */

const ATTRIBUTION = "The bundle's CC BY 4.0 statement. ADR-0015 requires it on any screen that shows this content.";
const ATTRIBUTION_NOTE = "The answer carries the CC BY 4.0 attribution line a screen showing it must carry.";

/** A catalog read's data: its rows, and the attribution line any screen showing them must carry. */
const catalog = (name: string, key: string, row: z.ZodType) =>
  named(name, z.strictObject({ [key]: z.array(row), attribution: z.string().describe(ATTRIBUTION) }));

named("ActorDefinition", ActorDefinitionSchema);
const ContentMonsterSheetDataSchema = named(
  "ContentMonsterSheetData",
  z.strictObject({ definition: ActorDefinitionSchema })
);
const ContentMonsterActionsDataSchema = named(
  "ContentMonsterActionsData",
  z.strictObject({
    actions: z
      .array(z.record(z.string(), z.unknown()))
      .describe(
        "The stat block's actions, then the SRD's generic actions it may take (Dodge, Dash, Help and the rest), each flattened for running it: id, name, activation, description, attack bonus, reach and range, save ability and DC, damage formulas and area. A generic action carries `builtin: true` and its targeting, and one made with a skill the roller picks lists `checkSkills`."
      ),
    legendary: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("The creature's legendary actions per round and its Legendary Resistance, when it has them.")
  })
);

type Catalog = Readonly<{
  operationId: string;
  path: string;
  name: string;
  key: string;
  row: z.ZodType;
  summary: string;
  description: string;
}>;
/** A rules catalog any joined session may read. */
const publicCatalog = (entry: Catalog) =>
  defineRoute({
    method: "get",
    path: entry.path,
    operationId: entry.operationId,
    tag: "Reference content",
    summary: entry.summary,
    description: `${entry.description} ${ATTRIBUTION_NOTE}`,
    access: anySession("game:read"),
    responses: {
      200: ok(catalog(entry.name, entry.key, entry.row), "The catalog."),
      401: refused(),
      403: refused()
    }
  });

export const listContentMonsters = defineRoute({
  method: "get",
  path: CONTENT_PATHS.monsters,
  operationId: "listContentMonsters",
  tag: "Reference content",
  summary: "List the bestiary",
  description: `The SRD bestiary and the GM's published monsters as summaries. GM-grade only. ${ATTRIBUTION_NOTE}`,
  access: gmGrade("game:read"),
  responses: {
    200: ok(catalog("ContentMonstersData", "monsters", ContentMonsterSummarySchema), "The bestiary."),
    401: refused(),
    403: refused()
  }
});

export const listContentMonsterBenchmarks = defineRoute({
  method: "get",
  path: CONTENT_PATHS.monsterBenchmarks,
  operationId: "listContentMonsterBenchmarks",
  tag: "Reference content",
  summary: "Read the bestiary's numbers by challenge rating",
  description: `For each challenge rating, how many SRD stat blocks have it, and their lowest, median and highest Armor Class, Hit Points, attack bonus, save DC and damage in one turn at average rolls. The homebrew monster wizard compares a new creature against these. GM-grade only. ${ATTRIBUTION_NOTE}`,
  access: gmGrade("game:read"),
  responses: {
    200: ok(
      catalog("ContentMonsterBenchmarksData", "benchmarks", ContentMonsterBenchmarkSchema),
      "The numbers by challenge rating."
    ),
    401: refused(),
    403: refused()
  }
});

export const getContentMonster = defineRoute({
  method: "get",
  path: CONTENT_PATHS.monsterById,
  operationId: "getContentMonster",
  tag: "Reference content",
  summary: "Read one stat block",
  description:
    "One full stat block. A definition imported into the game shadows a bundled one with the same id, as it does when the table resolves the id, and a soft-deleted homebrew creature still on the table stays readable. GM-grade only.",
  access: gmGrade("game:read"),
  params: ContentActionsSchema,
  responses: {
    200: ok(ContentMonsterSheetDataSchema, "The stat block."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const getContentMonsterActions = defineRoute({
  method: "get",
  path: CONTENT_PATHS.monsterActions,
  operationId: "getContentMonsterActions",
  tag: "Reference content",
  summary: "Read a stat block's actions",
  description:
    "A stat block's actions flattened for running them, then the generic actions it may take. A definition imported into the game shadows a bundled one with the same id. GM-grade only.",
  access: gmGrade("game:read"),
  params: ContentActionsSchema,
  responses: {
    200: ok(ContentMonsterActionsDataSchema, "The actions."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const listContentConditions = publicCatalog({
  operationId: "listContentConditions",
  path: CONTENT_PATHS.conditions,
  name: "ContentConditionsData",
  key: "conditions",
  row: ContentConditionSummarySchema,
  summary: "List the conditions",
  description: "The SRD conditions' reference text."
});
export const listContentGlossary = publicCatalog({
  operationId: "listContentGlossary",
  path: CONTENT_PATHS.glossary,
  name: "ContentGlossaryData",
  key: "glossary",
  row: ContentGlossaryEntrySchema,
  summary: "List the rules glossary",
  description: "The SRD 5.2.1 Rules Glossary: one entry per term, with its bracketed tag."
});
export const listContentSkills = publicCatalog({
  operationId: "listContentSkills",
  path: CONTENT_PATHS.skills,
  name: "ContentSkillsData",
  key: "skills",
  row: ContentSkillSummarySchema,
  summary: "List the skills",
  description:
    "Each skill's reference text and the ability its checks use. The builder and the sheet read this list, so a homebrew skill is one more row."
});
export const listContentLanguages = publicCatalog({
  operationId: "listContentLanguages",
  path: CONTENT_PATHS.languages,
  name: "ContentLanguagesData",
  key: "languages",
  row: ContentLanguageSummarySchema,
  summary: "List the languages",
  description:
    "The SRD's Standard and Rare language tables, each row tagged with the table it is printed in. The builder's Common plus two languages resolves against this list."
});
export const listContentSpells = publicCatalog({
  operationId: "listContentSpells",
  path: CONTENT_PATHS.spells,
  name: "ContentSpellsData",
  key: "spells",
  row: ContentSpellSummarySchema,
  summary: "List the spells",
  description:
    "Every spell with what a sheet casts from: level, school, casting time, range, components, duration, the Concentration and Ritual flags, description, the spell lists it is on (`classes`) and its upcast rows by slot level (`castingOptions`)."
});
export const listContentEquipment = publicCatalog({
  operationId: "listContentEquipment",
  path: CONTENT_PATHS.equipment,
  name: "ContentEquipmentData",
  key: "equipment",
  row: ContentEquipmentSummarySchema,
  summary: "List the equipment",
  description:
    "Gear, weapons and armor in one list to browse and add from, with the weapon or armor block filled in for those categories."
});
export const listContentClasses = publicCatalog({
  operationId: "listContentClasses",
  path: CONTENT_PATHS.classes,
  name: "ContentClassesData",
  key: "classes",
  row: ContentClassSummarySchema,
  summary: "List the classes",
  description:
    "Each class's Hit Die, primary abilities, saving throw and skill proficiencies, spellcasting ability where it has one, and its features as data. `source` tells a bundled SRD class from the GM's homebrew."
});
export const listContentSubclasses = publicCatalog({
  operationId: "listContentSubclasses",
  path: CONTENT_PATHS.subclasses,
  name: "ContentSubclassesData",
  key: "subclasses",
  row: ContentSubclassSummarySchema,
  summary: "List the subclasses",
  description: "Each subclass with its parent `classId`, the level it is chosen at, and its features as data."
});
export const listContentSpecies = publicCatalog({
  operationId: "listContentSpecies",
  path: CONTENT_PATHS.species,
  name: "ContentSpeciesData",
  key: "species",
  row: ContentSpeciesSummarySchema,
  summary: "List the species",
  description: "Each species' size, walking speed and traits as data."
});
export const listContentBackgrounds = publicCatalog({
  operationId: "listContentBackgrounds",
  path: CONTENT_PATHS.backgrounds,
  name: "ContentBackgroundsData",
  key: "backgrounds",
  row: ContentBackgroundSummarySchema,
  summary: "List the backgrounds",
  description: "Each background's skill and tool proficiencies, languages, starting equipment and the feat it grants."
});
export const listContentFeats = publicCatalog({
  operationId: "listContentFeats",
  path: CONTENT_PATHS.feats,
  name: "ContentFeatsData",
  key: "feats",
  row: ContentFeatSummarySchema,
  summary: "List the feats",
  description:
    "Each feat's category and its prerequisite in words. The server decides whether a character meets a prerequisite."
});
export const listContentNames = publicCatalog({
  operationId: "listContentNames",
  path: CONTENT_PATHS.names,
  name: "ContentNamesData",
  key: "names",
  row: ContentNameBundleSchema,
  summary: "List the name pools",
  description:
    "Name pools by species for the builder's random generator. A pool's `kind` is an open slug and the order comes from the data, so a new pool adds no code."
});

export const CONTENT_ROUTES: readonly ApiRoute[] = [
  listContentMonsters,
  listContentMonsterBenchmarks,
  getContentMonster,
  getContentMonsterActions,
  listContentConditions,
  listContentGlossary,
  listContentSkills,
  listContentLanguages,
  listContentSpells,
  listContentEquipment,
  listContentClasses,
  listContentSubclasses,
  listContentSpecies,
  listContentBackgrounds,
  listContentFeats,
  listContentNames
];
