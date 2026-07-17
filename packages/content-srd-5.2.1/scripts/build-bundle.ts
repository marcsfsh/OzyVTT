/**
 * One-time ETL: vendored open5e `srd-2024` Django fixtures -> curated, validated content bundles.
 *
 * Reads `sources/open5e-srd-2024/*.json`, joins Creature + CreatureAction + CreatureActionAttack +
 * CreatureTrait, adapts each stat block into a canonical `ActorDefinition` (ADR-0007: adapters map
 * external formats into the canonical shape; ADR-0008: structured core, inert text fallback), and
 * writes deterministic `bundles/*.json` bundles plus the required CC BY 4.0 attribution manifest.
 * Run with `npm run build-bundle -w @vtt/content-srd-5.2.1`; output diffs are reviewable in git.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import {
  ArmorReferenceSchema, ConditionReferenceSchema, ContentAttributionSchema, RuleReferenceSchema,
  SpellReferenceSchema, WeaponPropertyReferenceSchema, WeaponReferenceSchema
} from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDir = join(root, "sources", "open5e-srd-2024");
const outDir = join(root, "bundles");

type Fixture<T> = { model: string; pk: string; fields: T };
type CreatureFields = {
  name: string; size: string; type: string; alignment: string; document: string;
  ability_score_strength: number; ability_score_dexterity: number; ability_score_constitution: number;
  ability_score_intelligence: number; ability_score_wisdom: number; ability_score_charisma: number;
  armor_class: number; armor_detail: string; hit_points: number; hit_dice: string | null;
  initiative_bonus: number; challenge_rating: string; experience_points_integer: number | null;
  proficiency_bonus: number | null; passive_perception: number | null;
  walk: number | null; swim: number | null; fly: number | null; climb: number | null; burrow: number | null; hover: boolean;
  darkvision_range: number | null; blindsight_range: number | null; tremorsense_range: number | null; truesight_range: number | null;
  languages: readonly string[]; languages_desc: string | null; telepathy_range: number | null;
  damage_vulnerabilities_display: string; damage_resistances_display: string; damage_immunities_display: string;
  condition_immunities_display: string; nonmagical_attack_immunity: boolean; nonmagical_attack_resistance: boolean;
  saving_throw_strength: number | null; saving_throw_dexterity: number | null; saving_throw_constitution: number | null;
  saving_throw_intelligence: number | null; saving_throw_wisdom: number | null; saving_throw_charisma: number | null;
  [key: string]: unknown;
};
type ActionFields = {
  parent: string; name: string; desc: string; action_type: "ACTION" | "BONUS_ACTION" | "REACTION" | "LEGENDARY_ACTION";
  order_in_statblock: number | null; uses_type: string | null; uses_param: number | null; legendary_action_cost: number | null;
};
type AttackFields = {
  parent: string; name: string; attack_type: string; to_hit_mod: number; reach: number | null; range: number | null; long_range: number | null;
  damage_die_count: number | null; damage_die_type: string | null; damage_bonus: number | null; damage_type: string | null;
  extra_damage_die_count: number | null; extra_damage_die_type: string | null; extra_damage_bonus: number | null; extra_damage_type: string | null;
};
type TraitFields = { parent: string; name: string; desc: string; type: string | null };
type ConditionFields = { describes: string; desc: string; document: string };
type DocumentFields = { name: string; display_name: string; author: string; publisher: string; licenses: readonly string[]; permalink: string };
type SpellFields = {
  name: string; desc: string; level: number; school: string; document: string;
  casting_time: string; reaction_condition: string | null; range: number | null; range_unit: string | null; range_text: string | null;
  verbal: boolean; somatic: boolean; material: boolean; material_specified: string | null; material_cost: string | null; material_consumed: boolean;
  duration: string; concentration: boolean; ritual: boolean; higher_level: string | null;
  attack_roll: boolean; damage_roll: string | null; damage_types: readonly string[]; saving_throw_ability: string | null;
  target_type: string | null; target_count: number | null; shape_type: string | null; shape_size: number | null; shape_size_unit: string | null;
  classes: readonly string[];
};
type SpellOptionFields = { parent: string; type: string; damage_roll: string | null; target_count: number | null; range: number | null; duration: string | null; concentration: boolean | null; shape_size: number | null; desc: string | null };
type WeaponFields = { name: string; document: string; damage_dice: string; damage_type: string; is_simple: boolean; is_improvised: boolean; range: number; long_range: number; distance_unit: string | null };
type WeaponPropertyFields = { name: string; desc: string; type: string | null; document: string };
type ArmorFields = { name: string; document: string; ac_base: number; ac_add_dexmod: boolean; ac_cap_dexmod: number | null; grants_stealth_disadvantage: boolean; strength_score_required: number | null };
type DescribesFields = { describes: string; desc: string; document: string };
type RuleFields = { name: string; desc: string; index: number; ruleset: string; document: string; initialHeaderLevel: number | null };
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
if (!srdDocument || !srdDocument.fields.licenses.includes("cc-by-40")) throw new Error("Expected the srd-2024 document fixture with a cc-by-40 license.");

const actionsByCreature = new Map<string, Fixture<ActionFields>[]>();
for (const action of actions) {
  const list = actionsByCreature.get(action.fields.parent) ?? [];
  list.push(action);
  actionsByCreature.set(action.fields.parent, list);
}
const attackByAction = new Map<string, Fixture<AttackFields>>();
for (const attack of attacks) {
  if (attackByAction.has(attack.fields.parent)) throw new Error(`Multiple attack rows for action ${attack.fields.parent}; the adapter assumes one.`);
  attackByAction.set(attack.fields.parent, attack);
}
const traitsByCreature = new Map<string, Fixture<TraitFields>[]>();
for (const trait of traits) {
  const list = traitsByCreature.get(trait.fields.parent) ?? [];
  list.push(trait);
  traitsByCreature.set(trait.fields.parent, list);
}

const slugOf = (pk: string) => pk.replace(/^srd-2024_/, "");
const idSafe = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "action";
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"] as const;
const ABILITY_BY_NAME = { Strength: "str", Dexterity: "dex", Constitution: "con", Intelligence: "int", Wisdom: "wis", Charisma: "cha" } as const;
const FOOTPRINT_BY_SIZE: Record<string, number> = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const SIZES = new Set(["tiny", "small", "medium", "large", "huge", "gargantuan"]);
const DICE_PATTERN = /^\d+d(?:4|6|8|10|12|20|100)(?:\s*[+-]\s*\d+)?$/i;
const SAVE_PATTERN = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\s*DC\s*(\d+)/;

/** CR 0-4 -> +2 and +1 per four CR after, matching the 5e proficiency table. */
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

const usesSuffix = (action: ActionFields): string => {
  if (action.uses_type === "PER_DAY" && action.uses_param) return ` (${action.uses_param}/Day)`;
  if (action.uses_type === "RECHARGE_ON_ROLL" && action.uses_param) return ` (Recharge ${action.uses_param}${action.uses_param < 6 ? "-6" : ""})`;
  if (action.uses_type === "RECHARGE") return " (Recharge after a Short or Long Rest)";
  return "";
};

/**
 * Fallback for the 27 attack actions that have no CreatureActionAttack row upstream (mostly
 * animals): parse the standardized 2024 statblock prose — "Melee Attack Roll: +2, reach
 * 5 ft. 10 (2d6 + 3) Slashing damage plus 3 (1d6) Acid damage." A flat primary ("1 Piercing
 * damage") keeps an empty damage list so the structured part never misrepresents the text;
 * "or ... Bloodied"-style variants deliberately stay prose-only (ADR-0008).
 */
type ProseAttack = { bonus: number; reachFeet: number | null; rangeFeet: number | null; damage: { formula: string; type: string }[] };
const parseProseAttack = (desc: string): ProseAttack | null => {
  const roll = desc.match(/(?:Melee or Ranged|Melee|Ranged) Attack Roll:\s*([+-]\d+)(?:\s*\([^)]*\))?/);
  if (!roll) return null;
  const head = desc.slice(0, 200);
  const reach = head.match(/reach (\d+) (?:ft|feet)/);
  const range = head.match(/range (\d+)(?:\/\d+)? (?:ft|feet)/);
  const damage: { formula: string; type: string }[] = [];
  const primary = desc.match(/(?:(\d+)\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)|(\d+))\s+([A-Za-z]+) damage/);
  if (primary && primary[2]) {
    const type = primary[4].toLowerCase();
    if ((DAMAGE_TYPES as readonly string[]).includes(type)) {
      damage.push({ formula: primary[2].replace(/\s*([+-])\s*/, " $1 "), type });
      for (const extra of desc.matchAll(/plus\s+\d+\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s+([A-Za-z]+) damage/g)) {
        const extraType = extra[2].toLowerCase();
        if ((DAMAGE_TYPES as readonly string[]).includes(extraType)) damage.push({ formula: extra[1].replace(/\s*([+-])\s*/, " $1 "), type: extraType });
      }
    }
  }
  return { bonus: Number.parseInt(roll[1], 10), reachFeet: reach ? Number.parseInt(reach[1], 10) : null, rangeFeet: range ? Number.parseInt(range[1], 10) : null, damage };
};

/**
 * Reviewed exclusions: fixtures open5e labels `srd-2024` that are not actually SRD 5.2.1
 * content. Verified against the SRD 5.2.1 text (repo root `5.2.1 SRD.md`).
 * - giant-fly: the SRD mentions a giant fly only inside the Figurine of Wondrous Power item;
 *   it has no statblock, so an "SRD 5.2.1" bundle must not ship one.
 */
const EXCLUSIONS = new Set(["srd-2024_giant-fly"]);

/**
 * Creatures the SRD prints as Tiny but open5e stores as "small" (its srd-2024 fixtures carry
 * no tiny size at all). List obtained by cross-validating every bundled statblock against an
 * independent CC-BY copy of the SRD text; footprints are unaffected (tiny and small are both
 * one cell), but display and future size-based rules need the real value.
 */
const TINY_PER_SRD = [
  "badger", "bat", "cat", "crab", "flying-snake", "frog", "hawk", "homunculus", "imp", "lizard",
  "owl", "piranha", "pseudodragon", "quasit", "rat", "raven", "scorpion", "seahorse",
  "sphinx-of-wonder", "spider", "sprite", "stirge", "venomous-snake", "weasel", "will-o-wisp"
];

/**
 * Reviewed corrections for upstream fixture bugs, applied before adaptation so the vendored
 * sources stay byte-identical to open5e. Values are the printed SRD 5.2.1 ones.
 * - octopus: upstream stores the CON/CHA *modifiers* (0 / -3) where the scores (11 / 4) belong.
 * - TINY_PER_SRD: see above. (The SRD's "Medium or Small" NPC statblocks stay at open5e's
 *   "small" — that value is within the SRD's own dual-size statement.)
 */
const CORRECTIONS: Record<string, Partial<CreatureFields>> = {
  // octopus: CON/CHA modifiers stored as scores; a garbage 30 in the CON save column
  // (the SRD table prints +0 there, i.e. no proficiency — open5e's convention is null).
  "srd-2024_octopus": { ability_score_constitution: 11, ability_score_charisma: 4, saving_throw_constitution: null },
  // mastiff / swarm-of-rats: the save *modifier* stored where the SRD-printed save bonus belongs.
  "srd-2024_mastiff": { saving_throw_wisdom: 3 },
  "srd-2024_swarm-of-rats": { saving_throw_dexterity: 2 },
  ...Object.fromEntries(TINY_PER_SRD.map((slug) => [`srd-2024_${slug}`, { size: "tiny" }]))
};

/**
 * Same idea for spells. greater-invisibility ships with an empty `desc` upstream; the text is
 * the printed SRD 5.2.1 sentence.
 */
const SPELL_CORRECTIONS: Record<string, Partial<SpellFields>> = {
  "srd-2024_greater-invisibility": { desc: "A creature you touch has the Invisible condition until the spell ends." }
};

for (const pk of [...Object.keys(CORRECTIONS), ...EXCLUSIONS]) {
  if (!creatures.some((creature) => creature.pk === pk)) throw new Error(`Correction/exclusion targets unknown creature ${pk} — check for a typo or an upstream rename.`);
}
for (const pk of Object.keys(SPELL_CORRECTIONS)) {
  if (!spells.some((spell) => spell.pk === pk)) throw new Error(`Spell correction targets unknown spell ${pk} — check for a typo or an upstream rename.`);
}

const report = { monsters: 0, actionsTotal: 0, structuredAttacks: 0, proseAttacks: 0, structuredSaves: 0, corrections: [] as string[], untypedDamage: [] as string[], skipped: [] as string[] };

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
    const creatureActions = (actionsByCreature.get(creature.pk) ?? [])
      .sort((left, right) => (left.fields.order_in_statblock ?? 0) - (right.fields.order_in_statblock ?? 0) || left.pk.localeCompare(right.pk))
      .map((action) => {
        const row = attackByAction.get(action.pk)?.fields;
        const prose = row ? null : parseProseAttack(action.fields.desc);
        const save = action.fields.desc.match(SAVE_PATTERN);
        const legendary = action.fields.action_type === "LEGENDARY_ACTION";
        const legendaryPrefix = legendary ? `Legendary Action${(action.fields.legendary_action_cost ?? 1) > 1 ? ` (costs ${action.fields.legendary_action_cost} actions)` : ""}. ` : "";
        // Flat damage (e.g. the octopus's "1 Bludgeoning") has no dice; it stays in the
        // description text per ADR-0008 rather than forcing a fake formula.
        const damage = row
          ? [
              ...(row.damage_die_count && row.damage_die_type
                ? [{ formula: formulaOf(row.damage_die_count, row.damage_die_type, row.damage_bonus), type: primaryDamageType(row, action.fields.desc) }]
                : []),
              ...(row.extra_damage_die_count && row.extra_damage_die_type
                ? [{ formula: formulaOf(row.extra_damage_die_count, row.extra_damage_die_type, row.extra_damage_bonus), type: row.extra_damage_type ?? "untyped" }]
                : [])
            ]
          : prose?.damage ?? [];
        const attack = row
          ? { bonus: row.to_hit_mod, ...(row.reach !== null ? { reachFeet: row.reach } : {}), ...(row.range !== null ? { rangeFeet: row.range } : {}) }
          : prose
            ? { bonus: prose.bonus, ...(prose.reachFeet !== null ? { reachFeet: prose.reachFeet } : {}), ...(prose.rangeFeet !== null ? { rangeFeet: prose.rangeFeet } : {}) }
            : null;
        report.actionsTotal += 1;
        if (row) report.structuredAttacks += 1;
        if (prose) report.proseAttacks += 1;
        if (save) report.structuredSaves += 1;
        for (const part of damage) if (part.type === "untyped") report.untypedDamage.push(action.pk);
        return {
          id: idSafe(slugOf(action.pk).replace(`${slug}_`, "")),
          name: `${action.fields.name}${usesSuffix(action.fields)}`.slice(0, 120),
          activation: action.fields.action_type === "ACTION" ? "action" as const : action.fields.action_type === "BONUS_ACTION" ? "bonus-action" as const : action.fields.action_type === "REACTION" ? "reaction" as const : "other" as const,
          description: `${legendaryPrefix}${action.fields.desc}`.slice(0, 12000),
          ...(attack ? { attack } : {}),
          ...(save ? { save: { ability: ABILITY_BY_NAME[save[1] as keyof typeof ABILITY_BY_NAME], dc: Number.parseInt(save[2], 10) } } : {}),
          damage
        };
      });
    const senses = [
      fields.darkvision_range ? `darkvision ${fields.darkvision_range} ft.` : null,
      fields.blindsight_range ? `blindsight ${fields.blindsight_range} ft.` : null,
      fields.tremorsense_range ? `tremorsense ${fields.tremorsense_range} ft.` : null,
      fields.truesight_range ? `truesight ${fields.truesight_range} ft.` : null
    ].filter((sense): sense is string => sense !== null);
    report.monsters += 1;
    return {
      schemaId: "vtt.actor-monster" as const,
      schemaVersion: 1 as const,
      source: { name: "SRD 5.2.1", version: "5.2.1", externalId: slug },
      name: fields.name,
      summary: `${fields.size[0].toUpperCase()}${fields.size.slice(1)} ${fields.type}, ${fields.alignment} — CR ${challenge % 1 === 0 ? challenge : fields.challenge_rating.replace(/0+$/, "")}`.slice(0, 280),
      size: fields.size as ActorDefinition["size"],
      abilityScores: {
        str: fields.ability_score_strength, dex: fields.ability_score_dexterity, con: fields.ability_score_constitution,
        int: fields.ability_score_intelligence, wis: fields.ability_score_wisdom, cha: fields.ability_score_charisma
      },
      proficiencyBonus: fields.proficiency_bonus ?? proficiencyFromChallenge(challenge),
      armorClass: fields.armor_class,
      hitPoints: { maximum: fields.hit_points, ...(fields.hit_dice && DICE_PATTERN.test(fields.hit_dice) ? { formula: fields.hit_dice } : {}) },
      initiativeBonus: fields.initiative_bonus,
      speedFeet: fields.walk ?? 0,
      actions: creatureActions,
      token: { disposition: "hostile" as const, footprint: { width: footprint, height: footprint } },
      extensions: {
        "open5e.srd-2024": {
          challengeRating: challenge,
          experiencePoints: fields.experience_points_integer,
          type: fields.type,
          alignment: fields.alignment,
          armorDetail: fields.armor_detail || null,
          speeds: { walk: fields.walk, swim: fields.swim, fly: fields.fly, climb: fields.climb, burrow: fields.burrow, hover: fields.hover },
          senses,
          passivePerception: fields.passive_perception,
          languages: fields.languages_desc || fields.languages.join(", ") || null,
          savingThrows: {
            str: fields.saving_throw_strength, dex: fields.saving_throw_dexterity, con: fields.saving_throw_constitution,
            int: fields.saving_throw_intelligence, wis: fields.saving_throw_wisdom, cha: fields.saving_throw_charisma
          },
          damageVulnerabilities: fields.damage_vulnerabilities_display || null,
          damageResistances: fields.damage_resistances_display || null,
          damageImmunities: fields.damage_immunities_display || null,
          conditionImmunities: fields.condition_immunities_display || null,
          nonmagicalAttackImmunity: fields.nonmagical_attack_immunity,
          nonmagicalAttackResistance: fields.nonmagical_attack_resistance,
          traits: (traitsByCreature.get(creature.pk) ?? [])
            .sort((left, right) => left.fields.name.localeCompare(right.fields.name))
            .map((trait) => ({ name: trait.fields.name, description: trait.fields.desc }))
        }
      }
    };
  });

for (const monster of monsters) {
  const parsed = ActorDefinitionSchema.safeParse(monster);
  if (!parsed.success) {
    report.skipped.push(`${monster.source.externalId}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
}
if (report.skipped.length > 0) {
  console.error(`REFUSING TO WRITE — ${report.skipped.length} definitions failed validation:`);
  for (const line of report.skipped) console.error(`  - ${line}`);
  process.exit(1);
}

const conditionRecords = conditions
  .filter((condition) => condition.fields.document === "srd-2024")
  .sort((left, right) => left.pk.localeCompare(right.pk))
  .map((condition) => ({
    id: condition.fields.describes,
    name: condition.fields.describes.split("-").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" "),
    description: condition.fields.desc
  }));

const titleCase = (slug: string) => slug.split("-").map((part) => `${part[0].toUpperCase()}${part.slice(1)}`).join(" ");
const abilityShort: Record<string, "str" | "dex" | "con" | "int" | "wis" | "cha"> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
const onlySrd = <T extends { document: string }>(rows: Fixture<T>[]) => rows.filter((row) => row.fields.document === "srd-2024").sort((left, right) => left.pk.localeCompare(right.pk));

const spellOptionsBySpell = new Map<string, Fixture<SpellOptionFields>[]>();
for (const option of spellOptions) {
  const list = spellOptionsBySpell.get(option.fields.parent) ?? [];
  list.push(option);
  spellOptionsBySpell.set(option.fields.parent, list);
}

const spellRecords = onlySrd(spells).map((spell) => {
  const correction = SPELL_CORRECTIONS[spell.pk];
  if (correction) report.corrections.push(spell.pk);
  const fields = { ...spell.fields, ...correction };
  if (fields.saving_throw_ability && !abilityShort[fields.saving_throw_ability]) throw new Error(`${spell.pk}: unexpected save ability ${fields.saving_throw_ability}`);
  return {
    id: slugOf(spell.pk),
    name: fields.name,
    level: fields.level,
    school: fields.school,
    castingTime: fields.casting_time,
    reactionCondition: fields.reaction_condition || null,
    range: { distance: fields.range, unit: fields.range_unit, text: fields.range_text || null },
    components: { verbal: fields.verbal, somatic: fields.somatic, material: fields.material, materialText: fields.material_specified || null, materialConsumed: fields.material_consumed },
    duration: fields.duration,
    concentration: fields.concentration,
    ritual: fields.ritual,
    attackRoll: fields.attack_roll,
    damage: { roll: fields.damage_roll || null, types: [...fields.damage_types] },
    save: fields.saving_throw_ability ? abilityShort[fields.saving_throw_ability] : null,
    target: { type: fields.target_type, count: fields.target_count },
    shape: fields.shape_type ? { type: fields.shape_type, size: fields.shape_size, unit: fields.shape_size_unit } : null,
    classes: fields.classes.map(slugOf).sort(),
    description: fields.desc,
    higherLevel: fields.higher_level || null,
    castingOptions: (spellOptionsBySpell.get(spell.pk) ?? [])
      .sort((left, right) => left.fields.type.localeCompare(right.fields.type))
      .map((option) => ({ type: option.fields.type, damageRoll: option.fields.damage_roll || null, targetCount: option.fields.target_count, description: option.fields.desc || null }))
  };
});

const weaponRecords = onlySrd(weapons).map((weapon) => ({
  id: slugOf(weapon.pk),
  name: weapon.fields.name,
  category: weapon.fields.is_simple ? "simple" as const : "martial" as const,
  improvised: weapon.fields.is_improvised,
  damage: { dice: weapon.fields.damage_dice, type: weapon.fields.damage_type },
  // range 0 means a melee weapon; open5e's srd-2024 model does not link per-weapon
  // properties (Finesse, Light, ...) — the property texts ship separately below.
  rangeFeet: weapon.fields.range || null,
  longRangeFeet: weapon.fields.long_range || null
}));

const weaponPropertyRecords = onlySrd(weaponProperties).map((property) => ({
  id: slugOf(property.pk),
  name: property.fields.name,
  kind: property.fields.type === "Mastery" ? "mastery" as const : "property" as const,
  description: property.fields.desc
}));

const armorRecords = onlySrd(armors).map((armor) => ({
  id: slugOf(armor.pk),
  name: armor.fields.name,
  acBase: armor.fields.ac_base,
  addDexModifier: armor.fields.ac_add_dexmod,
  dexModifierCap: armor.fields.ac_cap_dexmod,
  stealthDisadvantage: armor.fields.grants_stealth_disadvantage,
  strengthRequired: armor.fields.strength_score_required
}));

const describesRecords = (rows: Fixture<DescribesFields>[]) => onlySrd(rows).map((row) => ({
  id: row.fields.describes,
  name: titleCase(row.fields.describes),
  description: row.fields.desc
}));
const skillRecords = describesRecords(skills);
const damageTypeRecords = describesRecords(damageTypes);

const ruleSetNames = new Map(onlySrd(ruleSets).map((set) => [set.pk, set.fields.name]));
const ruleRecords = onlySrd(rules)
  .sort((left, right) => left.fields.ruleset.localeCompare(right.fields.ruleset) || left.fields.index - right.fields.index)
  .map((rule) => ({
    id: `${slugOf(rule.fields.ruleset)}-${rule.fields.index}`,
    name: rule.fields.name,
    ruleset: ruleSetNames.get(rule.fields.ruleset) ?? slugOf(rule.fields.ruleset),
    order: rule.fields.index,
    description: rule.fields.desc
  }));

const attribution = {
  license: "CC-BY-4.0",
  attribution: "This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.",
  source: {
    name: srdDocument.fields.name,
    author: srdDocument.fields.author,
    publisher: srdDocument.fields.publisher,
    permalink: srdDocument.fields.permalink,
    vendoredFrom: "https://github.com/open5e/open5e-api (data/v2/wizards-of-the-coast/srd-2024, staging branch)",
    retrieved: "2026-07-17"
  }
};

// Fail closed on every bundle, not just monsters: nothing is written unless everything validates.
const validateBundle = (label: string, schema: z.ZodTypeAny, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error(`REFUSING TO WRITE — ${label} failed validation:`);
    for (const issue of parsed.error.issues.slice(0, 10)) console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
};
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
console.log(`actions: ${report.actionsTotal} — structured attacks ${report.structuredAttacks} (+${report.proseAttacks} prose-parsed), structured saves ${report.structuredSaves}`);
console.log(`conditions: ${conditionRecords.length} | spells: ${spellRecords.length} | weapons: ${weaponRecords.length} (+${weaponPropertyRecords.length} properties) | armor: ${armorRecords.length}`);
console.log(`skills: ${skillRecords.length} | damage types: ${damageTypeRecords.length} | rules: ${ruleRecords.length}`);
if (report.corrections.length > 0) console.log(`upstream corrections applied (${report.corrections.length}): ${report.corrections.map(slugOf).join(", ")}`);
if (report.untypedDamage.length > 0) console.log(`untyped damage fallbacks (${report.untypedDamage.length}): ${report.untypedDamage.join(", ")}`);
