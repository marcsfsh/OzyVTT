import { useState } from "react";
import { Button, Eyebrow, Input } from "@vtt/ui";
import { Dropdown } from "../codex/shared/Dropdown";
import { FilterChips } from "../codex/shared/FilterFlyout";
import { SortDialog, type SortDirection, type SortLevelOf } from "../codex/shared/SortDialog";
import { firstSortDirection, modifiedRangeLabel, sortDirectionLabel, sortSummary } from "./scene-lists";

/**
 * The pieces both tables' toolbars are built from, over the Codex's shared Dropdown, chips and Sort dialog: a
 * dropdown of ticks with All and Clear, the Modified range, one-choice chips and the Sort button.
 */

/** A dropdown of ticks, every one ticked by default: "State: all 4", "State: Live, Prepared". */
export function TickDropdown<Value extends string>({
  name,
  options,
  selected,
  onChange
}: Readonly<{
  name: string;
  options: ReadonlyArray<Readonly<{ value: Value; label: string }>>;
  selected: readonly Value[];
  onChange: (next: readonly Value[]) => void;
}>) {
  const on = options.filter((option) => selected.includes(option.value));
  const label =
    on.length === options.length
      ? `${name}: all ${options.length}`
      : on.length === 0
        ? `${name}: none`
        : `${name}: ${on.map((option) => option.label).join(", ")}`;
  return (
    <Dropdown label={label}>
      {() => (
        <>
          <div className="cx-dropdown-row">
            <Button size="sm" variant="ghost" onClick={() => onChange(options.map((option) => option.value))}>
              All
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange([])}>
              Clear
            </Button>
          </div>
          {options.map((option) => (
            <label key={option.value} className="cx-check">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) =>
                  onChange(
                    options
                      .map((candidate) => candidate.value)
                      .filter((value) => (value === option.value ? event.target.checked : selected.includes(value)))
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </>
      )}
    </Dropdown>
  );
}

/** When a row last changed, as a From and a To day; either end can stay open. */
export function ModifiedDropdown({
  from,
  to,
  onChange
}: Readonly<{ from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }>) {
  return (
    <Dropdown label={modifiedRangeLabel(from, to)} panelClassName="cx-datemenu" align="end">
      {() => (
        <>
          <label className="cx-datefield">
            <span>From</span>
            <Input type="date" value={from ?? ""} onChange={(event) => onChange(event.target.value || null, to)} />
          </label>
          <label className="cx-datefield">
            <span>To</span>
            <Input type="date" value={to ?? ""} onChange={(event) => onChange(from, event.target.value || null)} />
          </label>
          <Button size="sm" variant="ghost" onClick={() => onChange(null, null)}>
            Any time
          </Button>
        </>
      )}
    </Dropdown>
  );
}

/** A labelled row of chips where at most one is on: pressing the one that is on turns the filter off. */
export function OneChoice<Value extends string>({
  label,
  options,
  value,
  onChange
}: Readonly<{
  label: string;
  options: ReadonlyArray<Readonly<{ value: Value; label: string }>>;
  /** Null when the filter is off. */
  value: Value | null;
  onChange: (next: Value | null) => void;
}>) {
  return (
    <>
      <Eyebrow>{label}</Eyebrow>
      <FilterChips
        label={label}
        options={options}
        selected={value === null ? [] : [value]}
        onChange={(next) => onChange((next.find((candidate) => candidate !== value) as Value | undefined) ?? null)}
      />
    </>
  );
}

/** The Sort button, which names the sort, and the dialog it opens. */
export function SortButton<Key extends string>({
  sort,
  keys,
  labels,
  onSort,
  directionLabel = sortDirectionLabel,
  firstDirection = firstSortDirection,
  phone = false
}: Readonly<{
  sort: readonly SortLevelOf<Key>[];
  keys: readonly Key[];
  labels: Readonly<Record<Key, string>>;
  onSort: (levels: readonly SortLevelOf<Key>[]) => void;
  /** How a direction reads for a column, when the list's columns read differently from the Scenes table's. */
  directionLabel?: (key: Key, direction: SortDirection) => string;
  firstDirection?: (key: Key) => SortDirection;
  /** On a phone the button says Sort, and the dialog opens as a sheet from the bottom. */
  phone?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {phone ? "Sort" : sortSummary(sort, labels)}
      </Button>
      {open && (
        <SortDialog
          levels={sort}
          keys={keys}
          keyLabel={(key) => labels[key]}
          directionLabel={directionLabel}
          firstDirection={firstDirection}
          align={phone ? "bottom" : "center"}
          onCancel={() => setOpen(false)}
          onSort={(levels) => {
            onSort(levels);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
