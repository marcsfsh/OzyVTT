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

import {
  CONDITION_IDS, CREATURE_TYPE_IDS, DAMAGE_TYPE_IDS, MAGIC_SCHOOL_IDS, WEAPON_MASTERY_IDS, WEAPON_PROPERTY_IDS
} from "@vtt/content-srd-5.2.1/schemas";
import { setAt } from "./paths";
import type { HomebrewType } from "./types";

/** The authored record body. Deliberately open: the server owns the per-type schema,
    and a client-side mirror of it would be a second source of truth to keep in sync. */
export type Draft = Readonly<Record<string, unknown>>;

/**
 * `group` is the renderer flag that keeps a long `select` pickable — it renders an
 * `<optgroup>`, and nothing else changes. It is what lets the rider vocabulary offer
 * twenty-one modifiers and thirty gating conditions from ordinary selects instead of
 * from a twelfth `FieldKind` (see the standing rule above). The group LABEL is the
 * sentence the options finish, so the GM reads "Only while… Attuned" and never has to
 * learn the word the schema calls it.
 */
export type SelectOption = Readonly<{ value: string; label: string; disabled?: boolean; group?: string }>;

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
   * THE CANONICAL SRD VOCABULARIES — complete lists, never a hand-typed partial.
   *
   * Every one of these used to be a bare text box or a suggestion array somebody typed from memory:
   * ten of the thirteen damage types (missing exactly the three physical ones, so a homebrew weapon
   * could not be suggested "slashing"), seven of the fifteen conditions, five of the fourteen
   * creature types, no schools at all. A slug typed one character wrong is not an error — it is
   * silently inert at play time, which is the hardest homebrew failure there is to diagnose.
   *
   * They arrive from `@vtt/content-srd-5.2.1/schemas`, which derives them from the bundles under a
   * drift test, so the list a GM picks from is the list the engine matches on. Each stays a
   * SUGGESTION rather than a closed list wherever its schema is an open slug: complete dropdown,
   * plus "other".
   */
  damageTypes: readonly string[];
  conditions: readonly string[];
  schools: readonly string[];
  creatureTypes: readonly string[];
  /**
   * All 17 weapon properties AND masteries, as the bare slugs riders match on. The bundle suffixes
   * both families (`finesse-wp`, `cleave-mastery`) because they share one id space there; every
   * `weapon-property-is` trigger compares the bare word, so suggesting the bundle id would suggest
   * a value that matches nothing — the silent inertness these lists exist to prevent.
   */
  weaponProperties: readonly string[];

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

  /**
   * WHAT AN EMPTIED CONTROL WRITES — and the second half of the item-publish repair.
   *
   * A `select` returned to "Not set" used to write `null` at every field in the app
   * (`set(event.target.value || null)`), and a cleared `NumberField` still does. That is right for
   * `rangeFeet`, whose column is `.nullable()` and REQUIRED — the key must be there with no value —
   * and wrong for `slot`, `rarity`, `weapon.category` and a cast's `ability`, which are `.optional()`
   * and reject `null` outright. Four routine authoring gestures therefore produced a body the store
   * refused, with a 409 reading "Required" that named nothing.
   *
   * So the two meanings are now spelled per field, in the schema, next to the label:
   *
   *   - `"omit"` (the DEFAULT) — the key is optional; clearing the control removes it. This is
   *     `defaults.ts` rule 1, "omit, never null", applied to edits as well as to blank drafts.
   *   - `"null"` — the key is REQUIRED and nullable, so it must survive with a null value.
   *
   * There are exactly nine `"null"` fields in the whole editor and they are precisely the nine
   * required-but-nullable columns in the content schemas. That correspondence is the point: this
   * flag mirrors one schema fact and is checked by the publish checklist, which runs those very
   * schemas.
   */
  emptyValue?: "omit" | "null";

  options?: readonly SelectOption[] | ((ctx: SchemaContext, draft: Draft) => readonly SelectOption[]);
  /** `kind: "select"` over a catalog too big for a `<select>`. Renders the picker. */
  searchable?: boolean;
  /** `kind: "select"` + `searchable` — which catalog to pick from. */
  catalog?: "spells" | "equipment";
  suggestions?: readonly string[] | ((ctx: SchemaContext) => readonly string[]);
  /**
   * **`suggestions` — render the CHOOSER instead of a bare box with a `<datalist>`.**
   *
   * A renderer flag, not a twelfth `FieldKind`, per the standing rule at the top of this file: the
   * field is still `text` or still `tags`, still writes the same string or the same array of them,
   * and still takes a word the SRD has never heard of. What changes is that the list is visible.
   *
   * The bug it repairs is the one an `<input list>` cannot: a `<datalist>` has **no affordance at
   * all** — no arrow, no border cue, nothing that says a list exists — and iOS Safari renders it as
   * *nothing*, so on a phone the complete vocabulary this repo went to the trouble of shipping is
   * simply invisible. `Combobox` with `allowFreeText` is the same contract with the list on screen:
   * every value one tap away, `--tap-min` rows, and unmatched text still handed back as itself.
   *
   * **It reads on both control kinds, and it had to.** The client reported it twice — item rarity
   * (`3a`, one value) and damage types (`3d`, nine sites, six of which are lists — the monster's
   * three defence rows, a spell's damage types, the `damage-type-is` gate and the damage-type
   * grants). Had `pick` stayed a `text`-only flag, two thirds of `3d` would have needed a second
   * mechanism to say the same thing, and the two would have drifted. `kind: "tags"` renders
   * `TagInput`, which wears the same `Combobox` as its entry box under the same flag.
   *
   * Requires `suggestions`; a `pick` field with no list is a chooser over nothing, which is why
   * `vocabularies.test.ts` censuses it. It is deliberately NOT automatic-on-`suggestions`: see
   * `TagInputProps.pick` for the two different things a suggestion list means at two kinds of call
   * site (a canonical vocabulary versus a corpus of what already exists).
   */
  pick?: boolean;

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
 *
 * ONE call site as of this writing — `actionsField()` in `RiderEditor.tsx`, which every carrier that
 * mounts riders shows once per action, so a monster's Bite and a magic sword's granted action are the
 * same four controls. *(The docblock used to claim four; measured at HEAD, `grep -c damagePartsField`
 * finds one mount. A spell's damage is `damage.roll` + `damage.types` in `schemas.ts`, a different
 * shape, and there is no separate weapon or item-cast mount. Corrected rather than softened.)*
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
      // `3d`, site 8 of 9. The column is an open slug and stays one — a homebrew "void" damage type
      // must remain authorable — so this is `pick` on `text`, never a closed select.
      { key: "type", label: "Damage type", pick: true, placeholder: "fire", suggestions: (ctx) => ctx.damageTypes }
    ]
  };
}

/**
 * **Fields inside a sub-object that must arrive WHOLE — the item-publish fix, as a factory.**
 *
 * `EquipmentReferenceSchema.weapon` has five keys and all five are REQUIRED (two of them nullable,
 * which is not the same as optional). The editor rendered them as five independent fields over
 * `setAt`, which creates the container on the first touched field and never fills its siblings — so
 * a GM who typed "1d8" into Damage produced `weapon: { damageDice: "1d8" }`, and the store answered
 * with three separate `Required` issues, one at a time, the first of which said "Fill in range" on a
 * melee weapon. That is the whole of "homebrew items cannot be published": seven of eleven realistic
 * authoring paths died on it.
 *
 * The fix is here rather than in the schema. `EquipmentReferenceSchema` is the SAME schema the SRD
 * bundle loads through (ADR-0016, "one shape, never a fork"), so relaxing those keys to `.optional()`
 * would weaken the bundle's own load validation to accommodate a half-written form. Instead the FIRST
 * touch of ANY field in the section seeds the complete container from `defaults`, and the sibling
 * keys land at exactly the values a duplicated SRD weapon already carries (`rangeFeet: null`).
 *
 * `defaults` must therefore contain only values that are honest to invent: nulls, `false`, and — for
 * a closed enum with no null — the option the control is already showing. Never a made-up number.
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
      const held = current !== null && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
      const leaf = field.key.startsWith(`${container}.`) ? field.key.slice(container.length + 1) : field.key;
      return { ...scope, [container]: setAt({ ...defaults, ...held }, leaf, next) };
    }
  }));
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

export const opt = (value: string, label?: string, group?: string): SelectOption => ({
  value,
  label: label ?? value,
  ...(group ? { group } : {})
});

/** `opt` bound to one `<optgroup>`, so a long grouped list reads as its groups rather
    than as the same third argument repeated forty times. */
export const grouped = (group: string) => (value: string, label?: string): SelectOption => opt(value, label, group);

/** Preserves declaration order of the groups themselves, so the renderer never has to
    sort and the schema's order IS the order the GM sees. Ungrouped options come first. */
export function groupOptions(options: readonly SelectOption[]): ReadonlyArray<Readonly<{ group: string | null; options: readonly SelectOption[] }>> {
  const out: Array<{ group: string | null; options: SelectOption[] }> = [];
  for (const option of options) {
    const group = option.group ?? null;
    const last = out[out.length - 1];
    if (last && last.group === group) last.options.push(option);
    else out.push({ group, options: [option] });
  }
  return out;
}

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

/**
 * What a `pick` row READS as: `"very-rare"` → "Very Rare", `"fire"` → "Fire".
 *
 * A derived label rather than a hand-written map, because a map is a second list to keep in step
 * with the first — the exact drift `RARITY_IDS`/`DAMAGE_TYPE_IDS` were centralised to end. Every
 * vocabulary these controls offer is a lowercase-hyphen slug of ordinary English words, so one rule
 * covers all of them and a new list is readable the day it lands with nothing to remember.
 *
 * The VALUE is untouched: the slug is what is picked, stored and matched on. This is display only.
 * A field that needs a label the slug cannot produce is a `kind: "select"` with `options`, which is
 * what that member is for.
 */
export function suggestionLabel(slug: string): string {
  return slug.split("-").map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word)).join(" ");
}

/**
 * Free text typed into a `pick` control, as the SLUG its column takes.
 *
 * Every field that carries `pick` writes an open slug — `ContentIdSchema` is `/^[a-z0-9-]+$/`, and
 * `rarity`, `category` and the damage types are all that shape. A GM who types "Very Rare" rather
 * than picking it means the rung, not a new one, and without this the record is silently
 * unpublishable at a gate that names a regex. Whitespace collapses to the hyphen the slug uses and
 * case is dropped; nothing else is removed, because deleting characters a GM typed is how a value
 * becomes something they never wrote.
 */
export function pickValue(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "-");
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
