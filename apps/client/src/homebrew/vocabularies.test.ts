/**
 * **Every enumerated field offers its whole vocabulary, and still accepts a word of the GM's own.**
 *
 * The audit that prompted this found the same defect in fourteen places: ten of the thirteen damage
 * types offered (missing exactly bludgeoning, piercing and slashing, so a homebrew weapon could not
 * be suggested its own damage), seven of the fifteen conditions, five of the fourteen creature
 * types, no schools at all, and — the quietest one — a `suggestions` array declared on the item
 * category field that the renderer never read, because only `kind: "tags"` looked at it.
 *
 * None of those is an error at authoring time. A slug typed one character wrong parses, stores,
 * publishes, and is then matched by nothing at play time. That is why these are pinned as tests
 * rather than left to review: the failure mode is silence.
 *
 * The lists themselves are re-derived from the SRD bundles in
 * `packages/content-srd-5.2.1/test/enums.test.ts`; what THIS file asserts is that the forms actually
 * consume them, and that no field re-introduces a hand-typed literal.
 */

import { describe, expect, it } from "vitest";
import { CONDITION_IDS, DAMAGE_TYPE_IDS, MAGIC_SCHOOL_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { RIDER_FIELDS_FOR_TEST } from "./RiderEditor";
import { SCHEMAS } from "./schemas";
import { EMPTY_CONTEXT, resolveSuggestions, type FieldDef, type SchemaContext } from "./schema";
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
  for (const [type, schema] of Object.entries(SCHEMAS)) walk(type as HomebrewType, schema.sections.flatMap((section) => section.fields));
  // The rider vocabulary is one vocabulary authored from one component, mounted by items, features,
  // traits and feats alike — so a damage-type box that regressed there would regress on all four.
  walk("equipment", RIDER_FIELDS_FOR_TEST);
  return out;
}

const suggestionsOf = (field: FieldDef): readonly string[] => resolveSuggestions(field, ctx);

describe("enumerated fields offer the complete SRD list", () => {
  it("every damage-type field offers all thirteen", () => {
    const fields = everyField().filter(({ field }) =>
      /damage.?type/i.test(field.key) || /^damageResistances|damageImmunities|damageVulnerabilities$/.test(field.key) || field.key === "damageTypes"
    );
    // The census matters as much as the assertion: if a form grows a fifteenth damage input, it is
    // covered here the day it lands rather than the day someone notices "fire" never triggered.
    expect(fields.length).toBeGreaterThanOrEqual(6);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(DAMAGE_TYPE_IDS);
    }
  });

  it("every condition field offers all fifteen", () => {
    const fields = everyField().filter(({ field }) => field.key === "conditionImmunities" || field.key === "conditionIds");
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(CONDITION_IDS);
    }
  });

  it("every school field offers all eight", () => {
    // More than two: an effect carries modifiers, which carry their own gating list, so the
    // `spell-school-is` trigger legitimately appears at two depths of the rider tree.
    const fields = everyField().filter(({ field }) => field.key === "school" || field.key === "schools");
    expect(fields.length).toBeGreaterThanOrEqual(2);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(MAGIC_SCHOOL_IDS);
    }
  });

  it("every creature-type field offers all fourteen", () => {
    const fields = everyField().filter(({ field }) => field.key === "creatureType" || field.key === "creatureTypes" || (field.key === "type" && field.label === "Creature type"));
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(ctx.creatureTypes);
    }
  });
});

describe("an open slug always keeps its “other”", () => {
  it("the open-slug fields are text or tag inputs, never closed selects", () => {
    // `rarity` was the inverse of the usual bug: a CLOSED six-option select over a column that is an
    // open `ContentIdSchema`, so "unique" was unauthorable. `category` (item) and `category` (feat)
    // are the same shape. All three now offer their list AND take free text — which for a text field
    // means the renderer reads `suggestions` at all, the bug that made the item category's declared
    // suggestions render nowhere.
    const openSlugs: ReadonlyArray<readonly [HomebrewType, string]> = [
      ["equipment", "rarity"], ["equipment", "category"], ["feat", "category"], ["spell", "school"], ["species", "creatureType"]
    ];
    for (const [type, key] of openSlugs) {
      const found = everyField().find((entry) => entry.type === type && entry.field.key === key);
      expect(found, `${type}.${key}`).toBeDefined();
      const kind = found!.field.kind ?? "text";
      expect(kind, `${type}.${key} must stay free-entry`).toBe("text");
      // DECLARES a list, rather than resolves to a non-empty one: `equipment.category` draws its
      // suggestions from the live catalog, which is empty in a bare context — and drawing them from
      // data is the point, since a homebrew "relic" must appear there the moment it exists.
      expect(found!.field.suggestions, `${type}.${key} must still offer a list`).toBeDefined();
    }
  });

  it("a genuinely closed enum stays a select, and empties to an absent key", () => {
    // The other side of the same coin: `slot`, `weapon.category` and `hitDie` ARE closed in their
    // schemas, so free text would be the wrong fix. What they needed was `emptyValue`, because
    // "Not set" used to write `null` into an `.optional()` column and make the record unpublishable.
    const closed: ReadonlyArray<readonly [HomebrewType, string]> = [
      ["equipment", "slot"], ["equipment", "weapon.category"], ["class", "hitDie"]
    ];
    for (const [type, key] of closed) {
      const found = everyField().find((entry) => entry.type === type && entry.field.key === key);
      expect(found?.field.kind, `${type}.${key}`).toBe("select");
      expect(found?.field.emptyValue ?? "omit", `${type}.${key}`).toBe("omit");
    }
  });
});
