import { useEffect, useMemo, useState } from "react";
import type { ClientToServerEvents, GmView, MutationResult, PlayerView } from "@vtt/domain";
import type { MapSelection } from "../maps/MapManager";
import { socket } from "../socket";
import "./encounter-panel.css";

type CommandEvent = "encounter:start" | "encounter:end" | "initiative:set" | "initiative:next" | "initiative:previous";
type CommandPayload = Parameters<ClientToServerEvents[CommandEvent]>[0];
const emitMutation = socket.emit.bind(socket) as unknown as (event: CommandEvent, payload: CommandPayload, acknowledgement: (result: MutationResult) => void) => void;

function emitCommand(event: CommandEvent, payload: CommandPayload) {
  return new Promise<MutationResult>((resolve) => emitMutation(event, payload, resolve));
}

const validInitiativeScore = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= -1000 && Number(value) <= 1000;

type GmProps = Readonly<{ role: "gm"; state: GmView; selectedMap: MapSelection | null }>;
type PlayerProps = Readonly<{ role: "player"; state: PlayerView }>;

export function EncounterPanel(props: GmProps | PlayerProps) {
  if (props.role === "player") {
    const { combat } = props.state;
    if (!combat.active) return <section className="encounter-panel compact" aria-labelledby="player-initiative-title"><span className="eyebrow">ENCOUNTER</span><h2 id="player-initiative-title">Waiting for combat</h2><p>The GM has not started an encounter.</p></section>;
    return <section className="encounter-panel" aria-labelledby="player-initiative-title">
      <div className="encounter-heading"><div><span className="eyebrow">LIVE ENCOUNTER</span><h2 id="player-initiative-title">Initiative</h2></div><strong>Round {combat.round}</strong></div>
      {combat.hiddenTurn && <p className="hidden-turn" role="status">The GM is resolving a hidden combatant's turn.</p>}
      <ol className="initiative-list">{combat.initiative.map((entry) => <li key={entry.actorId} className={entry.active ? "active" : ""} aria-current={entry.active ? "step" : undefined}><span>{entry.name}</span><strong>{entry.score}</strong></li>)}</ol>
    </section>;
  }

  return <GmEncounterPanel state={props.state} selectedMap={props.selectedMap} />;
}

function GmEncounterPanel({ state, selectedMap }: Readonly<{ state: GmView; selectedMap: MapSelection | null }>) {
  const [selectedActors, setSelectedActors] = useState<ReadonlySet<string>>(() => new Set(state.actors.map((actor) => actor.id)));
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
    return emitCommand("encounter:start", { commandId: crypto.randomUUID(), mapAssetId: selectedMap.id, entries, expectedRevision: state.revision });
  }, "Encounter started. Blank Initiative scores were rolled, and every combatant is ready in the token tray above.");
  const updateScore = (actorId: string) => void run(() => emitCommand("initiative:set", { commandId: crypto.randomUUID(), actorId, score: Number(scores[actorId]), expectedRevision: state.revision }), "Initiative updated.");
  const next = () => void run(() => emitCommand("initiative:next", { commandId: crypto.randomUUID(), expectedRevision: state.revision }), "Advanced to the next turn.");
  const previous = () => void run(() => emitCommand("initiative:previous", { commandId: crypto.randomUUID(), expectedRevision: state.revision }), "Moved to the previous turn.");
  const end = () => {
    if (!window.confirm("End this encounter? Initiative will remain saved for reference, but the shared viewer will hide it.")) return;
    void run(() => emitCommand("encounter:end", { commandId: crypto.randomUUID(), expectedRevision: state.revision }), "Encounter ended.");
  };

  return <section className="encounter-panel" aria-labelledby="gm-encounter-title">
    <div className="encounter-heading"><div><span className="eyebrow">ENCOUNTER</span><h2 id="gm-encounter-title">Encounter and Initiative</h2></div>{state.combat.active && <strong>Round {state.combat.round}</strong>}</div>
    {!state.combat.active ? <>
      <p>Choose who's fighting and enter any known initiative scores. Starting combat creates each token automatically — drag them from the tray onto the map.</p>
      <div className="encounter-map"><span>Encounter map</span><strong>{selectedMap?.name ?? "Pick a map on the Maps tab"}</strong></div>
      <ul className="combatant-setup">{state.actors.map((actor) => <li key={actor.id}>
        <label className="combatant-choice"><input type="checkbox" checked={selectedActors.has(actor.id)} onChange={(event) => setSelectedActors((current) => { const next = new Set(current); event.target.checked ? next.add(actor.id) : next.delete(actor.id); return next; })} /><span><strong>{actor.name}</strong><small>{actor.kind}{actor.visibility === "gm-only" ? " · GM-only" : ""} · modifier {actor.initiative && actor.initiative > 0 ? `+${actor.initiative}` : actor.initiative ?? 0}</small></span></label>
        <label className="initiative-score">Initiative<input type="number" min="-1000" max="1000" value={scores[actor.id] ?? ""} onChange={(event) => setScores((current) => ({ ...current, [actor.id]: event.target.value }))} placeholder="Roll" disabled={!selectedActors.has(actor.id)} /></label>
      </li>)}</ul>
      <button className="encounter-primary" disabled={busy || !selectedMap || selectedMap.kind !== "battlemap" || selectedActors.size === 0} onClick={start}>Start encounter</button>
    </> : <>
      <div className="encounter-status"><span>Active map</span><strong>{selectedMap?.id === state.combat.mapAssetId ? selectedMap.name : "Saved encounter map"}</strong><span>{state.combat.tokens.filter((token) => token.position !== null).length} of {state.combat.initiative.length} tokens placed</span></div>
      <ol className="initiative-list gm">{state.combat.initiative.map((entry) => {
        const actor = actorsById.get(entry.actorId);
        const active = state.combat.turnActorId === entry.actorId;
        return <li key={entry.actorId} className={active ? "active" : ""} aria-current={active ? "step" : undefined}>
          <div><span>{actor?.name ?? "Removed combatant"}</span><small>{actor?.visibility === "gm-only" ? "GM-only" : actor?.kind ?? "Unknown"}</small></div>
          <label>Score<input type="number" min="-1000" max="1000" value={scores[entry.actorId] ?? entry.score} onChange={(event) => setScores((current) => ({ ...current, [entry.actorId]: event.target.value }))} /></label>
          <button disabled={busy || !validInitiativeScore(scores[entry.actorId] ?? String(entry.score))} onClick={() => updateScore(entry.actorId)}>Save</button>
        </li>;
      })}</ol>
      <div className="turn-controls"><button disabled={busy} onClick={previous}>Previous turn</button><button className="encounter-primary" disabled={busy} onClick={next}>Next turn</button><button className="danger" disabled={busy} onClick={end}>End encounter</button></div>
    </>}
    {message && <p className="encounter-feedback" role="status">{message}</p>}
  </section>;
}
