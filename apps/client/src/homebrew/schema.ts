/**
 * The field-schema vocabulary. Nine content types, ONE renderer.
 *
 * Nine hand-built forms is the failure mode this file exists to prevent: nine places
 * for a label to drift, nine places to forget `min-width: 0`, nine places a required
 * field can quietly stop being required. What ships instead is a `FieldDef` union the
 * renderer interprets in exactly one place (`FieldRenderer.tsx`) and nine data files
 * that describe records rather than draw them.
 *
 * ## The standing rule
 *
 * **A new authoring need is a field factory, a `validate`, a `visibleWhen`, or a
 * renderer flag — in that order — before it is ever a new `kind`.**
 *
 * The evidence that this holds rather than merely sounds good: two scope changes landed
 * after the union was fixed and neither needed a member.
 *
 *  - *Multi-term damage* (`1d8 slashing + 1d6 fire`) is `damagePartsField()` below — a
 *    factory returning a `kind: "rows"` field. One helper, four call sites.
 *  - *Picking one spell out of a 339-entry catalog* is `searchable: true` on
 *    `kind: "select"`, which swaps the renderer from `<select>` to a searchable picker.
 *    A `<select>` holding 339 options is unusable; a twelfth kind for it would have been
 *    the wrong fix.
 *
 * `rows` and `group` between them carry roughly two thirds of the field surface, which
 * is why the union stays at eleven members instead of thirty.
 */

import type { HomebrewType } from "./types";

/** The authored record body. Deliberately open: the server owns the per-type schema,
    and a client-side mirror of it would be a second source of truth to keep in sync. */
export type Draft = Readonly<Record<string, unknown>>;

export type SelectOption = Readonly<{ value: string; label: string; disabled?: boolean }>;

/** One entry in a big pickable catalog (spells, equipment). Carries its origin so a
    picker can badge the minority side and facet when both are present. */
export type CatalogEntry = Readonly<{
  id: string;
  name: string;
  origin: "srd" | "homebrew";
  meta?: string;
  keywords?: string;
}>;

/**
 * What a field needs from OUTSIDE the draft. Option lists are functions of this rather
 * than literals so they stay live: a spell list created two minutes ago has to appear
 * in the class editor's picker without a reload.
 */
export type SchemaContext = Readonly<{
  /** The record being edited, so a schema can ask "am I the thing I would reference?". */
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

  /**
   * Resolves a `fromCatalog` slug through **the same function the server validates
   * with** (`resolveCatalogChoice`), so the count a GM reads while authoring is the
   * count the game will offer — the client never becomes a second rules engine.
   */
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

/** The four places a bespoke component is genuinely the answer. Everything else is data.
    (`abilityOrder`, sketched as a fifth, turned out to be a `rows` field of six selects —
    `RowEditor` already gives Move up / Move down, so the custom component was one the
    standing rule says not to write.) */
export type CustomField = "levelTable" | "features" | "riders" | "spellListContents";

export type FieldDef = Readonly<{
  /** Dot path into the draft, e.g. `"range.distance"`. See `paths.ts`. */
  key: string;
  label: string;
  kind?: FieldKind;
  /** One sentence, sentence case. Stated ONCE per group — never once per option. */
  help?: string;
  /** The honesty line for a field that is authored, stored, and not yet read by
      anything. A rider form that produces records the server silently ignores is worse
      than no form, because the GM has no way to find out. */
  note?: string;
  placeholder?: string;
  /** Span the whole grid row. */
  wide?: boolean;
  /** Feeds `publishBlockedReason` ONLY. Never a red asterisk, never a red border,
      never a message while drafting — a draft is allowed to be invalid. */
  required?: boolean;
  disabled?: boolean;

  options?: readonly SelectOption[] | ((ctx: SchemaContext, draft: Draft) => readonly SelectOption[]);
  /** `kind: "select"` over a catalog too big for a `<select>`. Renders the picker. */
  searchable?: boolean;
  /** `kind: "select"` + `searchable` — which catalog to pick from. */
  catalog?: "spells" | "equipment";
  suggestions?: readonly string[] | ((ctx: SchemaContext) => readonly string[]);

  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  allowDecimal?: boolean;
  allowNegative?: boolean;

  /** `kind: "rows" | "group"` — the nested fields. For `rows`, keys are relative to the row. */
  rows?: readonly FieldDef[];
  /** `kind: "rows"` — a STABLE id, never the index. */
  rowKey?: (row: unknown, index: number) => string;
  /** `kind: "rows"` — mints a row (with `newId()`), so the renderer never invents data. */
  newRow?: () => unknown;
  rowLabel?: (row: unknown, index: number) => string;
  addLabel?: string;
  emptyText?: string;
  maxRows?: number;
  maxRowsReason?: string;

  custom?: CustomField;

  /**
   * Replaces the plain "set this one path" write when a change has to reshape its
   * container — picking a different modifier variant, say, where the old variant's keys
   * would otherwise survive into a `.strict()` discriminated union and fail to parse.
   * `scope` is the nearest container (the record, or one row); the return value
   * replaces it wholesale.
   */
  write?: (next: unknown, scope: Draft) => Draft;
  /** The symmetric read, for a control whose displayed value is DERIVED from the shape
      rather than stored at `key` — "None" spellcasting is the absence of the block, not
      a `"none"` value the schema has anywhere to put. Collapse derived, never store it. */
  read?: (scope: Draft) => unknown;

  /** Fires while typing: this field is wrong NOW (a malformed dice formula, a number
      out of range). Distinct from `required`, which is a requirement not yet met.
      `scope` is the nearest container — the record body, or the row this field is in. */
  validate?: (value: unknown, scope: Draft, ctx: SchemaContext) => string | null;
  /** DERIVED disclosure. Never stored — there is nothing to invalidate.
      `scope` is the nearest container; `draft` is always the whole record. */
  visibleWhen?: (scope: Draft, draft: Draft) => boolean;
}>;

export type SectionDef = Readonly<{
  id: string;
  title: string;
  blurb?: string;
  fields: readonly FieldDef[];
  /** Collapsed by default. The long tail lives here. */
  advanced?: boolean;
  visibleWhen?: (draft: Draft) => boolean;
}>;

export type HomebrewSchema = Readonly<{
  type: HomebrewType;
  sections: readonly SectionDef[];
}>;

/* ------------------------------------------------------------------ factories ---- */

/**
 * `1d8 + 1d6`-shaped dice, single or multi-term, with an optional flat modifier.
 * Deliberately permissive about whitespace and case; deliberately strict about shape,
 * because a formula the engine cannot parse is silently zero damage.
 */
const TERM = String.raw`(?:\d+d(?:4|6|8|10|12|20|100)|\d+)`;
const DICE = new RegExp(String.raw`^\s*${TERM}(?:\s*[+-]\s*${TERM})*\s*$`, "i");

export function isDiceFormula(text: string): boolean {
  return DICE.test(text);
}

/** A dice `validate` for any `kind: "text"` field holding a formula. Empty is allowed —
    "not filled in yet" is `required`'s business, not this one's. */
export const diceValidate = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  return isDiceFormula(text) ? null : `“${text}” isn't a dice formula. Try 1d8, 2d6 + 3, or 1d8 + 1d6.`;
};

/**
 * Multi-term damage as a FIELD FACTORY, not a kind (see the standing rule above).
 * Four call sites: a granted action's damage, a weapon's extra damage, a spell's
 * damage, and an item-cast's damage — one helper, one shape, one set of labels.
 */
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
      { key: "type", label: "Damage type", placeholder: "fire" }
    ]
  };
}

/**
 * The Basics section every type opens with. `id` and `source` are never shown —
 * auto-generated and forced, and an id the GM can see is an id the GM will try to fix.
 *
 * The three optional fields are per type rather than universal because several server
 * schemas are `.strict()`: `EquipmentReferenceSchema` has no `summary` and no
 * `attribution`, and an `ActorDefinition` has no `description`. Offering a field the
 * store rejects is worse than omitting it — the GM fills it in and the record stops
 * being publishable for a reason nothing on screen explains.
 */
export function basicsSection(
  typeWord: string,
  has: Readonly<{ summary?: boolean; description?: boolean; attribution?: boolean }> = { summary: true, description: true, attribution: true }
): SectionDef {
  const fields: FieldDef[] = [{ key: "name", label: "Name", required: true }];
  if (has.summary) fields.push({ key: "summary", label: "Summary", help: "One line for the pick list.", max: 280, wide: true });
  if (has.description) fields.push({ key: "description", label: "Description", kind: "textarea", wide: true });
  if (has.attribution) {
    fields.push({ key: "attribution", label: "Attribution", help: `Credit the original author, if this ${typeWord} came from somewhere.` });
  }
  return { id: "basics", title: "Basics", fields };
}

/* ------------------------------------------------------------------- helpers ----- */

export const opt = (value: string, label?: string): SelectOption => ({ value, label: label ?? value });

/**
 * Does this `fromCatalog` slug name **the record being edited**?
 *
 * Two families are derived by appending a suffix to a record's own id —
 * `<classId>-subclasses` and `<speciesId>-lineages` — and they are the two the merged
 * catalogs structurally cannot answer while authoring: they name a DRAFT, and no merged
 * catalog holds a draft. `resolveCatalogChoice` therefore throws for them, correctly and
 * unhelpfully.
 *
 * The server has a carve-out for exactly this pair and answers them from AUTHORSHIP
 * rather than publication (`homebrew-validate.ts`, `SelfCatalog`) — a subclass that
 * exists satisfies its class, draft or not, because publishing is not playing. This
 * predicate is how the client recognises the same pair so it neither blocks on them
 * (`validate.ts`) nor calls them broken (`FeatureEditor`). It is a predicate and not an
 * answer on purpose: the client has no way to count which drafts name this record, so it
 * says what it knows and leaves the count to the side that can.
 */
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

export function resolveSuggestions(field: FieldDef, ctx: SchemaContext): readonly string[] {
  const { suggestions } = field;
  if (!suggestions) return [];
  return typeof suggestions === "function" ? suggestions(ctx) : suggestions;
}

/** Every visible field of a section, flattened through `group` but NOT through `rows`
    (a row's fields belong to the row, not to the record). Used by `publishBlockedReason`
    and by the section-jump control. */
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
