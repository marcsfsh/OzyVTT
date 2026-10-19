import { RIDER_TRIGGER_KINDS, type RiderTrigger, type RiderTriggerKind } from "@vtt/content-srd-5.2.1/schemas";
import { newId } from "../../lib/ids";
import { type Draft, type FieldDef, type SelectOption, grouped, opt } from "../schema";
import { ABILITIES, CONDITIONS, DAMAGE_TYPES, SIZES } from "../vocabulary";

/** The gating conditions, grouped by the phrase each completes. The kind is the server's (`RIDER_TRIGGER_KINDS`):
    it backs the two structural rules (at most one moment; a filter needs a moment), which `publishBlockedReason`
    enforces, and decides whether a rider is a standing sheet number or a note at roll time. */
type TriggerKind = "gate" | "moment" | "filter";

const TRIGGER_GROUPS: Readonly<Record<RiderTriggerKind, string>> = {
  "static-gate": "Only while…",
  "dynamic-gate": "Only while…",
  moment: "Only when…",
  filter: "Only for…"
};
const GROUP_ORDER = ["Only while…", "Only when…", "Only for…"];

/** Every gating condition the server knows, keyed by its type, so a new one doesn't compile until it has a label. */
const TRIGGER_LABELS: Readonly<Record<RiderTrigger["type"], string>> = {
  attuned: "It's attuned",
  "while-armored": "Wearing armour",
  "while-unarmored": "Not wearing armour",
  "while-shield": "Holding a shield",
  "while-character-is": "A certain class or species",
  "while-proficient-with": "Proficient with something",
  "while-effect-tag": "Under an effect",
  "while-hp-at-or-below": "Low on hit points",
  "while-condition": "Under a condition",
  "on-attack-roll": "Making an attack roll",
  "on-hit": "An attack hits",
  "on-critical-hit": "Scoring a critical hit",
  "on-damage-roll": "Rolling damage",
  "on-saving-throw": "Making a saving throw",
  "on-ability-check": "Making an ability check",
  "on-initiative-roll": "Rolling initiative",
  "on-taking-damage": "Taking damage",
  "on-healing": "Healing a creature",
  "attack-kind-is": "A kind of attack",
  "weapon-property-is": "A weapon property",
  "damage-type-is": "A damage type",
  "ability-is": "One ability",
  "skill-is": "One skill",
  "spell-school-is": "A school of magic",
  "spell-level-is": "A spell level",
  "spell-id-is": "One specific spell",
  "versus-size": "A target's size",
  "versus-condition": "A target's condition",
  "versus-creature-type": "A target's kind",
  "by-effect-source": "The creature that put this effect on",
  "source-creature-type-is": "The other creature's kind",
  "versus-effect-source": "Against the creature that put this effect on",
  "versus-marked": "A target it marked",
  "versus-hurt": "A target missing Hit Points",
  "versus-within": "A target within a distance",
  "spell-class-is": "A spell of one class"
};

/** Read only on an effect the engine puts on another creature (Hunter's Mark), never on an item or a feature, so the
 *  editor doesn't offer it. */
const ENGINE_ONLY_TRIGGERS: ReadonlySet<string> = new Set(["by-effect-source", "versus-effect-source"]);

const TRIGGER_TYPES: readonly SelectOption[] = (Object.keys(TRIGGER_LABELS) as RiderTrigger["type"][])
  .filter((type) => !ENGINE_ONLY_TRIGGERS.has(type))
  .map((type) => grouped(TRIGGER_GROUPS[RIDER_TRIGGER_KINDS[type]])(type, TRIGGER_LABELS[type]))
  .sort((a, b) => GROUP_ORDER.indexOf(a.group ?? "") - GROUP_ORDER.indexOf(b.group ?? ""));

export const triggerKindOf = (type: unknown): TriggerKind | null => {
  const kind = RIDER_TRIGGER_KINDS[String(type ?? "") as RiderTrigger["type"]];
  return kind === undefined ? null : kind === "moment" || kind === "filter" ? kind : "gate";
};
export const triggerLabelOf = (type: unknown): string =>
  TRIGGER_LABELS[String(type ?? "") as RiderTrigger["type"]] ?? "A condition";

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
    case "source-creature-type-is":
      return { type, creatureTypes: [] };
    case "versus-marked":
      return { type, tags: [] };
    case "versus-within":
      return { type, feet: 5 };
    case "spell-class-is":
      return { type, classIds: [] };
    default:
      return { type };
  }
}

export const hasType =
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
  }, in lowercase with no spaces.`;
};

/** A collapsed row's label, e.g. "Only for: A damage type: fire, cold". */
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
  if (values.length > 0) return `${name} · ${values.slice(0, 3).join(", ")}${values.length > 3 ? "…" : ""}`;
  if (typeof row.percent === "number") return `${name} · ${row.percent}% or less`;
  if (typeof row.feet === "number") return `${name} · ${row.feet} ft`;
  if (row.type === "while-shield") return row.wielding === false ? "Not holding a shield" : name;
  return name;
}

/** The gating list as a nested `rows` field on one modifier. */
export const whenField = (): FieldDef => ({
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
      // `weights` is `.min(1)` when present, so "any armour" means the key is absent (`[]` is refused).
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
      visibleWhen: hasType("while-character-is", "spell-class-is")
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
      visibleWhen: hasType("while-effect-tag", "versus-marked"),
      suggestions: ["raging", "blessed", "concentrating", "inspired", "grapple", "hunters-mark"]
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
      help: `Turn off for "only while you don't have it".`
    },
    {
      key: "kinds",
      label: "Kinds of attack",
      kind: "multiselect",
      options: [
        opt("melee", "Melee"),
        opt("ranged", "Ranged"),
        opt("spell", "Spell"),
        opt("weapon", "Weapon"),
        opt("melee-weapon", "Melee weapon"),
        opt("ranged-weapon", "Ranged weapon"),
        opt("unarmed", "Unarmed"),
        opt("thrown", "Thrown"),
        opt("reaction", "Reaction"),
        opt("opportunity", "Opportunity"),
        opt("two-handed", "Held in two hands")
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
      help: 'Only when this exact spell is cast, as in "when you cast Eldritch Blast". A school or a level names a category; this names one.'
    },
    { key: "sizes", label: "Sizes", kind: "multiselect", options: SIZES, visibleWhen: hasType("versus-size") },
    {
      key: "creatureTypes",
      label: "Kinds of creature",
      kind: "tags",
      visibleWhen: hasType("versus-creature-type", "source-creature-type-is"),
      suggestions: (ctx) => ctx.creatureTypes,
      help: "Read from the other creature's stat block."
    },
    {
      key: "feet",
      label: "Within",
      kind: "number",
      min: 5,
      max: 300,
      unit: "ft",
      visibleWhen: hasType("versus-within"),
      help: "Measured on the map. Where the map can't measure, it doesn't apply."
    }
  ]
});
