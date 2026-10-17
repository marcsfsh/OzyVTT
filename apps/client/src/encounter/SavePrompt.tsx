import { useEffect, useRef, useState } from "react";
import { type ActionRollMode, type PendingSave, type PlayerPendingSave } from "@vtt/domain";
import { useRollPreference } from "../dice/roll-preference";
import { command } from "../lib/command";
import { RollControls, type DieMode } from "./RollControls";
import { damageAdjustments } from "./format";
import { modeWords } from "./roll-mode-notes";
import { saveAnswerPayload, saveDamageAmend } from "./save-answer";
import "./prompts.css";

/**
 * Debounce before the save prompt re-asks the server what an amended damage would apply
 * (`SavePrompt`): long enough that typing "12" is one request, short enough to finish before a
 * thumb reaches Confirm. Nothing is written by the recheck.
 */
const RECHECK_AMEND_MS = 350;

/**
 * A saving throw a combatant still owes, inside its initiative row. Roll = the server throws the d20,
 * or takes the face a physical die shows, and adds the save's bonus; it holds the die, so Confirm
 * applies the die shown. The outcome applies server-side (fail: damage + condition; success: half or
 * none) and the prompt clears.
 *
 * The damage field is editable: pre-filled in auto mode, empty with the rolled number as its
 * placeholder in manual mode. It holds the proposal before halving (`damageOverride` is applied
 * before the success halving), hence the label "Damage on a failure". The server allows a player
 * to amend only their own character's save.
 *
 * An amend typed after the roll invalidates the server's projection, so the prompt re-sends
 * Confirm's own payload with `commit: false` after a short pause and shows the server's answer.
 * Halving is per typed part and floored, differs by save outcome, and then runs through the
 * target's defences, so it is not reimplemented here: the line prints what Confirm will land.
 */
export function SavePrompt({
  save,
  targetName,
  canDismiss,
  onFeedback,
  rollMode,
  viewer,
  inspired = false,
  legendaryResistanceLeft
}: Readonly<{
  save: PendingSave | PlayerPendingSave;
  targetName: string;
  canDismiss: boolean;
  onFeedback: (text: string) => void;
  rollMode: "auto" | "manual";
  /** The GM may force a mode and reroll freely; a player rerolls with Heroic Inspiration. */
  viewer: "gm" | "player";
  /** The saving character holds Heroic Inspiration. */
  inspired?: boolean;
  /** Remaining Legendary Resistance uses (GM view of a legendary target only) - offers "succeed instead" after a previewed failure. */ legendaryResistanceLeft?: number;
}>) {
  const [busy, setBusy] = useState(false);
  // A player's typed damage stands in for dice, so it follows the table's setting for typed dice.
  const { mayType } = useRollPreference();
  // A rolled-but-not-applied result: the server records the die and returns the projected outcome,
  // shown until the answerer confirms. `basis` is the pre-halving damage that preview used, so a later
  // amend is detectable; `defences` says what resistances and the like did to it.
  const [rolled, setRolled] = useState<{
    total: number;
    natural?: number;
    success: boolean;
    damage: number;
    defences: string;
    condition: boolean;
    rollMode?: ActionRollMode;
    autoFailed?: boolean;
    autoSucceeded?: string;
    basis: number;
  } | null>(null);
  // The GM's forced mode, sent with every later look at the held die so Confirm reads it the same way.
  const [forced, setForced] = useState<DieMode | undefined>(undefined);
  // The shown die was typed from a physical die, so a reroll is typed too.
  const [typed, setTyped] = useState(false);
  // null = untouched: the field falls back to the proposal (auto) or nothing (manual).
  const [damageEdit, setDamageEdit] = useState<string | null>(null);
  // The background recheck of an amend typed after the roll: `pending` while out, `failed` after a
  // refusal, which stops the loop and drops "checking" from the line. Further typing resets to `idle`.
  const [recheck, setRecheck] = useState<"idle" | "pending" | "failed">("idle");
  const damageOverride = saveDamageAmend(save.proposedDamage, damageEdit);
  const proposal = damageOverride ?? save.proposedDamage;
  // A committed answer unmounts this prompt, so an in-flight recheck must not report afterwards. The
  // flag is re-armed in the effect body because StrictMode's mount → cleanup → mount would otherwise
  // leave it false and swallow every recheck.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Read through a ref so a parent passing a fresh closure each render cannot restart the timer.
  const feedbackRef = useRef(onFeedback);
  feedbackRef.current = onFeedback;
  // Outcome feedback goes to the parent, since committing unmounts this prompt. Every send reads the held die, or
  // throws it the first time; `face` is a typed die and `reroll` throws it again.
  const send = (
    options: Readonly<{
      commit: boolean;
      face?: number;
      reroll?: boolean;
      legendaryResistance?: boolean;
      mode?: DieMode;
    }>
  ) => {
    setBusy(true);
    const mode = "mode" in options ? options.mode : forced;
    // The amend rides every send (preview, Confirm, Legendary Resistance).
    void command(
      "save:answer",
      saveAnswerPayload({
        saveId: save.id,
        method: "roll",
        commit: options.commit,
        legendaryResistance: options.legendaryResistance ?? false,
        ...(options.face !== undefined ? { face: options.face } : {}),
        ...(options.reroll ? { reroll: true } : {}),
        ...(mode ? { dieMode: mode } : {}),
        ...(damageOverride !== undefined ? { damageOverride } : {})
      })
    ).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The saving throw could not be answered.");
        return;
      }
      const outcome = result.outcome;
      if (!outcome) return;
      if (!outcome.committed) {
        // A typed die stays typed until a reroll the server throws (the GM's) replaces it.
        if (options.face !== undefined) setTyped(true);
        else if (options.reroll) setTyped(false);
        setRolled({
          total: outcome.total,
          ...(outcome.natural !== undefined ? { natural: outcome.natural } : {}),
          success: outcome.success,
          damage: outcome.appliedDamage,
          defences: damageAdjustments(outcome.parts, outcome.flatReduction),
          condition: outcome.conditionApplied,
          ...(outcome.rollMode ? { rollMode: outcome.rollMode } : {}),
          ...(outcome.autoFailed ? { autoFailed: true } : {}),
          ...(outcome.autoSucceeded ? { autoSucceeded: outcome.autoSucceeded } : {}),
          basis: proposal
        });
        return;
      }
      onFeedback(
        `${targetName} ${outcome.success ? "succeeded" : "failed"} (${outcome.total} vs DC ${outcome.dc})${outcome.appliedDamage > 0 ? ` - ${outcome.appliedDamage} damage applied` : ""}${outcome.conditionApplied ? " - condition applied" : ""}.`
      );
    });
  };
  const dismiss = () => {
    setBusy(true);
    void command("save:dismiss", { saveId: save.id }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok ? "Saving throw dismissed." : (result.message ?? "The saving throw could not be dismissed.")
      );
    });
  };
  // The shown projection was computed from `basis`; once the field moves off it, it is stale.
  const stale = rolled !== null && proposal !== rolled.basis;
  useEffect(() => {
    if (rolled === null || !stale || busy || recheck !== "idle") return;
    // Confirm's payload with `commit: false`: the held die, the same amend. It records no die and applies
    // nothing (`answerSave` returns before writing the outcome), so the answer is exactly what Confirm
    // would do.
    const basis = proposal;
    const timer = setTimeout(() => {
      setRecheck("pending");
      void command(
        "save:answer",
        saveAnswerPayload({
          saveId: save.id,
          method: "roll",
          commit: false,
          ...(forced ? { dieMode: forced } : {}),
          ...(damageOverride !== undefined ? { damageOverride } : {})
        })
      ).then((result) => {
        if (!mounted.current) return;
        if (!result.ok || !result.outcome) {
          setRecheck("failed");
          if (!result.ok) feedbackRef.current(result.message ?? "The amended damage could not be checked.");
          return;
        }
        const outcome = result.outcome;
        setRecheck("idle");
        // `basis` is the proposal this answer was asked about; if typing continued meanwhile, the line is
        // stale again and this effect asks again.
        setRolled((current) =>
          current === null
            ? null
            : {
                ...current,
                success: outcome.success,
                damage: outcome.appliedDamage,
                defences: damageAdjustments(outcome.parts, outcome.flatReduction),
                condition: outcome.conditionApplied,
                basis
              }
        );
      });
    }, RECHECK_AMEND_MS);
    return () => clearTimeout(timer);
  }, [rolled, stale, busy, recheck, proposal, damageOverride, save.id, forced]);
  return (
    <div className="save-prompt" role="group" aria-label={`Saving throw for ${targetName}`}>
      <span className="save-prompt-label">
        <strong>
          DC {save.dc} {save.ability.toUpperCase()}
        </strong>{" "}
        vs {save.actionName} ({save.sourceName})
      </span>
      {save.proposedDamage > 0 && (viewer === "gm" || mayType) && (
        <label className="save-damage-amend">
          <span>Damage on a failure{save.halfOnSuccess ? ", half on a success" : ""}</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            className="action-damage-edit"
            placeholder={String(save.proposedDamage)}
            value={damageEdit ?? (rollMode === "manual" ? "" : String(save.proposedDamage))}
            disabled={busy}
            onChange={(event) => {
              setDamageEdit(event.target.value.replace(/[^0-9]/g, ""));
              setRecheck("idle");
            }}
          />
        </label>
      )}
      <RollControls
        rollMode={rollMode}
        busy={busy}
        rolled={rolled !== null}
        viewer={viewer}
        inspired={inspired}
        typed={typed}
        rerollable={!rolled?.autoFailed && !rolled?.autoSucceeded}
        currentMode={forced}
        faceLabel="Your save d20"
        onInvalidFace={onFeedback}
        onRoll={() => send({ commit: false })}
        onTyped={(face) => send({ commit: false, face })}
        onConfirm={() => send({ commit: true })}
        onReroll={(face) => send({ commit: false, reroll: true, ...(face !== undefined ? { face } : {}) })}
        onForce={(mode) => {
          const next = mode === "normal" ? undefined : mode;
          setForced(next);
          send({ commit: false, mode: next });
        }}
        onDismiss={canDismiss ? dismiss : undefined}
        summary={
          rolled ? (
            <>
              {/* The rolled total and what it will do; an explicit Confirm applies it. */}
              <strong className={rolled.success ? "save-pass" : "save-fail"}>
                {rolled.autoFailed
                  ? "Fails without a roll"
                  : rolled.autoSucceeded
                    ? `Succeeds without a roll (${rolled.autoSucceeded})`
                    : `Rolled ${rolled.total}`}
                {rolled.natural !== undefined ? ` (d20 ${rolled.natural})` : ""}
                {modeWords(rolled.rollMode)} - {rolled.success ? "Success" : "Failure"}
              </strong>
              {/* `rolled.damage` is always the server's projection for the field's number, never local
            arithmetic. While a recheck is out, show only what was typed. */}
              <span className="save-prompt-effect">
                {stale
                  ? `Amended to ${proposal}${recheck === "failed" ? "" : " - checking"}`
                  : `${rolled.damage > 0 ? `${rolled.damage} dmg` : "no damage"}${rolled.condition ? " + condition" : ""}${rolled.basis !== save.proposedDamage ? ` (amended - rolled ${save.proposedDamage})` : ""}`}
              </span>
              {!stale && rolled.defences && <span className="save-prompt-defences">{rolled.defences}</span>}
            </>
          ) : undefined
        }
        extraActions={
          rolled && !rolled.success && (legendaryResistanceLeft ?? 0) > 0 ? (
            <button
              type="button"
              className="save-legendary"
              disabled={busy}
              title="SRD Legendary Resistance: when it fails a save, it can choose to succeed instead"
              onClick={() => send({ commit: true, legendaryResistance: true })}
            >
              Legendary Resistance ({legendaryResistanceLeft} left)
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
