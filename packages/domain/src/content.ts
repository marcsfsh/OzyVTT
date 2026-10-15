import type { PickBudgetScaling } from "./pick-budget.js";

/** Compact browse row for bundled monster content; the server maps content definitions into this wire shape. */
export type ContentMonsterSummary = Readonly<{
  id: string;
  name: string;
  challengeRating: number;
  type: string;
  size: string;
  armorClass: number;
  hitPoints: number;
}>;
export type ContentMonstersResult = {
  ok: boolean;
  message?: string;
  monsters?: readonly ContentMonsterSummary[];
  attribution?: string;
};
/** SRD condition reference (name + rules text) for pickers and tooltips; public information for any joined session. */
export type ContentConditionSummary = Readonly<{ id: string; name: string; description: string }>;
export type ContentConditionsResult = {
  ok: boolean;
  message?: string;
  conditions?: readonly ContentConditionSummary[];
  /** The bundle's canonical CC BY 4.0 line (ADR-0015). */ attribution?: string;
};
/** SRD spell reference (rules text + the header fields a card shows) for the in-app spell rules window; public information for any joined session. */
export type ContentSpellSummary = Readonly<{
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  rangeText: string | null;
  componentsText: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  description: string;
  higherLevel: string | null;
  /** Whether casting it rolls an attack (the `fromPicks` predicate for Repelling Blast's "cantrip that requires an attack roll"). */
  attackRoll: boolean;
  /** Range in feet when the printed range is a distance, else null (Self and Touch are not zero). Read by the `ranged` predicate. */
  rangeFeet: number | null;
  /** Spell-list ids ("wizard", a homebrew list slug); the wizard's spell step matches `ContentClassSummary.spellcasting.spellListId`. */
  classes: readonly string[];
  /** Base damage/healing roll ("8d6"), or null for a spell that rolls nothing. Drives the sheet's "cast at" auto-roll. */
  damageRoll: string | null;
  /** Damage types for the base roll (empty for healing/none). */
  damageTypes: readonly string[];
  /** Per-slot-level upcast scaling parsed from the SRD (Fireball's 9d6 at 4th); the sheet applies the entry for the cast level. */
  castingOptions: ReadonlyArray<{ level: number; damageRoll: string | null; targetCount: number | null }>;
  /** A cantrip's character-level scaling (Fire Bolt's 2d10 at 5, Eldritch Blast's 2 beams); empty otherwise. */
  cantripScaling: ReadonlyArray<{ characterLevel: number; damageRoll: string | null; targetCount: number | null }>;
}>;
export type ContentSpellsResult = {
  ok: boolean;
  message?: string;
  spells?: readonly ContentSpellSummary[];
  /** The bundle's canonical CC BY 4.0 line (ADR-0015). */ attribution?: string;
};
/** One addable-equipment catalog row (SRD gear, weapons and armor in one shape). `category` is an open slug;
 * only "weapon", "armor" and "shield" drive AC and attack derivation, so group by the data, not a closed list.
 * `weapon` also carries browse-only `mastery`, which must not be copied onto an inventory row
 * (`ItemWeaponSchema` is strict); `inventoryWeaponFrom` does the conversion. */
export type ContentEquipmentSummary = Readonly<{
  id: string;
  name: string;
  category: string;
  costGp: number | null;
  weightLb: number | null;
  description: string | null;
  weapon: Readonly<{
    category: "simple" | "martial";
    damageDice: string;
    damageType: string;
    rangeFeet: number | null;
    longRangeFeet: number | null;
    mastery?: string;
    properties?: readonly string[];
  }> | null;
  armor: Readonly<{
    acBase: number;
    addDexModifier: boolean;
    dexModifierCap: number | null;
    stealthDisadvantage: boolean;
    strengthRequired: number | null;
  }> | null;
  appliesTo: Readonly<{ label: string; baseIds: readonly string[] }> | null;
}>;
export type ContentEquipmentResult = {
  ok: boolean;
  message?: string;
  equipment?: readonly ContentEquipmentSummary[];
  attribution?: string;
};

// ---------- Character-builder catalogs ----------
// Public SRD rules reference, readable by any joined session. Every response carries the CC BY 4.0
// `attribution` line the displaying surface must show (ADR-0015).

/** Where a catalog record came from. SRD and GM homebrew are merged server-side into one catalog. */
export type ContentSourceKind = "srd" | "homebrew";
/** One inline option of a feature's pick: its authored name and any second-order pick it owes (Divine Order's
 * "thaumaturge" grants an extra cantrip). Riders (actions, grants, modifiers, uses) stay server-side. */
export type ContentFeatureOptionSummary = Readonly<{
  id: string;
  name: string;
  description: string;
  /** The earlier pick that makes this option legal (Blessed Strikes), or null. The wizard filters like the server:
   * if gating leaves exactly as many options as picks, the answer is a consequence and no pick is shown. */
  requires: Readonly<{ offer: string; id: string }> | null;
  /** Every pick this option owes, in authored order. */
  choices: readonly ContentFeatureChoiceSummary[];
  extraPicks: readonly ContentExtraPickSummary[];
}>;
/** One budget a feature or option raises: "one extra Cleric cantrip" is `{offer: "class-cantrips", amount: 1}`.
 * `offer` is an offer key shared with the server, which rejects keys naming no real offer. */
export type ContentExtraPickSummary = Readonly<{
  offer: string;
  /** A flat number of extra picks; null when `scaling` states it instead. Exactly one of the two is set. */
  amount: number | null;
  /** A budget that follows a class-table column (Eldritch Invocations 1 → 10), resolved with `extraPickAmount`. */
  scaling: PickBudgetScaling | null;
}>;
export type ContentFeatureChoiceSummary = Readonly<{
  kind: string;
  choose: number;
  from: readonly string[];
  fromCatalog: string | null;
  /** Ceiling on a spell pick's level (Evocation Savant: level 2 and under; Magic Initiate: cantrips). Null = none. */
  maxSpellLevel: number | null;
  /** Floor on a spell pick's level (Mystic Arcanum: both 6 means exactly level 6). Null = none. */
  minSpellLevel: number | null;
  /** Options drawn from the character's own earlier picks; `offer` names the budget, `where` a predicate slug. */
  fromPicks: Readonly<{ offer: string; where: string | null }> | null;
  /** Inline options with their names and any nested pick. Empty when the options come from `fromCatalog` or are plain ids in `from`. */
  options: readonly ContentFeatureOptionSummary[];
}>;
/** A class/subclass/species/background/feat feature as browse-and-pick data. Riders stay server-side. */
export type ContentFeatureSummary = Readonly<{
  id: string;
  name: string;
  level: number | null;
  description: string;
  tags: readonly string[];
  /** Every pick this feature asks for, in authored order (Magic Initiate owes two cantrips and one level-1 spell). */
  choices: readonly ContentFeatureChoiceSummary[]; /** Every class level that grants this feature: the repeat count (server capacity is choose × grants).
   * Empty for features not granted by a class table (species traits, feats, subclass features). */
  grantedAtLevels: readonly number[];
  extraPicks: readonly ContentExtraPickSummary[];
}>;
/** One row of a class's printed 20-level table, display only. `null` means the class has no such column. */
export type ContentClassLevelRow = Readonly<{
  level: number;
  proficiencyBonus: number;
  spellSlots: readonly number[] | null;
  pactSlots: Readonly<{ level: number; slots: number }> | null;
  cantripsKnown: number | null;
  spellsKnown: number | null;
  preparedFormula: string | null;
  preparedCount: number | null;
  classResources: ReadonlyArray<{ id: string; name: string; amount: number | string }>;
}>;
/** A starting-equipment bundle with resolvable contents; `goldPieces` is the "or take N gp" alternative. */
export type ContentStartingEquipmentOption = Readonly<{
  id: string;
  label: string;
  items: ReadonlyArray<{ id: string; name: string; quantity: number }>;
  goldPieces: number;
}>;
/** A "choose N from this list" proficiency grant, exactly as authored (class tool choices, background skill/tool/language choices). */
export type ContentChoiceList = Readonly<{
  choose: number;
  from: readonly string[];
  /** An open catalog slug supplying options instead of or beside `from`, resolved by `resolveCatalogChoice`
   * ("two languages from the Standard Languages table"). Null when `from` names them outright. */
  fromCatalog: string | null;
}>;
/** A spellcasting header. `spellListId` pairs with `ContentSpellSummary.classes`. */
export type ContentSpellcastingSummary = Readonly<{
  ability: string;
  prepares: "known" | "prepared";
  ritual: boolean;
  focus: string | null;
  progression: "full" | "half" | "third" | "pact";
  spellListId: string | null;
}>;
/** One playable class. `hitDie` keys the multiclass hit-dice pool; `statPriority` drives the random generator. */
export type ContentClassSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  hitDie: string;
  statPriority: readonly string[];
  primaryAbilities: readonly string[];
  savingThrows: readonly string[];
  skillChoiceCount: number;
  skillChoices: readonly string[];
  /** Granted armor/weapon/tool training as open slugs ("light", "martial", "thieves-tools"). */
  armorProficiencies: readonly string[];
  weaponProficiencies: readonly string[];
  toolProficiencies: readonly string[];
  /** "Choose N tools" where the class offers one (Monk-style); null otherwise. */
  toolChoices: ContentChoiceList | null;
  /** Proficiencies gained when this class is taken as a multiclass (narrower than the level-1 set); null when none. */
  multiclassProficiencies: Readonly<{
    armor: readonly string[];
    weapons: readonly string[];
    tools: readonly string[];
    skillChoices: ContentChoiceList | null;
  }> | null;
  /** Ability minimums for multiclassing into this class; `mode: "any"` covers "STR 13 or DEX 13". Null = always allowed. Display only; the server re-validates. */
  multiclassPrerequisites: Readonly<{
    mode: "all" | "any";
    minimums: ReadonlyArray<Readonly<{ ability: string; minimum: number }>>;
  }> | null;
  subclassLevel: number;
  subclassLabel: string | null;
  asiLevels: readonly number[];
  spellcastingAbility: string | null;
  spellcastingProgression: "full" | "half" | "third" | "pact" | null;
  spellcasting: ContentSpellcastingSummary | null;
  levelTable: readonly ContentClassLevelRow[];
  startingEquipmentOptions: readonly ContentStartingEquipmentOption[];
  features: readonly ContentFeatureSummary[];
}>;
export type ContentClassesResult = {
  ok: boolean;
  message?: string;
  classes?: readonly ContentClassSummary[];
  attribution?: string;
};
/** One subclass, keyed to its parent `classId`. `subclassLevel` is null when it simply inherits the class's own subclass level. */
export type ContentSubclassSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  classId: string;
  summary: string | null;
  description: string | null;
  subclassLevel: number | null;
  spellcastingAbility: string | null;
  spellcastingProgression: "full" | "half" | "third" | "pact" | null;
  /** Third-caster subclasses (Eldritch Knight, Arcane Trickster) declare their own header, same shape as a class's; null otherwise. */
  spellcasting: ContentSpellcastingSummary | null;
  features: readonly ContentFeatureSummary[];
}>;
export type ContentSubclassesResult = {
  ok: boolean;
  message?: string;
  subclasses?: readonly ContentSubclassSummary[];
  attribution?: string;
};
/** One playable species. `sizes` is a list because several 2024 species let the player pick. SRD 5.2.1 puts ability increases on the background. */
export type ContentSpeciesSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  sizes: readonly string[];
  speedFeet: number;
  darkvisionFeet: number | null;
  creatureType: string;
  /** Fixed ability increases; empty for SRD 5.2.1 species, used by 2014-style or homebrew records. */
  abilityBonuses: ReadonlyArray<Readonly<{ ability: string; amount: number }>>;
  /** "Choose N abilities to raise by M" (the 2014 variant-human / half-elf pattern); null when the species has none. */
  abilityBonusChoice: Readonly<{ choose: number; amount: number; from: readonly string[] }> | null;
  languages: readonly string[];
  /** "Choose N languages" where the species offers one; null otherwise. */
  languageChoices: ContentChoiceList | null;
  lineages: ReadonlyArray<{ id: string; name: string; description: string | null }>;
  features: readonly ContentFeatureSummary[];
}>;
export type ContentSpeciesResult = {
  ok: boolean;
  message?: string;
  species?: readonly ContentSpeciesSummary[];
  attribution?: string;
};
/** One background: the ability-increase options and proficiencies it grants, its origin feat, and its starting-equipment choices (chosen option recorded in the character's `choices[]` ledger). */
export type ContentBackgroundSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  abilityOptions: Readonly<{ from: readonly string[]; spreads: ReadonlyArray<readonly number[]> }> | null;
  originFeatId: string | null;
  skillProficiencies: readonly string[];
  /** "Choose N skills/tools/languages" where the background offers one; null otherwise. Fixed grants stay in the flat lists beside these. */
  skillChoices: ContentChoiceList | null;
  toolProficiencies: readonly string[];
  toolChoices: ContentChoiceList | null;
  languages: readonly string[];
  languageChoices: ContentChoiceList | null;
  startingEquipmentOptions: readonly ContentStartingEquipmentOption[];
  features: readonly ContentFeatureSummary[];
}>;
export type ContentBackgroundsResult = {
  ok: boolean;
  message?: string;
  backgrounds?: readonly ContentBackgroundSummary[];
  attribution?: string;
};
/** One skill and the ability its check uses; `ability` is null only when the bundle row lacks it (the server fills the 18 SRD skills). */
export type ContentSkillSummary = Readonly<{ id: string; name: string; description: string; ability: string | null }>;
export type ContentSkillsResult = {
  ok: boolean;
  message?: string;
  skills?: readonly ContentSkillSummary[];
  attribution?: string;
};
/** One language and its SRD table ("standard" / "rare"); the base language budget draws from "standard". */
export type ContentLanguageSummary = Readonly<{ id: string; name: string; description: string; table: string }>;
export type ContentLanguagesResult = {
  ok: boolean;
  message?: string;
  languages?: readonly ContentLanguageSummary[];
  attribution?: string;
};
/** One feat (a feature plus catalog metadata). Prerequisites are display data; the server decides whether one is met. */
export type ContentFeatSummary = Readonly<{
  id: string;
  name: string;
  source: ContentSourceKind;
  summary: string | null;
  description: string | null;
  category: string;
  repeatable: boolean;
  prerequisiteLevel: number | null;
  prerequisiteAbilities: ReadonlyArray<{ ability: string; minimum: number }>;
  prerequisiteRequires: readonly string[];
  prerequisiteText: string | null;
  feature: ContentFeatureSummary;
}>;
export type ContentFeatsResult = {
  ok: boolean;
  message?: string;
  feats?: readonly ContentFeatSummary[];
  attribution?: string;
};
/** Name pools for one species, feeding the random generator. Pool `id` is an open slug; order comes from the data. */
export type ContentNameBundle = Readonly<{
  speciesId: string;
  source: ContentSourceKind;
  pools: ReadonlyArray<{ id: string; label: string; names: readonly string[] }>;
}>;
export type ContentNamesResult = {
  ok: boolean;
  message?: string;
  names?: readonly ContentNameBundle[];
  attribution?: string;
};
/** An area of effect parsed from a definition action's prose ("60-foot Cone", etc.); the GM places a matching template on the map. */
export type ContentActionArea = Readonly<{
  shape: "cone" | "line" | "sphere" | "cube" | "emanation";
  sizeFeet: number;
  widthFeet: number | null;
}>;
/** A definition action flattened for the GM's action runner. Structured fields only where the content has them; the ADR-0020 mechanics fields power availability hints (the server stays the authority). */
export type ContentActionSummary = Readonly<{
  id: string;
  name: string;
  activation: "action" | "bonus-action" | "reaction" | "other";
  description: string;
  attackBonus: number | null;
  reachFeet: number | null;
  rangeFeet: number | null;
  /** Normal range band for two-range weapons; shots beyond it (up to rangeFeet) roll at disadvantage. */ rangeNormalFeet:
    number | null;
  saveAbility: string | null;
  saveDc: number | null;
  damage: ReadonlyArray<{ formula: string; type: string }>;
  area: ContentActionArea | null;
  attackCount: number | null;
  usesLimit: number | null;
  usesPer: "turn" | "encounter" | "long-rest" | "short-rest" | "recharge" | null;
  /** d6 threshold for usesPer "recharge" ("Recharge 5-6" → 5); rolled automatically at the start of the owner's turn. */ usesRecharge:
    number | null;
  usesPool: string | null;
  requiresEffectTag: string | null;
  multiattack: ReadonlyArray<{ actionId: string; count: number }> | null;
  grants: boolean;
  reaction: Readonly<{ trigger: "hit-by-attack"; response: "half-damage" }> | null;
  /** SRD generic action rows (Dodge, Dash, Help, ...) appended after the stat block's own. */ builtin?: boolean;
  /** Builtin targeting: "single" picks one combatant, "none" is a direct tap. */ targeting?: "single" | "none";
  /** SRD Legendary Action cost against the creature's per-round pool (taken on other creatures' turns). */ legendaryCost?: number;
}>;
export type ContentActionsResult = {
  ok: boolean;
  message?: string;
  actions?: readonly ContentActionSummary[];
  /** The definition's legendary resources, when it has any (SRD 2024 legendary creatures). */ legendary?: Readonly<{
    actionsPerRound?: number;
    resistancesPerDay?: number;
  }>;
};
/** Full stat-block payload for the GM's sheet view; inert content data, GM-gated. */
export type ContentSheetResult = { ok: boolean; message?: string; definition?: import("@vtt/schemas").ActorDefinition };
