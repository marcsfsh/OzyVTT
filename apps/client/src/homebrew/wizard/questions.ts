/** A wizard question is the editor's field asked in plain words: the control, its write and its checks come from
    the form (`schemas.ts`), and only the words change. That is what keeps a wizard's record the editor's record. */

import type { FieldDef } from "../schema";
import { SCHEMAS } from "../schemas";
import type { HomebrewType } from "../types";

/** The editor's field for `key`, looked up through sections and groups (a row's fields belong to the row). */
export function editorField(type: HomebrewType, key: string): FieldDef {
  let found: FieldDef | undefined;
  const walk = (fields: readonly FieldDef[]) => {
    for (const field of fields) {
      if (found) return;
      if (field.key === key) found = field;
      else if (field.kind === "group" && field.rows) walk(field.rows);
    }
  };
  for (const section of SCHEMAS[type].sections) walk(section.fields);
  if (!found) throw new Error(`The ${type} editor has no field "${key}" for the wizard to ask.`);
  return found;
}

/** The editor's field with the wizard's words. A `visibleWhen` or `write` given here replaces the editor's. */
export const ask = (type: HomebrewType, key: string, words: Partial<FieldDef> = {}): FieldDef => ({
  ...editorField(type, key),
  ...words
});
