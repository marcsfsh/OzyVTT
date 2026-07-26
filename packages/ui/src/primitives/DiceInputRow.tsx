import { useState, type ReactNode } from "react";
import { cx } from "./util";
import { Button } from "./Button";
import { Input } from "./forms";
import { IconDie } from "./icons";
import { SegmentedControl } from "./SegmentedControl";
import "./DiceInputRow.css";

export type DiceEntryMode = "auto" | "manual";

export interface DiceInputRowProps {
  /** What is being rolled, e.g. "Hit points (level 4)". */
  label?: ReactNode;
  /** The notation, shown in mono: "4d6 drop lowest", "1d10". */
  notation?: ReactNode;
  mode: DiceEntryMode;
  onModeChange: (mode: DiceEntryMode) => void;
  /** "Roll it for me". The caller owns the roll — this control never rolls dice. */
  onRoll: () => void;
  /** "I rolled it myself": a validated integer within [min, max]. */
  onManual: (total: number) => void;
  /** Discard the current result and start over. Hidden when absent. */
  onReroll?: () => void;
  /** The result line (a total, a set of six values, a formatted breakdown). */
  result?: ReactNode;
  rollLabel?: string;
  manualLabel?: string;
  manualPlaceholder?: string;
  rerollLabel?: string;
  min?: number;
  max?: number;
  busy?: boolean;
  hint?: ReactNode;
  className?: string;
}

/** The manual-vs-auto roll control for everything OUTSIDE combat: ability
    generation, starting HP, starting gold.

    It deliberately speaks the same two-mode vocabulary as the encounter's
    RollControls — "roll it for me" or type what your physical dice showed — so a
    player who has rolled once anywhere knows how to roll everywhere. It shares no
    state with combat: no roll mode, no prompt, no encounter. The caller owns the
    roll (the server owns any roll that matters) and passes the result back in. */
export function DiceInputRow({
  label, notation, mode, onModeChange, onRoll, onManual, onReroll, result,
  rollLabel = "Roll it for me", manualLabel = "Rolled total", manualPlaceholder = "Type the total",
  rerollLabel = "Roll again", min = 1, max = 100, busy = false, hint, className
}: DiceInputRowProps) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const total = Number(typed.trim());
    if (!Number.isInteger(total) || total < min || total > max) {
      setError(`Enter the rolled total (${min} to ${max}).`);
      return;
    }
    setError(null);
    setTyped("");
    onManual(total);
  };

  return (
    <div className={cx("nh-diceinput", className)}>
      <div className="nh-diceinput-head">
        {label != null && <span className="nh-diceinput-label">{label}</span>}
        {notation != null && <span className="nh-diceinput-notation tabular">{notation}</span>}
        <SegmentedControl
          size="sm"
          className="nh-diceinput-mode"
          ariaLabel="How to roll"
          value={mode}
          onChange={(next) => { setError(null); onModeChange(next as DiceEntryMode); }}
          options={[
            { value: "auto", label: "Roll for me" },
            { value: "manual", label: "I rolled it" }
          ]}
        />
      </div>

      <div className="nh-diceinput-row">
        {mode === "auto" ? (
          <Button variant="primary" onClick={onRoll} disabled={busy}>
            <span className="nh-diceinput-die" aria-hidden="true"><IconDie /></span>
            {rollLabel}
          </Button>
        ) : (
          <>
            <Input
              className="nh-diceinput-field tabular"
              type="text"
              inputMode="numeric"
              pattern="-?[0-9]*"
              value={typed}
              placeholder={manualPlaceholder}
              aria-label={manualLabel}
              aria-invalid={error != null || undefined}
              disabled={busy}
              onChange={(event) => { setTyped(event.target.value); if (error) setError(null); }}
              onKeyDown={(event) => { if (event.key === "Enter" && typed.trim() !== "") { event.preventDefault(); submit(); } }}
            />
            <Button variant="primary" onClick={submit} disabled={busy || typed.trim() === ""}>Apply</Button>
          </>
        )}
        {result != null && <span className="nh-diceinput-result tabular" role="status">{result}</span>}
        {onReroll && result != null && <Button variant="secondary" onClick={onReroll} disabled={busy}>{rerollLabel}</Button>}
      </div>

      {error != null
        ? <p className="nh-diceinput-error" role="alert"><span aria-hidden="true">⚠</span> {error}</p>
        : hint != null ? <p className="nh-diceinput-hint">{hint}</p> : null}
    </div>
  );
}
