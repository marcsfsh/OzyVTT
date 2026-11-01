import { useMemo, useState, type ReactNode } from "react";
import { Button, Input, Select, Tick } from "@vtt/ui";
import { ModifiedDropdown, OneChoice } from "../scenes/listTools";
import { KIND_FILTERS, type Kind } from "./kinds";
import {
  AUDIENCES,
  AUDIENCE_WORD,
  NO_FILTERS,
  ROW_STATES,
  STATE_WORD,
  activeFilters,
  facetCounts,
  spanOf,
  valuesBetween,
  type CompendiumRow,
  type Facet,
  type TableFilters
} from "./tableModel";
import "./filter-panel.css";

export type SourceOption = Readonly<{ value: string; label: string }>;

/** The kind's filter drawn as a range with its chart (CR for monsters, level for spells). */
const RANGE_KEY: Partial<Record<Kind, string>> = { monster: "cr", spell: "level" };
/** The kind's main list, open with six choices shown. */
const MAIN_KEY: Partial<Record<Kind, string>> = {
  monster: "type",
  spell: "school",
  equipment: "rarity",
  class: "caster",
  subclass: "class",
  species: "size",
  feat: "category"
};
const SHOWN = 6;

/** Every value a kind's filter takes in the rows, in the filter's own order. */
function valuesOf(kind: Kind, key: string, rows: readonly CompendiumRow[]): string[] {
  const filter = KIND_FILTERS[kind].find((candidate) => candidate.key === key)!;
  const values = [...new Set(rows.map((row) => filter.value(row.columns)).filter((value): value is string => !!value))];
  return values.sort(filter.order ?? ((left, right) => left.localeCompare(right)));
}

/** A list of choices as ticks, each with how many rows it would show; "Show all N" past six when asked. */
function TickList({
  label,
  values,
  word,
  counts,
  chosen,
  onChange,
  fold = false
}: Readonly<{
  label: string;
  values: readonly string[];
  word: (value: string) => string;
  counts: ReadonlyMap<string, number>;
  /** Null keeps every value. */
  chosen: readonly string[] | null;
  onChange: (next: readonly string[] | null) => void;
  /** Six shown, the rest behind Show all. */
  fold?: boolean;
}>) {
  const [all, setAll] = useState(false);
  const shown = fold && !all ? values.slice(0, SHOWN) : values;
  const isOn = (value: string) => chosen === null || chosen.includes(value);
  const toggle = (value: string, on: boolean) => {
    const current = chosen ?? values;
    const next = on ? [...current, value] : current.filter((entry) => entry !== value);
    onChange(next.length === values.length ? null : values.filter((entry) => next.includes(entry)));
  };
  return (
    <div className="cp-fp-ticks" role="group" aria-label={label}>
      {shown.map((value) => (
        <div key={value} className="cp-fp-choice">
          <Tick checked={isOn(value)} onChange={(on) => toggle(value, on)} label={word(value)} />
          <span className="cp-fp-count">{counts.get(value) ?? 0}</span>
        </div>
      ))}
      {fold && values.length > SHOWN && (
        <Button size="sm" className="cp-fp-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${values.length}`}
        </Button>
      )}
    </div>
  );
}

/**
 * A range over ordered values (CR, a spell's level): a small chart of how many rows sit at each value with the chosen
 * range lit, a two-handle range under it and its two ends as fields. It writes every value between the ends, so the
 * address keeps its list form.
 */
function RangeFacet({
  label,
  values,
  word,
  counts,
  chosen,
  onChange
}: Readonly<{
  label: string;
  values: readonly string[];
  word: (value: string) => string;
  counts: ReadonlyMap<string, number>;
  chosen: readonly string[] | undefined;
  onChange: (next: readonly string[] | null) => void;
}>) {
  const span = spanOf(values, chosen);
  if (!span || values.length < 2) return null;
  const [low, high] = span;
  const lowAt = values.indexOf(low);
  const highAt = values.indexOf(high);
  const most = Math.max(1, ...values.map((value) => counts.get(value) ?? 0));
  const set = (from: string, to: string) => {
    const between = valuesBetween(values, from, to);
    onChange(between.length === values.length ? null : between);
  };
  return (
    <div className="cp-fp-range" role="group" aria-label={label}>
      <div className="cp-fp-chart" aria-hidden="true">
        {values.map((value, index) => (
          <span
            key={value}
            className={index >= lowAt && index <= highAt ? "cp-fp-bar is-on" : "cp-fp-bar"}
            style={{ height: `${Math.max(2, ((counts.get(value) ?? 0) / most) * 100)}%` }}
          />
        ))}
      </div>
      <div className="cp-fp-slider">
        <input
          type="range"
          min={0}
          max={values.length - 1}
          value={lowAt}
          aria-label={`Lowest ${label}`}
          aria-valuetext={word(low)}
          onChange={(event) => set(values[Math.min(Number(event.target.value), highAt)]!, high)}
        />
        <input
          type="range"
          min={0}
          max={values.length - 1}
          value={highAt}
          aria-label={`Highest ${label}`}
          aria-valuetext={word(high)}
          onChange={(event) => set(low, values[Math.max(Number(event.target.value), lowAt)]!)}
        />
      </div>
      <div className="cp-fp-ends">
        <Select aria-label={`From ${label}`} value={low} onChange={(event) => set(event.target.value, high)}>
          {values.slice(0, highAt + 1).map((value) => (
            <option key={value} value={value}>
              {word(value)}
            </option>
          ))}
        </Select>
        <span className="cp-fp-to">to</span>
        <Select aria-label={`To ${label}`} value={high} onChange={(event) => set(low, event.target.value)}>
          {values.slice(lowAt).map((value) => (
            <option key={value} value={value}>
              {word(value)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/** A folded filter: its name and current value as one row, opening in place. */
function Folded({ label, value, children }: Readonly<{ label: string; value: string; children: ReactNode }>) {
  return (
    <details className="cp-fp-fold">
      <summary>
        <span className="cp-fp-fold-name">{label}</span>
        <span className="cp-fp-fold-value">{value}</span>
      </summary>
      <div className="cp-fp-fold-body">{children}</div>
    </details>
  );
}

/** A list's current value in a folded row: every value, one, or how many. */
const chosenWords = (chosen: readonly string[] | null, word: (value: string) => string) =>
  chosen === null ? "Any" : chosen.length === 0 ? "None" : chosen.length === 1 ? word(chosen[0]!) : `${chosen.length}`;

/**
 * Browse's filter panel (compendium spec 2.2, GM only): the head with how many filters are on and Clear, Name, Source,
 * the kind's range with its chart, its main list open, and the rest folded as rows with their current value. Every
 * choice counts the rows it would show with every other filter as it is.
 */
export function FilterPanel({
  kind,
  filters,
  onFilters,
  rows,
  sources,
  gm
}: Readonly<{
  kind: Kind | null;
  filters: TableFilters;
  onFilters: (next: TableFilters) => void;
  rows: readonly CompendiumRow[];
  sources: readonly SourceOption[];
  gm: boolean;
}>) {
  const set = (patch: Partial<TableFilters>) => onFilters({ ...filters, ...patch });
  const counts = (facet: Facet) => facetCounts(rows, filters, kind, facet);
  const setKind = (key: string, next: readonly string[] | null) => {
    const kindFilters = { ...filters.kind };
    if (next === null) delete kindFilters[key];
    else kindFilters[key] = next;
    set({ kind: kindFilters });
  };
  const kindFilters = useMemo(() => (kind ? KIND_FILTERS[kind] : []), [kind]);
  const rangeKey = kind ? RANGE_KEY[kind] : undefined;
  const mainKey = kind ? MAIN_KEY[kind] : undefined;
  const values = useMemo(
    () => (kind ? Object.fromEntries(kindFilters.map((filter) => [filter.key, valuesOf(kind, filter.key, rows)])) : {}),
    [kind, kindFilters, rows]
  );
  const on = activeFilters(filters, gm) + (filters.q.trim() ? 1 : 0);
  return (
    <aside className="cp-filter-panel scroll-y" aria-label="Filters">
      <div className="cp-fp-head">
        <h3 className="cp-fp-title">Filters {on > 0 && <span className="cp-fp-on">{on}</span>}</h3>
        <Button size="sm" disabled={on === 0} onClick={() => onFilters(NO_FILTERS)}>
          Clear
        </Button>
      </div>
      <div className="cp-fp-group">
        <Input
          aria-label="Name"
          value={filters.q}
          placeholder="Part of a name"
          onChange={(event) => set({ q: event.target.value })}
        />
      </div>
      <div className="cp-fp-group">
        <p className="cp-fp-label">Source</p>
        <TickList
          label="Source"
          values={sources.map((option) => option.value)}
          word={(value) => sources.find((option) => option.value === value)?.label ?? value}
          counts={counts({ type: "source" })}
          chosen={filters.sources}
          onChange={(next) => set({ sources: next })}
        />
      </div>
      {kindFilters
        .filter((filter) => filter.key === rangeKey && (values[filter.key]?.length ?? 0) > 1)
        .map((filter) => (
          <div key={filter.key} className="cp-fp-group">
            <p className="cp-fp-label">{filter.label}</p>
            <RangeFacet
              label={filter.label}
              values={values[filter.key]!}
              word={filter.word}
              counts={counts({ type: "kind", key: filter.key })}
              chosen={filters.kind[filter.key]}
              onChange={(next) => setKind(filter.key, next)}
            />
          </div>
        ))}
      {kindFilters
        .filter((filter) => filter.key === mainKey && (values[filter.key]?.length ?? 0) > 1)
        .map((filter) => (
          <div key={filter.key} className="cp-fp-group">
            <p className="cp-fp-label">{filter.label}</p>
            <TickList
              label={filter.label}
              values={values[filter.key]!}
              word={filter.word}
              counts={counts({ type: "kind", key: filter.key })}
              chosen={filters.kind[filter.key] ?? null}
              onChange={(next) => setKind(filter.key, next)}
              fold
            />
          </div>
        ))}
      <div className="cp-fp-group cp-fp-folds">
        {kindFilters
          .filter(
            (filter) => filter.key !== rangeKey && filter.key !== mainKey && (values[filter.key]?.length ?? 0) > 1
          )
          .map((filter) => (
            <Folded
              key={filter.key}
              label={filter.label}
              value={chosenWords(filters.kind[filter.key] ?? null, filter.word)}
            >
              <TickList
                label={filter.label}
                values={values[filter.key]!}
                word={filter.word}
                counts={counts({ type: "kind", key: filter.key })}
                chosen={filters.kind[filter.key] ?? null}
                onChange={(next) => setKind(filter.key, next)}
              />
            </Folded>
          ))}
        {gm && (
          <>
            <Folded
              label="State"
              value={filters.states.length === ROW_STATES.length - 1 ? "Not archived" : `${filters.states.length}`}
            >
              <TickList
                label="State"
                values={ROW_STATES}
                word={(value) => STATE_WORD[value as (typeof ROW_STATES)[number]]}
                counts={counts({ type: "state" })}
                chosen={filters.states}
                onChange={(next) =>
                  set({ states: next === null ? ROW_STATES : ROW_STATES.filter((state) => next.includes(state)) })
                }
              />
            </Folded>
            <Folded
              label="Who sees it"
              value={chosenWords(
                filters.audiences.length === AUDIENCES.length ? null : filters.audiences,
                (value) => AUDIENCE_WORD[value as (typeof AUDIENCES)[number]]
              )}
            >
              <TickList
                label="Who sees it"
                values={AUDIENCES}
                word={(value) => AUDIENCE_WORD[value as (typeof AUDIENCES)[number]]}
                counts={counts({ type: "who" })}
                chosen={filters.audiences.length === AUDIENCES.length ? null : filters.audiences}
                onChange={(next) =>
                  set({
                    audiences: next === null ? AUDIENCES : AUDIENCES.filter((audience) => next.includes(audience))
                  })
                }
              />
            </Folded>
            <Folded label="Problems" value={filters.problems ? "Has problems" : "Any"}>
              <OneChoice
                label="Problems"
                options={[{ value: "problems", label: "Has problems" }]}
                value={filters.problems ? "problems" : null}
                onChange={(value) => set({ problems: value !== null })}
              />
            </Folded>
            <Folded label="Modified" value={filters.from || filters.to ? "Chosen" : "Any time"}>
              <ModifiedDropdown from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} />
            </Folded>
          </>
        )}
      </div>
    </aside>
  );
}
