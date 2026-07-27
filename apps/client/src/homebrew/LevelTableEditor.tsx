/**
 * The class level table — 20 rows, up to 14 columns, and **~270 of the ~280 cells
 * deleted rather than shrunk.**
 *
 * A naive editor is 20 × 14 inputs. Three of the four column families are already
 * derivable and the repo owns every derivation:
 *
 *  - **Proficiency bonus** is exactly `2 + floor((level - 1) / 4)` — zero deviations
 *    across all twelve SRD classes, and `character-build.ts:389` recomputes it and
 *    ignores the authored column anyway. It is never an input here.
 *  - **The features column** is a projection of each feature's own "Granted at levels"
 *    control (`FeatureEditor`), which writes `levelTable[].features[]` directly. Shown,
 *    never typed.
 *  - **All nine slot columns plus pact slots** come from ONE None/Full/Half/Third/Pact
 *    pick, through `spellSlotsForClass` / `pactSlotsForLevel` — both of which take a
 *    `progression` override precisely so a homebrew class needs no table entry.
 *
 * What is genuinely free-form: `cantripsKnown`, `preparedCount`, `classResources`. So
 * the GM edits five progression settings, a feature list and two numeric columns.
 *
 * **Override is per row, not per cell**, and — the load-bearing bit — it is **derived,
 * never stored**: `ClassLevelRowSchema` is `.strict()`, so there is nowhere to put an
 * `overridden: true` flag, and there does not need to be. A row is overridden iff its
 * stored slots differ from what the current settings generate. Reset writes the
 * generated value back and the badge disappears on its own.
 *
 * Changing the progression must not silently discard an override, so reconciliation
 * compares each row against what the PREVIOUS settings generated: a row that was
 * following the pattern is regenerated, a row that had diverged is left alone.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { pactSlotsForLevel, proficiencyBonusForLevel, spellSlotsForClass, type CasterProgression } from "@vtt/rules-5e";
import { Badge, Button, FieldGrid, IconButton, IconPencil, NumberField, RowEditor, Stepper } from "@vtt/ui";
import { newId } from "../lib/ids";
import { getAt, setAt } from "./paths";
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

/** `undefined` is the fifth option — "None", which is the ABSENCE of a spellcasting
    block rather than a `progression: "none"` value the schema has no room for. */
export type Progression = CasterProgression | undefined;

export function progressionOf(draft: Draft): Progression {
  const spellcasting = draft.spellcasting as { multiclassProgression?: string } | null | undefined;
  if (!spellcasting) return undefined;
  const value = spellcasting.multiclassProgression;
  return value === "full" || value === "half" || value === "third" || value === "pact" ? value : "full";
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** The derived half of one row. `undefined` means the column is absent — the schema is
    `.strict()` with `.optional()` columns, so a non-caster row must carry NO
    `spellSlots` key rather than a null or an array of zeros. */
function generateFor(level: number, progression: Progression, classId: string) {
  const proficiencyBonus = proficiencyBonusForLevel(level);
  if (progression === undefined) return { proficiencyBonus, spellSlots: undefined, pactSlots: undefined };
  if (progression === "pact") {
    const pact = pactSlotsForLevel(level);
    return { proficiencyBonus, spellSlots: undefined, pactSlots: pact ? { level: pact.level, slots: pact.slots } : undefined };
  }
  return { proficiencyBonus, spellSlots: [...spellSlotsForClass(classId, level, progression)], pactSlots: undefined };
}

const sameSlots = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((value, index) => value === b[index]));
const samePact = (a: PactSlots | undefined, b: PactSlots | undefined) =>
  a === b || (!!a && !!b && a.level === b.level && a.slots === b.slots);

/** "1st: 4, 2nd: 3, 3rd: 2, 4th–9th: none" — the collapsed cell's accessible name, so
    the nine columns it replaces are still readable one by one. */
function describeSlots(slots: readonly number[]): string {
  const parts: string[] = [];
  let runStart = -1;
  const flushRun = (end: number) => {
    if (runStart === -1) return;
    parts.push(runStart === end ? `${ORDINALS[runStart]}: none` : `${ORDINALS[runStart]}–${ORDINALS[end]}: none`);
    runStart = -1;
  };
  slots.forEach((count, index) => {
    if (count === 0) {
      if (runStart === -1) runStart = index;
      return;
    }
    flushRun(index - 1);
    parts.push(`${ORDINALS[index]}: ${count}`);
  });
  flushRun(slots.length - 1);
  return parts.join(", ");
}

/** Narrow-viewport detection. The fold genuinely needs JavaScript: CSS can hide the
    other nineteen cards, but only a component can decide which ONE to show, and the
    `Stepper` that picks it has no CSS-only equivalent. 760 matches the CSS. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
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
  const rows = useMemo(() => (Array.isArray(draft.levelTable) ? (draft.levelTable as LevelRow[]) : []), [draft.levelTable]);
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

  /* Reconciliation. Runs on mount (healing a short table and the always-derived
     proficiency bonus) and whenever the progression changes. `previous` is what the
     LAST settings generated, which is the only way to tell "this row was following the
     pattern" from "the GM overrode this row" without a stored flag. */
  const previous = useRef(progression);
  useEffect(() => {
    const wasProgression = previous.current;
    previous.current = progression;

    const next = LEVELS.map((value, index) => {
      const stored = rows[index];
      const row: Record<string, unknown> = stored && typeof stored === "object" ? { ...stored } : blankLevelRow(value);
      row.level = value;
      // Never an input, never trusted from the wire: exactly 2 + floor((L-1)/4).
      row.proficiencyBonus = proficiencyBonusForLevel(value);
      if (!Array.isArray(row.features)) row.features = [];
      if (!Array.isArray(row.classResources)) row.classResources = [];

      const before = generateFor(value, wasProgression, classId);
      const now = generated[index];
      const followed = sameSlots(stored?.spellSlots, before.spellSlots) && samePact(stored?.pactSlots, before.pactSlots);
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
    // `draft`/`onDraft` are deliberately absent: this must run when the SETTINGS change,
    // not on every keystroke anywhere else in the record, or it would fight the editor.
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
    return !sameSlots(row.spellSlots, generated[index].spellSlots) || !samePact(row.pactSlots, generated[index].pactSlots);
  };

  const slotText = (index: number): { text: string; label: string } => {
    const row = rows[index];
    if (!row) return { text: "—", label: "No spell slots" };
    if (row.pactSlots) {
      const ordinal = ORDINALS[row.pactSlots.level - 1] ?? `${row.pactSlots.level}th`;
      return {
        text: `${row.pactSlots.slots} × ${ordinal}`,
        label: `${row.pactSlots.slots} pact ${row.pactSlots.slots === 1 ? "slot" : "slots"} of ${ordinal} level`
      };
    }
    if (!row.spellSlots) return { text: "—", label: "No spell slots" };
    return {
      text: row.spellSlots.map((count) => (count === 0 ? "–" : String(count))).join(" "),
      label: describeSlots(row.spellSlots)
    };
  };

  const featureText = (index: number) => {
    const ids = rows[index]?.features ?? [];
    if (ids.length === 0) return "—";
    return ids.map((id) => featureName.get(id) ?? id).join(", ");
  };

  const resourceText = (index: number) => {
    const list = rows[index]?.classResources ?? [];
    if (list.length === 0) return "—";
    return list.map((resource) => `${resource.name || resource.id} ×${resource.amount}`).join(", ");
  };

  const placed = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) for (const id of row.features ?? []) ids.add(id);
    return ids.size;
  }, [rows]);

  const shown = narrow && !showAll ? [level - 1] : LEVELS.map((_, index) => index);

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
        <span className="hb-lt-cell hb-lt-slots">
          <span className="hb-lt-micro">Spell slots</span>
          {/* `4 3 3 2 – – – – –` is nine columns collapsed into one, so the spelled-out
              reading is the only one a screen reader can use. It is REAL TEXT in a
              visually hidden span, not an `aria-label`: an aria-label on a roleless
              <span> is ignored by the accessible-name computation entirely (name from
              author is only honoured on elements that take one), so the label was being
              dropped and the announcement was the glyph row. */}
          <span className="tabular hb-lt-derived" aria-hidden="true">{slots.text}</span>
          <span className="nh-sr-only">{slots.label}</span>
          {overridden && <Badge tone="caution">Overridden</Badge>}
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
        <span className="hb-lt-cell hb-lt-num">
          <span className="hb-lt-micro">Cantrips</span>
          <NumberField
            value={row.cantripsKnown ?? null}
            min={0}
            max={10}
            placeholder="—"
            onChange={(next) => writeRow(index, { cantripsKnown: next ?? undefined })}
          />
        </span>
        <span className="hb-lt-cell hb-lt-num">
          <span className="hb-lt-micro">Prepared</span>
          <NumberField
            value={row.preparedCount ?? null}
            min={0}
            max={60}
            placeholder="—"
            onChange={(next) => writeRow(index, { preparedCount: next ?? undefined })}
          />
        </span>
        <span className="hb-lt-cell hb-lt-derived hb-lt-wrapcell">
          <span className="hb-lt-micro">Resources</span>
          {resourceText(index)}
        </span>

        {editing && (
          <div className="hb-lt-strip">
            {progression === undefined ? (
              <p className="nh-field-help">This class has no spellcasting, so it has no slots to override. Turn on a caster progression above first.</p>
            ) : progression === "pact" ? (
              /* Both halves fall back to the GENERATED value, not to zero. Clearing one
                 field used to write `{ level: 1, slots: 0 }` — a silently zeroed row that
                 still read as an override. Recovering to the derived number is the only
                 answer that can't quietly break a class. */
              <FieldGrid min="8rem">
                <label className="nh-field">
                  <span className="nh-field-label">Pact slot level</span>
                  <NumberField
                    value={row.pactSlots?.level ?? null}
                    min={1}
                    max={9}
                    onChange={(next) =>
                      writeRow(index, {
                        pactSlots: next == null ? undefined : { level: next, slots: row.pactSlots?.slots ?? generated[index].pactSlots?.slots ?? 1 }
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
                        pactSlots: next == null ? undefined : { level: row.pactSlots?.level ?? generated[index].pactSlots?.level ?? 1, slots: next }
                      })
                    }
                  />
                </label>
              </FieldGrid>
            ) : (
              <div className="hb-lt-slotstrip" role="group" aria-label={`Spell slots at level ${value}`}>
                {ORDINALS.map((ordinal, slot) => (
                  <label key={ordinal} className="hb-lt-slotfield">
                    <span className="nh-field-label">{ordinal}</span>
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
                onClick={() => writeRow(index, { spellSlots: generated[index].spellSlots, pactSlots: generated[index].pactSlots })}
              >
                Reset to default
              </Button>
            )}

            <div className="hb-lt-resources">
              <span className="nh-field-label">Class resources</span>
              {/* Shown on the level table only. For a pool the game tracks, give a
                  feature limited uses instead. */}
              <p className="nh-field-help">
                <em className="hb-note">Shown on the level table only. For a pool the game tracks, give a feature limited uses instead.</em>
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
                          const list = (row.classResources ?? []).map((entry, i) => (i === resourceIndex ? { ...entry, name: event.target.value } : entry));
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
                          // A resource amount is a number OR a dice string ("3d6"), so
                          // the field stays text and only coerces when it is all digits.
                          const amount = /^\d+$/.test(raw) ? Number(raw) : raw;
                          const list = (row.classResources ?? []).map((entry, i) => (i === resourceIndex ? { ...entry, amount } : entry));
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
      {/* The constraint, stated ONCE for the whole table rather than once per derived cell. */}
      <p className="nh-field-help">
        Proficiency bonus, features and spell slots are calculated. Override a row if your class breaks the pattern.
      </p>
      <p className="hb-lt-summary">
        <strong className="tabular">20 levels</strong> &middot; {progressionWord} &middot;{" "}
        <strong className="tabular">{placed}</strong> {placed === 1 ? "feature" : "features"} placed
      </p>

      {narrow && !showAll && (
        <Stepper value={level} onChange={setLevel} min={1} max={20} label="Level" announceValue />
      )}

      <div className="hb-lt-scroll">
        <div className="hb-lt-table" role="group" aria-label="Level table">
          <div className="hb-lt-head" aria-hidden="true">
            <span>Level</span>
            <span>Bonus</span>
            <span>Features</span>
            <span>Spell slots</span>
            <span>Cantrips</span>
            <span>Prepared</span>
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
