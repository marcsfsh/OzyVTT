import { useId, type ReactNode } from "react";
import { cx } from "./util";
import { Alert } from "./Alert";
import { Badge } from "./Badge";
import { Meter } from "./Meter";
import { Select } from "./forms";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import { Stepper } from "./Stepper";
import "./AbilityScoreAllocator.css";

/** How the six scores are entered. `assign` hands out values from a fixed pool
    (standard array, 4d6-drop-lowest, any GM formula that produces six numbers);
    `spend` nudges each score against a shared budget (point buy). Two interactions
    cover all four methods — a third would just be a second way to say the same. */
export type AbilityAllocationMode = "assign" | "spend";

export interface AbilityPoolValue {
  id: string;
  value: number;
  /** Ability id this value is currently assigned to, if any. */
  assignedTo?: string | null;
}

export interface AbilityRowData {
  id: string;
  /** Full name, e.g. "Strength" — the accessible name for the row's control. */
  label: string;
  /** Three-letter form for the compact column, e.g. "STR". */
  abbr: string;
  /** Base score before bonuses. `null` = not assigned yet. */
  score: number | null;
  /** Species / background / feat bonus applied on top. */
  bonus?: number;
  /** Final score and modifier, computed by @vtt/rules-5e — never derived here. */
  total: number | null;
  modifier: number | null;
  /** Bounds for the spend-mode stepper. */
  min?: number;
  max?: number;
  /** Why this row can't move right now (all remaining points spent, locked by a feat…). */
  note?: ReactNode;
  disabled?: boolean;
}

export interface AbilityScoreAllocatorProps {
  mode: AbilityAllocationMode;
  rows: readonly AbilityRowData[];

  /** The allowed methods (the GM picks these — decision 10). Omit to hide the switch. */
  methods?: readonly SegmentedOption[];
  method?: string;
  onMethodChange?: (method: string) => void;
  /** One line explaining the current method, e.g. the custom formula. */
  methodHint?: ReactNode;

  /** assign mode: the values still to hand out. */
  pool?: readonly AbilityPoolValue[];
  /** assign mode: `poolId` is null when the row is being cleared. */
  onAssign?: (abilityId: string, poolId: string | null) => void;

  /** spend mode: the new base score for that ability. */
  onScoreChange?: (abilityId: string, score: number) => void;
  /** spend mode: the shared budget readout. */
  budget?: { spent: number; total: number; label?: ReactNode };

  /** Controls above the table — a `DiceInputRow` for 4d6, a formula field for custom. */
  toolbar?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

const signed = (value: number | null) => value == null ? "—" : value === 0 ? "±0" : value > 0 ? `+${value}` : `−${Math.abs(value)}`;
const plain = (value: number | null) => value == null ? "—" : String(value);

/** The ability-score step: one component behind all four generation methods
    (standard array, point buy, 4d6-drop-lowest, GM custom formula).

    Assignment is a per-ability `<Select>`, not drag-and-drop. Dragging a value onto
    a row is the obvious mouse gesture and a dead end on a phone, and a drag plus a
    fallback would be two ways to say one thing. A select is one gesture that works
    with a finger, a mouse, and a screen reader.

    Everything numeric renders in the mono face with `.tabular`, so base / bonus /
    total / modifier line up as they change. This component is pure presentation: it
    computes no scores, costs, or modifiers — those come from `@vtt/rules-5e` as
    props, together with the callbacks that change them. */
export function AbilityScoreAllocator({
  mode, rows, methods, method, onMethodChange, methodHint,
  pool, onAssign, onScoreChange, budget, toolbar,
  disabled = false, ariaLabel = "Ability scores", className
}: AbilityScoreAllocatorProps) {
  const tableId = useId();
  const unassigned = (pool ?? []).filter((entry) => !entry.assignedTo);
  const overspent = budget != null && budget.spent > budget.total;

  return (
    <section className={cx("nh-abil", className)} aria-label={ariaLabel}>
      {(methods && method != null && onMethodChange) || methodHint != null ? (
        <div className="nh-abil-method">
          {methods && method != null && onMethodChange && (
            <SegmentedControl ariaLabel="Ability score method" options={[...methods]} value={method} onChange={onMethodChange} />
          )}
          {methodHint != null && <p className="nh-abil-hint">{methodHint}</p>}
        </div>
      ) : null}

      {toolbar != null && <div className="nh-abil-toolbar">{toolbar}</div>}

      {mode === "assign" && pool != null && (
        <div className="nh-abil-pool">
          <span className="nh-abil-pool-label">Still to assign</span>
          <div className="nh-abil-pool-values">
            {unassigned.length === 0
              ? <span className="nh-abil-pool-done">All assigned</span>
              : unassigned.map((entry) => <Badge key={entry.id} tone="info"><span className="tabular">{entry.value}</span></Badge>)}
          </div>
        </div>
      )}

      {budget != null && (
        <div className="nh-abil-budget">
          <Meter
            value={Math.max(0, budget.total - budget.spent)}
            max={budget.total}
            /* Overspent CLAMPS the value to 0, so this tone paints a zero-width fill and is never
               seen. Left as-is deliberately: churning a token that renders nothing is noise. */
            tone={overspent ? "magenta" : "cyan"}
            label={budget.label ?? "Points remaining"}
          />
          {/* CAUTION, not danger: rose-red is damage and destruction (§2), and an over-budget spread
              is simply not finished. The Alert owns the FACT; the flow's footer owns the fix, so the
              two no longer print the same instruction one above the other. */}
          {overspent && <Alert tone="warning" title="Over budget">You have spent {budget.spent} of {budget.total} points.</Alert>}
        </div>
      )}

      <div className="nh-abil-table" role="group" aria-label={ariaLabel} id={tableId}>
        <div className="nh-abil-head" aria-hidden="true">
          <span>Ability</span>
          <span>{mode === "assign" ? "Assigned" : "Score"}</span>
          <span>Bonus</span>
          <span>Total</span>
          <span>Mod</span>
        </div>

        {rows.map((row) => {
          const assigned = (pool ?? []).find((entry) => entry.assignedTo === row.id);
          const rowDisabled = disabled || row.disabled === true;
          const outcomeId = `${tableId}-${row.id}-outcome`;
          return (
            <div key={row.id} className="nh-abil-row">
              <span className="nh-abil-name">
                <span className="nh-abil-abbr">{row.abbr}</span>
                <span className="nh-abil-full">{row.label}</span>
              </span>

              <span className="nh-abil-cell nh-abil-cell--control">
                <span className="nh-abil-cell-label" aria-hidden="true">{mode === "assign" ? "Assigned" : "Score"}</span>
                {mode === "assign" ? (
                  <Select
                    className="nh-abil-select tabular"
                    aria-label={`${row.label} score`}
                    aria-describedby={outcomeId}
                    disabled={rowDisabled || onAssign == null}
                    value={assigned?.id ?? ""}
                    onChange={(event) => onAssign?.(row.id, event.target.value === "" ? null : event.target.value)}
                  >
                    <option value="">—</option>
                    {assigned && <option value={assigned.id}>{assigned.value}</option>}
                    {unassigned.map((entry) => <option key={entry.id} value={entry.id}>{entry.value}</option>)}
                  </Select>
                ) : (
                  <Stepper
                    value={row.score ?? 0}
                    min={row.min}
                    max={row.max}
                    disabled={rowDisabled || onScoreChange == null}
                    aria-label={`${row.label} score`}
                    aria-describedby={outcomeId}
                    onChange={(next) => onScoreChange?.(row.id, next)}
                  />
                )}
              </span>

              <span className="nh-abil-cell">
                <span className="nh-abil-cell-label" aria-hidden="true">Bonus</span>
                <span className="nh-abil-num tabular">{row.bonus ? signed(row.bonus) : "—"}</span>
              </span>

              <span className="nh-abil-cell">
                <span className="nh-abil-cell-label" aria-hidden="true">Total</span>
                <span className="nh-abil-num nh-abil-num--total tabular">{plain(row.total)}</span>
              </span>

              <span className="nh-abil-cell">
                <span className="nh-abil-cell-label" aria-hidden="true">Mod</span>
                <span className="nh-abil-num nh-abil-num--mod tabular">{signed(row.modifier)}</span>
              </span>

              {row.note != null && <span className="nh-abil-note">{row.note}</span>}

              {/* The row's outcome, described to its control. A screen-reader user
                  hears "Strength score, 15, total 17, modifier +3" on focus — no
                  six-way live region shouting over every keystroke. */}
              <span className="nh-sr-only" id={outcomeId}>
                Total {plain(row.total)}, modifier {signed(row.modifier)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
