/**
 * Every enumerated field offers its whole canonical vocabulary and still accepts a GM's own word. A
 * mistyped slug parses and publishes but matches nothing at play time, so this is pinned as tests.
 * The lists themselves are checked against the bundles in `packages/content-srd-5.2.1/test/enums.test.ts`;
 * this file checks the forms consume them.
 */

import { describe, expect, it } from "vitest";
import { CONDITION_IDS, DAMAGE_TYPE_IDS, MAGIC_SCHOOL_IDS, RARITY_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { RIDER_FIELDS_FOR_TEST } from "./RiderEditor";
import { SCHEMAS } from "./schemas";
import { EMPTY_CONTEXT, resolveOptions, resolveSuggestions, type FieldDef, type SchemaContext } from "./schema";
import type { HomebrewType } from "./types";

const ctx: SchemaContext = EMPTY_CONTEXT;

/** Every field of every form, flattened through groups and rows. */
function everyField(): ReadonlyArray<{ type: HomebrewType; field: FieldDef }> {
  const out: Array<{ type: HomebrewType; field: FieldDef }> = [];
  const walk = (type: HomebrewType, fields: readonly FieldDef[]) => {
    for (const field of fields) {
      out.push({ type, field });
      if (field.rows) walk(type, field.rows);
    }
  };
  for (const [type, schema] of Object.entries(SCHEMAS))
    walk(
      type as HomebrewType,
      schema.sections.flatMap((section) => section.fields)
    );
  // The shared rider fields, mounted by every rider carrier.
  walk("equipment", RIDER_FIELDS_FOR_TEST);
  return out;
}

const suggestionsOf = (field: FieldDef): readonly string[] => resolveSuggestions(field, ctx);
const optionsOf = (field: FieldDef): readonly string[] =>
  field.options ? resolveOptions(field, ctx, {}).map((option) => option.value) : [];

/** Every field whose suggestions are the damage-type vocabulary, found by identity with the canonical
    array, whatever the key name (`damagePartsField`'s row is keyed plainly `type`). */
const damageTypeFields = () => everyField().filter(({ field }) => suggestionsOf(field) === DAMAGE_TYPE_IDS);

describe("enumerated fields offer the complete SRD list", () => {
  it("every open damage-type field suggests the canonical list, and there are six of them", () => {
    const fields = damageTypeFields();
    /** `GrantsEditor`'s damage kinds have no `FieldDef` and are covered by `pick-fields.test.tsx`. */
    expect(fields.map(({ type, field }) => `${type}.${field.key}`)).toEqual([
      "spell.damage.types",
      "equipment.weapon.damageType",
      "monster.damageResistances",
      "monster.damageImmunities",
      "monster.damageVulnerabilities",
      "equipment.type"
    ]);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(DAMAGE_TYPE_IDS);
    }
  });

  it("every rider damage-type field is a closed choice over the canonical list", () => {
    // A rider names `DamageTypeSchema`, so a homebrew word could never publish there. `whenField()` is walked
    // three times: bare, inside `modifiersField` and inside an effect's modifiers. The second is the damage types a
    // hit ignores Resistance to.
    const fields = everyField().filter(({ field }) => field.key === "damageType" || field.key === "damageTypes");
    const closed = fields.filter(({ field }) => field.options !== undefined);
    expect(closed.map(({ field }) => `${field.kind}.${field.key}`)).toEqual([
      "multiselect.damageTypes",
      "multiselect.damageTypes",
      "select.damageType",
      "multiselect.damageTypes",
      "multiselect.damageTypes",
      "multiselect.damageTypes"
    ]);
    for (const { type, field } of closed) expect(optionsOf(field), `${type}.${field.key}`).toEqual(DAMAGE_TYPE_IDS);
  });

  it("every damage-type field is a VISIBLE chooser: the client's `3d`", () => {
    /** A `<datalist>` has no visible cue (and no control on iOS Safari), so each must be a `pick`.
        Checked on the field; the rendered behaviour is in `pick-fields.test.tsx`. */
    for (const { type, field } of damageTypeFields()) {
      expect(field.pick, `${type}.${field.key} must be a visible chooser, not an <input list>`).toBe(true);
    }
  });

  it("every condition field offers all fifteen", () => {
    const fields = everyField().filter(
      ({ field }) => field.key === "conditionImmunities" || field.key === "conditionIds"
    );
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (const { type, field } of fields) {
      // A rider's condition is closed (`ConditionSchema`), so it is a choice; a stat block's stays open.
      const offered = field.options ? optionsOf(field) : suggestionsOf(field);
      expect(offered, `${type}.${field.key}`).toEqual(CONDITION_IDS);
    }
  });

  it("every school field offers all eight", () => {
    // An effect's modifiers carry their own gating list, so `spell-school-is` appears at two depths.
    const fields = everyField().filter(({ field }) => field.key === "school" || field.key === "schools");
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(MAGIC_SCHOOL_IDS);
    }
  });

  it("every creature-type field offers all fourteen", () => {
    const fields = everyField().filter(
      ({ field }) =>
        field.key === "creatureType" ||
        field.key === "creatureTypes" ||
        (field.key === "type" && field.label === "Creature type")
    );
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(ctx.creatureTypes);
    }
  });
});

describe('an open slug always keeps its "other"', () => {
  it("the open-slug fields are text or tag inputs, never closed selects", () => {
    // Open `ContentIdSchema` columns: a closed select would make values like "unique" unauthorable.
    const openSlugs: ReadonlyArray<readonly [HomebrewType, string]> = [
      ["equipment", "rarity"],
      ["equipment", "category"],
      ["feat", "category"],
      ["spell", "school"],
      ["species", "creatureType"]
    ];
    for (const [type, key] of openSlugs) {
      const found = everyField().find((entry) => entry.type === type && entry.field.key === key);
      expect(found, `${type}.${key}`).toBeDefined();
      const kind = found!.field.kind ?? "text";
      // `pick` is a renderer flag on the same `text` kind; the column stays open.
      expect(kind, `${type}.${key} must stay free-entry`).toBe("text");
      // Declares a list and resolves none: `equipment.category` draws from the live catalog,
      // which is empty in a bare context.
      expect(found!.field.suggestions, `${type}.${key} must still offer a list`).toBeDefined();
    }
  });

  it("a genuinely closed enum stays a select, and empties to an absent key", () => {
    // Closed in their schemas, so they stay selects, and "Not set" omits the key (`.optional()`
    // rejects `null`).
    const closed: ReadonlyArray<readonly [HomebrewType, string]> = [
      ["equipment", "slot"],
      ["equipment", "weapon.category"],
      ["class", "hitDie"]
    ];
    for (const [type, key] of closed) {
      const found = everyField().find((entry) => entry.type === type && entry.field.key === key);
      expect(found?.field.kind, `${type}.${key}`).toBe("select");
      expect(found?.field.emptyValue ?? "omit", `${type}.${key}`).toBe("omit");
    }
  });

  it("every `pick` field declares a list: a chooser over nothing is worse than a text box", () => {
    // `pick` renders `Combobox` only when suggestions resolve non-empty, so a `pick` with no list
    // silently falls back to a bare input.
    const picks = everyField().filter(({ field }) => field.pick === true);
    // Exact count: 7 (rarity plus the six open damage-type entries) + 5 × 12 (the six feature-panel offer
    // boxes on five feature carriers, walked at feature scope, via the `choices` aliases, and on the
    // feature itself) + 1 (weapon `properties`) = 68.
    expect(picks.length).toBe(68);
    for (const { type, field } of picks) {
      expect(field.suggestions, `${type}.${field.key} is pick with no suggestions`).toBeDefined();
      // A flag on `text` or `tags`, never its own kind; both keep the column open.
      expect(["text", "tags"], `${type}.${field.key}: pick is a flag on text or tags, not a kind`).toContain(
        field.kind ?? "text"
      );
    }
  });

  it("rarity offers the canonical ladder, from the package that owns the column", () => {
    // The form reads the constant beside `EquipmentReferenceSchema.rarity`, so they can't drift.
    const rarity = everyField().find((entry) => entry.type === "equipment" && entry.field.key === "rarity");
    expect(suggestionsOf(rarity!.field)).toEqual(RARITY_IDS);
    expect(rarity!.field.pick, "rarity must be a visible chooser: the client's 3a").toBe(true);
  });
});
