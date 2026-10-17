import { useState, type ReactNode } from "react";
import { type DeathSaveResult, type DeathSaves } from "@vtt/domain";
import { command } from "../lib/command";
import { RollControls, type DieMode } from "./RollControls";
import "./dying-tracker.css";

type DeathPreview = NonNullable<DeathSaveResult["deathSave"]>;

/**
 * A dying character's death-save tracker (ADR-0020): success/failure pips plus the roll, via the
 * shared RollControls (roll, see projected pips, confirm; Adv/Disadv; or a typed d20). In auto
 * mode it rolls when the creature's turn comes up (5e: death saves at the start of the turn).
 */
export function DyingTracker({
  actorId,
  name,
  deathSaves,
  canRoll,
  onFeedback,
  rollMode,
  isActingTurn,
  aid
}: Readonly<{
  actorId: string;
  name: string;
  deathSaves: DeathSaves;
  canRoll: boolean;
  onFeedback: (text: string) => void;
  rollMode: "auto" | "manual";
  isActingTurn: boolean;
  /** What someone else can do for the creature while it is dying (stabilize it). */
  aid?: ReactNode;
}>) {
  const [busy, setBusy] = useState(false);
  // A rolled-but-unapplied preview; Confirm applies the pips.
  const [rolled, setRolled] = useState<DeathPreview | null>(null);
  const dead = deathSaves.failures >= 3;
  const send = (commit: boolean, extra: { rollMode?: DieMode; naturalRoll?: number }) => {
    setBusy(true);
    void command("death-save:roll", { actorId, commit, ...extra }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The death save failed.");
        return;
      }
      const outcome = result.deathSave;
      if (!outcome) return;
      if (!outcome.committed) {
        setRolled(outcome);
        return;
      }
      setRolled(null);
      onFeedback(
        outcome.regainedConsciousness
          ? `${name} rolled a natural 20 and regains 1 HP!`
          : outcome.dead
            ? `${name} died.`
            : outcome.stable
              ? `${name} is stable.`
              : `${name}: ${outcome.successes} successes, ${outcome.failures} failures.`
      );
    });
  };
  const passed = rolled?.outcome === "success" || rolled?.outcome === "critical-success";
  return (
    <div className="dying-tracker" role="group" aria-label={`Death saves for ${name}`}>
      <span className={`dying-label${dead ? " dead" : ""}`}>
        {dead ? "Dead" : deathSaves.stable ? "Stable" : "Dying"}
      </span>
      <span className="dying-pips" aria-label={`${deathSaves.successes} successes, ${deathSaves.failures} failures`}>
        {[0, 1, 2].map((index) => (
          <span key={`s${index}`} className={`pip success${index < deathSaves.successes ? " filled" : ""}`} />
        ))}
        <span className="pip-divider" />
        {[0, 1, 2].map((index) => (
          <span key={`f${index}`} className={`pip failure${index < deathSaves.failures ? " filled" : ""}`} />
        ))}
      </span>
      {canRoll && !deathSaves.stable && !dead && (
        <RollControls
          rollMode={rollMode}
          autoRoll={rollMode === "auto" && isActingTurn}
          busy={busy}
          rolled={rolled !== null}
          currentMode={rolled?.rollMode}
          manualPlaceholder="or type the d20"
          manualLabel="Death save d20"
          manualMin={1}
          manualMax={20}
          onInvalidManual={onFeedback}
          onRoll={(mode) => send(false, mode ? { rollMode: mode } : {})}
          onManual={(natural) => send(true, { naturalRoll: natural })}
          onConfirm={() => rolled && send(true, { naturalRoll: rolled.naturalRoll })}
          onReroll={() => setRolled(null)}
          summary={
            rolled ? (
              <>
                <strong className={passed ? "save-pass" : "save-fail"}>
                  Rolled {rolled.naturalRoll}
                  {rolled.rollMode ? ` (${rolled.rollMode === "advantage" ? "adv" : "disadv"})` : ""} -{" "}
                  {rolled.regainedConsciousness
                    ? "Natural 20!"
                    : rolled.naturalRoll === 1
                      ? "Natural 1"
                      : passed
                        ? "Success"
                        : "Failure"}
                </strong>
                <span className="save-prompt-effect">
                  {rolled.dead
                    ? "dies"
                    : rolled.stable
                      ? "stabilizes"
                      : rolled.regainedConsciousness
                        ? "back up at 1 HP"
                        : `${rolled.successes}S / ${rolled.failures}F`}
                </span>
              </>
            ) : undefined
          }
        />
      )}
      {!deathSaves.stable && !dead && aid}
    </div>
  );
}
