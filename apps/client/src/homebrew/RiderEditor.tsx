/**
 * The rider sub-form, shared by features, items and stat blocks, because the server defines one
 * rider vocabulary (`featureRiders`). Carriers differ only through `scope`, `enabled` and `labels`:
 * an item never asks a choice, its `uses` read as "Charges", and its riders (including `grants`)
 * apply only while equipped (and attuned, if required). Item contributions are recomputed from the
 * inventory on every write, which is what removes them on unequip.
 *
 * The word "trigger" never appears on screen: gating conditions show as three `<optgroup>`s
 * labelled with the phrase each completes (Only while…, Only when…, Only for…).
 */

import { useMemo } from "react";
import { CONDITION_IDS, DAMAGE_TYPE_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { Chip, Field, FieldGrid, RowEditor, Select, TagInput } from "@vtt/ui";
import { newId } from "../lib/ids";
import { CatalogPicker } from "./CatalogPicker";
import { FieldRenderer } from "./FieldRenderer";
import {
  damagePartsField,
  diceValidate,
  grouped,
  opt,
  suggestionLabel,
  type Draft,
  type FieldDef,
  type SchemaContext,
  type SelectOption
} from "./schema";

export type RiderKind = "modifiers" | "grants" | "uses" | "tags" | "actions" | "effects";

/** Which carrier mounts this form. A stat block's attack is `ActionSchema.attack` with a required
    flat `bonus`, while feature and item actions (`FeatureActionSchema`) name an `ability`, so scope
    is three-valued. `"item"` is feature-shaped for actions and differs only in carrier rules. */
export type RiderScope = "feature" | "item" | "statblock";

const ABILITIES = [
  opt("str", "Strength"),
  opt("dex", "Dexterity"),
  opt("con", "Constitution"),
  opt("int", "Intelligence"),
  opt("wis", "Wisdom"),
  opt("cha", "Charisma")
];

/* Riders name damage types and conditions from the SRD's closed sets, so these are choices, never free text. */
const DAMAGE_TYPES: readonly SelectOption[] = DAMAGE_TYPE_IDS.map((id) => opt(id, suggestionLabel(id)));
const CONDITIONS: readonly SelectOption[] = CONDITION_IDS.map((id) => opt(id, suggestionLabel(id)));

const SIZES = [
  opt("tiny", "Tiny"),
  opt("small", "Small"),
  opt("medium", "Medium"),
  opt("large", "Large"),
  opt("huge", "Huge"),
  opt("gargantuan", "Gargantuan")
];

/* ------------------------------------------------------- gating conditions ------ */

/** The gating conditions, grouped as the GM reads them. `kind` is internal: it backs the two
    structural rules (at most one moment; a filter needs a moment), which `publishBlockedReason`
    enforces, and decides whether a rider is a standing sheet number or a note at roll time. */
type TriggerKind = "gate" | "moment" | "filter";

const WHILE = grouped("Only while…");
const WHEN = grouped("Only when…");
const FOR = grouped("Only for…");

const TRIGGER_TYPES: readonly SelectOption[] = [
  // Gates: resolvable from the sheet, so the rider stays a real sheet number.
  WHILE("attuned", "It's attuned"),
  WHILE("while-armored", "Wearing armour"),
  WHILE("while-unarmored", "Not wearing armour"),
  WHILE("while-shield", "Holding a shield"),
  WHILE("while-character-is", "A certain class or species"),
  WHILE("while-proficient-with", "Proficient with something"),
  WHILE("while-effect-tag", "Under an effect"),
  WHILE("while-hp-at-or-below", "Low on hit points"),
  WHILE("while-condition", "Under a condition"),
  // Moments: the named roll or event. At most one per rider.
  WHEN("on-attack-roll", "Making an attack roll"),
  WHEN("on-hit", "An attack hits"),
  WHEN("on-critical-hit", "Scoring a critical hit"),
  WHEN("on-damage-roll", "Rolling damage"),
  WHEN("on-saving-throw", "Making a saving throw"),
  WHEN("on-ability-check", "Making an ability check"),
  WHEN("on-initiative-roll", "Rolling initiative"),
  WHEN("on-taking-damage", "Taking damage"),
  // Filters: narrow the accompanying moment.
  FOR("attack-kind-is", "A kind of attack"),
  FOR("weapon-property-is", "A weapon property"),
  FOR("damage-type-is", "A damage type"),
  FOR("ability-is", "One ability"),
  FOR("skill-is", "One skill"),
  FOR("spell-school-is", "A school of magic"),
  FOR("spell-level-is", "A spell level"),
  FOR("spell-id-is", "One specific spell"),
  FOR("versus-size", "A target's size"),
  FOR("versus-condition", "A target's condition"),
  FOR("versus-creature-type", "A target's kind")
];

const TRIGGER_KINDS: Readonly<Record<string, TriggerKind>> = Object.fromEntries(
  TRIGGER_TYPES.map(
    (entry) =>
      [entry.value, entry.group === "Only when…" ? "moment" : entry.group === "Only for…" ? "filter" : "gate"] as const
  )
);

export const triggerKindOf = (type: unknown): TriggerKind | null => TRIGGER_KINDS[String(type ?? "")] ?? null;
export const triggerLabelOf = (type: unknown): string =>
  TRIGGER_TYPES.find((entry) => entry.value === String(type ?? ""))?.label ?? "A condition";

/** Switching condition replaces the row: the union is `.strict()`, so leftover keys fail the parse. */
function blankTrigger(type: string): Draft {
  switch (type) {
    case "while-armored":
      return { type };
    case "while-unarmored":
      return { type, allowShield: false };
    case "while-shield":
      return { type, wielding: true };
    case "while-character-is":
      return { type, classIds: [], speciesIds: [] };
    case "while-proficient-with":
      return { type, kind: "weapon", ids: [] };
    case "while-effect-tag":
      return { type, tags: [] };
    case "while-hp-at-or-below":
      return { type, percent: 50 };
    case "while-condition":
      return { type, conditionIds: [], present: true };
    case "attack-kind-is":
      return { type, kinds: [] };
    case "weapon-property-is":
      return { type, properties: [] };
    case "damage-type-is":
      return { type, damageTypes: [] };
    case "ability-is":
      return { type, abilities: [] };
    case "skill-is":
      return { type, skills: [] };
    case "spell-school-is":
      return { type, schools: [] };
    case "spell-level-is":
      return { type, levels: [] };
    case "spell-id-is":
      return { type, spellIds: [] };
    case "versus-size":
      return { type, sizes: [] };
    case "versus-condition":
      return { type, conditionIds: [] };
    case "versus-creature-type":
      return { type, creatureTypes: [] };
    default:
      return { type };
  }
}

const hasType =
  (...types: readonly string[]) =>
  (row: Draft) =>
    types.includes(String(row.type ?? ""));

/** These fields are ids (`ContentIdSchema`, `/^[a-z0-9-]+$/`), validated while typing. Also used for
    `FeatureEditor`'s `extraPicks` column id. */
export const slugValidate = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "" || /^[a-z0-9-]+$/.test(text)) return null;
  return `Write it as ${
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "lowercase-with-dashes"
  } — lowercase, no spaces.`;
};

/** A collapsed row's label, e.g. "Only for: A damage type — fire, cold". */
function triggerRowLabel(row: Draft): string {
  const name = triggerLabelOf(row.type);
  const values = [
    row.weights,
    row.classIds,
    row.speciesIds,
    row.ids,
    row.tags,
    row.conditionIds,
    row.kinds,
    row.properties,
    row.damageTypes,
    row.abilities,
    row.skills,
    row.schools,
    row.levels,
    row.spellIds,
    row.sizes,
    row.creatureTypes
  ]
    .filter(Array.isArray)
    .flat()
    .map(String);
  if (values.length > 0) return `${name} — ${values.slice(0, 3).join(", ")}${values.length > 3 ? "…" : ""}`;
  if (typeof row.percent === "number") return `${name} — ${row.percent}% or less`;
  if (row.type === "while-shield") return row.wielding === false ? "Not holding a shield" : name;
  return name;
}

/** The gating list as a nested `rows` field on one modifier. */
const whenField = (): FieldDef => ({
  key: "when",
  label: "When it applies",
  kind: "rows",
  wide: true,
  help: "Leave this empty and it always applies; everything you add has to be true at once.",
  addLabel: "Add a condition",
  emptyText: "Always.",
  maxRows: 4,
  maxRowsReason: "Four conditions is as many as one modifier carries.",
  rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
  newRow: () => ({ rowId: newId(), ...blankTrigger("attuned") }),
  rowLabel: (row) => triggerRowLabel(row as Draft),
  rows: [
    {
      key: "type",
      label: "Condition",
      kind: "select",
      options: TRIGGER_TYPES,
      write: (next, row) => ({ rowId: (row as { rowId?: string }).rowId ?? newId(), ...blankTrigger(String(next)) })
    },
    {
      key: "weights",
      label: "Armour weight",
      kind: "multiselect",
      options: [opt("light", "Light"), opt("medium", "Medium"), opt("heavy", "Heavy")],
      visibleWhen: hasType("while-armored"),
      help: "Leave all off for any armour.",
      // `weights` is `.min(1)` when present, so "any armour" means the key is absent, not `[]`.
      write: (next, row) => {
        const chosen = next as string[];
        if (chosen.length > 0) return { ...row, weights: chosen };
        const cleared = { ...row };
        delete cleared.weights;
        return cleared;
      }
    },
    {
      key: "allowShield",
      label: "A shield still counts as unarmoured",
      kind: "switch",
      visibleWhen: hasType("while-unarmored")
    },
    {
      key: "wielding",
      label: "The shield is",
      kind: "select",
      options: [opt("true", "In hand"), opt("false", "Not in hand")],
      visibleWhen: hasType("while-shield"),
      read: (row) => String(row.wielding !== false),
      write: (next, row) => ({ ...row, wielding: next === "true" })
    },
    {
      key: "classIds",
      label: "Classes",
      kind: "multiselect",
      options: (ctx) => ctx.classes,
      visibleWhen: hasType("while-character-is")
    },
    {
      key: "speciesIds",
      label: "Species",
      kind: "multiselect",
      options: (ctx) => ctx.species,
      visibleWhen: hasType("while-character-is")
    },
    {
      key: "kind",
      label: "Proficient with",
      kind: "select",
      options: [opt("weapon", "A weapon"), opt("armor", "Armour"), opt("tool", "A tool"), opt("skill", "A skill")],
      visibleWhen: hasType("while-proficient-with")
    },
    {
      key: "ids",
      label: "Which",
      kind: "tags",
      visibleWhen: hasType("while-proficient-with"),
      placeholder: "longsword"
    },
    {
      key: "tags",
      label: "Effect tags",
      kind: "tags",
      visibleWhen: hasType("while-effect-tag"),
      suggestions: ["raging", "blessed", "concentrating", "inspired"]
    },
    {
      key: "percent",
      label: "Hit points at or below",
      kind: "number",
      min: 1,
      max: 99,
      unit: "%",
      visibleWhen: hasType("while-hp-at-or-below")
    },
    {
      key: "conditionIds",
      label: "Conditions",
      kind: "multiselect",
      options: CONDITIONS,
      visibleWhen: hasType("while-condition", "versus-condition")
    },
    {
      key: "present",
      label: "It has the condition",
      kind: "switch",
      visibleWhen: hasType("while-condition"),
      help: "Turn off for “only while you don't have it”."
    },
    {
      key: "kinds",
      label: "Kinds of attack",
      kind: "multiselect",
      options: [
        opt("melee", "Melee"),
        opt("ranged", "Ranged"),
        opt("spell", "Spell"),
        opt("unarmed", "Unarmed"),
        opt("thrown", "Thrown"),
        opt("reaction", "Reaction"),
        opt("opportunity", "Opportunity")
      ],
      visibleWhen: hasType("attack-kind-is")
    },
    {
      key: "properties",
      label: "Weapon properties",
      kind: "tags",
      visibleWhen: hasType("weapon-property-is"),
      suggestions: (ctx) => ctx.weaponProperties
    },
    {
      key: "damageTypes",
      label: "Damage types",
      kind: "multiselect",
      options: DAMAGE_TYPES,
      visibleWhen: hasType("damage-type-is")
    },
    {
      key: "abilities",
      label: "Abilities",
      kind: "multiselect",
      options: ABILITIES,
      visibleWhen: hasType("ability-is")
    },
    {
      key: "skills",
      label: "Skills",
      kind: "multiselect",
      options: (ctx) => ctx.skills,
      visibleWhen: hasType("skill-is")
    },
    {
      key: "schools",
      label: "Schools",
      kind: "tags",
      visibleWhen: hasType("spell-school-is"),
      suggestions: (ctx) => ctx.schools
    },
    {
      key: "levels",
      label: "Spell levels",
      kind: "multiselect",
      options: Array.from({ length: 10 }, (_, level) => opt(String(level), level === 0 ? "Cantrip" : `Level ${level}`)),
      visibleWhen: hasType("spell-level-is"),
      read: (row) => (Array.isArray(row.levels) ? row.levels.map(String) : []),
      write: (next, row) => ({ ...row, levels: (next as string[]).map(Number) })
    },
    {
      key: "spellIds",
      label: "Spells",
      kind: "tags",
      visibleWhen: hasType("spell-id-is"),
      suggestions: (ctx) => ctx.spells.map((entry) => entry.id),
      help: "Only when this exact spell is cast — “when you cast Eldritch Blast”. A school or a level names a category; this names one."
    },
    { key: "sizes", label: "Sizes", kind: "multiselect", options: SIZES, visibleWhen: hasType("versus-size") },
    {
      key: "creatureTypes",
      label: "Kinds of creature",
      kind: "tags",
      visibleWhen: hasType("versus-creature-type"),
      suggestions: (ctx) => ctx.creatureTypes,
      help: "Read from the target's stat block. A character has no kind recorded, so it never matches one."
    }
  ]
});

/* ------------------------------------------------------------- modifiers -------- */

/** The typed modifiers, in four groups: a bounded union (ADR-0008); anything else stays prose.
    `note` marks variants that parse but that nothing reads yet. */
const ROLLS = grouped("Rolls");
const HARM = grouped("Damage and defence");
const MAGIC = grouped("Spellcasting");
const SELF = grouped("The character");

const MODIFIER_TYPES: readonly SelectOption[] = [
  ROLLS("attack-bonus", "Attack rolls"),
  ROLLS("save-bonus", "Saving throws"),
  ROLLS("check-bonus", "Ability checks"),
  ROLLS("initiative", "Initiative"),
  ROLLS("roll-mode", "Advantage or disadvantage"),
  HARM("damage-bonus", "Damage rolls"),
  HARM("extra-damage", "Extra damage"),
  HARM("critical-range", "Critical hit range"),
  HARM("critical-bonus-dice", "Extra dice on a critical hit"),
  HARM("damage-reduction", "Damage taken"),
  HARM("armor-class", "Armour class"),
  HARM("unarmored-defense", "Unarmoured defence"),
  HARM("hit-points-per-level", "Hit points per level"),
  MAGIC("spell-save-dc", "Spell save DC"),
  MAGIC("spell-attack-bonus", "Spell attack rolls"),
  MAGIC("spell-slot", "Spell slots"),
  SELF("ability-score", "Ability score"),
  SELF("speed", "Speed"),
  SELF("extra-attack", "Extra attack"),
  SELF("darkvision", "Darkvision"),
  SELF("sense", "Another sense"),
  SELF("resource-bonus", "A limited-use pool")
];

/** The GM-facing word for a modifier type, used by publish blockers. */
export const modifierLabel = (type: unknown): string =>
  MODIFIER_TYPES.find((entry) => entry.value === String(type ?? ""))?.label ?? "a modifier";

/** Switching variant replaces the row: the union is `.strict()`, so leftover keys fail the parse. */
function blankModifier(type: string): Draft {
  switch (type) {
    case "ability-score":
      return { type, ability: "str", amount: 1 };
    case "hit-points-per-level":
      return { type, amount: 1 };
    case "speed":
      return { type, amount: 10 };
    case "armor-class":
      return { type, amount: 1, whileArmored: false };
    case "initiative":
      return { type, amount: 1 };
    case "extra-attack":
      return { type, count: 1 };
    case "unarmored-defense":
      return { type, ability: "con", allowShield: false };
    case "darkvision":
      return { type, feet: 60 };
    case "attack-bonus":
      return { type, amount: 1 };
    case "damage-bonus":
      return { type, amount: 1 };
    case "save-bonus":
      return { type, amount: 1 };
    case "check-bonus":
      return { type, amount: 1 };
    case "extra-damage":
      return { type, formula: "1d6", damageType: "", doubleOnCritical: false };
    case "roll-mode":
      return { type, roll: "attack", mode: "advantage" };
    case "spell-save-dc":
      return { type, amount: 1 };
    case "spell-attack-bonus":
      return { type, amount: 1 };
    case "spell-slot":
      return { type, level: 1, amount: 1 };
    case "resource-bonus":
      return { type, poolId: "", amount: 1 };
    case "critical-range":
      return { type, threshold: 19 };
    case "critical-bonus-dice":
      return { type, count: 1 };
    case "damage-reduction":
      return { type, amount: 1 };
    case "sense":
      return { type, sense: "", feet: 30 };
    default:
      return { type };
  }
}

/** Riders that default to "this weapon" on a weapon and "everything" elsewhere; a weapon gets one
    switch to broaden them. */
const WEAPON_SCOPED = ["attack-bonus", "damage-bonus", "extra-damage", "critical-range", "critical-bonus-dice"];

/** Riders `EquipmentReferenceSchema` refuses on an item, so they are not offered there. Neither can
    be layered over a sheet: hit points would strand `hp.current` above maximum on unequip, and an
    ability score cascades into values read from the baked scores. */
const ITEM_REFUSED = ["ability-score", "hit-points-per-level"];

/** The rolls a roll-mode variant can target; `RollModeVariantSchema` is shared by modifiers and effects. */
const ROLL_MODE_ROLLS: readonly SelectOption[] = [
  opt("attack", "Attack rolls"),
  opt("incoming-attack", "Attacks against you"),
  opt("save", "Saving throws"),
  opt("check", "Ability checks"),
  opt("initiative", "Initiative"),
  opt("concentration", "Concentration")
];
const ROLL_MODE_WAYS: readonly SelectOption[] = [opt("advantage", "Advantage"), opt("disadvantage", "Disadvantage")];

const signed = (amount: number) => `${amount >= 0 ? "+" : ""}${amount}`;

const modifiersField = (label: string, scope: RiderScope): FieldDef => ({
  key: "modifiers",
  label,
  kind: "rows",
  addLabel: "Add a modifier",
  emptyText: "No modifiers yet.",
  maxRows: 8,
  maxRowsReason: "Eight modifiers is as many as one record carries.",
  rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
  newRow: () => ({ rowId: newId(), ...blankModifier("armor-class") }),
  rowLabel: (row) => {
    const modifier = row as Record<string, unknown>;
    const name = MODIFIER_TYPES.find((entry) => entry.value === modifier.type)?.label ?? "Modifier";
    if (modifier.type === "roll-mode")
      return `${modifier.mode === "disadvantage" ? "Disadvantage" : "Advantage"} on ${String(modifier.roll ?? "attack").replace(/-/g, " ")}`;
    if (modifier.type === "extra-damage")
      return `${name} ${modifier.formula ?? ""} ${modifier.damageType ?? ""}`.trim();
    if (modifier.type === "spell-slot")
      return `${name} ${signed(Number(modifier.amount ?? 0))} at level ${modifier.level ?? 1}`;
    const amount = modifier.amount ?? modifier.count ?? modifier.feet ?? modifier.threshold;
    return typeof amount === "number" ? `${name} ${signed(amount)}` : name;
  },
  rows: [
    {
      key: "type",
      label: "What it changes",
      kind: "select",
      // The refusal belongs to the item carrier; a stat block is not an item.
      options:
        scope === "item" ? MODIFIER_TYPES.filter((entry) => !ITEM_REFUSED.includes(entry.value)) : MODIFIER_TYPES,
      // Replace the whole row so no key from the previous variant survives.
      write: (next, row) => ({ rowId: (row as { rowId?: string }).rowId ?? newId(), ...blankModifier(String(next)) })
    },
    {
      key: "ability",
      label: "Ability",
      kind: "select",
      options: ABILITIES,
      visibleWhen: hasType("ability-score", "unarmored-defense")
    },
    /* One `amount` field per bound set, because each variant declares its own server-side range;
       `visibleWhen` makes them mutually exclusive. All amounts are signed (negative for curses). */
    {
      key: "amount",
      label: "Amount",
      kind: "number",
      allowNegative: true,
      min: -5,
      max: 5,
      help: "Negative for a curse.",
      visibleWhen: hasType(
        "ability-score",
        "hit-points-per-level",
        "armor-class",
        "spell-save-dc",
        "spell-attack-bonus"
      )
    },
    /* On a feature the builder bakes this into `speedFeet`; on an item it joins the movement budget
       while the item is worn. */
    {
      key: "amount",
      label: "Amount",
      kind: "number",
      allowNegative: true,
      min: -30,
      max: 60,
      unit: "ft",
      help: "Negative for a curse.",
      visibleWhen: hasType("speed")
    },
    {
      key: "amount",
      label: "Amount",
      kind: "number",
      allowNegative: true,
      min: -5,
      max: 10,
      help: "Negative for a curse.",
      visibleWhen: hasType("initiative")
    },
    {
      key: "amount",
      label: "Amount",
      kind: "number",
      allowNegative: true,
      min: -10,
      max: 10,
      help: "Negative for a curse.",
      visibleWhen: hasType("attack-bonus", "damage-bonus", "save-bonus", "check-bonus")
    },
    {
      key: "amount",
      label: "Extra slots",
      kind: "number",
      allowNegative: true,
      min: -4,
      max: 4,
      visibleWhen: hasType("spell-slot")
    },
    {
      key: "amount",
      label: "Extra uses",
      kind: "number",
      allowNegative: true,
      min: -20,
      max: 20,
      visibleWhen: hasType("resource-bonus")
    },
    {
      key: "amount",
      label: "Damage reduced by",
      kind: "number",
      min: 1,
      max: 30,
      visibleWhen: hasType("damage-reduction")
    },
    {
      key: "maximum",
      label: "Raises the cap to",
      kind: "number",
      min: 1,
      max: 30,
      visibleWhen: hasType("ability-score"),
      help: "Leave empty to keep the usual 20."
    },
    { key: "count", label: "Extra attacks", kind: "number", min: 1, max: 3, visibleWhen: hasType("extra-attack") },
    {
      key: "count",
      label: "Extra dice",
      kind: "number",
      min: 1,
      max: 4,
      visibleWhen: hasType("critical-bonus-dice"),
      help: "The weapon's own die, rolled again. For a typed extra like 1d6 fire, use Extra damage on a critical hit instead."
    },
    {
      key: "feet",
      label: "Distance",
      kind: "number",
      min: 0,
      max: 240,
      unit: "ft",
      visibleWhen: hasType("darkvision"),
      note: "Display only."
    },
    { key: "whileArmored", label: "Only while wearing armour", kind: "switch", visibleWhen: hasType("armor-class") },
    /* On an item nothing reads `unarmored-defense` (it is builder-baked from features and feats
       only), so items get a note; features and feats need none. */
    {
      key: "allowShield",
      label: "A shield still counts",
      kind: "switch",
      visibleWhen: hasType("unarmored-defense"),
      help: "On is the Barbarian's rule, off the Monk's — off, a shield replaces this defence with the ordinary 10 + Dexterity.",
      ...(scope === "item"
        ? { note: "Not read on an item — this defence only reaches a sheet from a feature or a feat." }
        : {})
    },
    {
      key: "formula",
      label: "Damage",
      placeholder: "1d6",
      validate: diceValidate,
      visibleWhen: hasType("extra-damage"),
      help: "Dice. Leave it empty to add only an ability modifier."
    },
    {
      key: "abilityModifier",
      label: "Plus an ability modifier",
      kind: "select",
      options: ABILITIES,
      emptyValue: "omit",
      visibleWhen: hasType("extra-damage"),
      help: "Adds the character's own modifier, resolved at the roll — “add your Charisma modifier to the damage”."
    },
    {
      key: "damageType",
      label: "Damage type",
      kind: "select",
      options: DAMAGE_TYPES,
      placeholder: "Choose a type",
      visibleWhen: hasType("extra-damage")
    },
    {
      key: "doubleOnCritical",
      label: "Doubled on a critical hit",
      kind: "switch",
      visibleWhen: hasType("extra-damage"),
      help: "Off is the 5e rule — dice added after the attack aren't doubled."
    },
    {
      key: "roll",
      label: "On which roll",
      kind: "select",
      options: ROLL_MODE_ROLLS,
      visibleWhen: hasType("roll-mode")
    },
    {
      key: "mode",
      label: "Which way",
      kind: "select",
      options: ROLL_MODE_WAYS,
      visibleWhen: hasType("roll-mode"),
      help: "Disadvantage is how a cursed item bites."
    },
    {
      key: "classId",
      label: "For one class only",
      kind: "select",
      options: (ctx) => ctx.classes,
      visibleWhen: hasType("spell-save-dc", "spell-attack-bonus"),
      help: "Leave empty for every class on the sheet."
    },
    { key: "level", label: "Slot level", kind: "stepper", min: 1, max: 9, visibleWhen: hasType("spell-slot") },
    {
      key: "poolId",
      label: "Which pool",
      placeholder: "lay-on-hands",
      validate: slugValidate,
      visibleWhen: hasType("resource-bonus"),
      help: "The shared-pool name a feature already uses. One more of whatever that pool counts."
    },
    {
      key: "threshold",
      label: "Critical hit on",
      kind: "number",
      min: 15,
      max: 20,
      visibleWhen: hasType("critical-range"),
      help: "20 is the usual. 19 gives a champion's improved critical."
    },
    {
      key: "sense",
      label: "Which sense",
      placeholder: "tremorsense",
      validate: slugValidate,
      visibleWhen: hasType("sense"),
      note: "Display only."
    },
    { key: "feet", label: "Distance", kind: "number", min: 0, max: 240, unit: "ft", visibleWhen: hasType("sense") },
    whenField(),
    {
      key: "scope",
      label: "Applies to everything the bearer does",
      kind: "switch",
      help: "Off means this weapon only, which is the usual.",
      // Only offered for an attack/damage rider on a weapon; elsewhere the default already covers the bearer.
      visibleWhen: (row, draft) => draft.weapon != null && WEAPON_SCOPED.includes(String(row.type ?? "")),
      read: (row) => row.scope === "bearer",
      write: (next, row) => (next === true ? { ...row, scope: "bearer" } : { ...row, scope: "this-item" })
    }
  ]
});

const usesField = (label: string, scope: RiderScope): FieldDef => ({
  key: "uses",
  label,
  kind: "group",
  // Only an item has charges. Stat blocks don't mount this (`ActorDefinitionSchema` has no record
  // `uses`); a creature's uses are on its actions, see `actionUsesField`.
  help:
    scope === "item"
      ? "Charges the item spends and gets back on a rest."
      : "How many times this can be used before a rest gives it back.",
  rows: [
    {
      // "Uses are …": each option completes this label.
      key: "mode",
      label: "Uses are",
      kind: "select",
      /** `class-resource` (a feature-only option) reads the count from the class table's column at the
          character's level. Items can't resolve it (`scaledLimit` returns `undefined`: a built
          definition has no class table), so it is not offered there. */
      options:
        scope === "feature"
          ? [
              opt("flat", "A flat number"),
              opt("proficiency-bonus", "Proficiency bonus"),
              opt("ability-modifier", "Ability modifier"),
              opt("by-level", "By level"),
              opt("class-resource", "A column on the class table")
            ]
          : [
              opt("flat", "A flat number"),
              opt("proficiency-bonus", "Proficiency bonus"),
              opt("ability-modifier", "Ability modifier"),
              opt("by-level", "By level")
            ],
      // `mode` is not stored; it is read back from the shape (`uses.scaling.type`, whose values match
      // the option values). Without `read` the select would always show "Not set". An item body with
      // a `class-resource` scaling reads as "Not set", since items can't resolve it.
      read: (scope_) => {
        const uses = scope_.uses as { limit?: unknown; scaling?: { type?: string } } | undefined;
        if (!uses) return undefined;
        return uses.scaling?.type ?? "flat";
      },
      write: (next, scope_) => {
        const uses = { ...(scope_.uses as Record<string, unknown> | undefined) };
        if (next === "flat") {
          delete uses.scaling;
          uses.limit ??= 1;
        } else if (next === "ability-modifier") {
          delete uses.limit;
          uses.scaling = { type: "ability-modifier", ability: "con", minimum: 1 };
        } else if (next === "by-level") {
          delete uses.limit;
          uses.scaling = { type: "by-level", table: [{ level: 1, limit: 1 }] };
        } else if (next === "class-resource") {
          delete uses.limit;
          // Seeded empty: a guessed id would silently point at another class's column, and the
          // checklist names the field until it is filled.
          uses.scaling = { type: "class-resource", id: "" };
        } else {
          delete uses.limit;
          uses.scaling = { type: "proficiency-bonus" };
        }
        uses.per ??= "long-rest";
        return { ...scope_, uses };
      }
    },
    {
      key: "uses.limit",
      label: "How many",
      kind: "number",
      min: 1,
      max: 20,
      visibleWhen: (scope_) => !(scope_.uses as { scaling?: unknown } | undefined)?.scaling,
      // `per` is required on the stored shape, so seed it when a count is typed first.
      write: (next, scope_) => {
        const uses = { ...(scope_.uses as Record<string, unknown> | undefined) };
        if (next === null || next === undefined) delete uses.limit;
        else uses.limit = next;
        if (uses.limit === undefined && uses.scaling === undefined) return { ...scope_, uses: undefined };
        uses.per ??= "long-rest";
        return { ...scope_, uses };
      }
    },
    {
      key: "uses.scaling.ability",
      label: "Which ability",
      kind: "select",
      options: ABILITIES,
      visibleWhen: (scope_) =>
        (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "ability-modifier"
    },
    {
      key: "uses.scaling.minimum",
      label: "At least",
      kind: "number",
      min: 0,
      max: 5,
      visibleWhen: (scope_) =>
        (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "ability-modifier"
    },
    // The `classResources` id from the level table (e.g. "rage"). A typo resolves to 0 uses, so it is
    // validated while typing. Absent (not hidden) at other scopes, which offer no `class-resource` mode.
    ...(scope === "feature"
      ? [
          {
            key: "uses.scaling.id",
            label: "Which column",
            placeholder: "rage",
            validate: slugValidate,
            help: "The column's id on the class's level table — the count is read from it at the character's own level.",
            visibleWhen: (scope_: Draft) =>
              (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "class-resource"
          }
        ]
      : []),
    {
      key: "uses.scaling.table",
      label: "By level",
      kind: "rows",
      visibleWhen: (scope_) =>
        (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "by-level",
      addLabel: "Add a level",
      emptyText: "No levels yet.",
      maxRows: 20,
      rowKey: (row, index) => `level-${(row as { level?: number }).level ?? index}`,
      newRow: () => ({ level: 1, limit: 1 }),
      rows: [
        { key: "level", label: "Level", kind: "number", min: 1, max: 20 },
        { key: "limit", label: "Uses", kind: "number", min: 0, max: 99 }
      ]
    },
    {
      key: "uses.per",
      label: "Comes back",
      kind: "select",
      options: [
        opt("turn", "Every turn"),
        opt("encounter", "Every encounter"),
        opt("short-rest", "On a short rest"),
        opt("long-rest", "On a long rest")
      ],
      // No "day" option: a long rest is this app's day.
      ...(scope === "item" ? { help: "A long rest is this table's day, so “once per day” is “on a long rest”." } : {})
    },
    // Anything naming the same pool shares one counter.
    {
      key: "uses.pool",
      label: "Shared pool",
      help:
        scope === "item"
          ? "Items and features sharing a pool share one counter."
          : "Features sharing a pool share one counter.",
      placeholder: "channel-divinity"
    }
  ]
});

/**
 * The to-hit half of an attack, the one place the carriers disagree. Features and items name an
 * `ability` (`FeatureAttackSchema`) and the builder resolves the number; a stat block has a required
 * flat `bonus` (`ActionSchema.attack`) and no `ability`. Offered instead of, not alongside, since
 * the other key would be stripped.
 */
const toHitFields = (scope: RiderScope): readonly FieldDef[] =>
  scope === "statblock"
    ? [
        {
          key: "attack.bonus",
          label: "To hit",
          kind: "number",
          allowNegative: true,
          min: -5,
          max: 20,
          help: "The flat bonus the stat block prints — the +9 in “+9 to hit”."
        }
      ]
    : [
        {
          key: "attack.ability",
          label: "Uses",
          kind: "select",
          options: [...ABILITIES, opt("spellcasting", "Spellcasting ability")]
        }
      ];

/**
 * An action's own limited uses (`ActionUsesSchema`), a different schema from the record-level
 * `FeatureUsesSchema` that `usesField` writes: `limit` is required, there is no `scaling`, and there
 * is a fifth `per` value, `"recharge"`, with a d6 threshold. All three carriers read it into
 * `ActorAction.uses`. `FeatureUsesSchema` is not widened to match because the builder does not
 * forward a threshold from record-level uses, which would make the character unbuildable.
 */
const ACTION_USES_PER: readonly SelectOption[] = [
  opt("turn", "Every turn"),
  opt("encounter", "Every encounter"),
  opt("short-rest", "On a short rest"),
  opt("long-rest", "On a long rest"),
  opt("recharge", "On a die roll")
];

const actionUses = (scope_: Draft) => ({ ...(scope_.uses as Record<string, unknown> | undefined) });

const actionUsesField = (): FieldDef => ({
  key: "uses",
  label: "Limited uses",
  kind: "group",
  help: "How many times this action can be used before something gives it back.",
  rows: [
    {
      key: "uses.limit",
      label: "How many",
      kind: "number",
      min: 1,
      max: 20,
      // `limit` is required and there is no `scaling`, so clearing the count removes the whole block.
      // `per` is seeded so a count typed first never publishes without recovery.
      write: (next, scope_) => {
        const uses = actionUses(scope_);
        if (next === null || next === undefined) return { ...scope_, uses: undefined };
        uses.limit = next;
        uses.per ??= "long-rest";
        return { ...scope_, uses };
      }
    },
    {
      key: "uses.per",
      label: "Comes back",
      kind: "select",
      options: ACTION_USES_PER,
      // Threshold and mode are one fact; the schema refuses either without the other. Switching to
      // recharge seeds 5 (the SRD's commonest) and switching away deletes it.
      write: (next, scope_) => {
        const uses = actionUses(scope_);
        if (next === null || next === undefined || next === "") {
          delete uses.per;
          delete uses.recharge;
          return uses.limit === undefined ? { ...scope_, uses: undefined } : { ...scope_, uses };
        }
        uses.per = next;
        uses.limit ??= 1;
        if (next === "recharge") uses.recharge ??= 5;
        else delete uses.recharge;
        return { ...scope_, uses };
      }
    },
    {
      key: "uses.recharge",
      label: "Recharges on",
      kind: "number",
      min: 2,
      max: 6,
      help: "A d6 at the start of its turn: 5 is a printed “Recharge 5–6”. The table sees the die either way.",
      visibleWhen: (scope_) => (scope_.uses as { per?: string } | undefined)?.per === "recharge"
    },
    {
      key: "uses.pool",
      label: "Shared pool",
      placeholder: "breath-weapon",
      validate: slugValidate,
      help: "Actions sharing a pool share one counter — and one recharge roll."
    }
  ]
});

const actionsField = (scope: RiderScope): FieldDef => ({
  key: "actions",
  label: "Actions",
  kind: "rows",
  help: "Something the sheet can roll.",
  addLabel: "Add an action",
  emptyText: "No actions yet.",
  maxRows: 8,
  maxRowsReason: "Eight actions is as many as one record carries.",
  rowKey: (row, index) => String((row as { id?: string }).id ?? index),
  newRow: () => ({ id: newId(), name: "", activation: "action", description: "", damage: [] }),
  rowLabel: (row) => (row as { name?: string }).name || "Unnamed action",
  rows: [
    { key: "name", label: "Name" },
    {
      key: "activation",
      label: "Costs",
      kind: "select",
      options: [
        opt("action", "An action"),
        opt("bonus-action", "A bonus action"),
        opt("reaction", "A reaction"),
        opt("other", "No action")
      ]
    },
    { key: "description", label: "Description", kind: "textarea", wide: true },
    damagePartsField("damage", { label: "Damage", max: 8, newId, help: "Every part is rolled on a hit." }),
    {
      key: "attack",
      label: "Attack roll",
      kind: "group",
      rows: [
        ...toHitFields(scope),
        { key: "attack.reachFeet", label: "Reach", kind: "number", min: 1, max: 120, unit: "ft" },
        {
          key: "attack.rangeFeet",
          label: "Range",
          kind: "number",
          min: 1,
          max: 1000,
          unit: "ft",
          help: "The farthest this can reach at all."
        },
        /* Normal range ("80" in "range 80/320"): past it, up to the range, the attack rolls at
           disadvantage (`action-resolution.ts`). Both attack schemas have this key. */
        {
          key: "attack.rangeNormalFeet",
          label: "Normal range",
          kind: "number",
          min: 1,
          max: 1000,
          unit: "ft",
          help: "The 80 in “range 80/320”. Past it, up to the range, the attack rolls at disadvantage."
        }
      ]
    },
    {
      key: "save",
      label: "Saving throw",
      kind: "group",
      rows: [
        { key: "save.ability", label: "Target rolls", kind: "select", options: ABILITIES },
        {
          key: "save.dc",
          label: "DC",
          kind: "number",
          min: 1,
          max: 40,
          help: "Leave empty to use the character's own spell save DC."
        }
      ]
    },
    actionUsesField()
  ]
});

/** Built here rather than inline so `riderFieldsForTest` can list the complete rider surface. */
const tagsField = (label: string): FieldDef => ({
  key: "tags",
  label,
  kind: "tags",
  help: "Grouping only — no mechanical effect."
});

/* ------------------------------------------------------- effect modifiers ------ */

/**
 * What an effect does: the same `ModifierSchema` as a feature's or an item's modifiers, gated the same way, read
 * by the same evaluator. An effect refuses what the sheet stores (`EFFECT_REFUSED_MODIFIER_TYPES`), and this
 * form offers the subset an effect is usually written with:
 * - `roll-mode` for advantage or disadvantage on a named roll (Reckless Attack, Dodge, Rage's Strength checks
 *   with an "Only for…" ability line).
 * - `damage-resistance` and `damage-vulnerability`.
 * - `speed`, summed live and given back when the effect ends.
 */
const EFFECT_MODIFIER_TYPES: readonly SelectOption[] = [
  ROLLS("roll-mode", "Advantage or disadvantage"),
  HARM("damage-resistance", "Resistance to damage"),
  HARM("damage-vulnerability", "Vulnerability to damage"),
  SELF("speed", "Speed")
];

/** The union is `.strict()`, so switching variant replaces the row. */
function blankEffectModifier(type: string): Draft {
  switch (type) {
    case "roll-mode":
      return { type, roll: "attack", mode: "advantage" };
    case "damage-resistance":
    case "damage-vulnerability":
      return { type, damageTypes: [] };
    case "speed":
      return { type, amount: 10 };
    default:
      return { type };
  }
}

const effectModifiersField = (): FieldDef => ({
  key: "modifiers",
  label: "What it does",
  kind: "rows",
  wide: true,
  help: "An effect with nothing here is a label the fight cannot feel.",
  addLabel: "Add a modifier",
  emptyText: "Nothing yet — this effect changes no numbers.",
  maxRows: 8,
  maxRowsReason: "Eight modifiers is as many as one effect carries.",
  rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
  newRow: () => ({ rowId: newId(), ...blankEffectModifier("roll-mode") }),
  rowLabel: (row) => {
    const modifier = row as Record<string, unknown>;
    const name = EFFECT_MODIFIER_TYPES.find((entry) => entry.value === modifier.type)?.label ?? "Modifier";
    if (modifier.type === "roll-mode")
      return `${modifier.mode === "disadvantage" ? "Disadvantage" : "Advantage"} on ${String(modifier.roll ?? "attack").replace(/-/g, " ")}`;
    // Feet only for `speed`; a stored `damage-bonus`/`attack-bonus` must not read as "+2 ft".
    if (modifier.type === "speed" && typeof modifier.amount === "number")
      return `${name} ${signed(modifier.amount)} ft`;
    const types = Array.isArray(modifier.damageTypes) ? modifier.damageTypes.map(String) : [];
    return types.length > 0 ? `${name} — ${types.slice(0, 3).join(", ")}${types.length > 3 ? "…" : ""}` : name;
  },
  rows: [
    {
      key: "type",
      label: "What it does",
      kind: "select",
      options: EFFECT_MODIFIER_TYPES,
      write: (next, row) => ({
        rowId: (row as { rowId?: string }).rowId ?? newId(),
        ...blankEffectModifier(String(next))
      })
    },
    {
      key: "roll",
      label: "On which roll",
      kind: "select",
      options: ROLL_MODE_ROLLS,
      visibleWhen: hasType("roll-mode")
    },
    {
      key: "mode",
      label: "Which way",
      kind: "select",
      options: ROLL_MODE_WAYS,
      visibleWhen: hasType("roll-mode"),
      help: "Disadvantage is how a curse bites."
    },
    // Same bounds as the build-time `speed` row, signed (Longstrider and the `slow` mastery are one row).
    {
      key: "amount",
      label: "Amount",
      kind: "number",
      allowNegative: true,
      min: -30,
      max: 60,
      unit: "ft",
      visibleWhen: hasType("speed"),
      help: "Negative for a curse. The bearer's Speed while this effect lasts, given back when it ends."
    },
    {
      key: "damageTypes",
      label: "Damage types",
      kind: "multiselect",
      options: DAMAGE_TYPES,
      visibleWhen: hasType("damage-resistance", "damage-vulnerability")
    },
    whenField()
  ]
});

/** The effects a record grants. How many the engine reads depends on the carrier: a feature applies
    only `effects[0]`, an item applies all (up to `featureRiders.effects`'s maximum of four), and a
    stat block's effect is a single `ActionSchema.grants`. */
const effectsField = (scope: RiderScope): FieldDef => ({
  key: "effects",
  label: "Effects",
  kind: "rows",
  // The cap reflects what the engine applies, per carrier.
  help:
    scope === "item"
      ? "Each of these applies while the item is equipped."
      : scope === "statblock"
        ? "A stat block's action carries one effect, not a list."
        : "Only the first effect is applied by the rules engine today.",
  addLabel: "Add an effect",
  emptyText: "No effects yet.",
  maxRows: scope === "item" ? 4 : 1,
  maxRowsReason:
    scope === "item"
      ? "Four effects is as many as one item carries."
      : scope === "statblock"
        ? "A stat block's action carries one effect, not a list."
        : "Only the first effect is applied by the rules engine today.",
  rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
  newRow: () => ({ rowId: newId(), name: "", tags: [], duration: { type: "encounter" }, modifiers: [], onEnd: [] }),
  rowLabel: (row) => (row as { name?: string }).name || "Unnamed effect",
  rows: [
    { key: "name", label: "Name" },
    {
      key: "tags",
      label: "Tags",
      kind: "tags",
      help: "The sheet groups effects by these.",
      suggestions: ["raging", "blessed", "concentrating", "inspired"]
    },
    {
      key: "duration.type",
      label: "Lasts",
      kind: "select",
      options: [
        opt("rounds", "A number of rounds"),
        opt("until-source-next-turn", "Until your next turn"),
        opt("encounter", "The whole encounter"),
        opt("manual", "Until removed by hand")
      ]
    },
    {
      key: "duration.rounds",
      label: "Rounds",
      kind: "number",
      min: 1,
      max: 100,
      visibleWhen: (row) => (row.duration as { type?: string } | undefined)?.type === "rounds"
    },
    { key: "concentration", label: "Needs concentration", kind: "switch" },
    // Nested `rows`, the same depth `whenField` renders at inside `modifiersField`.
    effectModifiersField()
  ]
});

/* ---------------------------------------------------------------- grants ------- */

/** `FeatureGrantsSchema`'s parallel arrays (skills, expertise, tools, …, spells) presented as one
    `[What][Which…]` list; the storage shape stays the server's. */
const GRANT_KINDS: ReadonlyArray<{ key: string; label: string; help?: string }> = [
  { key: "skills", label: "Skills" },
  { key: "expertise", label: "Expertise", help: "Expertise needs proficiency in the same skill from somewhere." },
  { key: "tools", label: "Tools" },
  { key: "languages", label: "Languages" },
  { key: "armor", label: "Armour" },
  { key: "weapons", label: "Weapons" },
  { key: "saves", label: "Saving throws" },
  { key: "damageResistances", label: "Damage resistances" },
  { key: "damageImmunities", label: "Damage immunities" },
  { key: "conditionImmunities", label: "Condition immunities" },
  { key: "spells", label: "Spells", help: "Always ready, and they don't count against what the character can prepare." }
];

export type GrantRow = Readonly<{ rowId: string; kind: string; values: readonly string[] }>;

/**
 * The grants editor's own read and write, exported so tests drive the control's real path:
 * `GrantsEditor` has no `FieldDef`s, so `authoring-harness.ts` exempts `grants`.
 *
 * `spells` rows hold spell ids; the body stores `{id, alwaysPrepared}`. `level` and `ability` are
 * not written: the builder resolves the level from the spell record and the ability falls back to
 * the caster's own.
 */
export function grantRowsOf(grants: Record<string, unknown>): readonly GrantRow[] {
  return GRANT_KINDS.filter((kind) => Array.isArray(grants[kind.key])).map((kind) => ({
    rowId: kind.key,
    kind: kind.key,
    values:
      kind.key === "spells"
        ? (grants.spells as ReadonlyArray<{ id?: string }>).map((spell) => String(spell?.id ?? ""))
        : ((grants[kind.key] as string[]) ?? [])
  }));
}

/**
 * Rows back into the bag, carrying through untouched every key this editor has no row for. The
 * rebuild emits only `GRANT_KINDS` keys, so without the carry an edit would delete the rest; today
 * that is `grants.when`, and dropping it would turn a conditional immunity (e.g. while raging) into
 * a permanent one. `grant-gate-preservation.mirror.test.ts` pins the partition against
 * `FeatureGrantsFieldsSchema.shape`. A carried key keeps the block alive with zero rows, so the gate
 * is never dropped.
 */
export function grantsFromRows(
  rows: readonly GrantRow[],
  previous: Record<string, unknown>
): Record<string, unknown> | undefined {
  const bag: Record<string, unknown> = {};
  for (const row of rows) {
    if (!row.kind) continue;
    bag[row.kind] = row.kind === "spells" ? row.values.map((id) => ({ id, alwaysPrepared: true })) : row.values;
  }
  for (const [key, carried] of Object.entries(previous)) {
    if (!GRANT_KINDS.some((kind) => kind.key === key)) bag[key] = carried;
  }
  return Object.keys(bag).length > 0 ? bag : undefined;
}

/** The canonical vocabulary each open-slug grant kind suggests. Skills and saves are closed chip sets. */
const grantSuggestions = (kind: string, ctx: SchemaContext): readonly string[] => {
  if (kind === "damageResistances" || kind === "damageImmunities") return ctx.damageTypes;
  if (kind === "conditionImmunities") return ctx.conditions;
  if (kind === "weapons") return WEAPON_GRANT_SUGGESTIONS;
  if (kind === "armor") return ARMOR_GRANT_SUGGESTIONS;
  return [];
};

/** Common armour proficiency slugs; open sets, so suggestions only. */
const ARMOR_GRANT_SUGGESTIONS: readonly string[] = ["light-armor", "medium-armor", "heavy-armor", "shields"];
const WEAPON_GRANT_SUGGESTIONS: readonly string[] = ["simple-weapons", "martial-weapons"];

const GRANT_PLACEHOLDERS: Readonly<Record<string, string>> = {
  armor: "light-armor",
  weapons: "simple-weapons",
  tools: "thieves-tools",
  languages: "elvish",
  damageResistances: "fire",
  damageImmunities: "poison",
  conditionImmunities: "charmed"
};

function GrantsEditor({
  value,
  onChange,
  ctx,
  scope
}: Readonly<{ value: Draft; onChange: (next: Draft) => void; ctx: SchemaContext; scope: RiderScope }>) {
  const stored = value.grants;
  // Memoised on the stored bag, so the rows are rebuilt only when the grants themselves change.
  const grants = useMemo(() => (stored ?? {}) as Record<string, unknown>, [stored]);
  const rows = useMemo<readonly GrantRow[]>(() => grantRowsOf(grants), [grants]);

  // Pass the current bag so keys without rows (e.g. `grants.when`) are preserved.
  const write = (next: readonly GrantRow[]) => onChange({ ...value, grants: grantsFromRows(next, grants) });

  /** No `spells` kind on an item: the item body parses `grants.spells`, but `takeGrants` never reads
      it for equipped items. */
  const kinds = GRANT_KINDS.filter((kind) => kind.key !== "spells" || scope !== "item");
  const unused = kinds.filter((kind) => !rows.some((row) => row.kind === kind.key));

  return (
    <div className="hb-field">
      <span className="nh-field-label">Grants</span>
      <p className="nh-field-help">
        Proficiencies and languages this hands out for free.
        {/* Only an item's grants have a different lifecycle (removed when it comes off). */}
        {scope === "item" ? " They come back off the sheet when the item comes off." : ""}
      </p>
      <RowEditor
        rows={rows}
        onChange={write}
        rowKey={(row) => row.rowId}
        onAdd={() => ({ rowId: newId(), kind: unused[0]?.key ?? "", values: [] })}
        addLabel="Grant something"
        emptyText="Nothing granted yet."
        max={kinds.length}
        maxReachedReason="Every kind of grant is already on the list."
        reorderable={false}
        ariaLabel="Grants"
        rowLabel={(row) => {
          const label = GRANT_KINDS.find((kind) => kind.key === row.kind)?.label ?? "Grant";
          // A collapsed spells row shows names, not ids.
          const shown =
            row.kind === "spells"
              ? row.values.map((id) => ctx.spells.find((entry) => entry.id === id)?.name ?? id)
              : row.values;
          return shown.length > 0 ? `${label}: ${shown.join(", ")}` : label;
        }}
        renderRow={(row, index) => {
          const meta = GRANT_KINDS.find((kind) => kind.key === row.kind);
          const options =
            row.kind === "saves" ? ABILITIES : row.kind === "skills" || row.kind === "expertise" ? ctx.skills : null;
          const replace = (patch: Partial<GrantRow>) =>
            write(rows.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
          // A body carrying a kind this scope doesn't offer (e.g. an imported item's spell grant)
          // still shows its own row.
          const kindOptions = kinds.some((kind) => kind.key === row.kind)
            ? kinds
            : [...kinds, ...GRANT_KINDS.filter((kind) => kind.key === row.kind)];
          return (
            <FieldGrid>
              <Field label="What">
                <Select value={row.kind} onChange={(event) => replace({ kind: event.target.value, values: [] })}>
                  {kindOptions.map((kind) => (
                    <option
                      key={kind.key}
                      value={kind.key}
                      disabled={kind.key !== row.kind && rows.some((entry) => entry.kind === kind.key)}
                    >
                      {kind.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Which" help={meta?.help} className="nh-fieldgrid-wide">
                {row.kind === "spells" ? (
                  /* A spell id can't be typed reliably, so this uses the searchable `CatalogPicker`
                     plus removable chips. The picker appends and resets; the chips are the value. */
                  <div className="hb-chips" role="group" aria-label="Which spells">
                    {row.values.map((id) => {
                      const name = ctx.spells.find((entry) => entry.id === id)?.name ?? id;
                      return (
                        <Chip
                          key={id}
                          onRemove={() => replace({ values: row.values.filter((entry) => entry !== id) })}
                          removeLabel={`Remove ${name}`}
                        >
                          {name}
                        </Chip>
                      );
                    })}
                    <CatalogPicker
                      entries={ctx.spells.filter((entry) => !row.values.includes(entry.id))}
                      value={null}
                      onChange={(next) => {
                        if (next) replace({ values: [...row.values, next] });
                      }}
                      emptyLabel="Add a spell"
                      title="Spells this grants"
                      searchPlaceholder="Search spells…"
                      ariaLabel="Which spells"
                    />
                  </div>
                ) : options ? (
                  <div className="hb-chips" role="group" aria-label={`Which ${meta?.label.toLowerCase() ?? "grants"}`}>
                    {options.map((option) => {
                      const on = row.values.includes(option.value);
                      return (
                        <Chip
                          key={option.value}
                          pressed={on}
                          onClick={() =>
                            replace({
                              values: on
                                ? row.values.filter((entry) => entry !== option.value)
                                : [...row.values, option.value]
                            })
                          }
                        >
                          {option.label}
                        </Chip>
                      );
                    })}
                  </div>
                ) : (
                  /* Free entry with canonical suggestions; `slugify` normalises input. */
                  <TagInput
                    ariaLabel={`Which ${meta?.label.toLowerCase() ?? "grants"}`}
                    values={row.values}
                    onChange={(values) => replace({ values })}
                    suggestions={grantSuggestions(row.kind, ctx)}
                    /* Set for the control rather than per kind; `TagInput` falls back to a plain input
                       for kinds with no list (tools, languages). */
                    pick
                    optionLabel={suggestionLabel}
                    placeholder={GRANT_PLACEHOLDERS[row.kind] ?? "light-armor"}
                  />
                )}
              </Field>
            </FieldGrid>
          );
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- the form ----- */

export const ALL_RIDERS: readonly RiderKind[] = ["modifiers", "grants", "uses", "tags", "actions", "effects"];

/**
 * The rider field definitions, flattened, for `vocabularies.test.ts` and `authoring-harness.ts`.
 * Scoped like the carrier: a stat block mounts only `tags` and `actions`, since
 * `ActorDefinitionSchema` has no record-level `modifiers`, `uses` or `effects`.
 *
 * `grants` is absent: `GrantsEditor` is bespoke JSX with no `FieldDef`s, so it stays on the
 * harness's exemption list and tests drive `grantRowsOf`/`grantsFromRows` instead.
 */
export function riderFieldsForTest(scope: RiderScope): readonly FieldDef[] {
  // What `RecordDetail` enables on a monster, in render order.
  if (scope === "statblock") return [tagsField("Tags"), actionsField(scope)];
  return [
    whenField(),
    modifiersField("What it does", scope),
    usesField(scope === "item" ? "Charges" : "Limited uses", scope),
    tagsField("Tags"),
    actionsField(scope),
    effectsField(scope)
  ];
}

export const RIDER_FIELDS_FOR_TEST: readonly FieldDef[] = riderFieldsForTest("item");

/** Items get every rider except `choice`, since an item never asks a question at character
    creation. Item grants are layered over the sheet and removed on unequip. */
export const ITEM_RIDERS: readonly RiderKind[] = ["modifiers", "grants", "uses", "actions", "effects", "tags"];

export function RiderEditor({
  value,
  onChange,
  enabled = ALL_RIDERS,
  scope,
  labels,
  ctx,
  idPrefix
}: Readonly<{
  value: Draft;
  onChange: (next: Draft) => void;
  enabled?: readonly RiderKind[];
  scope: RiderScope;
  labels?: Partial<Record<RiderKind, string>>;
  ctx: SchemaContext;
  idPrefix: string;
}>) {
  const label = (kind: RiderKind, fallback: string) => labels?.[kind] ?? fallback;

  const fields = useMemo<readonly FieldDef[]>(() => {
    const list: FieldDef[] = [];
    if (enabled.includes("modifiers")) list.push(modifiersField(label("modifiers", "Modifiers"), scope));
    if (enabled.includes("uses"))
      list.push(usesField(label("uses", scope === "item" ? "Charges" : "Limited uses"), scope));
    if (enabled.includes("tags")) list.push(tagsField(label("tags", "Tags")));
    if (enabled.includes("actions")) list.push(actionsField(scope));
    if (enabled.includes("effects")) list.push(effectsField(scope));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, labels]);

  return (
    <div className="hb-riders">
      {/* The mental model in one sentence, per carrier. */}
      <p className="hb-riders-when">
        {scope === "item"
          ? (value.attunement as { required?: boolean } | undefined)?.required === true
            ? "These apply while the item is equipped and attuned."
            : "These apply while the item is equipped."
          : scope === "statblock"
            ? "These are the creature's own — always available to it."
            : "These apply as soon as the feature is granted."}
      </p>

      {/* Display-only preview of what the sheet will show for this item's attack. */}
      {scope === "item" && attackReadout(value) && <p className="hb-riders-readout tabular">{attackReadout(value)}</p>}

      <FieldGrid>
        {enabled.includes("modifiers") && (
          <FieldRenderer
            field={fields[0]}
            value={value}
            onValue={onChange}
            draft={value}
            onDraft={onChange}
            ctx={ctx}
            idPrefix={idPrefix}
          />
        )}
        {enabled.includes("grants") && <GrantsEditor value={value} onChange={onChange} ctx={ctx} scope={scope} />}
        {fields
          .filter((field) => field.key !== "modifiers")
          .map((field) => (
            <FieldRenderer
              key={field.key}
              field={field}
              value={value}
              onValue={onChange}
              draft={value}
              onDraft={onChange}
              ctx={ctx}
              idPrefix={idPrefix}
            />
          ))}
      </FieldGrid>
    </div>
  );
}

/** "+1 to hit · 1d8 slashing + 1d4 lightning": the weapon's damage plus every rider that adds to a
    swing. Returns `""` when there is nothing to say. */
export function attackReadout(value: Draft): string {
  const modifiers = (Array.isArray(value.modifiers) ? value.modifiers : []) as Array<Record<string, unknown>>;
  const weapon = value.weapon as Record<string, unknown> | null | undefined;

  const toHit = modifiers
    .filter((modifier) => modifier.type === "attack-bonus" && typeof modifier.amount === "number")
    .reduce((total, modifier) => total + (modifier.amount as number), 0);

  const damage: string[] = [];
  if (weapon && typeof weapon.damageDice === "string" && weapon.damageDice.trim() !== "") {
    damage.push(`${weapon.damageDice.trim()}${weapon.damageType ? ` ${String(weapon.damageType).trim()}` : ""}`);
  }
  for (const modifier of modifiers) {
    if (modifier.type !== "extra-damage" || typeof modifier.formula !== "string" || modifier.formula.trim() === "")
      continue;
    damage.push(`${modifier.formula.trim()}${modifier.damageType ? ` ${String(modifier.damageType).trim()}` : ""}`);
  }

  const parts: string[] = [];
  if (toHit !== 0) parts.push(`${toHit > 0 ? "+" : ""}${toHit} to hit`);
  if (damage.length > 0) parts.push(damage.join(" + "));
  return parts.join(" · ");
}

/** A one-line summary of what a record's riders do, for a collapsed row. */
export function riderSummary(value: Draft): string {
  const parts: string[] = [];
  const modifiers = Array.isArray(value.modifiers) ? value.modifiers.length : 0;
  const actions = Array.isArray(value.actions) ? value.actions.length : 0;
  const effects = Array.isArray(value.effects) ? value.effects.length : 0;
  const grants =
    value.grants && typeof value.grants === "object"
      ? Object.values(value.grants as object).filter((entry) => Array.isArray(entry) && entry.length > 0).length
      : 0;
  if (modifiers) parts.push(`${modifiers} ${modifiers === 1 ? "modifier" : "modifiers"}`);
  if (grants) parts.push(`${grants} ${grants === 1 ? "grant" : "grants"}`);
  if (actions) parts.push(`${actions} ${actions === 1 ? "action" : "actions"}`);
  if (effects) parts.push(effects === 1 ? "an effect" : `${effects} effects`);
  if (value.uses) parts.push("limited uses");
  return parts.join(" · ");
}
