/** Renders one field; the only place a `FieldKind` is interpreted. `required` renders nothing:
    a draft may be incomplete, and missing requirements surface once at Publish (`validate.ts`).
    `validate` errors do render inline, because they mean the value is wrong now. */

import { useId } from "react";
import {
  Chip,
  Combobox,
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
import {
  groupOptions,
  pickValue,
  resolveOptions,
  resolveSuggestions,
  suggestionLabel,
  type Draft,
  type FieldDef,
  type SchemaContext
} from "./schema";
import { withArticle } from "@vtt/domain";

export type CustomRenderer = (args: {
  field: FieldDef;
  draft: Draft;
  ctx: SchemaContext;
  /** Whole-body replacement, so a custom field can write several paths in one edit. */
  onDraft: (next: Draft) => void;
  fieldId: string;
}) => React.ReactNode;

export type FieldRendererProps = Readonly<{
  field: FieldDef;
  /** The object `key` is relative to: the record body, or one row. */
  value: Draft;
  onValue: (next: Draft) => void;
  /** The whole record body. Customs and cross-field `validate` read it. */
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  /** `hb-{type}`: ids are `hb-{type}-{key with dots as dashes}`. */
  idPrefix: string;
  custom?: Readonly<Record<string, CustomRenderer>>;
  disabled?: boolean;
}>;

const asString = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const asBoolean = (value: unknown): boolean => value === true;
const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const asStrings = (value: unknown): readonly string[] =>
  asArray(value).filter((entry): entry is string => typeof entry === "string");

export function FieldRenderer(props: FieldRendererProps) {
  const { field, value, onValue, draft, ctx, idPrefix, custom, disabled } = props;
  const autoId = useId();

  // `value` is the nearest container (the body, or one row), so row-scoped conditions read their row.
  if (field.visibleWhen && !field.visibleWhen(value, draft)) return null;

  const kind = field.kind ?? "text";
  const fieldId = `${idPrefix}-${field.key.replace(/\./g, "-")}${autoId}`;
  const raw = field.read ? field.read(value) : getAt(value, field.key);
  const set = (next: unknown) => onValue(field.write ? field.write(next, value) : setAt(value, field.key, next));
  /* An emptied control writes `undefined` (omit) for an optional column or `null` for a
     required-but-nullable one; see `FieldDef.emptyValue`. `null` in an `.optional()` field fails
     the parse. */
  const setEmpty = () => set(field.emptyValue === "null" ? null : undefined);
  const isDisabled = disabled || field.disabled;

  // A live value error, never a missing-requirement error.
  const error = field.validate ? field.validate(raw, value, ctx) : null;

  /* `note` marks a field that is stored but not yet read by anything; it shares the help slot. */
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
          onChange={(next) => (next === null ? setEmpty() : set(next))}
        />
      );

    case "stepper":
      // The stepper's own label is the field label; a `Field` label would have nothing to focus.
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
      if (field.chips) {
        const chosen = asString(raw);
        // The multiselect's group of pressed chips, with one pressed at a time; a pressed chip stays pressed.
        return (
          <div className={field.wide ? "nh-fieldgrid-wide hb-field" : "hb-field"} id={fieldId}>
            <span className="nh-field-label" id={`${fieldId}-label`}>
              {field.label}
            </span>
            <div
              className="hb-chips"
              role="group"
              aria-labelledby={`${fieldId}-label`}
              aria-describedby={help || error ? `${fieldId}-help` : undefined}
            >
              {options.map((option) => (
                <Chip
                  key={option.value}
                  pressed={chosen === option.value}
                  disabled={isDisabled || option.disabled}
                  onClick={() => {
                    if (chosen !== option.value) set(option.value);
                  }}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            {(help || error) && (
              <p className={error ? "nh-field-help hb-field-error" : "nh-field-help"} id={`${fieldId}-help`}>
                {error ?? help}
              </p>
            )}
          </div>
        );
      }
      if (field.searchable) {
        const entries = field.catalog === "equipment" ? ctx.equipment : field.catalog === "spells" ? ctx.spells : [];
        return wrap(
          <CatalogPicker
            id={fieldId}
            entries={entries}
            value={asString(raw) || null}
            onChange={(next) => set(next)}
            emptyLabel={field.placeholder ?? `Choose ${withArticle(field.label.toLowerCase())}`}
            title={field.label}
            searchPlaceholder="Search…"
            ariaLabel={field.label}
            disabled={isDisabled}
          />
        );
      }
      // `<optgroup>` only when the schema groups its options.
      return wrap(
        <Select
          id={fieldId}
          value={asString(raw)}
          disabled={isDisabled}
          invalid={!!error}
          onChange={(event) => (event.target.value ? set(event.target.value) : setEmpty())}
        >
          <option value="">{field.placeholder ?? "Not set"}</option>
          {groupOptions(options).map((block, index) =>
            block.group === null ? (
              block.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))
            ) : (
              <optgroup key={`${block.group}-${index}`} label={block.group}>
                {block.options.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            )
          )}
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
          {/* One labelled group of `aria-pressed` buttons; constraints are stated once for the group. */}
          <div
            className="hb-chips"
            role="group"
            aria-labelledby={`${fieldId}-label`}
            aria-describedby={help ? `${fieldId}-help` : undefined}
          >
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
          {/* A live value error, like a text field's, under the group it is about. */}
          {error && <p className="nh-field-help hb-field-error">{error}</p>}
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
          suggestions={resolveSuggestions(field, ctx, draft)}
          /* `pick` shows the vocabulary on screen; entry stays free. See `FieldDef.pick`. */
          pick={field.pick}
          /* Labels derive from the slug, e.g. "very-rare" -> "Very Rare". */
          optionLabel={suggestionLabel}
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
            // Fallback index key only; a stable id from `rowKey` is preferred.
            rowKey={(row) => field.rowKey?.(row, rows.indexOf(row)) ?? String(rows.indexOf(row))}
            onAdd={() => field.newRow?.() ?? {}}
            addLabel={field.addLabel ?? `Add to ${field.label.toLowerCase()}`}
            rowLabel={field.rowLabel ? (row, index) => field.rowLabel!(row, index, ctx) : undefined}
            collapsible={rowFields.length > 2}
            emptyText={field.emptyText}
            max={field.maxRows}
            maxReachedReason={field.maxRowsReason}
            ariaLabel={field.label}
            renderRow={(row, index) => (
              <FieldGrid>
                {/* Keyed by position as well as path: mutually exclusive variants can share a key
                    like `count`. */}
                {rowFields.map((rowField, fieldIndex) => (
                  <FieldRenderer
                    {...props}
                    key={`${rowField.key}-${fieldIndex}`}
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
          {/* Group help sits above the members, before their own help. */}
          {help && <p className="nh-field-help">{help}</p>}
          <FieldGrid>
            {(field.rows ?? []).map((child, childIndex) => (
              <FieldRenderer
                {...props}
                key={`${child.key}-${childIndex}`}
                field={child}
                idPrefix={`${idPrefix}-${field.key}`}
              />
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
    default: {
      /** Native `<input list>` + `<datalist>`: suggestions are one tap away, yet any value is
          typeable, since `school`, `category`, `rarity` and `creatureType` are open slugs. */
      const suggestions = resolveSuggestions(field, ctx, draft);

      /** `presets`: the common answers as chips, and the input for anything else; both write the same text. */
      if (field.presets) {
        const text = asString(raw);
        return (
          <div className={field.wide ? "nh-fieldgrid-wide hb-field" : "hb-field"}>
            <span className="nh-field-label" id={`${fieldId}-label`}>
              {field.label}
            </span>
            <div className="hb-chips" role="group" aria-labelledby={`${fieldId}-label`}>
              {field.presets.map((preset) => (
                <Chip
                  key={preset.value}
                  pressed={text === preset.value}
                  disabled={isDisabled}
                  onClick={() => set(preset.value)}
                >
                  {preset.label}
                </Chip>
              ))}
            </div>
            <Input
              id={fieldId}
              aria-label={`${field.label}, in your own words`}
              value={text}
              placeholder={field.placeholder}
              disabled={isDisabled}
              invalid={!!error}
              maxLength={field.max}
              onChange={(event) =>
                event.target.value === "" && field.emptyValue ? setEmpty() : set(event.target.value)
              }
            />
            {(help || error) && (
              <p className={error ? "nh-field-help hb-field-error" : "nh-field-help"}>{error ?? help}</p>
            )}
          </div>
        );
      }

      /** `pick`: the same open contract with the list visible (a datalist has no visible cue, and no
          control at all on iOS Safari). Clearing goes through `setEmpty()`. See `FieldDef.pick`. */
      if (field.pick && suggestions.length > 0) {
        return wrap(
          <Combobox
            id={fieldId}
            ariaLabel={field.label}
            options={suggestions.map((suggestion) => ({ id: suggestion, label: suggestionLabel(suggestion) }))}
            value={asString(raw) || null}
            placeholder={field.placeholder ? suggestionLabel(field.placeholder) : undefined}
            disabled={isDisabled}
            /* Show the whole bounded vocabulary past the default page of 8; large catalogs
               use `searchable` + `CatalogPicker`. */
            limit={suggestions.length}
            allowFreeText
            /* `pickValue` normalizes typed words to the slug shape, so "Very Rare" stores as `very-rare`. */
            onChange={(next) => (next === null ? setEmpty() : set(pickValue(next)))}
          />
        );
      }

      const listId = suggestions.length > 0 ? `${fieldId}-list` : undefined;
      return wrap(
        <>
          <Input
            id={fieldId}
            list={listId}
            value={asString(raw)}
            placeholder={field.placeholder}
            disabled={isDisabled}
            invalid={!!error}
            maxLength={field.max}
            /* Empty text stays `""` unless the field declares `emptyValue` (e.g. an open-slug regex
               or a nullable column), in which case it is omitted or nulled like a select. */
            onChange={(event) => (event.target.value === "" && field.emptyValue ? setEmpty() : set(event.target.value))}
          />
          {listId && (
            <datalist id={listId}>
              {suggestions.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          )}
        </>
      );
    }
  }
}
