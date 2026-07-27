/**
 * One field. **The only place in the app a `FieldKind` is interpreted.**
 *
 * Everything a schema can express is decided here once: which control, which
 * accessible name, where `help` goes, when `note` is shown, and — the load-bearing
 * one — that `required` renders *nothing at all*. A draft is allowed to be invalid,
 * so "you haven't filled this in yet" is not an error and must not look like one. It
 * surfaces once, as a sentence, at the Publish button (`validate.ts`).
 *
 * `validate` is the other half of that distinction and it DOES render inline, because
 * a malformed dice formula is the field being wrong *now* rather than a requirement
 * not yet met.
 */

import { useId } from "react";
import {
  Chip,
  Field,
  FieldGrid,
  Input,
  NumberField,
  RowEditor,
  Select,
  Stepper,
  Switch,
  TagInput,
  Textarea
} from "@vtt/ui";
import { CatalogPicker } from "./CatalogPicker";
import { getAt, setAt } from "./paths";
import { resolveOptions, resolveSuggestions, type Draft, type FieldDef, type SchemaContext } from "./schema";

export type CustomRenderer = (args: {
  field: FieldDef;
  draft: Draft;
  ctx: SchemaContext;
  /** Whole-body replacement — a custom field may write several paths in ONE edit. */
  onDraft: (next: Draft) => void;
  fieldId: string;
}) => React.ReactNode;

export type FieldRendererProps = Readonly<{
  field: FieldDef;
  /** The object the field's `key` is relative to — the record body, or one row. */
  value: Draft;
  onValue: (next: Draft) => void;
  /** The whole record body. Customs and cross-field `validate` read it. */
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  /** `hb-{type}` — ids are `hb-{type}-{key with dots as dashes}`. */
  idPrefix: string;
  custom?: Readonly<Record<string, CustomRenderer>>;
  disabled?: boolean;
}>;

const asString = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asBoolean = (value: unknown): boolean => value === true;
const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const asStrings = (value: unknown): readonly string[] => asArray(value).filter((entry): entry is string => typeof entry === "string");

export function FieldRenderer(props: FieldRendererProps) {
  const { field, value, onValue, draft, ctx, idPrefix, custom, disabled } = props;
  const autoId = useId();

  // `value` is the nearest container — the record body at the top level, one row inside
  // a `rows` field — so a row-scoped condition reads its own row rather than the record.
  if (field.visibleWhen && !field.visibleWhen(value, draft)) return null;

  const kind = field.kind ?? "text";
  const fieldId = `${idPrefix}-${field.key.replace(/\./g, "-")}${autoId}`;
  const raw = field.read ? field.read(value) : getAt(value, field.key);
  const set = (next: unknown) => onValue(field.write ? field.write(next, value) : setAt(value, field.key, next));
  const isDisabled = disabled || field.disabled;

  // A live field error — never a "you haven't filled this in" error. See the header.
  const error = field.validate ? field.validate(raw, value, ctx) : null;

  /* `note` is the honesty line for a field that is stored and not yet read by anything.
     It rides in `help` when there is no help, and is appended when there is, so a field
     never grows a second text slot below its control. */
  const help =
    field.note && field.help ? (
      <>
        {field.help} <em className="hb-note">{field.note}</em>
      </>
    ) : field.note ? (
      <em className="hb-note">{field.note}</em>
    ) : (
      field.help
    );

  const wrap = (control: React.ReactNode, forId?: string) => (
    <Field
      label={field.label}
      htmlFor={forId ?? fieldId}
      help={help}
      error={error ?? undefined}
      className={field.wide ? "nh-fieldgrid-wide" : undefined}
    >
      {control}
    </Field>
  );

  switch (kind) {
    case "textarea":
      return wrap(
        <Textarea
          id={fieldId}
          rows={4}
          value={asString(raw)}
          placeholder={field.placeholder}
          disabled={isDisabled}
          invalid={!!error}
          onChange={(event) => set(event.target.value)}
        />
      );

    case "number":
      return wrap(
        <NumberField
          id={fieldId}
          value={asNumber(raw)}
          min={field.min}
          max={field.max}
          unit={field.unit}
          allowDecimal={field.allowDecimal}
          allowNegative={field.allowNegative}
          placeholder={field.placeholder}
          invalid={!!error}
          onChange={set}
        />
      );

    case "stepper":
      // The stepper's own label IS the field label, so `Field` renders no second one —
      // a label pointing at a group of two buttons and a readout has nothing to focus.
      return (
        <div className={field.wide ? "nh-fieldgrid-wide hb-field" : "hb-field"}>
          <Stepper
            value={asNumber(raw) ?? field.min ?? 0}
            onChange={set}
            min={field.min}
            max={field.max}
            step={field.step}
            label={field.label}
            disabled={isDisabled}
          />
          {help && <p className="nh-field-help">{help}</p>}
        </div>
      );

    case "select": {
      const options = resolveOptions(field, ctx, draft);
      if (field.searchable) {
        const entries = field.catalog === "equipment" ? ctx.equipment : field.catalog === "spells" ? ctx.spells : [];
        return wrap(
          <CatalogPicker
            id={fieldId}
            entries={entries}
            value={asString(raw) || null}
            onChange={(next) => set(next)}
            emptyLabel={field.placeholder ?? `Choose a ${field.label.toLowerCase()}`}
            title={field.label}
            searchPlaceholder="Search…"
            ariaLabel={field.label}
            disabled={isDisabled}
          />
        );
      }
      return wrap(
        <Select
          id={fieldId}
          value={asString(raw)}
          disabled={isDisabled}
          invalid={!!error}
          onChange={(event) => set(event.target.value || null)}
        >
          <option value="">{field.placeholder ?? "Not set"}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }

    case "multiselect": {
      const options = resolveOptions(field, ctx, draft);
      const chosen = asStrings(raw);
      const full = field.max != null && chosen.length >= field.max;
      return (
        <div className={field.wide ? "nh-fieldgrid-wide hb-field" : "hb-field"}>
          <span className="nh-field-label" id={`${fieldId}-label`}>
            {field.label}
          </span>
          {/* One `role="group"` labelled by the field, holding real `aria-pressed`
              buttons — the constraint is stated ONCE for the group, never per chip. */}
          <div className="hb-chips" role="group" aria-labelledby={`${fieldId}-label`} aria-describedby={help ? `${fieldId}-help` : undefined}>
            {options.map((option) => {
              const on = chosen.includes(option.value);
              return (
                <Chip
                  key={option.value}
                  pressed={on}
                  disabled={isDisabled || option.disabled || (!on && full)}
                  onClick={() => set(on ? chosen.filter((entry) => entry !== option.value) : [...chosen, option.value])}
                >
                  {option.label}
                </Chip>
              );
            })}
          </div>
          {help && (
            <p className="nh-field-help" id={`${fieldId}-help`}>
              {help}
            </p>
          )}
          {full && field.maxRowsReason && <p className="nh-field-help">{field.maxRowsReason}</p>}
        </div>
      );
    }

    case "tags":
      return wrap(
        <TagInput
          id={fieldId}
          ariaLabel={field.label}
          values={asStrings(raw)}
          onChange={(next) => set(next)}
          suggestions={resolveSuggestions(field, ctx)}
          placeholder={field.placeholder}
          max={field.max}
          maxReachedReason={field.maxRowsReason}
        />
      );

    case "switch":
      return (
        <div className={field.wide ? "nh-fieldgrid-wide hb-field" : "hb-field"}>
          <Switch checked={asBoolean(raw)} onChange={(next) => set(next)} label={field.label} disabled={isDisabled} />
          {help && <p className="nh-field-help">{help}</p>}
        </div>
      );

    case "rows": {
      const rows = asArray(raw);
      const rowFields = field.rows ?? [];
      return (
        <div className={field.wide === false ? "hb-field" : "nh-fieldgrid-wide hb-field"}>
          <span className="nh-field-label">{field.label}</span>
          {help && <p className="nh-field-help">{help}</p>}
          <RowEditor
            rows={rows}
            onChange={(next) => set(next)}
            // `RowEditor` keys by the ROW, so the index comes from the list it is in —
            // and it is only ever a fallback: a stable id is what the primitive wants.
            rowKey={(row) => field.rowKey?.(row, rows.indexOf(row)) ?? String(rows.indexOf(row))}
            onAdd={() => field.newRow?.() ?? {}}
            addLabel={field.addLabel ?? `Add to ${field.label.toLowerCase()}`}
            rowLabel={field.rowLabel ? (row, index) => field.rowLabel!(row, index) : undefined}
            collapsible={rowFields.length > 2}
            emptyText={field.emptyText}
            max={field.maxRows}
            maxReachedReason={field.maxRowsReason}
            ariaLabel={field.label}
            renderRow={(row, index) => (
              <FieldGrid>
                {rowFields.map((rowField) => (
                  <FieldRenderer
                    {...props}
                    key={rowField.key}
                    field={rowField}
                    value={(row ?? {}) as Draft}
                    onValue={(nextRow) => {
                      const copy = rows.slice();
                      copy[index] = nextRow;
                      set(copy);
                    }}
                    idPrefix={`${idPrefix}-${field.key}-${index}`}
                  />
                ))}
              </FieldGrid>
            )}
          />
        </div>
      );
    }

    case "group":
      return (
        <fieldset className="hb-fieldset nh-fieldgrid-wide">
          <legend className="hb-fieldset-legend">{field.label}</legend>
          {/* Stated ONCE for the group, never once per member field — and ABOVE it, not
              below. Under the grid, a group's help landed after every member's own help,
              so "How many times this can be used before a rest gives it back" rendered
              three controls away from the field it explains and beneath a different
              field's note. A group blurb introduces its group; it does not follow it. */}
          {help && <p className="nh-field-help">{help}</p>}
          <FieldGrid>
            {(field.rows ?? []).map((child) => (
              <FieldRenderer {...props} key={child.key} field={child} idPrefix={`${idPrefix}-${field.key}`} />
            ))}
          </FieldGrid>
        </fieldset>
      );

    case "custom": {
      const render = field.custom ? custom?.[field.custom] : undefined;
      if (!render) return null;
      return (
        <div className="nh-fieldgrid-wide hb-field">
          {render({ field, draft, ctx, onDraft: props.onDraft, fieldId })}
        </div>
      );
    }

    case "text":
    default:
      return wrap(
        <Input
          id={fieldId}
          value={asString(raw)}
          placeholder={field.placeholder}
          disabled={isDisabled}
          invalid={!!error}
          maxLength={field.max}
          onChange={(event) => set(event.target.value)}
        />
      );
  }
}
