/**
 * **The both-paths authoring harness — the guard the vocabulary phase rests on.**
 *
 * The rule every unit of that phase is held to is *engine reader + SRD content authoring it + a
 * homebrew editor control + a test through BOTH paths*. It exists because **built-but-unwired keeps
 * shipping**: a mechanism exercised through exactly one consumer is invisible to a green suite and a
 * clean typecheck. A rider the SRD authors and the editor cannot offer, or a control the editor
 * offers and no SRD record authors, both pass every test in this repo today.
 *
 * These helpers are the editor half of that guard, lifted out of `publish-paths.test.ts` (where they
 * were born, alongside the eleven-authoring-paths repro) so a `*.mirror.test.ts` in the node project
 * — the one that may import the SERVER's own modules — can drive the same authoring machinery the
 * jsdom tests do. No shared package and no cross-workspace helper: the extraction is
 * same-directory, and the server modules are imported by relative path exactly the way
 * `src/builder/server-offers.mirror.test.ts` already does.
 *
 * ## `applyField` throws, and that IS the mechanism
 *
 * Every write goes through the field's own `write` (container seeding, magic-half clearing, the
 * variant swap) or `setAt`, looked up in the REAL form schema. A test cannot hand-build a body shape
 * no GM could produce — addressing a key the form does not have is an error, not a pass. That is the
 * whole trick, and it is exactly how the original publish defect survived a green 123-test suite.
 *
 * ## The hole this module closes
 *
 * The throw used to be bypassed for six keys — `modifiers`, `grants`, `uses`, `actions`, `effects`,
 * `tags` — because `RiderEditor` is a custom component that writes whole-body and its controls are
 * built inside it. The escape hatch was reasonable and it was also fatal: effect `modifiers`,
 * `uses.scaling: class-resource`, `recharge` (inside `uses`), `attack.bonus` (inside `actions`) and
 * `grants.spells` ALL live inside those six keys, so the harness would have passed in silence on
 * precisely its own headline rows.
 *
 * `fieldsOf` now walks `riderFieldsForTest(scope)` as well, so five of the six are looked up like
 * any other field. **`grants` is the only survivor of the exemption list**, and it survives with its
 * reason attached rather than silently: `GrantsEditor` (`RiderEditor.tsx`) is a bespoke component
 * over eleven parallel arrays with no `FieldDef` anywhere. Wave 2's U9 is what retires it.
 */

import { HOMEBREW_BODY_SCHEMAS } from "@vtt/content-srd-5.2.1/schemas";
import { blankDraft, forStorage } from "./defaults";
import { setAt } from "./paths";
import { riderFieldsForTest, type RiderScope } from "./RiderEditor";
import { EMPTY_CONTEXT, type Draft, type FieldDef, type SchemaContext } from "./schema";
import { SCHEMAS } from "./schemas";
import type { HomebrewType } from "./types";
import { bodyForPublish, publishIssues } from "./validate";

/**
 * The ONE key `applyField` still waves through, and why.
 *
 * `grants` is written by `GrantsEditor`, a bespoke component that turns eleven parallel arrays into
 * one `[What ▾][Which…]` list and calls `onChange` with a whole body. There is no `FieldDef` to look
 * up because there is no field. Note what this exemption does NOT cover: it is the key `grants`
 * alone, not "anything rider-shaped", and this list must never grow to hide a gap.
 *
 * **U9 checked whether it could go, and it cannot yet — for a reason that is not the one the plan
 * assumed.** The plan's condition was "if `grants.spells` becoming a real control means `grants` no
 * longer needs to be waved through". It became one: all eleven kinds are now editable rather than
 * ten editable and one silently preserved. But the exemption is about the LOOKUP, not about
 * coverage — every one of the eleven is bespoke JSX with no `FieldDef`, so `fieldsOf` still has
 * nothing to find for any of them. Retiring it means converting `GrantsEditor` to the declarative
 * surface, which adds no vocabulary and is therefore a refactor rather than a unit.
 *
 * Until then a test drives the component's own boundary — `grantRowsOf` / `grantsFromRows` in
 * `RiderEditor.tsx`, which `GrantsEditor` itself calls — and the rendered affordance is driven in
 * `pick-fields.test.tsx`. Writing through this exemption proves nothing about a control and no test
 * should do it.
 */
export const RIDER_EXEMPT: readonly string[] = ["grants"];

/**
 * At which scope does this record type mount `RiderEditor`, if it mounts one at all?
 *
 * Mirrors `RecordDetail.tsx` — equipment is the only `item`, a monster is the only `statblock`,
 * everything else that mounts the component is a `feature` — and is derived from the form data
 * rather than from a second hand-kept list, so a tenth type that grows a rider surface is covered
 * the day it lands. `custom: "features"` counts too: `FeatureEditor` mounts the same `RiderEditor`
 * once per feature, which is why a class's `uses` block is authorable even though the class form
 * itself has no rider field.
 *
 * **The third value is what the harness was blind to.** While this returned `"feature"` for a
 * monster, `fieldsOf("monster")` walked the feature-scoped action controls, so `hasControl("monster",
 * "attack.bonus", ["actions"])` asked its question of the wrong form — and would have kept answering
 * for a shape no stat block can publish.
 */
export function riderScopeOf(type: HomebrewType): RiderScope | null {
  const customs = new Set<string>();
  const walk = (fields: readonly FieldDef[]) => {
    for (const field of fields) {
      if (field.custom) customs.add(field.custom);
      if (field.rows) walk(field.rows);
    }
  };
  for (const section of SCHEMAS[type].sections) walk(section.fields);
  if (!customs.has("riders") && !customs.has("features")) return null;
  return type === "equipment" ? "item" : type === "monster" ? "statblock" : "feature";
}

/**
 * Every field of a type's form, flattened through groups AND rows, so a row-scoped key like
 * `ability` (inside `casts`) is reachable by the same lookup as a top-level one — plus the rider
 * fields the type mounts, which are built inside `RiderEditor` and are otherwise invisible here.
 *
 * The form's own fields come FIRST: a lookup is `find`, so a schema key always wins over a
 * same-named rider key and adding the riders can never change how an existing write behaves.
 */
export function fieldsOf(type: HomebrewType): readonly FieldDef[] {
  const out: FieldDef[] = [];
  const walk = (fields: readonly FieldDef[]) => {
    for (const field of fields) {
      out.push(field);
      if (field.rows) walk(field.rows);
    }
  };
  for (const section of SCHEMAS[type].sections) walk(section.fields);
  const scope = riderScopeOf(type);
  if (scope) walk(riderFieldsForTest(scope));
  return out;
}

/**
 * The fields of ONE container — the record, or one row of a `rows` field named by the chain that
 * reaches it. `fieldsWithin("monster", ["actions"])` is the fields of one action row;
 * `["actions", "damage"]` is the fields of one damage part.
 *
 * **Why this exists beside the flat `fieldsOf`.** The flat list can only ever find MORE controls
 * than a scope really has, so it never produces a false THROW — but it does produce a false PASS on
 * a nested key, and that is the same class of hole as the six-key escape hatch. Effect `modifiers`
 * (U6) is the live example: an effect row has no `modifiers` control today, and a flat lookup would
 * happily resolve it against the top-level `modifiersField` and call the row authorable. Anything
 * addressing a row scope uses this; `applyField`'s `within` argument is how.
 *
 * Flattened through `group` and NOT through `rows`, the same split `visibleFields` makes in
 * `schema.ts`: a group's keys are written against its container (`uses.limit` is a record-scope
 * key), a row's are not.
 */
export function fieldsWithin(type: HomebrewType, within: readonly string[]): readonly FieldDef[] {
  const flattenGroups = (fields: readonly FieldDef[]): readonly FieldDef[] => {
    const out: FieldDef[] = [];
    const walk = (list: readonly FieldDef[]) => {
      for (const field of list) {
        out.push(field);
        if (field.kind === "group" && field.rows) walk(field.rows);
      }
    };
    walk(fields);
    return out;
  };

  const top: FieldDef[] = [];
  for (const section of SCHEMAS[type].sections) top.push(...section.fields);
  const scope = riderScopeOf(type);
  if (scope) top.push(...riderFieldsForTest(scope));

  let fields = flattenGroups(top);
  for (const key of within) {
    const container = fields.find((entry) => entry.key === key);
    if (!container) throw new Error(`No field "${key}" in the ${type} form — the test is addressing a container that does not exist.`);
    if (!container.rows) throw new Error(`Field "${key}" in the ${type} form has no rows to address.`);
    fields = flattenGroups(container.rows);
  }
  return fields;
}

/** Does a control exist for this key at this scope? The census question, asked directly —
    `applyField` is the same question asked while writing. */
export function hasControl(type: HomebrewType, key: string, within: readonly string[] = []): boolean {
  const fields = within.length === 0 ? fieldsOf(type) : fieldsWithin(type, within);
  return fields.some((field) => field.key === key);
}

/**
 * Set one field the way the form sets it: through the field's own `write` when it declares one
 * (container seeding, magic-half clearing, the extension bag), otherwise through `setAt`.
 * `scope` is the nearest container — the record, or one row. `within` names that container when it
 * is a row, so the lookup is the row's own fields rather than the whole form's.
 *
 * Throws when no control exists. See the header: that is the mechanism, not a convenience.
 */
export function applyField(type: HomebrewType, scope: Draft, key: string, value: unknown, within: readonly string[] = []): Draft {
  const fields = within.length === 0 ? fieldsOf(type) : fieldsWithin(type, within);
  const field = fields.find((entry) => entry.key === key);
  if (!field) {
    if (!RIDER_EXEMPT.includes(key)) {
      const where = within.length === 0 ? `the ${type} form` : `the ${type} form (${within.join(" > ")} row)`;
      throw new Error(`No field "${key}" in ${where} — the test is addressing a field that does not exist.`);
    }
    return setAt(scope, key, value);
  }
  return field.write ? field.write(value, scope) : setAt(scope, key, value);
}

/** Author one row of a `rows` field the way the editor does: mint it with the field's own `newRow`,
    then replay edits through the row's own controls. A row a GM cannot build this way is a row the
    GM cannot build. */
export function authoredRow(
  type: HomebrewType,
  within: readonly string[],
  edits: ReadonlyArray<readonly [string, unknown]>
): Draft {
  const parent = within.length === 1
    ? fieldsOf(type).find((entry) => entry.key === within[0])
    : fieldsWithin(type, within.slice(0, -1)).find((entry) => entry.key === within[within.length - 1]);
  if (!parent?.newRow) throw new Error(`Field "${within.join(" → ")}" in the ${type} form mints no rows.`);
  return edits.reduce<Draft>((row, [key, value]) => applyField(type, row, key, value, within), parent.newRow() as Draft);
}

/** What a control writes when it is emptied — the renderer's `setEmpty`, which reads
    `FieldDef.emptyValue`: the flag that decides between removing an optional key and nulling a
    required-but-nullable one. */
export function clearField(type: HomebrewType, scope: Draft, key: string): Draft {
  const field = fieldsOf(type).find((entry) => entry.key === key);
  if (!field) throw new Error(`No field "${key}" in the ${type} form.`);
  return applyField(type, scope, key, field.emptyValue === "null" ? null : undefined);
}

/** A `SchemaContext` that knows only the record's own id — the canonical vocabularies come with
    `EMPTY_CONTEXT`, and nothing here needs a live catalog. */
export const contextFor = (recordId: string): SchemaContext => ({ ...EMPTY_CONTEXT, recordId });

/** Author a record from a blank draft by replaying edits through the real form, in order. */
export function authored(
  type: HomebrewType,
  name: string,
  edits: ReadonlyArray<readonly [string, unknown]>
): Draft {
  return edits.reduce<Draft>((draft, [key, value]) => applyField(type, draft, key, value), { ...blankDraft(type), name });
}

/** The publish checklist's sentences, in the order the GM reads them under the button. */
export const issuesFor = (type: HomebrewType, draft: Draft, recordId: string): readonly string[] =>
  publishIssues(type, draft, contextFor(recordId), recordId).map((reason) => reason.text);

/** The body the save path would send: `forStorage` on the way out, then the publish shaping. */
export const storedBody = (type: HomebrewType, draft: Draft, recordId: string): Record<string, unknown> =>
  bodyForPublish(type, forStorage(draft), recordId);

/** The gate the server applies at tier 1, run over the body the save path would send. */
export const parsesAsStored = (type: HomebrewType, draft: Draft, recordId: string) =>
  HOMEBREW_BODY_SCHEMAS[type].safeParse(storedBody(type, draft, recordId));

/**
 * Publishable = the checklist is empty AND the shared schema accepts the stored body.
 *
 * Both, because they must never disagree: a disagreement is the "homebrew items cannot be
 * published" defect returning. Returned rather than asserted so the harness stays free of `vitest`
 * and can be imported from `src` without dragging a test runner in.
 */
export function publishVerdict(type: HomebrewType, draft: Draft, recordId: string) {
  const issues = issuesFor(type, draft, recordId);
  const parsed = parsesAsStored(type, draft, recordId);
  return {
    issues,
    parsed,
    publishable: issues.length === 0 && parsed.success,
    /** One line naming what refused, for a failing assertion that has to be readable. */
    why: issues.length > 0 ? issues.join(" / ") : parsed.success ? "" : JSON.stringify(parsed.error.issues)
  };
}
