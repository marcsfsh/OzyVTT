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
import { CatalogPicker } from "./CatalogPicker";
import { FieldRenderer } from "./FieldRenderer";
import { damagePartsField, diceValidate, grouped, opt, suggestionLabel, type Draft, type FieldDef, type SchemaContext, type SelectOption } from "./schema";

export type RiderKind = "modifiers" | "grants" | "uses" | "tags" | "actions" | "effects";

/**
 * WHICH CARRIER is mounting this form — and the third value is a bug fix, not a nicety.
 *
 * `RecordDetail.tsx` has always branched THREE ways for `enabled` (equipment / monster / feature)
 * and then collapsed to TWO for `scope` (`doc.type === "equipment" ? "item" : "feature"`), so a
 * monster was handed `"feature"`. That mismatch is not cosmetic: a feature's attack is
 * `FeatureAttackSchema` (`ability`, and the builder derives the number from the character's scores),
 * a stat block's is `ActionSchema.attack` (`bonus`, a flat printed to-hit, and it is REQUIRED). One
 * `actionsField` served both and wrote `ability`, so **a monster action with an attack roll could
 * not be published at all** — the GM filled in "Uses: Strength" and the publish gate answered
 * `actions[].attack.bonus: Required`. 423 SRD monster actions author `attack.bonus`.
 *
 * Three-valued, so the next divergence is a compile error rather than a silent wrong body. An
 * ITEM's actions are `featureRiders.actions` — the same `FeatureActionSchema` a feature carries — so
 * `"item"` is feature-shaped wherever the ACTION vocabulary is concerned, and diverges only where
 * the CARRIER is what differs (which riders an item may hold, what a rest gives back).
 */
export type RiderScope = "feature" | "item" | "statblock";

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
    field being wrong NOW, and the corrected form is one the GM can read off the message.
    Exported for `FeatureEditor`'s `extraPicks` column id — the same rule, one definition. */
export const slugValidate = (value: unknown): string | null => {
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
    case "damage-bonus": return { type, amount: 1 };
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
const WEAPON_SCOPED = ["attack-bonus", "damage-bonus", "extra-damage", "critical-range", "critical-bonus-dice"];

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

/** The seven rolls and the two ways, spelled once: `RollModeVariantSchema` is carried by BOTH rider
    vocabularies (the record's own modifiers and an effect's), so both controls read this list. */
const ROLL_MODE_ROLLS: readonly SelectOption[] = [
  opt("attack", "Attack rolls"), opt("incoming-attack", "Attacks against you"), opt("save", "Saving throws"),
  opt("check", "Ability checks"), opt("initiative", "Initiative"), opt("death-save", "Death saves"), opt("concentration", "Concentration")
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
      // `"statblock"` behaves like `"feature"` here, deliberately: the refusal belongs to the ITEM
      // carrier — `EquipmentReferenceSchema` is the schema that rejects these two — and a stat block
      // is not an item. Written as `=== "item"` rather than `!== "feature"` so the reason and the
      // test are the same sentence.
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
    { key: "amount", label: "Amount", kind: "number", allowNegative: true, min: -10, max: 10, help: "Negative for a curse.", visibleWhen: hasType("attack-bonus", "damage-bonus", "save-bonus", "check-bonus") },
    { key: "amount", label: "Extra slots", kind: "number", allowNegative: true, min: -4, max: 4, visibleWhen: hasType("spell-slot") },
    { key: "amount", label: "Extra uses", kind: "number", allowNegative: true, min: -20, max: 20, visibleWhen: hasType("resource-bonus") },
    { key: "amount", label: "Damage reduced by", kind: "number", min: 1, max: 30, visibleWhen: hasType("damage-reduction") },
    { key: "maximum", label: "Raises the cap to", kind: "number", min: 1, max: 30, visibleWhen: hasType("ability-score"), help: "Leave empty to keep the usual 20." },
    { key: "count", label: "Extra attacks", kind: "number", min: 1, max: 3, visibleWhen: hasType("extra-attack") },
    { key: "count", label: "Extra dice", kind: "number", min: 1, max: 4, visibleWhen: hasType("critical-bonus-dice"), help: "The weapon's own die, rolled again. For a typed extra like 1d6 fire, use Extra damage on a critical hit instead." },
    { key: "feet", label: "Distance", kind: "number", min: 0, max: 240, unit: "ft", visibleWhen: hasType("darkvision"), note: "Display only." },
    { key: "whileArmored", label: "Only while wearing armour", kind: "switch", visibleWhen: hasType("armor-class") },
    /* No `note` on a FEATURE or a feat: U28 landed the reader there, and a stale honesty note is a
       lie in the opposite direction. On an ITEM the note stays, because there the whole rider is
       still unread — `unarmored-defense` is in `BUILDER_BAKED_MODIFIER_TYPES`, folded into the sheet
       at build time from a feature or a feat, and `deriveEquipment` sums no such rider off an
       inventory row. The type is offered here because `EquipmentReferenceSchema` accepts it (only
       `ITEM_REFUSED` above is withdrawn), so an item carrying it publishes and then moves nothing —
       in either switch position. Naming that beats an affirmative sentence about a mechanism this
       carrier does not have. */
    { key: "allowShield", label: "A shield still counts", kind: "switch", visibleWhen: hasType("unarmored-defense"),
      help: "On is the Barbarian's rule, off the Monk's — off, a shield replaces this defence with the ordinary 10 + Dexterity.",
      ...(scope === "item" ? { note: "Not read on an item — this defence only reaches a sheet from a feature or a feat." } : {}) },
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
    { key: "roll", label: "On which roll", kind: "select", options: ROLL_MODE_ROLLS, visibleWhen: hasType("roll-mode") },
    { key: "mode", label: "Which way", kind: "select", options: ROLL_MODE_WAYS, visibleWhen: hasType("roll-mode"), help: "Disadvantage is how a cursed item bites." },
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

const usesField = (label: string, scope: RiderScope): FieldDef => ({
  key: "uses",
  label,
  kind: "group",
  // Only an ITEM has charges; a feature carrier gets the plainer sentence.
  //
  // **No stat block mounts this field, and U8 measured that it never should.** The comment here used
  // to say U8 would change it and "will find the copy already correct". It found the opposite:
  // `ActorDefinitionSchema` has no record-level `uses` at all, so a monster mounting this would be
  // writing a key Zod strips in silence. A creature's uses are its ACTIONS' uses
  // (`ActionSchema.uses`, 86 recharge authors among them) and that is where the control went — see
  // `actionUsesField`. `riderFieldsForTest` no longer claims this field at `"statblock"`.
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
      /**
       * **The fifth option is a FEATURE's, and the omission elsewhere is a refusal.**
       *
       * `class-resource` reads the count off the class table's own printed column at this
       * character's level, which is why Rage 2 → 3 → 4 needs no `by-level` table beside the table
       * it would be copying. 19 SRD features stand on it (16 class, 3 subclass).
       *
       * An ITEM is not offered it because it can never resolve: `scaledLimit` in
       * `equipment-derivation.ts` answers `undefined` for `class-resource` **in writing** — a built
       * definition no longer carries a class table, the builder having already flattened it — so an
       * item authored this way would grant no charges no matter what a GM typed. Offering it there
       * would be a box that stores a value the fight can never read, which is the one thing this
       * form exists not to do.
       */
      options: scope === "feature"
        ? [opt("flat", "A flat number"), opt("proficiency-bonus", "Proficiency bonus"), opt("ability-modifier", "Ability modifier"), opt("by-level", "By level"), opt("class-resource", "A column on the class table")]
        : [opt("flat", "A flat number"), opt("proficiency-bonus", "Proficiency bonus"), opt("ability-modifier", "Ability modifier"), opt("by-level", "By level")],
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
      // The four literals below are the schema's own (`FeatureUsesSchema.scaling`'s
      // discriminator) and are byte-identical to the option values above, so there is no
      // mapping table to drift. All four now have an option at feature scope; an item sees the
      // first three plus `flat`, and a body imported with a `class-resource` scaling reads back as
      // "Not set" there — which is the truth about a shape that carrier cannot resolve.
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
          // Seeded EMPTY rather than with a guess: "rage" would silently point a homebrew feature
          // at the Barbarian's column, and `ContentIdSchema` refuses `""`, so the publish checklist
          // names the field until the GM fills it. Same discipline as `resource-bonus`'s `poolId`.
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
    // The `classResources` id off the level table — "rage", "channel-divinity", "sorcery-points".
    // A slug typed one character wrong resolves to 0 uses and the feature silently carries none,
    // which is why the id is checked while typing rather than at publish.
    //
    // ABSENT at the other scopes rather than merely hidden: the mode select offers no
    // `class-resource` option there, so the row could never become visible — and a field the census
    // can see is a claim that a GM can reach the key, which at item scope would be false.
    ...(scope === "feature"
      ? [{
        key: "uses.scaling.id",
        label: "Which column",
        placeholder: "rage",
        validate: slugValidate,
        help: "The column's id on the class's level table — the count is read from it at the character's own level.",
        visibleWhen: (scope_: Draft) => (scope_.uses as { scaling?: { type?: string } } | undefined)?.scaling?.type === "class-resource"
      }]
      : []),
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
      // says so in the schema). Said once, where a GM looking for "day" will read it —
      // which is on an ITEM, so a stat block gets no extra sentence.
      ...(scope === "item" ? { help: "A long rest is this table's day, so “once per day” is “on a long rest”." } : {})
    },
    // A pool is shared by whatever names it. The item wording names both carriers because an item's
    // charges can share a feature's pool; a stat block's actions share pools with each other, which
    // is what the feature sentence already says.
    { key: "uses.pool", label: "Shared pool", help: scope === "item" ? "Items and features sharing a pool share one counter." : "Features sharing a pool share one counter.", placeholder: "channel-divinity" }
  ]
});

/**
 * The to-hit half of an attack, which is the ONE place the three carriers genuinely disagree.
 *
 * A feature and an item both author `FeatureAttackSchema` — they name the ABILITY and the builder
 * resolves the number from the character's own scores, because a class feature cannot know them. A
 * stat block authors `ActionSchema.attack`, whose `bonus` is a flat printed integer and is
 * **required**; there is no `ability` key for it to fall back on, and Zod would strip one silently.
 * So this is `instead of`, not `alongside`: offering both would let a GM fill in a box whose value
 * is dropped on the way to the store, which is the exact failure this form exists to avoid.
 */
const toHitFields = (scope: RiderScope): readonly FieldDef[] =>
  scope === "statblock"
    ? [{ key: "attack.bonus", label: "To hit", kind: "number", allowNegative: true, min: -5, max: 20, help: "The flat bonus the stat block prints — the +9 in “+9 to hit”." }]
    : [{ key: "attack.ability", label: "Uses", kind: "select", options: [...ABILITIES, opt("spellcasting", "Spellcasting ability")] }];

/**
 * **An ACTION's own limited uses — and it is a different schema from the record's, which is why it
 * is a different control.**
 *
 * `usesField` above writes `FeatureUsesSchema`: `limit` OPTIONAL, four `scaling` rules, four `per`
 * values, no `recharge` key at all. An action's `uses` is `ActionUsesSchema` (`@vtt/schemas`), which
 * `ActionSchema` declares and `FeatureActionSchema` inherits: `limit` REQUIRED, **no `scaling` at
 * all** (the union is `.strict()`, so a scaling rule here is a parse error), a FIFTH `per` value
 * `"recharge"`, and a `recharge` threshold. Mounting `usesField` here would have offered four
 * scalings an action cannot hold and hidden the one thing 86 SRD monster actions say — the same
 * mistake `effectModifiersField` exists to avoid one level up.
 *
 * **`recharge` is the row this control exists for, and its reader is the best-proved in the wave.**
 * `encounter.ts` rolls a d6 at the start of the owner's turn, clears the pool on `>= threshold`, and
 * narrates BOTH outcomes by name; `rests.ts` clears recharge pools on a short rest and a fresh fight
 * re-arms them. 86 bundled monster actions author it (67 at 5, 14 at 6, 5 at 4) and **no carrier had
 * a control**: `actionsField` had no `uses` block at any scope, and `RecordDetail` mounts nothing
 * else on a stat block. Offered at all three scopes because all three really read it — a monster's
 * through `ActionSchema` directly, an item's through `usesOf` in `equipment-derivation.ts`, a
 * feature's through `interpretAction`, and all three arrive at the same `ActorAction.uses`.
 *
 * **`FeatureUsesSchema` is deliberately NOT widened to match**, and the reason is a measurement:
 * `character-build.ts` folds a feature's record-level uses into an action at TWO sites, and neither
 * forwards a threshold. A feature authoring `per: "recharge"` would therefore build an
 * `ActorAction.uses` with no `recharge`, which `ActionUsesSchema`'s own refinement rejects with
 * *"Recharge uses need the d6 threshold"* — turning a schema-valid authored record into an
 * unbuildable character. An item's record-level `uses` has no reader at all yet (U24), so widening
 * it there would be a value the fight cannot see. The recharge vocabulary belongs where the engine
 * already reads it, which is the action.
 */
const ACTION_USES_PER: readonly SelectOption[] = [
  opt("turn", "Every turn"), opt("encounter", "Every encounter"), opt("short-rest", "On a short rest"),
  opt("long-rest", "On a long rest"), opt("recharge", "On a die roll")
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
      // `ActionUsesSchema.limit` is REQUIRED and there is no `scaling` to supply it, so clearing the
      // count is how a GM removes the whole block — and `per` is seeded here so a count typed first
      // never publishes as uses with no recovery.
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
      // The threshold and the mode are ONE authored fact and the schema refuses them apart, in both
      // directions: `per: "recharge"` with no threshold, and a threshold with any other `per`, are
      // each their own named refusal. So switching to recharge seeds the SRD's commonest 5 and
      // switching away deletes it — the same replace-the-row discipline `blankModifier` follows.
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
    { key: "uses.pool", label: "Shared pool", placeholder: "breath-weapon", validate: slugValidate, help: "Actions sharing a pool share one counter — and one recharge roll." }
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
    { key: "activation", label: "Costs", kind: "select", options: [opt("action", "An action"), opt("bonus-action", "A bonus action"), opt("reaction", "A reaction"), opt("other", "No action")] },
    { key: "description", label: "Description", kind: "textarea", wide: true },
    damagePartsField("damage", { label: "Damage", max: 8, newId, help: "Every part is rolled on a hit." }),
    {
      key: "attack",
      label: "Attack roll",
      kind: "group",
      rows: [
        ...toHitFields(scope),
        { key: "attack.reachFeet", label: "Reach", kind: "number", min: 1, max: 120, unit: "ft" },
        { key: "attack.rangeFeet", label: "Range", kind: "number", min: 1, max: 1000, unit: "ft", help: "The farthest this can reach at all." },
        /* The second half of a printed "range 80/320" — and it is the ONE number in this group the
           engine turns into a die rather than a refusal. `Range` alone says where the shot becomes
           impossible; this says where it becomes hard, and past it the attack rolls 2d20 keeping the
           lower (`action-resolution.ts`, the `Long range (beyond N ft)` source). 45 SRD records author
           it — every two-band weapon a monster carries. Offered at every scope because both schemas
           have the key: `ActionSchema.attack.rangeNormalFeet` and `FeatureAttackSchema`'s twin. */
        { key: "attack.rangeNormalFeet", label: "Normal range", kind: "number", min: 1, max: 1000, unit: "ft", help: "The 80 in “range 80/320”. Past it, up to the range, the attack rolls at disadvantage." }
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
    },
    actionUsesField()
  ]
});

/** Grouping only, and it is a `FieldDef` like everything else — built here rather than inline in the
    component so `riderFieldsForTest` can state the rider surface COMPLETELY. A key the census cannot
    see is a key the both-paths harness waves through. */
const tagsField = (label: string): FieldDef => ({ key: "tags", label, kind: "tags", help: "Grouping only — no mechanical effect." });

/* ------------------------------------------------------- effect modifiers ------ */

/**
 * **What an effect DOES — the row that made every GM-authored effect decorative.**
 *
 * `EffectGrant.modifiers` is `EffectModifierSchema`, and that is **not** the union
 * `modifiersField` above authors. `FeatureModifierSchema` is 21 variants; `EffectModifierSchema` is
 * 12, and they overlap by exactly three (`attack-bonus`, `extra-damage`, `roll-mode`, declared once
 * in `@vtt/schemas` and spread into both). Mounting `modifiersField` here would have offered
 * eighteen variants an effect cannot hold and hidden nine it can — Reckless Attack's own pair among
 * them — so this is its own list.
 *
 * **Four of the twelve are offered, and each omission is a ruling:**
 *
 *  - **`roll-mode` is the general form**, so `attack-disadvantage`, `incoming-attack-disadvantage`,
 *    `save-advantage` and `save-disadvantage` are not offered beside it: the actor side normalises
 *    every one of them through `toRollModes` and the item side through `asRiderModifiers`, into
 *    exactly this. Two spellings of one sentence is how a vocabulary drifts.
 *  - **`attack-advantage` stays** even though `roll-mode` looks like it covers it, because it does
 *    not: `action-resolution.ts` applies `attack-advantage` **only on the bearer's own turn**
 *    (Reckless Attack semantics) and applies `roll-mode` always. That gate is the whole difference
 *    and it is in the label. `incoming-attack-advantage` stays beside it because the two are one
 *    authored sentence — Reckless Attack's benefit and its cost — and the SRD writes them together.
 *  - **`damage-bonus` is refused rather than forgotten.** `asRiderModifiers` returns nothing for it,
 *    in writing: a flat +N with no type has no rider equivalent, so on an ITEM it is inert by
 *    construction. A control for it would be a box that does nothing, which is the failure this form
 *    exists to avoid. Say it as `extra-damage` on the record's own modifier list instead.
 *  - `damage-vulnerability`, and `attack-bonus`/`extra-damage` **inside** an effect, have zero SRD
 *    authors and the last two already have a control one level up. Each ships the day a record
 *    authors it, not by default.
 *
 * **No `when` list here, deliberately.** The two carriers disagree about it: `attackRollSources`
 * reads a live effect's modifiers straight through `toRollModes` and never evaluates a gate, while
 * an item's effect goes through `collectRiders` and would. A gate that fires on one carrier and not
 * the other is worse than no gate — the effect's own duration and tags are what bound it.
 */
const EFFECT_MODIFIER_TYPES: readonly SelectOption[] = [
  ROLLS("roll-mode", "Advantage or disadvantage"),
  ROLLS("attack-advantage", "Advantage on your attacks, on your turn"),
  ROLLS("incoming-attack-advantage", "Attacks against you have advantage"),
  HARM("damage-resistance", "Resistance to damage")
];

/** Same rule as `blankModifier`: the union is `.strict()`, so switching variant REPLACES the row. */
function blankEffectModifier(type: string): Draft {
  switch (type) {
    case "roll-mode": return { type, roll: "attack", mode: "advantage" };
    case "damage-resistance": return { type, damageTypes: [] };
    default: return { type };
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
    if (modifier.type === "roll-mode") return `${modifier.mode === "disadvantage" ? "Disadvantage" : "Advantage"} on ${String(modifier.roll ?? "attack").replace(/-/g, " ")}`;
    const types = Array.isArray(modifier.damageTypes) ? modifier.damageTypes.map(String) : [];
    return types.length > 0 ? `${name} — ${types.slice(0, 3).join(", ")}${types.length > 3 ? "…" : ""}` : name;
  },
  rows: [
    {
      key: "type",
      label: "What it does",
      kind: "select",
      options: EFFECT_MODIFIER_TYPES,
      write: (next, row) => ({ rowId: (row as { rowId?: string }).rowId ?? newId(), ...blankEffectModifier(String(next)) })
    },
    { key: "roll", label: "On which roll", kind: "select", options: ROLL_MODE_ROLLS, visibleWhen: hasType("roll-mode") },
    { key: "mode", label: "Which way", kind: "select", options: ROLL_MODE_WAYS, visibleWhen: hasType("roll-mode"), help: "Disadvantage is how a curse bites." },
    // `3d`, site 10 of 9 — the count in `vocabularies.test.ts` moves with this list rather than
    // being restated. Half damage of every type named here, and the SRD's own carrier (Superior
    // Defense) names twelve of the thirteen at once.
    { key: "damageTypes", label: "Damage types", kind: "tags", pick: true, suggestions: (ctx) => ctx.damageTypes, visibleWhen: hasType("damage-resistance") }
  ]
});

/**
 * The effects a record grants — and **how many of them the engine really reads is the carrier's
 * business, not one number for all three.**
 *
 * The cap used to be 1 everywhere, with the reason "only the first effect is applied by the rules
 * engine today". That sentence is true of a FEATURE (`character-build.ts` synthesises an activation
 * carrying `feature.effects[0]` and nothing after it) and **false of an ITEM**: `takeEffects` in
 * `equipment-derivation.ts` iterates `block.effects` entire, so an item's second effect was refused
 * by the form for a limit the engine does not have. Four is `featureRiders.effects`'s own maximum.
 *
 * A STAT BLOCK gets one, and for a third reason again: `ActorDefinitionSchema` has no record-level
 * `effects` array at all — a creature's effects hang off `ActionSchema.grants`, which is a SINGLE
 * `EffectGrant`, not a list. So "one" is the schema's number rather than the engine's. (No monster
 * mounts this field today: `RecordDetail` enables only `["actions", "tags"]` on a stat block. The
 * cap is written for the day one does, the same way `usesField`'s copy is.)
 */
const effectsField = (scope: RiderScope): FieldDef => ({
  key: "effects",
  label: "Effects",
  kind: "rows",
  // Stated ONCE, per carrier, and it is why the cap is what it is — authoring mechanics that
  // silently vanish is worse than not offering the field.
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
    { key: "tags", label: "Tags", kind: "tags", help: "The sheet groups effects by these.", suggestions: ["raging", "blessed", "concentrating", "inspired"] },
    { key: "duration.type", label: "Lasts", kind: "select", options: [opt("rounds", "A number of rounds"), opt("until-source-next-turn", "Until your next turn"), opt("encounter", "The whole encounter"), opt("manual", "Until removed by hand")] },
    { key: "duration.rounds", label: "Rounds", kind: "number", min: 1, max: 100, visibleWhen: (row) => (row.duration as { type?: string } | undefined)?.type === "rounds" },
    { key: "concentration", label: "Needs concentration", kind: "switch" },
    // A `rows` field inside a `rows` field, which is the depth `whenField` inside `modifiersField`
    // has always rendered at — `RowEditor` is nesting-safe by construction and `FieldRenderer`'s
    // `rows` case recurses through itself, so this needs no new primitive.
    effectModifiersField()
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
  { key: "conditionImmunities", label: "Condition immunities" },
  // The eleventh, and the last of the eleven arrays to become editable. 41 SRD records author it —
  // domain spells, racial spells, every "you always have X prepared" — and until this landed the
  // editor merely PRESERVED whatever was already in the body on its way past.
  { key: "spells", label: "Spells", help: "Always ready, and they don't count against what the character can prepare." }
];

export type GrantRow = Readonly<{ rowId: string; kind: string; values: readonly string[] }>;

/**
 * **The two ends of the grants boundary, exported — and this is the honest half of `RIDER_EXEMPT`.**
 *
 * `GrantsEditor` is the one rider surface with no `FieldDef` anywhere: eleven parallel arrays behind
 * one `[What ▾][Which…]` row, written whole-body. So `authoring-harness.ts` cannot look a grant key
 * up and waves `grants` through — which means a test that called `applyField(…, "grants.spells", …)`
 * would be writing the body itself and proving nothing about a control.
 *
 * These two functions are the component's OWN read and write, so a test that drives them is driving
 * the control's real path rather than a parallel one. (The rendered affordance is driven in
 * `pick-fields.test.tsx`, the same split the damage-type grant kinds already use.) The exemption
 * stays until every one of the eleven has a `FieldDef`; it must never grow.
 *
 * **`spells` is the one kind whose values are not slugs**, and the mapping is here rather than in
 * the renderer so both directions are one sentence: the GM picks spell ids, the body carries
 * `{id, alwaysPrepared}`. `level` and `ability` are deliberately NOT written — `character-build.ts`
 * resolves the level from the spell record itself (`grantedSpell.level ?? record?.level`), which is
 * righter than a number the editor would have to guess (the client's catalog entry carries only
 * prose), and `ability` is authored by exactly one SRD record and falls back to the caster's own.
 *
 * **The write takes the bag the rows were read FROM, and that argument is required.** A rebuild is
 * only safe if it can hand back the keys it has no row for; a write with no memory of the body it is
 * writing into cannot, and silently deletes them. See `grantsFromRows` for which keys those are and
 * what one of them costs.
 */
export function grantRowsOf(grants: Record<string, unknown>): readonly GrantRow[] {
  return GRANT_KINDS
    .filter((kind) => Array.isArray(grants[kind.key]))
    .map((kind) => ({
      rowId: kind.key,
      kind: kind.key,
      values: kind.key === "spells"
        ? (grants.spells as ReadonlyArray<{ id?: string }>).map((spell) => String(spell?.id ?? ""))
        : ((grants[kind.key] as string[]) ?? [])
    }));
}

/**
 * The rows back into the bag — **plus every key of the bag this editor has no row for, carried
 * through untouched.**
 *
 * THE REBUILD IS THE DANGEROUS HALF. It emits one key per `GRANT_KINDS` entry and nothing else, so
 * without the carry loop below any other key `FeatureGrantsSchema` accepts is DELETED by an ordinary
 * edit — the GM touches one row and loses a field they were never shown.
 *
 * Today that is exactly one key and it is not a cosmetic one. **`grants.when` is the condition the
 * whole block applies under**, and dropping it turns "Immunity to Charmed and Frightened *while your
 * Rage is active*" into permanent immunity — the precise over-grant the field was added to end,
 * arriving through the GM's own UI. It is reachable from shipped content: `/duplicate`
 * `structuredClone`s `path-of-the-berserker` (whose `mindless-rage` carries the gate) into an
 * editable draft, and `FeatureGrantsSchema` accepts the ungated body on the way out, so nothing
 * downstream would have refused it.
 *
 * **MIRRORED FROM THE `spells` PRECEDENT**, which `write` below still names: `spells` used to be
 * re-attached verbatim after the bag was rebuilt, because the editor preserved what it could not
 * edit. `when` gets the same treatment for the same reason — this editor exposes no gate control —
 * and it is written as "every key with no row" rather than as `if (previous.when)` so that the next
 * key added to the schema is carried by construction instead of arriving as this bug wearing a
 * different name. `grant-gate-preservation.mirror.test.ts` pins the partition against
 * `FeatureGrantsFieldsSchema.shape` itself, so a twelfth key fails there rather than in a fight.
 * (The FIELDS schema, not `FeatureGrantsSchema`: the latter is that object plus the one cross-field
 * refusal refusing `when` beside `spells`, which makes it a `ZodEffects` with no `.shape` to read.)
 *
 * A carried key keeps the block alive on its own: clearing every row leaves `{when}` rather than
 * `undefined`. That direction is deliberate — a gate with no lists grants nothing, while a rebuild
 * that dropped the gate on the way through zero rows would put the over-grant two gestures away.
 */
export function grantsFromRows(rows: readonly GrantRow[], previous: Record<string, unknown>): Record<string, unknown> | undefined {
  const bag: Record<string, unknown> = {};
  for (const row of rows) {
    if (!row.kind) continue;
    bag[row.kind] = row.kind === "spells"
      ? row.values.map((id) => ({ id, alwaysPrepared: true }))
      : row.values;
  }
  for (const [key, carried] of Object.entries(previous)) {
    if (!GRANT_KINDS.some((kind) => kind.key === key)) bag[key] = carried;
  }
  return Object.keys(bag).length > 0 ? bag : undefined;
}

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
}: Readonly<{ value: Draft; onChange: (next: Draft) => void; ctx: SchemaContext; scope: RiderScope }>) {
  const grants = (value.grants ?? {}) as Record<string, unknown>;

  const rows = useMemo<readonly GrantRow[]>(() => grantRowsOf(grants), [grants]);

  // `spells` used to be re-attached HERE, verbatim, after the bag was rebuilt — the editor preserved
  // what it could not edit. It is a kind like the other ten now, so the boundary is one function —
  // and that same preservation is what `grantsFromRows` does with `grants.when`, which is why the
  // current bag is passed rather than the rows alone.
  const write = (next: readonly GrantRow[]) => onChange({ ...value, grants: grantsFromRows(next, grants) });

  /**
   * **Ten kinds on an item, eleven everywhere else — and the missing one is a refusal, not an
   * oversight.** `EquipmentReferenceSchema` spreads `featureRiders`, so an item's body PARSES a
   * `grants.spells`; nothing reads it. `takeGrants` in `equipment-derivation.ts` folds nine grant
   * arrays for an equipped item and `spells` is not among them, while `character-build.ts` reads it
   * only off a FEATURE. Offering it here would be a box that stores a value the fight never sees,
   * which is the one thing this form exists not to do.
   */
  const kinds = GRANT_KINDS.filter((kind) => kind.key !== "spells" || scope !== "item");
  const unused = kinds.filter((kind) => !rows.some((row) => row.kind === kind.key));

  return (
    <div className="hb-field">
      <span className="nh-field-label">Grants</span>
      {/* One behavioural difference, stated once and only where it differs: the same
          authored shape, two lifecycles, because the two carriers have two lifecycles. */}
      <p className="nh-field-help">
        Proficiencies and languages this hands out for free.
        {/* The extra sentence is the ITEM's lifecycle — layered on while equipped, removed when it
            comes off. A stat block's grants are simply part of the creature, like a feature's, so
            there is nothing extra to say and nothing is said. */}
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
          // A collapsed spells row reads the NAMES the GM picked, not the slugs it stores.
          const shown = row.kind === "spells" ? row.values.map((id) => ctx.spells.find((entry) => entry.id === id)?.name ?? id) : row.values;
          return shown.length > 0 ? `${label}: ${shown.join(", ")}` : label;
        }}
        renderRow={(row, index) => {
          const meta = GRANT_KINDS.find((kind) => kind.key === row.kind);
          const options = row.kind === "saves" ? ABILITIES : row.kind === "skills" || row.kind === "expertise" ? ctx.skills : null;
          const replace = (patch: Partial<GrantRow>) => write(rows.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
          // A body that already carries a kind this scope does not offer (an imported item with a
          // spell grant) still shows its own row rather than a blank select the GM cannot read.
          const kindOptions = kinds.some((kind) => kind.key === row.kind) ? kinds : [...kinds, ...GRANT_KINDS.filter((kind) => kind.key === row.kind)];
          return (
            <FieldGrid>
              <Field label="What">
                <Select
                  value={row.kind}
                  onChange={(event) => replace({ kind: event.target.value, values: [] })}
                >
                  {kindOptions.map((kind) => (
                    <option key={kind.key} value={kind.key} disabled={kind.key !== row.kind && rows.some((entry) => entry.kind === kind.key)}>
                      {kind.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Which" help={meta?.help} className="nh-fieldgrid-wide">
                {row.kind === "spells" ? (
                  /* THE ELEVENTH KIND, and the one that could not be a `TagInput`. The other ten are
                     slug sets a GM can reasonably type; a spell id is one of 339 and a character
                     wrong is a grant that silently hands out nothing. So "Which" here is the same
                     `CatalogPicker` the item's cast row already uses — a searchable modal over the
                     merged catalog, homebrew included — with the chosen spells shown as removable
                     chips beside it. Multi-pick, so the picker itself holds no value: it appends and
                     resets, and the chips ARE the value. */
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
                      onChange={(next) => { if (next) replace({ values: [...row.values, next] }); }}
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
 * item one — so the builder takes the scope the carrier is mounted at (`RecordDetail.tsx` is the one
 * place that decision is made).
 *
 * **A STAT BLOCK MOUNTS TWO OF THE SIX, and this list used to claim all six.** `RecordDetail` enables
 * exactly `["actions", "tags"]` on a monster, and that is not a UI choice — `ActorDefinitionSchema`
 * has **no record-level `modifiers`, `uses` or `effects`** to hold the other three, and being a plain
 * `z.object` it would drop them in silence. So while this returned the whole list for `"statblock"`,
 * `hasControl("monster", "uses")` answered `true` for a key no stat block can carry and no monster
 * form renders: a false PASS on the exact question the harness exists to ask. `usesField`'s own
 * comment said U8 was the unit that would change that, and U8 measured the opposite — a stat block's
 * uses live on its ACTIONS, where `ActionSchema.uses` really is and where all 86 SRD recharge
 * authors are. Narrowed rather than made true, and `vocabulary-parity.mirror.test.ts` asserts the
 * narrow shape per carrier.
 *
 * **`grants` is deliberately absent**, and it is the one honest gap: it is authored by
 * `GrantsEditor` above, a bespoke component that writes eleven parallel arrays whole-body and has no
 * `FieldDef` to export. It stays on the harness's exemption list WITH that reason. **U9 did not
 * retire it, and the reason is worth keeping straight:** U9 made the eleventh array — `spells` —
 * editable rather than merely preserved, so all eleven kinds now have a control. But a control is
 * not a `FieldDef`, and the exemption is about the LOOKUP: all eleven are bespoke JSX behind one
 * `[What ▾][Which…]` row, so there is still nothing for `fieldsOf` to find. Retiring it means
 * converting `GrantsEditor` itself, which has no vocabulary of its own and is therefore a refactor,
 * not a unit. `grantRowsOf`/`grantsFromRows` are what a test drives in the meantime.
 */
export function riderFieldsForTest(scope: RiderScope): readonly FieldDef[] {
  // The two `RecordDetail` really enables on a monster, in the order it renders them. `whenField` is
  // absent with `modifiersField`, which is the only place it nests.
  if (scope === "statblock") return [tagsField("Tags"), actionsField(scope)];
  return [
    whenField(),
    modifiersField("What it does", scope),
    // "Charges" is an item's word for it; a feature carrier's is plainer.
    usesField(scope === "item" ? "Charges" : "Limited uses", scope),
    tagsField("Tags"),
    actionsField(scope),
    effectsField(scope)
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
  scope: RiderScope;
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
    if (enabled.includes("actions")) list.push(actionsField(scope));
    if (enabled.includes("effects")) list.push(effectsField(scope));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, labels]);

  return (
    <div className="hb-riders">
      {/* The one sentence that carries the mental model, derived and stated ONCE — and it needed
          the third carrier as much as the attack control did. A monster editing its own Bite was
          being told "These apply as soon as the feature is granted", which names a thing a stat
          block does not have. */}
      <p className="hb-riders-when">
        {scope === "item"
          ? (value.attunement as { required?: boolean } | undefined)?.required === true
            ? "These apply while the item is equipped and attuned."
            : "These apply while the item is equipped."
          : scope === "statblock"
            ? "These are the creature's own — always available to it."
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
  // An item may carry four (see `effectsField`), so this stopped being "an effect" the day the cap
  // became the carrier's rather than one number for all three.
  if (effects) parts.push(effects === 1 ? "an effect" : `${effects} effects`);
  if (value.uses) parts.push("limited uses");
  return parts.join(" · ");
}
