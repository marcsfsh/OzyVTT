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
import { toolAbility } from "./ability-checks.js";
import { builtinActionsFor, withTakenActions } from "./builtin-actions.js";
import { modifierDisposition } from "./character-build.js";
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
 * it), guided (the app tracks it or applies part of it, and a person applies the rest) or reference (the app shows
 * the text and applies nothing). Records are classified from the mechanics their bundle carries, because the engine
 * is data-driven; the curated tables cover what data can't say (conditions, the glossary, monster traits), records
 * the engine handles in code and records whose data applies only part of the rule. A freshness test fails when this
 * drifts, and a few curated claims are checked against the engine.
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
      effect.endsConditions !== undefined ||
      effect.dispel !== undefined ||
      effect.endsCurses === true ||
      effect.reaction !== undefined ||
      effect.darts !== undefined ||
      (effect.laterActions ?? []).some(laterApplies));
  const saveApplies =
    spell.save !== null &&
    (spell.save.failureConditions.length > 0 ||
      (effect?.damage.length ?? 0) > 0 ||
      spell.save.speedZero === true ||
      spell.save.failurePush !== undefined);
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
 * stat block's numbers. Guided when it resolves with a reminder of what is left to the GM, or the app only tracks it
 * (a legendary cost, a recharge, a Multiattack read as prose).
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
  // A reminder is what the engine leaves to the GM when the action resolves, so the action applies only in part.
  if (actionResolves(withTakenActions(action)) || offered) return action.reminder ? "guided" : "enforced";
  return floor;
}

type Riders = Pick<FeatureRecord, "actions" | "effects" | "modifiers" | "grants" | "uses" | "tags">;
type Modifier = Riders["modifiers"][number];

/** A modifier something reads in play (`modifierDisposition`). A rest regain only says how a feature's own uses come
 *  back, so it applies the feature when that is all the feature does (Font of Inspiration). */
const modifierApplies = (riders: Riders) => (modifier: Modifier) => {
  const disposition = modifierDisposition(modifier.type);
  if (disposition === "unread" || disposition === "display-only") return false;
  return modifier.type !== "short-rest-regain" || riders.actions.length === 0;
};

/** A modifier nothing reads yet (a spell attack bonus, a sense): its record applies in part at most. */
const unreadModifier = (riders: Riders) =>
  riders.modifiers.some((modifier) => modifierDisposition(modifier.type) === "unread" || modifier.type === "sense");

const ridersApply = (riders: Riders) =>
  riders.actions.some(actionResolves) ||
  riders.effects.length > 0 ||
  riders.modifiers.some(modifierApplies(riders)) ||
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
  if (ridersApply(feature) || pickApplies || buildApplies) return unreadModifier(feature) ? "guided" : "enforced";
  if (feature.uses !== undefined || feature.actions.length > 0 || picks.length > 0) return "guided";
  return "reference";
}

/** An item is enforced when it is a weapon or armor or carries riders, a scroll's spell or ammunition. An item that
 *  casts spells takes the state of the spells it casts, as a stat block's casting does. Guided when the app only
 *  tracks it (attunement, charges, a curse, an action that only spends a use), uses it as a base weapon or armor
 *  without its magic, or rolls its checks (a tool). */
export function itemState(item: EquipmentReference, spellStates: ReadonlyMap<string, CoverageState>): CoverageState {
  // A magic weapon or armor with no rider of its own is only its base, so its magic is the GM's.
  const base = (item.weapon ?? null) !== null || (item.armor ?? null) !== null;
  const applies =
    (base && !item.isMagic) ||
    item.grantsFeatIds.length > 0 ||
    (item.ammunition ?? null) !== null ||
    item.spellScroll !== undefined ||
    item.removesArmorDrawbacks === true ||
    ridersApply(item);
  if (applies) return unreadModifier(item) ? "guided" : "enforced";
  const casts = item.casts.map((cast) => spellStates.get(cast.spellId) ?? "reference");
  // A tool's checks roll with the ability its entry names and the sheet's proficiency; the GM sets what they do.
  const tool = item.category === "tool" && toolAbility(item.description) !== null;
  const tracked =
    tool ||
    base ||
    (item.appliesTo ?? null) !== null ||
    item.attunement?.required === true ||
    (item.charges ?? null) !== null ||
    item.cursed ||
    item.uses !== undefined ||
    item.actions.length > 0;
  return most([...casts, tracked ? "guided" : "reference"]);
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
    for (const feature of record.features) {
      // A feature printed again at higher levels (Unarmored Movement) is told apart by its level.
      const repeated = record.features.filter((other) => other.name === feature.name).length > 1;
      rows.push({
        group: `${record.name} features`,
        id: `${record.id}/${feature.id}`,
        name: repeated ? `${feature.name} (level ${feature.level})` : feature.name,
        ...curatedOr(`feature:${feature.id}`, featureState(feature))
      });
    }
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
  for (const species of loadSpecies()) {
    // A lineage's trait is named for the lineage, since two lineages can print the same trait (Breath Weapon (Acid)).
    const traits = [
      ...species.traits.map((feature) => ({ feature, of: species.name })),
      ...species.lineages.flatMap((lineage) => lineage.traits.map((feature) => ({ feature, of: lineage.name })))
    ];
    for (const { feature, of } of traits)
      rows.push({
        group: "Species traits",
        id: `${species.id}/${feature.id}`,
        name: `${feature.name} (${of})`,
        ...curatedOr(`feature:${feature.id}`, featureState(feature))
      });
  }
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
    rows.push({
      group: "Magic items",
      id: item.id,
      name: item.name,
      ...curatedOr(`item:${item.id}`, itemState(item, spellStates))
    });
  // The equipment catalog folds in weapons, armor and magic items, which have their own groups.
  const gear = loadEquipment().filter((item) => !item.isMagic && item.weapon === null && item.armor === null);
  for (const item of gear)
    rows.push({
      group: "Gear and tools",
      id: item.id,
      name: item.name,
      ...curatedOr(`item:${item.id}`, itemState(item, spellStates))
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

// Numeric, so Unarmored Movement (level 2) comes before (level 10).
const byName = (a: CoverageRow, b: CoverageRow) => a.name.localeCompare(b.name, "en", { numeric: true });
const capitalized = (state: CoverageState) => `${state[0]!.toUpperCase()}${state.slice(1)}`;

/** Groups whose every row is curated: they print as one table with the notes. */
const TABLE_GROUPS = new Set(["Monster traits", "Conditions", "Rules glossary"]);

/** How the rows of each kind of group get their state, for the page's opening. */
const CLASSIFICATION = [
  "- **Spells:** a cast resolves in `action-resolution.ts` and the steps in `resolution/`, at the caster's own",
  "  numbers. A spell is enforced when its cast applies its attack, save, damage, healing or lasting effect, ends",
  "  spells or curses (`resolution/dispel.ts`), or when the area it leaves applies them as creatures enter it or",
  "  start or end a turn there (`spell-zones.ts`).",
  "  Guided when the app spends the slot and holds the Concentration, the area or a save while a person applies",
  "  what the spell does. A spell whose cast leaves a rider to the table (Storm of Vengeance's later turns) is",
  "  curated as guided, with a note.",
  "- **Monster actions:** enforced when the attack, save, damage, healing or effect resolves, or when the server",
  "  offers the action as the generic action it names (Nimble Escape's Disengage or Hide). An action that casts",
  "  spells takes the state of the spells it casts, each a cast action at the stat block's numbers. Guided when the",
  "  server resolves it and reminds the GM of the rest, or only counts a use, a legendary cost or a recharge.",
  "- **Class features, species traits and feats:** enforced when their riders (an action that resolves, an",
  "  effect, a modifier the engine reads, a grant) or the builder's picks apply them. Guided when the app counts",
  "  their uses or offers an action that only spends a use, or when part of what they do is left to a person.",
  "- **Magic items and gear:** enforced for weapons, armor, ammunition, Spell Scrolls and items whose riders",
  "  apply. An item that casts spells takes the state of the spells it casts. Guided when the app only tracks",
  "  Attunement, charges or a curse, or binds the item to a base weapon or armor without its magic. Tools are",
  "  guided too: the server rolls their checks, and the GM sets what they achieve.",
  "- **Backgrounds, weapons and armor:** enforced. The builder applies a background, and every weapon and armor",
  "  statistic reaches the rolls.",
  "- **Monster traits, conditions and the rules glossary:** curated by hand, each with a note.",
  "",
  "Records the data can't classify, because the engine handles them in code or their data applies only part of",
  "what they do, are curated too (`RECORD_OVERRIDES`). Each group lists their notes after its records."
];

export function renderSrdCoverage(): string {
  const rows = srdCoverageRows();
  const groups = [...new Set(rows.map((row) => row.group))];
  const counts = (inGroup: readonly CoverageRow[]) =>
    STATES.map((state) => inGroup.filter((row) => row.state === state).length).join(" | ");
  const lines: string[] = [
    "# SRD 5.2.1 coverage (generated, do not edit by hand)",
    "",
    "This page lists every record in the SRD 5.2.1 content and says what the app does with it. Each record is in",
    "one of three states:",
    "",
    "- **Enforced:** the server applies it in play. The GM may still supply a fact the map can't see, such as a",
    "  creature's line of sight or its degree of cover, and a note names any narrative part left to the table.",
    "- **Guided:** the app tracks it or applies part of it, and a person applies the rest. It may count a use, open a",
    "  prompt, roll a check or post a reminder. The note says which part is the table's.",
    "- **Reference:** the app shows the text and applies nothing.",
    "",
    "A note names the module that applies a record, so it can be checked in the code. Enforcement follows the",
    "table's rules policy: under advise the server warns where it would refuse, and under off it says nothing.",
    "",
    "Regenerate this page with `npm run map`. A test (`apps/server/test/srd-coverage.test.ts`) fails when the page",
    "is stale, when a curated row is missing or names a record that no longer exists, and when a sampled claim",
    "stops matching the engine. Known gaps in enforced records are GitHub issues.",
    "",
    "## Summary",
    "",
    "| Records | Enforced | Guided | Reference |",
    "| --- | --- | --- | --- |",
    ...groups.map((group) => {
      const inGroup = rows.filter((row) => row.group === group);
      return `| ${group} (${inGroup.length}) | ${counts(inGroup)} |`;
    }),
    `| All records (${rows.length}) | ${counts(rows)} |`,
    "",
    "## How records are classified",
    "",
    "Most records are classified from the mechanics their content bundle carries, because the engine is data-driven",
    "(`apps/server/src/srd-coverage.ts`); the rest are curated (`apps/server/src/srd-coverage-curated.ts`).",
    "",
    ...CLASSIFICATION,
    ""
  ];
  for (const group of groups) {
    const inGroup = [...rows.filter((row) => row.group === group)].sort(byName);
    lines.push(`## ${group}`, "");
    if (group === "Monster traits") lines.push("The number after each trait is how many stat blocks print it.", "");
    if (TABLE_GROUPS.has(group)) {
      lines.push("| Record | State | How |", "| --- | --- | --- |");
      for (const row of inGroup) lines.push(`| ${row.name} | ${row.state} | ${row.note ?? ""} |`);
      lines.push("");
      continue;
    }
    for (const state of STATES) {
      const inState = inGroup.filter((row) => row.state === state);
      if (inState.length === 0) continue;
      // Hundreds of enforced monster actions would bury the few that aren't, so they are counted.
      const body =
        group === "Monster actions" && state === "enforced"
          ? "too many to list, so the guided and reference actions below stand out."
          : inState.map((row) => row.name).join(" · ");
      lines.push(`**${capitalized(state)} (${inState.length}):** ${body}`, "");
    }
    const noted = inGroup.filter((row) => row.note !== undefined);
    if (noted.length > 0) {
      lines.push("Notes on the curated rows:", "", "| Record | State | How |", "| --- | --- | --- |");
      for (const row of noted) lines.push(`| ${row.name} | ${row.state} | ${row.note} |`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
