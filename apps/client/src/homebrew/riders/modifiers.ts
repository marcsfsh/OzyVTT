import { ITEM_REFUSED_MODIFIER_TYPES, type Modifier } from "@vtt/content-srd-5.2.1/schemas";
import { newId } from "../../lib/ids";
import { type Draft, type FieldDef, type SelectOption, diceValidate, grouped, opt } from "../schema";
import { ABILITIES, DAMAGE_TYPES, type RiderScope } from "../vocabulary";
import { EFFECT_MODIFIER_LABELS } from "./effects";
import { hasType, slugValidate, whenField } from "./triggers";

/** The typed modifiers, in four groups: a bounded union (ADR-0008); anything else stays prose. Keyed by type, so a
    modifier the server adds doesn't compile until it has a group and a label. A feature or item grants resistance
    and vulnerability through `grants`; only an effect carries them as modifiers. */
const MODIFIER_LABELS: Readonly<
  Record<
    Exclude<Modifier["type"], "damage-resistance" | "damage-vulnerability">,
    readonly [group: string, label: string]
  >
> = {
  "attack-bonus": ["Rolls", "Attack rolls"],
  "save-bonus": ["Rolls", "Saving throws"],
  "check-bonus": ["Rolls", "Ability checks"],
  initiative: ["Rolls", "Initiative"],
  "roll-mode": ["Rolls", "Advantage or disadvantage"],
  "damage-bonus": ["Damage and defence", "Damage rolls"],
  "extra-damage": ["Damage and defence", "Extra damage"],
  "critical-range": ["Damage and defence", "Critical hit range"],
  "critical-bonus-dice": ["Damage and defence", "Extra dice on a critical hit"],
  "damage-reduction": ["Damage and defence", "Damage taken"],
  "armor-class": ["Damage and defence", "Armour class"],
  "unarmored-defense": ["Damage and defence", "Unarmoured defence"],
  "hit-points-per-level": ["Damage and defence", "Hit points per level"],
  "spell-save-dc": ["Spellcasting", "Spell save DC"],
  "spell-attack-bonus": ["Spellcasting", "Spell attack rolls"],
  "spell-slot": ["Spellcasting", "Spell slots"],
  "ability-score": ["The character", "Ability score"],
  speed: ["The character", "Speed"],
  "extra-attack": ["The character", "Extra attack"],
  darkvision: ["The character", "Darkvision"],
  sense: ["The character", "Another sense"],
  "resource-bonus": ["The character", "A limited-use pool"],
  "short-rest-regain": ["The character", "Uses back on a short rest"],
  "attunement-slots": ["The character", "Attunement slots"]
};

const MODIFIER_TYPES: readonly SelectOption[] = Object.entries(MODIFIER_LABELS).map(([type, [group, label]]) =>
  grouped(group)(type, label)
);

/** The GM-facing word for a modifier type, used by publish blockers. */
export const modifierLabel = (type: unknown): string => {
  const labels: Partial<Record<string, readonly [string, string]>> = { ...EFFECT_MODIFIER_LABELS, ...MODIFIER_LABELS };
  return labels[String(type ?? "")]?.[1] ?? "a modifier";
};

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
      return { type, formula: "1d6", doubleOnCritical: true };
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
    case "short-rest-regain":
      return { type, poolId: "", amount: 1 };
    case "attunement-slots":
      return { type, amount: 1 };
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

/** The rolls a roll-mode variant can target; `RollModeVariantSchema` is shared by modifiers and effects. */
export const ROLL_MODE_ROLLS: readonly SelectOption[] = [
  opt("attack", "Attack rolls"),
  opt("incoming-attack", "Attacks against you"),
  opt("save", "Saving throws"),
  opt("check", "Ability checks"),
  opt("initiative", "Initiative"),
  opt("concentration", "Concentration")
];
export const ROLL_MODE_WAYS: readonly SelectOption[] = [
  opt("advantage", "Advantage"),
  opt("disadvantage", "Disadvantage")
];

export const signed = (amount: number) => `${amount >= 0 ? "+" : ""}${amount}`;

export const modifiersField = (label: string, scope: RiderScope): FieldDef => ({
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
        scope === "item"
          ? MODIFIER_TYPES.filter((entry) => !(ITEM_REFUSED_MODIFIER_TYPES as readonly string[]).includes(entry.value))
          : MODIFIER_TYPES,
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
      label: "Extra attuned items",
      kind: "number",
      min: 1,
      max: 3,
      visibleWhen: hasType("attunement-slots"),
      help: "Beyond the usual three. Use Magic Device is 1."
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
      key: "amount",
      label: "Uses back",
      kind: "number",
      min: 1,
      max: 20,
      visibleWhen: hasType("short-rest-regain"),
      help: "Leave it empty to give every spent use back."
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
    {
      key: "proficiencyBonus",
      label: "Also add the Proficiency Bonus",
      kind: "switch",
      visibleWhen: hasType("initiative"),
      help: "Alert's rule. A feature's or feat's is built into the character when it is built or levelled; an item's counts while the item is in use."
    },
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
      placeholder: "Same as the attack",
      emptyValue: "omit",
      visibleWhen: hasType("extra-damage"),
      help: "Leave it on “Same as the attack” for damage that follows the weapon or spell."
    },
    {
      key: "doubleOnCritical",
      label: "Doubled on a critical hit",
      kind: "switch",
      visibleWhen: hasType("extra-damage"),
      help: "On is the rule: a critical hit rolls the attack's extra dice twice too."
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
      key: "poolId",
      label: "Which pool",
      placeholder: "rage",
      validate: slugValidate,
      visibleWhen: hasType("short-rest-regain"),
      help: "The shared-pool name a feature already uses. It still comes back in full on a long rest."
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
