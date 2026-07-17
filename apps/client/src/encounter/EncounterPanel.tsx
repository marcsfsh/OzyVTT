import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientToServerEvents, GmView, MutationResult, PlayerView } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { newId } from "../lib/ids";
import { ActionRunner } from "./ActionRunner";
import { CharacterSheet } from "./CharacterSheet";
import { ConditionChips, ConditionEditor } from "./conditions";
import { MonsterBrowser } from "./MonsterBrowser";
import { socket } from "../socket";
import "./encounter-panel.css";

type CommandEvent = "encounter:start" | "encounter:end" | "initiative:set" | "initiative:next" | "initiative:previous" | "actor:remove" | "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp" | "turn:use" | "turn:use-reaction" | "turn:end";
type CommandPayload = Parameters<ClientToServerEvents[CommandEvent]>[0];
const emitMutation = socket.emit.bind(socket) as unknown as (event: CommandEvent, payload: CommandPayload, acknowledgement: (result: MutationResult) => void) => void;

function emitCommand(event: CommandEvent, payload: CommandPayload) {
  return new Promise<MutationResult>((resolve) => emitMutation(event, payload, resolve));
}

const validInitiativeScore = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= -1000 && Number(value) <= 1000;

export const DOCK_POSITIONS = ["sidebar", "left", "right"] as const;
export type DockPosition = (typeof DOCK_POSITIONS)[number];
type DockControl = Readonly<{ position: DockPosition; onChange: (position: DockPosition) => void }>;
type GmProps = Readonly<{ role: "gm"; state: GmView; selectedMap: MapSelection | null; dock?: DockControl }>;
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

/** A player's own economy: Action/Bonus live only on their turn; the reaction is an off-turn resource, markable any time. Pressed = spent. */
function PlayerTurnEconomy({ combat, myId, myTurn }: Readonly<{ combat: PlayerView["combat"]; myId: string; myTurn: boolean }>) {
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
    {myTurn && <button type="button" className="encounter-primary turn-end" disabled={busy} onClick={() => emit(() => emitCommand("turn:end", { commandId: newId() }), "The turn could not end.")}>End turn</button>}
    {feedback && <span className="economy-feedback" role="status">{feedback}</span>}
  </div>;
}

export function EncounterPanel(props: GmProps | PlayerProps) {
  if (props.role === "player") {
    const { combat } = props.state;
    const myId = props.state.actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null;
    if (!combat.active) return <section className="encounter-panel compact" aria-labelledby="player-initiative-title"><span className="eyebrow">ENCOUNTER</span><h2 id="player-initiative-title">Waiting for combat</h2><p>The GM hasn't started an encounter yet.</p></section>;
    const myTurn = myId !== null && combat.turnActorId === myId;
    return <section className="encounter-panel" aria-labelledby="player-initiative-title">
      <div className="encounter-heading"><div><span className="eyebrow">INITIATIVE</span><h2 id="player-initiative-title">Turn order</h2></div><strong className="encounter-round">Round {combat.round}</strong></div>
      <DockPicker dock={props.dock} />
      {myTurn && <p className="your-turn" role="status"><strong>It's your turn.</strong> Roll or move your token, then end your turn below.</p>}
      {combat.hiddenTurn && <p className="hidden-turn" role="status">The GM is taking a hidden turn.</p>}
      {myId !== null && <PlayerTurnEconomy combat={combat} myId={myId} myTurn={myTurn} />}
      <ol className="initiative-list">{combat.initiative.map((entry) => {
        const isMe = entry.actorId === myId;
        const actorConditions = props.state.actors.find((actor) => actor.id === entry.actorId)?.conditions ?? [];
        return <li key={entry.actorId} className={`${entry.active ? "active" : ""}${isMe ? " you" : ""}`.trim()} aria-current={entry.active ? "step" : undefined}>
          <span>{entry.name}{isMe && <span className="you-badge">YOU</span>}{entry.health !== "healthy" && <span className={`health-chip health-${entry.health}`}>{entry.health === "down" ? "Down" : "Bloodied"}</span>}<ConditionChips conditions={actorConditions} /></span>
          <strong>{entry.score}</strong>
        </li>;
      })}</ol>
    </section>;
  }

  return <GmEncounterPanel state={props.state} selectedMap={props.selectedMap} dock={props.dock} />;
}

function GmEncounterPanel({ state, selectedMap, dock }: Readonly<{ state: GmView; selectedMap: MapSelection | null; dock?: DockControl }>) {
  const [selectedActors, setSelectedActors] = useState<ReadonlySet<string>>(() => new Set(state.actors.map((actor) => actor.id)));
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editingActorId, setEditingActorId] = useState<string | null>(null);
  const [editScore, setEditScore] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [sheetActorId, setSheetActorId] = useState<string | null>(null);
  const [hpActorId, setHpActorId] = useState<string | null>(null);
  const [hpAmount, setHpAmount] = useState("");
  const cancelEditRef = useRef(false);
  const knownActorIdsRef = useRef<ReadonlySet<string>>(new Set(state.actors.map((actor) => actor.id)));
  const actorsById = useMemo(() => new Map(state.actors.map((actor) => [actor.id, actor])), [state.actors]);

  useEffect(() => {
    if (state.combat.active) setScores(Object.fromEntries(state.combat.initiative.map((entry) => [entry.actorId, String(entry.score)])));
  }, [state.combat.active, state.combat.initiative]);
  useEffect(() => {
    if (state.combat.active) return;
    setSelectedActors((current) => {
      // Prune removed actors, and auto-check actors that appear while setting up — a GM
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
    if (!selectedMap) throw new Error("Select or upload a map before starting combat.");
    if (selectedMap.kind !== "battlemap") throw new Error("Select a battlemap before starting combat. Regional and world maps remain available outside encounters.");
    const entries = state.actors.filter((actor) => selectedActors.has(actor.id)).map((actor) => {
      const value = scores[actor.id]?.trim();
      return { actorId: actor.id, ...(value ? { score: Number(value) } : {}) };
    });
    if (entries.length === 0) throw new Error("Choose at least one combatant.");
    return emitCommand("encounter:start", { commandId: newId(), mapAssetId: selectedMap.id, entries, expectedRevision: state.revision });
  }, "Encounter started. Blank Initiative scores were rolled, and every combatant is ready in the token tray above.");
  // Inline-edit an initiative score: Enter or blur commits, Escape (via cancelEditRef) discards.
  const commitEdit = (actorId: string, previous: number) => {
    if (cancelEditRef.current) { cancelEditRef.current = false; setEditingActorId(null); return; }
    setEditingActorId(null);
    const trimmed = editScore.trim();
    if (!validInitiativeScore(trimmed) || Number(trimmed) === previous) return;
    void run(() => emitCommand("initiative:set", { commandId: newId(), actorId, score: Number(trimmed), expectedRevision: state.revision }), "Initiative updated.");
  };
  const next = () => void run(() => emitCommand("initiative:next", { commandId: newId(), expectedRevision: state.revision }), "Advanced to the next turn.");
  const previous = () => void run(() => emitCommand("initiative:previous", { commandId: newId(), expectedRevision: state.revision }), "Moved to the previous turn.");
  const end = () => {
    if (!window.confirm("End this encounter? Initiative will remain saved for reference, but the shared viewer will hide it.")) return;
    void run(() => emitCommand("encounter:end", { commandId: newId(), expectedRevision: state.revision }), "Encounter ended.");
  };
  const remove = (actorId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the roster?`)) return;
    void run(() => emitCommand("actor:remove", { commandId: newId(), actorId, expectedRevision: state.revision }), `Removed ${name}.`);
  };
  const adjustHp = (event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp" | "actor:set-hp", actorId: string, name: string) => {
    const value = Number(hpAmount.trim());
    const minimum = event === "actor:apply-damage" || event === "actor:heal" ? 1 : 0;
    if (!Number.isInteger(value) || value < minimum || value > 1000) { setMessage(`Enter a whole number (${minimum}-1000).`); return; }
    const verbs = { "actor:apply-damage": `${name} took ${value} damage.`, "actor:heal": `${name} healed ${value}.`, "actor:set-temp-hp": `${name} has ${value} temporary HP.`, "actor:set-hp": `${name} set to ${value} HP.` } as const;
    setHpAmount("");
    void run(() => event === "actor:set-hp"
      ? emitCommand(event, { commandId: newId(), actorId, current: value, expectedRevision: state.revision })
      : emitCommand(event, { commandId: newId(), actorId, amount: value, expectedRevision: state.revision }), verbs[event]);
  };

  return <section className="encounter-panel" aria-labelledby="gm-encounter-title">
    <div className="encounter-heading"><div><span className="eyebrow">{state.combat.active ? "INITIATIVE" : "ENCOUNTER"}</span><h2 id="gm-encounter-title">{state.combat.active ? "Turn order" : "Encounter setup"}</h2></div>{state.combat.active && <strong className="encounter-round">Round {state.combat.round}</strong>}</div>
    <DockPicker dock={dock} />
    {!state.combat.active ? <>
      <p>Choose who's fighting and enter any known initiative scores. Starting combat creates each token automatically — drag them from the tray onto the map.</p>
      <div className="encounter-map"><span>Encounter map</span><strong>{selectedMap?.name ?? "Pick a map on the Maps tab"}</strong></div>
      <ul className="combatant-setup">{state.actors.map((actor) => <li key={actor.id}>
        <label className="combatant-choice"><input type="checkbox" checked={selectedActors.has(actor.id)} onChange={(event) => setSelectedActors((current) => { const next = new Set(current); event.target.checked ? next.add(actor.id) : next.delete(actor.id); return next; })} /><span><strong>{actor.name}</strong><small>{actor.kind}{actor.visibility === "gm-only" ? " · GM-only" : ""} · modifier {actor.initiative && actor.initiative > 0 ? `+${actor.initiative}` : actor.initiative ?? 0}</small></span></label>
        <div className="combatant-tools">
          {actor.kind !== "player-character" && <button type="button" className="combatant-remove" disabled={busy} title={`Remove ${actor.name} from the roster`} aria-label={`Remove ${actor.name} from the roster`} onClick={() => remove(actor.id, actor.name)}>✕</button>}
          <label className="initiative-score">Initiative<input type="number" min="-1000" max="1000" value={scores[actor.id] ?? ""} onChange={(event) => setScores((current) => ({ ...current, [actor.id]: event.target.value }))} placeholder="Roll" disabled={!selectedActors.has(actor.id)} /></label>
        </div>
      </li>)}</ul>
      <button type="button" className="encounter-add-monsters" disabled={busy} onClick={() => setBrowsing(true)}>+ Add monsters (SRD)</button>
      <button className="encounter-primary" disabled={busy || !selectedMap || selectedMap.kind !== "battlemap" || selectedActors.size === 0} onClick={start}>Start encounter</button>
    </> : <>
      {(() => {
        const placed = state.combat.tokens.filter((token) => token.position !== null).length;
        const total = state.combat.initiative.length;
        return placed < total ? <p className="encounter-place-nudge">{placed} of {total} tokens placed — drag the rest from the tray above.</p> : null;
      })()}
      {/* Turn navigation sits above the order so Previous/Next are reachable without scrolling past the list. */}
      <div className="turn-controls"><button disabled={busy} onClick={previous}>Previous</button><button className="encounter-primary" disabled={busy} onClick={next}>Next turn</button></div>
      <ol className="initiative-list gm">{state.combat.initiative.map((entry) => {
        const actor = actorsById.get(entry.actorId);
        const active = state.combat.turnActorId === entry.actorId;
        const editing = editingActorId === entry.actorId;
        const down = actor !== undefined && actor.hp.current <= 0;
        return <li key={entry.actorId} className={`${active ? "active" : ""}${down ? " down" : ""}`.trim()} aria-current={active ? "step" : undefined}>
          <div className="initiative-row-main">
            <span className="initiative-name">{active && <span className="initiative-caret" aria-hidden="true">▶</span>}{actor ? <button type="button" className="initiative-sheet-link" title={`Open ${actor.name}'s sheet`} onClick={() => setSheetActorId(actor.id)}>{actor.name}</button> : <span>Removed combatant</span>}{actor?.visibility === "gm-only" && <span className="initiative-tag">GM-only</span>}</span>
            <span className="initiative-row-side">
              {actor && <button type="button" className="initiative-reaction" aria-pressed={state.combat.reactionsUsed.includes(actor.id)} disabled={busy} title={state.combat.reactionsUsed.includes(actor.id) ? "Reaction spent — tap to restore" : "Reaction available — tap to spend (usable off-turn)"} aria-label={`Reaction for ${actor.name}`} onClick={() => void run(() => emitCommand("turn:use-reaction", { commandId: newId(), actorId: actor.id, used: !state.combat.reactionsUsed.includes(actor.id), expectedRevision: state.revision }), state.combat.reactionsUsed.includes(actor.id) ? "Reaction restored." : "Reaction spent.")}>R</button>}
              {actor && <button type="button" className={`initiative-hp hp-${actor.hp.current <= 0 ? "down" : actor.hp.current * 2 <= actor.hp.maximum ? "bloodied" : "healthy"}`} disabled={busy} title="Track hit points" aria-label={`Hit points for ${actor.name}`} aria-expanded={hpActorId === entry.actorId} onClick={() => { setHpActorId((current) => current === entry.actorId ? null : entry.actorId); setHpAmount(""); }}>{actor.hp.current}/{actor.hp.maximum}{actor.hp.temporary > 0 ? <small>+{actor.hp.temporary}</small> : null}</button>}
              {editing
                ? <input className="initiative-score-edit" type="number" min="-1000" max="1000" autoFocus value={editScore} onChange={(event) => setEditScore(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { cancelEditRef.current = true; event.currentTarget.blur(); } }} onBlur={() => commitEdit(entry.actorId, entry.score)} />
                : <button type="button" className="initiative-score-value" disabled={busy} title="Click to edit initiative" onClick={() => { setEditScore(String(entry.score)); setEditingActorId(entry.actorId); }}>{entry.score}</button>}
            </span>
          </div>
          {hpActorId === entry.actorId && actor && <div className="hp-editor" role="group" aria-label={`Adjust hit points for ${actor.name}`}>
            <input type="number" min="0" max="1000" placeholder="0" autoFocus aria-label="Amount" value={hpAmount} onChange={(event) => setHpAmount(event.target.value)} />
            <button type="button" disabled={busy} onClick={() => adjustHp("actor:apply-damage", entry.actorId, actor.name)}>Dmg</button>
            <button type="button" disabled={busy} onClick={() => adjustHp("actor:heal", entry.actorId, actor.name)}>Heal</button>
            <button type="button" disabled={busy} onClick={() => adjustHp("actor:set-temp-hp", entry.actorId, actor.name)}>Temp</button>
            <button type="button" disabled={busy} onClick={() => adjustHp("actor:set-hp", entry.actorId, actor.name)}>Set</button>
          </div>}
          {actor && <ConditionEditor actorId={actor.id} conditions={actor.conditions} onFeedback={setMessage} />}
          {/* The active combatant's economy + action runner live on its own initiative row, not in a
              detached block at the bottom, so actions read against the creature they belong to. */}
          {active && actor && <>
            <div className="turn-economy" role="group" aria-label={`Turn resources for ${actor.name}`}>
              <button type="button" className="economy-slot" aria-pressed={state.combat.turn.actionUsed} disabled={busy} onClick={() => void run(() => emitCommand("turn:use", { commandId: newId(), slot: "action", used: !state.combat.turn.actionUsed, expectedRevision: state.revision }), state.combat.turn.actionUsed ? "Action restored." : "Action spent.")}>Action</button>
              <button type="button" className="economy-slot" aria-pressed={state.combat.turn.bonusActionUsed} disabled={busy} onClick={() => void run(() => emitCommand("turn:use", { commandId: newId(), slot: "bonus-action", used: !state.combat.turn.bonusActionUsed, expectedRevision: state.revision }), state.combat.turn.bonusActionUsed ? "Bonus action restored." : "Bonus action spent.")}>Bonus</button>
              <button type="button" className="economy-slot" aria-pressed={state.combat.reactionsUsed.includes(actor.id)} disabled={busy} title="Reactions refresh when this combatant's turn starts" onClick={() => void run(() => emitCommand("turn:use-reaction", { commandId: newId(), actorId: actor.id, used: !state.combat.reactionsUsed.includes(actor.id), expectedRevision: state.revision }), state.combat.reactionsUsed.includes(actor.id) ? "Reaction restored." : "Reaction spent.")}>Reaction</button>
            </div>
            <ActionRunner state={state} actor={actor} onFeedback={setMessage} />
          </>}
        </li>;
      })}</ol>
      <button type="button" className="encounter-end" disabled={busy} onClick={end}>End encounter</button>
    </>}
    {message && <p className="encounter-feedback" role="status">{message}</p>}
    {browsing && <MonsterBrowser onClose={() => setBrowsing(false)} />}
    {(() => { const sheetActor = sheetActorId ? actorsById.get(sheetActorId) : undefined; return sheetActor ? <CharacterSheet actor={sheetActor} role="gm" onClose={() => setSheetActorId(null)} /> : null; })()}
  </section>;
}
