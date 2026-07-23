import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActionResolution, ActorDefinition, ClientToServerEvents, DeathSaveResult, DeathSaves, GmView, MutationResult, PendingReaction, PendingSave, PlayerEffect, PlayerPendingReaction, PlayerPendingSave, ReactionAnswerResult, SaveAnswerResult, PlayerView } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { Chip, Button, Select, Input, Switch } from "@vtt/ui";
import { newId } from "../lib/ids";
import { ActionRunner } from "./ActionRunner";
import { RollControls, type DieMode } from "./RollControls";
import { CharacterSheet } from "./CharacterSheet";
import { ConditionChips, ConditionDots, ConditionEditor } from "./conditions";
import { InitiativeRow } from "./InitiativeList";
import { initialsOf } from "../scene/mapImage";
import { MonsterBrowser } from "./MonsterBrowser";
import { socket } from "../socket";
import "./encounter-panel.css";
import { useConfirm } from "../components/feedback";

type CommandEvent = "encounter:start" | "encounter:end" | "encounter:add-combatant" | "initiative:set" | "initiative:next" | "initiative:previous" | "actor:remove" | "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp" | "turn:use" | "turn:use-reaction" | "turn:use-legendary" | "turn:end" | "scene:activate";
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
        ? <button type="button" className="save-legendary" disabled={busy} title="SRD Legendary Resistance: when the creature fails a save, it can choose to succeed instead" onClick={() => send("manual", rolled.total, true, true)}>Legendary Resistance ({legendaryResistanceLeft} left)</button>
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

/**
 * A player's read-only view of their own attacks on their turn - the same rows the GM's action console
 * shows (name + to-hit / reach / range / damage), sourced from their projected stat block. No rolling
 * here: the GM still resolves attacks (the server authorizes that), so this is a reference, not a
 * control surface.
 */
function PlayerActionList({ definition }: Readonly<{ definition: ActorDefinition }>) {
  const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));
  const nameOf = (id: string) => definition.actions.find((candidate) => candidate.id === id)?.name ?? id;
  const linesFor = (action: ActorDefinition["actions"][number]): string[] => {
    const parts: string[] = [];
    if (action.attack) parts.push(`${signed(action.attack.bonus)} to hit${action.attack.reachFeet ? `, reach ${action.attack.reachFeet} ft` : action.attack.rangeFeet ? `, range ${action.attack.rangeFeet} ft` : ""}`);
    if (action.attack?.count && action.attack.count > 1) parts.push(`${action.attack.count} attacks`);
    if (action.multiattack) parts.push(action.multiattack.map((component) => `${component.count}× ${nameOf(component.actionId)}`).join(" + "));
    if (action.save) parts.push(`DC ${action.save.dc} ${action.save.ability.toUpperCase()} save`);
    for (const part of action.damage) parts.push(`${part.formula} ${part.type} damage`);
    return parts;
  };
  const combatActions = definition.actions.filter((action) => action.attack || action.save || action.damage.length > 0 || action.multiattack);
  if (combatActions.length === 0) return null;
  return <div className="action-runner player-actions">
    <p className="player-actions-label">Your actions <span>· the GM rolls these</span></p>
    <ul className="action-list">
      {combatActions.map((action) => {
        const parts = linesFor(action);
        return <li key={action.id}>
          <div className="action-row action-row-readonly" title={action.description}>
            <strong className="action-row-name">{action.name}</strong>
            {parts.length > 0 && <ul className="action-row-summary">{parts.map((part) => <li key={part}>{part}</li>)}</ul>}
          </div>
        </li>;
      })}
    </ul>
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
    if (!combat.active) return <section className="encounter-panel compact" aria-labelledby="player-initiative-title"><span className="eyebrow">ENCOUNTER</span><h2 id="player-initiative-title">Waiting for combat</h2><p>The GM hasn't started an encounter yet.</p></section>;
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
        {myTurn && <span className="your-turn-flag" role="status">Your turn - act, then end it below</span>}
        {combat.hiddenTurn && !myTurn && <span className="encounter-quiet-note" role="status">The GM is taking a hidden turn.</span>}
        {combat.rewound && <span className="encounter-quiet-note" role="status">The GM is reviewing an earlier turn.</span>}
      </div>
      <ol className="initiative-list player">{orderedInitiative.map((entry) => {
        const isMe = entry.actorId === myId;
        const rowActor = props.state.actors.find((actor) => actor.id === entry.actorId);
        const mySaves = isMe ? combat.pendingSaves.filter((save) => save.targetActorId === entry.actorId) : [];
        return <li key={entry.actorId} ref={entry.active ? activeRowRef : undefined} className={`${entry.active ? "active" : ""}${isMe ? " you" : ""}`.trim()} aria-current={entry.active ? "step" : undefined}>
          {/* Foundry-style row shared with the shared-screen viewer so the two lists never drift. */}
          <InitiativeRow entry={entry} self={isMe} />
          {isMe && myId !== null && <PlayerTurnEconomy combat={combat} myId={myId} myTurn={myTurn} mySpeedFeet={rowActor?.speedFeet} />}
          {/* On your turn, the same read-only attack list the GM sees for the active creature (#5.2, read-only). */}
          {isMe && myTurn && rowActor?.definition && <PlayerActionList definition={rowActor.definition} />}
          {isMe && rowActor && <PlayerEffectRow actorId={entry.actorId} effects={rowActor.effects} isMe={isMe} />}
          {isMe && rowActor && "deathSaves" in rowActor && rowActor.deathSaves && <OwnDyingTracker actorId={entry.actorId} name={entry.name} deathSaves={rowActor.deathSaves} rollMode={combat.rollMode} isActingTurn={myTurn} />}
          {isMe && <OwnSavePrompts saves={mySaves} targetName={entry.name} rollMode={combat.rollMode} />}
          {isMe && <OwnReactionPrompts reactions={combat.pendingReactions.filter((reaction) => reaction.actorId === entry.actorId)} actorName={entry.name} rollMode={combat.rollMode} />}
        </li>;
      })}</ol>
      <DockPicker dock={props.dock} />
    </section>;
  }

  return <GmEncounterPanel state={props.state} selectedMap={props.selectedMap} mapLibrary={props.mapLibrary} onSelectMap={props.onSelectMap} dock={props.dock} />;
}

function GmEncounterPanel({ state, selectedMap, mapLibrary, onSelectMap, dock }: Readonly<{ state: GmView; selectedMap: MapSelection | null; mapLibrary?: readonly MapSelection[]; onSelectMap?: (map: MapSelection | null) => void; dock?: DockControl }>) {
  const [selectedActors, setSelectedActors] = useState<ReadonlySet<string>>(() => state.combat.initiative.length > 0 ? new Set(state.combat.initiative.map((entry) => entry.actorId)) : new Set(state.actors.filter((actor) => actor.kind === "player-character").map((actor) => actor.id)));
  const liveMapRef = useRef(state.combat.mapAssetId);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [combatantSearch, setCombatantSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // A pending history-rewrite/discard the GM must confirm before it applies (see the Previous/Next flow).
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<MutationResult>; success: string } | null>(null);
  const { confirm: askConfirm, dialog: confirmDialog } = useConfirm();
  const [editingActorId, setEditingActorId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState("");
  const [browsing, setBrowsing] = useState(false);
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
      for (const actor of state.actors) if (!known.has(actor.id)) valid.add(actor.id);
      knownActorIdsRef.current = new Set(state.actors.map((actor) => actor.id));
      return valid.size ? valid : new Set(state.actors.map((actor) => actor.id));
    });
  }, [actorsById, state.actors, state.combat.active]);

  const run = async (operation: () => Promise<MutationResult>, success: string) => {
    setBusy(true); setMessage("");
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.message ?? "The encounter command was rejected.");
      setMessage(success);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const start = () => void run(async () => {
    // Scene-first: once a scene is live its map IS the encounter's map (the server requires they match),
    // so start on it directly. Only when no scene is live do we fall back to a picked battlemap.
    const startMapId = state.combat.mapAssetId ?? (selectedMap?.kind === "battlemap" ? selectedMap.id : undefined);
    if (!startMapId) throw new Error(selectedMap && selectedMap.kind !== "battlemap"
      ? "Select a battlemap before starting combat. Regional and world maps remain available outside encounters."
      : "Go live on a scene from the Scenes tab, or pick a battlemap, before starting combat.");
    const entries = state.actors.filter((actor) => selectedActors.has(actor.id)).map((actor) => {
      const value = scores[actor.id]?.trim();
      return { actorId: actor.id, ...(value ? { score: Number(value) } : {}) };
    });
    if (entries.length === 0) throw new Error("Choose at least one combatant.");
    return emitCommand("encounter:start", { commandId: newId(), mapAssetId: startMapId, entries, expectedRevision: state.revision });
  }, "Encounter started. Blank Initiative scores were rolled, and every combatant is ready in the token tray above.");
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
    if (!(await askConfirm({ title: "End encounter?", body: "End this encounter? Initiative will remain saved for reference, but the shared viewer will hide it.", confirmLabel: "End encounter", danger: true }))) return;
    void run(() => emitCommand("encounter:end", { commandId: newId(), expectedRevision: state.revision }), "Encounter ended.");
  };
  const remove = async (actorId: string, name: string) => {
    if (!(await askConfirm({ title: "Remove combatant?", body: `Remove ${name} from the roster?`, confirmLabel: "Remove", danger: true }))) return;
    void run(() => emitCommand("actor:remove", { commandId: newId(), actorId, expectedRevision: state.revision }), `Removed ${name}.`);
  };
  const adjustHp = (event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp", actorId: string, name: string, options?: { nonlethal?: boolean }) => {
    const value = Number(hpAmount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) { setMessage(`Enter a whole number (${minimum}-1000).`); return; }
    const verbs = { "actor:apply-damage": options?.nonlethal ? `${name} took ${value} nonlethal damage.` : `${name} took ${value} damage.`, "actor:heal": `${name} healed ${value}.`, "actor:set-temp-hp": `${name} has ${value} temporary HP.`, "actor:set-hp": `${name} set to ${value} HP.` } as const;
    setHpAmount("");
    void run(() => event === "actor:set-hp"
      ? emitCommand(event, { commandId: newId(), actorId, current: value, expectedRevision: state.revision })
      : emitCommand(event, { commandId: newId(), actorId, amount: value, ...(options?.nonlethal ? { nonlethal: true } : {}), expectedRevision: state.revision }), verbs[event]);
  };

  // Setup picker, organized: pinned PCs (the party) first, then the last-used monsters/NPCs (server-
  // tracked recency, GM-only), then a searchable list of everything else on the roster.
  const RECENT_COUNT = 10;
  const pcs = state.actors.filter((actor) => actor.kind === "player-character");
  const nonPcs = state.actors.filter((actor) => actor.kind !== "player-character");
  const recent = nonPcs.filter((actor) => actor.lastUsedAt !== undefined).sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0)).slice(0, RECENT_COUNT);
  const recentIds = new Set(recent.map((actor) => actor.id));
  const search = combatantSearch.trim().toLowerCase();
  const otherCombatants = nonPcs.filter((actor) => !recentIds.has(actor.id)).filter((actor) => !search || actor.name.toLowerCase().includes(search) || actor.kind.toLowerCase().includes(search));
  const combatantRow = (actor: (typeof state.actors)[number]) => <li key={actor.id}>
    <label className="combatant-choice"><input type="checkbox" checked={selectedActors.has(actor.id)} onChange={(event) => setSelectedActors((current) => { const next = new Set(current); event.target.checked ? next.add(actor.id) : next.delete(actor.id); return next; })} /><span><strong>{actor.name}</strong><small>{actor.kind}{actor.visibility === "gm-only" ? " · GM-only" : ""} · modifier {actor.initiative && actor.initiative > 0 ? `+${actor.initiative}` : actor.initiative ?? 0}</small></span></label>
    <div className="combatant-tools">
      {actor.kind !== "player-character" && <button type="button" className="combatant-remove" disabled={busy} title={`Remove ${actor.name} from the roster`} aria-label={`Remove ${actor.name} from the roster`} onClick={() => remove(actor.id, actor.name)}>✕</button>}
      <label className="initiative-score">Initiative<input type="number" min="-1000" max="1000" value={scores[actor.id] ?? ""} onChange={(event) => setScores((current) => ({ ...current, [actor.id]: event.target.value }))} placeholder="Roll" disabled={!selectedActors.has(actor.id)} /></label>
    </div>
  </li>;

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
        ? <DyingTracker actorId={actor.id} name={actor.name} deathSaves={actor.deathSaves} canRoll onFeedback={setMessage} rollMode={state.combat.rollMode} isActingTurn={state.combat.turnActorId === actor.id} />
        : <p className="acting-down-note" role="status"><strong>{actor.name} is down (0 HP).</strong> Actions are disabled — click one to force it through a rules override.</p>)}
      <section className={`acting-console${legendaryActor ? " legendary-acting" : ""}${down ? " down" : ""}`} aria-label={legendaryActor ? `Legendary action: ${actor.name}` : `Acting now: ${actor.name}`}>
        <header className="acting-console-head">
          {/* Row 1 (only when there's something to show): legendary name + pool, or the turn actor's
              movement. A normal turn omits the name - the active row above already carries it. */}
          {(legendaryActor || actor.speedFeet !== undefined) && <div className="acting-console-title">
            {legendaryActor && <strong className="acting-console-name">{actor.name}</strong>}
            {legendaryActor
              ? <span className="economy-slot legendary-pill" title="Legendary actions remaining this round; the pool refills when this creature's own turn starts.">⭐ {Math.max(0, (legendaryPool ?? 0) - legendarySpent)}/{legendaryPool}</span>
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
                <button type="button" className="economy-slot" aria-pressed={state.combat.reactionsUsed.includes(actor.id)} disabled={busy} title="Reactions refresh when this combatant's turn starts" onClick={() => void run(() => emitCommand("turn:use-reaction", { commandId: newId(), actorId: actor.id, used: !state.combat.reactionsUsed.includes(actor.id), expectedRevision: state.revision }), state.combat.reactionsUsed.includes(actor.id) ? "Reaction restored." : "Reaction spent.")}>Reaction</button>
              </div>}
        </header>
        <ActionRunner state={state} actor={actor} onFeedback={setMessage} />
      </section>
    </>;
  };

  return <section className={`encounter-panel${state.combat.active ? " combat-active" : " setup"}`} {...(state.combat.active ? { "aria-label": `Turn order - round ${state.combat.round}` } : { "aria-labelledby": "gm-encounter-title" })}>
    {/* During combat the panel has NO heading block - the round pill rides the one control bar. */}
    {!state.combat.active && <div className="encounter-heading"><div><span className="eyebrow">ENCOUNTER</span><h2 id="gm-encounter-title">Encounter setup</h2></div></div>}
    {/* Docking the tracker to the map is available before AND during combat (report #9). */}
    <DockPicker dock={dock} />
    {!state.combat.active ? <>
      {/* The battlemap is picked right here - starting a fight never requires a Maps-tab visit
          (upload/calibration still live there). */}
      <label className="encounter-map">
        <span>Encounter map</span>
        {state.combat.mapAssetId
          ? <strong>{(mapLibrary ?? []).find((map) => map.id === state.combat.mapAssetId)?.name ?? "The live scene’s map"}</strong>
          : (mapLibrary ?? []).filter((map) => map.kind === "battlemap").length > 0 && onSelectMap
            ? <Select value={selectedMap?.kind === "battlemap" ? selectedMap.id : ""} disabled={busy} onChange={(event) => { const map = (mapLibrary ?? []).find((candidate) => candidate.id === event.target.value); if (map) onSelectMap(map); }}>
                {selectedMap?.kind !== "battlemap" && <option value="" disabled>Choose a battlemap…</option>}
                {(mapLibrary ?? []).filter((map) => map.kind === "battlemap").map((map) => <option key={map.id} value={map.id}>{map.name}{map.calibration ? "" : map.scale ? " (gridless)" : " (uncalibrated)"}</option>)}
              </Select>
            : <strong>{selectedMap?.name ?? "Go live on a scene from the Scenes tab first"}</strong>}
      </label>
      {/* Undocked at desktop this region scrolls so the panel stays as tall as the map, not taller
          (feedback #1); the map picker above and the add/start buttons below stay pinned. */}
      <div className="combatant-scroll">
        {pcs.length > 0 && <div className="menu-section">
          <p className="menu-section-title">Party</p>
          <ul className="combatant-setup">{pcs.map(combatantRow)}</ul>
        </div>}
        {recent.length > 0 && <div className="menu-section">
          <p className="menu-section-title">Recent</p>
          <ul className="combatant-setup">{recent.map(combatantRow)}</ul>
        </div>}
        <div className="menu-section">
          <p className="menu-section-title">{recent.length > 0 ? "More combatants" : "Combatants"}</p>
          <Input type="search" className="combatant-search" placeholder="Search by name or type…" value={combatantSearch} onChange={(event) => setCombatantSearch(event.target.value)} aria-label="Search combatants" />
          {otherCombatants.length > 0
            ? <ul className="combatant-setup">{otherCombatants.map(combatantRow)}</ul>
            : <p className="menu-empty-note">{search ? "No combatants match your search." : "No other combatants on the roster - add monsters below."}</p>}
        </div>
      </div>
      <button type="button" className="encounter-add-monsters" disabled={busy} onClick={() => setBrowsing(true)}>+ Add monsters (SRD)</button>
      <button className="encounter-primary" disabled={busy || selectedActors.size === 0 || (!state.combat.mapAssetId && (!selectedMap || selectedMap.kind !== "battlemap"))} onClick={start}>Start encounter<span className="nav-arrow" aria-hidden="true">→</span></button>
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
        <button type="button" ref={menuButtonRef} className="encounter-menu-toggle" aria-expanded={menuOpen} aria-haspopup="menu" title="Encounter options - rules mode, environment, roster, end" onClick={() => setMenuOpen((current) => !current)}>⋯</button>
        {menuOpen && createPortal(<>
          <div className="encounter-menu-backdrop" onPointerDown={() => setMenuOpen(false)} />
          <div className="encounter-menu anim-dialog" role="menu" aria-label="Encounter options" style={menuPos ? { top: menuPos.top, left: menuPos.left, width: menuPos.width, maxHeight: menuPos.maxHeight } : { visibility: "hidden" }}>
            <label className="rules-mode-control">Rules
              <Select value={state.combat.rulesMode} disabled={busy} onChange={(event) => { const mode = event.target.value as "strict" | "assisted" | "freeform"; socket.emit("encounter:set-rules-mode", { commandId: newId(), mode }, (result: MutationResult) => setMessage(result.ok ? `Rules mode: ${mode}.` : result.message ?? "The rules mode could not be changed.")); }}>
                <option value="strict">Strict - block invalid actions (override available)</option>
                <option value="assisted">Assisted - allow with warnings</option>
                <option value="freeform">Freeform - no checks</option>
              </Select>
            </label>
            <label className="rules-mode-control">Rolls
              <Select value={state.combat.rollMode} disabled={busy} onChange={(event) => { const mode = event.target.value as "auto" | "manual"; socket.emit("encounter:set-roll-mode", { commandId: newId(), mode }, (result: MutationResult) => setMessage(result.ok ? `Roll mode: ${mode === "auto" ? "auto-roll" : "manual entry"}.` : result.message ?? "The roll mode could not be changed.")); }}>
                <option value="auto">Auto-roll - type to override</option>
                <option value="manual">Manual entry - Roll to auto</option>
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
            <label className="rules-mode-control">Show health to
              <Select value={state.combat.healthDisplay.audience} disabled={busy || state.combat.healthDisplay.style === "band"} onChange={(event) => { const audience = event.target.value as "gm" | "all"; socket.emit("encounter:set-health-display", { commandId: newId(), style: state.combat.healthDisplay.style, audience }, (result: MutationResult) => setMessage(result.ok ? `Health shown to ${audience === "all" ? "everyone" : "the GM only"}.` : result.message ?? "The health display could not be changed.")); }}>
                <option value="gm">GM only</option>
                <option value="all">Everyone</option>
              </Select>
            </label>
            <Switch
              className="environment-control"
              label="Underwater fight"
              checked={state.combat.underwater}
              disabled={busy}
              onChange={(underwater) => socket.emit("encounter:set-environment", { commandId: newId(), underwater }, (result: MutationResult) => setMessage(result.ok ? (underwater ? "The fight is now underwater." : "The fight is no longer underwater.") : result.message ?? "The environment could not be changed."))}
            />
            <div className="menu-section" role="group" aria-label="Add combatants">
              <p className="menu-section-title">Add to the fight</p>
              {(() => {
                const available = state.actors.filter((actor) => !state.combat.initiative.some((entry) => entry.actorId === actor.id));
                return available.length > 0
                  ? <div className="menu-add-list">{available.map((actor) => <div key={actor.id} className="menu-add-row">
                      <span>{actor.name}{actor.visibility === "gm-only" ? " · GM-only" : ""}</span>
                      <button type="button" disabled={busy} onClick={() => void run(() => emitCommand("encounter:add-combatant", { commandId: newId(), actorId: actor.id, expectedRevision: state.revision }), `${actor.name} joined the fight.`)}>Add</button>
                    </div>)}</div>
                  : <p className="menu-empty-note">Everyone on the roster is already in this fight.</p>;
              })()}
              <button type="button" className="encounter-add-monsters" disabled={busy} onClick={() => { setBrowsing(true); setMenuOpen(false); }}>+ Add monsters (SRD)</button>
            </div>
            <button type="button" className="encounter-end" disabled={busy} onClick={() => { setMenuOpen(false); end(); }}>End encounter</button>
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
            <button type="button" className="initiative-expand" aria-expanded={expanded} title={expanded ? "Close" : `Manage ${actor?.name ?? "combatant"} - HP, conditions, effects, reaction, sheet`} onClick={() => { setExpandedActorId((current) => current === entry.actorId ? null : entry.actorId); setHpAmount(""); }}>
              <span className={`initiative-avatar ${actor?.kind ?? "npc"}${actor?.visibility === "gm-only" ? " gm-hidden" : ""}`} aria-hidden="true">{initialsOf(actor?.name ?? "?")}</span>
              <span className="initiative-main-col">
                <span className="initiative-name-line">
                  {active && <span className="initiative-caret" aria-hidden="true">▶</span>}
                  <strong className="initiative-name-text">{actor?.name ?? "Removed combatant"}</strong>
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
          {actor && actor.deathSaves && actor.hp.current <= 0 && state.combat.turnActorId !== actor.id && <DyingTracker actorId={actor.id} name={actor.name} deathSaves={actor.deathSaves} canRoll onFeedback={setMessage} rollMode={state.combat.rollMode} isActingTurn={state.combat.turnActorId === actor.id} />}
          {actor && state.combat.pendingSaves.filter((save) => save.targetActorId === actor.id).map((save) => <SavePrompt key={save.id} save={save} targetName={actor.name} canDismiss onFeedback={setMessage} rollMode={state.combat.rollMode}
            legendaryResistanceLeft={actor.legendary?.resistancesPerDay !== undefined ? Math.max(0, actor.legendary.resistancesPerDay - (actor.actionUses["legendary-resistance"] ?? 0)) : undefined} />)}
          {actor && state.combat.pendingReactions.filter((reaction) => reaction.actorId === actor.id).map((reaction) => <ReactionPrompt key={reaction.id} reaction={reaction} actorName={actor.name} canDismiss onFeedback={setMessage} rollMode={state.combat.rollMode} />)}
        </li>;
      })}</ol>
    </>}
    {message && <p className="encounter-feedback" role="status">{message}</p>}
    {browsing && <MonsterBrowser onClose={() => setBrowsing(false)} />}
    {(() => { const sheetActor = sheetActorId ? actorsById.get(sheetActorId) : undefined; return sheetActor ? <CharacterSheet actor={sheetActor} role="gm" state={state} onClose={() => setSheetActorId(null)} /> : null; })()}
    {confirmDialog}
  </section>;
}
