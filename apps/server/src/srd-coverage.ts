import {
  loadArmor,
  loadBackgrounds,
  loadClasses,
  loadConditions,
  loadEquipment,
  loadFeats,
  loadGlossary,
  loadMagicItems,
  loadMonsterDefinitions,
  loadSpecies,
  loadSpells,
  loadSubclasses,
  loadWeapons,
  featurePicks,
  type EquipmentReference,
  type FeatureRecord,
  type SpellReference
} from "@vtt/content-srd-5.2.1";
import type { ActorAction } from "@vtt/schemas";
import {
  CONDITION_COVERAGE,
  GLOSSARY_COVERAGE,
  MONSTER_TRAIT_COVERAGE,
  RECORD_OVERRIDES,
  type CoverageState,
  type CuratedCoverage
} from "./srd-coverage-curated.js";

/**
 * The SRD coverage manifest (`docs/srd-coverage.md`): every SRD record, classified as enforced (the server applies
 * it), guided (the app tracks it and walks the table through it, a person applies the rest) or reference (readable
 * in the app, nothing to apply). Records are classified from the mechanics their bundle carries, because the engine
 * is data-driven; the curated tables cover what data can't say (conditions, the glossary, monster traits) and
 * records the engine handles in code. A freshness test fails when this drifts.
 */

export type CoverageRow = Readonly<{ group: string; id: string; name: string; state: CoverageState; note?: string }>;

const STATES: readonly CoverageState[] = ["enforced", "guided", "reference"];

const curatedOr = (key: string, computed: CoverageState): Readonly<{ state: CoverageState; note?: string }> =>
  RECORD_OVERRIDES[key] ?? { state: computed };

/** A spell is enforced when a cast applies its numbers or leaves its effect on the targets; guided when the app
 *  spends the slot, holds Concentration, places the area or rolls a save whose outcome a person applies. */
export function spellState(spell: SpellReference): CoverageState {
  const effect = spell.effect;
  const applies =
    effect !== null &&
    (effect.attacks > 0 ||
      effect.damage.length > 0 ||
      effect.healing !== null ||
      effect.grant !== undefined ||
      effect.failureEffect !== undefined ||
      effect.reaction !== undefined ||
      effect.darts !== undefined ||
      (effect.laterActions ?? []).some((later) => later.damage.length > 0 || later.attackRange !== undefined));
  const saveApplies =
    spell.save !== null &&
    (spell.save.failureConditions.length > 0 || (effect?.damage.length ?? 0) > 0 || spell.save.speedZero === true);
  if (applies || saveApplies) return "enforced";
  if (spell.level > 0 || spell.concentration || spell.area !== null || spell.save !== null) return "guided";
  return "reference";
}

/** A stat block action is enforced when its attack, save, damage, healing or structured Multiattack resolves;
 *  guided when the app only tracks it (a legendary cost, a recharge, a reminder, a Multiattack read as prose). */
export function monsterActionState(action: ActorAction): CoverageState {
  const resolves =
    action.attack !== undefined ||
    action.save !== undefined ||
    action.damage.length > 0 ||
    action.healing !== undefined ||
    action.multiattack !== undefined ||
    (action.onHit?.length ?? 0) > 0 ||
    action.darts !== undefined ||
    action.reaction !== undefined;
  if (resolves) return "enforced";
  if (action.untrackedMultiattack || action.reminder || action.legendary || action.uses) return "guided";
  return "reference";
}

type Riders = Pick<FeatureRecord, "actions" | "effects" | "modifiers" | "grants" | "uses" | "tags">;

const ridersApply = (riders: Riders) =>
  riders.actions.length > 0 || riders.effects.length > 0 || riders.modifiers.length > 0 || riders.grants !== undefined;

/** A feature, trait or feat is enforced when its riders (actions, effects, modifiers, grants) or the build (picks,
 *  spell lists, an upgrade of an earlier feature) apply it; guided when the app counts its uses or records a pick
 *  whose effect a person applies. */
export function featureState(feature: FeatureRecord): CoverageState {
  const picks = featurePicks(feature);
  // A catalog pick (a skill, a spell, a feat, a subclass) is the builder's to apply; an inline option applies
  // when it carries mechanics of its own.
  const pickApplies = picks.some(
    (pick) =>
      !pick.options ||
      pick.options.some(
        (option) => ridersApply(option) || (option.extraPicks?.length ?? 0) > 0 || featurePicks(option).length > 0
      )
  );
  const buildApplies =
    (feature.extraPicks?.length ?? 0) > 0 ||
    (feature.extraSpellLists?.length ?? 0) > 0 ||
    feature.replacesFeatureId !== undefined;
  if (ridersApply(feature) || pickApplies || buildApplies) return "enforced";
  if (feature.uses !== undefined || picks.length > 0) return "guided";
  return "reference";
}

/** An item is enforced when it is a weapon or armor or carries riders, a cast or a use; guided when the app only
 *  tracks it (attunement, charges, a curse). */
export function itemState(item: EquipmentReference): CoverageState {
  const applies =
    (item.weapon ?? null) !== null ||
    (item.armor ?? null) !== null ||
    item.casts.length > 0 ||
    item.grantsFeatIds.length > 0 ||
    (item.ammunition ?? null) !== null ||
    ridersApply(item);
  if (applies) return "enforced";
  if (item.attunement?.required === true || (item.charges ?? null) !== null || item.cursed) return "guided";
  return "reference";
}

/** A monster trait's kind: its name without the uses or lair suffix ("Legendary Resistance (3/Day)"). */
export const traitKind = (name: string) => name.replace(/\s*\(.*\)\s*$/, "").trim();

type MonsterTraits = Readonly<{ traits?: readonly { name: string }[] }>;

const monsterTraits = (definition: { extensions: Readonly<Record<string, unknown>> }) =>
  ((definition.extensions["open5e.srd-2024"] as MonsterTraits | undefined)?.traits ?? []).map((trait) => trait.name);

function curatedRow(group: string, id: string, name: string, curated: CuratedCoverage | undefined): CoverageRow {
  // A missing row is a test failure; rendering it as reference keeps the document readable while it is fixed.
  return curated ? { group, id, name, ...curated } : { group, id, name, state: "reference", note: "not classified" };
}

export function srdCoverageRows(): CoverageRow[] {
  const rows: CoverageRow[] = [];
  for (const spell of loadSpells())
    rows.push({ group: "Spells", id: spell.id, name: spell.name, ...curatedOr(`spell:${spell.id}`, spellState(spell)) });

  for (const definition of loadMonsterDefinitions())
    for (const action of definition.actions)
      rows.push({
        group: "Monster actions",
        id: `${definition.name}/${action.id}`,
        name: `${definition.name}: ${action.name}`,
        state: monsterActionState(action)
      });
  const kinds = new Map<string, number>();
  for (const definition of loadMonsterDefinitions())
    for (const name of monsterTraits(definition)) kinds.set(traitKind(name), (kinds.get(traitKind(name)) ?? 0) + 1);
  for (const [kind, count] of kinds)
    rows.push(curatedRow("Monster traits", kind, `${kind} (${count})`, MONSTER_TRAIT_COVERAGE[kind]));

  const classes = loadClasses();
  for (const record of classes)
    for (const feature of record.features)
      rows.push({
        group: `${record.name} features`,
        id: `${record.id}/${feature.id}`,
        name: feature.name,
        ...curatedOr(`feature:${feature.id}`, featureState(feature))
      });
  for (const record of loadSubclasses()) {
    const className = classes.find((candidate) => candidate.id === record.classId)?.name ?? record.classId;
    for (const feature of record.features)
      rows.push({
        group: `${className} features`,
        id: `${record.id}/${feature.id}`,
        name: `${feature.name} (${record.name})`,
        ...curatedOr(`feature:${feature.id}`, featureState(feature))
      });
  }
  for (const species of loadSpecies())
    for (const feature of [...species.traits, ...species.lineages.flatMap((lineage) => lineage.traits)])
      rows.push({
        group: "Species traits",
        id: `${species.id}/${feature.id}`,
        name: `${feature.name} (${species.name})`,
        ...curatedOr(`feature:${feature.id}`, featureState(feature))
      });
  // A background is build data: its ability increases, proficiencies, origin feat and equipment are all applied.
  for (const background of loadBackgrounds())
    rows.push({ group: "Backgrounds", id: background.id, name: background.name, state: "enforced" });
  for (const feat of loadFeats())
    rows.push({
      group: "Feats",
      id: feat.id,
      name: feat.name,
      ...curatedOr(`feature:${feat.feature.id}`, featureState(feat.feature))
    });

  for (const item of loadMagicItems())
    rows.push({ group: "Magic items", id: item.id, name: item.name, ...curatedOr(`item:${item.id}`, itemState(item)) });
  // The equipment catalog folds in weapons, armor and magic items, which have their own groups.
  const gear = loadEquipment().filter((item) => !item.isMagic && item.weapon === null && item.armor === null);
  for (const item of gear)
    rows.push({ group: "Gear and tools", id: item.id, name: item.name, ...curatedOr(`item:${item.id}`, itemState(item)) });
  // Weapons and armor are wholly mechanical: attacks, properties and masteries; Armor Class, Strength and Stealth.
  for (const weapon of loadWeapons()) rows.push({ group: "Weapons", id: weapon.id, name: weapon.name, state: "enforced" });
  for (const armor of loadArmor()) rows.push({ group: "Armor", id: armor.id, name: armor.name, state: "enforced" });

  for (const condition of loadConditions())
    rows.push(curatedRow("Conditions", condition.id, condition.name, CONDITION_COVERAGE[condition.id]));
  for (const entry of loadGlossary())
    rows.push(curatedRow("Rules glossary", entry.id, entry.name, GLOSSARY_COVERAGE[entry.id]));
  return rows;
}

const byName = (a: CoverageRow, b: CoverageRow) => a.name.localeCompare(b.name);
const listed = (rows: readonly CoverageRow[]) =>
  rows
    .toSorted(byName)
    .map((row) => (row.note ? `${row.name} (${row.note})` : row.name))
    .join(", ");

/** Groups whose records are listed by state; the curated groups print as tables with their notes instead. */
const TABLE_GROUPS = new Set(["Monster traits", "Conditions", "Rules glossary"]);

export function renderSrdCoverage(): string {
  const rows = srdCoverageRows();
  const groups = [...new Set(rows.map((row) => row.group))];
  const lines: string[] = [];
  lines.push("# SRD 5.2.1 coverage (generated - do not edit by hand)");
  lines.push("");
  lines.push("Regenerate with `npm run map`; a test (`apps/server/test/srd-coverage.test.ts`) fails when this is stale");
  lines.push("or a condition, glossary entry or monster trait has no classification. Every SRD record is in one state:");
  lines.push("");
  lines.push("- **Enforced:** the server applies it (rolls, damage, conditions, uses, Armor Class, the builder's picks).");
  lines.push("- **Guided:** the app tracks it and walks the table through it (a spent slot, a counted use, a reminder, a");
  lines.push("  rolled save); a person applies the rest.");
  lines.push("- **Reference:** readable in the app where it's needed; there is nothing to apply.");
  lines.push("");
  lines.push("Records are classified from the mechanics their content bundle carries, since the engine is data-driven,");
  lines.push("with curated rows for what data can't say (`apps/server/src/srd-coverage-curated.ts`). Known gaps in");
  lines.push("enforced records are GitHub issues.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Records | Enforced | Guided | Reference |");
  lines.push("| --- | --- | --- | --- |");
  for (const group of groups) {
    const inGroup = rows.filter((row) => row.group === group);
    const counts = STATES.map((state) => inGroup.filter((row) => row.state === state).length);
    lines.push(`| ${group} (${inGroup.length}) | ${counts.join(" | ")} |`);
  }
  lines.push("");
  for (const group of groups) {
    const inGroup = rows.filter((row) => row.group === group);
    lines.push(`## ${group}`);
    lines.push("");
    if (TABLE_GROUPS.has(group)) {
      lines.push("| Record | State | How |");
      lines.push("| --- | --- | --- |");
      for (const row of inGroup.toSorted(byName)) lines.push(`| ${row.name} | ${row.state} | ${row.note ?? ""} |`);
      lines.push("");
      continue;
    }
    for (const state of STATES) {
      const inState = inGroup.filter((row) => row.state === state);
      if (inState.length === 0) continue;
      // Hundreds of enforced monster actions would bury the few that aren't; count them instead.
      const body = group === "Monster actions" && state === "enforced" ? "(listed by count only)" : listed(inState);
      lines.push(`**${state[0]!.toUpperCase()}${state.slice(1)} (${inState.length}):** ${body}`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
