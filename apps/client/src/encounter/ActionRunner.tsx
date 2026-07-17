import { useEffect, useState } from "react";
import type { ContentActionSummary, GmActor, GmView } from "@vtt/domain";
import { RichText } from "./RichText";
import { beginTargeting, clearTargeting, resolveTargeting, setTargetingResult, toggleTarget, useTargeting, useTargetingBusy, useTargetingResult } from "./targeting";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/** Per-definition cache: stat blocks are immutable content, one lookup per session is plenty. */
const actionCache = new Map<string, readonly ContentActionSummary[]>();

const isResolvable = (action: ContentActionSummary) => action.attackBonus !== null || action.saveAbility !== null || action.damage.length > 0;
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
const summaryOf = (action: ContentActionSummary) => {
  const parts: string[] = [];
  if (action.attackBonus !== null) parts.push(`${signed(action.attackBonus)} to hit${action.reachFeet ? `, reach ${action.reachFeet} ft` : action.rangeFeet ? `, range ${action.rangeFeet} ft` : ""}`);
  if (action.saveAbility !== null) parts.push(`DC ${action.saveDc} ${action.saveAbility.toUpperCase()}`);
  for (const part of action.damage) parts.push(`${part.formula} ${part.type}`);
  return parts.join(" · ");
};

/**
 * The GM's action runner for the current stat-block combatant: pick an action, pick targets (in the
 * list here or by clicking tokens on the map — both drive the shared targeting store), resolve on the
 * server, then apply the proposed damage with explicit taps.
 */
export function ActionRunner({ state, actor, onFeedback }: Readonly<{ state: GmView; actor: GmActor; onFeedback: (text: string) => void }>) {
  const [actions, setActions] = useState<readonly ContentActionSummary[] | null>(actionCache.get(actor.definitionId ?? "") ?? null);
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  const [openReference, setOpenReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  const resolve = () => resolveTargeting(state.revision, (ok, message) => { if (!ok) onFeedback(message ?? "The action could not be resolved."); });

  const applyDamage = (targetId: string, targetName: string, amount: number, key: string) => {
    if (amount <= 0) { setApplied((current) => new Set([...current, key])); return; }
    setBusy(true);
    socket.emit("actor:apply-damage", { commandId: newId(), actorId: targetId, amount }, (response) => {
      setBusy(false);
      if (!response.ok) { onFeedback(response.message ?? "The damage could not be applied."); return; }
      setApplied((current) => new Set([...current, key]));
      onFeedback(`${targetName} took ${amount} damage.`);
    });
  };

  return <div className="action-runner">
    {actions === null && <p className="action-runner-status">Loading stat block…</p>}
    {actions && !picking && !result && <ul className="action-list">
      {actions.map((action) => <li key={action.id}>
        {isResolvable(action)
          ? <button type="button" className="action-row" disabled={busy} title={action.description} onClick={() => beginTargeting(action, actor.id)}>
              <strong>{action.name}</strong><small>{summaryOf(action)}</small>
            </button>
          : <>
              <button type="button" className="action-row action-row-static" aria-expanded={openReference === action.id} onClick={() => setOpenReference((current) => current === action.id ? null : action.id)}>
                <strong>{action.name}</strong><small>{action.activation === "other" ? "Reference — tap to read" : `${action.activation} · tap to read`}</small>
              </button>
              {openReference === action.id && <p className="action-reference-text"><RichText text={action.description} /></p>}
            </>}
      </li>)}
    </ul>}
    {picking && <div className="action-targeting" role="group" aria-label={`Targets for ${picking.action.name}`}>
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
      <div className="action-targeting-buttons">
        <button type="button" className="secondary" disabled={resolveBusy} onClick={() => clearTargeting()}>Back</button>
        <button type="button" className="encounter-primary" disabled={resolveBusy || picking.selected.length === 0} onClick={resolve}>Roll {picking.action.name}</button>
      </div>
    </div>}
    {result && <div className="action-result" role="status">
      <div className="action-result-head"><strong>{result.actionName}</strong><button type="button" className="secondary action-result-close" aria-label="Dismiss result" onClick={() => setTargetingResult(null)}>✕</button></div>
      {result.attack && <p className={`action-outcome outcome-${result.attack.outcome}`}>
        {result.attack.total}{result.attack.targetAc !== null ? ` vs AC ${result.attack.targetAc}` : ""} — {result.attack.outcome === "crit" ? "CRITICAL HIT" : result.attack.outcome === "fumble" ? "NATURAL 1" : result.attack.outcome === "unknown" ? "no AC on record" : result.attack.outcome.toUpperCase()} (nat {result.attack.naturalRoll}) vs {result.attack.targetName}
      </p>}
      {result.save && <p className="action-outcome">Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save</p>}
      {result.damage.length > 0 && <p className="action-damage">Damage: <strong>{result.damageTotal}</strong> ({result.damage.map((part) => `${part.formula} ${part.type} = ${part.total}`).join(" + ")}){result.crit ? " — crit dice doubled" : ""}</p>}
      {result.attack && (result.attack.outcome === "crit" || result.attack.outcome === "hit" || result.attack.outcome === "unknown") && result.damageTotal > 0 && (
        applied.has(result.attack.targetId)
          ? <p className="action-applied">Applied to {result.attack.targetName}.</p>
          : <button type="button" className="action-apply" disabled={busy} onClick={() => applyDamage(result.attack!.targetId, result.attack!.targetName, result.damageTotal, result.attack!.targetId)}>Apply {result.damageTotal} to {result.attack.targetName}</button>
      )}
      {result.save && result.damageTotal > 0 && <ul className="action-save-targets">{result.save.targets.map((target) => <li key={target.targetId}>
        <span>{target.targetName}</span>
        {applied.has(target.targetId)
          ? <span className="action-applied">applied</span>
          : <span className="action-save-buttons">
              <button type="button" disabled={busy} title="Failed the save" onClick={() => applyDamage(target.targetId, target.targetName, result.damageTotal, target.targetId)}>Full {result.damageTotal}</button>
              <button type="button" disabled={busy} title="Succeeded on the save" onClick={() => applyDamage(target.targetId, target.targetName, Math.floor(result.damageTotal / 2), target.targetId)}>Half {Math.floor(result.damageTotal / 2)}</button>
              <button type="button" disabled={busy} title="No damage" onClick={() => setApplied((current) => new Set([...current, target.targetId]))}>None</button>
            </span>}
      </li>)}</ul>}
    </div>}
  </div>;
}
