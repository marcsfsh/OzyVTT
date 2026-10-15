/**
 * Test helpers that author records through the real form schema, so a test can only build bodies a
 * GM could build. `applyField` throws when no control exists for a key: that is the guard. Rider
 * fields are included via `riderFieldsForTest`, so only `grants` is exempt (see `RIDER_EXEMPT`).
 *
 * Kept free of `vitest` so `*.mirror.test.ts` files (which may import server modules) and jsdom
 * tests can share it.
 */

import { HOMEBREW_BODY_SCHEMAS } from "@vtt/content-srd-5.2.1/schemas";
import { blankDraft, forStorage } from "./defaults";
import { setAt } from "./paths";
import { riderFieldsForTest } from "./RiderEditor";
import { type RiderScope } from "./riders/vocabulary";
import { EMPTY_CONTEXT, type Draft, type FieldDef, type SchemaContext } from "./schema";
import { SCHEMAS } from "./schemas";
import type { HomebrewType } from "./types";
import { bodyForPublish, publishIssues } from "./validate";

/** The one key `applyField` writes without a control lookup: `grants` is authored by `GrantsEditor`,
    bespoke JSX with no `FieldDef`. Tests drive `grantRowsOf`/`grantsFromRows` instead. This list must
    never grow to hide a gap. */
export const RIDER_EXEMPT: readonly string[] = ["grants"];

/** The scope at which a record type mounts `RiderEditor` (directly or via `FeatureEditor`), derived
    from the form data and matching `RecordDetail.tsx`: equipment is `item`, monster is `statblock`,
    everything else is `feature`. */
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

/** Every field of a type's form, flattened through groups and rows, plus the rider fields the type
    mounts. Form fields come first, so a form key always wins a same-named rider key on `find`. */
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
 * The fields of one container: the record, or a row reached by a chain of `rows` keys
 * (`["actions", "damage"]` is one damage part). Use this for row-scoped keys, because the flat
 * `fieldsOf` can resolve a nested key against an unrelated top-level field. Flattened through
 * `group` but not `rows`, like `visibleFields`.
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
    if (!container)
      throw new Error(
        `No field "${key}" in the ${type} form — the test is addressing a container that does not exist.`
      );
    if (!container.rows) throw new Error(`Field "${key}" in the ${type} form has no rows to address.`);
    fields = flattenGroups(container.rows);
  }
  return fields;
}

/** Whether a control exists for this key at this scope. */
export function hasControl(type: HomebrewType, key: string, within: readonly string[] = []): boolean {
  const fields = within.length === 0 ? fieldsOf(type) : fieldsWithin(type, within);
  return fields.some((field) => field.key === key);
}

/** Sets one field the way the form does: through the field's own `write`, otherwise `setAt`. `scope`
    is the nearest container; `within` names it when it is a row. Throws when no control exists. */
export function applyField(
  type: HomebrewType,
  scope: Draft,
  key: string,
  value: unknown,
  within: readonly string[] = []
): Draft {
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

/** Authors one row the way the editor does: the field's own `newRow`, then edits through the row's controls. */
export function authoredRow(
  type: HomebrewType,
  within: readonly string[],
  edits: ReadonlyArray<readonly [string, unknown]>
): Draft {
  const parent =
    within.length === 1
      ? fieldsOf(type).find((entry) => entry.key === within[0])
      : fieldsWithin(type, within.slice(0, -1)).find((entry) => entry.key === within[within.length - 1]);
  if (!parent?.newRow) throw new Error(`Field "${within.join(" → ")}" in the ${type} form mints no rows.`);
  return edits.reduce<Draft>(
    (row, [key, value]) => applyField(type, row, key, value, within),
    parent.newRow() as Draft
  );
}

/** What a control writes when emptied, per `FieldDef.emptyValue` (omit vs. null). */
export function clearField(type: HomebrewType, scope: Draft, key: string): Draft {
  const field = fieldsOf(type).find((entry) => entry.key === key);
  if (!field) throw new Error(`No field "${key}" in the ${type} form.`);
  return applyField(type, scope, key, field.emptyValue === "null" ? null : undefined);
}

/** A `SchemaContext` with only the record id; the canonical vocabularies come from `EMPTY_CONTEXT`. */
export const contextFor = (recordId: string): SchemaContext => ({ ...EMPTY_CONTEXT, recordId });

/** Author a record from a blank draft by replaying edits through the real form, in order. */
export function authored(type: HomebrewType, name: string, edits: ReadonlyArray<readonly [string, unknown]>): Draft {
  return edits.reduce<Draft>((draft, [key, value]) => applyField(type, draft, key, value), {
    ...blankDraft(type),
    name
  });
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

/** Publishable means the checklist is empty and the shared schema accepts the stored body; the two
    must never disagree. Returned rather than asserted so this module stays free of `vitest`. */
export function publishVerdict(type: HomebrewType, draft: Draft, recordId: string) {
  const issues = issuesFor(type, draft, recordId);
  const parsed = parsesAsStored(type, draft, recordId);
  return {
    issues,
    parsed,
    publishable: issues.length === 0 && parsed.success,
    /** What refused, readable in a failing assertion. */
    why: issues.length > 0 ? issues.join(" / ") : parsed.success ? "" : JSON.stringify(parsed.error.issues)
  };
}
