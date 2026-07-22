import { useEffect, useMemo, useRef, useState } from "react";
import type { CombatLogEntry, GameState } from "@vtt/domain";
import { Button } from "@vtt/ui";
import { conditionBadgeLabel, healthBandFor } from "../encounter/conditions";
import { AnnotationGlyph } from "../scene/annotationGlyph";
import { TokenStatusBadges, useAuthorizedMapImage } from "../scene/mapImage";
import { AuthorizedTokenGlyph } from "../tokens/tokenImages";
import "./replay.css";

/**
 * GM-only encounter replay (the Time Machine's study mode): pick an archived fight and step through
 * it turn by turn - the map and tokens exactly as they stood at each boundary, the initiative order
 * with hit points and conditions, and everything that was narrated during that turn (movement,
 * damage, saves, GM-only lines included). Data comes from the GM-gated archive endpoints; nothing
 * here is reachable by players or the shared viewer.
 */

type ArchiveSummary = Readonly<{ id: number; archivedAt: string; startedAt: string | null; endedAt: string; turnCount: number }>;
type ArchiveTurn = Readonly<{ index: number; kind: "turn" | "return"; label: string; revision: number; at: string; state: GameState }>;
type ArchiveDocument = Readonly<{ archiveSchemaVersion: number; startedAt: string | null; endedAt: string; turnCount: number; turns: readonly ArchiveTurn[]; log: readonly CombatLogEntry[]; finalState?: GameState }>;
type Step = Readonly<{ label: string; at: string; state: GameState; from: number; to: number }>;

async function gmApi(path: string, token: string) {
  const response = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "The replay could not be loaded.");
  return body;
}

const when = (iso: string | null) => <span className="tabular">{iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-"}</span>;

/** Save an archive document as a JSON file - the same machine-readable record the API serves, for spreadsheets, scripts, or archiving outside the host. */
function exportDocument(id: number, endedAt: string, document: ArchiveDocument) {
  const stamp = endedAt.slice(0, 16).replace("T", "-").replaceAll(":", "");
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `encounter-replay-${id}-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * A replay step is one recorded boundary: its state is the table AT that moment, and its log slice
 * is what happened between it and the next boundary. Version-1 archives (no finalState) simply end
 * on the last boundary; version-2 archives add an "aftermath" step showing the fight's last live
 * picture with everything narrated after the final boundary.
 */
function stepsOf(document: ArchiveDocument): readonly Step[] {
  const steps: Step[] = document.turns.map((turn, index) => ({
    label: turn.kind === "return" ? `${turn.label} (return point)` : turn.label,
    at: turn.at,
    state: turn.state,
    from: turn.revision,
    to: document.turns[index + 1]?.revision ?? Number.MAX_SAFE_INTEGER
  }));
  if (document.finalState && steps.length > 0) {
    const last = steps[steps.length - 1];
    steps[steps.length - 1] = { ...last, to: document.finalState.revision };
    steps.push({ label: "Aftermath - how the fight ended", at: document.endedAt, state: document.finalState, from: document.finalState.revision, to: Number.MAX_SAFE_INTEGER });
  }
  return steps;
}

function ReplayStage({ state, gmToken }: Readonly<{ state: GameState; gmToken: string }>) {
  const image = useAuthorizedMapImage(state.combat.mapAssetId, gmToken);
  const placed = state.combat.tokens.filter((token) => token.position !== null);
  if (image.status === "error") return <div className="replay-stage replay-stage-missing"><strong>Map unavailable</strong><span>{image.message} The turn data on the right still applies.</span></div>;
  if (image.status !== "ready") return <div className="replay-stage replay-stage-missing"><span>Loading the battlefield…</span></div>;
  return <div className="replay-stage">
    <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Replayed battle map">
      <image href={image.url} width={image.width} height={image.height} />
      {state.combat.annotations.filter((annotation) => annotation.expiresAt === null).map((annotation) => (
        <g key={annotation.id} className="annotation-shape visibility-public">
          <AnnotationGlyph data={{ kind: annotation.kind === "shape" ? "shape" : "measurement", shape: annotation.shape, origin: annotation.geometry.origin, target: annotation.geometry.target, sizeFeet: annotation.geometry.sizeFeet }} color={annotation.color} />
        </g>
      ))}
      {placed.map((token) => {
        const actor = state.actors.find((candidate) => candidate.id === token.actorId);
        if (!actor || !token.position) return null;
        const active = state.combat.turnActorId === actor.id;
        return <g key={token.actorId} className={`replay-token${actor.visibility === "gm-only" ? " replay-token-hidden" : ""}`} transform={`translate(${token.position.x} ${token.position.y})`}>
          <AuthorizedTokenGlyph assetId={actor.tokenAssetId ?? null} token={gmToken} sizePx={token.sizePx} name={actor.name} active={active} turnClassName="encounter-token-turn" bodyClassName="encounter-token-body" initialsClassName="encounter-token-initials" nameClassName="encounter-token-name" nameY={token.sizePx * 0.72} initialsStyle={{ fontSize: Math.max(10, token.sizePx * 0.34) }} nameStyle={{ fontSize: Math.max(9, token.sizePx * 0.23) }} />
          <TokenStatusBadges sizePx={token.sizePx} health={healthBandFor(actor.hp)} conditions={actor.conditions.map((condition) => ({ id: condition.id, label: conditionBadgeLabel(condition) }))} />
        </g>;
      })}
    </svg>
  </div>;
}

function ReplayViewer({ gmToken, summary, onBack }: Readonly<{ gmToken: string; summary: ArchiveSummary; onBack: () => void }>) {
  const [document, setDocument] = useState<ArchiveDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    gmApi(`/api/v1/encounters/${summary.id}`, gmToken)
      .then((body) => { setDocument(body.data.document as ArchiveDocument); setIndex(0); })
      .catch((cause: Error) => setError(cause.message));
  }, [summary.id, gmToken]);

  const steps = useMemo(() => (document ? stepsOf(document) : []), [document]);
  const step = steps[index];

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex((current) => Math.min(steps.length - 1, current + 1)), 2500);
    return () => clearTimeout(timer);
  }, [playing, index, steps.length]);
  useEffect(() => { containerRef.current?.focus(); }, [document]);

  if (error) return <section className="card replay-panel"><h2>Encounter replay</h2><p className="replay-error">{error}</p><Button variant="secondary" onClick={onBack}>Back to replays</Button></section>;
  if (!document || !step) return <section className="card replay-panel"><h2>Encounter replay</h2><p>Loading the recording…</p></section>;

  const turnLog = document.log.filter((entry) => entry.revision > step.from && entry.revision <= step.to);
  const move = (delta: number) => { setPlaying(false); setIndex((current) => Math.max(0, Math.min(steps.length - 1, current + delta))); };

  return <section
    className="card replay-panel"
    ref={containerRef}
    tabIndex={0}
    aria-label="Encounter replay"
    onKeyDown={(event) => {
      if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    }}
  >
    <div className="replay-header">
      <Button variant="secondary" onClick={onBack}>← All replays</Button>
      <div>
        <h2>Encounter replay</h2>
        <p className="replay-meta">{when(document.startedAt)} → {when(document.endedAt)} · {document.turns.length} recorded turns</p>
      </div>
      <Button variant="secondary" className="replay-export" onClick={() => exportDocument(summary.id, summary.endedAt, document)} title="Download the full machine-readable record: per-turn states, command journal, combat log, dice rolls, and stat blocks.">⬇ Export JSON</Button>
    </div>
    <div className="replay-transport" role="group" aria-label="Replay controls">
      <button onClick={() => move(-1)} disabled={index === 0} aria-label="Previous turn">⏮ Prev</button>
      <button onClick={() => (playing ? setPlaying(false) : (index >= steps.length - 1 && setIndex(0), setPlaying(true)))}>{playing ? "⏸ Pause" : "▶ Play"}</button>
      <button onClick={() => move(1)} disabled={index >= steps.length - 1} aria-label="Next turn">Next ⏭</button>
      <input type="range" min={0} max={steps.length - 1} value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} aria-label="Turn position" />
      <span className="replay-position">{index + 1} / {steps.length}</span>
    </div>
    <p className="replay-step-label"><strong>{step.label}</strong> · {when(step.at)}</p>
    <div className="replay-layout">
      <ReplayStage state={step.state} gmToken={gmToken} />
      <aside className="replay-side">
        <h3>Turn order</h3>
        <ol className="replay-initiative">
          {step.state.combat.initiative.map((entry) => {
            const actor = step.state.actors.find((candidate) => candidate.id === entry.actorId);
            if (!actor) return null;
            const active = step.state.combat.turnActorId === actor.id;
            return <li key={entry.actorId} className={active ? "active" : ""} aria-current={active ? "step" : undefined}>
              <span className="replay-init-name">{actor.name}{actor.visibility === "gm-only" && <em className="replay-hidden-tag">hidden</em>}</span>
              <span className="replay-init-hp">{actor.hp.current}/{actor.hp.maximum}{actor.hp.temporary > 0 ? ` +${actor.hp.temporary}` : ""} hp</span>
              {actor.conditions.length > 0 && <span className="replay-init-conditions">{actor.conditions.map(conditionBadgeLabel).join(" · ")}</span>}
              <strong>{entry.score}</strong>
            </li>;
          })}
        </ol>
        <h3>During this turn</h3>
        {turnLog.length === 0
          ? <p className="replay-log-empty">Nothing was logged during this turn.</p>
          : <ol className="replay-log">{turnLog.map((entry) => <li key={entry.id} className={`log-${entry.kind}${entry.gmOnly ? " replay-log-gm" : ""}`}>
              <span>{entry.text}</span>{entry.gmOnly && <em className="replay-hidden-tag">GM only</em>}
            </li>)}</ol>}
      </aside>
    </div>
  </section>;
}

export function ReplayPanel({ gmToken }: Readonly<{ gmToken: string }>) {
  const [archives, setArchives] = useState<readonly ArchiveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ArchiveSummary | null>(null);
  const [exporting, setExporting] = useState<number | null>(null);

  const refresh = () => {
    setError(null);
    gmApi("/api/v1/encounters", gmToken)
      .then((body) => setArchives(body.data.encounters as readonly ArchiveSummary[]))
      .catch((cause: Error) => { setArchives([]); setError(cause.message); });
  };
  useEffect(refresh, [gmToken]);

  const exportArchive = async (archive: ArchiveSummary) => {
    setExporting(archive.id); setError(null);
    try {
      const body = await gmApi(`/api/v1/encounters/${archive.id}`, gmToken);
      exportDocument(archive.id, archive.endedAt, body.data.document as ArchiveDocument);
    } catch (cause) { setError((cause as Error).message); }
    finally { setExporting(null); }
  };

  if (open) return <ReplayViewer gmToken={gmToken} summary={open} onBack={() => { setOpen(null); refresh(); }} />;

  return <section className="card replay-panel">
    <h2>Encounter replays</h2>
    <p>Every finished encounter is recorded automatically. Open one to step through it turn by turn and study how the fight unfolded - positions, hit points, and everything that was narrated, including GM-only lines.</p>
    {error && <p className="replay-error">{error}</p>}
    {archives === null && <p>Loading recordings…</p>}
    {archives !== null && archives.length === 0 && !error && <div className="nh-empty"><span className="nh-empty-icon" aria-hidden="true">🎬</span><span className="nh-empty-title">No recordings yet</span><span className="nh-empty-text">Finish an encounter and its replay appears here to step through turn by turn.</span></div>}
    {archives !== null && archives.length > 0 && <table className="replay-list">
      <thead><tr><th>Fought</th><th>Ended</th><th>Turns</th><th aria-label="Actions" /></tr></thead>
      <tbody>{archives.map((archive) => <tr key={archive.id}>
        <td>{when(archive.startedAt)}</td>
        <td>{when(archive.endedAt)}</td>
        <td>{archive.turnCount}</td>
        <td className="replay-row-actions">
          <Button variant="secondary" onClick={() => setOpen(archive)}>▶ Watch</Button>
          <Button variant="secondary" onClick={() => exportArchive(archive)} disabled={exporting === archive.id} title="Download the full machine-readable record as JSON.">{exporting === archive.id ? "Exporting…" : "⬇ Export"}</Button>
        </td>
      </tr>)}</tbody>
    </table>}
  </section>;
}
