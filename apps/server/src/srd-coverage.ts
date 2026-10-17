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
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { builtinActionsFor, withTakenActions } from "./builtin-actions.js";
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

const RANK: Readonly<Record<CoverageState, number>> = { reference: 0, guided: 1, enforced: 2 };
const most = (states: readonly CoverageState[]): CoverageState =>
  states.reduce<CoverageState>((best, state) => (RANK[state] > RANK[best] ? state : best), "reference");

type SpellLater = NonNullable<NonNullable<SpellReference["effect"]>["laterActions"]>[number];

/** A later action applies when it deals damage, makes an attack or imposes conditions on a failed save; with a `zone`
 *  the server raises it as creatures enter or start or end a turn in the area (`spell-zones.ts`). */
const laterApplies = (later: SpellLater) =>
  later.damage.length > 0 ||
  later.attackRange !== undefined ||
  (later.save?.failureConditions.length ?? 0) > 0 ||
  later.save?.speedZero === true;

/** A spell is enforced when a cast applies its numbers or leaves its effect on the targets, or the area it leaves
 *  applies them later; guided when the app spends the slot, holds Concentration, places the area or rolls a save
 *  whose outcome a person applies. */
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
      (effect.laterActions ?? []).some(laterApplies));
  const saveApplies =
    spell.save !== null &&
    (spell.save.failureConditions.length > 0 || (effect?.damage.length ?? 0) > 0 || spell.save.speedZero === true);
  if (applies || saveApplies) return "enforced";
  if (spell.level > 0 || spell.concentration || spell.area !== null || spell.save !== null) return "guided";
  return "reference";
}

type ResolvingFields = Pick<
  ActorAction,
  "damage" | "healing" | "multiattack" | "onHit" | "darts" | "reaction" | "grants" | "endsConditions"
> &
  Readonly<{ attack?: unknown; save?: unknown; damageByLevel?: unknown }>;

/** An action resolves when it rolls an attack or a save, deals damage, heals, grants an effect, ends conditions,
 *  runs a structured Multiattack or is offered as a reaction prompt. One with none of these only spends its use and
 *  its place in the turn. */
const actionResolves = (action: ResolvingFields) =>
  action.attack !== undefined ||
  action.save !== undefined ||
  action.damage.length > 0 ||
  action.damageByLevel !== undefined ||
  action.healing !== undefined ||
  action.multiattack !== undefined ||
  (action.onHit?.length ?? 0) > 0 ||
  action.darts !== undefined ||
  action.reaction !== undefined ||
  action.grants !== undefined ||
  action.endsConditions !== undefined;

/**
 * A stat block action is enforced when its attack, save, damage, healing, grant or structured Multiattack resolves,
 * or when the server offers it as the generic actions it names (Nimble Escape's Disengage or Hide as a Bonus
 * Action). One that casts spells takes the state of the spells it casts (`spellStates`), each a cast action with the
 * stat block's numbers. Guided when the app only tracks it (a legendary cost, a recharge, a reminder, a Multiattack
 * read as prose).
 */
export function monsterActionState(
  action: ActorAction,
  definition: ActorDefinition,
  spellStates: ReadonlyMap<string, CoverageState>
): CoverageState {
  const tracked = action.untrackedMultiattack || action.reminder || action.legendary || action.uses;
  const floor: CoverageState = tracked ? "guided" : "reference";
  if (action.castsSpells) {
    const casts = action.castsSpells.spells.map((entry) => spellStates.get(entry.spellId) ?? "reference");
    // A list's own uses (per day, at will) are counted on every cast, so a list is guided at least.
    return most([...casts, action.castsSpells.self ? floor : "guided"]);
  }
  const offered = builtinActionsFor(definition).some((builtin) => builtin.name.startsWith(`${action.name}: `));
  if (actionResolves(withTakenActions(action)) || offered) return "enforced";
  return floor;
}

type Riders = Pick<FeatureRecord, "actions" | "effects" | "modifiers" | "grants" | "uses" | "tags">;

/** A rest regain only says how a feature's own uses come back, so it applies the feature when that is all the
 *  feature does (Font of Inspiration). */
const ridersApply = (riders: Riders) =>
  riders.actions.some(actionResolves) ||
  riders.effects.length > 0 ||
  riders.modifiers.some((modifier) => modifier.type !== "short-rest-regain") ||
  (riders.modifiers.length > 0 && riders.actions.length === 0) ||
  riders.grants !== undefined;

/** A feature, trait or feat is enforced when its riders (actions that resolve, effects, modifiers, grants) or the
 *  build (picks, spell lists, an upgrade of an earlier feature) apply it; guided when the app counts its uses, offers
 *  an action that only spends them, or records a pick whose effect a person applies. */
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
  if (feature.uses !== undefined || feature.actions.length > 0 || picks.length > 0) return "guided";
  return "reference";
}

/** An item is enforced when it is a weapon or armor or carries riders, a cast, a scroll's spell or ammunition;
 *  guided when the app only tracks it (attunement, charges, a curse, an action that only spends a use). */
export function itemState(item: EquipmentReference): CoverageState {
  const applies =
    (item.weapon ?? null) !== null ||
    (item.armor ?? null) !== null ||
    item.casts.length > 0 ||
    item.grantsFeatIds.length > 0 ||
    (item.ammunition ?? null) !== null ||
    item.spellScroll !== undefined ||
    item.removesArmorDrawbacks === true ||
    ridersApply(item);
  if (applies) return "enforced";
  if (
    item.attunement?.required === true ||
    (item.charges ?? null) !== null ||
    item.cursed ||
    item.uses !== undefined ||
    item.actions.length > 0
  )
    return "guided";
  return "reference";
}

/** A monster trait's kind: its name without the uses or lair suffix ("Legendary Resistance (3/Day)"). */
export const traitKind = (name: string) => name.replace(/\s*\(.*\)\s*$/, "").trim();

type MonsterTraits = Readonly<{ traits?: readonly { name: string }[] }>;

const monsterTraits = (definition: ActorDefinition) =>
  ((definition.extensions["open5e.srd-2024"] as MonsterTraits | undefined)?.traits ?? []).map((trait) => trait.name);

/** Each kind of monster trait: how many stat blocks print it, and how many of those the bundle carries as a mechanic
 *  the server runs (`ActorDefinition.traitMechanics`). */
export function monsterTraitKinds(): ReadonlyMap<string, Readonly<{ printings: number; running: number }>> {
  const kinds = new Map<string, { printings: number; running: number }>();
  for (const definition of loadMonsterDefinitions())
    for (const name of monsterTraits(definition)) {
      const kind = kinds.get(traitKind(name)) ?? { printings: 0, running: 0 };
      kind.printings += 1;
      if ((definition.traitMechanics ?? []).some((mechanic) => mechanic.name === name)) kind.running += 1;
      kinds.set(traitKind(name), kind);
    }
  return kinds;
}

function curatedRow(group: string, id: string, name: string, curated: CuratedCoverage | undefined): CoverageRow {
  // A missing row is a test failure; rendering it as reference keeps the document readable while it is fixed.
  return curated ? { group, id, name, ...curated } : { group, id, name, state: "reference", note: "not classified" };
}

export function srdCoverageRows(): CoverageRow[] {
  const rows: CoverageRow[] = [];
  const spellStates = new Map<string, CoverageState>();
  for (const spell of loadSpells()) {
    const row = curatedOr(`spell:${spell.id}`, spellState(spell));
    spellStates.set(spell.id, row.state);
    rows.push({ group: "Spells", id: spell.id, name: spell.name, ...row });
  }

  for (const definition of loadMonsterDefinitions())
    for (const action of definition.actions)
      rows.push({
        group: "Monster actions",
        id: `${definition.name}/${action.id}`,
        name: `${definition.name}: ${action.name}`,
        ...curatedOr(`action:${definition.name}/${action.id}`, monsterActionState(action, definition, spellStates))
      });
  for (const [kind, { printings }] of monsterTraitKinds())
    rows.push(curatedRow("Monster traits", kind, `${kind} (${printings})`, MONSTER_TRAIT_COVERAGE[kind]));

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
    rows.push({
      group: "Gear and tools",
      id: item.id,
      name: item.name,
      ...curatedOr(`item:${item.id}`, itemState(item))
    });
  // Weapons and armor are wholly mechanical: attacks, properties and masteries; Armor Class, Strength and Stealth.
  for (const weapon of loadWeapons())
    rows.push({ group: "Weapons", id: weapon.id, name: weapon.name, state: "enforced" });
  for (const armor of loadArmor()) rows.push({ group: "Armor", id: armor.id, name: armor.name, state: "enforced" });

  for (const condition of loadConditions())
    rows.push(curatedRow("Conditions", condition.id, condition.name, CONDITION_COVERAGE[condition.id]));
  for (const entry of loadGlossary())
    rows.push(curatedRow("Rules glossary", entry.id, entry.name, GLOSSARY_COVERAGE[entry.id]));
  return rows;
}

const byName = (a: CoverageRow, b: CoverageRow) => a.name.localeCompare(b.name);
const listed = (rows: readonly CoverageRow[]) =>
  [...rows]
    .sort(byName)
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
  lines.push(
    "Regenerate with `npm run map`; a test (`apps/server/test/srd-coverage.test.ts`) fails when this is stale"
  );
  lines.push(
    "or a condition, glossary entry or monster trait has no classification. Every SRD record is in one state:"
  );
  lines.push("");
  lines.push(
    "- **Enforced:** the server applies it (rolls, damage, conditions, uses, Armor Class, the builder's picks)."
  );
  lines.push(
    "- **Guided:** the app tracks it and walks the table through it (a spent slot, a counted use, a reminder, a"
  );
  lines.push("  rolled save); a person applies the rest.");
  lines.push("- **Reference:** readable in the app where it's needed; there is nothing to apply.");
  lines.push("");
  lines.push(
    "Records are classified from the mechanics their content bundle carries, since the engine is data-driven,"
  );
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
      for (const row of [...inGroup].sort(byName)) lines.push(`| ${row.name} | ${row.state} | ${row.note ?? ""} |`);
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
