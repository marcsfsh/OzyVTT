import { useEffect, useState } from "react";
import { usePrompt } from "../components/feedback";
import type { ContentActionSummary, GmActor, GmView } from "@vtt/domain";
import { ActionResultCard } from "./ActionResultCard";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { componentLabel } from "./action-summary";
import { ConfirmRow } from "./ConfirmRow";
import { GmActionList } from "./GmActionList";
import {
  beginTargeting,
  clearBlockedPrompt,
  clearTargeting,
  resolveActionDirect,
  resolveTargeting,
  setTargetingResult,
  useTargeting,
  useTargetingBlocked,
  useTargetingBusy,
  useTargetingResult
} from "./targeting";
import { useRollPreference } from "../dice/roll-preference";
import { command, read } from "../lib/command";
import { registerContentCache } from "../content/invalidate";

/** Per-definition action cache. Cleared on `homebrew:changed` (`content/invalidate.ts`), since a GM
    can republish a creature mid-session and a stale entry would show the wrong attack. */
const actionCache = new Map<string, readonly ContentActionSummary[]>();
registerContentCache(() => actionCache.clear());

/**
 * The GM's action runner for the current stat-block combatant: pick an action, pick targets (here
 * or on the map, via the shared targeting store), resolve on the server, then apply the proposed
 * typed damage with explicit taps. Strict-mode rejections offer a one-tap override (ADR-0020).
 */
export function ActionRunner({
  state,
  actor,
  onFeedback
}: Readonly<{ state: GmView; actor: GmActor; onFeedback: (text: string) => void }>) {
  const [actions, setActions] = useState<readonly ContentActionSummary[] | null>(
    actionCache.get(actor.definitionId ?? "") ?? null
  );
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  // A typed damage override (manual roll mode, or a GM adjustment).
  const [damageEdit, setDamageEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { prompt, dialog } = usePrompt();
  // Manual vs auto follows the shared per-browser dice-input preference.
  const { rollMode } = useRollPreference();
  // A strict-mode rejection awaiting the GM's call. Store state, so a resolve from the map's confirm
  // bar shows the same override dialog here (ADR-0020).
  const blockedPrompt = useTargetingBlocked();
  const session = useTargeting();
  const result = useTargetingResult();
  const resolveBusy = useTargetingBusy();
  // Targeting and result in the store belong to this runner only when they are for this attacker.
  const picking = session && session.attackerId === actor.id ? session : null;

  const definitionId = actor.definitionId;
  useEffect(() => {
    clearTargeting();
    setTargetingResult(null);
    if (!definitionId) return;
    const cached = actionCache.get(definitionId);
    if (cached) {
      setActions(cached);
      return;
    }
    setActions(null);
    void read("content:monster-actions", { definitionId }).then((response) => {
      if (response.ok && response.actions) {
        actionCache.set(definitionId, response.actions);
        setActions(response.actions);
      } else onFeedback(response.message ?? "The stat block could not be loaded.");
    });
  }, [definitionId, actor.id, onFeedback]);
  // Clear the shared targeting when this runner unmounts (the turn moved off this combatant).
  useEffect(
    () => () => {
      clearTargeting();
      setTargetingResult(null);
    },
    []
  );
  // A fresh result (from this runner or the map confirm bar) clears prior apply bookkeeping.
  useEffect(() => {
    setApplied(new Set());
    setDamageEdit(null);
  }, [result]);

  if (!definitionId) return null;
  const combatants = state.combat.initiative.flatMap((entry) => {
    const target = state.actors.find((item) => item.id === entry.actorId);
    return target ? [target] : [];
  });

  // A blocked resolve keeps its session and shows the override dialog via the store; only genuine
  // failures (revision conflicts, network) need a feedback line.
  const onOutcome = (ok: boolean, message?: string) => {
    if (!ok && message) onFeedback(message);
  };

  const applyDamage = (targetId: string, targetName: string, key: string, overrideAmount?: number) => {
    if (!result || (overrideAmount ?? result.damageTotal) <= 0) {
      setApplied((current) => new Set([...current, key]));
      return;
    }
    setBusy(true);
    // The typed parts always travel with the apply, amended or not: an override is sent as
    // `damageOverride` and the server re-weights the same types to it, so resistances still apply.
    const parts = [
      ...result.damage.map((part) => ({ amount: part.total, type: part.type })),
      ...(result.bonusDamage ?? []).map((part) => ({ amount: part.amount, type: part.type }))
    ].filter((part) => part.amount > 0);
    const useOverride = overrideAmount !== undefined && overrideAmount !== result.damageTotal;
    void command("actor:apply-damage", {
      actorId: targetId,
      amount: overrideAmount ?? result.damageTotal,
      parts,
      ...(useOverride ? { damageOverride: overrideAmount } : {}),
      sourceActorId: actor.id,
      sourceName: `${actor.name}'s ${result.actionName}`,
      critical: result.crit
    }).then((response) => {
      setBusy(false);
      if (!response.ok) {
        onFeedback(response.message ?? "The damage could not be applied.");
        return;
      }
      setApplied((current) => new Set([...current, key]));
      const application = response.applied;
      if (application && application.totalApplied !== application.totalRequested) {
        const adjusted = application.parts
          .filter((part) => part.adjustment !== null)
          .map(
            (part) =>
              `${part.amount} ${part.type} → ${part.adjusted} (${part.adjustment}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""})`
          )
          .join("; ");
        onFeedback(`${targetName} took ${application.totalApplied} damage - ${adjusted}.`);
      } else {
        onFeedback(`${targetName} took ${application?.totalApplied ?? result.damageTotal} damage.`);
      }
    });
  };

  const instance =
    state.combat.turn.actionInstance?.actorId === actor.id ? state.combat.turn.actionInstance.components : null;
  const attacksLeft = instance ? Object.values(instance).reduce((sum, remaining) => sum + remaining, 0) : 0;

  return (
    <div className="action-runner">
      {actions === null && <p className="action-runner-status">Loading stat block…</p>}
      {blockedPrompt && (
        <ConfirmRow
          ariaLabel="Rules check"
          confirmLabel="Override"
          onCancel={() => clearBlockedPrompt()}
          onConfirm={async () => {
            const pending = blockedPrompt;
            clearBlockedPrompt();
            const reason = await prompt({
              title: "Override reason",
              body: "Logged for the table.",
              defaultValue: "GM override",
              confirmLabel: "Override"
            });
            pending.retry({ reason: reason || "GM override" });
          }}
        >
          <strong>Blocked:</strong> {blockedPrompt.blocked.message}
        </ConfirmRow>
      )}
      {/* Name what is left ("1× Tail") so the GM picks the next attack instead of re-tapping the last. */}
      {attacksLeft > 0 && !picking && instance && (
        <p className="action-instance-note" role="status">
          Remaining in this action: {componentLabel(instance, actions)}.
        </p>
      )}
      {actions && !picking && (
        <GmActionList
          key={actor.id}
          state={state}
          actor={actor}
          actions={actions}
          busy={busy}
          onUse={(action, targetless) =>
            targetless
              ? resolveActionDirect(actor.id, action.id, state.revision, onOutcome)
              : beginTargeting(action, actor.id)
          }
        />
      )}
      {picking && !result?.preview && (
        <ActionTargetPicker
          picking={picking}
          targets={combatants
            .filter((target) => target.id !== actor.id)
            .map((target) => ({
              id: target.id,
              label: `${target.name}${target.armorClass !== undefined ? ` (AC ${target.armorClass})` : ""}`
            }))}
          onMap
          busy={resolveBusy}
          onRoll={() => resolveTargeting(state.revision, onOutcome)}
        />
      )}
      {result && (
        <ActionResultCard
          state={state}
          actor={actor}
          result={result}
          actions={actions}
          busy={busy}
          resolveBusy={resolveBusy}
          rollMode={rollMode}
          onFeedback={onFeedback}
          resolve={(options) => resolveTargeting(state.revision, onOutcome, options)}
          onAgain={(action) => beginTargeting(action, actor.id)}
          applied={applied}
          damageEdit={damageEdit}
          onDamageEditChange={setDamageEdit}
          applyDamage={applyDamage}
        />
      )}
      {dialog}
    </div>
  );
}
