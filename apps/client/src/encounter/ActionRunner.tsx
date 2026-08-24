import { useEffect, useRef, useState } from "react";
import { usePrompt } from "../components/feedback";
import type { ContentActionSummary, DamageApplyResult, GmActor, GmView } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { RichText } from "./RichText";
import { SpellcastingText } from "./spells";
import { beginTargeting, clearBlockedPrompt, clearTargeting, resolveActionDirect, resolveTargeting, setTargetingResult, toggleTarget, useTargeting, useTargetingBlocked, useTargetingBusy, useTargetingResult, type ResolveOptions } from "./targeting";
import { useRollPreference } from "../dice/roll-preference";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import { registerContentCache } from "../content/invalidate";

/** Per-definition cache: one lookup per stat block per session.
    NOT immutable any more — a GM can publish a homebrew creature edit mid-session, so the
    cache is dropped on `homebrew:changed` (`content/invalidate.ts`) and the next resolve
    refetches. Actions and typed defences are late-bound at every use, which is exactly
    why a stale entry here would show the wrong attack on a creature already on the table. */
const actionCache = new Map<string, readonly ContentActionSummary[]>();
registerContentCache(() => actionCache.clear());

/* A LIMITED USE is itself the mechanic (`action-resolution.ts` resolveDefinitionAction: "limited uses
   are themselves a structured effect"). Action Surge, Indomitable, Arcane Recovery, Relentless
   Endurance and the tiefling legacy tiers have nothing to roll - they have a counter - so without
   this they listed as static reference rows the table could read but never spend. Both predicates
   mirror the server's, or the sheet and the resolver disagree about what is usable. */
const isResolvable = (action: ContentActionSummary) => action.attackBonus !== null || action.saveAbility !== null || action.damage.length > 0 || action.grants || action.multiattack !== null || action.usesLimit !== null || action.builtin === true;
/** Rage/Reckless (grants), a Multiattack plan, a spent charge, and no-target builtins (Dodge, Hide) resolve with a single Use tap; single-target builtins (Help, Unarmed Strike) go through targeting. */
const isTargetless = (action: ContentActionSummary) => action.attackBonus === null && action.saveAbility === null && action.damage.length === 0 && action.targeting !== "single" && (action.grants || action.multiattack !== null || action.usesLimit !== null || action.builtin === true);
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
const tagLabel = (tag: string) => tag.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
/** The action's mechanics as discrete lines - each renders as its own bullet beneath the name. */
const summaryParts = (action: ContentActionSummary, all: readonly ContentActionSummary[]): string[] => {
  const parts: string[] = [];
  const componentName = (id: string) => all.find((candidate) => candidate.id === id)?.name ?? tagLabel(id);
  if (action.attackBonus !== null) parts.push(`${signed(action.attackBonus)} to hit${action.reachFeet ? `, reach ${action.reachFeet} ft` : action.rangeFeet ? `, range ${action.rangeFeet} ft` : ""}`);
  if (action.attackCount !== null && action.attackCount > 1) parts.push(`${action.attackCount} attacks`);
  if (action.multiattack) parts.push(action.multiattack.map((component) => `${component.count}× ${componentName(component.actionId)}`).join(" + "));
  if (action.saveAbility !== null) parts.push(`DC ${action.saveDc} ${action.saveAbility.toUpperCase()} save`);
  for (const part of action.damage) parts.push(`${part.formula} ${part.type} damage`);
  if (action.usesLimit !== null) parts.push(action.usesPer === "recharge" ? `Recharge ${action.usesRecharge}${(action.usesRecharge ?? 6) < 6 ? "-6" : ""}` : `${action.usesLimit}/${action.usesPer === "long-rest" ? "long rest" : action.usesPer}`);
  if (action.legendaryCost !== undefined) parts.push(`Legendary${action.legendaryCost > 1 ? ` ×${action.legendaryCost}` : ""}`);
  return parts;
};

/**
 * Client-side availability HINT (ADR-0020): the server is the authority - rows stay tappable and a
 * strict-mode rejection opens the audited override - but the obvious cases annotate up front so the
 * legal action is visibly the easiest path.
 */
function availabilityHint(state: GmView, actor: GmActor, action: ContentActionSummary): string | null {
  if (action.requiresEffectTag && !actor.effects.some((effect) => effect.tags.includes(action.requiresEffectTag!))) return `Needs ${tagLabel(action.requiresEffectTag)}`;
  if (action.legendaryCost !== undefined) {
    if (state.combat.turnActorId === actor.id) return "On another creature's turn";
    const perRound = actor.legendary?.actionsPerRound ?? 3;
    if ((state.combat.legendaryUsed[actor.id] ?? 0) + action.legendaryCost > perRound) return "No legendary actions left this round";
  }
  if (action.usesLimit !== null && action.usesPer !== null) {
    const key = action.usesPool ?? action.id;
    const spent = action.usesPer === "turn" ? (state.combat.turn.turnUses[`${actor.id}:${key}`] ?? 0) : (actor.actionUses[key] ?? 0);
    if (spent >= action.usesLimit) return action.usesPer === "recharge" ? `Spent - recharges on ${action.usesRecharge}+ at its turn start` : "No uses left";
  }
  const myTurn = state.combat.turnActorId === actor.id;
  if (!myTurn) return null;
  const turn = state.combat.turn;
  if (action.activation === "bonus-action" && turn.bonusActionUsed) return "Bonus action used";
  if (action.activation === "action" && turn.actionUsed) {
    const instance = turn.actionInstance?.actorId === actor.id ? turn.actionInstance.components : null;
    // The Multiattack plan row stays a live "continue" while any component remains.
    if (action.multiattack && instance && Object.values(instance).some((count) => count > 0)) return "In progress - pick the next attack";
    const remaining = instance ? (instance[action.id] ?? 0) + (action.attackBonus !== null ? instance["attack"] ?? 0 : 0) : 0;
    if (remaining > 0) return `${remaining} attack${remaining === 1 ? "" : "s"} left`;
    return "Action used";
  }
  if (action.activation === "reaction" && state.combat.reactionsUsed.includes(actor.id)) return "Reaction used";
  return null;
}

/**
 * The GM's action runner for the current stat-block combatant: pick an action, pick targets (in the
 * list here or by clicking tokens on the map - both drive the shared targeting store), resolve on the
 * server, then apply the proposed typed damage with explicit taps. Strict-mode rejections come back
 * as a one-tap override confirmation, never a dead end (ADR-0020).
 */
/** The handful of generic actions a table actually reaches for mid-fight; the rest sit behind "More". */
const PRIMARY_BUILTINS = ["dodge", "dash", "disengage", "help", "hide"] as const;

export function ActionRunner({ state, actor, onFeedback }: Readonly<{ state: GmView; actor: GmActor; onFeedback: (text: string) => void }>) {
  const [actions, setActions] = useState<readonly ContentActionSummary[] | null>(actionCache.get(actor.definitionId ?? "") ?? null);
  const [applied, setApplied] = useState<ReadonlySet<string>>(new Set());
  // A typed damage override (manual roll mode, or a GM adjustment): when it differs from the rolled
  // total the manual number is applied straight (no defense math), matching the save prompt's manual path.
  const [damageEdit, setDamageEdit] = useState<string | null>(null);
  // A typed d20 for the attack preview (the manual-entry path, or a physical die).
  const [attackDieEdit, setAttackDieEdit] = useState("");
  // Whether that typed d20 has been submitted to the preview - drives "Use roll" → Confirm/Re-roll.
  const [manualSubmitted, setManualSubmitted] = useState(false);
  const [openReference, setOpenReference] = useState<string | null>(null);
  const [moreBuiltins, setMoreBuiltins] = useState(false);
  const [busy, setBusy] = useState(false);
  const { prompt, dialog } = usePrompt();
  // Manual-vs-auto follows the one per-browser dice-input preference every surface reads.
  const { rollMode } = useRollPreference();
  // A strict-mode rejection awaiting the GM's call - store state, so a resolve rolled from the
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
  useEffect(() => { setApplied(new Set()); setDamageEdit(null); }, [result]);
  // The manual d20 field resets only when a NEW attack preview first appears - not on every preview
  // change (Adv/Disadv/Use roll each produce a fresh result), so a submitted manual roll persists
  // instead of the field clearing itself the instant it's used.
  const previewShownRef = useRef(false);
  useEffect(() => {
    const showing = Boolean(result?.preview);
    if (showing && !previewShownRef.current) { setAttackDieEdit(""); setManualSubmitted(false); }
    previewShownRef.current = showing;
  }, [result]);

  if (!definitionId) return null;
  const combatants = state.combat.initiative.flatMap((entry) => { const target = state.actors.find((item) => item.id === entry.actorId); return target ? [target] : []; });

  // A blocked resolve keeps its session and surfaces the override dialog via the store; only
  // genuine failures (revision conflicts, network) need a feedback line here.
  const onOutcome = (ok: boolean, message?: string) => { if (!ok && message) onFeedback(message); };
  const resolve = () => resolveTargeting(state.revision, onOutcome);
  const useDirect = (action: ContentActionSummary) => resolveActionDirect(actor.id, action.id, state.revision, onOutcome);

  const applyDamage = (targetId: string, targetName: string, key: string, overrideAmount?: number) => {
    if (!result || (overrideAmount ?? result.damageTotal) <= 0) { setApplied((current) => new Set([...current, key])); return; }
    setBusy(true);
    // The typed parts (weapon dice + rage-style bonus lines) ALWAYS travel with the apply, amended or
    // not. An override used to drop them and send a bare total, which put the number on the
    // defence-free path - so a GM correcting 17 to 12 handed a fire-resistant target all 12. It now
    // rides as `damageOverride` and the SERVER re-weights the same types to it (rule 2: that maths is
    // a game decision, not a client one).
    const parts = [
      ...result.damage.map((part) => ({ amount: part.total, type: part.type })),
      ...(result.bonusDamage ?? []).map((part) => ({ amount: part.amount, type: part.type }))
    ].filter((part) => part.amount > 0);
    const useOverride = overrideAmount !== undefined && overrideAmount !== result.damageTotal;
    socket.emit("actor:apply-damage", { commandId: newId(), actorId: targetId, amount: overrideAmount ?? result.damageTotal, parts, ...(useOverride ? { damageOverride: overrideAmount } : {}), sourceActorId: actor.id, sourceName: `${actor.name}'s ${result.actionName}`, critical: result.crit }, (response: DamageApplyResult) => {
      setBusy(false);
      if (!response.ok) { onFeedback(response.message ?? "The damage could not be applied."); return; }
      setApplied((current) => new Set([...current, key]));
      const application = response.applied;
      if (application && application.totalApplied !== application.totalRequested) {
        const adjusted = application.parts.filter((part) => part.adjustment !== null).map((part) => `${part.amount} ${part.type} → ${part.adjusted} (${part.adjustment}${part.adjustmentSource ? `: ${part.adjustmentSource}` : ""})`).join("; ");
        onFeedback(`${targetName} took ${application.totalApplied} damage - ${adjusted}.`);
      } else {
        onFeedback(`${targetName} took ${application?.totalApplied ?? result.damageTotal} damage.`);
      }
    });
  };

  const instance = state.combat.turn.actionInstance?.actorId === actor.id ? state.combat.turn.actionInstance.components : null;
  const attacksLeft = instance ? Object.values(instance).reduce((sum, remaining) => sum + remaining, 0) : 0;
  // Name what's left ("1× Tail") so the GM picks the next attack instead of re-tapping the last one.
  const componentLabel = (components: Record<string, number>) => Object.entries(components)
    .filter(([, remaining]) => remaining > 0)
    .map(([id, remaining]) => `${remaining}× ${id === "attack" ? "any attack" : actions?.find((candidate) => candidate.id === id)?.name ?? id}`)
    .join(", ");

  return <div className="action-runner">
    {actions === null && <p className="action-runner-status">Loading stat block…</p>}
    {blockedPrompt && <div className="action-blocked" role="alertdialog" aria-label="Rules check">
      <span><strong>Blocked:</strong> {blockedPrompt.blocked.message}</span>
      <div className="action-blocked-actions">
        <Button type="button" variant="secondary" onClick={() => clearBlockedPrompt()}>Cancel</Button>
        <button type="button" className="encounter-primary" onClick={async () => { const pending = blockedPrompt; clearBlockedPrompt(); const reason = await prompt({ title: "Override reason", body: "Logged for the table.", defaultValue: "GM override", confirmLabel: "Override" }); pending.retry({ reason: reason || "GM override" }); }}>Override</button>
      </div>
    </div>}
    {attacksLeft > 0 && !picking && instance && <p className="action-instance-note" role="status">Remaining in this action: {componentLabel(instance)}.</p>}
    {actions && !picking && (() => {
      // Three tiers of prominence: the stat block's own rollable actions are the working surface
      // (full rows); the shared builtin catalog (Dodge, Dash, Unarmed Strike, ...) is one wrapped
      // cluster of small chips - the same 16 actions on every creature don't earn 16 rows; prose
      // traits collapse behind one line (the sheet always has the full text).
      const own = actions.filter((action) => isResolvable(action) && action.builtin !== true);
      const builtins = actions.filter((action) => isResolvable(action) && action.builtin === true);
      const reference = actions.filter((action) => !isResolvable(action));
      // Spellcasting is the reference entry the GM actually reads mid-fight - hoist it out of the
      // collapsed "Traits & reference" group and show it open by default (report #10).
      const spellcasting = reference.find((action) => action.id === "spellcasting" || /spellcasting/i.test(action.name));
      const otherReference = reference.filter((action) => action !== spellcasting);
      return <>
        <ul className="action-list">
          {own.map((action) => {
            const hint = availabilityHint(state, actor, action);
            const parts = summaryParts(action, actions);
            return <li key={action.id}>
              <button type="button" className={`action-row${hint ? " action-row-hinted" : ""}`} disabled={busy} title={action.description} onClick={() => isTargetless(action) ? useDirect(action) : beginTargeting(action, actor.id)}>
                <strong className="action-row-name">{action.name}</strong>
                {parts.length > 0
                  ? <ul className="action-row-summary">{parts.map((part) => <li key={part}>{part}</li>)}</ul>
                  : <span className="action-row-summary-note">{action.grants ? "Grants an effect" : "Tap to use"}</span>}
                {hint ? <span className="action-hint">{hint}</span> : null}
              </button>
            </li>;
          })}
        </ul>
        {builtins.length > 0 && (() => {
          const primary = PRIMARY_BUILTINS.flatMap((id) => builtins.filter((action) => action.id === id));
          const rest = builtins.filter((action) => !(PRIMARY_BUILTINS as readonly string[]).includes(action.id));
          const shown = moreBuiltins ? [...primary, ...rest] : primary.length > 0 ? primary : builtins;
          return <div className="builtin-actions" role="group" aria-label="Common actions">
            <span className="builtin-actions-label">Common</span>
            {shown.map((action) => {
              const hint = availabilityHint(state, actor, action);
              return <button key={action.id} type="button" className={`builtin-chip${hint ? " hinted" : ""}`} disabled={busy} title={`${action.description}${hint ? `\n\n${hint}` : ""}`} onClick={() => isTargetless(action) ? useDirect(action) : beginTargeting(action, actor.id)}>{action.name}</button>;
            })}
            {rest.length > 0 && primary.length > 0 && <button type="button" className="builtin-chip builtin-more" aria-expanded={moreBuiltins} onClick={() => setMoreBuiltins((current) => !current)}>{moreBuiltins ? "Less ▴" : `More ▾`}</button>}
          </div>;
        })()}
        {spellcasting && <div className="action-spellcasting" role="group" aria-label="Spellcasting">
          <div className="action-spellcasting-head"><span aria-hidden="true">✦</span> <strong>{spellcasting.name}</strong></div>
          <SpellcastingText text={spellcasting.description} />
        </div>}
        {otherReference.length > 0 && <details className="action-reference-group">
          <summary>Traits &amp; reference ({otherReference.length})</summary>
          <ul className="action-list">
            {otherReference.map((action) => <li key={action.id}>
              <button type="button" className="action-row action-row-static" aria-expanded={openReference === action.id} onClick={() => setOpenReference((current) => current === action.id ? null : action.id)}>
                <strong>{action.name}</strong><small>{action.activation === "other" ? "click to read" : `${action.activation} · click to read`}</small>
              </button>
              {openReference === action.id && <div className="action-reference-text"><RichText text={action.description} /></div>}
            </li>)}
          </ul>
        </details>}
      </>;
    })()}
    {picking && !result?.preview && <div className="action-targeting" role="group" aria-label={`Targets for ${picking.action.name}`}>
      {picking.mode === "template"
        ? <p className="action-targeting-head"><strong>{picking.action.name}</strong> - drag the {picking.action.area?.sizeFeet}-ft {picking.action.area?.shape} on the map{picking.template?.placed ? " (placed - Roll to resolve)" : ", then Roll"}. Everyone under it is caught automatically.</p>
        : <>
            <p className="action-targeting-head"><strong>{picking.action.name}</strong> - {picking.mode === "single" ? "choose one target (or click a token)" : "choose targets (or click tokens)"}</p>
            <ul className="action-target-list scroll-y">{combatants.filter((target) => target.id !== actor.id).map((target) => {
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
        <Button type="button" variant="secondary" disabled={resolveBusy} onClick={() => clearTargeting()}>Back</Button>
        <button type="button" className="encounter-primary" disabled={resolveBusy || (picking.mode === "template" ? !picking.template?.placed : picking.selected.length === 0)} onClick={resolve}>Roll {picking.action.name}</button>
      </div>
    </div>}
    {result && <div className="action-result" role="status">
      <div className="action-result-head">
        <strong>{result.actionName}</strong>
        <div className="action-result-actions">
          {/* An open compound action (Extra Attack / Multiattack) continues from here; anything else
              re-resolves through the rules check, where strict mode offers the audited override. */}
          {!result.preview && (() => { const again = actions?.find((candidate) => candidate.name === result.actionName); return again ? <button type="button" className="action-again" disabled={busy || resolveBusy} title="Resolve this action again" onClick={() => beginTargeting(again, actor.id)}>↻ Again</button> : null; })()}
          <button type="button" className="secondary action-result-close" aria-label={result.preview ? "Cancel roll" : "Dismiss result"} onClick={() => { setTargetingResult(null); if (result.preview) clearTargeting(); }}>✕</button>
        </div>
      </div>
      {result.overridden && <p className="action-overridden">Override ({result.overridden.rule}): {result.overridden.reason}</p>}
      {result.rollMode && <p className="action-rollmode">{result.rollMode.mode === "normal" ? "Advantage and disadvantage cancel" : result.rollMode.mode === "advantage" ? "Advantage" : "Disadvantage"}: {[...result.rollMode.advantage, ...result.rollMode.disadvantage].join(", ")}</p>}
      {result.attack && <p className={`action-outcome outcome-${result.attack.outcome}`}>
        {result.attack.total}{result.attack.targetAc !== null ? ` vs AC ${result.attack.targetAc}` : ""} - {result.attack.outcome === "crit" ? "CRITICAL HIT" : result.attack.outcome === "fumble" ? "NATURAL 1" : result.attack.outcome === "unknown" ? "no AC on record" : result.attack.outcome.toUpperCase()} (nat {result.attack.naturalRoll}) vs {result.attack.targetName}
      </p>}
      {/* Attack PREVIEW: the same roll experience as a saving throw - Adv/Disadv re-roll the d20, a typed
          d20 is the manual path, and Confirm resolves the hit for real (damage, riders, economy). */}
      {result.preview && result.attack && (() => {
        const previewResolve = (opts: ResolveOptions) => resolveTargeting(state.revision, onOutcome, opts);
        // Any auto control (Adv/Disadv/Re-roll) abandons a pending manual entry.
        const autoPreview = (opts: ResolveOptions) => { setManualSubmitted(false); previewResolve(opts); };
        const mode = result.rollMode?.mode;
        // Roll mode drives the layout: auto shows just the roll controls; manual adds a labeled
        // "type the d20" zone under an "or" divider so the two paths read distinctly (feedback #1).
        const manualEntry = rollMode === "manual";
        const submitDie = () => { const value = Number(attackDieEdit.trim()); if (!Number.isInteger(value) || value < 1 || value > 20) { onFeedback("Enter the attack d20 (1-20)."); return; } setManualSubmitted(true); previewResolve({ commit: false, attackNatural: value }); };
        return <div className="action-preview">
          <div className="roll-zone">
            <span className="save-prompt-confirm">
              <button type="button" className={`save-die-mode${mode === "advantage" ? " active" : ""}`} disabled={resolveBusy} title="Roll two d20s and keep the higher" onClick={() => autoPreview({ commit: false, rollMode: "advantage" })}>Adv</button>
              <button type="button" className={`save-die-mode${mode === "disadvantage" ? " active" : ""}`} disabled={resolveBusy} title="Roll two d20s and keep the lower" onClick={() => autoPreview({ commit: false, rollMode: "disadvantage" })}>Disadv</button>
              <button type="button" className="encounter-primary" disabled={resolveBusy} onClick={() => previewResolve({ commit: true, attackNatural: result.attack!.naturalRoll })}>Confirm {result.attack!.outcome === "crit" ? "crit" : result.attack!.outcome === "hit" || result.attack!.outcome === "unknown" ? "hit" : result.attack!.outcome === "fumble" ? "miss" : result.attack!.outcome}</button>
              <Button type="button" variant="secondary" disabled={resolveBusy} title="Roll the attack again" onClick={() => autoPreview({ commit: false })}>Re-roll</Button>
            </span>
            {manualEntry && <span className="roll-zone-caption">auto-roll</span>}
          </div>
          {manualEntry && <>
            <div className="roll-or"><span>or</span></div>
            <div className="roll-zone">
              <span className="roll-zone-caption">manual entry</span>
              <span className="save-prompt-manual">
                <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="type the d20" aria-label="Attack d20" value={attackDieEdit} disabled={manualSubmitted} onChange={(event) => setAttackDieEdit(event.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && !manualSubmitted && attackDieEdit.trim() !== "") submitDie(); }} />
                {/* "Use roll" sits on its own right-aligned row under the full-width field; once used it becomes Confirm/Re-roll. */}
                <span className="manual-actions">{manualSubmitted
                  ? <><button type="button" className="encounter-primary" disabled={resolveBusy} onClick={() => previewResolve({ commit: true, attackNatural: Number(attackDieEdit.trim()) })}>Confirm roll</button><Button type="button" variant="secondary" disabled={resolveBusy} title="Enter a different d20" onClick={() => { setAttackDieEdit(""); setManualSubmitted(false); }}>Re-roll</Button></>
                  : <button type="button" disabled={resolveBusy || attackDieEdit.trim() === ""} onClick={submitDie}>Use roll</button>}</span>
              </span>
            </div>
          </>}
        </div>;
      })()}
      {result.save && <p className="action-outcome">Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save</p>}
      {result.effectGranted && <p className="action-effect-granted">{actor.name} gains <strong>{result.effectGranted.name}</strong>.</p>}
      {result.effectsApplied?.map((appliedEffect) => <p key={`${appliedEffect.targetId}-${appliedEffect.name}`} className="action-effect-applied">{appliedEffect.targetName} is <strong>{appliedEffect.name}</strong>.</p>)}
      {result.damage.length > 0 && (() => {
        // When the GM has typed a manual amount in the apply field, the headline reflects THAT number
        // (what will be applied), not the stale rolled total - the rolled value is kept for reference.
        const typed = damageEdit !== null && damageEdit.trim() !== "" ? Number(damageEdit) : null;
        const overriding = typed !== null && Number.isFinite(typed) && typed >= 0 && typed !== result.damageTotal;
        const breakdown = [
          ...result.damage.map((part) => `${part.formula} ${part.type} = ${part.total}`),
          ...(result.bonusDamage ?? []).map((part) => `+${part.amount} ${part.source}`)
        ].join(" + ");
        return <p className="action-damage">Damage: <strong>{overriding ? typed : result.damageTotal}</strong>{overriding ? ` (manual - rolled ${result.damageTotal})` : ` (${breakdown})`}{!overriding && result.crit ? " - crit dice doubled" : ""}</p>;
      })()}
      {result.attack && (result.attack.outcome === "crit" || result.attack.outcome === "hit" || result.attack.outcome === "unknown") && result.damageTotal > 0 && (() => {
        // A reaction window (Uncanny Dodge) parked this damage on a prompt: the answer applies it
        // server-side, so the apply button never shows for this target - that would double-apply.
        const prompt = result.reactionPrompts?.find((candidate) => candidate.actorId === result.attack!.targetId);
        if (prompt) {
          const waiting = state.combat.pendingReactions.some((reaction) => reaction.actorId === result.attack!.targetId && reaction.sourceActorId === actor.id);
          return waiting
            ? <p className="action-save-note">Waiting on {result.attack.targetName}'s <strong>{prompt.actionName}</strong> - answer it in the turn order; the damage applies there.</p>
            : <p className="action-applied">{prompt.actionName} answered - damage handled in the turn order.</p>;
        }
        return applied.has(result.attack.targetId)
          ? <p className="action-applied">Applied to {result.attack.targetName}.</p>
          : <span className="action-apply-group">
              {/* The rolled total is pre-filled; type over it to apply a hand-rolled number instead. */}
              <input type="text" inputMode="numeric" pattern="[0-9]*" className="action-damage-edit" aria-label="Damage to apply" value={damageEdit ?? String(result.damageTotal)} onChange={(event) => setDamageEdit(event.target.value.replace(/[^0-9]/g, ""))} />
              <button type="button" className="action-apply" disabled={busy} onClick={() => applyDamage(result.attack!.targetId, result.attack!.targetName, result.attack!.targetId, damageEdit === null || damageEdit === "" ? result.damageTotal : Number(damageEdit))}>Apply to {result.attack!.targetName}</button>
            </span>;
      })()}
      {result.warnings?.map((warning) => <p key={warning} className="action-warning">⚠ {warning}</p>)}
      {/* The table's own lines (an accomplished push, the save a Topple forced). NOT warnings: these
          are things that HAPPENED, and every one of them is also a row in the feed the whole table
          reads - so the card and the log say the same sentence rather than the card saying it alone.
          Safe to render whole here: this payload is the ack to the attacker's own resolve, and a
          line only ever names the attacker (whom the caller is acting as) and the single target the
          server already cleared them to act on (`canPlayerTarget`, `game-operations.ts`). */}
      {result.tableNarration?.map((line) => <p key={line.text} className="action-narration">{line.text}</p>)}
      {result.save && (() => {
        // Reflect the LIVE count of unanswered saves for this action (matched by attacker + action),
        // not the frozen resolve-time count - so the note clears as each save is answered in the tracker.
        const waiting = state.combat.pendingSaves.filter((save) => save.sourceActorId === actor.id && save.actionName === result.actionName).length;
        return waiting > 0
          ? <p className="action-save-note">Saving-throw {waiting === 1 ? "prompt is" : "prompts are"} waiting on {waiting} {waiting === 1 ? "target" : "targets"} in the turn order - roll or enter each result there, then confirm to apply.</p>
          : <p className="action-save-note resolved">All saving throws for {result.actionName} resolved.</p>;
      })()}
      {result.componentsRemaining && Object.values(result.componentsRemaining).some((remaining) => remaining > 0) && <p className="action-result-hint">Remaining: {componentLabel(result.componentsRemaining)} - tap <strong>↻ Again</strong> or pick the next attack from the list below.</p>}
    </div>}
    {dialog}
  </div>;
}
