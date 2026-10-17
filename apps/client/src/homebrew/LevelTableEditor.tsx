/**
 * The class level table. Most cells are derived from settings, and few are typed:
 * - Proficiency bonus is always `2 + floor((level - 1) / 4)` and is never an input.
 * - The features column projects each feature's "Granted at levels" (`FeatureEditor`).
 * - Spell and pact slots come from one progression pick via `spellSlotsForClass` /
 *   `pactSlotsForLevel`.
 * Free-form columns: `cantripsKnown`, `preparedCount`, `classResources`.
 *
 * Slot overrides are per row and derived, and never stored (`ClassLevelRowSchema` is `.strict()`):
 * a row is overridden iff its slots differ from what the current settings generate. On a
 * progression change, rows that matched the previous settings are regenerated and overridden
 * rows are left alone.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { pactSlotsForLevel, proficiencyBonusForLevel, spellSlotsForClass, type CasterProgression } from "@vtt/rules-5e";
import { Badge, Button, FieldGrid, IconButton, IconPencil, NumberField, RowEditor, Stepper } from "@vtt/ui";
import { newId } from "../lib/ids";
import { setAt } from "./paths";
import { LEVELS, blankLevelRow } from "./defaults";
import type { Draft } from "./schema";

type PactSlots = Readonly<{ level: number; slots: number }>;
type ClassResource = Readonly<{ id: string; name: string; amount: number | string }>;
type LevelRow = Readonly<{
  level: number;
  proficiencyBonus: number;
  features?: readonly string[];
  spellSlots?: readonly number[];
  pactSlots?: PactSlots;
  cantripsKnown?: number;
  preparedCount?: number;
  preparedFormula?: string;
  spellsKnown?: number;
  classResources?: readonly ClassResource[];
}>;

/** `undefined` means "None": no spellcasting block at all, since the schema has no
    `progression: "none"`. */
export type Progression = CasterProgression | undefined;

export function progressionOf(draft: Draft): Progression {
  const spellcasting = draft.spellcasting as { multiclassProgression?: string } | null | undefined;
  if (!spellcasting) return undefined;
  const value = spellcasting.multiclassProgression;
  return value === "full" || value === "half" || value === "third" || value === "pact" ? value : "full";
}

/** The derived half of one row. `undefined` means the column is absent: the schema is `.strict()`
    with `.optional()` columns, so a non-caster row carries no `spellSlots` key at all. */
function generateFor(level: number, progression: Progression, classId: string) {
  const proficiencyBonus = proficiencyBonusForLevel(level);
  if (progression === undefined) return { proficiencyBonus, spellSlots: undefined, pactSlots: undefined };
  if (progression === "pact") {
    const pact = pactSlotsForLevel(level);
    return {
      proficiencyBonus,
      spellSlots: undefined,
      pactSlots: pact ? { level: pact.level, slots: pact.slots } : undefined
    };
  }
  return { proficiencyBonus, spellSlots: [...spellSlotsForClass(classId, level, progression)], pactSlots: undefined };
}

const sameSlots = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]));
const samePact = (a: PactSlots | undefined, b: PactSlots | undefined) =>
  a === b || (!!a && !!b && a.level === b.level && a.slots === b.slots);

/** The nine spell slot levels, for the per-level slot fields. */
const SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Accessible text for the collapsed slots cell, e.g. "Level 1: 4, Level 2: 3, Levels 4-9: none". */
function describeSlots(slots: readonly number[]): string {
  const parts: string[] = [];
  let runStart = -1;
  const flushRun = (end: number) => {
    if (runStart === -1) return;
    parts.push(runStart === end ? `Level ${runStart + 1}: none` : `Levels ${runStart + 1}-${end + 1}: none`);
    runStart = -1;
  };
  slots.forEach((count, index) => {
    if (count === 0) {
      if (runStart === -1) runStart = index;
      return;
    }
    flushRun(index - 1);
    parts.push(`Level ${index + 1}: ${count}`);
  });
  flushRun(slots.length - 1);
  return parts.join(", ");
}

/** Narrow-viewport detection; the one-level-at-a-time fold needs JS to pick which row to
    show. 760 matches the CSS. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function LevelTableEditor({
  draft,
  onDraft,
  classId
}: Readonly<{ draft: Draft; onDraft: (next: Draft) => void; classId: string }>) {
  const progression = progressionOf(draft);
  const rows = useMemo(
    () => (Array.isArray(draft.levelTable) ? (draft.levelTable as LevelRow[]) : []),
    [draft.levelTable]
  );
  const features = useMemo(
    () => (Array.isArray(draft.features) ? (draft.features as ReadonlyArray<{ id?: string; name?: string }>) : []),
    [draft.features]
  );
  const featureName = useMemo(() => {
    const map = new Map<string, string>();
    for (const feature of features) if (feature.id) map.set(feature.id, feature.name || feature.id);
    return map;
  }, [features]);

  const [open, setOpen] = useState<number | null>(null);
  const [level, setLevel] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const narrow = useNarrow();

  const generated = useMemo(
    () => LEVELS.map((value) => generateFor(value, progression, classId)),
    [progression, classId]
  );

  /* Reconciliation, on mount and when the progression changes. `previous` is what the last
     settings generated, which tells a row following the pattern from an overridden one. */
  const previous = useRef(progression);
  useEffect(() => {
    const wasProgression = previous.current;
    previous.current = progression;

    const next = LEVELS.map((value, index) => {
      const stored = rows[index];
      const row: Record<string, unknown> = stored && typeof stored === "object" ? { ...stored } : blankLevelRow(value);
      row.level = value;
      // Always derived, never trusted from the wire.
      row.proficiencyBonus = proficiencyBonusForLevel(value);
      if (!Array.isArray(row.features)) row.features = [];
      if (!Array.isArray(row.classResources)) row.classResources = [];

      const before = generateFor(value, wasProgression, classId);
      const now = generated[index];
      const followed =
        sameSlots(stored?.spellSlots, before.spellSlots) && samePact(stored?.pactSlots, before.pactSlots);
      if (followed) {
        // Omit, never null: the row schema is `.strict()` with `.optional()` columns.
        if (now.spellSlots) row.spellSlots = now.spellSlots;
        else delete row.spellSlots;
        if (now.pactSlots) row.pactSlots = now.pactSlots;
        else delete row.pactSlots;
      }
      return row;
    });

    if (JSON.stringify(next) !== JSON.stringify(rows)) onDraft(setAt(draft, "levelTable", next));
    // Omits `draft`/`onDraft` so this runs only when the settings change. An edit alone doesn't rerun it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progression, classId, generated, rows]);

  const writeRow = (index: number, patch: Readonly<Record<string, unknown>>) => {
    const next = rows.map((row, i) => {
      if (i !== index) return row;
      const merged: Record<string, unknown> = { ...row };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete merged[key];
        else merged[key] = value;
      }
      return merged as LevelRow;
    });
    onDraft(setAt(draft, "levelTable", next));
  };

  const isOverridden = (index: number) => {
    const row = rows[index];
    if (!row) return false;
    return (
      !sameSlots(row.spellSlots, generated[index].spellSlots) || !samePact(row.pactSlots, generated[index].pactSlots)
    );
  };

  const slotText = (index: number): { text: string; label: string } => {
    const row = rows[index];
    if (!row) return { text: "None", label: "No spell slots" };
    if (row.pactSlots) {
      return {
        text: `${row.pactSlots.slots} × level ${row.pactSlots.level}`,
        label: `${row.pactSlots.slots} level ${row.pactSlots.level} pact ${row.pactSlots.slots === 1 ? "slot" : "slots"}`
      };
    }
    if (!row.spellSlots) return { text: "None", label: "No spell slots" };
    return {
      text: row.spellSlots.map(String).join(" "),
      label: describeSlots(row.spellSlots)
    };
  };

  const featureText = (index: number) => {
    const ids = rows[index]?.features ?? [];
    if (ids.length === 0) return "None";
    return ids.map((id) => featureName.get(id) ?? id).join(", ");
  };

  /** What changes at this level. `classResources` is cumulative, so each row shows only new or
      changed amounts, and names any resource that disappears. */
  const resourceText = (index: number) => {
    const list = rows[index]?.classResources ?? [];
    const before = index === 0 ? [] : (rows[index - 1]?.classResources ?? []);
    const wasAt = new Map(before.map((resource) => [resource.id, resource]));
    const parts = list
      .filter((resource) => {
        const previous = wasAt.get(resource.id);
        return !previous || previous.amount !== resource.amount;
      })
      .map((resource) => `${resource.name || resource.id} ×${resource.amount}`);
    const nowAt = new Set(list.map((resource) => resource.id));
    for (const resource of before) {
      if (!nowAt.has(resource.id)) parts.push(`${resource.name || resource.id} gone`);
    }
    return parts.length === 0 ? "None" : parts.join(", ");
  };

  const placed = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) for (const id of row.features ?? []) ids.add(id);
    return ids.size;
  }, [rows]);

  const shown = narrow && !showAll ? [level - 1] : LEVELS.map((_, index) => index);
  const casts = progression !== undefined;

  const renderRow = (index: number) => {
    const row = rows[index];
    if (!row) return null;
    const value = index + 1;
    const slots = slotText(index);
    const overridden = isOverridden(index);
    const editing = open === value;

    return (
      <div className="hb-lt-row" key={value}>
        <span className="hb-lt-cell hb-lt-level tabular">
          <span className="hb-lt-micro">Level</span>
          {value}
        </span>
        <span className="hb-lt-cell tabular hb-lt-derived">
          <span className="hb-lt-micro">Bonus</span>+{row.proficiencyBonus}
        </span>
        <span className="hb-lt-cell hb-lt-derived hb-lt-wrapcell">
          <span className="hb-lt-micro">Features</span>
          {featureText(index)}
        </span>
        {/* Spellcasting columns render only for a caster; derived from the progression. */}
        {casts && (
          <>
            <span className="hb-lt-cell hb-lt-slots">
              <span className="hb-lt-micro">Spell slots</span>
              {/* Real visually-hidden text: an aria-label on a roleless
                  <span> is ignored by the accessible-name computation. */}
              <span className="tabular hb-lt-derived" aria-hidden="true">
                {slots.text}
              </span>
              <span className="nh-sr-only">{slots.label}</span>
              {overridden && <Badge tone="caution">Overridden</Badge>}
            </span>
            <span className="hb-lt-cell hb-lt-num">
              <span className="hb-lt-micro">Cantrips</span>
              <NumberField
                value={row.cantripsKnown ?? null}
                min={0}
                max={10}
                placeholder="None"
                onChange={(next) => writeRow(index, { cantripsKnown: next ?? undefined })}
              />
            </span>
            <span className="hb-lt-cell hb-lt-num">
              <span className="hb-lt-micro">Prepared</span>
              <NumberField
                value={row.preparedCount ?? null}
                min={0}
                max={60}
                placeholder="None"
                onChange={(next) => writeRow(index, { preparedCount: next ?? undefined })}
              />
            </span>
          </>
        )}
        <span className="hb-lt-cell hb-lt-derived hb-lt-wrapcell">
          <span className="hb-lt-micro">Resources</span>
          {resourceText(index)}
          {/* Opens the whole level (slots and class resources), so it sits outside the
              slots column that non-casters do not render. */}
          <IconButton
            label={`Edit level ${value}`}
            size="sm"
            className="hb-lt-edit"
            aria-expanded={editing}
            onClick={() => setOpen(editing ? null : value)}
          >
            <IconPencil />
          </IconButton>
        </span>

        {editing && (
          <div className="hb-lt-strip">
            {progression === undefined ? (
              <p className="nh-field-help">
                This class has no spellcasting, so it has no slots to override. Turn on a caster progression above
                first.
              </p>
            ) : progression === "pact" ? (
              /* Each half falls back to the generated value (zero would be wrong), so clearing one field
                 never silently zeroes the row. */
              <FieldGrid min="8rem">
                <label className="nh-field">
                  <span className="nh-field-label">Pact slot level</span>
                  <NumberField
                    value={row.pactSlots?.level ?? null}
                    min={1}
                    max={9}
                    onChange={(next) =>
                      writeRow(index, {
                        pactSlots:
                          next == null
                            ? undefined
                            : { level: next, slots: row.pactSlots?.slots ?? generated[index].pactSlots?.slots ?? 1 }
                      })
                    }
                  />
                </label>
                <label className="nh-field">
                  <span className="nh-field-label">Pact slots</span>
                  <NumberField
                    value={row.pactSlots?.slots ?? null}
                    min={0}
                    max={4}
                    onChange={(next) =>
                      writeRow(index, {
                        pactSlots:
                          next == null
                            ? undefined
                            : { level: row.pactSlots?.level ?? generated[index].pactSlots?.level ?? 1, slots: next }
                      })
                    }
                  />
                </label>
              </FieldGrid>
            ) : (
              <div className="hb-lt-slotstrip" role="group" aria-label={`Spell slots at level ${value}`}>
                {SLOT_LEVELS.map((slotLevel, slot) => (
                  <label key={slotLevel} className="hb-lt-slotfield">
                    <span className="nh-field-label">Level {slotLevel}</span>
                    <NumberField
                      value={row.spellSlots?.[slot] ?? 0}
                      min={0}
                      max={4}
                      onChange={(next) => {
                        const base = row.spellSlots ? [...row.spellSlots] : new Array(9).fill(0);
                        base[slot] = next ?? 0;
                        writeRow(index, { spellSlots: base });
                      }}
                    />
                  </label>
                ))}
              </div>
            )}

            {overridden && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  writeRow(index, { spellSlots: generated[index].spellSlots, pactSlots: generated[index].pactSlots })
                }
              >
                Reset to default
              </Button>
            )}

            <div className="hb-lt-resources">
              <span className="nh-field-label">Class resources</span>
              <p className="nh-field-help">
                <em className="hb-note">
                  Shown on the level table only. For a pool the game tracks, give a feature limited uses instead.
                </em>
              </p>
              <RowEditor
                rows={row.classResources ?? []}
                onChange={(next) => writeRow(index, { classResources: next })}
                rowKey={(resource) => (resource as ClassResource).id}
                onAdd={() => ({ id: newId(), name: "", amount: 1 })}
                addLabel="Add a resource"
                emptyText="No resources at this level."
                max={8}
                maxReachedReason="Eight resources is as many as a level row can carry."
                ariaLabel={`Class resources at level ${value}`}
                rowLabel={(resource) => (resource as ClassResource).name || "Unnamed resource"}
                renderRow={(resource, resourceIndex) => (
                  <FieldGrid min="9rem">
                    <label className="nh-field">
                      <span className="nh-field-label">Name</span>
                      <input
                        className="nh-input"
                        value={(resource as ClassResource).name ?? ""}
                        onChange={(event) => {
                          const list = (row.classResources ?? []).map((entry, i) =>
                            i === resourceIndex ? { ...entry, name: event.target.value } : entry
                          );
                          writeRow(index, { classResources: list });
                        }}
                      />
                    </label>
                    <label className="nh-field">
                      <span className="nh-field-label">Amount</span>
                      <input
                        className="nh-input"
                        value={String((resource as ClassResource).amount ?? "")}
                        onChange={(event) => {
                          const raw = event.target.value;
                          // An amount is a number or a dice string ("3d6"); coerce only all-digit input.
                          const amount = /^\d+$/.test(raw) ? Number(raw) : raw;
                          const list = (row.classResources ?? []).map((entry, i) =>
                            i === resourceIndex ? { ...entry, amount } : entry
                          );
                          writeRow(index, { classResources: list });
                        }}
                      />
                    </label>
                  </FieldGrid>
                )}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const progressionWord =
    progression === undefined ? "no spellcasting" : progression === "pact" ? "pact magic" : `${progression} caster`;

  return (
    <div className="hb-lt">
      <p className="nh-field-help">
        Proficiency bonus, features and spell slots are calculated. Override a row if your class breaks the pattern.
        Resources list what changes at that level.
      </p>
      <p className="hb-lt-summary">
        <strong className="tabular">20 levels</strong> &middot; {progressionWord} &middot;{" "}
        <strong className="tabular">{placed}</strong> {placed === 1 ? "feature" : "features"} placed
      </p>

      {narrow && !showAll && <Stepper value={level} onChange={setLevel} min={1} max={20} label="Level" announceValue />}

      <div className="hb-lt-scroll">
        <div className={`hb-lt-table${casts ? "" : " hb-lt-table--nocast"}`} role="group" aria-label="Level table">
          <div className="hb-lt-head" aria-hidden="true">
            <span>Level</span>
            <span>Bonus</span>
            <span>Features</span>
            {casts && <span>Spell slots</span>}
            {casts && <span>Cantrips</span>}
            {casts && <span>Prepared</span>}
            <span>Resources</span>
          </div>
          {shown.map(renderRow)}
        </div>
      </div>

      {narrow && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show one level at a time" : "Show all 20 levels"}
        </Button>
      )}
    </div>
  );
}
