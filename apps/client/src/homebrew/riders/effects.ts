import { type Modifier } from "@vtt/content-srd-5.2.1/schemas";
import { newId } from "../../lib/ids";
import { type Draft, type FieldDef, type SelectOption, grouped, opt } from "../schema";
import { DAMAGE_TYPES, type RiderScope } from "../vocabulary";
import { ROLL_MODE_ROLLS, ROLL_MODE_WAYS, signed, specialSpeedFields, specialSpeedLabel } from "./modifiers";
import { hasType, whenField } from "./triggers";

/**
 * What an effect does: the same `ModifierSchema` as a feature's or an item's modifiers, gated the same way, read
 * by the same evaluator. An effect refuses what the sheet stores (`EFFECT_REFUSED_MODIFIER_TYPES`), and this
 * form offers the subset an effect is usually written with:
 * - `roll-mode` for advantage or disadvantage on a named roll (Reckless Attack, Dodge, Rage's Strength checks
 *   with an "Only for…" ability line).
 * - `damage-resistance` and `damage-vulnerability`.
 * - `speed`, summed live and given back when the effect ends.
 * - `special-speed`, a Fly, Swim, Climb or Burrow Speed while the effect lasts (Fly, Spider Climb).
 */
export const EFFECT_MODIFIER_LABELS = {
  "roll-mode": ["Rolls", "Advantage or disadvantage"],
  "damage-resistance": ["Damage and defence", "Resistance to damage"],
  "damage-vulnerability": ["Damage and defence", "Vulnerability to damage"],
  speed: ["The character", "Speed"],
  "special-speed": ["The character", "Fly, swim, climb or burrow speed"]
} as const satisfies Partial<Record<Modifier["type"], readonly [group: string, label: string]>>;
const EFFECT_MODIFIER_TYPES: readonly SelectOption[] = Object.entries(EFFECT_MODIFIER_LABELS).map(
  ([type, [group, label]]) => grouped(group)(type, label)
);

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
    case "special-speed":
      return { type, movement: "fly", feet: 30 };
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
    if (modifier.type === "special-speed") return specialSpeedLabel(modifier);
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
    ...specialSpeedFields(),
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
export const effectsField = (scope: RiderScope): FieldDef => ({
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
        opt("until-source-turn-end", "Until the end of your next turn"),
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
