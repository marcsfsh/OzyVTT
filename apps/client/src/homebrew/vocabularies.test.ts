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
import { CONDITION_IDS, DAMAGE_TYPE_IDS, MAGIC_SCHOOL_IDS, RARITY_IDS } from "@vtt/content-srd-5.2.1/schemas";
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

/**
 * Every field whose list IS the damage-type vocabulary, found by what it offers rather than by what
 * it is called.
 *
 * Matching on the key was the old way and it silently missed one: `damagePartsField`'s row is keyed
 * plainly `type` — it is already inside a container called `damage` — so `/damage.?type/i` never saw
 * the control every action's damage goes through. Identity against the canonical array cannot miss a
 * site and cannot pick up a look-alike, which is what a census is for.
 */
const damageTypeFields = () => everyField().filter(({ field }) => suggestionsOf(field) === DAMAGE_TYPE_IDS);

describe("enumerated fields offer the complete SRD list", () => {
  it("every damage-type field offers the canonical list, and there are ten of them", () => {
    const fields = damageTypeFields();
    /**
     * **TEN, exactly** — the client's `3d` counted nine at HEAD, so an eleventh input is covered on
     * the day it lands rather than on the day someone notices "fire" never triggered.
     *
     * The ten, and the two things worth knowing about the count:
     *
     *  1 spell `damage.types` · 2 equipment `weapon.damageType` · 3–5 monster
     *  `damageResistances`/`damageImmunities`/`damageVulnerabilities` · 6 the `damage-type-is` gate
     *  (`when > damageTypes`) · 7 the `extra-damage` rider's `damageType` · 8 `damagePartsField`'s
     *  `type`, mounted once per action · 9 **U6's `damage-resistance` effect modifier**
     *  (`effects > modifiers > damageTypes`), which is what Superior Defense authors.
     *
     *  - That is NINE rendered controls, and this census sees ten entries, because
     *    `RIDER_FIELDS_FOR_TEST` exports a bare top-level `whenField()` alongside the one nested in
     *    `modifiersField` — the same factory, counted twice. Only the nested one is ever mounted.
     *  - The TENTH rendered control is `GrantsEditor`'s "Which" box for the `damageResistances` and
     *    `damageImmunities` grant kinds. It has no `FieldDef` at all, so it is structurally invisible
     *    here — the same `RIDER_EXEMPT` gap `authoring-harness.ts` names, and the reason
     *    `pick-fields.test.tsx` drives that one through the rendered form instead.
     */
    expect(fields.map(({ type, field }) => `${type}.${field.key}`)).toEqual([
      "spell.damage.types",
      "equipment.weapon.damageType",
      "monster.damageResistances",
      "monster.damageImmunities",
      "monster.damageVulnerabilities",
      "equipment.damageTypes",
      "equipment.damageType",
      "equipment.damageTypes",
      "equipment.type",
      "equipment.damageTypes"
    ]);
    for (const { type, field } of fields) {
      expect(suggestionsOf(field), `${type}.${field.key}`).toEqual(DAMAGE_TYPE_IDS);
    }
  });

  it("every damage-type field is a VISIBLE chooser — the client's `3d`", () => {
    /**
     * The half no verdict in the parity audit measures. `parity` there means a control *exists*;
     * every one of these existed, offered the complete list, and rendered it into a `<datalist>` —
     * no arrow, no cue, and on iOS Safari no control at all. "Damage type is an unconstrained field"
     * was a report about the affordance, not about the schema.
     *
     * Asserted on the FIELD rather than on the rendered DOM on purpose: this is the census, and it
     * catches a tenth site that lands without the flag. What a GM actually sees, and that a custom
     * type still survives, is `pick-fields.test.tsx`.
     */
    for (const { type, field } of damageTypeFields()) {
      expect(field.pick, `${type}.${field.key} must be a visible chooser, not an <input list>`).toBe(true);
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
      // `pick` does NOT change this: it is a renderer flag on the same `text` kind, so the control
      // becomes a visible chooser (`Combobox allowFreeText`) and the column stays open. The day this
      // assertion has to be relaxed to accommodate a picker is the day an open slug was closed.
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

  it("every `pick` field declares a list — a chooser over nothing is worse than a text box", () => {
    // The census, in the shape the rest of this file uses: `pick` swaps the renderer to `Combobox`
    // ONLY when suggestions resolve non-empty, so a `pick` with no list silently falls back to the
    // bare `<input>` it was added to replace. That failure is invisible in the browser, which is
    // exactly the class of defect this file exists for. Counted, not just checked: the day a tenth
    // `pick` lands it is covered here rather than on the day a GM finds it.
    const picks = everyField().filter(({ field }) => field.pick === true);
    // Rarity (`3a`) plus the ten damage-type entries this file censuses above (`3d`) — nine
    // distinct controls, one of them counted twice because `whenField()` is exported both bare and
    // nested. An exact number, so a `pick` that lands without a unit behind it fails here on the way
    // in, which is the mirror-defect guard the phase is built on.
    expect(picks.length).toBe(11);
    for (const { type, field } of picks) {
      expect(field.suggestions, `${type}.${field.key} is pick with no suggestions`).toBeDefined();
      // A FLAG ON TWO KINDS, never a kind of its own. `text` renders `Combobox` directly; `tags`
      // renders `TagInput`, which wears the same `Combobox` as its entry box. Both keep the column
      // open — that is what makes `pick` legal over an open slug at all, and it is why this assertion
      // widened for `3d` rather than being relaxed away: the day it has to admit `select`, an open
      // slug was closed.
      expect(["text", "tags"], `${type}.${field.key} — pick is a flag on text or tags, not a kind`)
        .toContain(field.kind ?? "text");
    }
  });

  it("rarity offers the canonical ladder, from the package that owns the column", () => {
    // `RARITY_IDS` used to be a client-local literal beside the field. It is not a hand-typed
    // partial any more, and this asserts the direction that matters: the form reads the constant
    // that lives beside `EquipmentReferenceSchema.rarity`, so the two cannot drift apart.
    const rarity = everyField().find((entry) => entry.type === "equipment" && entry.field.key === "rarity");
    expect(suggestionsOf(rarity!.field)).toEqual(RARITY_IDS);
    expect(rarity!.field.pick, "rarity must be a visible chooser — the client's 3a").toBe(true);
  });
});
