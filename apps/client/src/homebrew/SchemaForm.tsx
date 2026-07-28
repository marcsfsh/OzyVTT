/**
 * Sections → a `FieldGrid` of fields. The whole editor body for all nine types.
 *
 * `advanced` sections are native `<details>`, so the disclosure's keyboard and
 * screen-reader behaviour comes from the platform rather than a hand-rolled
 * `aria-expanded` dance — the same call `FeatureList` made.
 *
 * Section headings are never a bare `<h3>`: the app global sets
 * `h1,h2,h3 { font-weight: 400 }`, which synthesises faux-bold on the single-weight
 * display face. `.hb-section-title` carries the full `font:` shorthand, weight included,
 * so nothing is synthesised.
 */

import { FieldGrid } from "@vtt/ui";
import { FieldRenderer, type CustomRenderer } from "./FieldRenderer";
import type { Draft, HomebrewSchema, SchemaContext, SectionDef } from "./schema";

export type SchemaFormProps = Readonly<{
  schema: HomebrewSchema;
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  custom?: Readonly<Record<string, CustomRenderer>>;
  disabled?: boolean;
}>;

export const sectionDomId = (type: string, sectionId: string) => `hb-section-${type}-${sectionId}`;

export function SchemaForm({ schema, draft, onDraft, ctx, custom, disabled }: SchemaFormProps) {
  const body = (section: SectionDef) => (
    <>
      {section.blurb && <p className="hb-section-blurb">{section.blurb}</p>}
      <FieldGrid>
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
            disabled={disabled}
          />
        ))}
      </FieldGrid>
    </>
  );

  return (
    <div className="hb-form">
      {schema.sections
        .filter((section) => !section.visibleWhen || section.visibleWhen(draft))
        .map((section) =>
          section.advanced ? (
            <details key={section.id} className="hb-section hb-section--advanced" id={sectionDomId(schema.type, section.id)}>
              <summary className="hb-section-summary">{section.title}</summary>
              {body(section)}
            </details>
          ) : (
            <section key={section.id} className="hb-section" id={sectionDomId(schema.type, section.id)} tabIndex={-1} aria-labelledby={`${sectionDomId(schema.type, section.id)}-title`}>
              <h3 className="hb-section-title" id={`${sectionDomId(schema.type, section.id)}-title`}>
                {section.title}
              </h3>
              {body(section)}
            </section>
          )
        )}
    </div>
  );
}
