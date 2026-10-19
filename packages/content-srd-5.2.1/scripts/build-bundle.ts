/**
 * ETL: vendored open5e `srd-2024` Django fixtures -> curated, validated content bundles.
 *
 * Reads `sources/open5e-srd-2024/*.json`, joins Creature + CreatureAction + CreatureActionAttack +
 * CreatureTrait, adapts each stat block into a canonical `ActorDefinition` (ADR-0007: adapters map
 * external formats into the canonical shape; ADR-0008: structured core, inert text fallback), and
 * writes deterministic `bundles/*.json` bundles plus the required CC BY 4.0 attribution manifest.
 * Step 2 of `npm run content` (`build-content.ts`); output diffs are reviewable in git.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  ActorDefinitionSchema,
  AmmunitionKindSchema,
  DamageTypeSchema,
  SaveConditionSchema,
  type ActorAction,
  type ActorDefinition,
  type AmmunitionKind,
  type OngoingDamage,
  type SaveFailureDuration,
  type TraitMechanic
} from "@vtt/schemas";
import { experienceForChallenge } from "@vtt/rules-5e";
import {
  ArmorReferenceSchema,
  ConditionReferenceSchema,
  ContentAttributionSchema,
  RuleReferenceSchema,
  SpellReferenceSchema,
  WeaponPropertyReferenceSchema,
  WeaponReferenceSchema
} from "../src/index.js";
import { outDir, sourcePath } from "./paths.js";
import {
  failureDurationOf,
  heldByFromTraits,
  hitPointLossOf,
  SPELL_SAVE_OVERRIDE_IDS,
  spellSaveOutcomeFor,
  statBlockSaveOutcome,
  failureCompanionRidersOf,
  failureRestrictionsOf,
  withoutOngoingDamage
} from "./save-outcomes.js";
import { multiattackOfProse, withProseFacts } from "../src/action-prose.js";
import { unconsumedClauses } from "../src/action-clauses.js";
import { castingOptionsFor, makesSpellAttack, spellAreaFor, spellEffectFor } from "./spell-effects.js";
import { costlyMaterialsFor } from "./spell-materials.js";
import { spellSightFor } from "./spell-sight.js";
import { spellWallsFor } from "./spell-walls.js";
import { spellDeathFor, spellDeathSaveFor } from "./spell-death.js";
import { castingTimeText, SPELL_FIELD_CORRECTIONS } from "./spell-corrections.js";
import { UPCAST_DURATION_IDS, upcastDurationsFor } from "./spell-durations.js";
import { printedHitDamage, printedSaveDamage, withoutSourceTags } from "./monster-damage.js";
import { traitMechanicsOf } from "./trait-mechanics.js";
import { deathTraitMechanicsOf, monsterDeathFor } from "./death-traits.js";
import { withSpellcasting } from "../src/monster-spellcasting.js";
import { fixedFields, MONSTER_ACTION_FIXES } from "./monster-action-fixes.js";
import { formOnlyOf, lycanthropeCurseOf, shapeShiftOf } from "./monster-forms.js";
import { PRINTED_NAME_KEYS, printedName, statBlockActionText, statBlockTraitText } from "./monster-text.js";
import { lairCountsOf, STATBLOCK_SLUGS, statBlockHeaderOf } from "./monster-statblock.js";
import { HIT_NOTE_KEYS, withHitNotes } from "./monster-hit-notes.js";
import { swallowOf } from "./monster-swallow.js";
import { SEQUENCE_SLUGS, withSequences } from "./monster-sequences.js";
import { SUMMON_STAT_BLOCKS } from "./summon-stat-blocks.js";

const sourceDir = sourcePath("open5e-srd-2024");

type Fixture<T> = { model: string; pk: string; fields: T };
type CreatureFields = {
  name: string;
  size: string;
  type: string;
  alignment: string;
  document: string;
  ability_score_strength: number;
  ability_score_dexterity: number;
  ability_score_constitution: number;
  ability_score_intelligence: number;
  ability_score_wisdom: number;
  ability_score_charisma: number;
  armor_class: number;
  armor_detail: string;
  hit_points: number;
  hit_dice: string | null;
  initiative_bonus: number;
  challenge_rating: string;
  experience_points_integer: number | null;
  proficiency_bonus: number | null;
  passive_perception: number | null;
  walk: number | null;
  swim: number | null;
  fly: number | null;
  climb: number | null;
  burrow: number | null;
  hover: boolean;
  darkvision_range: number | null;
  blindsight_range: number | null;
  tremorsense_range: number | null;
  truesight_range: number | null;
  languages: readonly string[];
  languages_desc: string | null;
  telepathy_range: number | null;
  damage_vulnerabilities_display: string;
  damage_resistances_display: string;
  damage_immunities_display: string;
  condition_immunities_display: string;
  nonmagical_attack_immunity: boolean;
  nonmagical_attack_resistance: boolean;
  saving_throw_strength: number | null;
  saving_throw_dexterity: number | null;
  saving_throw_constitution: number | null;
  saving_throw_intelligence: number | null;
  saving_throw_wisdom: number | null;
  saving_throw_charisma: number | null;
  [key: string]: unknown;
};
type ActionFields = {
  parent: string;
  name: string;
  desc: string;
  action_type: "ACTION" | "BONUS_ACTION" | "REACTION" | "LEGENDARY_ACTION";
  order_in_statblock: number | null;
  uses_type: string | null;
  uses_param: number | null;
  legendary_action_cost: number | null;
  /** "Wolf or Hybrid Form Only", "Requires Soul Bag". */
  limited_to_form?: string | null;
};
type AttackFields = {
  parent: string;
  name: string;
  attack_type: string;
  to_hit_mod: number;
  reach: number | null;
  range: number | null;
  long_range: number | null;
  damage_die_count: number | null;
  damage_die_type: string | null;
  damage_bonus: number | null;
  damage_type: string | null;
  extra_damage_die_count: number | null;
  extra_damage_die_type: string | null;
  extra_damage_bonus: number | null;
  extra_damage_type: string | null;
};
type TraitFields = { parent: string; name: string; desc: string; type: string | null };
type ConditionFields = { describes: string; desc: string; document: string };
type DocumentFields = {
  name: string;
  display_name: string;
  author: string;
  publisher: string;
  licenses: readonly string[];
  permalink: string;
};
type SpellFields = {
  name: string;
  desc: string;
  level: number;
  school: string;
  document: string;
  casting_time: string;
  reaction_condition: string | null;
  range: number | null;
  range_unit: string | null;
  range_text: string | null;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  material_specified: string | null;
  material_cost: string | null;
  material_consumed: boolean;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  higher_level: string | null;
  attack_roll: boolean;
  damage_roll: string | null;
  damage_types: readonly string[];
  saving_throw_ability: string | null;
  target_type: string | null;
  target_count: number | null;
  shape_type: string | null;
  shape_size: number | null;
  shape_size_unit: string | null;
  classes: readonly string[];
};
type SpellOptionFields = {
  parent: string;
  type: string;
  damage_roll: string | null;
  target_count: number | null;
  range: number | null;
  duration: string | null;
  concentration: boolean | null;
  shape_size: number | null;
  desc: string | null;
};
type WeaponFields = {
  name: string;
  document: string;
  damage_dice: string;
  damage_type: string;
  is_simple: boolean;
  is_improvised: boolean;
  range: number;
  long_range: number;
  distance_unit: string | null;
};
type WeaponPropertyFields = { name: string; desc: string; type: string | null; document: string };
type ArmorFields = {
  name: string;
  document: string;
  ac_base: number;
  ac_add_dexmod: boolean;
  ac_cap_dexmod: number | null;
  grants_stealth_disadvantage: boolean;
  strength_score_required: number | null;
};
type DescribesFields = { describes: string; desc: string; document: string };
type RuleFields = {
  name: string;
  desc: string;
  index: number;
  ruleset: string;
  document: string;
  initialHeaderLevel: number | null;
};
type RuleSetFields = { name: string; desc: string; document: string };

const load = <T>(file: string): Fixture<T>[] => JSON.parse(readFileSync(join(sourceDir, file), "utf8")) as Fixture<T>[];

const creatures = load<CreatureFields>("Creature.json");
const actions = load<ActionFields>("CreatureAction.json");
const attacks = load<AttackFields>("CreatureActionAttack.json");
const traits = load<TraitFields>("CreatureTrait.json");
const conditions = load<ConditionFields>("ConditionDescription.json");
const documents = load<DocumentFields>("Document.json");
const spells = load<SpellFields>("Spell.json");
const spellOptions = load<SpellOptionFields>("SpellCastingOption.json");
const weapons = load<WeaponFields>("Weapon.json");
const weaponProperties = load<WeaponPropertyFields>("WeaponProperty.json");
const armors = load<ArmorFields>("Armor.json");
const skills = load<DescribesFields>("SkillDescription.json");
const damageTypes = load<DescribesFields>("DamageTypeDescription.json");
const rules = load<RuleFields>("Rule.json");
const ruleSets = load<RuleSetFields>("RuleSet.json");

const srdDocument = documents.find((doc) => doc.pk === "srd-2024");
if (!srdDocument || !srdDocument.fields.licenses.includes("cc-by-40"))
  throw new Error("Expected the srd-2024 document fixture with a cc-by-40 license.");

const actionsByCreature = new Map<string, Fixture<ActionFields>[]>();
for (const action of actions) {
  const list = actionsByCreature.get(action.fields.parent) ?? [];
  list.push(action);
  actionsByCreature.set(action.fields.parent, list);
}
const attackByAction = new Map<string, Fixture<AttackFields>>();
for (const attack of attacks) {
  if (attackByAction.has(attack.fields.parent))
    throw new Error(`Multiple attack rows for action ${attack.fields.parent}; the adapter assumes one.`);
  attackByAction.set(attack.fields.parent, attack);
}
const traitsByCreature = new Map<string, Fixture<TraitFields>[]>();
for (const trait of traits) {
  const list = traitsByCreature.get(trait.fields.parent) ?? [];
  list.push(trait);
  traitsByCreature.set(trait.fields.parent, list);
}

/** What a creature's trait says holds the creature its action restrains (the erinyes' Magic Rope). */
function heldByFromTraitsOf(creaturePk: string, description: string) {
  const held = heldByFromTraits(
    description,
    (traitsByCreature.get(creaturePk) ?? []).map((trait) => trait.fields.desc)
  );
  return held ? { heldBy: held } : {};
}

const slugOf = (pk: string) => pk.replace(/^srd-2024_/, "");
const idSafe = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "action";
const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder"
] as const;
const ABILITY_BY_NAME = {
  Strength: "str",
  Dexterity: "dex",
  Constitution: "con",
  Intelligence: "int",
  Wisdom: "wis",
  Charisma: "cha"
} as const;
const FOOTPRINT_BY_SIZE: Record<string, number> = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const SIZES = new Set(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
const DICE_PATTERN = /^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i;
// A reaction prints its save label in italics ("_Dexterity Saving Throw:_ DC 17").
const SAVE_PATTERN = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:_?\s*DC\s*(\d+)/;

/** CR 0-4 -> +2 and +1 per four CR after, as the 5e proficiency table has it. */
const proficiencyFromChallenge = (challenge: number) => Math.max(2, 2 + Math.floor((Math.ceil(challenge) - 1) / 4));

const formulaOf = (count: number, dieType: string, bonus: number | null): string => {
  const die = `${count}d${dieType.replace(/^D/i, "")}`;
  return bonus && bonus !== 0 ? `${die} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}` : die;
};

/** Primary damage type: `damage_type` when set; otherwise open5e stores it in `extra_damage_type` when no extra dice exist; last resort, read the "(NdX) <Type> damage" prose. */
const primaryDamageType = (attack: AttackFields, desc: string): string => {
  if (attack.damage_type) return attack.damage_type;
  if (attack.extra_damage_type && attack.extra_damage_die_count === null) return attack.extra_damage_type;
  const fromProse = desc.match(/\)\s+([A-Za-z]+) damage/);
  const candidate = fromProse?.[1]?.toLowerCase();
  return candidate && (DAMAGE_TYPES as readonly string[]).includes(candidate) ? candidate : "untyped";
};

/**
 * ADR-0020 structured mechanics, extracted only from the SRD 2024 statblock house style -
 * confident patterns only, everything else stays prose (fail-open per ADR-0008).
 */
/**
 * On-hit condition riders from the stock phrasing: "If the target is a Large or smaller creature,
 * it has the Grappled condition (escape DC 15). While Grappled, the target has the Restrained
 * condition." (or "...and it has the Restrained condition until the grapple ends"), "…it has the Prone
 * condition.", and an unconditional timed one: "...and the target has the Poisoned condition until the start of
 * the assassin's next turn." Only attack actions get riders (a save action's conditions flow through the
 * pending-save pipeline instead); a rider that depends on a charge or a drop to 0 HP stays prose.
 */
type OnHitRider = {
  conditions: Array<{ id: string }>;
  name?: string;
  escapeDc?: number;
  maxTargetSize?: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
  duration?: SaveFailureDuration;
  ongoingDamage?: OngoingDamage;
  insteadOfDamage?: true;
  tags?: string[];
  modifiers?: NonNullable<ActorAction["onHit"]>[number]["modifiers"];
  pull?: { feet: number; upTo?: true };
  self?: true;
  reminder?: string;
  hazard?: "burning";
  lowersScore?: { ability: "str" | "dex" | "con" | "int" | "wis" | "cha"; dice: string; killsAtZero?: true };
  armorPenalty?: true;
};
/** "takes 5 (2d4) Necrotic damage at the start of each of the stirge's turns" (the source's) or "... of its turns". */
function riderOngoingDamage(text: string): OngoingDamage | undefined {
  const match =
    /\btakes \d+ \((\d+d\d+(?: [+-] \d+)?)\) ([A-Z][a-z]+) damage at the start of each of (its|the [A-Za-z' -]+?(?:'s|s')) turns\b/.exec(
      text
    );
  const type = match ? DamageTypeSchema.safeParse(match[2]!.toLowerCase()) : null;
  if (!match || !type?.success) return undefined;
  return {
    damage: [{ formula: match[1]!, type: type.data }],
    at: match[3] === "its" ? "bearer-turn-start" : "source-turn-start"
  };
}
const RIDER_CONDITIONS: ReadonlySet<string> = new Set(SaveConditionSchema.options);
const riderConditionIds = (names: string): string[] =>
  names
    .split(/ and /)
    .map((name) => name.toLowerCase())
    .filter((id) => RIDER_CONDITIONS.has(id) && id !== "grappled");
const parseOnHitRiders = (desc: string): OnHitRider[] | null => {
  const size = desc.match(/If the target is a (Tiny|Small|Medium|Large|Huge) or smaller creature/i);
  const maxTargetSize = size ? (size[1].toLowerCase() as NonNullable<OnHitRider["maxTargetSize"]>) : undefined;
  const riders: OnHitRider[] = [];
  // "It has the Grappled condition (escape DC 15)", or a rug's "can give it the Grappled condition (escape DC 13) instead
  // of dealing damage", with what the grapple deals each turn while it lasts.
  const grapple = desc.match(/(?:has|give it) the Grappled condition \(escape DC (\d+)\)/i);
  if (grapple) {
    // What lasts exactly as long as the grapple rides the same effect, so escaping ends it too.
    const held = new Set<string>();
    if (/While Grappled, the target (?:also )?has the Restrained condition/i.test(desc)) held.add("restrained");
    for (const match of desc.matchAll(
      /\b(?:it|the target) has the ([A-Z][a-z]+(?: and [A-Z][a-z]+)?) conditions? until the grapple ends|\bUntil the grapple ends, the target has the ([A-Z][a-z]+(?: and [A-Z][a-z]+)?) conditions?/g
    ))
      for (const id of riderConditionIds(match[1] ?? match[2]!)) held.add(id);
    const conditions = [{ id: "grappled" }, ...[...held].slice(0, 2).map((id) => ({ id }))];
    const ongoingDamage = riderOngoingDamage(desc.slice(grapple.index ?? 0));
    riders.push({
      conditions,
      escapeDc: Number.parseInt(grapple[1], 10),
      ...(maxTargetSize ? { maxTargetSize } : {}),
      ...(ongoingDamage ? { ongoingDamage } : {}),
      ...(/\bGrappled condition \(escape DC \d+\) instead of dealing damage\b/.test(desc)
        ? { insteadOfDamage: true as const }
        : {})
    });
  } else if (/it has the Prone condition/i.test(desc)) {
    riders.push({ conditions: [{ id: "prone" }], ...(maxTargetSize ? { maxTargetSize } : {}) });
  } else if (/\battaches to (?:the target|it)\b/.test(desc)) {
    // "The stirge attaches to the target. While attached, ... the target takes 5 (2d4) Necrotic damage at the start of
    // each of the stirge's turns"; "While the cloaker is attached, the target has the Blinded condition". An attachment
    // with nothing the engine runs (the darkmantle's) stays prose.
    const blinded = /\bWhile (?:the [\w -]+? is )?attached, the target has the ([A-Z][a-z]+) condition\b/.exec(desc);
    const conditions = blinded ? riderConditionIds(blinded[1]!).map((id) => ({ id })) : [];
    const ongoingDamage = riderOngoingDamage(desc);
    // "The target or a creature within 5 feet of it can detach the stirge as an action."
    const detach = /\bThe target or a creature within 5 feet of it can detach the [a-z' -]+ as an action\b/.test(desc);
    if (conditions.length > 0 || ongoingDamage)
      riders.push({
        conditions,
        name: "Attached",
        ...(maxTargetSize ? { maxTargetSize } : {}),
        ...(ongoingDamage ? { ongoingDamage } : {}),
        ...(detach ? { endedBy: { name: "Detach", by: "either" as const } } : {})
      });
  }
  // An unconditional rider in the hit's own sentence (not one opening with "If"): timed, or with no end printed there
  // (an otyugh's Poisoned, which a later save ends), which lasts until ended.
  const hit = desc.slice(Math.max(0, desc.search(/\bHit:|Attack Roll:/)));
  for (const sentence of hit.split(/(?<=\.)\s+/)) {
    if (/^If\b/.test(sentence) || /Grappled/.test(sentence)) continue;
    const timed = sentence.match(
      /\bthe target has the ([A-Z][a-z]+(?: and [A-Z][a-z]+)?) conditions? (until the (?:start|end) of (?:its|the [A-Za-z' -]+?(?:'s|s')) next turn)/
    );
    const untimed = timed
      ? null
      : sentence.match(/\bdamage, and the target has the ([A-Z][a-z]+(?: and [A-Z][a-z]+)?) conditions?\.$/);
    const ids = riderConditionIds((timed ?? untimed)?.[1] ?? "");
    const duration = timed ? failureDurationOf(timed[2]) : undefined;
    if (ids.length > 0 && (duration || untimed) && riders.length < 2)
      riders.push({ conditions: ids.map((id) => ({ id })), ...(duration ? { duration } : {}) });
  }
  riders.push(...effectRiders(desc, maxTargetSize, riders));
  return riders.length > 0 ? riders.slice(0, 4) : null;
};

/**
 * The hit riders that leave more than conditions, from their stock phrasing: a pull toward the attacker, no healing
 * while a poison lasts, no Reactions, a Speed cut, Disadvantage on the target's next attack (the Sap mastery's
 * shape), Advantage on the next attack against it or on the attacker's own next one, and a curse the engine runs
 * only in part, whose rest is the GM's from the reminder. `riders` are the ones already read, which a no-healing
 * clause joins.
 */
function effectRiders(desc: string, maxTargetSize: OnHitRider["maxTargetSize"], riders: OnHitRider[]): OnHitRider[] {
  const found: OnHitRider[] = [];
  const sized = maxTargetSize ? { maxTargetSize } : {};
  // "the balor pulls the target up to 25 feet straight toward itself, and the target has the Prone condition".
  const pull =
    /\bpulls the target (up to )?(\d+) feet straight toward (?:itself|it)\b(, and the target has the Prone condition)?/.exec(
      desc
    );
  if (pull)
    found.push({
      conditions: pull[3] ? [{ id: "prone" }] : [],
      name: "Pulled",
      pull: { feet: Number(pull[2]), ...(pull[1] ? { upTo: true as const } : {}) },
      ...sized
    });
  // "Until this poison ends, the target can't regain Hit Points" or "While Poisoned, ...": on the poison's effect.
  if (/\b(?:Until this poison ends|While Poisoned), the target can[\u2019']t regain Hit Points\b/.test(desc)) {
    const poison = riders.find((rider) => rider.conditions.some((condition) => condition.id === "poisoned"));
    if (poison) poison.tags = [...(poison.tags ?? []), "no-healing"];
  }
  const noReactions =
    /\bthe target can[\u2019']t take Reactions (until the (?:start|end) of (?:its|the [A-Za-z' -]+?(?:'s|s')) next turn)/.exec(
      desc
    );
  const noReactionsFor = noReactions ? failureDurationOf(noReactions[1]) : undefined;
  if (noReactionsFor)
    found.push({ conditions: [], name: "No Reactions", tags: ["no-reactions"], duration: noReactionsFor });
  // An ice devil's spear: no Bonus Action or Reaction, 10 feet less Speed, and a move or one action, not both.
  const chill =
    /\bUntil the end of its next turn, the target can[\u2019']t take a Bonus Action or Reaction, its Speed decreases by (\d+) feet, and it can move or take one action on its turn, not both\b/.exec(
      desc
    );
  if (chill)
    found.push({
      conditions: [],
      name: "Chilled",
      tags: ["no-bonus-actions", "no-reactions", "dazed"],
      modifiers: [{ type: "speed", amount: -Number(chill[1]) }],
      duration: { type: "until-bearer-turn-end" }
    });
  const slowed = chill
    ? null
    : /\b(?:the target's|its) Speed decreases by (\d+) feet until the end of its next turn\b/.exec(desc);
  if (slowed)
    found.push({
      conditions: [],
      name: "Speed reduced",
      modifiers: [{ type: "speed", amount: -Number(slowed[1]) }],
      duration: { type: "until-bearer-turn-end" }
    });
  if (/\bhas Disadvantage on the next attack roll it makes before the end of its next turn\b/.test(desc))
    found.push({
      conditions: [],
      name: "Next attack at Disadvantage",
      tags: ["until-own-attack"],
      modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }],
      duration: { type: "until-bearer-turn-end" }
    });
  if (
    /\bthe next attack roll made against the target before the start of the [A-Za-z' -]+?'s next turn has Advantage\b/.test(
      desc
    )
  )
    found.push({
      conditions: [],
      name: "Next attack against it at Advantage",
      tags: ["until-attacked"],
      modifiers: [{ type: "roll-mode", roll: "incoming-attack", mode: "advantage" }],
      duration: { type: "until-source-next-turn" }
    });
  if (/\band the [A-Za-z -]+? has Advantage on the next attack roll it makes before the end of this turn\b/.test(desc))
    found.push({
      conditions: [],
      name: "Next attack at Advantage",
      self: true,
      tags: ["until-own-attack"],
      modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage" }],
      duration: { type: "until-source-turn-end" }
    });
  // "If the target is a creature or a flammable object, it starts burning" (a fire elemental's Burn): the object is the
  // GM's.
  if (
    /\bIf the target is a creature or a flammable object(?: that isn[\u2019']t being worn or carried)?, it starts burning\b/.test(
      desc
    )
  )
    found.push({ conditions: [], name: "Burning", hazard: "burning" });
  // "Until the grapple ends, the target has the Restrained condition and can't teleport" (a tarrasque's Bite).
  if (/\bUntil the grapple ends, the target has the [A-Z][a-z]+ condition and can[\u2019']t teleport\b/.test(desc)) {
    const grapple = riders.find((rider) => rider.conditions.some((condition) => condition.id === "grappled"));
    if (grapple) grapple.tags = [...(grapple.tags ?? []), "no-teleport"];
  }
  // "Ability checks made to escape this grapple have Disadvantage" (a mimic's Pseudopod): on the grapple's effect.
  if (/\bAbility checks made to escape this grapple have Disadvantage\b/.test(desc)) {
    const grapple = riders.find((rider) => rider.conditions.some((condition) => condition.id === "grappled"));
    if (grapple) grapple.tags = [...(grapple.tags ?? []), "escape-disadvantage"];
  }
  // A mummy's curse: no healing is the engine's; what it does at rests and over days, the GM's. Its death to dust is the
  // hit's own (`drain.killsAtZero`).
  const cursed = /\bit is cursed\. (While cursed, the target can[\u2019']t regain Hit Points[^.]*\.)/.exec(desc);
  if (cursed) found.push({ conditions: [], name: "Cursed", tags: ["no-healing"], reminder: cursed[1]! });
  // A curse that acts at rests the hit's reviewed fix runs (an incubus's); this reminder stands for one with none.
  const restCurse = /\bthe target is cursed for [^.]*\. Until the curse ends, [^.]*\./.exec(desc);
  if (restCurse) found.push({ conditions: [], reminder: restCurse[0]!.replace(/^the target/, "The target") });
  // "The target's Strength score decreases by 1d4. The target dies if this reduces that score to 0" (a shadow's
  // Draining Swipe).
  const drain =
    /\bthe target's (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score decreases by (\d+d\d+)\.( The target dies if this reduces that score to 0\.)?/.exec(
      desc
    );
  if (drain)
    found.push({
      conditions: [],
      name: `${drain[1]} drained`,
      lowersScore: {
        ability: ABILITY_BY_NAME[drain[1] as keyof typeof ABILITY_BY_NAME],
        dice: drain[2]!,
        ...(drain[3] ? { killsAtZero: true as const } : {})
      }
    });
  // "Nonmagical armor worn by the target takes a -1 penalty to the AC it offers. The armor is destroyed if the penalty
  // reduces its AC to 10. The penalty can be removed by casting the Mending spell on the armor" (an ooze's Pseudopod).
  if (
    /\bNonmagical armor worn by the target takes a -1 penalty to the AC it offers\. The armor is destroyed if the penalty reduces its AC to 10\. The penalty can be removed by casting the Mending spell on the armor\./.test(
      desc
    )
  )
    found.push({ conditions: [], name: "Armor corroded", armorPenalty: true });
  return found;
}

const SAVE_TARGET_CONDITIONS = ["Frightened", "Charmed", "Prone", "Grappled", "Restrained", "Incapacitated"];
const SAVE_TARGET_TYPES = ["Humanoid", "Beast", "Undead", "Fiend", "Giant", "Dragon", "Construct", "Elemental"];

/** "That isn't an Undead": the creature types an area's clause leaves out. */
const notTypesOf = (clause: string): string[] =>
  [...clause.matchAll(new RegExp(`\\bisn[\\u2019']t an? (${SAVE_TARGET_TYPES.join("|")})\\b`, "g"))].map((match) =>
    match[1]!.toLowerCase()
  );

/**
 * Who an area's save reaches among the creatures under it: "each enemy in a 20-foot-radius Sphere", "each creature that
 * isn't an Undead in a 20-foot Emanation", and "each creature in a 60-foot Cone that can see the ghost" (`sight.seenBy`).
 */
function areaSaveTargets(clause: string): Pick<ActorAction, "targets" | "sight"> {
  const notTypes = notTypesOf(clause);
  const targets: NonNullable<ActorAction["targets"]> = {
    ...(/^each enemy\b/.test(clause) ? { who: "enemies" as const } : {}),
    ...(notTypes.length > 0 ? { notCreatureTypes: notTypes } : {})
  };
  return {
    ...(Object.keys(targets).length > 0 ? { targets } : {}),
    ...(/\bthat can see the [a-z' -]+?\b(?: and\b|$)/.test(clause) ? { sight: { seenBy: "user" as const } } : {})
  };
}

/**
 * Who a save action may target, from the stock clause after its DC ("Strength Saving Throw: DC 15, one Large or smaller
 * creature Grappled by the behir"): one creature or each, its size, a condition it must have (or one it has from the
 * creature: "Charmed or Grappled by the aboleth"), its creature type, a range, "the X can see", "Grappled by the X" and
 * "in the X's space". An area's creatures come from its template, less those its clause leaves out (`areaSaveTargets`),
 * and a clause the reader doesn't know whole (willing, 0 Hit Points) stays the GM's.
 */
function withSaveTargets(desc: string): Pick<ActorAction, "targets" | "sight"> {
  // "Each creature whose space the centaur enters", "each creature whose space the cube enters for the first time
  // during this move": the creatures its move went through.
  if (/\bwhose space the [a-z' -]+? enters\b/i.test(desc)) return { targets: { entered: true } };
  const clause = /Saving Throw:_? DC \d+, ((?:one|each) [^.(]*)/.exec(desc)?.[1]?.trim();
  if (!clause) return {};
  if (/\bin an? \d+-foot\b/.test(clause)) return areaSaveTargets(clause);
  if (/\bdestination\b|\bwhose space\b|\bwilling\b|\bHit Points\b/.test(clause)) return {};
  const targets: NonNullable<ActorAction["targets"]> = {};
  // "One creature within 30 feet that is Charmed or Grappled by the aboleth".
  const held = new RegExp(
    `\\bthat is (${SAVE_TARGET_CONDITIONS.join("|")}) or (${SAVE_TARGET_CONDITIONS.join("|")}) by the\\b`
  ).exec(clause);
  if (held)
    targets.conditionsFromSource = [held[1]!, held[2]!].map(
      (name) => name.toLowerCase() as NonNullable<typeof targets.conditionsFromSource>[number]
    );
  if (/^one\b/.test(clause)) targets.count = 1;
  const size = /\b(Tiny|Small|Medium|Large|Huge) or smaller\b/.exec(clause);
  if (size) targets.maxSize = size[1]!.toLowerCase() as NonNullable<typeof targets.maxSize>;
  const lead = new RegExp(
    `^one (?:(?:Tiny|Small|Medium|Large|Huge) or smaller )?(${SAVE_TARGET_CONDITIONS.join("|")}) creature\\b`
  ).exec(clause);
  const has = new RegExp(`\\bthat has the (${SAVE_TARGET_CONDITIONS.join("|")}) condition\\b`).exec(clause);
  const condition = (lead ?? has)?.[1];
  if (condition) targets.conditions = [condition.toLowerCase() as NonNullable<typeof targets.conditions>[number]];
  const type = new RegExp(`^one (${SAVE_TARGET_TYPES.join("|")})\\b`).exec(clause);
  if (type) targets.creatureTypes = [type[1]!.toLowerCase()];
  const range = /\bwithin (\d+) feet\b/.exec(clause);
  if (range) targets.rangeFeet = Number(range[1]);
  if (/\b(?:the [a-z' -]+|it) can see\b/.test(clause)) targets.seen = true;
  if (/\bGrappled by the\b/.test(clause) && !held) targets.grappledBySource = true;
  if (/\bin the [a-z' -]+?'s space\b/.test(clause)) targets.inSpace = true;
  return Object.keys(targets).length > 0 ? { targets } : {};
}

/** Typed defense lists from the display strings: exact damage-type/condition-id tokens only; qualified phrases ("…from nonmagical attacks") stay display-only. */
const splitTypedList = (display: string, known: ReadonlySet<string>): string[] =>
  display
    .toLowerCase()
    .split(/[,;]|\band\b/)
    .map((token) => token.trim())
    .filter((token) => known.has(token));

/** A black pudding's and an ochre jelly's Split. */
const SPLIT: NonNullable<ActorAction["reaction"]> = {
  trigger: "damaged",
  response: "split",
  damageTypes: ["lightning", "slashing"],
  bloodied: true,
  sizes: ["large", "medium"],
  minHitPoints: 10
};

/** Protective Magic casts Shield (or Counterspell, which stays prose): +5 AC until the caster's next turn. */
const PROTECTIVE_MAGIC: Pick<ActorAction, "reaction"> = {
  reaction: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5, untilNextTurn: true }
};

/**
 * Reviewed per-action enrichments the prose states but no generic pattern captures. Keyed
 * "<creature slug>/<action id>"; values merge into the adapted action.
 * - giant-crocodile tail: "…can't be targeted by the crocodile's Tail" (stated on Bite).
 * - protective-magic: its Shield, offered when an attack would hit.
 * - burst-of-ingenuity: "The sphinx or another creature within 30 feet makes an ability check or a saving throw ...
 *   The sphinx adds 2 to the roll", an answer to the roll.
 * - reflexive-antennae: "An attack roll hits the rust monster ... The rust monster uses Antennae", offered when an
 *   attack roll from a creature within 5 feet hits it.
 * - deflect-missile: "hit by a ranged attack roll and takes Bludgeoning, Piercing, or Slashing damage from it ...
 *   reduces the damage it takes from the attack by 11 (1d10 + 6), and if that damage is reduced to 0, the giant can
 *   redirect some of the attack's force", the action's own save turned on a creature it picks.
 * - animate-trees: "animates up to two trees it can see within 60 feet of itself. Each tree uses the Treant stat
 *   block, except it has Intelligence and Charisma scores of 1, it can't speak, and it lacks this action ... The tree
 *   takes its turn immediately after the treant on the same Initiative count, and it obeys the treant. A tree remains
 *   animate for 1 day or until it dies, the treant dies, or it is more than 120 feet from the treant." Which trees stand
 *   where is the GM's: the two come where the GM points.
 */
/** A failed save that puts the target under the creature's command while its condition lasts (an aboleth's Dominate
 *  Mind: "the target acts as an ally to the aboleth and is under its control"): the `commanded` tag the server's
 *  summons settle reads. Keyed like `ACTION_ENRICHMENTS`. */
const COMMANDING_SAVES: Readonly<Record<string, { name: string; tags: string[]; modifiers: [] }>> = {
  "aboleth/dominate-mind": { name: "Dominated by the Aboleth", tags: ["commanded"], modifiers: [] }
};

const ACTION_ENRICHMENTS: Record<
  string,
  Partial<
    Pick<
      ActorAction,
      | "targetRules"
      | "targets"
      | "reaction"
      | "answer"
      | "sight"
      | "grants"
      | "healing"
      | "summons"
      | "endsUntilItActs"
      | "pull"
      | "holdsAtOnce"
      | "move"
      | "damage"
      | "area"
      | "inflicts"
      | "afterHurtingBloodied"
      | "largeFillsHold"
      | "teleport"
      | "object"
    >
  >
> = {
  // "The giant or one creature of its choice that can see or hear it gains 16 (2d10 + 5) Temporary Hit Points and has
  // Advantage on attack rolls until the start of the giant's next turn."
  "frost-giant/war-cry-recharge-5-6": {
    targets: { count: 1 },
    healing: { formula: "2d10 + 5", temporary: true },
    grants: {
      name: "War Cry",
      tags: ["war-cry"],
      target: "target",
      duration: { type: "until-source-next-turn" },
      modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage", when: [{ type: "on-attack-roll" }] }],
      onEnd: [],
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  // "The unicorn targets itself or one creature it can see within 60 feet of itself. The target gains 10 (3d6) Temporary
  // Hit Points, and its AC increases by 2 until the end of the unicorn's next turn."
  "unicorn/shimmering-shield": {
    targets: { count: 1, rangeFeet: 60, seen: true },
    healing: { formula: "3d6", temporary: true },
    grants: {
      name: "Shimmering Shield",
      tags: ["shimmering-shield"],
      target: "target",
      duration: { type: "until-source-turn-end" },
      armorClassBonus: 2,
      modifiers: [],
      onEnd: [],
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  // "The balor teleports itself or a willing demon within 10 feet of itself up to 60 feet to an unoccupied space the
  // balor can see."
  "balor/teleport": { teleport: { feet: 60, orAnother: true }, targets: { count: 1, rangeFeet: 10, typeTag: "demon" } },
  // "The spider teleports from the Material Plane to the Ethereal Plane or vice versa": its token stays on the map, on
  // the Border Ethereal over it (`ethereal.ts`).
  "phase-spider/ethereal-jaunt": {
    grants: {
      name: "Ethereal",
      tags: ["ethereal"],
      target: "self",
      toggles: true,
      duration: { type: "manual" },
      modifiers: [],
      onEnd: [],
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  // "The nightmare and up to three willing creatures within 5 feet of it teleport to the Ethereal Plane from the
  // Material Plane or vice versa."
  "nightmare/ethereal-stride": {
    targets: { count: 3, rangeFeet: 5, who: "allies" },
    grants: {
      name: "Ethereal",
      tags: ["ethereal"],
      target: "self-and-targets",
      toggles: true,
      duration: { type: "manual" },
      modifiers: [],
      onEnd: [],
      voidWhileIncapacitated: false,
      concentration: false
    }
  },
  // "The roper pulls each creature Grappled by it up to 30 feet straight toward it."
  "roper/reel": { targets: { grappledBySource: true }, pull: { feet: 30, upTo: true } },
  // "The ettercap pulls one creature within 30 feet of itself that is Restrained by its Web Strand up to 25 feet
  // straight toward itself."
  "ettercap/reel": {
    targets: { count: 1, rangeFeet: 30, heldByAction: "web-strand" },
    pull: { feet: 25, upTo: true }
  },
  // "The shambling mound can have only one creature Grappled by this action at a time."
  "shambling-mound/engulf": { holdsAtOnce: 1 },
  // Ooze Cube: "The cube can hold one Large creature or up to four Medium or Small creatures inside itself at a time."
  "gelatinous-cube/engulf": { holdsAtOnce: 4, largeFillsHold: true },
  // "The elemental can grapple one Large creature or up to two Medium or smaller creatures at a time with Whelm."
  "water-elemental/whelm": { holdsAtOnce: 2, largeFillsHold: true },
  // "The tarrasque moves up to its Speed. At the end of this movement, the tarrasque creates an instantaneous shock
  // wave in a 60-foot Emanation originating from itself. Creatures in that area lose Concentration and, if Medium or
  // smaller, have the Prone condition."
  "tarrasque/world-shaking-movement": {
    move: { speed: "full", provokes: true, first: true },
    inflicts: { conditions: ["prone"], maxTargetSize: "medium", breaksConcentration: true }
  },
  // "The lich teleports up to 60 feet to an unoccupied space it can see, and each creature within 10 feet of the space
  // it left takes 11 (2d10) Necrotic damage."
  "lich/deathly-teleport": {
    damage: [{ formula: "2d10", type: "necrotic" }],
    area: { shape: "emanation", sizeFeet: 10, widthFeet: null }
  },
  // "Immediately after dealing damage to a creature that is already Bloodied".
  "gnoll-warrior/rampage-1-day": { afterHurtingBloodied: true },
  "giant-hyena/rampage-1-day": { afterHurtingBloodied: true },
  // "One living creature the wisp can see within 5 feet that has 0 Hit Points", and Vanish "ends early immediately
  // after the wisp makes an attack roll or uses Consume Life".
  "will-o-wisp/consume-life": {
    targets: { count: 1, rangeFeet: 5, seen: true, notCreatureTypes: ["construct", "undead"], atZeroHitPoints: true },
    endsUntilItActs: true
  },
  "treant/animate-trees": {
    summons: {
      creatures: [
        {
          monsterId: "treant",
          count: 2,
          except: { name: "Animated Tree", abilityScores: { int: 1, cha: 1 }, withoutActions: ["animate-trees"] }
        }
      ],
      rangeFeet: 60,
      turn: "after-user",
      allegiance: "user",
      lasts: { type: "minutes", minutes: 1440 },
      endsOnUserDeath: true,
      leashFeet: 120
    }
  },
  "archmage/protective-magic": PROTECTIVE_MAGIC,
  // "The goblin chooses a Small or Medium ally within 5 feet of itself. The goblin and that ally swap places, and the
  // ally becomes the target of the attack instead."
  "goblin-boss/redirect-attack": {
    reaction: {
      trigger: "targeted-by-attack",
      response: "redirect-to-ally",
      rangeFeet: 5,
      allySizes: ["small", "medium"],
      swap: true
    }
  },
  // "An attack roll hits the wearer of the guardian's amulet while the wearer is within 5 feet of the guardian ... The
  // wearer gains a +5 bonus to AC, including against the triggering attack", until the guardian's next turn starts.
  "shield-guardian/protection": {
    reaction: { trigger: "ward-hit-by-attack", response: "ward-ac-bonus", amount: 5, rangeFeet: 5 }
  },
  "lich/protective-magic": PROTECTIVE_MAGIC,
  "mage/protective-magic": PROTECTIVE_MAGIC,
  "sphinx-of-wonder/burst-of-ingenuity": {
    answer: {
      rolls: ["check", "save", "death-save"],
      whose: "any",
      rangeFeet: 30,
      when: "any",
      effect: { kind: "add", amount: "2" }
    }
  },
  "rust-monster/reflexive-antennae": {
    reaction: { trigger: "hit-by-attack", response: "strike-back", rangeFeet: 5, usesAction: "antennae" }
  },
  // "The rust monster targets one nonmagical metal object (armor or a weapon) worn or carried by a creature within 5
  // feet of itself ... Failure: The object takes a -1 penalty to the AC it offers (armor) or to its attack rolls
  // (weapon)."
  "rust-monster/antennae": {
    targets: { count: 1, rangeFeet: 5 },
    object: { kinds: ["armor", "weapon"], metal: true, does: "penalty-on-failure" }
  },
  "stone-giant/deflect-missile": {
    reaction: {
      trigger: "hit-by-attack",
      response: "reduce-damage",
      formula: "1d10 + 6",
      damageTypes: ["bludgeoning", "piercing", "slashing"],
      attackKinds: ["ranged"],
      redirect: true
    }
  },
  // "A creature the devil can see starts its turn within 30 feet of the devil and can see the devil. Response: Wisdom
  // Saving Throw: DC 15, the triggering creature."
  "chain-devil/unnerving-gaze": {
    reaction: { trigger: "starts-turn-near", response: "strike-back", rangeFeet: 30, sight: "mutual" },
    targets: { count: 1, rangeFeet: 30, seen: true }
  },
  // "Another creature the nalfeshnee can see ends its move within 120 feet of the nalfeshnee. Response: The nalfeshnee
  // uses Teleport, but its destination space must be within 10 feet of the triggering creature."
  "nalfeshnee/nalfeshnee-pursuit": {
    reaction: {
      trigger: "ends-move-near",
      response: "teleport-near",
      rangeFeet: 120,
      usesAction: "teleport",
      nearFeet: 10
    }
  },
  // "While the pudding is Large or Medium and has 10+ Hit Points, it becomes Bloodied or is subjected to Lightning or
  // Slashing damage. Response: The pudding splits into two new Black Puddings."
  "black-pudding/black-pudding-split": { reaction: SPLIT },
  "ochre-jelly/split": { reaction: SPLIT },
  // "The mummy is hit by an attack roll. Response: The mummy adds 2 to its AC against the attack, possibly causing the
  // attack to miss, and the mummy teleports up to 60 feet to an unoccupied space it can see. Each creature of its
  // choice that it can see within 5 feet of its destination space has the Blinded condition until the end of the
  // mummy's next turn."
  "mummy-lord/whirlwind-of-sand": {
    reaction: { trigger: "hit-by-attack", response: "ac-bonus", amount: 2, anyHit: true },
    teleport: { feet: 60, landing: { conditions: ["blinded"], withinFeet: 5 } }
  },
  // "Magical darkness fills a 15-foot Emanation originating from the darkmantle. This effect lasts while the darkmantle
  // maintains Concentration on it, up to 10 minutes. Darkvision can't penetrate this area, and no light can
  // illuminate it."
  "darkmantle/darkness-aura": {
    grants: {
      name: "Darkness Aura",
      tags: ["darkness-aura"],
      target: "self",
      duration: { type: "rounds", rounds: 100 },
      modifiers: [],
      onEnd: [],
      voidWhileIncapacitated: false,
      concentration: true
    },
    sight: { area: { kind: "magical-darkness", aroundSelfFeet: 15 } }
  },
  // "The magmin sets itself ablaze or extinguishes its flames. While ablaze, the magmin sheds Bright Light in a 10-foot
  // radius and Dim Light for an additional 10 feet."
  "magmin/ignited-illumination": { sight: { light: { on: "caster", brightFeet: 10, dimFeet: 10 }, toggles: true } },
  // "A creature ends its turn within 5 feet of the octopus while underwater. Response: The octopus releases ink that
  // fills a 5-foot Cube centered on itself, and the octopus moves up to its Swim Speed. The Cube is Heavily Obscured
  // for 1 minute."
  "octopus/ink-cloud": {
    reaction: { trigger: "ends-turn-near", response: "use-on-self", rangeFeet: 5, underwater: true },
    sight: { area: { kind: "heavily-obscured" }, rounds: 10 }
  },
  // "Wisdom Saving Throw: DC 13, each creature in a 60-foot Cone that can see the ghost and isn't an Undead."
  "ghost/horrific-visage": { sight: { seenBy: "user" } },
  // "The octopus takes damage while underwater."
  "giant-octopus/ink-cloud": {
    reaction: { trigger: "damaged", response: "use-on-self", underwater: true },
    sight: { area: { kind: "heavily-obscured" }, rounds: 10 }
  },
  // "The wisp and its light have the Invisible condition until the wisp's Concentration ends on this effect, which ends
  // early immediately after the wisp makes an attack roll": Invisible, its Illumination out, until it attacks.
  "will-o-wisp/vanish": {
    grants: {
      name: "Vanish",
      tags: ["light-out", "until-it-acts"],
      target: "self",
      duration: { type: "manual" },
      conditions: ["invisible"],
      modifiers: [],
      onEnd: [],
      voidWhileIncapacitated: false,
      concentration: true
    }
  }
};

const PRINTED_NAME = "[A-Z][A-Za-z'\u2019-]*(?: [A-Z][A-Za-z'\u2019-]*)*";

/** "Plus 7 (2d6) damage of the type chosen for the Draconic Origin trait": a part whose type is the creature's pick
 *  (`TraitMechanic` "pick"), in place of any part the readers took for it. */
function withPickedDamage(actions: ActorAction[], mechanics: readonly TraitMechanic[]): ActorAction[] {
  return actions.map((action) => {
    const parts = [
      ...action.description.matchAll(
        /\b\d+ \((\d+d\d+(?: [+-] \d+)?)\) damage of the type chosen for the ([A-Z][A-Za-z' ]+?) trait\b/g
      )
    ].flatMap(([, formula, trait]) => {
      const pick = mechanics.find(
        (mechanic) => mechanic.kind === "pick" && mechanic.of === "damage-type" && mechanic.name === trait
      );
      return pick?.kind === "pick" ? [{ formula: formula!, type: pick.options?.[0] ?? "untyped", pick: pick.key }] : [];
    });
    if (parts.length === 0) return action;
    const kept = action.damage.filter((part) => !parts.some((picked) => picked.formula === part.formula));
    return { ...action, damage: [...kept, ...parts] };
  });
}

/** What a linked action takes from the action it makes or uses: its attack or save and what they deal and leave. */
function withActionOf(next: ActorAction, source: ActorAction): ActorAction {
  const { attack, save, damage, onHit, conditionalDamage, reminder, area, targetRules, targets } = source;
  return {
    ...next,
    ...(attack ? { attack } : {}),
    ...(save ? { save } : {}),
    damage,
    ...(onHit ? { onHit } : {}),
    ...(conditionalDamage ? { conditionalDamage } : {}),
    ...(reminder ? { reminder } : {}),
    ...(area && !next.area ? { area } : {}),
    ...(targetRules ? { targetRules } : {}),
    ...(targets && !next.targets ? { targets } : {})
  };
}

/** Whether an action deals or rolls anything of its own. */
const actsOnItsOwn = (action: ActorAction) => action.attack || action.save || action.damage.length > 0;

/**
 * What one action says about another, read across the stat block: a grapple that keeps an attack off its target
 * ("While Grappled, ... can't be targeted by the tyrannosaurus's Tail"), and a legendary action or a Bonus Action that
 * makes one attack or uses another action ("it makes one Rend attack", "The kraken uses Lightning Strike"), which
 * resolves as that action, so the swing spends the pool. One that makes one of two attacks ("one Claw or Tail
 * attack") prints inside it a choice for each, which the turn list offers (`partOf`).
 */
function linkedActions(actions: ActorAction[], idOf: (name: string) => string | undefined): ActorAction[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const keptOffGrappled = new Set<string>();
  for (const action of actions) {
    const match = new RegExp(
      `While Grappled\\b[^.]*can[\u2019']t be targeted by the [^.]*?[\u2019']s? (${PRINTED_NAME})\\.`
    ).exec(action.description);
    const id = match ? idOf(match[1]) : undefined;
    if (id) keptOffGrappled.add(id);
  }
  return actions.flatMap((action) => {
    let next = action;
    if (keptOffGrappled.has(next.id) && !next.targetRules?.includes("not-grappled-by-source"))
      next = { ...next, targetRules: [...(next.targetRules ?? []), "not-grappled-by-source"] };
    const links = (next.legendary || next.activation === "bonus-action") && !actsOnItsOwn(next);
    if (!links) return [next];
    const body = next.description.replace(/^Legendary Action[^.]*\.\s*/, "");
    // "The mummy makes one Rotting Fist or Channel Negative Energy attack": a choice for each attack.
    const choice = new RegExp(`\\bmakes one (${PRINTED_NAME}) or (${PRINTED_NAME}) attack\\b`).exec(body);
    const choices = choice
      ? [choice[1]!, choice[2]!].flatMap((name) => {
          const source = byId.get(idOf(name) ?? "");
          return source && actsOnItsOwn(source) ? [source] : [];
        })
      : [];
    if (choices.length === 2)
      return [
        next,
        ...choices.map((source) => ({
          ...withActionOf(next, source),
          id: `${next.id}-${source.id}`.slice(0, 120),
          name: `${next.name}: ${source.name}`.slice(0, 120),
          partOf: next.id
        }))
      ];
    const named =
      new RegExp(`\\bmakes one (${PRINTED_NAME}) attack\\b`).exec(body) ??
      (next.legendary ? new RegExp(`\\buses (${PRINTED_NAME})(?=[.,]| and\\b)`).exec(body) : null);
    const source = named ? byId.get(idOf(named[1]) ?? "") : undefined;
    return [source && actsOnItsOwn(source) ? withActionOf(next, source) : next];
  });
}

const usesSuffix = (action: ActionFields): string => {
  if (/\(Recharge /i.test(action.name)) return ""; // upstream already printed the recharge note in the name (basilisk, blink dog, cloaker)
  if (action.uses_type === "PER_DAY" && action.uses_param) return ` (${action.uses_param}/Day)`;
  if ((action.uses_type === "RECHARGE_ON_ROLL" || action.uses_type === "RECHARGE") && action.uses_param)
    return ` (Recharge ${action.uses_param}${action.uses_param < 6 ? "-6" : ""})`;
  if (action.uses_type === "RECHARGE") return " (Recharge after a Short or Long Rest)";
  return "";
};

/**
 * Limited-use pool from the upstream uses fields (ADR-0020): "Recharge X-Y" is a start-of-turn d6
 * pool, "Recharge after a Short or Long Rest" is short-rest, and "N/Day" is long-rest (the app treats
 * a Long Rest as a day). Upstream `RECHARGE` with a numeric param is a roll recharge.
 */
const usesOf = (
  action: ActionFields
): { limit: number; per: "recharge" | "short-rest" | "long-rest"; recharge?: number } | null => {
  if ((action.uses_type === "RECHARGE_ON_ROLL" || action.uses_type === "RECHARGE") && action.uses_param)
    return { limit: 1, per: "recharge", recharge: action.uses_param };
  if (action.uses_type === "RECHARGE") return { limit: 1, per: "short-rest" };
  if (action.uses_type === "PER_DAY" && action.uses_param) return { limit: action.uses_param, per: "long-rest" };
  return null;
};

/**
 * Fallback for attack actions with no CreatureActionAttack row upstream (mostly animals): parses the
 * 2024 statblock prose ("Melee Attack Roll: +2, reach 5 ft. 10 (2d6 + 3) Slashing damage..."). A flat
 * primary ("1 Piercing damage") keeps an empty list here; `printedHitDamage` reads the damage, fixed amounts and conditional variants included.
 */
type ProseAttack = {
  bonus: number;
  reachFeet: number | null;
  rangeFeet: number | null;
  rangeNormalFeet: number | null;
  damage: { formula: string; type: string }[];
};
const parseProseAttack = (desc: string): ProseAttack | null => {
  const roll = desc.match(/(?:Melee or Ranged|Melee|Ranged) Attack Roll:\s*([+-]\d+)(?:\s*\([^)]*\))?/);
  if (!roll) return null;
  const head = desc.slice(0, 200);
  const reach = head.match(/reach (\d+) (?:ft|feet)/);
  // "range 80/320 ft": 80 is the normal band (disadvantage beyond), 320 the maximum (SRD Range).
  const range = head.match(/range (\d+)(?:\/(\d+))? (?:ft|feet)/);
  const damage: { formula: string; type: string }[] = [];
  const primary = desc.match(/(?:(\d+)\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)|(\d+))\s+([A-Za-z]+) damage/);
  if (primary && primary[2]) {
    const type = primary[4].toLowerCase();
    if ((DAMAGE_TYPES as readonly string[]).includes(type)) {
      damage.push({ formula: primary[2].replace(/\s*([+-])\s*/, " $1 "), type });
      for (const extra of desc.matchAll(/plus\s+\d+\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s+([A-Za-z]+) damage/g)) {
        const extraType = extra[2].toLowerCase();
        if ((DAMAGE_TYPES as readonly string[]).includes(extraType))
          damage.push({ formula: extra[1].replace(/\s*([+-])\s*/, " $1 "), type: extraType });
      }
    }
  }
  const rangeNormal = range ? Number.parseInt(range[1], 10) : null;
  const rangeLong = range?.[2] ? Number.parseInt(range[2], 10) : null;
  return {
    bonus: Number.parseInt(roll[1], 10),
    reachFeet: reach ? Number.parseInt(reach[1], 10) : null,
    rangeFeet: rangeLong ?? rangeNormal,
    rangeNormalFeet: rangeLong ? rangeNormal : null,
    damage
  };
};

/**
 * Reviewed save actions the "Failure:" reader gets wrong, keyed `<creature>/<action>`; each says why. The engine
 * runs what is left of them and the GM the rest, from the reminder.
 */
const SAVE_ACTION_FIXES: Readonly<
  Record<string, Readonly<{ why: string; drop: "save" | "damage" | "outcome"; reminder: string }>>
> = {
  // Three roars in one action: only the first one's save is structured.
  "sphinx-of-valor/roar": {
    why: "the Second and Third Roars are later uses with their own saves",
    drop: "damage",
    reminder:
      "Roar runs its First Roar (Frightened for 1 minute). The Second Roar (Paralyzed) and Third Roar (Con save, 44 (8d10) Thunder damage and Prone, half on a success) are applied by hand."
  },
  // The save happens when the target finishes a Long Rest.
  "otyugh/bite": {
    why: "the Constitution save is made after a Long Rest",
    drop: "save",
    reminder:
      "The hit gives the target the Poisoned condition. Whenever the Poisoned target finishes a Long Rest, it makes a DC 15 Constitution save: on a failure its Hit Point maximum decreases by 5 (1d10); on a success the Poisoned condition ends."
  },
  // "If the target has 20 Hit Points or fewer..." is a branch the save prompt cannot take per target.
  "incubus/nightmare-recharge-6": {
    why: "the failure depends on the target's Hit Points",
    drop: "outcome",
    reminder:
      "On a failed save: a target with 20 Hit Points or fewer has the Unconscious condition for 1 hour (until it takes damage or is woken); any other target takes 18 (4d8) Psychic damage."
  }
};

/**
 * Fixtures open5e labels `srd-2024` that are not SRD 5.2.1 content. giant-fly appears only inside
 * the Figurine of Wondrous Power item and has no statblock.
 */
const EXCLUSIONS = new Set(["srd-2024_giant-fly"]);

/**
 * Creatures the SRD prints as Tiny but open5e stores as "small" (its srd-2024 fixtures carry
 * no tiny size at all). Footprints are unaffected (tiny and small are both one cell), but display
 * and size-based rules need the real value.
 */
const TINY_PER_SRD = [
  "badger",
  "bat",
  "cat",
  "crab",
  "flying-snake",
  "frog",
  "hawk",
  "homunculus",
  "imp",
  "lizard",
  "owl",
  "piranha",
  "pseudodragon",
  "quasit",
  "rat",
  "raven",
  "scorpion",
  "seahorse",
  "sphinx-of-wonder",
  "spider",
  "sprite",
  "stirge",
  "venomous-snake",
  "weasel",
  "will-o-wisp"
];

/**
 * Stat blocks the SRD prints as "Medium or Small" (the NPCs, vampires, mummies, lycanthropes, the wraith).
 * open5e keeps only "small", which made a Knight too small to grapple an Ogre; Medium is the printed
 * default, and the GM can still set Small per creature.
 */
const MEDIUM_OR_SMALL_PER_SRD = [
  "archmage",
  "assassin",
  "bandit",
  "bandit-captain",
  "berserker",
  "commoner",
  "cultist",
  "cultist-fanatic",
  "druid",
  "gladiator",
  "guard",
  "guard-captain",
  "knight",
  "mage",
  "mummy",
  "mummy-lord",
  "noble",
  "pirate",
  "pirate-captain",
  "priest",
  "priest-acolyte",
  "scout",
  "spy",
  "tough",
  "tough-boss",
  "vampire",
  "vampire-familiar",
  "vampire-spawn",
  "warrior-infantry",
  "warrior-veteran",
  "werebear",
  "wereboar",
  "wererat",
  "weretiger",
  "werewolf",
  "wraith"
];

/** Action names open5e got wrong. The Black Pudding's Split reaction is stored as "Parry". */
const ACTION_NAME_CORRECTIONS: Record<string, string> = { "srd-2024_black-pudding-split": "Split" };

/** The 18 skills as the app names them, keyed by open5e's `skill_bonus_*` suffix. */
const SKILL_FIELDS = [
  "acrobatics",
  "animal_handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight_of_hand",
  "stealth",
  "survival"
] as const;

/** A creature's printed skill bonuses, keyed by the app's skill ids ("sleight-of-hand"). */
function skillBonuses(fields: CreatureFields): Record<string, number> {
  const skills: Record<string, number> = {};
  for (const skill of SKILL_FIELDS) {
    const bonus = (fields as unknown as Record<string, unknown>)[`skill_bonus_${skill}`];
    if (typeof bonus === "number") skills[skill.replace(/_/g, "-")] = bonus;
  }
  return skills;
}

/**
 * Corrections for upstream fixture bugs, applied before adaptation so the vendored sources stay
 * byte-identical to open5e. Values are the printed SRD 5.2.1 ones.
 */
const CORRECTIONS: Record<string, Partial<CreatureFields>> = {
  // octopus: CON/CHA modifiers stored as scores; a garbage 30 in the CON save column
  // (the SRD table prints +0 there, i.e. no proficiency: open5e's convention is null).
  "srd-2024_octopus": { ability_score_constitution: 11, ability_score_charisma: 4, saving_throw_constitution: null },
  // mastiff / swarm-of-rats: the save *modifier* stored where the SRD-printed save bonus belongs.
  "srd-2024_mastiff": { saving_throw_wisdom: 3 },
  "srd-2024_swarm-of-rats": { saving_throw_dexterity: 2 },
  // vampire spawn: the SRD prints "Speed 30 ft., Climb 30 ft." (its Spider Climb climbs with it); open5e drops the
  // Climb Speed.
  "srd-2024_vampire-spawn": { climb: 30 },
  ...Object.fromEntries(TINY_PER_SRD.map((slug) => [`srd-2024_${slug}`, { size: "tiny" }])),
  ...Object.fromEntries(MEDIUM_OR_SMALL_PER_SRD.map((slug) => [`srd-2024_${slug}`, { size: "medium" }]))
};

/** Same idea for spells: reviewed against the SRD 5.2.1 spells chapter (`spell-corrections.ts`). */
const SPELL_CORRECTIONS: Readonly<Record<string, Partial<SpellFields>>> = SPELL_FIELD_CORRECTIONS;

for (const pk of [...Object.keys(CORRECTIONS), ...EXCLUSIONS]) {
  if (!creatures.some((creature) => creature.pk === pk))
    throw new Error(`Correction/exclusion targets unknown creature ${pk} - check for a typo or an upstream rename.`);
}
for (const slug of STATBLOCK_SLUGS)
  if (!creatures.some((creature) => creature.pk === `srd-2024_${slug}`))
    throw new Error(`A stat block header fact targets unknown creature ${slug} - check for a typo.`);
for (const [slug, name] of PRINTED_NAME_KEYS) {
  const named = (row: Fixture<{ parent: string; name: string }>) =>
    row.fields.parent === `srd-2024_${slug}` && row.fields.name.trim() === name;
  if (!actions.some(named) && !traits.some(named))
    throw new Error(`A printed name targets ${slug}'s ${name}, which it doesn't have - check for a typo.`);
}
for (const pk of Object.keys(SPELL_CORRECTIONS)) {
  if (!spells.some((spell) => spell.pk === pk))
    throw new Error(`Spell correction targets unknown spell ${pk} - check for a typo or an upstream rename.`);
}
for (const id of UPCAST_DURATION_IDS) {
  if (!spells.some((spell) => spell.pk === `srd-2024_${id}` && spell.fields.higher_level))
    throw new Error(
      `An upcast duration targets ${id}, which is not a spell with higher-level text - check for a typo.`
    );
}
for (const id of SPELL_SAVE_OVERRIDE_IDS) {
  if (!spells.some((spell) => spell.pk === `srd-2024_${id}` && spell.fields.saving_throw_ability))
    throw new Error(
      `Save override targets ${id}, which is not a spell with a save - check for a typo or an upstream rename.`
    );
}

const report = {
  monsters: 0,
  actionsTotal: 0,
  structuredAttacks: 0,
  proseAttacks: 0,
  structuredSaves: 0,
  saveDamage: 0,
  printedAttackDamage: 0,
  saveActionFixes: [] as string[],
  structuredMultiattacks: 0,
  proseMultiattacks: 0,
  onHitRiders: 0,
  rechargeUses: 0,
  restUses: 0,
  legendaryCreatures: 0,
  traitMechanics: 0,
  castingActions: 0,
  shapeShifts: 0,
  formOnlyActions: 0,
  typedDefenses: 0,
  corrections: [] as string[],
  untypedDamage: [] as string[],
  skipped: [] as string[]
};

const KNOWN_CONDITION_IDS = new Set(
  conditions
    .filter((condition) => condition.fields.document === "srd-2024")
    .map((condition) => condition.fields.describes)
);
const KNOWN_DAMAGE_TYPES = new Set<string>(DAMAGE_TYPES);
/** The SRD spells a stat block can cast, by the id the spell bundle gives them. */
const SRD_SPELL_IDS: ReadonlySet<string> = new Set(
  spells.filter((spell) => spell.fields.document === "srd-2024").map((spell) => slugOf(spell.pk))
);

/** The hit notes the build used, so one naming no action fails the build out loud. */
const notedHits = new Set<string>();
/** The reviewed fixes the build used, so one naming no action fails the build out loud. */
const fixedActions = new Set<string>();

const monsters: ActorDefinition[] = creatures
  .filter((creature) => creature.fields.document === "srd-2024" && !EXCLUSIONS.has(creature.pk))
  .sort((left, right) => left.pk.localeCompare(right.pk))
  .map((creature) => {
    const correction = CORRECTIONS[creature.pk];
    if (correction) report.corrections.push(creature.pk);
    const fields = { ...creature.fields, ...correction };
    const slug = slugOf(creature.pk);
    if (!SIZES.has(fields.size)) throw new Error(`${slug}: unexpected size ${fields.size}`);
    const challenge = Number.parseFloat(fields.challenge_rating);
    const footprint = FOOTPRINT_BY_SIZE[fields.size];
    const sortedActions = (actionsByCreature.get(creature.pk) ?? []).sort(
      (left, right) =>
        // An unnumbered action (some legendary ones) goes after the numbered stat block.
        (left.fields.order_in_statblock ?? Number.MAX_SAFE_INTEGER) -
          (right.fields.order_in_statblock ?? Number.MAX_SAFE_INTEGER) || left.pk.localeCompare(right.pk)
    );
    // Sibling action names -> ids (raw upstream names, before any uses suffix) for Multiattack composition.
    const siblingIdByName = new Map(
      sortedActions.map((sibling) => [
        sibling.fields.name.trim().toLowerCase(),
        idSafe(slugOf(sibling.pk).replace(`${slug}_`, ""))
      ])
    );
    // A printed name, matched with or without a parenthesised suffix ("Bite (Bat or Vampire Form Only)").
    const siblingIdOf = (name: string) => {
      const key = name.trim().toLowerCase();
      if (siblingIdByName.has(key)) return siblingIdByName.get(key);
      for (const [full, id] of siblingIdByName) if (full.replace(/\s*\([^)]*\)\s*$/, "") === key) return id;
      return undefined;
    };
    const creatureActions = sortedActions.map((action) => {
      const row = attackByAction.get(action.pk)?.fields;
      const prose = row ? null : parseProseAttack(action.fields.desc);
      const fix = SAVE_ACTION_FIXES[`${slug}/${idSafe(slugOf(action.pk).replace(`${slug}_`, ""))}`];
      if (fix) report.saveActionFixes.push(`${slug}: ${fix.why}`);
      // A lycanthrope's curse is a save its hit opens on a Humanoid, so the action keeps no save of its own.
      const curse = lycanthropeCurseOf(slug, fields.name, action.fields.desc);
      const save = fix?.drop === "save" || curse ? null : action.fields.desc.match(SAVE_PATTERN);
      const legendary = action.fields.action_type === "LEGENDARY_ACTION";
      const legendaryPrefix = legendary
        ? `Legendary Action${(action.fields.legendary_action_cost ?? 1) > 1 ? ` (costs ${action.fields.legendary_action_cost} actions)` : ""}. `
        : "";
      // The printed hit clause is the authority for an attack's damage, a fixed "1 Piercing damage" included; the
      // upstream row and the prose reader are the fallback when the text prints nothing typed.
      const printed = row || prose ? printedHitDamage(action.fields.desc) : null;
      if (printed) report.printedAttackDamage += 1;
      // A save rider on an attack deals its damage through the hit, but may still deal more on later turns.
      const saveDamage = save ? printedSaveDamage(action.fields.desc) : null;
      // A reviewed failure the engine can't apply keeps only what a success does.
      const saveOutcome = save
        ? fix?.drop === "outcome"
          ? { successDamage: statBlockSaveOutcome(action.fields.desc).successDamage, failureConditions: [] }
          : statBlockSaveOutcome(action.fields.desc)
        : null;
      // Hit points a failure takes each turn (an infernal wound) are the failure's own effect; stanching it is the GM's.
      const loss = save && fix?.drop !== "outcome" ? hitPointLossOf(action.fields.desc) : null;
      // A failure that restricts with no condition (Slowing Breath, Weakening Breath).
      const restriction =
        save && fix?.drop !== "outcome" ? failureRestrictionsOf(action.fields.desc, action.fields.name.trim()) : null;
      // What a failure's condition brings while it lasts (Fetid Cloud's no Reactions, Cacophony's Disadvantage).
      const companion =
        save && fix?.drop !== "outcome"
          ? failureCompanionRidersOf(
              action.fields.desc,
              printedName(slug, action.fields.name).replace(/\s*\([^)]*\)$/, "")
            )
          : null;
      // Later-turn damage the engine deals itself (`ongoingDamage`) leaves the GM's reminder.
      const laterDamage = saveDamage?.laterDamage ?? null;
      // "While Poisoned, the target can't regain Hit Points" (a pit fiend's Bite): the poison's own effect stops healing,
      // so the repeat save that ends one ends both.
      const poisonStopsHealing =
        !loss &&
        saveOutcome?.failureConditions.includes("poisoned") === true &&
        /\bWhile Poisoned, the target can[\u2019']t regain Hit Points\b/.test(action.fields.desc);
      const later =
        laterDamage !== null && saveOutcome && "ongoingDamage" in saveOutcome
          ? withoutOngoingDamage(laterDamage)
          : laterDamage;
      // What is left once the engine runs the no-healing and the repeat save is nothing to remind.
      const stale =
        poisonStopsHealing &&
        saveOutcome?.repeatSave === true &&
        later !== null &&
        /^While Poisoned, the target can[\u2019']t regain Hit Points, and it repeats the save at the end of each of its turns, ending the effect on itself on a success\.$/.test(
          later
        );
      // A failure that kills by the target's Hit Points is the engine's whole, with the damage for those above it.
      const fatal = monsterDeathFor(slug, idSafe(slugOf(action.pk).replace(`${slug}_`, "")));
      const reminder = fatal.damage
        ? undefined
        : (fix?.reminder ?? loss?.reminder ?? (stale ? null : later) ?? undefined);
      const fromRows = row
        ? [
            ...(row.damage_die_count && row.damage_die_type
              ? [
                  {
                    formula: formulaOf(row.damage_die_count, row.damage_die_type, row.damage_bonus),
                    type: primaryDamageType(row, action.fields.desc)
                  }
                ]
              : []),
            ...(row.extra_damage_die_count && row.extra_damage_die_type
              ? [
                  {
                    formula: formulaOf(row.extra_damage_die_count, row.extra_damage_die_type, row.extra_damage_bonus),
                    type: row.extra_damage_type ?? "untyped"
                  }
                ]
              : [])
          ]
        : // A save-for-damage action (Fire Breath) has no attack row; pull its damage from the
          // "Failure:" clause so answering a failed save actually applies it.
          (prose?.damage ?? (save ? (saveDamage?.damage ?? []) : []));
      const damage = fix?.drop === "outcome" || fix?.drop === "damage" ? [] : (printed?.damage ?? fromRows);
      // rangeFeet is the maximum attackable range; rangeNormalFeet the normal band when the
      // weapon has two ranges (disadvantage between them, per SRD Range).
      const attack = row
        ? {
            bonus: row.to_hit_mod,
            ...(row.reach !== null ? { reachFeet: row.reach } : {}),
            ...(row.range !== null ? { rangeFeet: row.long_range ?? row.range } : {}),
            ...(row.long_range !== null && row.range !== null ? { rangeNormalFeet: row.range } : {})
          }
        : prose
          ? {
              bonus: prose.bonus,
              ...(prose.reachFeet !== null ? { reachFeet: prose.reachFeet } : {}),
              ...(prose.rangeFeet !== null ? { rangeFeet: prose.rangeFeet } : {}),
              ...(prose.rangeNormalFeet !== null ? { rangeNormalFeet: prose.rangeNormalFeet } : {})
            }
          : null;
      const actionId = idSafe(slugOf(action.pk).replace(`${slug}_`, ""));
      // "(with Advantage if the target is Grappled by the ankheg)", "... doesn't have all its Hit Points)", "...
      // during the first round of each combat)".
      const advantage =
        /\(with Advantage (if the target is Grappled by the|if the target doesn[\u2019']t have all its Hit Points|during the first round of each combat)/.exec(
          action.fields.desc
        )?.[1];
      const advantageWhen = !advantage
        ? undefined
        : advantage.startsWith("if the target is Grappled")
          ? ("target-grappled-by-self" as const)
          : advantage.startsWith("during")
            ? ("first-round" as const)
            : ("target-hurt" as const);
      // ADR-0020 structured mechanics, all confident-pattern-only with prose fallback.
      // A Multiattack's plan, the plans it can be instead and what can replace its attacks, read from its text against
      // the stat block's other actions.
      const multiattack =
        !legendary && action.fields.action_type === "ACTION" && /multiattack/i.test(action.fields.name)
          ? multiattackOfProse(action.fields.desc, siblingIdOf)
          : null;
      const parsedOnHit = attack !== null && !save ? parseOnHitRiders(action.fields.desc) : null;
      const onHit = curse ? [...(parsedOnHit ?? []), curse] : parsedOnHit;
      const uses = usesOf(action.fields);
      const enrichment = ACTION_ENRICHMENTS[`${slug}/${actionId}`];
      const actionFix = MONSTER_ACTION_FIXES[`${slug}/${actionId}`];
      if (actionFix) fixedActions.add(`${slug}/${actionId}`);
      // A Shape-Shift's printed forms, and the forms an action works in ("Bite (Wolf or Hybrid Form Only)").
      const shapeShift = shapeShiftOf(slug, actionId);
      const formOnly = formOnlyOf(slug, action.fields.limited_to_form, action.fields.name);
      if (shapeShift) report.shapeShifts += 1;
      if (formOnly) report.formOnlyActions += 1;
      report.actionsTotal += 1;
      if (row) report.structuredAttacks += 1;
      if (prose) report.proseAttacks += 1;
      if (save) report.structuredSaves += 1;
      if (save && !row && !prose && damage.length > 0) report.saveDamage += 1;
      if (multiattack) report.structuredMultiattacks += 1;
      else if (/multiattack/i.test(action.fields.name)) report.proseMultiattacks += 1;
      if (onHit) report.onHitRiders += 1;
      if (uses?.per === "recharge") report.rechargeUses += 1;
      else if (uses) report.restUses += 1;
      for (const part of damage) if (part.type === "untyped") report.untypedDamage.push(action.pk);
      const built = withProseFacts({
        id: actionId,
        name: `${ACTION_NAME_CORRECTIONS[action.pk] ?? printedName(slug, action.fields.name)}${usesSuffix(action.fields)}`.slice(
          0,
          120
        ),
        activation:
          action.fields.action_type === "ACTION"
            ? ("action" as const)
            : action.fields.action_type === "BONUS_ACTION"
              ? ("bonus-action" as const)
              : action.fields.action_type === "REACTION"
                ? ("reaction" as const)
                : ("other" as const),
        description: withoutSourceTags(statBlockActionText(actionId, `${legendaryPrefix}${action.fields.desc}`)).slice(
          0,
          12000
        ),
        ...(attack ? { attack: { ...attack, ...(advantageWhen ? { advantageWhen } : {}) } } : {}),
        ...(save
          ? {
              save: {
                ability: ABILITY_BY_NAME[save[1] as keyof typeof ABILITY_BY_NAME],
                dc: Number.parseInt(save[2], 10),
                ...saveOutcome!,
                ...(saveOutcome?.heldBy === undefined && saveOutcome?.failureConditions.includes("restrained")
                  ? heldByFromTraitsOf(creature.pk, action.fields.desc)
                  : {}),
                ...(loss
                  ? {
                      failureEffect: loss.failureEffect,
                      ongoingDamage: loss.ongoingDamage,
                      ...(loss.endedBy ? { endedBy: loss.endedBy } : {}),
                      ...(loss.oneAtATime ? { sparesAffected: true as const } : {})
                    }
                  : {}),
                ...(poisonStopsHealing
                  ? { failureEffect: { name: "Poisoned", tags: ["no-healing"], modifiers: [] } }
                  : {}),
                ...(companion && !loss && !poisonStopsHealing
                  ? { failureEffect: { ...companion, tags: [...companion.tags], modifiers: [...companion.modifiers] } }
                  : {}),
                ...(COMMANDING_SAVES[`${slug}/${actionId}`]
                  ? { failureEffect: structuredClone(COMMANDING_SAVES[`${slug}/${actionId}`]!) }
                  : {}),
                ...(restriction
                  ? {
                      failureEffect: restriction.failureEffect,
                      ...(restriction.failureDuration ? { failureDuration: restriction.failureDuration } : {}),
                      ...(restriction.repeatSave ? { repeatSave: true as const } : {})
                    }
                  : {}),
                ...(fatal.failureByHitPoints ? { failureByHitPoints: fatal.failureByHitPoints } : {})
              }
            }
          : {}),
        damage: fatal.damage ?? damage,
        ...(printed && printed.conditionalDamage.length > 0 ? { conditionalDamage: printed.conditionalDamage } : {}),
        ...(reminder ? { reminder: reminder.slice(0, 600) } : {}),
        ...(multiattack ? { multiattack: multiattack.plan } : {}),
        ...(multiattack && multiattack.alternatives.length > 0
          ? {
              multiattackAlternatives: multiattack.alternatives,
              ...(multiattack.alternativesAfter ? { multiattackAlternativesAfter: multiattack.alternativesAfter } : {})
            }
          : {}),
        ...(multiattack && multiattack.replacements.length > 0
          ? { multiattackReplacements: multiattack.replacements }
          : {}),
        ...(onHit ? { onHit } : {}),
        ...(save && !attack ? withSaveTargets(action.fields.desc) : {}),
        ...(fatal.raisesCorpse
          ? { raisesCorpse: fatal.raisesCorpse, ...(fatal.targets ? { targets: fatal.targets } : {}) }
          : {}),
        ...(uses ? { uses } : {}),
        ...(legendary
          ? {
              legendary: {
                cost: action.fields.legendary_action_cost ?? 1,
                // "The dragon can't take this action again until the start of its next turn."
                ...(/can[\u2019']t take this action again until the start of its next turn/i.test(action.fields.desc)
                  ? { oncePerRound: true as const }
                  : {})
              }
            }
          : {}),
        ...(shapeShift ?? {}),
        ...(formOnly ? { formOnly } : {}),
        ...(enrichment ?? {}),
        ...fixedFields(actionFix)
      });
      // A reviewed fix may finish the save the reader read (how a creature is pulled out of a gelatinous cube).
      if (actionFix?.save && built.save) built.save = { ...built.save, ...structuredClone(actionFix.save) };
      if (actionFix?.reminder === null) delete built.reminder;
      // A Swallow: how many it holds and what holding them does; a save's failure swallows, and the engine runs the
      // swallowed creature's conditions, cover and acid, so the reminder that restated them goes.
      const swallowing = swallowOf(action.fields.name, action.fields.desc, siblingIdOf);
      if (swallowing) {
        built.swallow = swallowing.swallow;
        if (swallowing.targets) built.targets = swallowing.targets;
        if (built.save)
          built.save = {
            ...built.save,
            failureEffect: {
              name: "Swallowed",
              tags: ["swallowed", ...swallowing.tags],
              modifiers: []
            }
          };
        delete built.reminder;
      }
      return built;
    });
    // The spells its actions cast, each a cast action in play; only spells the SRD spell list holds.
    const actions = withSpellcasting(
      withSequences(slug, linkedActions(withHitNotes(slug, creatureActions, notedHits), siblingIdOf)),
      {
        abilityScores: {
          str: fields.ability_score_strength,
          dex: fields.ability_score_dexterity,
          con: fields.ability_score_constitution,
          int: fields.ability_score_intelligence,
          wis: fields.ability_score_wisdom,
          cha: fields.ability_score_charisma
        },
        proficiencyBonus: fields.proficiency_bonus ?? proficiencyFromChallenge(challenge)
      },
      (spellId) => SRD_SPELL_IDS.has(spellId)
    );
    report.castingActions += actions.filter((action) => action.castsSpells).length;
    const senses = [
      fields.darkvision_range ? `darkvision ${fields.darkvision_range} ft.` : null,
      fields.blindsight_range ? `blindsight ${fields.blindsight_range} ft.` : null,
      fields.tremorsense_range ? `tremorsense ${fields.tremorsense_range} ft.` : null,
      fields.truesight_range ? `truesight ${fields.truesight_range} ft.` : null
    ].filter((sense): sense is string => sense !== null);
    report.monsters += 1;
    // Typed defenses (ADR-0020): exact-token splits of the display strings drive automatic
    // resistance/immunity/vulnerability on typed damage. Qualified phrases stay display-only.
    const damageResistances = splitTypedList(fields.damage_resistances_display, KNOWN_DAMAGE_TYPES);
    const damageImmunities = splitTypedList(fields.damage_immunities_display, KNOWN_DAMAGE_TYPES);
    const damageVulnerabilities = splitTypedList(fields.damage_vulnerabilities_display, KNOWN_DAMAGE_TYPES);
    const conditionImmunities = splitTypedList(fields.condition_immunities_display, KNOWN_CONDITION_IDS);
    if (damageResistances.length > 0 || damageImmunities.length > 0 || damageVulnerabilities.length > 0)
      report.typedDefenses += 1;
    // Legendary resources (SRD 2024): every legendary SRD creature prints "Legendary Action Uses: 3", and Legendary
    // Resistance's N is in the trait's name. The counts in a lair come from the SRD text (`lairCountsOf`).
    const hasLegendaryActions = sortedActions.some((action) => action.fields.action_type === "LEGENDARY_ACTION");
    const resistanceTrait = (traitsByCreature.get(creature.pk) ?? [])
      .map((trait) => trait.fields.name.match(/^Legendary Resistance \((\d+)\/Day/))
      .find((match) => match !== null);
    const legendaryResource =
      hasLegendaryActions || resistanceTrait
        ? {
            ...(hasLegendaryActions ? { actionsPerRound: 3 } : {}),
            ...(resistanceTrait ? { resistancesPerDay: Number.parseInt(resistanceTrait[1], 10) } : {}),
            // "Legendary Action Uses: 3 (4 in Lair)" and "3/Day, or 4/Day in Lair": the counts in its lair.
            ...lairCountsOf(
              (traitsByCreature.get(creature.pk) ?? []).map((trait) => trait.fields.name),
              hasLegendaryActions ? 3 : undefined
            )
          }
        : null;
    if (legendaryResource) report.legendaryCreatures += 1;
    // Upstream order is the stat block's own.
    const traitTexts = (traitsByCreature.get(creature.pk) ?? []).map((trait) => ({
      name: printedName(slug, trait.fields.name),
      description: withoutSourceTags(statBlockTraitText(trait.fields.desc))
    }));
    const traitMechanics = [...traitMechanicsOf(traitTexts), ...deathTraitMechanicsOf(traitTexts, actions)];
    report.traitMechanics += traitMechanics.length;
    return {
      schemaId: "vtt.actor-monster" as const,
      schemaVersion: 1 as const,
      source: { name: "SRD 5.2.1", version: "5.2.1", externalId: slug },
      name: fields.name,
      summary:
        `${fields.size[0].toUpperCase()}${fields.size.slice(1)} ${fields.type}, ${fields.alignment} - CR ${challenge % 1 === 0 ? challenge : fields.challenge_rating.replace(/0+$/, "")}`.slice(
          0,
          280
        ),
      size: fields.size as ActorDefinition["size"],
      abilityScores: {
        str: fields.ability_score_strength,
        dex: fields.ability_score_dexterity,
        con: fields.ability_score_constitution,
        int: fields.ability_score_intelligence,
        wis: fields.ability_score_wisdom,
        cha: fields.ability_score_charisma
      },
      proficiencyBonus: fields.proficiency_bonus ?? proficiencyFromChallenge(challenge),
      armorClass: fields.armor_class,
      hitPoints: {
        maximum: fields.hit_points,
        ...(fields.hit_dice && DICE_PATTERN.test(fields.hit_dice) ? { formula: fields.hit_dice } : {})
      },
      initiativeBonus: fields.initiative_bonus,
      speedFeet: fields.walk ?? 0,
      actions: withPickedDamage(actions, traitMechanics),
      token: { disposition: "hostile" as const, footprint: { width: footprint, height: footprint } },
      ...(damageResistances.length > 0 ? { damageResistances } : {}),
      ...(damageImmunities.length > 0 ? { damageImmunities } : {}),
      ...(damageVulnerabilities.length > 0 ? { damageVulnerabilities } : {}),
      ...(conditionImmunities.length > 0 ? { conditionImmunities } : {}),
      ...(legendaryResource ? { legendary: legendaryResource } : {}),
      ...(traitMechanics.length > 0 ? { traitMechanics } : {}),
      extensions: {
        "open5e.srd-2024": {
          challengeRating: challenge,
          // Upstream carries XP for one creature only; the rest follow from the challenge rating.
          experiencePoints: fields.experience_points_integer ?? experienceForChallenge(challenge),
          skills: skillBonuses(fields),
          type: fields.type,
          // "Medium or Small", the tags after the type and a swarm's creatures, and an NPC's Gear, as printed.
          ...(MEDIUM_OR_SMALL_PER_SRD.includes(slug) ? { sizes: ["medium", "small"] } : {}),
          ...statBlockHeaderOf(slug),
          alignment: fields.alignment,
          armorDetail: fields.armor_detail || null,
          speeds: {
            walk: fields.walk,
            swim: fields.swim,
            fly: fields.fly,
            climb: fields.climb,
            burrow: fields.burrow,
            hover: fields.hover
          },
          senses,
          passivePerception: fields.passive_perception,
          languages: fields.languages_desc || fields.languages.join(", ") || null,
          savingThrows: {
            str: fields.saving_throw_strength,
            dex: fields.saving_throw_dexterity,
            con: fields.saving_throw_constitution,
            int: fields.saving_throw_intelligence,
            wis: fields.saving_throw_wisdom,
            cha: fields.saving_throw_charisma
          },
          damageVulnerabilities: fields.damage_vulnerabilities_display || null,
          damageResistances: fields.damage_resistances_display || null,
          damageImmunities: fields.damage_immunities_display || null,
          conditionImmunities: fields.condition_immunities_display || null,
          nonmagicalAttackImmunity: fields.nonmagical_attack_immunity,
          nonmagicalAttackResistance: fields.nonmagical_attack_resistance,
          traits: traitTexts
        }
      }
    };
  });

for (const slug of SEQUENCE_SLUGS)
  if (!monsters.some((monster) => monster.source.externalId === slug && monster.actions.some((a) => a.useNumber)))
    throw new Error(
      `A sequence names ${slug}, whose action it no longer finds - check for a typo or an upstream rename.`
    );
for (const key of HIT_NOTE_KEYS)
  if (!notedHits.has(key)) throw new Error(`A hit note names ${key}, which no stat block has - check for a typo.`);
for (const key of Object.keys(MONSTER_ACTION_FIXES))
  if (!fixedActions.has(key))
    throw new Error(`Monster action fix ${key} names no action - check for a typo or an upstream rename.`);

for (const monster of monsters) {
  const parsed = ActorDefinitionSchema.safeParse(monster);
  if (!parsed.success) {
    report.skipped.push(
      `${monster.source.externalId}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
    );
  }
}
if (report.skipped.length > 0) {
  console.error(`REFUSING TO WRITE - ${report.skipped.length} definitions failed validation:`);
  for (const line of report.skipped) console.error(`  - ${line}`);
  process.exit(1);
}

/**
 * The upstream condition texts carry PDF-extraction glitches, fixed here so the vendored source stays
 * byte-identical: a bullet with no space after its star, a word hyphenated across a line ("move- ment"), and
 * Unconscious's last bullet run into the one before it.
 */
const CONDITION_TEXT_FIXES: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  unconscious: [[" of you. Unaware. ", " of you. \n* Unaware. "]]
};
for (const id of Object.keys(CONDITION_TEXT_FIXES)) {
  if (!conditions.some((condition) => condition.fields.document === "srd-2024" && condition.fields.describes === id))
    throw new Error(`Condition text fix targets unknown condition ${id} - check for a typo or an upstream rename.`);
}
const conditionText = (id: string, text: string): string => {
  let fixed = text.replace(/\n\*(?=\S)/g, "\n* ").replace(/([a-z])- ([a-z])/g, "$1$2");
  for (const [from, to] of CONDITION_TEXT_FIXES[id] ?? []) {
    if (!fixed.includes(from)) throw new Error(`Condition text fix for ${id} no longer matches - review it.`);
    fixed = fixed.replace(from, to);
  }
  return fixed;
};

const conditionRecords = conditions
  .filter((condition) => condition.fields.document === "srd-2024")
  .sort((left, right) => left.pk.localeCompare(right.pk))
  .map((condition) => ({
    id: condition.fields.describes,
    name: condition.fields.describes
      .split("-")
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join(" "),
    description: conditionText(condition.fields.describes, condition.fields.desc)
  }));

/** Printed English title case: interior particles stay lowercase ("sleight-of-hand" -> "Sleight of Hand"). */
const TITLE_CASE_PARTICLES = new Set(["of", "the", "and", "or", "a", "an", "to", "in", "on"]);
const titleCase = (slug: string) =>
  slug
    .split("-")
    .map((part, index) =>
      index > 0 && TITLE_CASE_PARTICLES.has(part) ? part : `${part[0].toUpperCase()}${part.slice(1)}`
    )
    .join(" ");
const abilityShort: Record<string, "str" | "dex" | "con" | "int" | "wis" | "cha"> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha"
};
const onlySrd = <T extends { document: string }>(rows: Fixture<T>[]) =>
  rows.filter((row) => row.fields.document === "srd-2024").sort((left, right) => left.pk.localeCompare(right.pk));

const spellOptionsBySpell = new Map<string, Fixture<SpellOptionFields>[]>();
for (const option of spellOptions) {
  const list = spellOptionsBySpell.get(option.fields.parent) ?? [];
  list.push(option);
  spellOptionsBySpell.set(option.fields.parent, list);
}

/** The reviewed higher-slot durations, on the spells that have them. */
const withUpcastDurations = (id: string) => {
  const rows = upcastDurationsFor(id);
  return rows ? { upcastDurations: rows } : {};
};

const spellRecords = onlySrd(spells).map((spell) => {
  const correction = SPELL_CORRECTIONS[spell.pk];
  if (correction) report.corrections.push(spell.pk);
  const fields = { ...spell.fields, ...correction };
  if (fields.saving_throw_ability && !abilityShort[fields.saving_throw_ability])
    throw new Error(`${spell.pk}: unexpected save ability ${fields.saving_throw_ability}`);
  const effect = {
    ...spellEffectFor(slugOf(spell.pk), fields.desc, fields.damage_roll || null, fields.damage_types, {
      distance: fields.range,
      unit: fields.range_unit,
      text: fields.range_text || null
    }),
    ...spellDeathFor(slugOf(spell.pk))
  };
  return {
    id: slugOf(spell.pk),
    name: fields.name,
    level: fields.level,
    school: fields.school,
    castingTime: castingTimeText(fields.casting_time),
    reactionCondition: fields.reaction_condition || null,
    range: { distance: fields.range, unit: fields.range_unit, text: fields.range_text || null },
    components: {
      verbal: fields.verbal,
      somatic: fields.somatic,
      material: fields.material,
      materialText: fields.material_specified || null,
      materialConsumed: fields.material_consumed,
      ...(costlyMaterialsFor(slugOf(spell.pk)) ? { costly: costlyMaterialsFor(slugOf(spell.pk)) } : {})
    },
    duration: fields.duration,
    concentration: fields.concentration,
    ...withUpcastDurations(slugOf(spell.pk)),
    ritual: fields.ritual,
    attackRoll: makesSpellAttack(fields.desc, effect),
    damage: { roll: fields.damage_roll || null, types: [...fields.damage_types] },
    save: fields.saving_throw_ability
      ? {
          ability: abilityShort[fields.saving_throw_ability],
          ...spellSaveOutcomeFor(slugOf(spell.pk), fields.desc),
          ...spellDeathSaveFor(slugOf(spell.pk))
        }
      : null,
    target: { type: fields.target_type, count: fields.target_count },
    shape: fields.shape_type
      ? { type: fields.shape_type, size: fields.shape_size, unit: fields.shape_size_unit }
      : null,
    area: spellAreaFor(slugOf(spell.pk), fields.desc),
    effect,
    ...(spellSightFor(slugOf(spell.pk)) ? { sight: spellSightFor(slugOf(spell.pk)) } : {}),
    ...(spellWallsFor(slugOf(spell.pk)) ? { walls: spellWallsFor(slugOf(spell.pk)) } : {}),
    classes: fields.classes.map(slugOf).sort(),
    description: fields.desc,
    higherLevel: fields.higher_level || null,
    castingOptions: castingOptionsFor(
      slugOf(spell.pk),
      (spellOptionsBySpell.get(spell.pk) ?? []).map((option) => ({
        type: option.fields.type,
        damageRoll: option.fields.damage_roll || null,
        targetCount: option.fields.target_count,
        description: option.fields.desc || null
      }))
    )
  };
});

const weaponPropertyRecords = onlySrd(weaponProperties).map((property) => ({
  id: slugOf(property.pk),
  name: property.fields.name,
  kind: property.fields.type === "Mastery" ? ("mastery" as const) : ("property" as const),
  description: property.fields.desc
}));

/**
 * The Weapons table's Properties and Mastery columns, joined from the markdown SRD because the open5e
 * fixtures do not link weapons to properties. Both are optional on the schema, so the join fails
 * the build, so neither is dropped silently.
 *
 * A property cell's parenthetical is dropped from the slug (`Versatile (1d10)` -> `versatile`), since riders
 * match the bare word; the Versatile die is kept as `versatileDice`.
 */
const weaponTableSource = readFileSync(sourcePath("dnd-5e-srd-markdown", "equipment.md"), "utf8");
const stripTags = (value: string) =>
  value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .trim();
const tableSlug = (value: string) =>
  stripTags(value)
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** `Ammunition (Range 150/600; Arrow)` -> "arrow". The table prints "Bullet" for both a Sling's and a firearm's,
 *  which the Ammunition table sells as two items, so the Sling's is told apart by name. */
function ammunitionKindOf(weaponId: string, properties: string): AmmunitionKind | null {
  const printed = /Ammunition \([^;)]*;\s*([A-Za-z]+)\)/.exec(properties)?.[1]?.toLowerCase();
  if (printed === undefined) return null;
  if (printed === "bullet") return weaponId === "sling" ? "sling-bullet" : "firearm-bullet";
  const kind = AmmunitionKindSchema.safeParse(printed);
  if (!kind.success) throw new Error(`Weapons table: "${weaponId}" fires "${printed}", which no ammunition sells.`);
  return kind.data;
}

/** A price cell ("15 GP", "5 SP", "2 CP") in gold pieces; the build fails on any other. */
function tableCostGp(cell: string | undefined, where: string): number {
  const price = /^([\d,]+) (GP|SP|CP)$/.exec(stripTags(cell ?? ""));
  if (!price) throw new Error(`${where} has no price the build can read: "${stripTags(cell ?? "")}".`);
  const amount = Number(price[1]!.replace(/,/g, ""));
  return price[2] === "GP" ? amount : price[2] === "SP" ? amount / 10 : amount / 100;
}

const weaponTable = (() => {
  const table = weaponTableSource.match(/\*\*Weapons\*\*\s*(<table>[\s\S]*?<\/table>)/);
  if (!table) throw new Error("No **Weapons** table in sources/dnd-5e-srd-markdown/equipment.md.");
  const rows = new Map<
    string,
    {
      properties: readonly string[];
      mastery: string;
      melee: boolean;
      versatileDice: string | null;
      ammunition: AmmunitionKind | null;
      costGp: number;
    }
  >();
  // The `<th colspan="6">` band rows ("Simple Melee Weapons", ...) are the only source of melee vs
  // ranged: a thrown Dagger has a range and is melee, a Dart is not. Unknown bands, or data rows before
  // any band, fail the build.
  let band: { melee: boolean } | null = null;
  for (const [, row] of (table[1].match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const heading = row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
    if (heading) {
      const label = stripTags(heading[1]);
      const match = label.match(/^(?:Simple|Martial) (Melee|Ranged) Weapons$/);
      if (!match) throw new Error(`Weapons table: unrecognised band heading "${label}".`);
      band = { melee: match[1] === "Melee" };
      continue;
    }
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]);
    if (cells.length === 0) continue;
    if (cells.length !== 6)
      throw new Error(`Weapons table row has ${cells.length} cells, expected 6: ${stripTags(row)}`);
    if (band === null) throw new Error(`Weapons table: data row before any category band: ${stripTags(row)}`);
    const properties = stripTags(cells[2]);
    rows.set(tableSlug(cells[0]), {
      properties:
        properties === "" || properties === "\u2014" || properties === "-"
          ? []
          : properties
              .split(",")
              .map((entry) => tableSlug(entry.replace(/\(.*/, "")))
              .filter((entry) => entry !== ""),
      mastery: tableSlug(cells[3]),
      melee: band.melee,
      versatileDice: /Versatile \((\d+d\d+)\)/.exec(properties)?.[1] ?? null,
      ammunition: ammunitionKindOf(tableSlug(cells[0]), properties),
      costGp: tableCostGp(cells[5], `Weapons table: "${stripTags(cells[0])}"`)
    });
  }
  // Both vocabularies come from the fixtures' `WeaponProperty` rows, as bare ids (riders match the bare word).
  const bareIds = (kind: "property" | "mastery") =>
    new Set(
      weaponPropertyRecords
        .filter((property) => property.kind === kind)
        .map((property) => property.id.replace(/-(wp|mastery)$/, ""))
    );
  const knownProperties = bareIds("property");
  const knownMasteries = bareIds("mastery");
  for (const [id, row] of rows) {
    if (!knownMasteries.has(row.mastery))
      throw new Error(
        `Weapons table: "${id}" has mastery "${row.mastery}", not one of the ${knownMasteries.size} the SRD publishes.`
      );
    for (const property of row.properties) {
      if (!knownProperties.has(property))
        throw new Error(
          `Weapons table: "${id}" has property "${property}", not one of the ${knownProperties.size} the SRD publishes.`
        );
    }
  }
  return rows;
})();

const weaponRecords = onlySrd(weapons).map((weapon) => {
  const id = slugOf(weapon.pk);
  const row = weaponTable.get(id);
  // Fail closed, so no weapon is emitted with inert mastery and empty properties.
  if (!row)
    throw new Error(
      `No SRD Weapons-table row for "${id}" - check the name slug in sources/dnd-5e-srd-markdown/equipment.md.`
    );
  return {
    id,
    name: weapon.fields.name,
    category: weapon.fields.is_simple ? ("simple" as const) : ("martial" as const),
    // Needed to resolve "Weapon (Any Melee Weapon)" eligibility, and whether a thrown weapon has a melee reach.
    melee: row.melee,
    ...(row.versatileDice !== null ? { versatileDice: row.versatileDice } : {}),
    ...(row.ammunition !== null ? { ammunition: row.ammunition } : {}),
    improvised: weapon.fields.is_improvised,
    // The table's price, which crafting reads (SRD Crafting Nonmagical Items).
    costGp: row.costGp,
    mastery: row.mastery,
    // `[]` when the table prints an em dash: a Mace has no properties, which differs from "not recorded".
    properties: row.properties,
    damage: { dice: weapon.fields.damage_dice, type: weapon.fields.damage_type },
    // range 0 means a melee weapon.
    rangeFeet: weapon.fields.range || null,
    longRangeFeet: weapon.fields.long_range || null
  };
});
// The join must be total in both directions: an unmatched table row is a name that drifted.
const unmatched = [...weaponTable.keys()].filter((id) => !weaponRecords.some((weapon) => weapon.id === id));
if (unmatched.length > 0) throw new Error(`Weapons table rows matched no open5e weapon: ${unmatched.join(", ")}.`);

/**
 * The Armor table's category bands, parsed like the Weapons table's. Needed to resolve "Armor (Any
 * Medium or Heavy, Except Hide Armor)" eligibility. Fails closed on an unknown band.
 */
const armorTable = (() => {
  const table = weaponTableSource.match(/\*\*Armor\*\*\s*(<table>[\s\S]*?<\/table>)/);
  if (!table) throw new Error("No **Armor** table in sources/dnd-5e-srd-markdown/equipment.md.");
  const categories = new Map<string, Readonly<{ band: "light" | "medium" | "heavy" | "shield"; costGp: number }>>();
  let band: "light" | "medium" | "heavy" | "shield" | null = null;
  for (const [, row] of (table[1].match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const heading = row.match(/<th[^>]*>([\s\S]*?)<\/th>/);
    if (heading) {
      const label = stripTags(heading[1]);
      const match = label.match(/^(Light|Medium|Heavy) Armor\b|^(Shield)\b/);
      if (!match) throw new Error(`Armor table: unrecognised band heading "${label}".`);
      band = match[2] ? "shield" : (match[1]!.toLowerCase() as "light" | "medium" | "heavy");
      continue;
    }
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]);
    if (cells.length === 0) continue;
    if (band === null) throw new Error(`Armor table: data row before any category band: ${stripTags(row)}`);
    categories.set(tableSlug(cells[0]), {
      band,
      costGp: tableCostGp(cells[5], `Armor table: "${stripTags(cells[0])}"`)
    });
  }
  return categories;
})();

const armorRecords = onlySrd(armors).map((armor) => {
  const id = slugOf(armor.pk);
  const row = armorTable.get(id);
  if (!row)
    throw new Error(
      `No SRD Armor-table row for "${id}" - check the name slug in sources/dnd-5e-srd-markdown/equipment.md.`
    );
  return {
    id,
    name: armor.fields.name,
    acBase: armor.fields.ac_base,
    category: row.band,
    // The table's price, which crafting reads (SRD Crafting Nonmagical Items).
    costGp: row.costGp,
    addDexModifier: armor.fields.ac_add_dexmod,
    dexModifierCap: armor.fields.ac_cap_dexmod,
    stealthDisadvantage: armor.fields.grants_stealth_disadvantage,
    strengthRequired: armor.fields.strength_score_required
  };
});
// Total in both directions, like the weapons join above.
const unmatchedArmor = [...armorTable.keys()].filter((id) => !armorRecords.some((armor) => armor.id === id));
if (unmatchedArmor.length > 0)
  throw new Error(`Armor table rows matched no open5e armor: ${unmatchedArmor.join(", ")}.`);

const describesRecords = (rows: Fixture<DescribesFields>[]) =>
  onlySrd(rows).map((row) => ({
    id: row.fields.describes,
    name: titleCase(row.fields.describes),
    description: row.fields.desc
  }));
// The SRD skills table's governing ability, which the open5e fixtures do not carry.
const SKILL_ABILITY: Readonly<Record<string, string>> = {
  acrobatics: "dex",
  "animal-handling": "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  "sleight-of-hand": "dex",
  stealth: "dex",
  survival: "wis"
};
const skillRecords = describesRecords(skills).map(({ id, name, description }) => {
  const ability = SKILL_ABILITY[id];
  // Fail closed, so no skill is emitted that the character sheet cannot resolve an ability for.
  if (!ability) throw new Error(`No SRD ability column for skill "${id}" - add it to SKILL_ABILITY.`);
  // Key order matches the committed bundle so a rebuild is a no-op diff.
  return { id, name, ability, description };
});
const damageTypeRecords = describesRecords(damageTypes);

const ruleSetNames = new Map(onlySrd(ruleSets).map((set) => [set.pk, set.fields.name]));
// Ids count within each ruleset: upstream repeats an index ("exploration-3" was both Hiding and
// Interacting with Objects).
const ruleCounts = new Map<string, number>();
const ruleRecords = onlySrd(rules)
  .sort(
    (left, right) => left.fields.ruleset.localeCompare(right.fields.ruleset) || left.fields.index - right.fields.index
  )
  .map((rule) => ({
    id: `${slugOf(rule.fields.ruleset)}-${ruleCounts.set(rule.fields.ruleset, (ruleCounts.get(rule.fields.ruleset) ?? 0) + 1).get(rule.fields.ruleset)}`,
    name: rule.fields.name,
    ruleset: ruleSetNames.get(rule.fields.ruleset) ?? slugOf(rule.fields.ruleset),
    order: rule.fields.index,
    description: rule.fields.desc
  }));

const attribution = {
  license: "CC-BY-4.0",
  attribution:
    "This work includes material from the System Reference Document 5.2.1 (\u201cSRD 5.2.1\u201d) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.",
  source: {
    name: srdDocument.fields.name,
    author: srdDocument.fields.author,
    publisher: srdDocument.fields.publisher,
    permalink: srdDocument.fields.permalink,
    vendoredFrom: "https://github.com/open5e/open5e-api (data/v2/wizards-of-the-coast/srd-2024, staging branch)",
    retrieved: "2026-07-17"
  },
  // The open5e fixtures carry no character-builder data, so those bundles draw on this transcription.
  // See sources/dnd-5e-srd-markdown/PROVENANCE.json.
  additionalSources: [
    {
      name: "dnd-5e-srd-markdown",
      vendoredFrom: "https://github.com/downfallx/dnd-5e-srd-markdown",
      commit: "1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4",
      retrieved: "2026-07-27",
      covers: "classes, subclasses, class spell lists, species, backgrounds, feats, magic items"
    }
  ]
};

// Fail closed on every bundle, monsters and the rest: nothing is written unless everything validates.
const validateBundle = (label: string, schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error(`REFUSING TO WRITE - ${label} failed validation:`);
    for (const issue of parsed.error.issues.slice(0, 10))
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
};
validateBundle("summoned stat blocks", z.array(ActorDefinitionSchema), SUMMON_STAT_BLOCKS);
validateBundle("conditions", z.array(ConditionReferenceSchema), conditionRecords);
validateBundle("spells", z.array(SpellReferenceSchema), spellRecords);
validateBundle("weapons", z.array(WeaponReferenceSchema), weaponRecords);
validateBundle("weapon properties", z.array(WeaponPropertyReferenceSchema), weaponPropertyRecords);
validateBundle("armor", z.array(ArmorReferenceSchema), armorRecords);
validateBundle("skills", z.array(ConditionReferenceSchema), skillRecords);
validateBundle("damage types", z.array(ConditionReferenceSchema), damageTypeRecords);
validateBundle("rules", z.array(RuleReferenceSchema), ruleRecords);
validateBundle("attribution", ContentAttributionSchema, attribution);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "monsters.v1.json"), `${JSON.stringify(monsters, null, 1)}\n`);
// The stat blocks SRD 5.2.1 prints inside its summoning spells, which the source leaves out: kept apart from the
// bestiary, since they have no Challenge Rating and come onto the map only through their spells.
writeFileSync(join(outDir, "summons.v1.json"), `${JSON.stringify(SUMMON_STAT_BLOCKS, null, 1)}\n`);
writeFileSync(join(outDir, "conditions.v1.json"), `${JSON.stringify(conditionRecords, null, 1)}\n`);
writeFileSync(join(outDir, "spells.v1.json"), `${JSON.stringify(spellRecords, null, 1)}\n`);
writeFileSync(join(outDir, "weapons.v1.json"), `${JSON.stringify(weaponRecords, null, 1)}\n`);
writeFileSync(join(outDir, "weapon-properties.v1.json"), `${JSON.stringify(weaponPropertyRecords, null, 1)}\n`);
writeFileSync(join(outDir, "armor.v1.json"), `${JSON.stringify(armorRecords, null, 1)}\n`);
writeFileSync(join(outDir, "skills.v1.json"), `${JSON.stringify(skillRecords, null, 1)}\n`);
writeFileSync(join(outDir, "damage-types.v1.json"), `${JSON.stringify(damageTypeRecords, null, 1)}\n`);
writeFileSync(join(outDir, "rules.v1.json"), `${JSON.stringify(ruleRecords, null, 1)}\n`);
writeFileSync(join(outDir, "attribution.json"), `${JSON.stringify(attribution, null, 2)}\n`);

console.log(`monsters: ${report.monsters} (all valid; excluded: ${[...EXCLUSIONS].map(slugOf).join(", ") || "none"})`);
console.log(
  `actions: ${report.actionsTotal} - structured attacks ${report.structuredAttacks} (+${report.proseAttacks} prose-parsed), structured saves ${report.structuredSaves}`
);
console.log(
  `rules mechanics (ADR-0020): multiattacks ${report.structuredMultiattacks} structured / ${report.proseMultiattacks} prose-only, on-hit riders ${report.onHitRiders}, save-for-damage actions ${report.saveDamage}, monsters with typed defenses ${report.typedDefenses}`
);
console.log(
  `limited uses: ${report.rechargeUses} recharge pools, ${report.restUses} rest-scoped pools | legendary creatures: ${report.legendaryCreatures} | traits the engine runs: ${report.traitMechanics} | actions that cast spells: ${report.castingActions}`
);
console.log(
  `conditions: ${conditionRecords.length} | spells: ${spellRecords.length} | weapons: ${weaponRecords.length} (+${weaponPropertyRecords.length} properties) | armor: ${armorRecords.length}`
);
console.log(
  `skills: ${skillRecords.length} | damage types: ${damageTypeRecords.length} | rules: ${ruleRecords.length}`
);
if (report.corrections.length > 0)
  console.log(
    `upstream corrections applied (${report.corrections.length}): ${report.corrections.map(slugOf).join(", ")}`
  );
console.log(`attack damage read from the printed hit clause: ${report.printedAttackDamage}`);
if (report.saveActionFixes.length > 0)
  console.log(`reviewed save actions (${report.saveActionFixes.length}): ${report.saveActionFixes.join("; ")}`);
if (report.untypedDamage.length > 0)
  console.log(`untyped damage fallbacks (${report.untypedDamage.length}): ${report.untypedDamage.join(", ")}`);
// Printed clauses no reader or reviewed fix turned into data: the GM's, from the action's reminder where it has one.
const unconsumed = monsters.flatMap((monster) =>
  monster.actions.flatMap((action) => {
    const clauses = unconsumedClauses(action);
    return clauses.length > 0
      ? [`${monster.source.externalId}/${action.id} (${clauses.join(", ")}${action.reminder ? ", reminded" : ""})`]
      : [];
  })
);
if (unconsumed.length > 0) console.log(`printed clauses left unread (${unconsumed.length}): ${unconsumed.join("; ")}`);
