import { useEffect, useState } from "react";
import type { ContentActionSummary, DamageApplyResult, GmActor, GmView } from "@vtt/domain";
import { RichText } from "./RichText";
import { beginTargeting, clearBlockedPrompt, clearTargeting, resolveActionDirect, resolveTargeting, setTargetingResult, toggleTarget, useTargeting, useTargetingBlocked, useTargetingBusy, useTargetingResult } from "./targeting";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/** Per-definition cache: stat blocks are immutable content, one lookup per session is plenty. */
const actionCache = new Map<string, readonly ContentActionSummary[]>();

const isResolvable = (action: ContentActionSummary) => action.attackBonus !== null || action.saveAbility !== null || action.damage.length > 0 || action.grants || action.multiattack !== null;
/** Rage/Reckless (grants) and a Multiattack plan resolve with no target — a single Use tap. */
const isTargetless = (action: ContentActionSummary) => action.attackBonus === null && action.saveAbility === null && action.damage.length === 0 && (action.grants || action.multiattack !== null);
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
const tagLabel = (tag: string) => tag.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
const summaryOf = (action: ContentActionSummary) => {
  const parts: string[] = [];
  if (action.attackBonus !== null) parts.push(`${signed(action.attackBonus)} to hit${action.reachFeet ? `, reach ${action.reachFeet} ft` : action.rangeFeet ? `, range ${action.rangeFeet} ft` : ""}`);
  if (action.attackCount !== null && action.attackCount > 1) parts.push(`${action.attackCount} attacks`);
  if (action.multiattack) parts.push(action.multiattack.map((component) => `${component.count}× ${component.actionId}`).join(" + "));
  if (action.saveAbility !== null) parts.push(`DC ${action.saveDc} ${action.saveAbility.toUpperCase()}`);
  for (const part of action.damage) parts.push(`${part.formula} ${part.type}`);
  if (action.usesLimit !== null) parts.push(`${action.usesLimit}/${action.usesPer === "long-rest" ? "long rest" : action.usesPer}`);
  return parts.join(" · ");
};

/**
 * Client-side availability HINT (ADR-0020): the server is the authority — rows stay tappable and a
 * strict-mode rejection opens the audited override — but the obvious cases annotate up front so the
 * legal action is visibly the easiest path.
 */
function availabilityHint(state: GmView, actor: GmActor, action: ContentActionSummary): string | null {
  if (action.requiresEffectTag && !actor.effects.some((effect) => effect.tags.includes(action.requiresEffectTag!))) return `Needs ${tagLabel(action.requiresEffectTag)}`;
  if (action.usesLimit !== null && action.usesPer !== null) {
    const key = action.usesPool ?? action.id;
    const spent = action.usesPer === "turn" ? (state.combat.turn.turnUses[`${actor.id}:${key}`] ?? 0) : (actor.actionUses[key] ?? 0);
    if (spent >= action.usesLimit) return "No uses left";
  }
  const myTurn = state.combat.turnActorId === actor.id;
  if (!myTurn) return null;
  const turn = state.combat.turn;
  if (action.activation === "bonus-action" && turn.bonusActionUsed) return "Bonus action used";
  if (action.activation === "action" && turn.actionUsed) {
    const instance = turn.actionInstance?.actorId === actor.id ? turn.actionInstance.components : null;
    const remaining = instance ? (instance[action.id] ?? 0) + (action.attackBonus !== null ? instance["attack"] ?? 0 : 0) : 0;
    if (remaining > 0) return `${remaining} attack${remaining === 1 ? "" : "s"} left`;
    return "Action used";
  }
  if (action.activation === "reaction" && state.combat.reactionsUsed.includes(actor.id)) return "Reaction used";
  return null;
}

/**
 * The GM's action runner for the current stat-block combatant: pick an action, pick targets (in the
 * list here or by clicking tokens on the map — both drive the shared targeting store), resolve on the
 * server, then apply the proposed typed damage with explicit taps. Strict-mode rejections come back
 * as a one-tap override confirmation, never a dead end (ADR-0020).
 */
export function ActionRunner({ state, actor, onFeedback }: Readonly<{ state: GmView; actor: GmActor; onFeedback: (text: string) => void }>) {
  const [actions, setActions] = useState<readonly ContentActionSummary[] | null>(actionCache.get(actor.definitionId ?? "") ?? null);
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  const [openReference, setOpenReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A strict-mode rejection awaiting the GM's call — store state, so a resolve rolled from the
  // map's confirm bar surfaces the same override dialog here (ADR-0020).
  const blockedPrompt = useTargetingBlocked();
  const session = useTargeting();
  const result = useTargetingResult();
  const resolveBusy = useTargetingBusy();
  // Targeting/result in the store belong to this runner only when they're for this attacker.
  const picking = session && session.attackerId === actor.id ? session : null;

  const definitionId = actor.definitionId;
  useEffect(() => {
    clearTargeting(); setTargetingResult(null); setOpenReference(null);
    if (!definitionId) return;
    const cached = actionCache.get(definitionId);
    if (cached) { setActions(cached); return; }
    setActions(null);
    socket.emit("content:monster-actions", { definitionId }, (response) => {
      if (response.ok && response.actions) { actionCache.set(definitionId, response.actions); setActions(response.actions); }
      else onFeedback(response.message ?? "The stat block could not be loaded.");
    });
  }, [definitionId, actor.id, onFeedback]);
  // Clear the shared targeting when this runner unmounts (the turn moved off this combatant).
  useEffect(() => () => { clearTargeting(); setTargetingResult(null); }, []);
  // Fresh result (from this runner's Roll or the map confirm bar) clears prior apply bookkeeping.
  useEffect(() => { setApplied(new Set()); }, [result]);

  if (!definitionId) return null;
  const combatants = state.combat.initiative.flatMap((entry) => { const target = state.actors.find((item) => item.id === entry.actorId); return target ? [target] : []; });

  // A blocked resolve keeps its session and surfaces the override dialog via the store; only
  // genuine failures (revision conflicts, network) need a feedback line here.
  const onOutcome = (ok: boolean, message?: string) => { if (!ok && message) onFeedback(message); };
  const resolve = () => resolveTargeting(state.revision, onOutcome);
  const useDirect = (action: ContentActionSummary) => resolveActionDirect(actor.id, action.id, state.revision, onOutcome);

  const applyDamage = (targetId: string, targetName: string, key: string) => {
    if (!result || result.damageTotal <= 0) { setApplied((current) => new Set([...current, key])); return; }
    setBusy(true);
    // The typed parts (weapon dice + rage-style bonus lines) travel with the apply so the server can
    // run resistances and the dying transition; the total stays for compatibility and manual edits.
    const parts = [
      ...result.damage.map((part) => ({ amount: part.total, type: part.type })),
      ...(result.bonusDamage ?? []).map((part) => ({ amount: part.amount, type: part.type }))
    ].filter((part) => part.amount > 0);
    socket.emit("actor:apply-damage", { commandId: newId(), actorId: targetId, amount: result.damageTotal, parts, sourceActorId: actor.id, sourceName: `${actor.name}'s ${result.actionName}`, critical: result.crit }, (response: DamageApplyResult) => {
      setBusy(false);
      if (!response.ok) { onFeedback(response.message ?? "The damage could not be applied."); return; }
      setApplied((current) => new Set([...current, key]));
      const application = response.applied;
      if (application && application.totalApplied !== application.totalRequested) {
        const adjusted = application.parts.filter((part) => part.adjustment !== null).map((part) => `${part.amount} ${part.type} → ${part.adjusted} (${part.adjustment}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""})`).join("; ");
        onFeedback(`${targetName} took ${application.totalApplied} damage — ${adjusted}.`);
      } else {
        onFeedback(`${targetName} took ${application?.totalApplied ?? result.damageTotal} damage.`);
      }
    });
  };

  const instance = state.combat.turn.actionInstance?.actorId === actor.id ? state.combat.turn.actionInstance.components : null;
  const attacksLeft = instance ? Object.values(instance).reduce((sum, remaining) => sum + remaining, 0) : 0;

  return <div className="action-runner">
    {actions === null && <p className="action-runner-status">Loading stat block…</p>}
    {blockedPrompt && <div className="action-blocked" role="alertdialog" aria-label="Rules check">
      <span><strong>Blocked:</strong> {blockedPrompt.blocked.message}</span>
      <div className="action-blocked-actions">
        <button type="button" className="secondary" onClick={() => clearBlockedPrompt()}>Cancel</button>
        <button type="button" className="encounter-primary" onClick={() => { const pending = blockedPrompt; clearBlockedPrompt(); pending.retry({ reason: window.prompt("Override reason (logged for the table):", "GM override")?.trim() || "GM override" }); }}>Override</button>
      </div>
    </div>}
    {attacksLeft > 0 && !picking && <p className="action-instance-note" role="status">{attacksLeft} attack{attacksLeft === 1 ? "" : "s"} remaining in this action.</p>}
    {actions && !picking && <ul className="action-list">
      {actions.map((action) => {
        const hint = isResolvable(action) ? availabilityHint(state, actor, action) : null;
        return <li key={action.id}>
          {isResolvable(action)
            ? <button type="button" className={`action-row${hint ? " action-row-hinted" : ""}`} disabled={busy} title={action.description} onClick={() => isTargetless(action) ? useDirect(action) : beginTargeting(action, actor.id)}>
                <strong>{action.name}</strong><small>{summaryOf(action) || (action.grants ? "Use — grants an effect" : "Use")}{hint ? <span className="action-hint"> · {hint}</span> : null}</small>
              </button>
            : <>
                <button type="button" className="action-row action-row-static" aria-expanded={openReference === action.id} onClick={() => setOpenReference((current) => current === action.id ? null : action.id)}>
                  <strong>{action.name}</strong><small>{action.activation === "other" ? "Reference — tap to read" : `${action.activation} · tap to read`}</small>
                </button>
                {openReference === action.id && <p className="action-reference-text"><RichText text={action.description} /></p>}
              </>}
        </li>;
      })}
    </ul>}
    {picking && <div className="action-targeting" role="group" aria-label={`Targets for ${picking.action.name}`}>
      {picking.mode === "template"
        ? <p className="action-targeting-head"><strong>{picking.action.name}</strong> — drag the {picking.action.area?.sizeFeet}-ft {picking.action.area?.shape} on the map{picking.template?.placed ? " (placed — Roll to resolve)" : ", then Roll"}. Everyone under it is caught automatically.</p>
        : <>
            <p className="action-targeting-head"><strong>{picking.action.name}</strong> — {picking.mode === "single" ? "choose one target (or click a token)" : "choose targets (or click tokens)"}</p>
            <ul className="action-target-list">{combatants.filter((target) => target.id !== actor.id).map((target) => {
              const checked = picking.selected.includes(target.id);
              return <li key={target.id}>
                <label className="action-target">
                  <input type={picking.mode === "single" ? "radio" : "checkbox"} name="action-target" checked={checked} onChange={() => toggleTarget(target.id)} />
                  <span>{target.name}{target.armorClass !== undefined ? ` (AC ${target.armorClass})` : ""}</span>
                </label>
              </li>;
            })}</ul>
          </>}
      <div className="action-targeting-buttons">
        <button type="button" className="secondary" disabled={resolveBusy} onClick={() => clearTargeting()}>Back</button>
        <button type="button" className="encounter-primary" disabled={resolveBusy || (picking.mode === "template" ? !picking.template?.placed : picking.selected.length === 0)} onClick={resolve}>Roll {picking.action.name}</button>
      </div>
    </div>}
    {result && <div className="action-result" role="status">
      <div className="action-result-head">
        <strong>{result.actionName}</strong>
        <div className="action-result-actions">
          {/* An open compound action (Extra Attack / Multiattack) continues from here; anything else
              re-resolves through the rules check, where strict mode offers the audited override. */}
          {(() => { const again = actions?.find((candidate) => candidate.name === result.actionName); return again ? <button type="button" className="action-again" disabled={busy || resolveBusy} title="Resolve this action again" onClick={() => beginTargeting(again, actor.id)}>↻ Again</button> : null; })()}
          <button type="button" className="secondary action-result-close" aria-label="Dismiss result" onClick={() => setTargetingResult(null)}>✕</button>
        </div>
      </div>
      {result.overridden && <p className="action-overridden">Override ({result.overridden.rule}): {result.overridden.reason}</p>}
      {result.rollMode && <p className="action-rollmode">{result.rollMode.mode === "normal" ? "Advantage and disadvantage cancel" : result.rollMode.mode === "advantage" ? "Advantage" : "Disadvantage"}: {[...result.rollMode.advantage, ...result.rollMode.disadvantage].join(", ")}</p>}
      {result.attack && <p className={`action-outcome outcome-${result.attack.outcome}`}>
        {result.attack.total}{result.attack.targetAc !== null ? ` vs AC ${result.attack.targetAc}` : ""} — {result.attack.outcome === "crit" ? "CRITICAL HIT" : result.attack.outcome === "fumble" ? "NATURAL 1" : result.attack.outcome === "unknown" ? "no AC on record" : result.attack.outcome.toUpperCase()} (nat {result.attack.naturalRoll}) vs {result.attack.targetName}
      </p>}
      {result.save && <p className="action-outcome">Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save</p>}
      {result.effectGranted && <p className="action-effect-granted">{actor.name} gains <strong>{result.effectGranted.name}</strong>.</p>}
      {result.effectsApplied?.map((appliedEffect) => <p key={`${appliedEffect.targetId}-${appliedEffect.name}`} className="action-effect-applied">{appliedEffect.targetName} is <strong>{appliedEffect.name}</strong>.</p>)}
      {result.damage.length > 0 && <p className="action-damage">Damage: <strong>{result.damageTotal}</strong> ({[
        ...result.damage.map((part) => `${part.formula} ${part.type} = ${part.total}`),
        ...(result.bonusDamage ?? []).map((part) => `+${part.amount} ${part.source}`)
      ].join(" + ")}){result.crit ? " — crit dice doubled" : ""}</p>}
      {result.attack && (result.attack.outcome === "crit" || result.attack.outcome === "hit" || result.attack.outcome === "unknown") && result.damageTotal > 0 && (
        applied.has(result.attack.targetId)
          ? <p className="action-applied">Applied to {result.attack.targetName}.</p>
          : <button type="button" className="action-apply" disabled={busy} onClick={() => applyDamage(result.attack!.targetId, result.attack!.targetName, result.attack!.targetId)}>Apply {result.damageTotal} to {result.attack.targetName}</button>
      )}
      {result.warnings?.map((warning) => <p key={warning} className="action-warning">⚠ {warning}</p>)}
      {result.save && (() => {
        // Reflect the LIVE count of unanswered saves for this action (matched by attacker + action),
        // not the frozen resolve-time count — so the note clears as each save is answered in the tracker.
        const waiting = state.combat.pendingSaves.filter((save) => save.sourceActorId === actor.id && save.actionName === result.actionName).length;
        return waiting > 0
          ? <p className="action-save-note">Saving-throw {waiting === 1 ? "prompt is" : "prompts are"} waiting on {waiting} {waiting === 1 ? "target" : "targets"} in the turn order — roll or enter each result there, then confirm to apply.</p>
          : <p className="action-save-note resolved">All saving throws for {result.actionName} resolved.</p>;
      })()}
      {result.componentsRemaining && <p className="action-result-hint">{Object.values(result.componentsRemaining).reduce((sum, remaining) => sum + remaining, 0)} attack(s) remaining — tap <strong>↻ Again</strong> or pick the next attack above.</p>}
    </div>}
  </div>;
}
