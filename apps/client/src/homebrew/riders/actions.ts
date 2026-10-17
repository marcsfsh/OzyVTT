import { newId } from "../../lib/ids";
import { type Draft, type FieldDef, type SelectOption, damagePartsField, opt, saveOutcomeFields } from "../schema";
import { ABILITIES, type RiderScope } from "../vocabulary";
import { slugValidate } from "./triggers";

export const usesField = (label: string, scope: RiderScope): FieldDef => ({
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
            help: "The column's id on the class's level table. The count is read from it at the character's own level.",
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
        opt("own-turn", "At the start of its next turn"),
        opt("encounter", "Every encounter"),
        opt("short-rest", "On a Short Rest"),
        opt("long-rest", "On a Long Rest")
      ],
      // No "day" option: a long rest is this app's day.
      ...(scope === "item"
        ? { help: 'A Long Rest is the day at this table, so "once per day" means "on a Long Rest".' }
        : {})
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
 * flat `bonus` (`ActionSchema.attack`) and no `ability`. Offered in place of the ability and never beside it, since
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
          help: 'The flat bonus the stat block prints, such as the +9 in "+9 to hit".'
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

/* A stat block prints its DC, so it says whether that number is the creature's spell save DC; a feature
   or item names "spellcasting" through the empty DC above instead. */
const spellDcFields = (scope: RiderScope): readonly FieldDef[] =>
  scope === "statblock"
    ? [
        {
          key: "save.spellcasting",
          label: "It is the spell save DC",
          kind: "switch",
          help: "On for a spell: a spell save DC bonus it carries raises this. Off for a printed DC like a breath weapon's."
        }
      ]
    : [];

/**
 * An action's own limited uses (`ActionUsesSchema`), a different schema from the record-level
 * `FeatureUsesSchema` that `usesField` writes: `limit` is required, there is no `scaling`, and there
 * is a fifth `per` value, `"recharge"`, with a d6 threshold. All three carriers read it into
 * `ActorAction.uses`. `FeatureUsesSchema` is not widened to match because the builder does not
 * forward a threshold from record-level uses, which would make the character unbuildable.
 */
const ACTION_USES_PER: readonly SelectOption[] = [
  opt("turn", "Every turn"),
  opt("own-turn", "At the start of its next turn"),
  opt("encounter", "Every encounter"),
  opt("short-rest", "On a Short Rest"),
  opt("long-rest", "On a Long Rest"),
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
      help: 'A d6 at the start of its turn: 5 is a printed "Recharge 5-6". The table sees the die either way.',
      visibleWhen: (scope_) => (scope_.uses as { per?: string } | undefined)?.per === "recharge"
    },
    {
      key: "uses.pool",
      label: "Shared pool",
      placeholder: "breath-weapon",
      validate: slugValidate,
      help: "Actions sharing a pool share one counter and one recharge roll."
    }
  ]
});

export const actionsField = (scope: RiderScope): FieldDef => ({
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
        opt("bonus-action", "A Bonus Action"),
        opt("reaction", "A reaction"),
        opt("other", "No action")
      ]
    },
    {
      key: "replacesAttack",
      label: "Takes the place of one attack",
      kind: "switch",
      help: "Like a Breath Weapon: used as one of the attacks of the Attack action.",
      visibleWhen: (scope_) => scope_.activation === "action"
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
          help: 'The 80 in "range 80/320". Past it, up to the range, the attack rolls at Disadvantage.'
        },
        {
          key: "missDamage",
          label: "A miss deals half the damage",
          kind: "switch",
          help: "Like Acid Arrow: on a miss the target still takes half the damage, rounded down.",
          read: (scope) => scope.missDamage === "half",
          write: (next, scope) => ({ ...scope, missDamage: next === true ? "half" : undefined })
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
        },
        ...spellDcFields(scope),
        ...saveOutcomeFields("save")
      ]
    },
    actionUsesField()
  ]
});

/** Built here, outside the inline literal, so `riderFieldsForTest` can list the complete rider surface. */
export const tagsField = (label: string): FieldDef => ({
  key: "tags",
  label,
  kind: "tags",
  help: "Grouping only. It has no mechanical effect."
});
