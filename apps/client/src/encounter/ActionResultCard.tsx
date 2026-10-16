import { IconRepeat, IconWarning } from "@vtt/ui";
import type { ActionResolution, ContentActionSummary, GmActor, GmView } from "@vtt/domain";
import { ActionResultHead, HealingOutcome } from "./ActionResultHead";
import { AttackOutcome, AttackPreview } from "./AttackPreview";
import { componentLabel } from "./action-summary";
import type { ResolveOptions } from "./targeting";

/**
 * What a resolved action did, on the GM's console: the override and advantage notes, the attack
 * (previewed, with its confirm controls, or final), saves, granted and applied effects, damage with
 * its Apply, warnings, the table's narration, and what is left of a compound action.
 */
export function ActionResultCard({
  state,
  actor,
  result,
  actions,
  busy,
  resolveBusy,
  rollMode,
  onFeedback,
  resolve,
  onAgain,
  applied,
  damageEdit,
  onDamageEditChange,
  applyDamage
}: Readonly<{
  state: GmView;
  actor: GmActor;
  result: ActionResolution;
  actions: readonly ContentActionSummary[] | null;
  busy: boolean;
  resolveBusy: boolean;
  rollMode: "auto" | "manual";
  onFeedback: (text: string) => void;
  resolve: (options: ResolveOptions) => void;
  onAgain: (action: ContentActionSummary) => void;
  /** Targets whose damage has been applied from this result. */
  applied: ReadonlySet<string>;
  /** A typed damage override (manual roll mode, or a GM adjustment). */
  damageEdit: string | null;
  onDamageEditChange: (value: string) => void;
  applyDamage: (targetId: string, targetName: string, key: string, overrideAmount?: number) => void;
}>) {
  const again = !result.preview ? actions?.find((candidate) => candidate.name === result.actionName) : undefined;
  return (
    <div className="action-result" role="status">
      <ActionResultHead result={result}>
        {/* An open compound action (Extra Attack / Multiattack) continues from here; anything else
            re-resolves through the rules check, where strict mode offers the audited override. */}
        {again && (
          <button
            type="button"
            className="action-again"
            disabled={busy || resolveBusy}
            title="Resolve this action again"
            onClick={() => onAgain(again)}
          >
            <IconRepeat /> Again
          </button>
        )}
      </ActionResultHead>
      {result.overridden && (
        <p className="action-overridden">
          Override ({result.overridden.rule}): {result.overridden.reason}
        </p>
      )}
      {result.rollMode && (
        <p className="action-rollmode">
          {result.rollMode.mode === "normal"
            ? "Advantage and disadvantage cancel"
            : result.rollMode.mode === "advantage"
              ? "Advantage"
              : "Disadvantage"}
          : {[...result.rollMode.advantage, ...result.rollMode.disadvantage].join(", ")}
        </p>
      )}
      {result.attack && <AttackOutcome attack={result.attack} audience="gm" />}
      {result.preview && result.attack && (
        <AttackPreview
          attack={result.attack}
          mode={result.rollMode?.mode}
          busy={resolveBusy}
          rollMode={rollMode}
          bonusMode="auto"
          onFeedback={onFeedback}
          push={result.push}
          resolve={resolve}
        />
      )}
      {result.save && (
        <p className="action-outcome">
          Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save
        </p>
      )}
      {result.effectGranted && (
        <p className="action-effect-granted">
          {actor.name} gains <strong>{result.effectGranted.name}</strong>.
        </p>
      )}
      {result.effectsApplied?.map((appliedEffect) => (
        <p key={`${appliedEffect.targetId}-${appliedEffect.name}`} className="action-effect-applied">
          {appliedEffect.targetName} is <strong>{appliedEffect.name}</strong>.
        </p>
      ))}
      {result.damage.length > 0 &&
        (() => {
          // With a typed amount in the apply field, the headline shows that number; the rolled one stays
          // for reference.
          const typed = damageEdit !== null && damageEdit.trim() !== "" ? Number(damageEdit) : null;
          const overriding = typed !== null && Number.isFinite(typed) && typed >= 0 && typed !== result.damageTotal;
          const breakdown = [
            ...result.damage.map((part) => `${part.formula} ${part.type} = ${part.total}`),
            ...(result.bonusDamage ?? []).map((part) => `+${part.amount} ${part.source}`)
          ].join(" + ");
          return (
            <p className="action-damage">
              Damage: <strong>{overriding ? typed : result.damageTotal}</strong>
              {overriding ? ` (manual - rolled ${result.damageTotal})` : ` (${breakdown})`}
              {!overriding && result.crit ? " - crit dice doubled" : ""}
            </p>
          );
        })()}
      {result.healing && <HealingOutcome healing={result.healing} />}
      {result.attack &&
        (result.attack.outcome === "crit" || result.attack.outcome === "hit" || result.attack.outcome === "unknown") &&
        result.damageTotal > 0 &&
        (() => {
          // A reaction window (Uncanny Dodge) parked this damage on a prompt whose answer applies it
          // server-side, so no apply button here (it would double-apply).
          const prompt = result.reactionPrompts?.find((candidate) => candidate.actorId === result.attack!.targetId);
          if (prompt) {
            const waiting = state.combat.pendingReactions.some(
              (reaction) => reaction.actorId === result.attack!.targetId && reaction.sourceActorId === actor.id
            );
            return waiting ? (
              <p className="action-save-note">
                Waiting on {result.attack.targetName}'s <strong>{prompt.actionName}</strong> - answer it in the turn
                order; the damage applies there.
              </p>
            ) : (
              <p className="action-applied">{prompt.actionName} answered - damage handled in the turn order.</p>
            );
          }
          return applied.has(result.attack.targetId) ? (
            <p className="action-applied">Applied to {result.attack.targetName}.</p>
          ) : (
            <span className="action-apply-group">
              {/* The rolled total is pre-filled; type over it to apply a hand-rolled number instead. */}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="action-damage-edit"
                aria-label="Damage to apply"
                value={damageEdit ?? String(result.damageTotal)}
                onChange={(event) => onDamageEditChange(event.target.value.replace(/[^0-9]/g, ""))}
              />
              <button
                type="button"
                className="action-apply"
                disabled={busy}
                onClick={() =>
                  applyDamage(
                    result.attack!.targetId,
                    result.attack!.targetName,
                    result.attack!.targetId,
                    damageEdit === null || damageEdit === "" ? result.damageTotal : Number(damageEdit)
                  )
                }
              >
                Apply to {result.attack!.targetName}
              </button>
            </span>
          );
        })()}
      {result.warnings?.map((warning) => (
        <p key={warning} className="action-warning">
          <IconWarning /> {warning}
        </p>
      ))}
      {/* Narration of what happened (a push, a forced save), matching the feed. Includes `gmOnly`
          rows because this component takes a `GmView` and is mounted only in the GM console. Reusing
          it for a player would need a client-side filter here; the server also strips gmOnly rows
          from non-GM acks (`withoutGmOnlyNarration`, game-operations.ts). */}
      {result.tableNarration?.map((line) => (
        <p key={line.text} className="action-narration">
          {line.text}
        </p>
      ))}
      {result.save &&
        (() => {
          // The live count of unanswered saves for this action, so the note clears as each is answered.
          const waiting = state.combat.pendingSaves.filter(
            (save) => save.sourceActorId === actor.id && save.actionName === result.actionName
          ).length;
          return waiting > 0 ? (
            <p className="action-save-note">
              Saving-throw {waiting === 1 ? "prompt is" : "prompts are"} waiting on {waiting}{" "}
              {waiting === 1 ? "target" : "targets"} in the turn order - roll or enter each result there, then confirm
              to apply.
            </p>
          ) : (
            <p className="action-save-note resolved">All saving throws for {result.actionName} resolved.</p>
          );
        })()}
      {result.componentsRemaining && Object.values(result.componentsRemaining).some((remaining) => remaining > 0) && (
        <p className="action-result-hint">
          Remaining: {componentLabel(result.componentsRemaining, actions)} - tap <strong>Again</strong> or pick the next
          attack from the list below.
        </p>
      )}
    </div>
  );
}
