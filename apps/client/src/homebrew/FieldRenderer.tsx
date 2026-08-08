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
  groupOptions, pickValue, resolveOptions, resolveSuggestions, suggestionLabel,
  type Draft, type FieldDef, type SchemaContext
} from "./schema";

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
  /* An emptied control writes what its COLUMN means by empty — `undefined` (the key goes away) for
     an optional column, `null` for a required-but-nullable one. See `FieldDef.emptyValue`; the
     default is omit, because writing `null` into an `.optional()` enum is how "Not set" turned four
     ordinary authoring gestures into an unpublishable record. */
  const setEmpty = () => set(field.emptyValue === "null" ? null : undefined);
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
          onChange={(next) => (next === null ? setEmpty() : set(next))}
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
      // `<optgroup>` when — and only when — the schema asked for it, so a twenty-one
      // entry modifier list or a thirty entry gating list reads as its groups. Ungrouped
      // options render exactly as they always did.
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
          /* THE SAME FLAG THE TEXT BRANCH READS, meaning the same thing: put the list on screen.
             Six of the client's nine `3d` sites are lists rather than single values — the monster's
             three defence rows, a spell's damage types, the `damage-type-is` gate, the damage-type
             grants — so a `text`-only `pick` would have left two thirds of one reported issue needing
             a second mechanism. Still `TagInput`, still `slugify`, still free entry: `pick` changes
             what a GM can SEE, never what the field accepts. See `FieldDef.pick`. */
          pick={field.pick}
          /* Derived, never a second list: `"very-rare"` reads "Very Rare" by one rule, so a
             vocabulary that grows a member is readable the day it lands with nothing to remember. */
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
                {/* Keyed by POSITION as well as path: one variant's "Extra attacks" and
                    another's "Extra dice" are both `count` on the same discriminated
                    union, mutually exclusive through `visibleWhen`. Keying on the path
                    alone made those a duplicate-key collision. */}
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
          {/* Stated ONCE for the group, never once per member field — and ABOVE it, not
              below. Under the grid, a group's help landed after every member's own help,
              so "How many times this can be used before a rest gives it back" rendered
              three controls away from the field it explains and beneath a different
              field's note. A group blurb introduces its group; it does not follow it. */}
          {help && <p className="nh-field-help">{help}</p>}
          <FieldGrid>
            {(field.rows ?? []).map((child, childIndex) => (
              <FieldRenderer {...props} key={`${child.key}-${childIndex}`} field={child} idPrefix={`${idPrefix}-${field.key}`} />
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
      /**
       * **The complete list, plus other** — one native `<input list>` + `<datalist>`, which is the
       * pattern `FeatureEditor` has always used for choice kinds and the only one in the repo that
       * gets both halves right: every SRD value is one tap away on a phone, and a word the SRD has
       * never heard of is still typeable, because `school`, `category`, `rarity` and `creatureType`
       * are OPEN slugs in their schemas and a closed control over an open slug is its own defect.
       *
       * `suggestions` on a text field used to be DEAD — only the `tags` case read it — so the item
       * category's declared suggestions rendered nowhere and every damage-type field in the editor
       * was a bare box a GM had to spell "bludgeoning" into from memory. Reading it here is the
       * whole fix; no new `FieldKind`, per the standing rule at the top of `schema.ts`.
       */
      const suggestions = resolveSuggestions(field, ctx);

      /**
       * **`pick`: the same contract, with the list on screen.** See `FieldDef.pick`.
       *
       * A `<datalist>` is complete and invisible — no arrow, no cue, and on iOS Safari no control at
       * all — so "Rarity" read as a bare box a GM had to spell "very-rare" into from memory. The
       * chooser shows the whole vocabulary, keeps `allowFreeText` so an open slug stays open, and
       * takes the 44px floor on every row (`Combobox.css`, route 1).
       *
       * Empty is the ABSENT value, not `""`: clearing the chip goes through `setEmpty()`, which is
       * what `emptyValue` already means everywhere else in this file.
       */
      if (field.pick && suggestions.length > 0) {
        return wrap(
          <Combobox
            id={fieldId}
            ariaLabel={field.label}
            options={suggestions.map((suggestion) => ({ id: suggestion, label: suggestionLabel(suggestion) }))}
            value={asString(raw) || null}
            placeholder={field.placeholder ? suggestionLabel(field.placeholder) : undefined}
            disabled={isDisabled}
            /* THE WHOLE LIST, not `Combobox`'s default page of 8. A `pick` field's suggestions are a
               COMPLETE bounded vocabulary — 7 rarities, 13 damage types — and paging one to 8 would
               reintroduce "ten of the thirteen damage types" at the renderer having just fixed it at
               the constant. Rarity never noticed because 7 < 8. `.nh-combobox-list` scrolls at 17rem;
               a field whose list is a 339-entry catalog is `searchable` + `CatalogPicker`, not this. */
            limit={suggestions.length}
            allowFreeText
            /* The id handed back is either a slug from the list or the raw words typed; `pickValue`
               makes the second case the same shape as the first, so "Very Rare" typed by hand is
               the rung and not an unpublishable string. */
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
            /* An empty box is empty text unless the field says otherwise. Most string columns take
               `""` happily; the ones that do not — an open-slug `rarity` whose regex rejects it, a
               nullable `shape.unit` — declare `emptyValue` and get the same omit/null treatment a
               select gets. */
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
