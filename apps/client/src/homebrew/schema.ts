/**
 * The field-schema vocabulary: per-type data files describe records, and `FieldRenderer.tsx`
 * interprets them in one place.
 *
 * Rule: a new authoring need is a field factory, a `validate`, a `visibleWhen` or a renderer flag,
 * in that order, before it is ever a new `FieldKind`.
 */

import {
  CONDITION_IDS,
  CREATURE_TYPE_IDS,
  DAMAGE_TYPE_IDS,
  MAGIC_SCHOOL_IDS,
  WEAPON_MASTERY_IDS,
  WEAPON_PROPERTY_IDS
} from "@vtt/content-srd-5.2.1/schemas";
import { SaveConditionSchema } from "@vtt/schemas";
import { setAt } from "./paths";
import type { HomebrewType } from "./types";

/** The authored record body. Left open because the server owns the per-type schema. */
export type Draft = Readonly<Record<string, unknown>>;

/** `group` puts the option in an `<optgroup>` labelled with the phrase it completes ("Only while…"). */
export type SelectOption = Readonly<{ value: string; label: string; disabled?: boolean; group?: string }>;

/** One entry in a large pickable catalog; `origin` drives the picker's badges and facets. */
export type CatalogEntry = Readonly<{
  id: string;
  name: string;
  origin: "srd" | "homebrew";
  meta?: string;
  keywords?: string;
}>;

/** What a field needs from outside the draft; option lists derive from it so they stay live. */
export type SchemaContext = Readonly<{
  /** The record being edited, so a schema can recognise references to itself. */
  recordId: string;
  /** Every homebrew record of the same type, for the duplicate-name annotation. */
  siblings: ReadonlyArray<Readonly<{ id: string; name: string }>>;

  classes: readonly SelectOption[];
  species: readonly SelectOption[];
  backgrounds: readonly SelectOption[];
  feats: readonly SelectOption[];
  /** Feat categories actually in use, so the `feat` schema can seed its select from data. */
  featCategories: readonly SelectOption[];
  skills: readonly SelectOption[];
  /** The eight SRD spell lists plus every homebrew list. */
  spellLists: readonly SelectOption[];

  spells: readonly CatalogEntry[];
  equipment: readonly CatalogEntry[];
  /** Distinct equipment categories, derived from the catalog rather than hardcoded. */
  equipmentCategories: readonly SelectOption[];

  /** Canonical SRD vocabularies (drift-tested against the bundles), so the list a GM picks from is
      the list the engine matches on. They stay suggestions where the schema is an open slug. */
  damageTypes: readonly string[];
  conditions: readonly string[];
  schools: readonly string[];
  creatureTypes: readonly string[];
  /** Bare property and mastery slugs, as `weapon-property-is` compares them (the bundle suffixes ids). */
  weaponProperties: readonly string[];

  /** Resolves a `fromCatalog` slug with the server's own `resolveCatalogChoice`. */
  resolveCatalog: (slug: string) => Readonly<{ count: number }> | Readonly<{ error: string }>;
}>;

export const EMPTY_CONTEXT: SchemaContext = {
  recordId: "",
  siblings: [],
  classes: [],
  species: [],
  backgrounds: [],
  feats: [],
  featCategories: [],
  skills: [],
  spellLists: [],
  spells: [],
  equipment: [],
  equipmentCategories: [],
  damageTypes: DAMAGE_TYPE_IDS,
  conditions: CONDITION_IDS,
  schools: MAGIC_SCHOOL_IDS,
  creatureTypes: CREATURE_TYPE_IDS,
  weaponProperties: [...WEAPON_PROPERTY_IDS, ...WEAPON_MASTERY_IDS],
  resolveCatalog: () => ({ error: "Catalogs haven't loaded yet." })
};

export type FieldKind =
  | "text" //        Input
  | "textarea" //    Textarea, always full-row
  | "number" //      NumberField — "1250 gp", not a nudge
  | "stepper" //     Stepper — small bounded nudges only (1..20, choose N)
  | "select" //      Select, or a searchable picker with `searchable: true`
  | "multiselect" // a wrapped row of Chip(pressed) toggles in a role="group"
  | "tags" //        TagInput — open slugs, free entry always allowed
  | "switch" //      Switch
  | "rows" //        RowEditor over `rows: FieldDef[]`
  | "group" //       <fieldset><legend> of nested fields
  | "custom";

/** The places a bespoke component is the answer; everything else is data. */
export type CustomField = "levelTable" | "features" | "riders" | "spellListContents";

export type FieldDef = Readonly<{
  /** Dot path into the draft, e.g. `"range.distance"`. See `paths.ts`. */
  key: string;
  label: string;
  kind?: FieldKind;
  /** One sentence, sentence case, stated once per group rather than per option. */
  help?: string;
  /** Shown for a field that is stored but not yet read by anything, so the GM is not misled. */
  note?: string;
  placeholder?: string;
  /** Span the whole grid row. */
  wide?: boolean;
  /** Feeds the publish checklist only; never rendered as an error while drafting. */
  required?: boolean;
  disabled?: boolean;

  /** What an emptied control writes: `"omit"` (default) removes an optional key, since `.optional()`
      rejects `null`; `"null"` keeps a required-but-nullable key with a null value. */
  emptyValue?: "omit" | "null";

  options?: readonly SelectOption[] | ((ctx: SchemaContext, draft: Draft) => readonly SelectOption[]);
  /** `kind: "select"` over a catalog too big for a `<select>`; renders a searchable picker. */
  searchable?: boolean;
  /** `kind: "select"` over a handful of options: a row of chips, one pressed, so every answer is in view and one
      tap away (the wizards' short closed sets: a hit die, a size, a school). */
  chips?: boolean;
  /** `kind: "text"` with common answers: chips that write their value, above the input for anything else (a
      casting time of "Action", a duration of "1 minute"). The stored text is whatever was tapped or typed. */
  presets?: readonly SelectOption[];
  /** With `searchable`: which catalog to pick from. */
  catalog?: "spells" | "equipment";
  /** `draft` is the whole record, so suggestions can derive from what is already authored
      (e.g. `feature:<id>` over the record's own features). */
  suggestions?: readonly string[] | ((ctx: SchemaContext, draft: Draft) => readonly string[]);
  /** Render a visible chooser (`Combobox` with free text) instead of a `<datalist>`, which has no
      visible cue and nothing on iOS Safari. For `text` and `tags`; requires `suggestions`. Opt-in,
      because some suggestion lists are only a corpus of existing values (see `TagInputProps.pick`). */
  pick?: boolean;

  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  allowDecimal?: boolean;
  allowNegative?: boolean;

  /** Nested fields for `rows` (keys relative to the row) and `group`. A `custom` field may declare
      them so `fieldsOf`/`fieldsWithin` can see inside it; the renderer ignores them there. */
  rows?: readonly FieldDef[];
  /** `kind: "rows"`: a stable id, never the index. */
  rowKey?: (row: unknown, index: number) => string;
  /** `kind: "rows"`: mints a row (with `newId()`). */
  newRow?: () => unknown;
  rowLabel?: (row: unknown, index: number) => string;
  addLabel?: string;
  emptyText?: string;
  maxRows?: number;
  maxRowsReason?: string;

  custom?: CustomField;

  /** Replaces the plain path write when a change must reshape its container (e.g. a `.strict()`
      variant switch). `scope` is the nearest container; the return value replaces it. */
  write?: (next: unknown, scope: Draft) => Draft;
  /** The matching read, for a value derived from shape rather than stored at `key` (e.g. "None"
      spellcasting is the absence of the block). */
  read?: (scope: Draft) => unknown;

  /** Live error while typing (malformed dice, out of range), as opposed to `required`. `scope` is
      the nearest container: the record body or this field's row. */
  validate?: (value: unknown, scope: Draft, ctx: SchemaContext) => string | null;
  /** Derived disclosure, never stored. `scope` is the nearest container; `draft` is the whole record. */
  visibleWhen?: (scope: Draft, draft: Draft) => boolean;
}>;

export type SectionDef = Readonly<{
  id: string;
  title: string;
  blurb?: string;
  fields: readonly FieldDef[];
  /** Collapsed by default. */
  advanced?: boolean;
  visibleWhen?: (draft: Draft) => boolean;
}>;

export type HomebrewSchema = Readonly<{
  type: HomebrewType;
  sections: readonly SectionDef[];
}>;

/* ------------------------------------------------------------------ factories ---- */

/** Single or multi-term dice with an optional flat modifier; an unparseable formula deals no damage. */
const TERM = String.raw`(?:\d+d(?:4|6|8|10|12|20|100)|\d+)`;
const DICE = new RegExp(String.raw`^\s*${TERM}(?:\s*[+-]\s*${TERM})*\s*$`, "i");

export function isDiceFormula(text: string): boolean {
  return DICE.test(text);
}

/** Dice `validate` for a text field holding a formula. Empty is allowed; that is `required`'s job. */
export const diceValidate = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  return isDiceFormula(text) ? null : `"${text}" isn't a dice formula. Try 1d8, 2d6 + 3, or 1d8 + 1d6.`;
};

/** Multi-term damage as a field factory rather than a kind; used by `actionsField()` in `RiderEditor.tsx`. */
export function damagePartsField(
  key: string,
  options: Readonly<{ label: string; help?: string; max?: number; newId: () => string }>
): FieldDef {
  return {
    key,
    label: options.label,
    kind: "rows",
    wide: true,
    help: options.help,
    addLabel: "Add a damage part",
    emptyText: "No damage parts yet.",
    maxRows: options.max,
    maxRowsReason: options.max ? `${options.max} parts is as many as the sheet shows.` : undefined,
    rowKey: (row) => String((row as { id?: string })?.id ?? ""),
    newRow: () => ({ id: options.newId(), formula: "", type: "" }),
    rowLabel: (row) => {
      const part = row as { formula?: string; type?: string };
      const formula = part.formula?.trim() || "No formula";
      return part.type?.trim() ? `${formula} ${part.type.trim()}` : formula;
    },
    rows: [
      { key: "formula", label: "Formula", placeholder: "1d6", validate: diceValidate },
      // Open slug (homebrew damage types stay authorable), so `pick` on text, not a closed select.
      { key: "type", label: "Damage type", pick: true, placeholder: "fire", suggestions: (ctx) => ctx.damageTypes }
    ]
  };
}

/** What a save does (`SaveOutcomeFields`), for the save group keyed `prefix`. Both are data the save prompt
    applies; an unset success takes the schema's default, half damage. */
export function saveOutcomeFields(prefix: string): readonly FieldDef[] {
  return [
    {
      key: `${prefix}.successDamage`,
      label: "On a success",
      kind: "select",
      placeholder: "Half damage (default)",
      options: [opt("half", "Half damage"), opt("none", "No damage")]
    },
    {
      key: `${prefix}.failureConditions`,
      label: "On a failure, also",
      kind: "multiselect",
      wide: true,
      options: SaveConditionSchema.options.map((id) => opt(id, `${id[0].toUpperCase()}${id.slice(1)}`))
    },
    {
      key: `${prefix}.conditionChoices`,
      label: "Or the caster picks one of",
      kind: "multiselect",
      wide: true,
      help: "Pick two or more when the caster chooses the condition, as with Blindness/Deafness. Until the caster picks, a failure gives the conditions above.",
      options: SaveConditionSchema.options.map((id) => opt(id, `${id[0].toUpperCase()}${id.slice(1)}`)),
      // No choices is no key: the schema needs two or more when the key is there.
      write: (next, scope) =>
        setAt(scope, `${prefix}.conditionChoices`, Array.isArray(next) && next.length > 0 ? next : undefined)
    }
  ];
}

/**
 * Makes every field write into `container` as a whole, seeding it from `defaults` on first touch:
 * `EquipmentReferenceSchema.weapon` requires all five keys, and the schema is shared with the SRD
 * bundle (ADR-0016) so it is not relaxed. `defaults` may hold only nulls, `false`, or the option a
 * closed enum's control already shows.
 */
export function inContainer(
  container: string,
  defaults: Readonly<Record<string, unknown>>,
  fields: readonly FieldDef[]
): readonly FieldDef[] {
  return fields.map((field) => ({
    ...field,
    write: (next: unknown, scope: Draft): Draft => {
      const current = scope[container];
      const held =
        current !== null && typeof current === "object" && !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : {};
      const leaf = field.key.startsWith(`${container}.`) ? field.key.slice(container.length + 1) : field.key;
      return { ...scope, [container]: setAt({ ...defaults, ...held }, leaf, next) };
    }
  }));
}

/** The Basics section every type opens with. Optional fields vary per type because several server
    schemas are `.strict()`; `id` and `source` are auto-generated and never shown. */
export function basicsSection(
  typeWord: string,
  has: Readonly<{ summary?: boolean; description?: boolean; attribution?: boolean }> = {
    summary: true,
    description: true,
    attribution: true
  }
): SectionDef {
  const fields: FieldDef[] = [{ key: "name", label: "Name", required: true }];
  if (has.summary)
    fields.push({ key: "summary", label: "Summary", help: "One line for the pick list.", max: 280, wide: true });
  if (has.description) fields.push({ key: "description", label: "Description", kind: "textarea", wide: true });
  if (has.attribution) {
    fields.push({
      key: "attribution",
      label: "Attribution",
      help: `Credit the original author, if this ${typeWord} came from somewhere.`
    });
  }
  return { id: "basics", title: "Basics", fields };
}

/* ------------------------------------------------------------------- helpers ----- */

export const opt = (value: string, label?: string, group?: string): SelectOption => ({
  value,
  label: label ?? value,
  ...(group ? { group } : {})
});

/** `opt` bound to one `<optgroup>`. */
export const grouped =
  (group: string) =>
  (value: string, label?: string): SelectOption =>
    opt(value, label, group);

/** Groups consecutive options, preserving declaration order. Ungrouped options come first. */
export function groupOptions(
  options: readonly SelectOption[]
): ReadonlyArray<Readonly<{ group: string | null; options: readonly SelectOption[] }>> {
  const out: Array<{ group: string | null; options: SelectOption[] }> = [];
  for (const option of options) {
    const group = option.group ?? null;
    const last = out[out.length - 1];
    if (last && last.group === group) last.options.push(option);
    else out.push({ group, options: [option] });
  }
  return out;
}

/** Whether a `fromCatalog` slug names the record being edited (`<id>-subclasses`, `<id>-lineages`).
    The merged catalogs hold no drafts, so only the server (`homebrew-validate.ts`) can resolve these;
    the client neither blocks on them nor flags them as broken. */
export const namesOwnRecord = (slug: string, recordId: string): boolean =>
  recordId !== "" && (slug === `${recordId}-subclasses` || slug === `${recordId}-lineages`);

/** Sentence-case a slug or a camelCase key for a label the GM reads. */
export function humanise(key: string): string {
  const spaced = key.replace(/[-_]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function resolveOptions(field: FieldDef, ctx: SchemaContext, draft: Draft): readonly SelectOption[] {
  const { options } = field;
  if (!options) return [];
  return typeof options === "function" ? options(ctx, draft) : options;
}

export function resolveSuggestions(field: FieldDef, ctx: SchemaContext, draft: Draft = {}): readonly string[] {
  const { suggestions } = field;
  if (!suggestions) return [];
  return typeof suggestions === "function" ? suggestions(ctx, draft) : suggestions;
}

/** Display label for a `pick` slug (`"feature:divine-order"` → "Feature: Divine Order"), treating
    the colon as a separator. Display only; `pickValue` reverses it. */
export function suggestionLabel(slug: string): string {
  return slug
    .split(":")
    .map((part) =>
      part
        .split("-")
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(" ")
    )
    .join(": ");
}

/** Typed `pick` text as a slug: lowercased, whitespace to hyphens, padding around a colon removed
    ("Feature: Divine Order" → `feature:divine-order`). */
export function pickValue(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s*:\s*/g, ":")
    .replace(/\s+/g, "-");
}

/** Every visible field of a section, flattened through `group` but not `rows` (row fields belong
    to the row). Used by the publish checklist and the section-jump control. */
export function visibleFields(section: SectionDef, draft: Draft): readonly FieldDef[] {
  const out: FieldDef[] = [];
  const walk = (fields: readonly FieldDef[]) => {
    for (const field of fields) {
      if (field.visibleWhen && !field.visibleWhen(draft, draft)) continue;
      out.push(field);
      if (field.kind === "group" && field.rows) walk(field.rows);
    }
  };
  walk(section.fields);
  return out;
}
