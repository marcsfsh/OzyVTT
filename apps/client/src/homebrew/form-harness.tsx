/** Every field of a record's schema, section after section, through the editor's own `FieldRenderer`: the form a
    field test drives, so a field is tested as the studio draws it without walking the steps to reach it. */

import { FieldRenderer, type CustomRenderer } from "./FieldRenderer";
import type { Draft, HomebrewSchema, SchemaContext } from "./schema";

export function SchemaForm({
  schema,
  draft,
  onDraft,
  ctx,
  custom
}: Readonly<{
  schema: HomebrewSchema;
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  custom?: Readonly<Record<string, CustomRenderer>>;
}>) {
  return (
    <div>
      {schema.sections
        .filter((section) => !section.visibleWhen || section.visibleWhen(draft))
        .map((section) => (
          <section key={section.id} aria-label={section.title}>
            {section.fields.map((field) => (
              <FieldRenderer
                key={field.key}
                field={field}
                value={draft}
                onValue={onDraft}
                draft={draft}
                onDraft={onDraft}
                ctx={ctx}
                idPrefix={`hb-${schema.type}`}
                custom={custom}
              />
            ))}
          </section>
        ))}
    </div>
  );
}
