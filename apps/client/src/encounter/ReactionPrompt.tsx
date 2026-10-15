import { useEffect, useEffectEvent, useRef, useState } from "react";
import { type ActionResolution, type PendingReaction, type PlayerPendingReaction } from "@vtt/domain";
import { Button, IconX } from "@vtt/ui";
import { command } from "../lib/command";
import { damageAdjustments } from "./format";
import { PushChoice } from "./AttackPreview";
import { DieModeButtons, type DieMode } from "./RollControls";
import "./prompts.css";

/**
 * A reaction window awaiting an answer (Uncanny Dodge). The triggering hit's damage is parked here,
 * so both buttons apply it: Use spends the reaction and halves each part, Decline applies it in
 * full. Each button names what the server weighed through the reactor's defences when the hit
 * landed; a prompt parked before that was recorded falls back to the raw numbers. The GM's dismiss
 * dismisses without applying, for damage already entered by hand.
 */
export function ReactionPrompt({
  reaction,
  actorName,
  canDismiss,
  onFeedback,
  rollMode
}: Readonly<{
  reaction: PendingReaction | PlayerPendingReaction;
  actorName: string;
  canDismiss: boolean;
  onFeedback: (text: string) => void;
  rollMode: "auto" | "manual";
}>) {
  const [busy, setBusy] = useState(false);
  const opportunity = reaction.kind === "leaves-reach";
  // An opportunity attack previewed but not applied: confirm, re-roll adv/disadv, or type a d20,
  // as with a saving throw.
  const [rolled, setRolled] = useState<{
    attack: NonNullable<ActionResolution["attack"]>;
    mode?: DieMode;
    push?: ActionResolution["push"];
  } | null>(null);
  // null means the full distance, so a re-roll that changes the offer never carries a stale pick.
  const [pushPick, setPushPick] = useState<number | null>(null);
  const push = rolled?.push ?? null;
  const pushFeet = push ? Math.min(pushPick ?? push.maxFeet, push.maxFeet) : undefined;
  const [dieEdit, setDieEdit] = useState("");
  const autoRolled = useRef(false);
  const weighed = reaction.weighed;
  const takeIfUsed =
    weighed?.use ?? reaction.proposedDamageParts.reduce((sum, part) => sum + Math.floor(part.amount / 2), 0);
  const takeIfDeclined = weighed?.decline ?? reaction.proposedDamage;
  // `use` distinguishes the swing (Attack) from letting the mover go; opts drive the preview flow.
  const answer = (
    use: boolean,
    opts: { commit?: boolean; rollMode?: DieMode; attackNatural?: number; pushFeet?: number } = {}
  ) => {
    setBusy(true);
    void command("reaction:answer", { reactionId: reaction.id, use, ...opts }).then((result) => {
      setBusy(false);
      if (!result.ok) {
        onFeedback(result.message ?? "The reaction could not be answered.");
        return;
      }
      const outcome = result.outcome;
      if (!outcome) return;
      if (opportunity) {
        // A preview keeps the prompt open to confirm; an applied answer clears it.
        if (outcome.resolution?.preview && outcome.resolution.attack) {
          setRolled({
            attack: outcome.resolution.attack,
            mode: outcome.resolution.rollMode?.mode,
            push: outcome.resolution.push
          });
          return;
        }
        setRolled(null);
        const attack = outcome.resolution?.attack;
        onFeedback(
          use
            ? `${actorName}'s opportunity attack: ${attack ? `${attack.outcome.toUpperCase()} (${attack.total})` : "resolved"}${outcome.appliedDamage > 0 ? ` - ${outcome.appliedDamage} damage` : ""}.`
            : `${actorName} let ${reaction.sourceName} go.`
        );
      } else {
        const defences = damageAdjustments(outcome.parts, outcome.flatReduction);
        onFeedback(
          `${
            use
              ? `${actorName} used ${reaction.actionName} - ${reaction.proposedDamage} damage became ${outcome.appliedDamage}`
              : `${actorName} took ${outcome.appliedDamage} damage`
          }${defences ? ` - ${defences}` : ""}.`
        );
      }
    });
  };
  // Auto mode rolls the opportunity swing as soon as the prompt appears (still a preview).
  const rollOnAppear = useEffectEvent(() => answer(true, { commit: false }));
  useEffect(() => {
    if (opportunity && rollMode === "auto" && !rolled && !autoRolled.current) {
      autoRolled.current = true;
      rollOnAppear();
    }
  }, [opportunity, rollMode, rolled]);
  const submitDie = () => {
    const value = Number(dieEdit.trim());
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      onFeedback("Enter the attack d20 (1-20).");
      return;
    }
    answer(true, { commit: false, attackNatural: value });
  };
  const dismiss = () => {
    setBusy(true);
    void command("reaction:dismiss", { reactionId: reaction.id }).then((result) => {
      setBusy(false);
      onFeedback(
        result.ok
          ? "Reaction prompt dismissed - nothing applied."
          : (result.message ?? "The prompt could not be dismissed.")
      );
    });
  };
  const hit = rolled ? rolled.attack.outcome === "hit" || rolled.attack.outcome === "crit" : false;
  return (
    <div className="save-prompt reaction-prompt" role="group" aria-label={`Reaction for ${actorName}`}>
      <span className="save-prompt-label">
        {opportunity ? (
          <>
            <strong>Opportunity Attack</strong> - {reaction.sourceName} is leaving reach
          </>
        ) : (
          <>
            <strong>{reaction.actionName}</strong> vs {reaction.sourceName}
            {reaction.critical ? " (crit)" : ""} · {reaction.proposedDamage} dmg incoming
          </>
        )}
      </span>
      {push && pushFeet !== undefined && <PushChoice push={push} value={pushFeet} busy={busy} onPick={setPushPick} />}
      {opportunity && rolled ? (
        // The swing is rolled: confirm it, re-roll adv/disadv, type a d20, or let them go.
        <span className="save-prompt-confirm">
          <strong className={hit ? "save-pass" : "save-fail"}>
            Rolled {rolled.attack.total}
            {rolled.mode && rolled.mode !== "normal" ? ` (${rolled.mode === "advantage" ? "adv" : "disadv"})` : ""}
            {rolled.attack.targetAc !== null ? ` vs AC ${rolled.attack.targetAc}` : ""} -{" "}
            {rolled.attack.outcome === "crit" ? "CRIT" : rolled.attack.outcome.toUpperCase()} (nat{" "}
            {rolled.attack.naturalRoll})
          </strong>
          <DieModeButtons
            current={rolled.mode}
            disabled={busy}
            onPick={(mode) => answer(true, { commit: false, rollMode: mode })}
          />
          <button
            type="button"
            className="encounter-primary"
            disabled={busy}
            onClick={() =>
              answer(true, {
                commit: true,
                attackNatural: rolled.attack.naturalRoll,
                ...(pushFeet !== undefined ? { pushFeet } : {})
              })
            }
          >
            Confirm {hit ? "hit" : "miss"}
          </button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            title="Roll the swing again"
            onClick={() => answer(true, { commit: false })}
          >
            Re-roll
          </Button>
          <span className="save-prompt-manual">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="or type the d20"
              aria-label="Attack d20"
              value={dieEdit}
              onChange={(event) => setDieEdit(event.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && dieEdit.trim() !== "") submitDie();
              }}
            />
            <button type="button" disabled={busy || dieEdit.trim() === ""} onClick={submitDie}>
              Use
            </button>
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setRolled(null);
              answer(false);
            }}
          >
            Let them go
          </Button>
        </span>
      ) : (
        <span className="save-prompt-actions">
          {opportunity ? (
            <>
              <button
                type="button"
                className="save-prompt-roll"
                disabled={busy}
                title="Roll one melee attack against the mover"
                onClick={() => answer(true, { commit: false })}
              >
                Attack
              </button>
              <button
                type="button"
                disabled={busy}
                title="Keep the reaction; the mover leaves freely"
                onClick={() => answer(false)}
              >
                Let them go
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="save-prompt-roll"
                disabled={busy}
                title={`Spend the reaction; half damage${weighed ? ", after your defences" : ", before resistances"}`}
                onClick={() => answer(true)}
              >
                Use - take {takeIfUsed}
              </button>
              <button
                type="button"
                disabled={busy}
                title={`Keep the reaction; full damage${weighed ? ", after your defences" : ", before resistances"}`}
                onClick={() => answer(false)}
              >
                Decline - take {takeIfDeclined}
              </button>
            </>
          )}
          {canDismiss && (
            <button
              type="button"
              className="save-prompt-dismiss"
              disabled={busy}
              title="Dismiss without applying anything"
              aria-label="Dismiss without applying anything"
              onClick={dismiss}
            >
              <IconX />
            </button>
          )}
        </span>
      )}
    </div>
  );
}
