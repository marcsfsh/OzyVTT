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
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";

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

const load = <T>(file: string): Fixture<T>[] => JSON.parse(readFileSync(join(sourceDir, file), "utf8")) as Fixture<T>[];

const creatures = load<CreatureFields>("Creature.json");
const actions = load<ActionFields>("CreatureAction.json");
const attacks = load<AttackFields>("CreatureActionAttack.json");
const traits = load<TraitFields>("CreatureTrait.json");
const conditions = load<ConditionFields>("ConditionDescription.json");
const documents = load<DocumentFields>("Document.json");

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
 * Reviewed corrections for upstream fixture bugs, applied before adaptation so the vendored
 * sources stay byte-identical to open5e. Values are the printed SRD 5.2.1 ones.
 * - octopus: upstream stores the CON/CHA *modifiers* (0 / -3) where the scores (11 / 4) belong.
 */
const CORRECTIONS: Record<string, Partial<CreatureFields>> = {
  "srd-2024_octopus": { ability_score_constitution: 11, ability_score_charisma: 4 }
};

const report = { monsters: 0, actionsTotal: 0, structuredAttacks: 0, structuredSaves: 0, corrections: [] as string[], untypedDamage: [] as string[], skipped: [] as string[] };

const monsters: ActorDefinition[] = creatures
  .filter((creature) => creature.fields.document === "srd-2024")
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
        const attack = attackByAction.get(action.pk)?.fields;
        const save = action.fields.desc.match(SAVE_PATTERN);
        const legendary = action.fields.action_type === "LEGENDARY_ACTION";
        const legendaryPrefix = legendary ? `Legendary Action${(action.fields.legendary_action_cost ?? 1) > 1 ? ` (costs ${action.fields.legendary_action_cost} actions)` : ""}. ` : "";
        // Flat damage (e.g. the octopus's "1 Bludgeoning") has no dice; it stays in the
        // description text per ADR-0008 rather than forcing a fake formula.
        const damage = attack
          ? [
              ...(attack.damage_die_count && attack.damage_die_type
                ? [{ formula: formulaOf(attack.damage_die_count, attack.damage_die_type, attack.damage_bonus), type: primaryDamageType(attack, action.fields.desc) }]
                : []),
              ...(attack.extra_damage_die_count && attack.extra_damage_die_type
                ? [{ formula: formulaOf(attack.extra_damage_die_count, attack.extra_damage_die_type, attack.extra_damage_bonus), type: attack.extra_damage_type ?? "untyped" }]
                : [])
            ]
          : [];
        report.actionsTotal += 1;
        if (attack) report.structuredAttacks += 1;
        if (save) report.structuredSaves += 1;
        for (const part of damage) if (part.type === "untyped") report.untypedDamage.push(action.pk);
        return {
          id: idSafe(slugOf(action.pk).replace(`${slug}_`, "")),
          name: `${action.fields.name}${usesSuffix(action.fields)}`.slice(0, 120),
          activation: action.fields.action_type === "ACTION" ? "action" as const : action.fields.action_type === "BONUS_ACTION" ? "bonus-action" as const : action.fields.action_type === "REACTION" ? "reaction" as const : "other" as const,
          description: `${legendaryPrefix}${action.fields.desc}`.slice(0, 12000),
          ...(attack ? { attack: { bonus: attack.to_hit_mod, ...(attack.reach !== null ? { reachFeet: attack.reach } : {}), ...(attack.range !== null ? { rangeFeet: attack.range } : {}) } } : {}),
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

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "monsters.v1.json"), `${JSON.stringify(monsters, null, 1)}\n`);
writeFileSync(join(outDir, "conditions.v1.json"), `${JSON.stringify(conditionRecords, null, 1)}\n`);
writeFileSync(join(outDir, "attribution.json"), `${JSON.stringify(attribution, null, 2)}\n`);

console.log(`monsters: ${report.monsters} (all valid)`);
console.log(`actions: ${report.actionsTotal} — structured attacks ${report.structuredAttacks}, structured saves ${report.structuredSaves}`);
console.log(`conditions: ${conditionRecords.length}`);
if (report.corrections.length > 0) console.log(`upstream corrections applied: ${report.corrections.join(", ")}`);
if (report.untypedDamage.length > 0) console.log(`untyped damage fallbacks (${report.untypedDamage.length}): ${report.untypedDamage.join(", ")}`);
