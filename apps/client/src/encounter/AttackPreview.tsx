import { useState } from "react";
import type { ActionResolution } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { DieModeButtons, type DieMode } from "./RollControls";
import type { ResolveOptions } from "./targeting";

type Attack = NonNullable<ActionResolution["attack"]>;

/**
 * The attack's result line: total against AC, the outcome, the natural die and the target. A player
 * never sees an AC, so an attack the server could not judge reads as a hit for them.
 */
export function AttackOutcome({ attack, audience }: Readonly<{ attack: Attack; audience: "gm" | "player" }>) {
  return (
    <p className={`action-outcome outcome-${attack.outcome}`}>
      {attack.total}
      {attack.targetAc !== null ? ` vs AC ${attack.targetAc}` : ""} -{" "}
      {attack.outcome === "crit"
        ? "CRITICAL HIT"
        : attack.outcome === "fumble"
          ? "NATURAL 1"
          : attack.outcome === "unknown"
            ? audience === "gm"
              ? "no AC on record"
              : "HIT"
            : attack.outcome.toUpperCase()}
      {attack.naturalRoll >= 1 ? ` (nat ${attack.naturalRoll})` : ""} vs {attack.targetName}
    </p>
  );
}

/**
 * An attack previewed but not yet applied: Adv/Disadv and Re-roll roll the d20 again, Confirm resolves
 * the hit for real (damage, riders, economy). In manual roll mode a second zone takes a typed d20, or
 * the final total with a Natural 20 box when typed bonuses are not added for you.
 */
export function AttackPreview({
  attack,
  mode,
  busy,
  rollMode,
  bonusMode,
  onFeedback,
  resolve
}: Readonly<{
  attack: Attack;
  /** The die mode the shown roll used. */
  mode?: DieMode;
  busy: boolean;
  rollMode: "auto" | "manual";
  /** "total": the typed number is the final total, so a crit must be declared. */
  bonusMode: "auto" | "total";
  onFeedback: (text: string) => void;
  resolve: (options: ResolveOptions) => void;
}>) {
  const [entry, setEntry] = useState("");
  // Whether the typed roll has been submitted: drives "Use roll" → Confirm/Re-roll.
  const [submitted, setSubmitted] = useState(false);
  // In "final total" mode a natural 20 cannot be read off the number, so it is declared here.
  const [natural20, setNatural20] = useState(false);
  // Whether the shown preview came from a typed total, so Confirm re-sends the inputs that made it.
  const [fromTotal, setFromTotal] = useState(false);
  const manualEntry = rollMode === "manual";
  const totalMode = bonusMode === "total";
  // Any auto control abandons a pending manual entry.
  const autoPreview = (options: ResolveOptions) => {
    setFromTotal(false);
    setSubmitted(false);
    resolve(options);
  };
  const submitEntry = () => {
    const value = Number(entry.trim());
    if (
      totalMode
        ? !Number.isInteger(value) || value < -50 || value > 100
        : !Number.isInteger(value) || value < 1 || value > 20
    ) {
      onFeedback(totalMode ? "Enter your final attack total." : "Enter the attack d20 (1-20).");
      return;
    }
    setFromTotal(totalMode);
    setSubmitted(true);
    resolve(
      totalMode ? { commit: false, attackTotal: value, critical: natural20 } : { commit: false, attackNatural: value }
    );
  };
  const confirmEntry = () =>
    resolve(
      totalMode
        ? { commit: true, attackTotal: Number(entry.trim()), critical: natural20 }
        : { commit: true, attackNatural: Number(entry.trim()) }
    );
  // Confirm the shown preview with the inputs that produced it.
  const confirmShown = () =>
    fromTotal
      ? resolve({ commit: true, attackTotal: Number(entry.trim()), critical: natural20 })
      : resolve({ commit: true, attackNatural: attack.naturalRoll });
  return (
    <div className="action-preview">
      <div className="roll-zone">
        <span className="save-prompt-confirm">
          <DieModeButtons
            current={mode}
            disabled={busy}
            onPick={(picked) => autoPreview({ commit: false, rollMode: picked })}
          />
          <button type="button" className="encounter-primary" disabled={busy} onClick={confirmShown}>
            Confirm{" "}
            {attack.outcome === "crit"
              ? "crit"
              : attack.outcome === "hit" || attack.outcome === "unknown"
                ? "hit"
                : "miss"}
          </button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            title="Roll the attack again"
            onClick={() => autoPreview({ commit: false })}
          >
            Re-roll
          </Button>
        </span>
        {manualEntry && <span className="roll-zone-caption">auto-roll</span>}
      </div>
      {manualEntry && (
        <>
          <div className="roll-or">
            <span>or</span>
          </div>
          <div className="roll-zone">
            <span className="roll-zone-caption">manual entry</span>
            <span className="save-prompt-manual">
              <input
                type="text"
                inputMode="numeric"
                pattern={totalMode ? undefined : "[0-9]*"}
                placeholder={totalMode ? "type your total" : "type the d20"}
                aria-label={totalMode ? "Attack total" : "Attack d20"}
                value={entry}
                disabled={submitted}
                onChange={(event) => setEntry(event.target.value.replace(totalMode ? /[^0-9-]/g : /[^0-9]/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !submitted && entry.trim() !== "") submitEntry();
                }}
              />
              {totalMode && (
                <label className="manual-nat20">
                  <input
                    type="checkbox"
                    checked={natural20}
                    disabled={submitted}
                    onChange={(event) => setNatural20(event.target.checked)}
                  />{" "}
                  Natural 20
                </label>
              )}
              {/* "Use roll" sits on its own row under the field; once used it becomes Confirm/Re-roll. */}
              <span className="manual-actions">
                {submitted ? (
                  <>
                    <button type="button" className="encounter-primary" disabled={busy} onClick={confirmEntry}>
                      Confirm roll
                    </button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      title={totalMode ? "Enter a different total" : "Enter a different d20"}
                      onClick={() => {
                        setEntry("");
                        setSubmitted(false);
                        setNatural20(false);
                      }}
                    >
                      Re-roll
                    </Button>
                  </>
                ) : (
                  <button type="button" disabled={busy || entry.trim() === ""} onClick={submitEntry}>
                    Use roll
                  </button>
                )}
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
