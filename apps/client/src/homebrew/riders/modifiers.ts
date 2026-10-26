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
    Exclude<Modifier["type"], "damage-resistance" | "damage-vulnerability" | "damage-immunity">,
    readonly [group: string, label: string]
  >
> = {
  "attack-bonus": ["Rolls", "Attack rolls"],
  "save-bonus": ["Rolls", "Saving throws"],
  "check-bonus": ["Rolls", "Ability checks"],
  initiative: ["Rolls", "Initiative"],
  "roll-mode": ["Rolls", "Advantage or disadvantage"],
  "d20-minimum": ["Rolls", "Lowest d20"],
  "total-minimum": ["Rolls", "Lowest total"],
  "damage-bonus": ["Damage and defence", "Damage rolls"],
  "extra-damage": ["Damage and defence", "Extra damage"],
  "critical-range": ["Damage and defence", "Critical hit range"],
  "critical-bonus-dice": ["Damage and defence", "Extra dice on a critical hit"],
  "damage-reduction": ["Damage and defence", "Damage taken"],
  "damage-die-minimum": ["Damage and defence", "Lowest damage die"],
  "ignores-resistance": ["Damage and defence", "Damage that ignores Resistance"],
  "advantage-denied": ["Damage and defence", "No Advantage on attacks against it"],
  "ignores-cover": ["Damage and defence", "Attacks that ignore cover"],
  "no-critical-hits": ["Damage and defence", "Critical hits against it become normal hits"],
  "spell-ward": ["Damage and defence", "Spells that can't reach it"],
  "healing-received-maximized": ["Healing", "Healing received at its most"],
  "healing-dice-maximized": ["Healing", "Healing dice at their most"],
  "healing-bonus": ["Healing", "More healing"],
  "armor-class": ["Damage and defence", "Armour class"],
  "base-armor-class": ["Damage and defence", "Base armour class without armour"],
  "unarmored-defense": ["Damage and defence", "Unarmoured defence"],
  "hit-points-per-level": ["Damage and defence", "Hit points per level"],
  "spell-save-dc": ["Spellcasting", "Spell save DC"],
  "spell-attack-bonus": ["Spellcasting", "Spell attack rolls"],
  "spell-slot": ["Spellcasting", "Spell slots"],
  "ability-score": ["The character", "Ability score"],
  "ability-score-minimum": ["The character", "Ability score of at least"],
  speed: ["The character", "Speed"],
  "speed-minimum": ["The character", "Speed of at least"],
  "carrying-capacity-larger": ["The character", "Carries as one size larger"],
  "special-speed": ["The character", "Fly, swim, climb or burrow speed"],
  movement: ["The character", "Falling and jumping"],
  "extra-attack": ["The character", "Extra attack"],
  darkvision: ["The character", "Darkvision"],
  sense: ["The character", "Another sense"],
  "resource-bonus": ["The character", "A limited-use pool"],
  "short-rest-regain": ["The character", "Uses back on a Short Rest"],
  "attunement-slots": ["The character", "Attunement slots"],
  "proficiency-bonus": ["The character", "Proficiency Bonus"],
  "granted-score-bonus": ["The character", "Raises another item's score"],
  "ignores-long-range": ["Damage and defence", "No Disadvantage at long range"]
};

/** Authored only by the content (a Hammer of Thunderbolts raising a Belt of Giant Strength's score), so the editor
 *  doesn't offer them. */
const CONTENT_ONLY_MODIFIERS: ReadonlySet<string> = new Set(["granted-score-bonus"]);

const MODIFIER_TYPES: readonly SelectOption[] = Object.entries(MODIFIER_LABELS)
  .filter(([type]) => !CONTENT_ONLY_MODIFIERS.has(type))
  .map(([type, [group, label]]) => grouped(group)(type, label));

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
    case "ability-score-minimum":
      return { type, ability: "str", score: 19 };
    case "hit-points-per-level":
      return { type, amount: 1 };
    case "speed":
      return { type, amount: 10 };
    case "speed-minimum":
      return { type, feet: 30 };
    case "ignores-cover":
      return { type, degree: "half" };
    case "special-speed":
      return { type, movement: "fly", feet: 30 };
    case "movement":
      return { type, rule: "safe-fall" };
    case "armor-class":
      return { type, amount: 1, whileArmored: false };
    case "base-armor-class":
      return { type, base: 13 };
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
    case "proficiency-bonus":
      return { type, amount: 1 };
    case "critical-range":
      return { type, threshold: 19 };
    case "critical-bonus-dice":
      return { type, count: 1 };
    case "damage-reduction":
      return { type, amount: 1 };
    case "sense":
      return { type, sense: "", feet: 30 };
    case "d20-minimum":
      return { type, roll: "check", minimum: 10 };
    case "total-minimum":
      return { type, roll: "check", abilityScore: "str" };
    case "damage-die-minimum":
      return { type, minimum: 3 };
    case "ignores-resistance":
      return { type, damageTypes: [] };
    case "advantage-denied":
      return { type, roll: "incoming-attack" };
    case "spell-ward":
      return { type, schools: ["divination"] };
    case "healing-bonus":
      return { type, amount: 2 };
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
  opt("concentration", "Concentration"),
  opt("death-save", "Death saving throws")
];
/** The rolls a floor can raise. */
const FLOORED_ROLLS: readonly SelectOption[] = [opt("check", "Ability checks"), opt("save", "Saving throws")];

/** A switch over a key the schema takes only as `true`: on writes it, off removes it. */
const trueOnly = (key: string): Pick<FieldDef, "read" | "write"> => ({
  read: (row) => row[key] === true,
  write: (next, row) => {
    const rest = { ...row };
    delete rest[key];
    return next === true ? { ...rest, [key]: true } : rest;
  }
});
/** A list the schema takes as absent when empty, never as an empty list. */
const listOrAbsent = (key: string): Pick<FieldDef, "read" | "write"> => ({
  read: (row) => (Array.isArray(row[key]) ? row[key] : []),
  write: (next, row) => {
    const rest = { ...row };
    delete rest[key];
    const list = Array.isArray(next) ? (next as string[]) : [];
    return list.length > 0 ? { ...rest, [key]: list } : rest;
  }
});

/** Signed dice ("1d4", or "-1d4" to take them off), as `SignedDiceSchema` takes them. */
const signedDiceValidate = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "" || /^-?[1-4]d(?:4|6|8|10|12)$/.test(text)) return null;
  return `"${text}" isn't dice this takes. Try 1d4, or -1d4 to take them off.`;
};
export const ROLL_MODE_WAYS: readonly SelectOption[] = [
  opt("advantage", "Advantage"),
  opt("disadvantage", "Disadvantage")
];

export const signed = (amount: number) => `${amount >= 0 ? "+" : ""}${amount}`;

const MOVEMENTS: readonly SelectOption[] = [
  opt("fly", "Fly"),
  opt("swim", "Swim"),
  opt("climb", "Climb"),
  opt("burrow", "Burrow")
];

/** The row's words for a granted speed: "Fly 60 ft", "Climb equal to Speed". */
export function specialSpeedLabel(modifier: Readonly<Record<string, unknown>>): string {
  const movement = MOVEMENTS.find((entry) => entry.value === modifier.movement)?.label ?? "Fly";
  const amount = modifier.equalToSpeed === true ? "equal to Speed" : `${Number(modifier.feet ?? 0)} ft`;
  return `${movement} ${amount}${modifier.hover === true ? ", hovers" : ""}`;
}

/** The fields of a granted speed (Fly's 60 feet, Spider Climb's Climb Speed equal to Speed), shared with effects. */
export const specialSpeedFields = (): FieldDef[] => [
  {
    key: "movement",
    label: "Way of moving",
    kind: "select",
    options: MOVEMENTS,
    visibleWhen: hasType("special-speed")
  },
  {
    key: "equalToSpeed",
    label: "Equal to its Speed",
    kind: "switch",
    visibleWhen: hasType("special-speed"),
    help: 'On for "a Climb Speed equal to your Speed".'
  },
  {
    key: "feet",
    label: "Speed",
    kind: "number",
    min: 5,
    max: 300,
    unit: "ft",
    visibleWhen: (row) => row.type === "special-speed" && row.equalToSpeed !== true
  },
  {
    key: "hover",
    label: "Can hover",
    kind: "switch",
    visibleWhen: (row) => row.type === "special-speed" && row.movement === "fly"
  }
];

const MOVEMENT_RULES: readonly SelectOption[] = [
  opt("safe-fall", "Takes no damage from falling"),
  opt("leap", "Leaps for a set cost"),
  opt("jump-by-dexterity", "Jumps with Dexterity"),
  opt("jump-multiplier", "Jumps farther")
];

/** The row's words for a falling or jumping rule: "Leap 30 ft for 10 ft", "Jump distance x2". */
function movementRuleLabel(modifier: Readonly<Record<string, unknown>>): string {
  if (modifier.rule === "leap")
    return `Leap ${Number(modifier.feet ?? 30)} ft for ${Number(modifier.costFeet ?? 10)} ft`;
  if (modifier.rule === "jump-multiplier") return `Jump distance x${Number(modifier.times ?? 2)}`;
  return MOVEMENT_RULES.find((entry) => entry.value === modifier.rule)?.label ?? "Falling and jumping";
}

/** The fields of a falling or jumping rule (Ring of Feather Falling, Boots of Striding and Springing). */
const movementRuleFields = (): FieldDef[] => [
  { key: "rule", label: "Rule", kind: "select", options: MOVEMENT_RULES, visibleWhen: hasType("movement") },
  {
    key: "feet",
    label: "Jump up to",
    kind: "number",
    min: 5,
    max: 120,
    unit: "ft",
    visibleWhen: (row) => row.type === "movement" && row.rule === "leap"
  },
  {
    key: "costFeet",
    label: "Movement it spends",
    kind: "number",
    min: 0,
    max: 60,
    unit: "ft",
    visibleWhen: (row) => row.type === "movement" && row.rule === "leap"
  },
  {
    key: "times",
    label: "Times as far",
    kind: "number",
    min: 2,
    max: 4,
    visibleWhen: (row) => row.type === "movement" && row.rule === "jump-multiplier"
  }
];

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
    if (modifier.type === "special-speed") return specialSpeedLabel(modifier);
    if (modifier.type === "movement") return movementRuleLabel(modifier);
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
      visibleWhen: hasType("ability-score", "ability-score-minimum", "unarmored-defense")
    },
    {
      key: "score",
      label: "Score",
      kind: "number",
      min: 1,
      max: 30,
      visibleWhen: hasType("ability-score-minimum"),
      help: "A lower score counts as this while it lasts, as Gauntlets of Ogre Power make Strength 19."
    },
    {
      key: "feet",
      label: "At least",
      kind: "number",
      min: 5,
      max: 120,
      unit: "ft",
      visibleWhen: hasType("speed-minimum")
    },
    {
      key: "ignoresArmor",
      label: "Heavy armour takes nothing from it",
      kind: "switch",
      visibleWhen: hasType("speed-minimum"),
      ...trueOnly("ignoresArmor"),
      help: "On when armour whose Strength the bearer lacks still leaves this Speed."
    },
    {
      key: "degree",
      label: "Cover it ignores",
      kind: "select",
      options: [opt("half", "Half cover"), opt("three-quarters", "Half and three-quarters cover")],
      visibleWhen: hasType("ignores-cover"),
      help: "Total cover still blocks. Add a condition for the kind of attack, such as a spell attack."
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
        "spell-attack-bonus",
        "proficiency-bonus"
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
      min: 0,
      max: 30,
      visibleWhen: hasType("damage-reduction")
    },
    {
      key: "amount",
      label: "More hit points",
      kind: "number",
      min: 0,
      max: 20,
      visibleWhen: hasType("healing-bonus")
    },
    {
      key: "dice",
      label: "Plus dice",
      placeholder: "1d4",
      validate: signedDiceValidate,
      visibleWhen: hasType("attack-bonus", "save-bonus", "check-bonus", "damage-bonus"),
      emptyValue: "omit",
      help: "Rolled on top of the amount, as Bless adds 1d4. Write -1d4 to take them off."
    },
    {
      key: "dice",
      label: "Plus dice",
      placeholder: "1d4",
      validate: diceValidate,
      visibleWhen: hasType("damage-reduction"),
      emptyValue: "omit",
      help: "Rolled as the damage lands, as Resistance takes off 1d4."
    },
    {
      key: "oncePerTurn",
      label: "Once a turn",
      kind: "switch",
      visibleWhen: hasType("damage-reduction", "extra-damage"),
      ...trueOnly("oncePerTurn"),
      help: "A reduction lands on one hit a turn; extra damage is dealt once a turn, as Colossus Slayer's."
    },
    {
      key: "leavesOne",
      label: "Leaves at least 1 damage",
      kind: "switch",
      visibleWhen: hasType("damage-bonus"),
      ...trueOnly("leavesOne"),
      help: "For a penalty that can't take the damage below 1."
    },
    {
      key: "abilityModifier",
      label: "Plus an ability modifier",
      kind: "select",
      options: ABILITIES,
      emptyValue: "omit",
      visibleWhen: hasType("check-bonus"),
      help: "Adds the character's own modifier in that ability to the check."
    },
    {
      key: "minimum",
      label: "At least",
      kind: "number",
      allowNegative: true,
      min: -5,
      max: 10,
      emptyValue: "omit",
      visibleWhen: (row) => row.type === "check-bonus" && row.abilityModifier !== undefined,
      help: "The least the ability modifier counts as, such as +1."
    },
    {
      key: "roll",
      label: "On which roll",
      kind: "select",
      options: FLOORED_ROLLS,
      visibleWhen: hasType("d20-minimum", "total-minimum")
    },
    {
      key: "minimum",
      label: "A lower d20 counts as",
      kind: "number",
      min: 2,
      max: 20,
      visibleWhen: hasType("d20-minimum")
    },
    {
      key: "proficientOnly",
      label: "Only with a proficiency",
      kind: "switch",
      ...trueOnly("proficientOnly"),
      visibleWhen: hasType("d20-minimum"),
      help: "On for a check that uses one of the character's skill or tool proficiencies."
    },
    {
      key: "abilityScore",
      label: "A lower total counts as the score in",
      kind: "select",
      options: ABILITIES,
      visibleWhen: hasType("total-minimum")
    },
    {
      key: "minimum",
      label: "A lower die counts as",
      kind: "number",
      min: 2,
      max: 12,
      visibleWhen: hasType("damage-die-minimum")
    },
    {
      key: "damageTypes",
      label: "Damage types",
      kind: "multiselect",
      options: DAMAGE_TYPES,
      visibleWhen: hasType("ignores-resistance")
    },
    {
      key: "perSlotLevel",
      label: "Plus the spell slot's level",
      kind: "switch",
      ...trueOnly("perSlotLevel"),
      visibleWhen: hasType("healing-bonus"),
      help: "Only on a spell cast with a spell slot."
    },
    {
      key: "self",
      label: "The healer regains it",
      kind: "switch",
      ...trueOnly("self"),
      visibleWhen: hasType("healing-bonus"),
      help: "Once the healing reaches someone else."
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
      note: "Dynamic vision reads it; the best range counts."
    },
    {
      key: "extends",
      label: "Adds to other Darkvision",
      kind: "switch",
      visibleWhen: hasType("darkvision"),
      ...trueOnly("extends"),
      help: "The feet are added to the bearer's other Darkvision, as Goggles of Night's 60 feet are."
    },
    ...specialSpeedFields(),
    ...movementRuleFields(),
    { key: "whileArmored", label: "Only while wearing armour", kind: "switch", visibleWhen: hasType("armor-class") },
    {
      key: "base",
      label: "Base AC",
      kind: "number",
      min: 11,
      max: 20,
      visibleWhen: hasType("base-armor-class"),
      help: "Plus Dexterity, while no armour is worn. A shield still adds. The best way to work out AC counts."
    },
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
      help: "On follows the Barbarian's rule, and off follows the Monk's. With it off, a shield replaces this defence with the ordinary 10 + Dexterity.",
      ...(scope === "item"
        ? { note: "Not read on an item. This defence only reaches a sheet from a feature or a feat." }
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
      help: `Adds the character's own modifier when the damage is rolled, as in "add your Charisma modifier to the damage".`
    },
    {
      key: "damageType",
      label: "Damage type",
      kind: "select",
      options: DAMAGE_TYPES,
      placeholder: "Same as the attack",
      emptyValue: "omit",
      visibleWhen: hasType("extra-damage"),
      help: 'Leave it on "Same as the attack" for damage that follows the weapon or spell.'
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
      help: "The shared-pool name a feature already uses. It still comes back in full on a Long Rest."
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
    {
      key: "schools",
      label: "Schools",
      kind: "tags",
      visibleWhen: hasType("spell-ward"),
      suggestions: (ctx) => ctx.schools,
      ...listOrAbsent("schools"),
      help: "A spell of these schools can't target the bearer, and its area leaves the bearer out."
    },
    {
      key: "spellIds",
      label: "Spells",
      kind: "tags",
      visibleWhen: hasType("spell-ward"),
      suggestions: (ctx) => ctx.spells.map((entry) => entry.id),
      ...listOrAbsent("spellIds"),
      help: "These spells can't reach the bearer either, whatever their school, as Zone of Truth can't a Ring of Mind Shielding's."
    },
    {
      key: "typeSenses",
      label: "Hidden from senses that tell its type",
      kind: "switch",
      visibleWhen: hasType("spell-ward"),
      ...trueOnly("typeSenses"),
      help: "On when no magic may learn the bearer's type, so Divine Sense doesn't find it either."
    },
    {
      key: "alliesAllowed",
      label: "Lets its own side's spells through",
      kind: "switch",
      visibleWhen: hasType("spell-ward"),
      ...trueOnly("alliesAllowed"),
      help: "On when the bearer may allow a spell, as an Amulet of Proof against Detection and Location's wearer does."
    },
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
