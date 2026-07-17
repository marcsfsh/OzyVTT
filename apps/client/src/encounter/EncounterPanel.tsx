import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientToServerEvents, GmView, MutationResult, PlayerView } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import "./encounter-panel.css";

type CommandEvent = "encounter:start" | "encounter:end" | "initiative:set" | "initiative:next" | "initiative:previous";
type CommandPayload = Parameters<ClientToServerEvents[CommandEvent]>[0];
const emitMutation = socket.emit.bind(socket) as unknown as (event: CommandEvent, payload: CommandPayload, acknowledgement: (result: MutationResult) => void) => void;

function emitCommand(event: CommandEvent, payload: CommandPayload) {
  return new Promise<MutationResult>((resolve) => emitMutation(event, payload, resolve));
}

const validInitiativeScore = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= -1000 && Number(value) <= 1000;

export const DOCK_POSITIONS = ["sidebar", "left", "right", "top", "bottom"] as const;
export type DockPosition = (typeof DOCK_POSITIONS)[number];
type DockControl = Readonly<{ position: DockPosition; onChange: (position: DockPosition) => void }>;
type GmProps = Readonly<{ role: "gm"; state: GmView; selectedMap: MapSelection | null; dock?: DockControl }>;
type PlayerProps = Readonly<{ role: "player"; state: PlayerView; dock?: DockControl }>;

// The glyph is a square with the shaded half showing where the panel lands (left/right/top/bottom),
// plus a "sidebar" option that pops it back out beside the map.
const DOCK_CHOICES: ReadonlyArray<{ value: DockPosition; glyph: string; label: string }> = [
  { value: "left", glyph: "◧", label: "Dock left of the map" },
  { value: "right", glyph: "◨", label: "Dock right of the map" },
  { value: "top", glyph: "⬒", label: "Dock above the map" },
  { value: "bottom", glyph: "⬓", label: "Dock below the map" },
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

export function EncounterPanel(props: GmProps | PlayerProps) {
  if (props.role === "player") {
    const { combat } = props.state;
    const myId = props.state.actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine")?.id ?? null;
    if (!combat.active) return <section className="encounter-panel compact" aria-labelledby="player-initiative-title"><span className="eyebrow">ENCOUNTER</span><h2 id="player-initiative-title">Waiting for combat</h2><p>The GM hasn't started an encounter yet.</p></section>;
    const myTurn = myId !== null && combat.turnActorId === myId;
    return <section className="encounter-panel" aria-labelledby="player-initiative-title">
      <div className="encounter-heading"><div><span className="eyebrow">INITIATIVE</span><h2 id="player-initiative-title">Turn order</h2></div><strong className="encounter-round">Round {combat.round}</strong></div>
      <DockPicker dock={props.dock} />
      {myTurn && <p className="your-turn" role="status"><strong>It's your turn.</strong> Roll or move your token, then let the GM know you're done.</p>}
      {combat.hiddenTurn && <p className="hidden-turn" role="status">The GM is taking a hidden turn.</p>}
      <ol className="initiative-list">{combat.initiative.map((entry) => {
        const isMe = entry.actorId === myId;
        return <li key={entry.actorId} className={`${entry.active ? "active" : ""}${isMe ? " you" : ""}`.trim()} aria-current={entry.active ? "step" : undefined}><span>{entry.name}{isMe && <span className="you-badge">YOU</span>}</span><strong>{entry.score}</strong></li>;
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
  const cancelEditRef = useRef(false);
  const actorsById = useMemo(() => new Map(state.actors.map((actor) => [actor.id, actor])), [state.actors]);

  useEffect(() => {
    if (state.combat.active) setScores(Object.fromEntries(state.combat.initiative.map((entry) => [entry.actorId, String(entry.score)])));
  }, [state.combat.active, state.combat.initiative]);
  useEffect(() => {
    if (state.combat.active) return;
    setSelectedActors((current) => {
      const valid = new Set([...current].filter((id) => actorsById.has(id)));
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

  return <section className="encounter-panel" aria-labelledby="gm-encounter-title">
    <div className="encounter-heading"><div><span className="eyebrow">{state.combat.active ? "INITIATIVE" : "ENCOUNTER"}</span><h2 id="gm-encounter-title">{state.combat.active ? "Turn order" : "Encounter setup"}</h2></div>{state.combat.active && <strong className="encounter-round">Round {state.combat.round}</strong>}</div>
    <DockPicker dock={dock} />
    {!state.combat.active ? <>
      <p>Choose who's fighting and enter any known initiative scores. Starting combat creates each token automatically — drag them from the tray onto the map.</p>
      <div className="encounter-map"><span>Encounter map</span><strong>{selectedMap?.name ?? "Pick a map on the Maps tab"}</strong></div>
      <ul className="combatant-setup">{state.actors.map((actor) => <li key={actor.id}>
        <label className="combatant-choice"><input type="checkbox" checked={selectedActors.has(actor.id)} onChange={(event) => setSelectedActors((current) => { const next = new Set(current); event.target.checked ? next.add(actor.id) : next.delete(actor.id); return next; })} /><span><strong>{actor.name}</strong><small>{actor.kind}{actor.visibility === "gm-only" ? " · GM-only" : ""} · modifier {actor.initiative && actor.initiative > 0 ? `+${actor.initiative}` : actor.initiative ?? 0}</small></span></label>
        <label className="initiative-score">Initiative<input type="number" min="-1000" max="1000" value={scores[actor.id] ?? ""} onChange={(event) => setScores((current) => ({ ...current, [actor.id]: event.target.value }))} placeholder="Roll" disabled={!selectedActors.has(actor.id)} /></label>
      </li>)}</ul>
      <button className="encounter-primary" disabled={busy || !selectedMap || selectedMap.kind !== "battlemap" || selectedActors.size === 0} onClick={start}>Start encounter</button>
    </> : <>
      {(() => {
        const placed = state.combat.tokens.filter((token) => token.position !== null).length;
        const total = state.combat.initiative.length;
        return placed < total ? <p className="encounter-place-nudge">{placed} of {total} tokens placed — drag the rest from the tray above.</p> : null;
      })()}
      <ol className="initiative-list gm">{state.combat.initiative.map((entry) => {
        const actor = actorsById.get(entry.actorId);
        const active = state.combat.turnActorId === entry.actorId;
        const editing = editingActorId === entry.actorId;
        return <li key={entry.actorId} className={active ? "active" : ""} aria-current={active ? "step" : undefined}>
          <span className="initiative-name">{active && <span className="initiative-caret" aria-hidden="true">▶</span>}<span>{actor?.name ?? "Removed combatant"}</span>{actor?.visibility === "gm-only" && <span className="initiative-tag">GM-only</span>}</span>
          {editing
            ? <input className="initiative-score-edit" type="number" min="-1000" max="1000" autoFocus value={editScore} onChange={(event) => setEditScore(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { cancelEditRef.current = true; event.currentTarget.blur(); } }} onBlur={() => commitEdit(entry.actorId, entry.score)} />
            : <button type="button" className="initiative-score-value" disabled={busy} title="Click to edit initiative" onClick={() => { setEditScore(String(entry.score)); setEditingActorId(entry.actorId); }}>{entry.score}</button>}
        </li>;
      })}</ol>
      <div className="turn-controls"><button disabled={busy} onClick={previous}>Previous</button><button className="encounter-primary" disabled={busy} onClick={next}>Next turn</button></div>
      <button type="button" className="encounter-end" disabled={busy} onClick={end}>End encounter</button>
    </>}
    {message && <p className="encounter-feedback" role="status">{message}</p>}
  </section>;
}
