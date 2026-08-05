import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActionResolution, ActorDefinition, ClientToServerEvents, ContentActionSummary, DeathSaveResult, DeathSaves, GmView, MutationResult, PendingDamage, PendingReaction, PendingSave, PlayerEffect, PlayerPendingReaction, PlayerPendingSave, ReactionAnswerResult, SaveAnswerResult, PlayerView } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { Chip, Button, Select, Input, Switch } from "@vtt/ui";
import { newId } from "../lib/ids";
import { ActionRunner } from "./ActionRunner";
import { AskTheGmPrompt, MyPendingAsks, PendingAsksForGm } from "./RuleAsk";
import { beginTargeting, clearTargeting, resolveActionDirect, resolveTargeting, setTargetingResult, toggleTarget, useTargeting, useTargetingBusy, useTargetingResult } from "./targeting";
import { useRollPreference } from "../dice/roll-preference";
import { RollControls, type DieMode } from "./RollControls";
import { CharacterSheet } from "./CharacterSheet";
import { ConditionChips, ConditionDots, ConditionEditor } from "./conditions";
import { InitiativeRow } from "./InitiativeList";
import { initialsOf } from "../scene/mapImage";
import { MonsterBrowser } from "./MonsterBrowser";
import { ScenePrepPanel } from "../scenes/ScenePrepPanel";
import type { PickerMap } from "../maps/MapPicker";
import { socket } from "../socket";
import "./encounter-panel.css";
import { useConfirm } from "../components/feedback";

type CommandEvent = "encounter:start" | "encounter:end" | "encounter:add-combatant" | "initiative:set" | "initiative:next" | "initiative:previous" | "actor:remove" | "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp" | "turn:use" | "turn:use-reaction" | "turn:use-legendary" | "turn:end" | "scene:activate" | "scene:create";
type CommandPayload = Parameters<ClientToServerEvents[CommandEvent]>[0];
const emitMutation = socket.emit.bind(socket) as unknown as (event: CommandEvent, payload: CommandPayload, acknowledgement: (result: MutationResult) => void) => void;

function emitCommand(event: CommandEvent, payload: CommandPayload) {
  return new Promise<MutationResult>((resolve) => emitMutation(event, payload, resolve));
}

const validInitiativeScore = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= -1000 && Number(value) <= 1000;

export const DOCK_POSITIONS = ["sidebar", "left", "right"] as const;
export type DockPosition = (typeof DOCK_POSITIONS)[number];
type DockControl = Readonly<{ position: DockPosition; onChange: (position: DockPosition) => void }>;
type GmProps = Readonly<{ role: "gm"; state: GmView; selectedMap: MapSelection | null; mapLibrary?: readonly MapSelection[]; onSelectMap?: (map: MapSelection | null) => void; dock?: DockControl }>;
type PlayerProps = Readonly<{ role: "player"; state: PlayerView; dock?: DockControl }>;

// The glyph is a square with the shaded half showing which edge the panel lands on (left/right),
// plus a "sidebar" option that pops it back out beside the map. Width is adjustable by dragging the
// docked panel's inner edge (see EncounterMap's resize strip).
const DOCK_CHOICES: ReadonlyArray<{ value: DockPosition; glyph: string; label: string }> = [
  { value: "left", glyph: "◧", label: "Dock left of the map" },
  { value: "right", glyph: "◨", label: "Dock right of the map" },
  { value: "sidebar", glyph: "▦", label: "Move back to the sidebar" }
];
// Compact position picker on its own row (never competes with the title for width). Each docked
// edge is a fixed rem size, so the panel no longer reflows when the browser window is resized.
function DockPicker({ dock }: Readonly<{ dock?: DockControl }>) {
  if (!dock) return null;
  return <div className="encounter-dock-picker" role="group" aria-label="Panel position">
    <span className="encounter-dock-label">Dock</span>
    {DOCK_CHOICES.map((choice) => <button key={choice.value} type="button" className="encounter-dock-choice" aria-pressed={dock.position === choice.value} aria-label={choice.label} title={choice.label} onClick={() => dock.onChange(choice.value)}>{choice.glyph}</button>)}
  </div>;
}

/**
 * A saving throw a combatant still owes, rendered inside its initiative row. Roll = the server rolls
 * d20 + its best-known modifier; the typed total covers proficient/situational saves. The outcome
 * auto-applies server-side (fail: damage + condition; success: half or none) and the prompt clears.
 */
function SavePrompt({ save, targetName, canDismiss, onFeedback, rollMode, legendaryResistanceLeft }: Readonly<{ save: PendingSave | PlayerPendingSave; targetName: string; canDismiss: boolean; onFeedback: (text: string) => void; rollMode: "auto" | "manual"; /** Remaining Legendary Resistance uses (GM view of a legendary target only) - offers "succeed instead" after a previewed failure. */ legendaryResistanceLeft?: number }>) {
  const [busy, setBusy] = useState(false);
  // A rolled-but-not-yet-applied result: the server records the die and returns the projected outcome,
  // so we can show it and let the answerer confirm rather than auto-resolving on the Roll click.
  const [rolled, setRolled] = useState<{ total: number; success: boolean; damage: number; condition: boolean; mode?: DieMode } | null>(null);
  // Outcome feedback goes to the parent: committing removes this prompt from state, so the component
  // unmounts before it could show its own result. `dieMode` is the answerer's explicit adv/disadv.
  const send = (method: "roll" | "manual", total: number | undefined, commit: boolean, legendaryResistance = false, dieMode?: DieMode) => {
    setBusy(true);
    socket.emit("save:answer", { commandId: newId(), saveId: save.id, method, commit, ...(legendaryResistance ? { legendaryResistance } : {}), ...(total !== undefined ? { total } : {}), ...(dieMode ? { rollMode: dieMode } : {}) }, (result: SaveAnswerResult) => {
      setBusy(false);
      if (!result.ok) { onFeedback(result.message ?? "The saving throw could not be answered."); return; }
      const outcome = result.outcome;
      if (!outcome) return;
      if (!outcome.committed) { setRolled({ total: outcome.total, success: outcome.success, damage: outcome.appliedDamage, condition: outcome.conditionApplied, mode: outcome.rollMode?.mode }); return; }
      onFeedback(`${targetName} ${outcome.success ? "succeeded" : "failed"} (${outcome.total} vs DC ${outcome.dc})${outcome.appliedDamage > 0 ? ` - ${outcome.appliedDamage} damage applied` : ""}${outcome.conditionApplied ? " - condition applied" : ""}.`);
    });
  };
  const dismiss = () => {
    setBusy(true);
    socket.emit("save:dismiss", { commandId: newId(), saveId: save.id }, (result: MutationResult) => {
      setBusy(false);
      onFeedback(result.ok ? "Saving throw dismissed." : result.message ?? "The saving throw could not be dismissed.");
    });
  };
  return <div className="save-prompt" role="group" aria-label={`Saving throw for ${targetName}`}>
    <span className="save-prompt-label"><strong>DC {save.dc} {save.ability.toUpperCase()}</strong> vs {save.actionName} ({save.sourceName}){save.proposedDamage > 0 ? ` · ${save.proposedDamage} dmg` : ""}</span>
    <RollControls
      rollMode={rollMode} busy={busy} rolled={rolled !== null} currentMode={rolled?.mode}
      manualLabel="Rolled save total" onInvalidManual={onFeedback}
      onRoll={(mode) => send("roll", undefined, false, false, mode)}
      onManual={(total) => send("manual", total, true)}
      onConfirm={() => rolled && send("manual", rolled.total, true)}
      onReroll={() => setRolled(null)}
      onDismiss={canDismiss ? dismiss : undefined}
      summary={rolled ? <>
        {/* Reveal the rolled total and what it will do; an explicit Confirm applies it. */}
        <strong className={rolled.success ? "save-pass" : "save-fail"}>Rolled {rolled.total}{rolled.mode && rolled.mode !== "normal" ? ` (${rolled.mode === "advantage" ? "adv" : "disadv"})` : ""} - {rolled.success ? "Success" : "Failure"}</strong>
        <span className="save-prompt-effect">{rolled.damage > 0 ? `${rolled.damage} dmg` : "no damage"}{rolled.condition ? " + condition" : ""}</span>
      </> : undefined}
      extraActions={rolled && !rolled.success && (legendaryResistanceLeft ?? 0) > 0
        ? <button type="button" className="save-legendary" disabled={busy} title="SRD Legendary Resistance: when it fails a save, it can choose to succeed instead" onClick={() => send("manual", rolled.total, true, true)}>Legendary Resistance ({legendaryResistanceLeft} left)</button>
        : undefined}
    />
  </div>;
}

/**
 * A reaction window awaiting an answer (Uncanny Dodge): the triggering hit's damage is parked on the
 * prompt, so BOTH buttons apply it - Use spends the reaction and halves each part, Decline applies it
 * in full. The shown numbers are before resistances; the server reports the final applied total. The
 * GM's ✕ dismisses without applying, for damage already entered by hand.
 */
function ReactionPrompt({ reaction, actorName, canDismiss, onFeedback, rollMode }: Readonly<{ reaction: PendingReaction | PlayerPendingReaction; actorName: string; canDismiss: boolean; onFeedback: (text: string) => void; rollMode: "auto" | "manual" }>) {
  const [busy, setBusy] = useState(false);
  const opportunity = reaction.kind === "leaves-reach";
  // An opportunity attack previewed but not yet applied: the swing was rolled, the reactor confirms
  // (or re-rolls adv/disadv, or types a d20) - the same roll experience as a saving throw.
  const [rolled, setRolled] = useState<{ attack: NonNullable<ActionResolution["attack"]>; mode?: DieMode } | null>(null);
  const [dieEdit, setDieEdit] = useState("");
  const autoRolled = useRef(false);
  const halved = reaction.proposedDamageParts.reduce((sum, part) => sum + Math.floor(part.amount / 2), 0);
  // `use` distinguishes the swing (Attack) from letting the mover go; the opts drive the OA preview flow.
  const answer = (use: boolean, opts: { commit?: boolean; rollMode?: DieMode; attackNatural?: number } = {}) => {
    setBusy(true);
    socket.emit("reaction:answer", { commandId: newId(), reactionId: reaction.id, use, ...opts }, (result: ReactionAnswerResult) => {
      setBusy(false);
      if (!result.ok) { onFeedback(result.message ?? "The reaction could not be answered."); return; }
      const outcome = result.outcome;
      if (!outcome) return;
      if (opportunity) {
        // A preview keeps the prompt open and shows the swing for confirm/adv-disadv; an applied answer clears it.
        if (outcome.resolution?.preview && outcome.resolution.attack) { setRolled({ attack: outcome.resolution.attack, mode: outcome.resolution.rollMode?.mode }); return; }
        setRolled(null);
        const attack = outcome.resolution?.attack;
        onFeedback(use
          ? `${actorName}'s opportunity attack: ${attack ? `${attack.outcome.toUpperCase()} (${attack.total})` : "resolved"}${outcome.appliedDamage > 0 ? ` - ${outcome.appliedDamage} damage` : ""}.`
          : `${actorName} let ${reaction.sourceName} go.`);
      } else {
        onFeedback(use ? `${actorName} used ${reaction.actionName} - ${reaction.proposedDamage} damage became ${outcome.appliedDamage}.` : `${actorName} took ${outcome.appliedDamage} damage.`);
      }
    });
  };
  // Auto mode rolls the opportunity swing the moment the prompt appears (still a preview to confirm).
  useEffect(() => {
    if (opportunity && rollMode === "auto" && !rolled && !autoRolled.current) { autoRolled.current = true; answer(true, { commit: false }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunity, rollMode, rolled]);
  const submitDie = () => { const value = Number(dieEdit.trim()); if (!Number.isInteger(value) || value < 1 || value > 20) { onFeedback("Enter the attack d20 (1-20)."); return; } answer(true, { commit: false, attackNatural: value }); };
  const dismiss = () => {
    setBusy(true);
    socket.emit("reaction:dismiss", { commandId: newId(), reactionId: reaction.id }, (result: MutationResult) => {
      setBusy(false);
      onFeedback(result.ok ? "Reaction prompt dismissed - nothing applied." : result.message ?? "The prompt could not be dismissed.");
    });
  };
  const hit = rolled ? rolled.attack.outcome === "hit" || rolled.attack.outcome === "crit" : false;
  return <div className="save-prompt reaction-prompt" role="group" aria-label={`Reaction for ${actorName}`}>
    <span className="save-prompt-label">
      {opportunity
        ? <><strong>Opportunity Attack</strong> - {reaction.sourceName} is leaving reach</>
        : <><strong>{reaction.actionName}</strong> vs {reaction.sourceName}{reaction.critical ? " (crit)" : ""} · {reaction.proposedDamage} dmg incoming</>}
    </span>
    {opportunity && rolled
      // The swing is rolled: confirm it (applies the hit), re-roll adv/disadv, type a d20, or let them go.
      ? <span className="save-prompt-confirm">
          <strong className={hit ? "save-pass" : "save-fail"}>Rolled {rolled.attack.total}{rolled.mode && rolled.mode !== "normal" ? ` (${rolled.mode === "advantage" ? "adv" : "disadv"})` : ""}{rolled.attack.targetAc !== null ? ` vs AC ${rolled.attack.targetAc}` : ""} - {rolled.attack.outcome === "crit" ? "CRIT" : rolled.attack.outcome.toUpperCase()} (nat {rolled.attack.naturalRoll})</strong>
          <button type="button" className={`save-die-mode${rolled.mode === "advantage" ? " active" : ""}`} disabled={busy} title="Roll two d20s and keep the higher" onClick={() => answer(true, { commit: false, rollMode: "advantage" })}>Adv</button>
          <button type="button" className={`save-die-mode${rolled.mode === "disadvantage" ? " active" : ""}`} disabled={busy} title="Roll two d20s and keep the lower" onClick={() => answer(true, { commit: false, rollMode: "disadvantage" })}>Disadv</button>
          <button type="button" className="encounter-primary" disabled={busy} onClick={() => answer(true, { commit: true, attackNatural: rolled.attack.naturalRoll })}>Confirm {hit ? "hit" : "miss"}</button>
          <Button type="button" variant="secondary" disabled={busy} title="Roll the swing again" onClick={() => answer(true, { commit: false })}>Re-roll</Button>
          <span className="save-prompt-manual"><input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="or type the d20" aria-label="Attack d20" value={dieEdit} onChange={(event) => setDieEdit(event.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && dieEdit.trim() !== "") submitDie(); }} /><button type="button" disabled={busy || dieEdit.trim() === ""} onClick={submitDie}>Use</button></span>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => { setRolled(null); answer(false); }}>Let them go</Button>
        </span>
      : <span className="save-prompt-actions">
          {opportunity
            ? <>
                <button type="button" className="save-prompt-roll" disabled={busy} title="Roll one melee attack against the mover" onClick={() => answer(true, { commit: false })}>Attack</button>
                <button type="button" disabled={busy} title="Keep the reaction; the mover leaves freely" onClick={() => answer(false)}>Let them go</button>
              </>
            : <>
                <button type="button" className="save-prompt-roll" disabled={busy} title="Spend the reaction; halved before resistances" onClick={() => answer(true)}>Use - take {halved}</button>
                <button type="button" disabled={busy} title="Keep the reaction; full damage before resistances" onClick={() => answer(false)}>Decline - take {reaction.proposedDamage}</button>
              </>}
          {canDismiss && <button type="button" className="save-prompt-dismiss" disabled={busy} title="Dismiss without applying anything" onClick={dismiss}>✕</button>}
        </span>}
  </div>;
}

/** A player's own pending reaction prompts with a local feedback line (the GM panel uses its shared message). */
function OwnReactionPrompts({ reactions, actorName, rollMode }: Readonly<{ reactions: readonly PlayerPendingReaction[]; actorName: string; rollMode: "auto" | "manual" }>) {
  const [feedback, setFeedback] = useState("");
  if (reactions.length === 0 && !feedback) return null;
  return <div className="own-save-prompts">
    {reactions.map((reaction) => <ReactionPrompt key={reaction.id} reaction={reaction} actorName={actorName} canDismiss={false} onFeedback={setFeedback} rollMode={rollMode} />)}
    {feedback && <p className="save-prompt-outcome" role="status">{feedback}</p>}
  </div>;
}

/**
 * Active rules-engine effects (Rage, a grapple) as chips beside the condition chips. Ending one is
 * a real engine transition - linked conditions clear and on-end grants fire server-side (ADR-0020).
 */
function EffectChips({ actorId, effects, canEnd, onFeedback }: Readonly<{ actorId: string; effects: ReadonlyArray<PlayerEffect & { escapeDc?: number | null }>; canEnd: boolean; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  if (effects.length === 0) return null;
  const durationLabel = (effect: PlayerEffect) => effect.duration.type === "rounds" ? `${effect.duration.remaining} rounds left` : effect.duration.type === "until-source-next-turn" ? "until next turn" : effect.duration.type === "encounter" ? "this encounter" : "until ended";
  const end = (effectId: string, name: string) => {
    setBusy(true);
    socket.emit("effect:end", { commandId: newId(), actorId, effectId }, (result: MutationResult) => {
      setBusy(false);
      onFeedback(result.ok ? `${name} ended.` : result.message ?? "The effect could not be ended.");
    });
  };
  return <span className="effect-chips">
    {effects.map((effect) => <Chip key={effect.id} tone="info" title={`${effect.name}${effect.sourceName ? ` - from ${effect.sourceName}` : ""} · ${durationLabel(effect)}${effect.escapeDc ? ` · escape DC ${effect.escapeDc}` : ""}`} onRemove={canEnd ? () => { if (!busy) end(effect.id, effect.name); } : undefined} removeLabel={`End ${effect.name}`}>
      {effect.name}{effect.escapeDc ? <small> DC {effect.escapeDc}</small> : null}
    </Chip>)}
  </span>;
}

type DeathPreview = NonNullable<DeathSaveResult["deathSave"]>;

/**
 * A dying character's death-save tracker (ADR-0020): success/failure pips plus the roll - the
 * replay's "heal 1 HP so the turn isn't skipped" workaround, replaced by the real state machine.
 *
 * The roll rides the shared RollControls widget, so a death save behaves exactly like a saving throw
 * (roll, see the projected pips, confirm; Adv/Disadv re-roll; or type an off-screen d20). In auto mode
 * it rolls itself the moment the dying creature's turn comes up, matching 5e's start-of-turn timing.
 */
function DyingTracker({ actorId, name, deathSaves, canRoll, onFeedback, rollMode, isActingTurn }: Readonly<{ actorId: string; name: string; deathSaves: DeathSaves; canRoll: boolean; onFeedback: (text: string) => void; rollMode: "auto" | "manual"; isActingTurn: boolean }>) {
  const [busy, setBusy] = useState(false);
  // A rolled-but-unapplied preview: the server reveals the d20 and projected pips; Confirm applies them.
  const [rolled, setRolled] = useState<DeathPreview | null>(null);
  const dead = deathSaves.failures >= 3;
  const send = (commit: boolean, extra: { rollMode?: DieMode; naturalRoll?: number }) => {
    setBusy(true);
    socket.emit("death-save:roll", { commandId: newId(), actorId, commit, ...extra }, (result: DeathSaveResult) => {
      setBusy(false);
      if (!result.ok) { onFeedback(result.message ?? "The death save failed."); return; }
      const outcome = result.deathSave;
      if (!outcome) return;
      if (!outcome.committed) { setRolled(outcome); return; }
      setRolled(null);
      onFeedback(outcome.regainedConsciousness ? `${name} rolled a natural 20 and regains 1 HP!` : outcome.dead ? `${name} died.` : outcome.stable ? `${name} is stable.` : `${name}: ${outcome.successes} successes, ${outcome.failures} failures.`);
    });
  };
  const passed = rolled?.outcome === "success" || rolled?.outcome === "critical-success";
  return <div className="dying-tracker" role="group" aria-label={`Death saves for ${name}`}>
    <span className={`dying-label${dead ? " dead" : ""}`}>{dead ? "Dead" : deathSaves.stable ? "Stable" : "Dying"}</span>
    <span className="dying-pips" aria-label={`${deathSaves.successes} successes, ${deathSaves.failures} failures`}>
      {[0, 1, 2].map((index) => <span key={`s${index}`} className={`pip success${index < deathSaves.successes ? " filled" : ""}`} />)}
      <span className="pip-divider" />
      {[0, 1, 2].map((index) => <span key={`f${index}`} className={`pip failure${index < deathSaves.failures ? " filled" : ""}`} />)}
    </span>
    {canRoll && !deathSaves.stable && !dead && <RollControls
      rollMode={rollMode} autoRoll={rollMode === "auto" && isActingTurn} busy={busy} rolled={rolled !== null} currentMode={rolled?.rollMode}
      manualPlaceholder="or type the d20" manualLabel="Death save d20" manualMin={1} manualMax={20} onInvalidManual={onFeedback}
      onRoll={(mode) => send(false, mode ? { rollMode: mode } : {})}
      onManual={(natural) => send(true, { naturalRoll: natural })}
      onConfirm={() => rolled && send(true, { naturalRoll: rolled.naturalRoll })}
      onReroll={() => setRolled(null)}
      summary={rolled ? <>
        <strong className={passed ? "save-pass" : "save-fail"}>Rolled {rolled.naturalRoll}{rolled.rollMode ? ` (${rolled.rollMode === "advantage" ? "adv" : "disadv"})` : ""} - {rolled.regainedConsciousness ? "Natural 20!" : rolled.naturalRoll === 1 ? "Natural 1" : passed ? "Success" : "Failure"}</strong>
        <span className="save-prompt-effect">{rolled.dead ? "dies" : rolled.stable ? "stabilizes" : rolled.regainedConsciousness ? "back up at 1 HP" : `${rolled.successes}S / ${rolled.failures}F`}</span>
      </> : undefined}
    />}
  </div>;
}

/** A player's own pending saves with a local feedback line (the GM panel uses its shared message instead). */
function OwnSavePrompts({ saves, targetName, rollMode }: Readonly<{ saves: readonly PlayerPendingSave[]; targetName: string; rollMode: "auto" | "manual" }>) {
  const [feedback, setFeedback] = useState("");
  if (saves.length === 0 && !feedback) return null;
  return <div className="own-save-prompts">
    {saves.map((save) => <SavePrompt key={save.id} save={save} targetName={targetName} canDismiss={false} onFeedback={setFeedback} rollMode={rollMode} />)}
    {feedback && <p className="save-prompt-outcome" role="status">{feedback}</p>}
  </div>;
}

/** Player-side wrappers with their own feedback lines (the GM panel routes through its shared message). */
function PlayerEffectRow({ actorId, effects, isMe }: Readonly<{ actorId: string; effects: readonly PlayerEffect[]; isMe: boolean }>) {
  const [feedback, setFeedback] = useState("");
  if (effects.length === 0 && !feedback) return null;
  return <div className="own-effect-row">
    <EffectChips actorId={actorId} effects={effects} canEnd={isMe} onFeedback={setFeedback} />
    {feedback && <p className="save-prompt-outcome" role="status">{feedback}</p>}
  </div>;
}
function OwnDyingTracker({ actorId, name, deathSaves, rollMode, isActingTurn }: Readonly<{ actorId: string; name: string; deathSaves: DeathSaves; rollMode: "auto" | "manual"; isActingTurn: boolean }>) {
  const [feedback, setFeedback] = useState("");
  return <div className="own-dying">
    <DyingTracker actorId={actorId} name={name} deathSaves={deathSaves} canRoll onFeedback={setFeedback} rollMode={rollMode} isActingTurn={isActingTurn} />
    {feedback && <p className="save-prompt-outcome" role="status">{feedback}</p>}
  </div>;
}

/** Map a player's own stat-block action onto the ContentActionSummary the shared targeting store consumes.
 *  Area templates are dropped in v1 (players target by explicit ids; the GM still places AoE templates). */
export function summaryOfOwnAction(action: ActorDefinition["actions"][number]): ContentActionSummary {
  return {
    id: action.id, name: action.name, activation: action.activation, description: action.description,
    attackBonus: action.attack?.bonus ?? null, reachFeet: action.attack?.reachFeet ?? null, rangeFeet: action.attack?.rangeFeet ?? null, rangeNormalFeet: action.attack?.rangeNormalFeet ?? null,
    saveAbility: action.save?.ability ?? null, saveDc: action.save?.dc ?? null,
    damage: action.damage.map((part) => ({ formula: part.formula, type: part.type })),
    area: null, attackCount: action.attack?.count ?? null,
    usesLimit: action.uses?.limit ?? null, usesPer: action.uses?.per ?? null, usesRecharge: action.uses?.recharge ?? null, usesPool: action.uses?.pool ?? null,
    requiresEffectTag: action.requiresEffectTag ?? null,
    multiattack: action.multiattack ? action.multiattack.map((component) => ({ actionId: component.actionId, count: component.count })) : null,
    grants: action.grants !== undefined, reaction: action.reaction ?? null
  };
}
const signedBonus = (value: number) => (value >= 0 ? `+${value}` : String(value));
function ownActionSummaryParts(action: ContentActionSummary): string[] {
  const parts: string[] = [];
  if (action.attackBonus !== null) parts.push(`${signedBonus(action.attackBonus)} to hit${action.reachFeet ? `, reach ${action.reachFeet} ft` : action.rangeFeet ? `, range ${action.rangeFeet} ft` : ""}`);
  if (action.attackCount !== null && action.attackCount > 1) parts.push(`${action.attackCount} attacks`);
  if (action.saveAbility !== null) parts.push(`DC ${action.saveDc} ${action.saveAbility.toUpperCase()} save`);
  for (const part of action.damage) parts.push(`${part.formula} ${part.type} damage`);
  // The charge pool, said the way the GM's runner says it - a limited-use feature has no roll to
  // print, so this line IS its mechanic.
  if (action.usesLimit !== null) parts.push(action.usesPer === "recharge" ? `Recharge ${action.usesRecharge}${(action.usesRecharge ?? 6) < 6 ? "-6" : ""}` : `${action.usesLimit}/${action.usesPer === "long-rest" ? "long rest" : action.usesPer === "short-rest" ? "short rest" : action.usesPer}`);
  return parts;
}

/**
 * A player's interactive action console on their own turn - the mirror of the GM's ActionRunner, scoped to
 * their claimed character. Tap a weapon attack or save action, pick the target(s), preview the d20
 * (Adv/Disadv, or a typed physical die), and confirm: the server records the roll and, per the table's
 * player-damage policy, either hands the damage to the GM (proposal) or applies it directly. The player
 * never applies damage themselves, so the role boundary stays intact. Reuses the shared targeting store and
 * the GM runner's styles so both surfaces read and behave identically.
 */
export function PlayerActionRunner({ actorId, definition, extraActions = [], revision, rollMode, bonusMode, playerDamageMode, targets }: Readonly<{ actorId: string; definition: ActorDefinition; /** Actions the SERVER derived from the equipped loadout — a wand's charge, an amulet's cast, a magic weapon's swing. They are absent from `definition.actions` by construction (the definition is the immutable base), so without this the runner cannot offer an item the player has attuned. Their numbers already carry the item's standing riders; resolution still goes by id. */ extraActions?: readonly ContentActionSummary[]; revision: number; rollMode: "auto" | "manual"; bonusMode: "auto" | "total"; playerDamageMode: "proposal" | "direct"; targets: readonly { actorId: string; name: string }[] }>) {
  const [feedback, setFeedback] = useState("");
  const onFeedback = setFeedback;
  // A limited use IS a structured effect the server will resolve (`action-resolution.ts`
  // resolveDefinitionAction), so a player's Action Surge / Relentless Endurance belongs in their own
  // console with a Use tap rather than only in the GM's. It needs no target, exactly as there.
  const actions = useMemo(() => [
    ...definition.actions.filter((action) => action.attack || action.save || action.damage.length > 0 || action.uses !== undefined).map(summaryOfOwnAction),
    // Item-derived, appended rather than merged: they are keyed `item-<inventory id>` and can never
    // collide with a stat-block id, and a player reads their own kit after their own stat block.
    ...extraActions.filter((action) => action.attackBonus !== null || action.saveAbility !== null || action.damage.length > 0 || action.usesLimit !== null)
  ], [definition, extraActions]);
  const isTargetlessOwn = (action: ContentActionSummary) => action.attackBonus === null && action.saveAbility === null && action.damage.length === 0 && action.usesLimit !== null;
  const session = useTargeting();
  const result = useTargetingResult();
  const busy = useTargetingBusy();
  const [attackDie, setAttackDie] = useState("");
  const [manualSubmitted, setManualSubmitted] = useState(false);
  // "Final total" manual mode: the player types their whole total, so a natural 20 (crit) can't be read off
  // the number and is declared with this checkbox (their bonus could make any total a nat-20 crit, or not).
  const [attackNat20, setAttackNat20] = useState(false);
  // Whether the CURRENT preview came from a hand-entered total (vs a rolled/typed natural), so the shared
  // Confirm re-commits with the matching inputs (attackTotal+critical vs attackNatural).
  const [previewIsTotal, setPreviewIsTotal] = useState(false);
  // This runner owns the shared targeting only when the in-progress session is for this character.
  const picking = session && session.attackerId === actorId ? session : null;
  // The turn moved off this character (or the panel closed): drop any in-progress targeting/result.
  useEffect(() => () => { clearTargeting(); setTargetingResult(null); }, []);
  // Reset the manual d20 field only when a NEW preview first appears (not on every adv/disadv re-preview).
  const previewShownRef = useRef(false);
  useEffect(() => {
    const showing = Boolean(result?.preview);
    if (showing && !previewShownRef.current) { setAttackDie(""); setManualSubmitted(false); setAttackNat20(false); setPreviewIsTotal(false); }
    previewShownRef.current = showing;
  }, [result]);

  if (actions.length === 0) return null;
  const onOutcome = (ok: boolean, message?: string) => { if (!ok && message) onFeedback(message); };
  const roll = (opts?: Parameters<typeof resolveTargeting>[2]) => resolveTargeting(revision, onOutcome, opts);

  return <div className="action-runner player-actions">
    {/* The blocked prompt: on Enforce the resolve suppresses its own message (the GM's runner shows a
        dialog instead), and this runner never read that store — so a blocked player used to get a
        button that did nothing at all. Now the refusal is stated here, with the ask beside it. */}
    <AskTheGmPrompt onFeedback={onFeedback} />
    {!picking && !result && <>
      <p className="player-actions-label">Your actions <span>· your turn</span></p>
      <ul className="action-list">
        {actions.map((action) => {
          const parts = ownActionSummaryParts(action);
          return <li key={action.id}>
            <button type="button" className="action-row" disabled={busy} title={action.description} onClick={() => { setTargetingResult(null); if (isTargetlessOwn(action)) resolveActionDirect(actorId, action.id, revision, onOutcome); else beginTargeting(action, actorId); }}>
              <strong className="action-row-name">{action.name}</strong>
              {parts.length > 0 ? <ul className="action-row-summary">{parts.map((part) => <li key={part}>{part}</li>)}</ul> : <span className="action-row-summary-note">Tap to use</span>}
            </button>
          </li>;
        })}
      </ul>
    </>}
    {picking && !result?.preview && <div className="action-targeting" role="group" aria-label={`Targets for ${picking.action.name}`}>
      <p className="action-targeting-head"><strong>{picking.action.name}</strong> - {picking.mode === "single" ? "choose one target" : "choose targets"}</p>
      <ul className="action-target-list">{targets.filter((target) => target.actorId !== actorId).map((target) => {
        const checked = picking.selected.includes(target.actorId);
        return <li key={target.actorId}>
          <label className="action-target">
            <input type={picking.mode === "single" ? "radio" : "checkbox"} name="player-action-target" checked={checked} onChange={() => toggleTarget(target.actorId)} />
            <span>{target.name}</span>
          </label>
        </li>;
      })}</ul>
      <div className="action-targeting-buttons">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => clearTargeting()}>Back</Button>
        <button type="button" className="encounter-primary" disabled={busy || picking.selected.length === 0} onClick={() => roll()}>Roll {picking.action.name}</button>
      </div>
    </div>}
    {result && <div className="action-result" role="status">
      <div className="action-result-head">
        <strong>{result.actionName}</strong>
        <button type="button" className="secondary action-result-close" aria-label={result.preview ? "Cancel roll" : "Dismiss"} onClick={() => { setTargetingResult(null); if (result.preview) clearTargeting(); }}>✕</button>
      </div>
      {result.attack && <p className={`action-outcome outcome-${result.attack.outcome}`}>
        {result.attack.total}{result.attack.targetAc !== null ? ` vs AC ${result.attack.targetAc}` : ""} - {result.attack.outcome === "crit" ? "CRITICAL HIT" : result.attack.outcome === "fumble" ? "NATURAL 1" : result.attack.outcome === "unknown" ? "HIT" : result.attack.outcome.toUpperCase()}{result.attack.naturalRoll >= 1 ? ` (nat ${result.attack.naturalRoll})` : ""} vs {result.attack.targetName}
      </p>}
      {result.preview && result.attack && (() => {
        const mode = result.rollMode?.mode;
        const manualEntry = rollMode === "manual";
        // Manual entry honors the same auto/total bonus toggle as every other roll surface: "auto" types the
        // natural d20 (the server adds the bonus); "total" types the final total (used verbatim vs AC) with a
        // Natural 20 checkbox, since a crit can't be read off a hand-computed total.
        const submitDie = () => { const value = Number(attackDie.trim()); if (!Number.isInteger(value) || value < 1 || value > 20) { onFeedback("Enter the attack d20 (1-20)."); return; } setPreviewIsTotal(false); setManualSubmitted(true); roll({ commit: false, attackNatural: value }); };
        const submitTotal = () => { const value = Number(attackDie.trim()); if (!Number.isInteger(value) || value < -50 || value > 100) { onFeedback("Enter your final attack total."); return; } setPreviewIsTotal(true); setManualSubmitted(true); roll({ commit: false, attackTotal: value, critical: attackNat20 }); };
        // Confirm the SHOWN preview with the inputs that produced it (a hand total keeps its total + crit flag).
        const confirmShown = () => previewIsTotal ? roll({ commit: true, attackTotal: Number(attackDie.trim()), critical: attackNat20 }) : roll({ commit: true, attackNatural: result.attack!.naturalRoll });
        return <div className="action-preview">
          <div className="roll-zone">
            <span className="save-prompt-confirm">
              <button type="button" className={`save-die-mode${mode === "advantage" ? " active" : ""}`} disabled={busy} title="Roll two d20s and keep the higher" onClick={() => { setPreviewIsTotal(false); setManualSubmitted(false); roll({ commit: false, rollMode: "advantage" }); }}>Adv</button>
              <button type="button" className={`save-die-mode${mode === "disadvantage" ? " active" : ""}`} disabled={busy} title="Roll two d20s and keep the lower" onClick={() => { setPreviewIsTotal(false); setManualSubmitted(false); roll({ commit: false, rollMode: "disadvantage" }); }}>Disadv</button>
              <button type="button" className="encounter-primary" disabled={busy} onClick={confirmShown}>Confirm {result.attack!.outcome === "crit" ? "crit" : result.attack!.outcome === "hit" || result.attack!.outcome === "unknown" ? "hit" : "miss"}</button>
              <Button type="button" variant="secondary" disabled={busy} title="Roll the attack again" onClick={() => { setPreviewIsTotal(false); setManualSubmitted(false); roll({ commit: false }); }}>Re-roll</Button>
            </span>
            {manualEntry && <span className="roll-zone-caption">auto-roll</span>}
          </div>
          {manualEntry && <>
            <div className="roll-or"><span>or</span></div>
            <div className="roll-zone">
              <span className="roll-zone-caption">manual entry</span>
              {bonusMode === "total"
                ? <span className="save-prompt-manual">
                    <input type="text" inputMode="numeric" placeholder="type your total" aria-label="Attack total" value={attackDie} disabled={manualSubmitted} onChange={(event) => setAttackDie(event.target.value.replace(/[^0-9-]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && !manualSubmitted && attackDie.trim() !== "") submitTotal(); }} />
                    <label className="manual-nat20"><input type="checkbox" checked={attackNat20} disabled={manualSubmitted} onChange={(event) => setAttackNat20(event.target.checked)} /> Natural 20</label>
                    <span className="manual-actions">{manualSubmitted
                      ? <><button type="button" className="encounter-primary" disabled={busy} onClick={() => roll({ commit: true, attackTotal: Number(attackDie.trim()), critical: attackNat20 })}>Confirm roll</button><Button type="button" variant="secondary" disabled={busy} title="Enter a different total" onClick={() => { setAttackDie(""); setManualSubmitted(false); setAttackNat20(false); }}>Re-roll</Button></>
                      : <button type="button" disabled={busy || attackDie.trim() === ""} onClick={submitTotal}>Use roll</button>}</span>
                  </span>
                : <span className="save-prompt-manual">
                    <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="type the d20" aria-label="Attack d20" value={attackDie} disabled={manualSubmitted} onChange={(event) => setAttackDie(event.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && !manualSubmitted && attackDie.trim() !== "") submitDie(); }} />
                    <span className="manual-actions">{manualSubmitted
                      ? <><button type="button" className="encounter-primary" disabled={busy} onClick={() => roll({ commit: true, attackNatural: Number(attackDie.trim()) })}>Confirm roll</button><Button type="button" variant="secondary" disabled={busy} title="Enter a different d20" onClick={() => { setAttackDie(""); setManualSubmitted(false); }}>Re-roll</Button></>
                      : <button type="button" disabled={busy || attackDie.trim() === ""} onClick={submitDie}>Use roll</button>}</span>
                  </span>}
            </div>
          </>}
        </div>;
      })()}
      {result.save && <p className="action-outcome">Each target: DC {result.save.dc} {result.save.ability.toUpperCase()} save - the GM answers these.</p>}
      {result.damage.length > 0 && !result.preview && (() => {
        const breakdown = [...result.damage.map((part) => `${part.formula} ${part.type} = ${part.total}`), ...(result.bonusDamage ?? []).map((part) => `+${part.amount} ${part.source}`)].join(" + ");
        return <p className="action-damage">Damage: <strong>{result.damageTotal}</strong>{breakdown ? ` (${breakdown})` : ""}{result.crit ? " - crit dice doubled" : ""}</p>;
      })()}
      {/* Players never apply damage: a committed hit is handed to the GM (proposal) or auto-applied (direct)
          - UNLESS the target's reaction (Uncanny Dodge) intercepted it, in which case the server parked a
          reaction prompt instead and the damage resolves in the turn order (mirrors the GM runner). */}
      {!result.preview && result.attack && (result.attack.outcome === "hit" || result.attack.outcome === "crit" || result.attack.outcome === "unknown") && result.damageTotal > 0 && (() => {
        const reactionPrompt = result.reactionPrompts?.find((candidate) => candidate.actorId === result.attack!.targetId);
        if (reactionPrompt) return <p className="action-save-note">Waiting on {result.attack!.targetName}'s <strong>{reactionPrompt.actionName}</strong> - it resolves in the turn order.</p>;
        return <p className="action-save-note">{playerDamageMode === "direct" ? `Applied to ${result.attack!.targetName}.` : `Handed to the GM to apply to ${result.attack!.targetName}.`}</p>;
      })()}
    </div>}
    {feedback && <p className="save-prompt-outcome" role="status">{feedback}</p>}
  </div>;
}

/** A player's own economy: Action/Bonus live only on their turn; the reaction is an off-turn resource, markable any time. Pressed = spent. */
function PlayerTurnEconomy({ combat, myId, myTurn, mySpeedFeet }: Readonly<{ combat: PlayerView["combat"]; myId: string; myTurn: boolean; mySpeedFeet?: number }>) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const emit = (run: () => Promise<MutationResult>, failure: string) => {
    setBusy(true);
    void run().then((result) => { setBusy(false); setFeedback(result.ok ? "" : result.message ?? failure); });
  };
  const reactionUsed = combat.reactionsUsed.includes(myId);
  return <div className="turn-economy" role="group" aria-label="Your turn resources">
    {myTurn && <>
      <button type="button" className="economy-slot" aria-pressed={combat.turn.actionUsed} disabled={busy} onClick={() => emit(() => emitCommand("turn:use", { commandId: newId(), slot: "action", used: !combat.turn.actionUsed }), "The action could not be updated.")}>Action</button>
      <button type="button" className="economy-slot" aria-pressed={combat.turn.bonusActionUsed} disabled={busy} onClick={() => emit(() => emitCommand("turn:use", { commandId: newId(), slot: "bonus-action", used: !combat.turn.bonusActionUsed }), "The bonus action could not be updated.")}>Bonus</button>
    </>}
    <button type="button" className="economy-slot" aria-pressed={reactionUsed} disabled={busy} title="Reactions refresh when your turn starts" onClick={() => emit(() => emitCommand("turn:use-reaction", { commandId: newId(), actorId: myId, used: !reactionUsed }), "The reaction could not be updated.")}>Reaction</button>
    {myTurn && mySpeedFeet !== undefined && <span className="economy-movement" title="Movement spent this turn / base walking speed">Move {Math.round(combat.turn.movementUsedFeet)}/{mySpeedFeet} ft</span>}
    {myTurn && <button type="button" className="encounter-primary turn-end" disabled={busy} onClick={() => emit(() => emitCommand("turn:end", { commandId: newId() }), "The turn could not end.")}>End turn</button>}
    {feedback && <span className="economy-feedback" role="status">{feedback}</span>}
  </div>;
}

/**
 * A player's hit awaiting the GM's Apply tap (proposal mode, the default player-damage policy). The rolled
 * total is pre-filled and editable for a hand-rolled number; Apply reduces the target's HP through the
 * typed-defense pipeline (resistances, dying), ✕ dismisses without applying. Renders under the target's row
 * beside the save/reaction prompts, so the GM answers every player-initiated consequence in one place.
 */
function PendingDamagePrompt({ proposal, onFeedback }: Readonly<{ proposal: PendingDamage; onFeedback: (text: string) => void }>) {
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState<string | null>(null);
  const emit = (apply: boolean) => {
    setBusy(true);
    const typed = amount !== null && amount.trim() !== "" ? Number(amount) : undefined;
    const override = apply && typed !== undefined && Number.isFinite(typed) && typed !== proposal.proposedTotal ? typed : undefined;
    socket.emit("damage:resolve", { commandId: newId(), proposalId: proposal.id, apply, ...(override !== undefined ? { amount: override } : {}) }, (result: MutationResult) => {
      setBusy(false);
      if (!result.ok) onFeedback(result.message ?? "The damage could not be resolved.");
    });
  };
  return <div className="save-prompt pending-damage" role="group" aria-label={`Apply ${proposal.sourceName}'s ${proposal.actionName} to ${proposal.targetName}`}>
    <p className="action-save-note"><strong>{proposal.sourceName}</strong>'s {proposal.actionName} hit {proposal.targetName} for {proposal.proposedTotal}{proposal.critical ? " (crit)" : ""}.</p>
    <span className="action-apply-group">
      <input type="text" inputMode="numeric" pattern="[0-9]*" className="action-damage-edit" aria-label="Damage to apply" value={amount ?? String(proposal.proposedTotal)} disabled={busy} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} />
      <button type="button" className="action-apply" disabled={busy} onClick={() => emit(true)}>Apply to {proposal.targetName}</button>
      <button type="button" className="save-prompt-dismiss" disabled={busy} title="Dismiss without applying" onClick={() => emit(false)}>✕</button>
    </span>
  </div>;
}

/**
 * A player's "roll for initiative" prompt, shown on their own row while their id is in
 * combat.pendingInitiative (the encounter started with player-rolled initiative). Honors the per-browser
 * dice preference: digital rolls on the server (with Adv/Disadv); manual takes a typed physical d20. The
 * server adds the character's initiative modifier and, in wait mode, begins turns once everyone has rolled.
 */
function InitiativePrompt({ actorId }: Readonly<{ actorId: string }>) {
  const { rollInput } = useRollPreference();
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [feedback, setFeedback] = useState("");
  const roll = (payload: { natural?: number; rollMode?: DieMode }) => {
    setBusy(true);
    socket.emit("initiative:roll-self", { commandId: newId(), actorId, ...(payload.natural !== undefined ? { natural: payload.natural } : {}), ...(payload.rollMode ? { rollMode: payload.rollMode } : {}) }, (result: MutationResult) => {
      setBusy(false);
      if (!result.ok) setFeedback(result.message ?? "Initiative could not be rolled.");
    });
  };
  const submitManual = () => { const value = Number(manual.trim()); if (!Number.isInteger(value) || value < 1 || value > 20) { setFeedback("Enter your d20 (1-20)."); return; } roll({ natural: value }); };
  return <div className="save-prompt initiative-prompt" role="group" aria-label="Roll your initiative">
    <p className="save-prompt-label"><strong>Roll for initiative</strong></p>
    {rollInput === "manual"
      ? <span className="save-prompt-actions"><span className="save-prompt-manual"><Input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="type your d20" aria-label="Initiative d20" value={manual} disabled={busy} onChange={(event) => setManual(event.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(event) => { if (event.key === "Enter" && manual.trim() !== "") submitManual(); }} /><Button type="button" variant="secondary" disabled={busy || manual.trim() === ""} onClick={submitManual}>Set</Button></span></span>
      : <span className="save-prompt-confirm">
          <button type="button" className="save-die-mode" disabled={busy} title="Roll two d20s and keep the higher" onClick={() => roll({ rollMode: "advantage" })}>Adv</button>
          <button type="button" className="save-die-mode" disabled={busy} title="Roll two d20s and keep the lower" onClick={() => roll({ rollMode: "disadvantage" })}>Disadv</button>
          <button type="button" className="encounter-primary" disabled={busy} onClick={() => roll({})}>Roll initiative</button>
        </span>}
    {feedback && <p className="save-prompt-outcome" role="status">{feedback}</p>}
  </div>;
}

export function EncounterPanel(props: GmProps | PlayerProps) {
  if (props.role === "player") {
    const { combat } = props.state;
    const myId = props.state.actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null;
    // Bring the active combatant's row into view when the turn advances (report #2). This player
    // branch is a stable early-return per mount, so its hooks run consistently.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const activeRowRef = useRef<HTMLLIElement | null>(null);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => { activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [combat.turnActorId]);
    // v4 #8: toggle this panel between the turn order and the player's own sheet. The embedded sheet now
    // carries live state + combat context so its Actions resolve as real attacks and its rolls show inline.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [view, setView] = useState<"initiative" | "sheet">("initiative");
    // Every roll surface reads the one per-browser dice-input preference (auto vs manual), not the old
    // table-wide combat.rollMode - so this player's saves, death saves, attacks, and sheet all agree.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { rollMode, bonusMode } = useRollPreference();
    // "Jump" sheet-attack mode: tapping an attack on the sheet hops here to pick/confirm, then jumps BACK
    // to the sheet once the attack commits. The flag survives the round-trip; the result effect returns us.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [returnToSheetAfterAttack, setReturnToSheetAfterAttack] = useState(false);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const jumpAttackResult = useTargetingResult();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => { if (returnToSheetAfterAttack && jumpAttackResult && !jumpAttackResult.preview) { setView("sheet"); setReturnToSheetAfterAttack(false); } }, [returnToSheetAfterAttack, jumpAttackResult]);
    const myActor = props.state.actors.find((actor) => actor.id === myId) ?? null;
    if (!combat.active) return <section className="encounter-panel compact" aria-labelledby="player-initiative-title"><span className="eyebrow">FIGHT</span><h2 id="player-initiative-title">Waiting for combat</h2><p>The GM hasn't started a fight yet.</p></section>;
    const myTurn = myId !== null && combat.turnActorId === myId;
    // Active creature on top: rotate the turn order so the acting combatant leads, the rest follow in
    // order (wrapping). The player's own economy rides their row - so on their turn it sits directly
    // under the top/active row (feedback #3), and off-turn it stays with their row as a reaction toggle.
    const activeIndex = combat.initiative.findIndex((entry) => entry.active);
    const orderedInitiative = activeIndex > 0
      ? [...combat.initiative.slice(activeIndex), ...combat.initiative.slice(0, activeIndex)]
      : combat.initiative;
    return <section className="encounter-panel combat-active" aria-label={`Turn order - round ${combat.round}`}>
      <div className="encounter-topbar player">
        <strong className="encounter-round">Round {combat.round}</strong>
        {myActor && <div className="player-view-toggle" role="group" aria-label="Show turn order or your sheet">
          <button type="button" className={view === "initiative" ? "on" : ""} aria-pressed={view === "initiative"} onClick={() => setView("initiative")}>Initiative</button>
          <button type="button" className={view === "sheet" ? "on" : ""} aria-pressed={view === "sheet"} onClick={() => setView("sheet")}>My sheet</button>
        </div>}
        {myTurn && <span className="your-turn-flag" role="status">Your turn - act, then end it below</span>}
        {combat.hiddenTurn && !myTurn && <span className="encounter-quiet-note" role="status">The GM is taking a hidden turn.</span>}
        {combat.rewound && <span className="encounter-quiet-note" role="status">The GM is reviewing an earlier turn.</span>}
      </div>
      {/* Player-rolled initiative: a prominent, view-independent prompt so the player ALWAYS sees the
          call to roll - not buried on their own initiative row (which can be scrolled off, or hidden
          entirely behind the "My sheet" view). It clears itself the moment they roll (their id leaves
          pendingInitiative). */}
      {myId !== null && (combat.pendingInitiative ?? []).includes(myId) && <InitiativePrompt actorId={myId} />}
      {/* Questions this player has waiting. Pinned above the region with the roll prompt, for the same
          reason: an answer you are waiting on should not be something you have to scroll to find. */}
      <MyPendingAsks state={props.state} />
      {/* THE TRACKER'S REGION (B1). In combat this panel is the tallest thing in the sidebar — measured
          at 819px inside a 676px column at 1280x720 — and it had no scroller of its own, so it pushed
          the whole surface past the pane instead of scrolling its own turn order. The topbar above and
          the roll prompt stay pinned as the region's header; everything that can grow lives in here.
          `.scroll-y` is in the markup because that is the marker check (h) accepts.
          The auto-scroll anchors below now scroll THIS region rather than the page, which is the
          behaviour they always wanted. */}
      <div className="encounter-region scroll-y">
      {view === "sheet" && myActor
        ? <CharacterSheet actor={myActor} role="player" state={props.state} embedded combat={{ revision: props.state.revision, active: combat.active, myTurn, playerDamageMode: combat.playerDamageMode, targets: combat.initiative.map((initiativeEntry) => ({ actorId: initiativeEntry.actorId, name: initiativeEntry.name })) }} onJumpToInitiative={() => { setView("initiative"); setReturnToSheetAfterAttack(true); }} onClose={() => setView("initiative")} />
        : <ol className="initiative-list player">{orderedInitiative.map((entry) => {
        const isMe = entry.actorId === myId;
        const rowActor = props.state.actors.find((actor) => actor.id === entry.actorId);
        const mySaves = isMe ? combat.pendingSaves.filter((save) => save.targetActorId === entry.actorId) : [];
        return <li key={entry.actorId} ref={entry.active ? activeRowRef : undefined} className={`${entry.active ? "active" : ""}${isMe ? " you" : ""}`.trim()} aria-current={entry.active ? "step" : undefined}>
          {/* Foundry-style row shared with the shared-screen viewer so the two lists never drift. */}
          <InitiativeRow entry={entry} self={isMe} />
          {isMe && myId !== null && <PlayerTurnEconomy combat={combat} myId={myId} myTurn={myTurn} mySpeedFeet={rowActor?.speedFeet} />}
          {/* On your turn, an interactive action console (the mirror of the GM's) - tap an attack, pick a
              target, roll, and confirm; the hit is handed to the GM or auto-applied per the table policy. */}
          {isMe && myTurn && myId !== null && rowActor?.definition && <PlayerActionRunner actorId={myId} definition={rowActor.definition} revision={props.state.revision} rollMode={rollMode} bonusMode={bonusMode} playerDamageMode={combat.playerDamageMode} targets={combat.initiative.map((initiativeEntry) => ({ actorId: initiativeEntry.actorId, name: initiativeEntry.name }))} />}
          {isMe && rowActor && <PlayerEffectRow actorId={entry.actorId} effects={rowActor.effects} isMe={isMe} />}
          {isMe && rowActor && "deathSaves" in rowActor && rowActor.deathSaves && <OwnDyingTracker actorId={entry.actorId} name={entry.name} deathSaves={rowActor.deathSaves} rollMode={rollMode} isActingTurn={myTurn} />}
          {isMe && <OwnSavePrompts saves={mySaves} targetName={entry.name} rollMode={rollMode} />}
          {isMe && <OwnReactionPrompts reactions={combat.pendingReactions.filter((reaction) => reaction.actorId === entry.actorId)} actorName={entry.name} rollMode={rollMode} />}
        </li>;
      })}</ol>}
      </div>
      <DockPicker dock={props.dock} />
    </section>;
  }

  return <GmEncounterPanel state={props.state} selectedMap={props.selectedMap} mapLibrary={props.mapLibrary} onSelectMap={props.onSelectMap} dock={props.dock} />;
}

function GmEncounterPanel({ state, selectedMap, mapLibrary, onSelectMap, dock }: Readonly<{ state: GmView; selectedMap: MapSelection | null; mapLibrary?: readonly MapSelection[]; onSelectMap?: (map: MapSelection | null) => void; dock?: DockControl }>) {
  const [selectedActors, setSelectedActors] = useState<ReadonlySet<string>>(() => state.combat.initiative.length > 0 ? new Set(state.combat.initiative.map((entry) => entry.actorId)) : new Set(state.actors.filter((actor) => actor.kind === "player-character" && !actor.archived).map((actor) => actor.id)));
  const liveMapRef = useRef(state.combat.mapAssetId);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // The GM's own rolls (monster saves, death saves, attack previews) follow the same per-browser
  // dice-input preference every surface reads - not a separate table-wide setting.
  const { rollMode } = useRollPreference();
  // Encounter-setup opt-in: let claimed players roll their own initiative (per-encounter, not persisted).
  const [playersRollInitiative, setPlayersRollInitiative] = useState(false);
  // A pending history-rewrite/discard the GM must confirm before it applies (see the Previous/Next flow).
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<MutationResult>; success: string } | null>(null);
  const { confirm: askConfirm, dialog: confirmDialog } = useConfirm();
  const [editingActorId, setEditingActorId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState("");
  const [browsing, setBrowsing] = useState(false);
  // The battle map chosen in this panel, when no scene is live. Held here rather than read back off
  // `selectedMap`, which the shell also sets by itself (it defaults to the newest battlemap) - only an
  // explicit pick should move the fight to another map.
  const [pickedMap, setPickedMap] = useState<PickerMap | null>(null);
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  // Accordion: rows are one line by default; at most one row's tools (HP editor, condition/effect
  // editors, sheet) are open at a time.
  const [expandedActorId, setExpandedActorId] = useState<string | null>(null);
  const [hpAmount, setHpAmount] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the ⋯ options popover on Escape, matching the token menu and the Menu primitive (it already
  // closes on outside-click via the backdrop). Rich content keeps it a bespoke popover, not a Menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  // Anchor the ⋯ menu just under its button, right-aligned to it, clamped into the viewport (it
  // scrolls internally when tall). Still portaled out, so it clears the dock/enlarged stacking.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!menuOpen) { setMenuPos(null); return; }
    const place = () => {
      const button = menuButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const margin = 8, gap = 6;
      const width = Math.min(24 * 16, window.innerWidth - margin * 2);
      const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
      const top = Math.min(rect.bottom + gap, window.innerHeight - margin);
      setMenuPos({ top, left, width, maxHeight: Math.max(0, window.innerHeight - top - margin) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [menuOpen]);
  // A legendary creature acting off-turn (SRD Legendary Actions): the acting console temporarily
  // switches to it; cleared whenever the real turn advances.
  const [legendaryActingId, setLegendaryActingId] = useState<string | null>(null);
  useEffect(() => { setLegendaryActingId(null); }, [state.combat.turnActorId]);
  const cancelEditRef = useRef(false);
  const knownActorIdsRef = useRef<ReadonlySet<string>>(new Set(state.actors.map((actor) => actor.id)));
  const actorsById = useMemo(() => new Map(state.actors.map((actor) => [actor.id, actor])), [state.actors]);
  // Advancing the turn brings the newly-active combatant's row into view so the GM never has to hunt
  // for it (report #2). block:"nearest" keeps the scroll minimal; guarded to real turn changes.
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => { activeRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [state.combat.turnActorId]);

  useEffect(() => {
    if (state.combat.active) setScores(Object.fromEntries(state.combat.initiative.map((entry) => [entry.actorId, String(entry.score)])));
  }, [state.combat.active, state.combat.initiative]);
  useEffect(() => {
    // When a prepared scene becomes the live one (its map swaps in), pre-select its staged combatants
    // so the setup view + Start reflect what the GM built, not the whole roster.
    if (state.combat.mapAssetId !== liveMapRef.current) {
      liveMapRef.current = state.combat.mapAssetId;
      if (!state.combat.active && state.combat.initiative.length > 0) setSelectedActors(new Set(state.combat.initiative.map((entry) => entry.actorId)));
    }
  }, [state.combat.mapAssetId, state.combat.active, state.combat.initiative]);
  useEffect(() => {
    if (state.combat.active) return;
    setSelectedActors((current) => {
      // Prune removed actors, and auto-check actors that appear while setting up - a GM
      // adding a monster from the browser intends it to fight.
      const known = knownActorIdsRef.current;
      const valid = new Set([...current].filter((id) => actorsById.has(id)));
      for (const actor of state.actors) if (!known.has(actor.id) && !actor.archived) valid.add(actor.id);
      knownActorIdsRef.current = new Set(state.actors.map((actor) => actor.id));
      // An empty tray stays empty. This used to fall back to the WHOLE roster - so a GM who
      // deliberately cleared the list got everyone back on the next broadcast, archived characters
      // and GM-only monsters included (Appendix A1). "Nothing staged" is a decision, not a gap.
      return valid;
    });
  }, [actorsById, state.actors, state.combat.active]);

  const run = async (operation: () => Promise<MutationResult>, success: string) => {
    setBusy(true); setMessage("");
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.message ?? "The command was rejected.");
      setMessage(success);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const start = () => void run(async () => {
    // Scene-first: once a scene is live its map IS the encounter's map (the server requires they match),
    // so start on it directly. With no scene live, the map picked in the panel wins - that is how the
    // quick-start door runs the next fight somewhere else without a trip to Scenes.
    const startMapId = sceneLive ? state.combat.mapAssetId ?? undefined : quickStartMapId;
    if (!startMapId) throw new Error(selectedMap && selectedMap.kind !== "battlemap"
      ? "Pick a battle map before starting the fight. Regional and world maps stay available outside fights."
      : "Pick a battle map first, or make a scene live from the Scenes tab.");
    const entries = state.actors.filter((actor) => selectedActors.has(actor.id)).map((actor) => {
      const value = scores[actor.id]?.trim();
      return { actorId: actor.id, ...(value ? { score: Number(value) } : {}) };
    });
    if (entries.length === 0) throw new Error("Stage at least one character or monster.");
    return emitCommand("encounter:start", { commandId: newId(), mapAssetId: startMapId, entries, playersRollInitiative, expectedRevision: state.revision });
  }, "The fight has started. Blank Initiative scores were rolled, and every token is ready in the tray above.");
  // Inline-edit an initiative score: Enter or blur commits, Escape (via cancelEditRef) discards.
  const commitEdit = (actorId: string, previous: number) => {
    if (cancelEditRef.current) { cancelEditRef.current = false; setEditingActorId(null); return; }
    setEditingActorId(null);
    const trimmed = editScore.trim();
    if (!validInitiativeScore(trimmed) || Number(trimmed) === previous) return;
    void run(() => emitCommand("initiative:set", { commandId: newId(), actorId, score: Number(trimmed), expectedRevision: state.revision }), "Initiative updated.");
  };
  // Turn time-travel (#12). Previous rewinds the whole table to the end of the prior turn; Next steps
  // forward (undoing nothing) or, once the return-point is reached, resumes live play. If the GM changed
  // things while rewound, the server asks to confirm - Next rewrites history from here, Previous discards
  // the change in place - and we re-send the command with the matching confirm flag once the GM agrees.
  const cursor = state.combat.historyCursor;
  const dirty = state.combat.historyDirty;
  const reviewing = cursor === null ? null : {
    label: (state.turnHistory ?? []).find((entry) => entry.index === cursor)?.label,
    resumeNext: (state.turnHistory ?? []).find((entry) => entry.index > cursor)?.kind === "return"
  };
  const nextLabel = reviewing?.resumeNext ? "Resume live play" : "Next turn";
  const runTurn = async (operation: () => Promise<MutationResult>, success: string, onConfirm?: () => Promise<MutationResult>) => {
    setBusy(true); setMessage(""); setConfirm(null);
    try {
      const result = await operation();
      if (result.needsConfirm && onConfirm) { setConfirm({ message: result.message ?? "Confirm this change?", run: onConfirm, success }); return; }
      if (!result.ok) throw new Error(result.message ?? "The turn command was rejected.");
      setMessage(success);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const next = () => void runTurn(
    () => emitCommand("initiative:next", { commandId: newId(), expectedRevision: state.revision }),
    reviewing?.resumeNext ? "Resumed live play." : "Advanced to the next turn.",
    () => emitCommand("initiative:next", { commandId: newId(), confirmRewrite: true, expectedRevision: state.revision })
  );
  const previous = () => void runTurn(
    () => emitCommand("initiative:previous", { commandId: newId(), expectedRevision: state.revision }),
    "Moved to the previous turn.",
    () => emitCommand("initiative:previous", { commandId: newId(), confirmDiscard: true, expectedRevision: state.revision })
  );
  const end = async () => {
    if (!(await askConfirm({ title: "End the fight?", body: "Turn order stays saved for reference, but the shared screen will hide it.", confirmLabel: "End the fight", danger: true }))) return;
    void run(() => emitCommand("encounter:end", { commandId: newId(), expectedRevision: state.revision }), "Fight ended.");
  };
  const adjustHp =(event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp", actorId: string, name: string, options?: { nonlethal?: boolean }) => {
    const value = Number(hpAmount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) { setMessage(`Enter a whole number (${minimum}-1000).`); return; }
    const verbs = { "actor:apply-damage": options?.nonlethal ? `${name} took ${value} nonlethal damage.` : `${name} took ${value} damage.`, "actor:heal": `${name} healed ${value}.`, "actor:set-temp-hp": `${name} has ${value} temporary HP.`, "actor:set-hp": `${name} set to ${value} HP.` } as const;
    setHpAmount("");
    void run(() => event === "actor:set-hp"
      ? emitCommand(event, { commandId: newId(), actorId, current: value, expectedRevision: state.revision })
      : emitCommand(event, { commandId: newId(), actorId, amount: value, ...(options?.nonlethal ? { nonlethal: true } : {}), expectedRevision: state.revision }), verbs[event]);
  };

  // The quick-start door (D1/B2.5). Everyone active is pre-listed in the staging tray without being
  // hand-added (D2); archived characters appear nowhere (D16); the map, the tray, the two Add buttons
  // and Recent are the SAME parts the scene-prep workspace shows, so there is one thing to learn.
  const stagedIds = state.actors.filter((actor) => selectedActors.has(actor.id) && !actor.archived).map((actor) => actor.id);
  // A LIVE SCENE owns its map; nothing else does. After a fight ends `combat.mapAssetId` is still set,
  // and treating that as ownership is what used to strand the GM on last night's map with no way to
  // change it short of preparing a scene.
  const sceneLive = state.combat.activeSceneId !== null;
  // The just-picked map first: the shell's library is refetched on a tab change, so a map uploaded from
  // inside this panel is not in it yet - and "the live scene's map" is a poor name for one you just chose.
  const nameOf = (id: string | null) => (id ? (pickedMap?.id === id ? pickedMap.name : (mapLibrary ?? []).find((map) => map.id === id)?.name ?? null) : null);
  const quickStartMapId = pickedMap?.id ?? state.combat.mapAssetId ?? (selectedMap?.kind === "battlemap" ? selectedMap.id : null);
  const panelMapName = sceneLive
    ? nameOf(state.combat.mapAssetId) ?? "the live scene’s map"
    : pickedMap?.name ?? nameOf(quickStartMapId) ?? (selectedMap?.kind === "battlemap" ? selectedMap.name : null);
  const readyToStart = stagedIds.length > 0 && (sceneLive ? state.combat.mapAssetId !== null : quickStartMapId !== null);
  /**
   * Picking a map from the quick-start door.
   *
   * With no scene live, that is just a choice - the fight starts on it. With a scene live the server
   * REQUIRES the fight to run on that scene's map, so choosing another map has to move the table:
   * one `scene.create {activate}` (the prepare-and-go command) parks the current scene and goes live
   * on a new one named after the map. That is the same park/resume motion as switching scenes, in one
   * tap, which is what makes this door usable for an improvised fight somewhere new - the alternative
   * was a locked map line and a trip to Scenes. Not offered mid-fight: this panel only exists before
   * one starts.
   */
  const chooseQuickStartMap = (map: PickerMap) => {
    setPickedMap(map);
    onSelectMap?.(map);
    if (!sceneLive || map.id === state.combat.mapAssetId) return;
    void run(() => emitCommand("scene:create", { commandId: newId(), name: map.name.slice(0, 120), mapAssetId: map.id, combatantIds: stagedIds, activate: true, expectedRevision: state.revision }), `${map.name} is live.`);
  };
  // The table's standing "new tokens" visibility (D2). Read through a guard, not because GmView makes it
  // optional - it does not - but because the FIRST frame after a GM signs in can still be the
  // player-projected state, which carries no GM-only fields at all. main.tsx guards `combat.scenes` the
  // same way for the same reason; without it the panel threw on that one frame and the app fell into its
  // error boundary. Observed in the browser pass, not deduced.
  const stagingVisibility = state.stagingDefaults?.visibility ?? "public";

  // Active creature on top: rotate the turn order so the acting combatant leads the list, the rest
  // follow in order (wrapping). The acting console renders inline directly under that top row (feedback #3).
  const activeIndex = state.combat.initiative.findIndex((entry) => state.combat.turnActorId === entry.actorId);
  const orderedInitiative = activeIndex > 0
    ? [...state.combat.initiative.slice(activeIndex), ...state.combat.initiative.slice(0, activeIndex)]
    : state.combat.initiative;
  // The acting creature's console, rendered inline under the active/top row. On a normal turn it needs
  // no name header - the row above already names it (feedback #3.4); an off-turn legendary actor differs
  // from that row, so it keeps its name. Contents are otherwise unchanged from the old bottom console.
  const renderActingConsole = () => {
    const turnActor = state.combat.turnActorId ? actorsById.get(state.combat.turnActorId) : undefined;
    const legendaryActor = legendaryActingId && legendaryActingId !== state.combat.turnActorId ? actorsById.get(legendaryActingId) : undefined;
    const actor = legendaryActor ?? turnActor;
    // Legendary creatures act on OTHER creatures' turns (SRD Legendary Actions): offer a one-tap
    // console switch for each off-turn legendary combatant with pool remaining.
    const legendaryOffers = state.combat.initiative
      .flatMap((entry) => { const candidate = actorsById.get(entry.actorId); return candidate?.legendary?.actionsPerRound && candidate.id !== state.combat.turnActorId && candidate.id !== legendaryActingId ? [candidate] : []; })
      .map((candidate) => ({ candidate, remaining: Math.max(0, (candidate.legendary!.actionsPerRound ?? 0) - (state.combat.legendaryUsed[candidate.id] ?? 0)) }));
    if (!actor) return null;
    // A creature at 0 HP is down: its death saves (PCs) surface above a dimmed console, and the server
    // rejects its actions (condition.down) - the GM can still force one through the audited override.
    const down = actor.hp.current <= 0;
    const legendaryPool = legendaryActor?.legendary?.actionsPerRound;
    const legendarySpent = legendaryActor ? state.combat.legendaryUsed[legendaryActor.id] ?? 0 : 0;
    return <>
      {legendaryOffers.length > 0 && <div className="legendary-strip" role="group" aria-label="Legendary actions available">
        {legendaryOffers.map(({ candidate, remaining }) => <button key={candidate.id} type="button" className="legendary-offer" disabled={busy || remaining === 0}
          title={remaining === 0 ? `${candidate.name} has no legendary actions left this round (they refill when its turn starts).` : `Take a legendary action with ${candidate.name} (used on other creatures' turns).`}
          onClick={() => setLegendaryActingId(candidate.id)}>⭐ {candidate.name} {remaining}/{candidate.legendary!.actionsPerRound}</button>)}
      </div>}
      {down && (actor.deathSaves
        ? <DyingTracker actorId={actor.id} name={actor.name} deathSaves={actor.deathSaves} canRoll onFeedback={setMessage} rollMode={rollMode} isActingTurn={state.combat.turnActorId === actor.id} />
        : <p className="acting-down-note" role="status"><strong>{actor.name} is down (0 HP).</strong> Actions are disabled — click one to force it through a rules override.</p>)}
      <section className={`acting-console${legendaryActor ? " legendary-acting" : ""}${down ? " down" : ""}`} aria-label={legendaryActor ? `Legendary action: ${actor.name}` : `Acting now: ${actor.name}`}>
        <header className="acting-console-head">
          {/* Row 1 (only when there's something to show): legendary name + pool, or the turn actor's
              movement. A normal turn omits the name - the active row above already carries it. */}
          {(legendaryActor || actor.speedFeet !== undefined) && <div className="acting-console-title">
            {legendaryActor && <strong className="acting-console-name">{actor.name}</strong>}
            {legendaryActor
              ? <span className="economy-slot legendary-pill" title="Legendary actions remaining this round; the pool refills on its own turn.">⭐ {Math.max(0, (legendaryPool ?? 0) - legendarySpent)}/{legendaryPool}</span>
              : actor.speedFeet !== undefined && <span className="economy-movement" title="Movement spent this turn / base walking speed (Dash and conditions adjust the real budget server-side)">{Math.round(state.combat.turn.movementUsedFeet)}/{actor.speedFeet} ft</span>}
          </div>}
          {legendaryActor
            // Off-turn legendary console: the turn economy belongs to the turn actor, so offer a GM
            // correction (+1) and a way back instead of Action/Bonus/Reaction.
            ? <div className="acting-console-economy-row">
                <button type="button" className="economy-slot" disabled={busy || legendarySpent === 0} title="Restore one legendary action (GM correction)" onClick={() => void run(() => emitCommand("turn:use-legendary", { commandId: newId(), actorId: actor.id, spent: Math.max(0, legendarySpent - 1), expectedRevision: state.revision }), "Legendary action restored.")}>+1</button>
                <button type="button" className="secondary legendary-done" onClick={() => setLegendaryActingId(null)}>Back to {turnActor?.name ?? "the turn"}</button>
              </div>
            : <div className="acting-console-economy-row">
                <button type="button" className="economy-slot" aria-pressed={state.combat.turn.actionUsed} disabled={busy} onClick={() => void run(() => emitCommand("turn:use", { commandId: newId(), slot: "action", used: !state.combat.turn.actionUsed, expectedRevision: state.revision }), state.combat.turn.actionUsed ? "Action restored." : "Action spent.")}>Action</button>
                <button type="button" className="economy-slot" aria-pressed={state.combat.turn.bonusActionUsed} disabled={busy} onClick={() => void run(() => emitCommand("turn:use", { commandId: newId(), slot: "bonus-action", used: !state.combat.turn.bonusActionUsed, expectedRevision: state.revision }), state.combat.turn.bonusActionUsed ? "Bonus action restored." : "Bonus action spent.")}>Bonus</button>
                <button type="button" className="economy-slot" aria-pressed={state.combat.reactionsUsed.includes(actor.id)} disabled={busy} title="Reactions refresh on its own turn" onClick={() => void run(() => emitCommand("turn:use-reaction", { commandId: newId(), actorId: actor.id, used: !state.combat.reactionsUsed.includes(actor.id), expectedRevision: state.revision }), state.combat.reactionsUsed.includes(actor.id) ? "Reaction restored." : "Reaction spent.")}>Reaction</button>
              </div>}
        </header>
        <ActionRunner state={state} actor={actor} onFeedback={setMessage} />
      </section>
    </>;
  };

  return <section className={`encounter-panel${state.combat.active ? " combat-active" : " setup"}`} {...(state.combat.active ? { "aria-label": `Turn order - round ${state.combat.round}` } : { "aria-labelledby": "gm-encounter-title" })}>
    {/* During combat the panel has NO heading block - the round pill rides the one control bar. */}
    {/* One title, and it names the action rather than the screen (D28: an encounter is a fight). The
        prep panel below is deliberately heading-less here - two titles for one panel is what the old
        "Encounter setup" + map-label stack was. */}
    {!state.combat.active && <div className="encounter-heading"><div><span className="eyebrow">FIGHT</span><h2 id="gm-encounter-title">Start a fight</h2></div></div>}
    {/* Docking the tracker to the map is available before AND during combat (report #9). */}
    <DockPicker dock={dock} />
    {!state.combat.active ? <>
      <ScenePrepPanel
        actors={state.actors}
        staged={stagedIds}
        placedIds={new Set(state.combat.tokens.filter((token) => token.position !== null).map((token) => token.actorId))}
        onAdd={(actorId) => setSelectedActors((current) => new Set(current).add(actorId))}
        onRemove={(actorId) => setSelectedActors((current) => { const next = new Set(current); next.delete(actorId); return next; })}
        mapName={panelMapName}
        mapNote={sceneLive ? "A scene is live. Choosing another map makes a new scene live on it." : undefined}
        selectedMapId={quickStartMapId}
        onSelectMap={chooseQuickStartMap}
        mapFallback={mapLibrary}
        stagingRevealed={stagingVisibility !== "gm-only"}
        combatActive={false}
        busy={busy}
        emptyNote="No one staged yet. The party lands here automatically; add monsters below."
        footer={<>
          <Switch label="Players roll their own initiative" checked={playersRollInitiative} disabled={busy} onChange={setPlayersRollInitiative} />
          {!readyToStart && <p className="encounter-start-blocked" role="status">{stagedIds.length === 0 ? "Stage at least one character or monster." : "Pick a battle map first."}</p>}
          <Button variant="primary" arrow block disabled={busy || !readyToStart} onClick={start}>Start the fight</Button>
        </>}
      />
    </> : <>
      {(() => {
        const placed = state.combat.tokens.filter((token) => token.position !== null).length;
        const total = state.combat.initiative.length;
        return placed < total ? <p className="encounter-place-nudge">{placed} of {total} tokens placed - drag the rest from the tray above.</p> : null;
      })()}
      {reviewing && <div className={`turn-review${dirty ? " dirty" : ""}`} role="status">
        <strong>Reviewing {reviewing.label ?? "an earlier turn"}</strong>
        <span>{dirty
          ? "You changed this turn. Next turn rewrites history from here (undoing everything after it); Previous discards the change."
          : "The whole table is paused here. Step forward to resume live play - nothing is undone until you change something."}</span>
      </div>}
      {/* One compact control bar: turn navigation is the everything-else-follows action, so it gets
          the space; everything occasional (rules mode, environment, dock, add, end) lives behind ⋯. */}
      <div className="encounter-topbar">
        <strong className="encounter-round">Round {state.combat.round}</strong>
        <div className="turn-controls"><button className="encounter-primary turn-prev" disabled={busy} onClick={previous} title="Previous turn" aria-label="Previous turn">‹</button><button className={`encounter-primary${reviewing?.resumeNext ? " resume" : ""}`} disabled={busy} onClick={next}>{nextLabel}<span className="nav-arrow" aria-hidden="true">→</span></button></div>
        {/* Mid-fight reinforcements are a combat action, not a setting - one visible tap. */}
        <button type="button" className="encounter-menu-toggle" disabled={busy} title="Add monsters to this fight (SRD)" aria-label="Add monsters to this fight" onClick={() => setBrowsing(true)}>+</button>
        <button type="button" ref={menuButtonRef} className="encounter-menu-toggle" aria-expanded={menuOpen} aria-haspopup="menu" title="Fight options - rules assistant, environment, roster, end" onClick={() => setMenuOpen((current) => !current)}>⋯</button>
        {menuOpen && createPortal(<>
          <div className="encounter-menu-backdrop" onPointerDown={() => setMenuOpen(false)} />
          <div className="encounter-menu anim-dialog" role="menu" aria-label="Fight options" style={menuPos ? { top: menuPos.top, left: menuPos.left, width: menuPos.width, maxHeight: menuPos.maxHeight } : { visibility: "hidden" }}>
            <label className="rules-mode-control">Rules assistant
              <Select value={state.combat.rulesMode} disabled={busy} onChange={(event) => { const mode = event.target.value as "strict" | "assisted" | "freeform"; socket.emit("encounter:set-rules-mode", { commandId: newId(), mode }, (result: MutationResult) => setMessage(result.ok ? `Rules assistant: ${mode === "strict" ? "Enforce" : mode === "assisted" ? "Advise" : "Off"}.` : result.message ?? "The rules assistant could not be changed.")); }}>
                <option value="strict">Enforce - blocks illegal moves; you can allow them</option>
                <option value="assisted">Advise - allows everything, leaves notes</option>
                <option value="freeform">Off - no checks, no prompts</option>
              </Select>
            </label>
            <label className="rules-mode-control">Players' hits
              <Select value={state.combat.playerDamageMode} disabled={busy} onChange={(event) => { const mode = event.target.value as "proposal" | "direct"; socket.emit("encounter:set-player-damage-mode", { commandId: newId(), mode }, (result: MutationResult) => setMessage(result.ok ? `Players' hits ${mode === "direct" ? "apply directly." : "wait for your OK."}` : result.message ?? "The player damage mode could not be changed.")); }}>
                <option value="proposal">GM confirms - apply on your tap</option>
                <option value="direct">Direct - players apply damage</option>
              </Select>
            </label>
            <label className="rules-mode-control">Player initiative
              <Select value={state.combat.playerInitiativeMode} disabled={busy} onChange={(event) => { const mode = event.target.value as "immediate" | "wait"; socket.emit("encounter:set-player-initiative-mode", { commandId: newId(), mode }, (result: MutationResult) => setMessage(result.ok ? `Player initiative ${mode === "wait" ? "waits for everyone." : "begins immediately."}` : result.message ?? "The player initiative mode could not be changed.")); }}>
                <option value="immediate">Start now - players roll in</option>
                <option value="wait">Wait for all players</option>
              </Select>
            </label>
            <label className="rules-mode-control">Health
              <Select value={state.combat.healthDisplay.style} disabled={busy} onChange={(event) => { const style = event.target.value as "band" | "bar" | "ring" | "aura"; socket.emit("encounter:set-health-display", { commandId: newId(), style, audience: state.combat.healthDisplay.audience }, (result: MutationResult) => setMessage(result.ok ? `Health shows as ${style === "band" ? "a status badge" : style === "bar" ? "an HP bar" : style === "ring" ? "a health ring" : "a health aura"}.` : result.message ?? "The health display could not be changed.")); }}>
                <option value="band">Status badge</option>
                <option value="bar">HP bar</option>
                <option value="ring">Health ring</option>
                <option value="aura">Health aura</option>
              </Select>
            </label>
            <label className="rules-mode-control">Health is
              <Select value={state.combat.healthDisplay.audience} disabled={busy || state.combat.healthDisplay.style === "band"} onChange={(event) => { const audience = event.target.value as "gm" | "all"; socket.emit("encounter:set-health-display", { commandId: newId(), style: state.combat.healthDisplay.style, audience }, (result: MutationResult) => setMessage(result.ok ? `Health is ${audience === "all" ? "shown to players" : "GM only"}.` : result.message ?? "The health display could not be changed.")); }}>
                <option value="gm">GM only</option>
                <option value="all">Shown to players</option>
              </Select>
            </label>
            <Switch
              className="environment-control"
              label="Underwater fight"
              checked={state.combat.underwater}
              disabled={busy}
              onChange={(underwater) => socket.emit("encounter:set-environment", { commandId: newId(), underwater }, (result: MutationResult) => setMessage(result.ok ? (underwater ? "The fight is now underwater." : "The fight is no longer underwater.") : result.message ?? "The environment could not be changed."))}
            />
            <div className="menu-section" role="group" aria-label="Add to the fight">
              <p className="menu-section-title">Add to the fight</p>
              {(() => {
                // Archived characters are out of play (D16) and the server refuses them - the list agrees.
                const available = state.actors.filter((actor) => !actor.archived && !state.combat.initiative.some((entry) => entry.actorId === actor.id));
                return available.length > 0
                  ? <div className="menu-add-list">{available.map((actor) => <div key={actor.id} className="menu-add-row">
                      <span>{actor.name}{actor.visibility === "gm-only" ? " · GM only" : ""}</span>
                      <button type="button" disabled={busy} onClick={() => void run(() => emitCommand("encounter:add-combatant", { commandId: newId(), actorId: actor.id, expectedRevision: state.revision }), `${actor.name} joined the fight - their token is in the staging tray.`)}>Add</button>
                    </div>)}</div>
                  : <p className="menu-empty-note">Everyone on the roster is already in this fight.</p>;
              })()}
              <button type="button" className="encounter-add-monsters" disabled={busy} onClick={() => { setBrowsing(true); setMenuOpen(false); }}>+ Add monsters</button>
            </div>
            <button type="button" className="encounter-end" disabled={busy} onClick={() => { setMenuOpen(false); end(); }}>End the fight</button>
          </div>
        </>, document.fullscreenElement ?? document.body)}
      </div>
      {confirm && <div className="turn-confirm" role="alertdialog" aria-label="Confirm history change">
        <span>{confirm.message}</span>
        <div className="turn-confirm-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
          <button type="button" className="encounter-primary" disabled={busy} onClick={() => { const pending = confirm; setConfirm(null); void runTurn(pending.run, pending.success); }}>Confirm</button>
        </div>
      </div>}
      {/* Players' questions, pinned above the turn order: a blocked player is waiting on this, so it
          does not belong somewhere the GM has to scroll to. Allow replays the parked command under GM
          authority; an ask survives the turn advancing, so a replay can fail against current state —
          when it does the question stays put and says so, rather than vanishing as if answered. */}
      <PendingAsksForGm state={state} onFeedback={setMessage} />
      {(state.combat.pendingInitiative ?? []).length > 0 && <div className="initiative-gathering" role="status">
        <span>Waiting on {state.combat.pendingInitiative.length} player{state.combat.pendingInitiative.length === 1 ? "" : "s"} to roll initiative{state.combat.playerInitiativeMode === "wait" ? " - turns begin once everyone has" : ""}.</span>
        <button type="button" className="encounter-primary" disabled={busy} onClick={() => { setBusy(true); socket.emit("initiative:roll-remaining", { commandId: newId() }, (result: MutationResult) => { setBusy(false); setMessage(result.ok ? "Rolled initiative for the rest of the table." : result.message ?? "Initiative could not be rolled."); }); }}>Roll for the rest</button>
      </div>}
      {/* The GM's tracker region — same reason as the player's: the turn order is the part that grows,
          so it scrolls itself rather than growing the surface. The topbar, the start/stop controls and
          the initiative-gathering notice above stay pinned as the region's header. */}
      <div className="encounter-region scroll-y">
      <ol className="initiative-list gm">{orderedInitiative.map((entry) => {
        const actor = actorsById.get(entry.actorId);
        const active = state.combat.turnActorId === entry.actorId;
        const editing = editingActorId === entry.actorId;
        const down = actor !== undefined && actor.hp.current <= 0;
        const expanded = expandedActorId === entry.actorId;
        return <li key={entry.actorId} ref={active ? activeRowRef : undefined} className={`${active ? "active" : ""}${down ? " down" : ""}${expanded ? " expanded" : ""}`.trim()} aria-current={active ? "step" : undefined}>
          <div className="initiative-row-main">
            {/* Foundry-style row: [avatar | name + HP bar | initiative]. The whole row opens a
                floating tools card OVER the list - rows never shift while you work. */}
            <button type="button" className="initiative-expand" aria-expanded={expanded} title={expanded ? "Close" : `Manage ${actor?.name ?? "this token"} - HP, conditions, effects, reaction, sheet`} onClick={() => { setExpandedActorId((current) => current === entry.actorId ? null : entry.actorId); setHpAmount(""); }}>
              <span className={`initiative-avatar ${actor?.kind ?? "npc"}${actor?.visibility === "gm-only" ? " gm-hidden" : ""}`} aria-hidden="true">{initialsOf(actor?.name ?? "?")}</span>
              <span className="initiative-main-col">
                <span className="initiative-name-line">
                  {active && <span className="initiative-caret" aria-hidden="true">▶</span>}
                  <strong className="initiative-name-text">{actor?.name ?? "(removed)"}</strong>
                  {actor && <ConditionDots conditions={actor.conditions} />}
                  {actor && state.combat.reactionsUsed.includes(actor.id) && <span className="reaction-spent-dot" title="Reaction spent (restore in the row tools)">R</span>}
                  {actor && <span className={`initiative-hp-text hp-${actor.hp.current <= 0 ? "down" : actor.hp.current * 2 <= actor.hp.maximum ? "bloodied" : "healthy"}`}>{actor.hp.current}/{actor.hp.maximum}{actor.hp.temporary > 0 ? <small>+{actor.hp.temporary}</small> : null}</span>}
                </span>
                {actor && <span className="initiative-hpbar" aria-hidden="true"><span className={`initiative-hpbar-fill hp-${actor.hp.current <= 0 ? "down" : actor.hp.current * 2 <= actor.hp.maximum ? "bloodied" : "healthy"}`} style={{ width: `${Math.max(0, Math.min(100, (actor.hp.current / Math.max(1, actor.hp.maximum)) * 100))}%` }} /></span>}
              </span>
            </button>
            {editing
              ? <input className="initiative-score-edit" type="number" min="-1000" max="1000" autoFocus value={editScore} onChange={(event) => setEditScore(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { cancelEditRef.current = true; event.currentTarget.blur(); } }} onBlur={() => commitEdit(entry.actorId, entry.score)} />
              : <button type="button" className="initiative-score-value" disabled={busy} title="Initiative - click to edit" onClick={() => { setEditScore(String(entry.score)); setEditingActorId(entry.actorId); }}>{entry.score}</button>}
          </div>
          {expanded && actor && <>
            <div className="encounter-overlay-backdrop" onPointerDown={() => { setExpandedActorId(null); }} />
            <div className="row-tools-popover" role="dialog" aria-label={`Tools for ${actor.name}`}>
              <div className="hp-editor" role="group" aria-label={`Adjust hit points for ${actor.name}`}>
                <input type="number" min="0" max="1000" placeholder="0" autoFocus={typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches} aria-label="Amount" value={hpAmount}
                  onChange={(event) => setHpAmount(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") adjustHp("actor:apply-damage", entry.actorId, actor.name); else if (event.key === "Escape") { setExpandedActorId(null); } }} />
                <button type="button" disabled={busy} title="Apply as damage (or press Enter)" onClick={() => adjustHp("actor:apply-damage", entry.actorId, actor.name)}>Dmg</button>
                <button type="button" disabled={busy} title="Nonlethal damage - a drop to 0 knocks out (Unconscious and stable) instead of dying" onClick={() => adjustHp("actor:apply-damage", entry.actorId, actor.name, { nonlethal: true })}>KO</button>
                <button type="button" disabled={busy} onClick={() => adjustHp("actor:heal", entry.actorId, actor.name)}>Heal</button>
                <button type="button" disabled={busy} onClick={() => adjustHp("actor:set-temp-hp", entry.actorId, actor.name)}>Temp</button>
                <button type="button" disabled={busy} onClick={() => adjustHp("actor:set-hp", entry.actorId, actor.name)}>Set</button>
              </div>
              <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setMessage} />
              <EffectChips actorId={actor.id} effects={actor.effects} canEnd onFeedback={setMessage} />
              <div className="initiative-row-tools">
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => emitCommand("turn:use-reaction", { commandId: newId(), actorId: actor.id, used: !state.combat.reactionsUsed.includes(actor.id), expectedRevision: state.revision }), state.combat.reactionsUsed.includes(actor.id) ? "Reaction restored." : "Reaction spent.")}>{state.combat.reactionsUsed.includes(actor.id) ? "Restore reaction" : "Spend reaction"}</Button>
                <Button type="button" variant="secondary" onClick={() => { setSheetActorId(actor.id); setExpandedActorId(null); }}>Open sheet</Button>
                <Button type="button" variant="secondary" onClick={() => { setExpandedActorId(null); }}>Close</Button>
              </div>
            </div>
          </>}
          {/* The acting console rides under the row - and under the HP/tools popover when it's open, so
              editing a combatant's HP shows those controls above its action list (feedback). */}
          {active && renderActingConsole()}
          {/* Required decisions and the dying state stay visible whether or not the row is expanded. */}
          {actor && actor.deathSaves && actor.hp.current <= 0 && state.combat.turnActorId !== actor.id && <DyingTracker actorId={actor.id} name={actor.name} deathSaves={actor.deathSaves} canRoll onFeedback={setMessage} rollMode={rollMode} isActingTurn={state.combat.turnActorId === actor.id} />}
          {actor && state.combat.pendingSaves.filter((save) => save.targetActorId === actor.id).map((save) => <SavePrompt key={save.id} save={save} targetName={actor.name} canDismiss onFeedback={setMessage} rollMode={rollMode}
            legendaryResistanceLeft={actor.legendary?.resistancesPerDay !== undefined ? Math.max(0, actor.legendary.resistancesPerDay - (actor.actionUses["legendary-resistance"] ?? 0)) : undefined} />)}
          {actor && state.combat.pendingReactions.filter((reaction) => reaction.actorId === actor.id).map((reaction) => <ReactionPrompt key={reaction.id} reaction={reaction} actorName={actor.name} canDismiss onFeedback={setMessage} rollMode={rollMode} />)}
          {actor && (state.combat.pendingDamage ?? []).filter((proposal) => proposal.targetActorId === actor.id).map((proposal) => <PendingDamagePrompt key={proposal.id} proposal={proposal} onFeedback={setMessage} />)}
        </li>;
      })}</ol>
      </div>
    </>}
    {message && <p className="encounter-feedback" role="status">{message}</p>}
    {/* Mid-fight reinforcements: ONE command puts the monster on the roster AND in the turn order,
        its token waiting in the staging tray, at the table's standing "new tokens" visibility. */}
    {browsing && <MonsterBrowser visibility={stagingVisibility} joinEncounter onClose={() => setBrowsing(false)} />}
    {(() => { const sheetActor = sheetActorId ? actorsById.get(sheetActorId) : undefined; return sheetActor ? <CharacterSheet actor={sheetActor} role="gm" state={state} onClose={() => setSheetActorId(null)} /> : null; })()}
    {confirmDialog}
  </section>;
}
