/**
 * THE rider sub-form. **One component, mounted by both `FeatureEditor` and the item
 * schema**, because a feature and an item carry the *same* rider shapes — the server
 * spells that vocabulary exactly once (`featureRiders` in the content schemas) and so
 * does this.
 *
 * Where the two diverge, and why one component still serves both:
 *
 * | | Feature | Item |
 * | --- | --- | --- |
 * | When the riders apply | once the feature is granted | only while equipped (and attuned, if required) |
 * | Can ask the player a question | yes (`choice`) | **no** — an item never asks a question at character creation |
 * | `grants` | yes, and it is BAKED at build time | yes, and it is LAYERED over the sheet while the item is equipped |
 * | `uses` | "Limited uses" | **"Charges"** — same control, same data, via `labels` |
 *
 * So the divergence is entirely `scope`, `enabled` and `labels`. No second component
 * exists, and none should: the moment one does, the two vocabularies start to drift.
 *
 * ## Why `grants` came back for items
 *
 * It used to be off, on the reasoning that the proficiency union is assembled once at
 * build time while inventory changes afterwards — so an item-granted skill could be
 * granted and never un-granted. That reasoning was right about a build-time design and is
 * why there no longer is one: item contributions are recomputed WHOLE from
 * `(definition, inventory, catalog)` on every inventory write and layered at read time,
 * so unequipping the circlet removes the row and the next read shows the base tier.
 * Replace-whole IS the un-grant. Same authored shape on both carriers, two lifecycles,
 * and the GM sees neither.
 *
 * ## The word "trigger" never appears on screen
 *
 * A rider can carry up to four gating conditions. The schema calls them triggers and
 * sorts them into gates, moments and filters; the GM reads three `<optgroup>` labels that
 * are the sentence their options finish — *Only while…*, *Only when…*, *Only for…* — and
 * never learns any of those four words. That is the whole of the design: the mechanism is
 * not the interface.
 */

import { useMemo } from "react";
import { Chip, Field, FieldGrid, RowEditor, Select, TagInput } from "@vtt/ui";
import { newId } from "../lib/ids";
import { FieldRenderer } from "./FieldRenderer";
import { damagePartsField, diceValidate, grouped, opt, suggestionLabel, type Draft, type FieldDef, type SchemaContext, type SelectOption } from "./schema";

export type RiderKind = "modifiers" | "grants" | "uses" | "tags" | "actions" | "effects";

const ABILITIES = [
  opt("str", "Strength"), opt("dex", "Dexterity"), opt("con", "Constitution"),
  opt("int", "Intelligence"), opt("wis", "Wisdom"), opt("cha", "Charisma")
];

const SIZES = [opt("tiny", "Tiny"), opt("small", "Small"), opt("medium", "Medium"), opt("large", "Large"), opt("huge", "Huge"), opt("gargantuan", "Gargantuan")];

/* ------------------------------------------------------- gating conditions ------ */

/**
 * The thirty conditions a rider can be gated on, in the three groups a GM reads as
 * sentences. **`kind` is this file's own business and never reaches the screen** — it is
 * what the two structural rules below are checked against, and what decides whether a
 * rider is a standing number on the sheet or a labelled note at roll time. The GM is
 * never asked to choose a layer, and never sees the word.
 *
 * Two rules the schema enforces and `publishBlockedReason` states in words:
 *   1. at most ONE *Only when…* per rider — a rider fires at one moment, not two;
 *   2. an *Only for…* needs an *Only when…* to narrow — a filter with no moment is an
 *      authoring mistake, not "always".
 *
 * They are publish blockers rather than inline errors for the usual reason: a draft is
 * allowed to be invalid.
 */
type TriggerKind = "gate" | "moment" | "filter";

const WHILE = grouped("Only while…");
const WHEN = grouped("Only when…");
const FOR = grouped("Only for…");

const TRIGGER_TYPES: readonly SelectOption[] = [
  // Gates — resolvable from the sheet, so these keep a rider a real number on the sheet.
  WHILE("attuned", "It's attuned"),
  WHILE("while-armored", "Wearing armour"),
  WHILE("while-unarmored", "Not wearing armour"),
  WHILE("while-shield", "Holding a shield"),
  WHILE("while-character-is", "A certain class or species"),
  WHILE("while-proficient-with", "Proficient with something"),
  WHILE("while-effect-tag", "Under an effect"),
  WHILE("while-hp-at-or-below", "Low on hit points"),
  WHILE("while-condition", "Under a condition"),
  // Moments — the named roll or event. At most one per rider.
  WHEN("on-attack-roll", "Making an attack roll"),
  WHEN("on-hit", "An attack hits"),
  WHEN("on-critical-hit", "Scoring a critical hit"),
  WHEN("on-critical-miss", "Rolling a natural 1"),
  WHEN("on-damage-roll", "Rolling damage"),
  WHEN("on-saving-throw", "Making a saving throw"),
  WHEN("on-ability-check", "Making an ability check"),
  WHEN("on-initiative-roll", "Rolling initiative"),
  WHEN("on-death-save", "Making a death save"),
  WHEN("on-taking-damage", "Taking damage"),
  WHEN("on-spell-cast", "Casting a spell"),
  // Filters — narrow whatever moment they accompany.
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
  TRIGGER_TYPES.map((entry) => [entry.value, entry.group === "Only when…" ? "moment" : entry.group === "Only for…" ? "filter" : "gate"] as const)
);

export const triggerKindOf = (type: unknown): TriggerKind | null => TRIGGER_KINDS[String(type ?? "")] ?? null;
export const triggerLabelOf = (type: unknown): string =>
  TRIGGER_TYPES.find((entry) => entry.value === String(type ?? ""))?.label ?? "A condition";

/** Switching condition REPLACES the row: the union is `.strict()`, so a `kinds` left over
    from an attack filter makes a size filter unparseable. Same rule as `blankModifier`. */
function blankTrigger(type: string): Draft {
  switch (type) {
    case "while-armored": return { type };
    case "while-unarmored": return { type, allowShield: false };
    case "while-shield": return { type, wielding: true };
    case "while-character-is": return { type, classIds: [], speciesIds: [] };
    case "while-proficient-with": return { type, kind: "weapon", ids: [] };
    case "while-effect-tag": return { type, tags: [] };
    case "while-hp-at-or-below": return { type, percent: 50 };
    case "while-condition": return { type, conditionIds: [], present: true };
    case "attack-kind-is": return { type, kinds: [] };
    case "weapon-property-is": return { type, properties: [] };
    case "damage-type-is": return { type, damageTypes: [] };
    case "ability-is": return { type, abilities: [] };
    case "skill-is": return { type, skills: [] };
    case "spell-school-is": return { type, schools: [] };
    case "spell-level-is": return { type, levels: [] };
    case "spell-id-is": return { type, spellIds: [] };
    case "versus-size": return { type, sizes: [] };
    case "versus-condition": return { type, conditionIds: [] };
    case "versus-creature-type": return { type, creatureTypes: [] };
    default: return { type };
  }
}

const hasType = (...types: readonly string[]) => (row: Draft) => types.includes(String(row.type ?? ""));

/** These fields are ids, not prose — `ContentIdSchema` is `/^[a-z0-9-]+$/`. Caught while
    typing rather than as a publish refusal, because "Lay on Hands" being wrong is the
    field being wrong NOW, and the corrected form is one the GM can read off the message. */
const slugValidate = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "" || /^[a-z0-9-]+$/.test(text)) return null;
  return `Write it as ${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lowercase-with-dashes"} — lowercase, no spaces.`;
};

/** A collapsed row's own sentence — "Only for: A damage type — fire, cold". */
function triggerRowLabel(row: Draft): string {
  const name = triggerLabelOf(row.type);
  const values = [row.weights, row.classIds, row.speciesIds, row.ids, row.tags, row.conditionIds, row.kinds, row.properties, row.damageTypes, row.abilities, row.skills, row.schools, row.levels, row.spellIds, row.sizes, row.creatureTypes]
    .filter(Array.isArray)
    .flat()
    .map(String);
  if (values.length > 0) return `${name} — ${values.slice(0, 3).join(", ")}${values.length > 3 ? "…" : ""}`;
  if (typeof row.percent === "number") return `${name} — ${row.percent}% or less`;
  if (row.type === "while-shield") return row.wielding === false ? "Not holding a shield" : name;
  return name;
}

/**
 * The gating list, as a nested `rows` field on one modifier. `RowEditor` is nesting-safe
 * by construction (`minmax(0, 1fr)` and `min-width: 0` the whole way down, measured), so
 * this needs no new primitive and no new `FieldKind` — a factory, which is where the
 * standing rule says to reach first.
 */
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
      // The schema is `weights?: [...].min(1)`, so "any armour" is the key being ABSENT
      // and an empty array is a parse error. Turning the last one off must remove it.
      write: (next, row) => {
        const chosen = next as string[];
        if (chosen.length > 0) return { ...row, weights: chosen };
        const cleared = { ...row };
        delete cleared.weights;
        return cleared;
      }
    },
    { key: "allowShield", label: "A shield still counts as unarmoured", kind: "switch", visibleWhen: hasType("while-unarmored") },
    { key: "wielding", label: "The shield is", kind: "select", options: [opt("true", "In hand"), opt("false", "Not in hand")], visibleWhen: hasType("while-shield"), read: (row) => String(row.wielding !== false), write: (next, row) => ({ ...row, wielding: next === "true" }) },
    { key: "classIds", label: "Classes", kind: "multiselect", options: (ctx) => ctx.classes, visibleWhen: hasType("while-character-is") },
    { key: "speciesIds", label: "Species", kind: "multiselect", options: (ctx) => ctx.species, visibleWhen: hasType("while-character-is") },
    { key: "kind", label: "Proficient with", kind: "select", options: [opt("weapon", "A weapon"), opt("armor", "Armour"), opt("tool", "A tool"), opt("skill", "A skill")], visibleWhen: hasType("while-proficient-with") },
    { key: "ids", label: "Which", kind: "tags", visibleWhen: hasType("while-proficient-with"), placeholder: "longsword" },
    { key: "tags", label: "Effect tags", kind: "tags", visibleWhen: hasType("while-effect-tag"), suggestions: ["raging", "blessed", "concentrating", "inspired"] },
    { key: "percent", label: "Hit points at or below", kind: "number", min: 1, max: 99, unit: "%", visibleWhen: hasType("while-hp-at-or-below") },
    { key: "conditionIds", label: "Conditions", kind: "tags", visibleWhen: hasType("while-condition", "versus-condition"), suggestions: (ctx) => ctx.conditions },
    { key: "present", label: "It has the condition", kind: "switch", visibleWhen: hasType("while-condition"), help: "Turn off for “only while you don't have it”." },
    { key: "kinds", label: "Kinds of attack", kind: "multiselect", options: [opt("melee", "Melee"), opt("ranged", "Ranged"), opt("spell", "Spell"), opt("unarmed", "Unarmed"), opt("thrown", "Thrown"), opt("reaction", "Reaction"), opt("opportunity", "Opportunity")], visibleWhen: hasType("attack-kind-is") },
    { key: "properties", label: "Weapon properties", kind: "tags", visibleWhen: hasType("weapon-property-is"), suggestions: (ctx) => ctx.weaponProperties },
    // `3d`, site 6 of 9 — the `damage-type-is` gate. A slug typed one character wrong here does not
    // fail: the rider simply never fires, which is the hardest homebrew failure there is to diagnose.
    { key: "damageTypes", label: "Damage types", kind: "tags", pick: true, visibleWhen: hasType("damage-type-is"), suggestions: (ctx) => ctx.damageTypes },
    { key: "abilities", label: "Abilities", kind: "multiselect", options: ABILITIES, visibleWhen: hasType("ability-is") },
    { key: "skills", label: "Skills", kind: "multiselect", options: (ctx) => ctx.skills, visibleWhen: hasType("skill-is") },
    { key: "schools", label: "Schools", kind: "tags", visibleWhen: hasType("spell-school-is"), suggestions: (ctx) => ctx.schools },
    { key: "levels", label: "Spell levels", kind: "multiselect", options: Array.from({ length: 10 }, (_, level) => opt(String(level), level === 0 ? "Cantrip" : `Level ${level}`)), visibleWhen: hasType("spell-level-is"), read: (row) => (Array.isArray(row.levels) ? row.levels.map(String) : []), write: (next, row) => ({ ...row, levels: (next as string[]).map(Number) }) },
    { key: "spellIds", label: "Spells", kind: "tags", visibleWhen: hasType("spell-id-is"), suggestions: (ctx) => ctx.spells.map((entry) => entry.id), help: "Only when this exact spell is cast — “when you cast Eldritch Blast”. A school or a level names a category; this names one." },
    { key: "sizes", label: "Sizes", kind: "multiselect", options: SIZES, visibleWhen: hasType("versus-size") },
    { key: "creatureTypes", label: "Kinds of creature", kind: "tags", visibleWhen: hasType("versus-creature-type"), suggestions: (ctx) => ctx.creatureTypes, note: "Not checked yet — a creature doesn't record its kind." }
  ]
});

/* ------------------------------------------------------------- modifiers -------- */

/**
 * The twenty-one typed riders, in four groups. A bounded union, grown additively;
 * anything not here stays prose (ADR-0008). `note` marks the ones that parse and then do
 * nothing, which is the honesty line a rider form owes: a modifier the engine silently
 * ignores is worse than no field, because the GM has no way to find out.
 */
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

/** The GM's word for a modifier, so a publish blocker names what the GM named rather than
    the schema's discriminator. One vocabulary, spelled once. */
export const modifierLabel = (type: unknown): string =>
  MODIFIER_TYPES.find((entry) => entry.value === String(type ?? ""))?.label ?? "a modifier";

/** Switching variant must REPLACE the row, not merge into it: the union is `.strict()`,
    so a leftover `ability` from ability-score makes an extra-attack row unparseable. */
function blankModifier(type: string): Draft {
  switch (type) {
    case "ability-score": return { type, ability: "str", amount: 1 };
    case "hit-points-per-level": return { type, amount: 1 };
    case "speed": return { type, amount: 10 };
    case "armor-class": return { type, amount: 1, whileArmored: false };
    case "initiative": return { type, amount: 1 };
    case "extra-attack": return { type, count: 1 };
    case "unarmored-defense": return { type, ability: "con", allowShield: false };
    case "darkvision": return { type, feet: 60 };
    case "attack-bonus": return { type, amount: 1 };
    case "save-bonus": return { type, amount: 1 };
    case "check-bonus": return { type, amount: 1 };
    case "extra-damage": return { type, formula: "1d6", damageType: "", doubleOnCritical: false };
    case "roll-mode": return { type, roll: "attack", mode: "advantage" };
    case "spell-save-dc": return { type, amount: 1 };
    case "spell-attack-bonus": return { type, amount: 1 };
    case "spell-slot": return { type, level: 1, amount: 1 };
    case "resource-bonus": return { type, poolId: "", amount: 1 };
    case "critical-range": return { type, threshold: 19 };
    case "critical-bonus-dice": return { type, count: 1 };
    case "damage-reduction": return { type, amount: 1 };
    case "sense": return { type, sense: "", feet: 30 };
    default: return { type };
  }
}

/** The riders that mean "with this weapon" on a weapon, and "with everything you do"
    anywhere else. The default is derived from the carrier, so the only reason a GM ever
    sees the control is to BROADEN one — which is why it is a single switch on a single
    family and not a per-rider setting. */
const WEAPON_SCOPED = ["attack-bonus", "extra-damage", "critical-range", "critical-bonus-dice"];

/**
 * The two riders an ITEM may not carry, refused by `EquipmentReferenceSchema` itself —
 * not by a publish-time validator, because the CARRIER is what makes it a refusal and the
 * identical rider on a feat is fine.
 *
 * Neither can be layered over a sheet the way everything else here can. `hit-points`
 * cascades into stored live state (`hp.current` is tracked against `hp.maximum`, and
 * unequipping could strand current above maximum with no correct silent answer); an
 * ability score cascades into AC, saves, skills, spell DC, hit points and initiative, all
 * of which read the BAKED scores, so layering one means layering the whole sheet.
 *
 * They are not OFFERED on an item rather than offered and refused: a form that produces a
 * record the store rejects is the failure this whole editor is built to avoid.
 */
const ITEM_REFUSED = ["ability-score", "hit-points-per-level"];

const signed = (amount: number) => `${amount >= 0 ? "+" : ""}${amount}`;

const modifiersField = (label: string, scope: "feature" | "item"): FieldDef => ({
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
    if (modifier.type === "roll-mode") return `${modifier.mode === "disadvantage" ? "Disadvantage" : "Advantage"} on ${String(modifier.roll ?? "attack").replace(/-/g, " ")}`;
    if (modifier.type === "extra-damage") return `${name} ${modifier.formula ?? ""} ${modifier.damageType ?? ""}`.trim();
    if (modifier.type === "spell-slot") return `${name} ${signed(Number(modifier.amount ?? 0))} at level ${modifier.level ?? 1}`;
    const amount = modifier.amount ?? modifier.count ?? modifier.feet ?? modifier.threshold;
    return typeof amount === "number" ? `${name} ${signed(amount)}` : name;
  },
  rows: [
    {
      key: "type",
      label: "What it changes",
      kind: "select",
      options: scope === "item" ? MODIFIER_TYPES.filter((entry) => !ITEM_REFUSED.includes(entry.value)) : MODIFIER_TYPES,
      // The whole row is replaced, so no key from the previous variant survives.
      write: (next, row) => ({ rowId: (row as { rowId?: string }).rowId ?? newId(), ...blankModifier(String(next)) })
    },
    { key: "ability", label: "Ability", kind: "select", options: ABILITIES, visibleWhen: hasType("ability-score", "unarmored-defense") },
    /* `amount` seven times over, not once with the widest range.
       Every variant declares its OWN bounds server-side — ±5 for armour class, ±10 for a
       saving throw, −30..60 for speed — and one field spanning all of them would take a
       number the store then refuses, with the refusal arriving after the GM had moved on.
       The control tells the truth about the variant it is showing. Mutually exclusive
       through `visibleWhen`, so exactly one is ever on screen. */
    // Every amount is SIGNED, which is the whole of curses and debuffs: a −2 armour class
    // rider is a Cloak of Weakness and needs no vocabulary of its own. Said once, here.
    { key: "amount", label: "Amount", kind: "number", allowNegative: true, min: -5, max: 5, help: "Negative for a curse.", visibleWhen: hasType("ability-score", "hit-points-per-level", "armor-class", "spell-save-dc", "spell-attack-bonus") },
    { key: "amount", label: "Amount", kind: "number", allowNegative: true, min: -30, max: 60, unit: "ft", help: "Negative for a curse.", visibleWhen: hasType("speed") },
    { key: "amount", label: "Amount", kind: "number", allowNegative: true, min: -5, max: 10, help: "Negative for a curse.", visibleWhen: hasType("initiative") },
    { key: "amount", label: "Amount", kind: "number", allowNegative: true, min: -10, max: 10, help: "Negative for a curse.", visibleWhen: hasType("attack-bonus", "save-bonus", "check-bonus") },
    { key: "amount", label: "Extra slots", kind: "number", allowNegative: true, min: -4, max: 4, visibleWhen: hasType("spell-slot") },
    { key: "amount", label: "Extra uses", kind: "number", allowNegative: true, min: -20, max: 20, visibleWhen: hasType("resource-bonus") },
    { key: "amount", label: "Damage reduced by", kind: "number", min: 1, max: 30, visibleWhen: hasType("damage-reduction") },
    { key: "maximum", label: "Raises the cap to", kind: "number", min: 1, max: 30, visibleWhen: hasType("ability-score"), help: "Leave empty to keep the usual 20." },
    { key: "count", label: "Extra attacks", kind: "number", min: 1, max: 3, visibleWhen: hasType("extra-attack") },
    { key: "count", label: "Extra dice", kind: "number", min: 1, max: 4, visibleWhen: hasType("critical-bonus-dice"), help: "The weapon's own die, rolled again. For a typed extra like 1d6 fire, use Extra damage on a critical hit instead." },
    { key: "feet", label: "Distance", kind: "number", min: 0, max: 240, unit: "ft", visibleWhen: hasType("darkvision"), note: "Display only." },
    { key: "whileArmored", label: "Only while wearing armour", kind: "switch", visibleWhen: hasType("armor-class") },
    { key: "allowShield", label: "A shield still counts", kind: "switch", visibleWhen: hasType("unarmored-defense"), note: "Not read yet." },
    { key: "formula", label: "Damage", placeholder: "1d6", validate: diceValidate, visibleWhen: hasType("extra-damage"), help: "Dice. Leave it empty to add only an ability modifier." },
    { key: "abilityModifier", label: "Plus an ability modifier", kind: "select", options: ABILITIES, emptyValue: "omit", visibleWhen: hasType("extra-damage"), help: "Adds the character's own modifier, resolved at the roll — “add your Charisma modifier to the damage”." },
    /* `3d`, site 7 of 9 — the mace's "+1d6 lightning". Left EMPTY on purpose is a real authored
       answer here and not a blank: `action-resolution.ts` reads `damageType ?? damage[0].type`, so an
       absent type means "the same type this weapon already deals". That is why `"untyped"` — the
       fourteenth string the engine mints when there is nothing to inherit either — is NOT offered:
       picking it would silently override the inheritance a GM meant to keep. U23 gives that case its
       own words. The box stays open, so a GM who really wants the word can still type it. */
    { key: "damageType", label: "Damage type", pick: true, placeholder: "fire", suggestions: (ctx) => ctx.damageTypes, visibleWhen: hasType("extra-damage") },
    { key: "doubleOnCritical", label: "Doubled on a critical hit", kind: "switch", visibleWhen: hasType("extra-damage"), help: "Off is the 5e rule — dice added after the attack aren't doubled." },
    { key: "roll", label: "On which roll", kind: "select", options: [opt("attack", "Attack rolls"), opt("incoming-attack", "Attacks against you"), opt("save", "Saving throws"), opt("check", "Ability checks"), opt("initiative", "Initiative"), opt("death-save", "Death saves"), opt("concentration", "Concentration")], visibleWhen: hasType("roll-mode") },
    { key: "mode", label: "Which way", kind: "select", options: [opt("advantage", "Advantage"), opt("disadvantage", "Disadvantage")], visibleWhen: hasType("roll-mode"), help: "Disadvantage is how a cursed item bites." },
    { key: "classId", label: "For one class only", kind: "select", options: (ctx) => ctx.classes, visibleWhen: hasType("spell-save-dc", "spell-attack-bonus"), help: "Leave empty for every class on the sheet." },
    { key: "level", label: "Slot level", kind: "stepper", min: 1, max: 9, visibleWhen: hasType("spell-slot") },
    { key: "poolId", label: "Which pool", placeholder: "lay-on-hands", validate: slugValidate, visibleWhen: hasType("resource-bonus"), help: "The shared-pool name a feature already uses. One more of whatever that pool counts." },
    { key: "threshold", label: "Critical hit on", kind: "number", min: 15, max: 20, visibleWhen: hasType("critical-range"), help: "20 is the usual. 19 gives a champion's improved critical." },
    { key: "sense", label: "Which sense", placeholder: "tremorsense", validate: slugValidate, visibleWhen: hasType("sense"), note: "Display only." },
    { key: "feet", label: "Distance", kind: "number", min: 0, max: 240, unit: "ft", visibleWhen: hasType("sense") },
    whenField(),
    {
      key: "scope",
      label: "Applies to everything the bearer does",
      kind: "switch",
      help: "Off means this weapon only, which is the usual.",
      // Only ever offered where the derived default could sensibly be broadened: an
      // attack/damage rider ON A WEAPON. Everywhere else the default is already "the
      // bearer" and there is nothing to choose, so nothing is rendered.
      visibleWhen: (row, draft) => draft.weapon != null && WEAPON_SCOPED.includes(String(row.type ?? "")),
      read: (row) => row.scope === "bearer",
      write: (next, row) => (next === true ? { ...row, scope: "bearer" } : { ...row, scope: "this-item" })
    }
  ]
});

const usesField = (label: string, scope: "feature" | "item"): FieldDef => ({
  key: "uses",
  label,
  kind: "group",
  help:
    scope === "item"
      ? "Charges the item spends and gets back on a rest."
      : "How many times this can be used before a rest gives it back.",
  rows: [
    {
      // "Uses are …", not a second "How many": this select and the number beside it were
      // BOTH labelled "How many" and rendered side by side in the same grid row, one
      // asking how the count is COMPUTED and one asking for the count. Every option
      // already reads as the completion of this label — "Uses are a flat number", "Uses
      // are Proficiency bonus" — so the label is the sentence the values finish.
      key: "mode",
      label: "Uses are",
      kind: "select",
      options: [opt("flat", "A flat number"), opt("proficiency-bonus", "Proficiency bonus"), opt("ability-modifier", "Ability modifier"), opt("by-level", "By level")],
      // `mode` is NOT stored — it is read back out of the shape, so there is no second
      // place the answer lives and nothing to keep in sync.
      //
      // **This `read` is the whole of the client's `3b`(a) report.** The comment above has
      // been true about the WRITE since the field was written and false about the read:
      // there was no `read`, so `FieldRenderer` fell through to `getAt(value, "mode")` — a
      // key the write path deliberately never persists — and the control rendered `""` on
      // every pass, selecting `<option value="">Not set</option>`. The GM's choice was
      // saving correctly the whole time; only the readback was missing. Not a controlled
      // input, not `defaults.ts`, not `useAutosave.ts`.
      //
      // The three literals below are the schema's own (`FeatureUsesSchema.scaling`'s
      // discriminator) and are byte-identical to the option values above, so there is no
      // mapping table to drift. `class-resource` is the fourth discriminator and has no
      // option yet — it reads back as "Not set" until U7 adds one, which is honest and is
      // what U7's own test changes.
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
      // `per` is REQUIRED on the stored shape, and the select below defaults to nothing
      // until it is touched — so typing a count first produced uses with no recovery and
      // a publish refusal the GM never caused. Seed it here; it stays editable below.
      write: (next, scope_) => {
        const uses = { ...(scope_.uses as Record<string, unknown> | undefined) };
        if (next === null || next === undefined) delete uses.limit;
        else uses.limit = next;
        if (uses.limit === undefined && uses.scaling === undefined) return { ...scope_, uses: undefined };
        uses.per ??= "long-rest";
        return { ...scope_, uses };
      }
    },
    { key: "uses.scaling.ability", label: "Which ability", kind: "select", options: ABILITIES, visibleWhen: (scope_) => (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "ability-modifier" },
    { key: "uses.scaling.minimum", label: "At least", kind: "number", min: 0, max: 5, visibleWhen: (scope_) => (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "ability-modifier" },
    {
      key: "uses.scaling.table",
      label: "By level",
      kind: "rows",
      visibleWhen: (scope_) => (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "by-level",
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
      options: [opt("turn", "Every turn"), opt("encounter", "Every encounter"), opt("short-rest", "On a short rest"), opt("long-rest", "On a long rest")],
      // "Once per day" is the phrase every printed item uses and there is no "day" here
      // on purpose: a long rest already IS this app's day (`legendary.resistancesPerDay`
      // says so in the schema). Said once, where a GM looking for "day" will read it.
      ...(scope === "item" ? { help: "A long rest is this table's day, so “once per day” is “on a long rest”." } : {})
    },
    { key: "uses.pool", label: "Shared pool", help: scope === "item" ? "Items and features sharing a pool share one counter." : "Features sharing a pool share one counter.", placeholder: "channel-divinity" }
  ]
});

const actionsField = (): FieldDef => ({
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
    { key: "activation", label: "Costs", kind: "select", options: [opt("action", "An action"), opt("bonus-action", "A bonus action"), opt("reaction", "A reaction"), opt("other", "No action")] },
    { key: "description", label: "Description", kind: "textarea", wide: true },
    damagePartsField("damage", { label: "Damage", max: 8, newId, help: "Every part is rolled on a hit." }),
    {
      key: "attack",
      label: "Attack roll",
      kind: "group",
      rows: [
        { key: "attack.ability", label: "Uses", kind: "select", options: [...ABILITIES, opt("spellcasting", "Spellcasting ability")] },
        { key: "attack.reachFeet", label: "Reach", kind: "number", min: 1, max: 120, unit: "ft" },
        { key: "attack.rangeFeet", label: "Range", kind: "number", min: 1, max: 1000, unit: "ft" }
      ]
    },
    {
      key: "save",
      label: "Saving throw",
      kind: "group",
      rows: [
        { key: "save.ability", label: "Target rolls", kind: "select", options: ABILITIES },
        { key: "save.dc", label: "DC", kind: "number", min: 1, max: 40, help: "Leave empty to use the character's own spell save DC." }
      ]
    }
  ]
});

/** Grouping only, and it is a `FieldDef` like everything else — built here rather than inline in the
    component so `riderFieldsForTest` can state the rider surface COMPLETELY. A key the census cannot
    see is a key the both-paths harness waves through. */
const tagsField = (label: string): FieldDef => ({ key: "tags", label, kind: "tags", help: "Grouping only — no mechanical effect." });

const effectsField = (): FieldDef => ({
  key: "effects",
  label: "Effects",
  kind: "rows",
  // Stated ONCE, and it is why the cap exists — authoring mechanics that silently vanish
  // is worse than not offering the field.
  help: "Only the first effect is applied by the rules engine today.",
  addLabel: "Add an effect",
  emptyText: "No effects yet.",
  maxRows: 1,
  maxRowsReason: "Only the first effect is applied by the rules engine today.",
  rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
  newRow: () => ({ rowId: newId(), name: "", tags: [], duration: { type: "encounter" }, modifiers: [], onEnd: [] }),
  rowLabel: (row) => (row as { name?: string }).name || "Unnamed effect",
  rows: [
    { key: "name", label: "Name" },
    { key: "tags", label: "Tags", kind: "tags", help: "The sheet groups effects by these.", suggestions: ["raging", "blessed", "concentrating", "inspired"] },
    { key: "duration.type", label: "Lasts", kind: "select", options: [opt("rounds", "A number of rounds"), opt("until-source-next-turn", "Until your next turn"), opt("encounter", "The whole encounter"), opt("manual", "Until removed by hand")] },
    { key: "duration.rounds", label: "Rounds", kind: "number", min: 1, max: 100, visibleWhen: (row) => (row.duration as { type?: string } | undefined)?.type === "rounds" },
    { key: "concentration", label: "Needs concentration", kind: "switch" }
  ]
});

/* ---------------------------------------------------------------- grants ------- */

/**
 * Eleven arrays become ONE list.
 *
 * `FeatureGrantsSchema` stores eleven parallel arrays (skills, expertise, tools,
 * languages, armor, weapons, saves, three damage/condition lists, spells). Rendering
 * eleven tag inputs would be eleven labels, eleven empty states and eleven chances to
 * put the same thing in the wrong one. A single `[What ▾][Which…]` list is one control
 * with a picker, and the storage shape stays the server's business.
 */
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
  { key: "conditionImmunities", label: "Condition immunities" }
];

type GrantRow = Readonly<{ rowId: string; kind: string; values: readonly string[] }>;

/**
 * The canonical vocabulary each open-slug grant kind draws on, so "Which" is a complete list plus
 * other rather than a blank line. Skills and saving throws are handled above as closed chip sets.
 */
const grantSuggestions = (kind: string, ctx: SchemaContext): readonly string[] => {
  if (kind === "damageResistances" || kind === "damageImmunities") return ctx.damageTypes;
  if (kind === "conditionImmunities") return ctx.conditions;
  if (kind === "weapons") return WEAPON_GRANT_SUGGESTIONS;
  if (kind === "armor") return ARMOR_GRANT_SUGGESTIONS;
  return [];
};

/** The four proficiency slugs `character-build.ts` folds for armour, and the two weapon families —
    open sets, so these are the well-known members and never a closed list. */
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
}: Readonly<{ value: Draft; onChange: (next: Draft) => void; ctx: SchemaContext; scope: "feature" | "item" }>) {
  const grants = (value.grants ?? {}) as Record<string, unknown>;

  const rows = useMemo<readonly GrantRow[]>(
    () =>
      GRANT_KINDS.filter((kind) => Array.isArray(grants[kind.key]) && (grants[kind.key] as unknown[]).length >= 0)
        .filter((kind) => Array.isArray(grants[kind.key]))
        .map((kind) => ({ rowId: kind.key, kind: kind.key, values: (grants[kind.key] as string[]) ?? [] })),
    [grants]
  );

  const write = (next: readonly GrantRow[]) => {
    const bag: Record<string, unknown> = {};
    for (const row of next) if (row.kind) bag[row.kind] = row.values;
    const spells = grants.spells;
    if (Array.isArray(spells) && spells.length > 0) bag.spells = spells;
    onChange({ ...value, grants: Object.keys(bag).length > 0 ? bag : undefined });
  };

  const unused = GRANT_KINDS.filter((kind) => !rows.some((row) => row.kind === kind.key));

  return (
    <div className="hb-field">
      <span className="nh-field-label">Grants</span>
      {/* One behavioural difference, stated once and only where it differs: the same
          authored shape, two lifecycles, because the two carriers have two lifecycles. */}
      <p className="nh-field-help">
        Proficiencies and languages this hands out for free.
        {scope === "item" ? " They come back off the sheet when the item comes off." : ""}
      </p>
      <RowEditor
        rows={rows}
        onChange={write}
        rowKey={(row) => row.rowId}
        onAdd={() => ({ rowId: newId(), kind: unused[0]?.key ?? "", values: [] })}
        addLabel="Grant something"
        emptyText="Nothing granted yet."
        max={GRANT_KINDS.length}
        maxReachedReason="Every kind of grant is already on the list."
        reorderable={false}
        ariaLabel="Grants"
        rowLabel={(row) => {
          const label = GRANT_KINDS.find((kind) => kind.key === row.kind)?.label ?? "Grant";
          return row.values.length > 0 ? `${label}: ${row.values.join(", ")}` : label;
        }}
        renderRow={(row, index) => {
          const meta = GRANT_KINDS.find((kind) => kind.key === row.kind);
          const options = row.kind === "saves" ? ABILITIES : row.kind === "skills" || row.kind === "expertise" ? ctx.skills : null;
          const replace = (patch: Partial<GrantRow>) => write(rows.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
          return (
            <FieldGrid>
              <Field label="What">
                <Select
                  value={row.kind}
                  onChange={(event) => replace({ kind: event.target.value, values: [] })}
                >
                  {GRANT_KINDS.map((kind) => (
                    <option key={kind.key} value={kind.key} disabled={kind.key !== row.kind && rows.some((entry) => entry.kind === kind.key)}>
                      {kind.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Which" help={meta?.help} className="nh-fieldgrid-wide">
                {options ? (
                  <div className="hb-chips" role="group" aria-label={`Which ${meta?.label.toLowerCase() ?? "grants"}`}>
                    {options.map((option) => {
                      const on = row.values.includes(option.value);
                      return (
                        <Chip
                          key={option.value}
                          pressed={on}
                          onClick={() => replace({ values: on ? row.values.filter((entry) => entry !== option.value) : [...row.values, option.value] })}
                        >
                          {option.label}
                        </Chip>
                      );
                    })}
                  </div>
                ) : (
                  /* Free entry, because five of these ten grant kinds are open slug sets — but no
                     longer free entry with NOTHING to go on. A GM granting damage immunities used to
                     face a comma box placeheld "light-armor, shields"; typing "Fire" or "flame"
                     stored a value nothing ever matches, silently. `TagInput` gives the complete
                     canonical list as suggestions and still takes any word (`slugify` is the same
                     normalisation the comma box did by hand). */
                  <TagInput
                    ariaLabel={`Which ${meta?.label.toLowerCase() ?? "grants"}`}
                    values={row.values}
                    onChange={(values) => replace({ values })}
                    suggestions={grantSuggestions(row.kind, ctx)}
                    /* `3d`, site 9 of 9 — `damageResistances` and `damageImmunities` are two of the
                       kinds this one control serves. It is set for the CONTROL rather than for those
                       two kinds, because the alternative is an affordance that appears and vanishes
                       as the "What" select changes beside it — the same box teaching two different
                       things about itself. `TagInput` falls back to the plain input for the kinds
                       with no list (tools, languages), so this reads as "show the list when there is
                       one", which is the sentence a GM can actually hold. */
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
 * The rider field definitions, flattened, for `vocabularies.test.ts` and for
 * `authoring-harness.ts`.
 *
 * Exported for one reason and it is worth naming: the rider vocabulary is ONE vocabulary mounted by
 * items, class features, species traits and feats alike, so a damage-type box that quietly went back
 * to a hand-typed list here would regress on all four carriers at once. The census in that test
 * needs to see these fields, and they are otherwise built inside the component.
 *
 * **Scoped, because the harness asks a second question of it.** `vocabularies.test.ts` asks "does
 * this control offer the whole vocabulary", which one scope answers. `authoring-harness.ts` asks
 * "does a control for this key exist AT ALL", and it asks it of a feature carrier as often as an
 * item one — so the builder takes the scope the carrier is mounted at
 * (`RecordDetail.tsx:232` is the one place that decision is made). The two scopes differ only in
 * option lists and labels, never in keys; `vocabulary-parity.mirror.test.ts` pins that.
 *
 * **`grants` is deliberately absent**, and it is the one honest gap: it is authored by
 * `GrantsEditor` above, a bespoke component that writes eleven parallel arrays whole-body and has no
 * `FieldDef` to export. It stays on the harness's exemption list WITH that reason (U9 closes it by
 * making the eleventh grant kind — `spells` — editable at all).
 */
export function riderFieldsForTest(scope: "feature" | "item"): readonly FieldDef[] {
  return [
    whenField(),
    modifiersField("What it does", scope),
    usesField(scope === "item" ? "Charges" : "Limited uses", scope),
    tagsField("Tags"),
    actionsField(),
    effectsField()
  ];
}

export const RIDER_FIELDS_FOR_TEST: readonly FieldDef[] = riderFieldsForTest("item");

/** Items get everything except `choice` — an item never asks a question at character
    creation, and there is no code path from an item to the wizard. `grants` IS here now:
    an item's grants are layered over the sheet and removed by unequipping, so the
    build-time bake that kept them out no longer exists. */
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
  scope: "feature" | "item";
  labels?: Partial<Record<RiderKind, string>>;
  ctx: SchemaContext;
  idPrefix: string;
}>) {
  const label = (kind: RiderKind, fallback: string) => labels?.[kind] ?? fallback;

  const fields = useMemo<readonly FieldDef[]>(() => {
    const list: FieldDef[] = [];
    if (enabled.includes("modifiers")) list.push(modifiersField(label("modifiers", "Modifiers"), scope));
    if (enabled.includes("uses")) list.push(usesField(label("uses", scope === "item" ? "Charges" : "Limited uses"), scope));
    if (enabled.includes("tags")) list.push(tagsField(label("tags", "Tags")));
    if (enabled.includes("actions")) list.push(actionsField());
    if (enabled.includes("effects")) list.push(effectsField());
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, labels]);

  return (
    <div className="hb-riders">
      {/* The one sentence that carries the mental model, derived and stated ONCE. */}
      <p className="hb-riders-when">
        {scope === "item"
          ? (value.attunement as { required?: boolean } | undefined)?.required === true
            ? "These apply while the item is equipped and attuned."
            : "These apply while the item is equipped."
          : "These apply as soon as the feature is granted."}
      </p>

      {/* What the SHEET will show, derived live from the four inputs above it. A GM
          authoring a flaming sword reads the result instead of inferring it. Display
          only — it must never become a second place these values can be edited. */}
      {scope === "item" && attackReadout(value) && (
        <p className="hb-riders-readout tabular">{attackReadout(value)}</p>
      )}

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

/**
 * "+1 to hit · 1d8 slashing + 1d4 lightning" — the line the sheet will print, assembled
 * from the weapon's own damage and every rider that adds to a swing. Returns `""` when
 * there is nothing to say, so the caller renders nothing rather than an empty affordance.
 */
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
    if (modifier.type !== "extra-damage" || typeof modifier.formula !== "string" || modifier.formula.trim() === "") continue;
    damage.push(`${modifier.formula.trim()}${modifier.damageType ? ` ${String(modifier.damageType).trim()}` : ""}`);
  }

  const parts: string[] = [];
  if (toHit !== 0) parts.push(`${toHit > 0 ? "+" : ""}${toHit} to hit`);
  if (damage.length > 0) parts.push(damage.join(" + "));
  return parts.join(" · ");
}

/** A one-line summary of what a record's riders actually do, so a collapsed row says
    something. Derived; never a second place the values can be edited. */
export function riderSummary(value: Draft): string {
  const parts: string[] = [];
  const modifiers = Array.isArray(value.modifiers) ? value.modifiers.length : 0;
  const actions = Array.isArray(value.actions) ? value.actions.length : 0;
  const effects = Array.isArray(value.effects) ? value.effects.length : 0;
  const grants = value.grants && typeof value.grants === "object" ? Object.values(value.grants as object).filter((entry) => Array.isArray(entry) && entry.length > 0).length : 0;
  if (modifiers) parts.push(`${modifiers} ${modifiers === 1 ? "modifier" : "modifiers"}`);
  if (grants) parts.push(`${grants} ${grants === 1 ? "grant" : "grants"}`);
  if (actions) parts.push(`${actions} ${actions === 1 ? "action" : "actions"}`);
  if (effects) parts.push("an effect");
  if (value.uses) parts.push("limited uses");
  return parts.join(" · ");
}
