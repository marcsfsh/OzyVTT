import { useState, type ReactNode } from "react";
import { type DeathSaveResult, type DeathSaves } from "@vtt/domain";
import { command } from "../lib/command";
import { RollControls, type DieMode } from "./RollControls";
import { modeWords } from "./roll-mode-notes";
import "./dying-tracker.css";

type DeathPreview = NonNullable<DeathSaveResult["deathSave"]>;

/**
 * A dying character's death-save tracker (ADR-0020): success/failure pips plus the roll, via the
 * shared RollControls (roll or type the d20, see the projected pips, confirm). The server holds the
 * die, so Confirm applies the one shown; only Heroic Inspiration or the GM throws it again. In auto
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
  viewer,
  inspired = false,
  rollLabel,
  aid
}: Readonly<{
  actorId: string;
  name: string;
  deathSaves: DeathSaves;
  canRoll: boolean;
  onFeedback: (text: string) => void;
  rollMode: "auto" | "manual";
  isActingTurn: boolean;
  /** The GM may force a mode and reroll freely; a player rerolls with Heroic Inspiration. */
  viewer: "gm" | "player";
  /** The dying character holds Heroic Inspiration. */
  inspired?: boolean;
  /** What the roll button says ("Roll death save"). */
  rollLabel?: ReactNode;
  /** What someone else can do for the creature while it is dying (stabilize it). */
  aid?: ReactNode;
}>) {
  const [busy, setBusy] = useState(false);
  // A rolled-but-unapplied preview; Confirm applies the pips.
  const [rolled, setRolled] = useState<DeathPreview | null>(null);
  // The GM's forced mode, sent with every later look at the held die so Confirm reads it the same way.
  const [forced, setForced] = useState<DieMode | undefined>(undefined);
  const [typed, setTyped] = useState(false);
  const dead = deathSaves.failures >= 3;
  const send = (commit: boolean, extra: Readonly<{ naturalRoll?: number; reroll?: boolean; mode?: DieMode }> = {}) => {
    setBusy(true);
    const mode = "mode" in extra ? extra.mode : forced;
    void command("death-save:roll", {
      actorId,
      commit,
      ...(mode ? { rollMode: mode } : {}),
      ...(extra.naturalRoll !== undefined ? { naturalRoll: extra.naturalRoll } : {}),
      ...(extra.reroll ? { reroll: true } : {})
    }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The death save failed.");
        return;
      }
      const outcome = result.deathSave;
      if (!outcome) return;
      if (!outcome.committed) {
        // A typed die stays typed until a reroll the server throws (the GM's) replaces it.
        if (extra.naturalRoll !== undefined) setTyped(true);
        else if (extra.reroll) setTyped(false);
        setRolled(outcome);
        return;
      }
      setRolled(null);
      setTyped(false);
      onFeedback(
        outcome.regainedConsciousness
          ? `${name} rolled a natural 20 and regains 1 HP.`
          : outcome.dead
            ? `${name} died.`
            : outcome.stable
              ? `${name} is stable.`
              : `${name}: ${outcome.successes} successes, ${outcome.failures} failures.`
      );
    });
  };
  const passed = rolled?.outcome === "success" || rolled?.outcome === "critical-success";
  // The total shows only when something added to the die (Bless, an aura).
  const total = rolled && rolled.total !== undefined && rolled.total !== rolled.naturalRoll ? rolled.total : null;
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
          viewer={viewer}
          inspired={inspired}
          typed={typed}
          currentMode={forced}
          faceLabel="Death save d20"
          {...(rollLabel !== undefined ? { rollLabel } : {})}
          onInvalidFace={onFeedback}
          onRoll={() => send(false)}
          onTyped={(face) => send(false, { naturalRoll: face })}
          onConfirm={() => send(true)}
          onReroll={(face) => send(false, { reroll: true, ...(face !== undefined ? { naturalRoll: face } : {}) })}
          onForce={(mode) => {
            const next = mode === "normal" ? undefined : mode;
            setForced(next);
            send(false, { mode: next });
          }}
          summary={
            rolled ? (
              <>
                <strong className={passed ? "save-pass" : "save-fail"}>
                  Rolled {rolled.naturalRoll}
                  {total !== null ? ` (total ${total})` : ""}
                  {modeWords(rolled.rollModeSources)} -{" "}
                  {rolled.regainedConsciousness
                    ? "Natural 20"
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
