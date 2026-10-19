import { useEffect, useRef, useState } from "react";
import { usePrompt } from "../components/feedback";
import { armorClassInPlay, owedDamageParts, type ContentActionSummary, type GmActor, type GmView } from "@vtt/domain";
import { ActionResultCard } from "./ActionResultCard";
import { ActionTargetPicker } from "./ActionTargetPicker";
import { componentLabel } from "./action-summary";
import { ConfirmRow } from "./ConfirmRow";
import { damageAdjustments } from "./format";
import { GmActionList } from "./GmActionList";
import {
  beginTargeting,
  clearBlockedPrompt,
  clearTargeting,
  resolveActionDirect,
  resolveTargeting,
  setTargetingResult,
  takeMoveFirst,
  useTargeting,
  useTargetingBlocked,
  useTargetingBusy,
  useTargetingResult
} from "./targeting";
import { command, read } from "../lib/command";
import { registerContentCache } from "../content/invalidate";
import { useRollPreference } from "../dice/roll-preference";
import { useTableCalibration } from "../scene/tableGeometry";
import { caughtByArea } from "../table/targetHints";
import { foesFirst, pickableTargets, targetRows } from "../table/targetRows";
import "./action-runner.css";

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
  // The combatant's own list, with what its items give: it moves with what it carries and the effects on it.
  const cacheKey = `${actor.definitionId ?? ""}:${actor.id}:${actor.inventory
    .map((item) => `${item.id}/${item.quantity}/${item.equipped}/${item.attuned}`)
    .join(",")}:${actor.effects.map((effect) => effect.id).join(",")}`;
  const [actions, setActions] = useState<readonly ContentActionSummary[] | null>(actionCache.get(cacheKey) ?? null);
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  // A typed damage override (manual roll mode, or a GM adjustment).
  const [damageEdit, setDamageEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { prompt, dialog } = usePrompt();
  // A strict-mode rejection awaiting the GM's call. Store state, so a resolve from the map's confirm
  // bar shows the same override dialog here (ADR-0020).
  const blockedPrompt = useTargetingBlocked();
  const session = useTargeting();
  const result = useTargetingResult();
  const resolveBusy = useTargetingBusy();
  const calibration = useTableCalibration(state.combat.mapAssetId);
  // Targeting and result in the store belong to this runner only when they are for this attacker.
  // A spell area the GM places is the Spell areas row's to set, and placing it rolls nothing, so it opens no picker.
  const picking = session && session.attackerId === actor.id && session.placeZoneId === undefined ? session : null;

  const definitionId = actor.definitionId;
  useEffect(() => {
    clearTargeting();
    setTargetingResult(null);
    if (!definitionId) return;
    const cached = actionCache.get(cacheKey);
    if (cached) {
      setActions(cached);
      return;
    }
    setActions(null);
    void read("content:monster-actions", { definitionId, actorId: actor.id }).then((response) => {
      if (response.ok && response.actions) {
        actionCache.set(cacheKey, response.actions);
        setActions(response.actions);
      } else onFeedback(response.message ?? "The stat block could not be loaded.");
    });
  }, [definitionId, cacheKey, actor.id, onFeedback]);
  // Clear the shared targeting when this runner unmounts (the turn moved off this combatant).
  useEffect(
    () => () => {
      clearTargeting();
      setTargetingResult(null);
    },
    []
  );
  // A fresh result clears prior apply bookkeeping.
  useEffect(() => {
    setApplied(new Set());
    setDamageEdit(null);
  }, [result]);
  // Confirming a hit applies its damage in the same step when no reaction can change it. With hand-rolled dice the
  // GM types the damage first, so Apply stays.
  const { rollMode } = useRollPreference();
  const previewedTarget = useRef<string | null>(null);
  const applyRef = useRef<(targetId: string, targetName: string, key: string) => void>(() => {});
  useEffect(() => {
    if (!result) return;
    if (result.preview) {
      previewedTarget.current = result.attack?.targetId ?? null;
      return;
    }
    const attack = result.attack;
    const confirmed = attack !== null && previewedTarget.current === attack.targetId;
    previewedTarget.current = null;
    if (!confirmed || rollMode !== "auto" || result.damageTotal <= 0 || result.waitingOnReaction) return;
    // A prompt holding the damage (the target's Uncanny Dodge, another creature's Cutting Words) applies it itself.
    if (result.reactionPrompts?.some((prompt) => prompt.holdsDamage || prompt.actorId === attack.targetId)) return;
    applyRef.current(attack.targetId, attack.targetName, attack.targetId);
  }, [result, rollMode]);

  if (!definitionId) return null;
  const combatants = state.combat.initiative.flatMap((entry) => {
    const target = state.actors.find((item) => item.id === entry.actorId);
    return target ? [target] : [];
  });
  // Who a placed area covers right now, as a hint beside the Roll; the server decides who it catches.
  const area = picking?.mode === "template" ? picking.template : null;
  const insideNow =
    area?.placed && calibration
      ? targetRows(
          actor.id,
          caughtByArea(
            calibration,
            area.shape,
            area.placed,
            area.widthFeet,
            state.combat.tokens,
            area.sizeFeet
          ).flatMap((id) => {
            const target = combatants.find((candidate) => candidate.id === id);
            return target ? [{ id: target.id, name: target.name, kind: target.kind }] : [];
          }),
          state.combat.tokens,
          calibration,
          combatants
        )
      : undefined;

  // A blocked resolve keeps its session and shows the override dialog via the store; only genuine
  // failures (revision conflicts, network) need a feedback line.
  const onOutcome = (ok: boolean, message?: string) => {
    if (!ok && message) onFeedback(message);
  };

  const applyDamage = (
    targetId: string,
    targetName: string,
    key: string,
    overrideAmount?: number,
    owedParts?: ReadonlyArray<{ amount: number; type: string }>
  ) => {
    // A target of an action with no attack roll is owed its own parts (Magic Missile's darts); a hit owes the roll's.
    const parts = owedParts ? owedParts.map((part) => ({ ...part })) : result ? owedDamageParts(result) : [];
    const owed = parts.reduce((sum, part) => sum + part.amount, 0);
    if (!result || (overrideAmount ?? owed) <= 0) {
      setApplied((current) => new Set([...current, key]));
      return;
    }
    setBusy(true);
    // The typed parts always travel with the apply, amended or not: an override is sent as
    // `damageOverride` and the server re-weights the same types to it, so resistances still apply.
    const useOverride = overrideAmount !== undefined && overrideAmount !== owed;
    void command("actor:apply-damage", {
      actorId: targetId,
      amount: overrideAmount ?? owed,
      parts,
      ...(useOverride ? { damageOverride: overrideAmount } : {}),
      sourceActorId: actor.id,
      // Names the action, so the server lands what its damage drains (a Life Drain's lower Hit Point maximum).
      ...(result.actionId !== undefined && result.actionId.length <= 120 ? { sourceActionId: result.actionId } : {}),
      sourceName: `${actor.name}'s ${result.actionName}`,
      critical: result.crit,
      // The attacker chose to knock the target out with this melee hit.
      ...(result.knockOut === "chosen" ? { nonlethal: true } : {})
    }).then((response) => {
      setBusy(false);
      if (!response.ok) {
        onFeedback(response.message ?? "The damage could not be applied.");
        return;
      }
      setApplied((current) => new Set([...current, key]));
      const application = response.applied;
      if (application && application.totalApplied !== application.totalRequested) {
        onFeedback(
          `${targetName} took ${application.totalApplied} damage: ${damageAdjustments(application.parts, application.flatReduction)}.`
        );
      } else {
        onFeedback(`${targetName} took ${application?.totalApplied ?? owed} damage.`);
      }
    });
  };

  applyRef.current = (targetId, targetName, key) => applyDamage(targetId, targetName, key);

  const instance =
    state.combat.turn.actionInstance?.actorId === actor.id ? state.combat.turn.actionInstance.components : null;
  const attacksLeft = instance ? Object.values(instance).reduce((sum, remaining) => sum + remaining, 0) : 0;
  const bonusInstance =
    state.combat.turn.bonusActionInstance?.actorId === actor.id
      ? state.combat.turn.bonusActionInstance.components
      : null;
  const bonusLeft = bonusInstance ? Object.values(bonusInstance).reduce((sum, remaining) => sum + remaining, 0) : 0;

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
      {/* Name what is left ("1× Tail") so the GM picks the next attack and doesn't re-tap the last. */}
      {attacksLeft > 0 && !picking && instance && (
        <p className="action-instance-note" role="status">
          Remaining in this action: {componentLabel(instance, actions)}.
        </p>
      )}
      {bonusLeft > 0 && !picking && bonusInstance && (
        <p className="action-instance-note" role="status">
          Remaining in this Bonus Action: {componentLabel(bonusInstance, actions)}.
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
          targets={pickableTargets(
            foesFirst(
              targetRows(
                actor.id,
                combatants
                  .filter((target) => target.id !== actor.id)
                  .map((target) => ({
                    id: target.id,
                    name: target.name,
                    kind: target.kind,
                    ...(target.armorClass !== undefined ? { armorClass: armorClassInPlay(target) } : {}),
                    ...(target.hp.current <= 0 ? { down: true } : {})
                  })),
                state.combat.tokens,
                calibration,
                combatants
              ),
              actor.kind,
              picking.action.healing != null
            ),
            picking.action
          )}
          insideNow={insideNow}
          carried={actor.inventory}
          onMap
          busy={resolveBusy}
          onInvalidFace={onFeedback}
          onRoll={(face) =>
            resolveTargeting(state.revision, onOutcome, face !== undefined ? { attackNatural: face } : {})
          }
          onMoveFirst={() => takeMoveFirst(onOutcome)}
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
