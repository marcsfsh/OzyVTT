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
 * | `grants` | yes | **no.** Deliberately off. There is no model anywhere for an item conferring a skill/tool/language/save proficiency — the proficiency union is assembled at build time from class/species/background/feat, and an item is inventory, which changes *after* the build. Authoring it would produce records the server silently ignores, which is worse than no form because the GM has no way to find out. |
 * | `uses` | "Limited uses" | **"Charges"** — same control, same data, via `labels` |
 *
 * So the divergence is entirely `scope`, `enabled` and `labels`. No second component
 * exists, and none should: the moment one does, the two vocabularies start to drift.
 */

import { useMemo } from "react";
import { Chip, Field, FieldGrid, Input, RowEditor, Select } from "@vtt/ui";
import { newId } from "../lib/ids";
import { FieldRenderer } from "./FieldRenderer";
import { damagePartsField, opt, type Draft, type FieldDef, type SchemaContext } from "./schema";

export type RiderKind = "modifiers" | "grants" | "uses" | "tags" | "actions" | "effects";

const ABILITIES = [
  opt("str", "Strength"), opt("dex", "Dexterity"), opt("con", "Constitution"),
  opt("int", "Intelligence"), opt("wis", "Wisdom"), opt("cha", "Charisma")
];

/** The eight typed numeric riders. A bounded union, grown additively; anything not here
    stays prose. `note` marks the two that parse and then do nothing. */
const MODIFIER_TYPES = [
  opt("ability-score", "Ability score"),
  opt("hit-points-per-level", "Hit points per level"),
  opt("speed", "Speed"),
  opt("armor-class", "Armour class"),
  opt("initiative", "Initiative"),
  opt("extra-attack", "Extra attack"),
  opt("unarmored-defense", "Unarmoured defence"),
  opt("darkvision", "Darkvision")
];

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
    default: return { type };
  }
}

const hasType = (...types: readonly string[]) => (row: Draft) => types.includes(String(row.type ?? ""));

const modifiersField = (label: string): FieldDef => ({
  key: "modifiers",
  label,
  kind: "rows",
  addLabel: "Add a modifier",
  emptyText: "No modifiers yet.",
  maxRows: 8,
  maxRowsReason: "Eight modifiers is as many as one record carries.",
  rowKey: (row, index) => String((row as { rowId?: string }).rowId ?? index),
  newRow: () => ({ rowId: newId(), ...blankModifier("ability-score") }),
  rowLabel: (row) => {
    const modifier = row as Record<string, unknown>;
    const name = MODIFIER_TYPES.find((entry) => entry.value === modifier.type)?.label ?? "Modifier";
    const amount = modifier.amount ?? modifier.count ?? modifier.feet;
    return typeof amount === "number" ? `${name} ${amount >= 0 ? "+" : ""}${amount}` : name;
  },
  rows: [
    {
      key: "type",
      label: "What it changes",
      kind: "select",
      options: MODIFIER_TYPES,
      // The whole row is replaced, so no key from the previous variant survives.
      write: (next, row) => ({ rowId: (row as { rowId?: string }).rowId ?? newId(), ...blankModifier(String(next)) })
    },
    { key: "ability", label: "Ability", kind: "select", options: ABILITIES, visibleWhen: hasType("ability-score", "unarmored-defense") },
    { key: "amount", label: "Amount", kind: "number", allowNegative: true, min: -30, max: 60, visibleWhen: hasType("ability-score", "hit-points-per-level", "speed", "armor-class", "initiative") },
    { key: "maximum", label: "Raises the cap to", kind: "number", min: 1, max: 30, visibleWhen: hasType("ability-score"), help: "Leave empty to keep the usual 20." },
    { key: "count", label: "Extra attacks", kind: "number", min: 1, max: 3, visibleWhen: hasType("extra-attack") },
    { key: "feet", label: "Distance", kind: "number", min: 0, max: 240, unit: "ft", visibleWhen: hasType("darkvision"), note: "Display only." },
    { key: "whileArmored", label: "Only while wearing armour", kind: "switch", visibleWhen: hasType("armor-class") },
    { key: "allowShield", label: "A shield still counts", kind: "switch", visibleWhen: hasType("unarmored-defense"), note: "Not read yet." }
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
    { key: "uses.limit", label: "How many", kind: "number", min: 1, max: 20, visibleWhen: (scope_) => !(scope_.uses as { scaling?: unknown } | undefined)?.scaling },
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
    { key: "uses.per", label: "Comes back", kind: "select", options: [opt("turn", "Every turn"), opt("encounter", "Every encounter"), opt("short-rest", "On a short rest"), opt("long-rest", "On a long rest")] },
    { key: "uses.pool", label: "Shared pool", help: "Features sharing a pool share one counter.", placeholder: "channel-divinity" }
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

function GrantsEditor({
  value,
  onChange,
  ctx
}: Readonly<{ value: Draft; onChange: (next: Draft) => void; ctx: SchemaContext }>) {
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
      <p className="nh-field-help">Proficiencies and languages this hands out for free.</p>
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
                  <Input
                    value={row.values.join(", ")}
                    placeholder="light-armor, shields"
                    onChange={(event) =>
                      replace({ values: event.target.value.split(",").map((entry) => entry.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-")).filter(Boolean) })
                    }
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

/** Items get everything except `grants` — see the table at the top of this file. */
export const ITEM_RIDERS: readonly RiderKind[] = ["modifiers", "uses", "actions", "effects", "tags"];

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
    if (enabled.includes("modifiers")) list.push(modifiersField(label("modifiers", "Modifiers")));
    if (enabled.includes("uses")) list.push(usesField(label("uses", scope === "item" ? "Charges" : "Limited uses"), scope));
    if (enabled.includes("tags")) {
      list.push({ key: "tags", label: label("tags", "Tags"), kind: "tags", help: "Grouping only — no mechanical effect." });
    }
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
          ? value.requiresAttunement === true
            ? "These apply while the item is equipped and attuned."
            : "These apply while the item is equipped."
          : "These apply as soon as the feature is granted."}
      </p>

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
        {enabled.includes("grants") && <GrantsEditor value={value} onChange={onChange} ctx={ctx} />}
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
