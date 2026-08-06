import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CombatLogEntry, GameState, PlayerCombatView, PlayerHp } from "@vtt/domain";
import { Button, GmOnlyTag, IconChevronLeft, IconChevronRight, IconDownload, IconPlay, Menu, MenuItem, RevealSwitch, SegmentedControl, useToast } from "@vtt/ui";
import { conditionBadgeLabel, healthBandFor } from "../encounter/conditions";
import { AnnotationGlyph } from "../scene/annotationGlyph";
import { TokenStatusBadges, useAuthorizedMapImage } from "../scene/mapImage";
import { AuthorizedTokenGlyph } from "../tokens/tokenImages";
import { useConfirm } from "../components/feedback";
import { newId } from "../lib/ids";
import { socket } from "../socket";
import "./replay.css";

/**
 * **Replays (A8 / D25–D27).** Every finished fight is kept, and reachable by both roles.
 *
 * The GM gets the list (with the per-replay reveal control, hidden by default), the viewer, and
 * *Launch from here*. A player gets exactly the replays the GM shared, rendered from the **player
 * replay projection** the server computes (`apps/server/src/replay-projection.ts`): the client never
 * receives the GM archive, so hidden combatants and GM-only narration are absent from the document
 * rather than filtered out of it here. One URL serves both — the server decides which document you get.
 */

type ArchiveSummary = Readonly<{ id: number; archivedAt: string; startedAt: string | null; endedAt: string; turnCount: number; playerVisible: boolean }>;
type ArchiveTurn = Readonly<{ index: number; kind: "turn" | "return"; label: string; revision: number; at: string; state: GameState }>;
type ArchiveDocument = Readonly<{ archiveSchemaVersion: number; startedAt: string | null; endedAt: string; turnCount: number; turns: readonly ArchiveTurn[]; log: readonly CombatLogEntry[]; finalState?: GameState }>;
/** The player-projected document, mirrored from `PlayerReplayDocument` (server-owned shape). */
type PlayerReplayActor = Readonly<{ id: string; name: string; hp: PlayerHp; conditions: readonly string[] }>;
type PlayerReplayTurn = Readonly<{ index: number; at: string; label: string; combat: PlayerCombatView; actors: readonly PlayerReplayActor[]; log: readonly CombatLogEntry[] }>;
type PlayerReplayDocument = Readonly<{ id: number; startedAt: string | null; endedAt: string; turnCount: number; turns: readonly PlayerReplayTurn[]; attribution: string | null }>;

type Step = Readonly<{ label: string; at: string; state: GameState; from: number; to: number }>;

async function readApi(path: string, bearer: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${bearer}`, ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? "That replay could not be loaded.");
  return body;
}

const when = (iso: string | null) => <span className="tabular">{iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-"}</span>;
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });

/** How long the fight ran, said the way a person would say it. Null when the archive has no start. */
function durationOf(startedAt: string | null, endedAt: string): string | null {
  if (!startedAt) return null;
  const minutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Save an archive document as JSON — the same machine-readable record the API serves. */
function exportDocument(id: number, endedAt: string, document: unknown) {
  const stamp = endedAt.slice(0, 16).replace("T", "-").replaceAll(":", "");
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `encounter-replay-${id}-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * A replay step is one recorded boundary: its state is the table AT that moment, and its log slice is
 * what happened between it and the next. Version-1 archives (no finalState) end on the last boundary;
 * later ones add an "aftermath" step showing the fight's last live picture.
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

// ───────────────────────────────── the stage ─────────────────────────────────

function Stage({ mapAssetId, bearer, tokens, label, actorFor }: Readonly<{
  mapAssetId: string | null;
  bearer: string;
  tokens: ReadonlyArray<{ actorId: string; position: { x: number; y: number } | null; sizePx: number }>;
  label: string;
  /** Everything the stage needs about one token's creature — already role-appropriate. */
  actorFor: (actorId: string) => Readonly<{ name: string; tokenAssetId: string | null; hidden: boolean; band: "healthy" | "bloodied" | "down"; conditions: readonly string[]; active: boolean }> | null;
}>) {
  const image = useAuthorizedMapImage(mapAssetId, bearer);
  const placed = tokens.filter((token) => token.position !== null);
  if (image.status === "error") return <div className="replay-stage replay-stage-missing"><strong>Map unavailable</strong><span>{image.message} The turn data beside this still applies.</span></div>;
  if (image.status !== "ready") return <div className="replay-stage replay-stage-missing"><span>Loading the battlefield…</span></div>;
  /* The stage is the shared-screen viewer's shape (`.viewer-stage`, viewer.css): the svg fills the
     box it was given and `preserveAspectRatio` letterboxes inside it, so the frame decides the
     height and nothing here has to guess a fraction of the window. */
  return <div className="replay-stage">
    <svg viewBox={`0 0 ${image.width} ${image.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label}>
      <image href={image.url} width={image.width} height={image.height} />
      {placed.map((token) => {
        const actor = actorFor(token.actorId);
        if (!actor || !token.position) return null;
        return <g key={token.actorId} className={`replay-token${actor.hidden ? " replay-token-hidden" : ""}`} transform={`translate(${token.position.x} ${token.position.y})`}>
          <AuthorizedTokenGlyph assetId={actor.tokenAssetId} token={bearer} sizePx={token.sizePx} name={actor.name} active={actor.active} turnClassName="encounter-token-turn" bodyClassName="encounter-token-body" initialsClassName="encounter-token-initials" nameClassName="encounter-token-name" nameY={token.sizePx * 0.72} initialsStyle={{ fontSize: Math.max(10, token.sizePx * 0.34) }} nameStyle={{ fontSize: Math.max(9, token.sizePx * 0.23) }} />
          <TokenStatusBadges sizePx={token.sizePx} health={actor.band} conditions={actor.conditions.map((id) => ({ id, label: id }))} />
        </g>;
      })}
    </svg>
  </div>;
}

/** Prev / play / next / scrubber — one control group, shared by both viewers. */
function Transport({ index, count, playing, onMove, onPlay, onSeek }: Readonly<{
  index: number; count: number; playing: boolean;
  onMove: (delta: number) => void; onPlay: () => void; onSeek: (index: number) => void;
}>) {
  return <div className="replay-transport" role="group" aria-label="Replay controls">
    <Button variant="secondary" size="sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Previous turn"><IconChevronLeft /></Button>
    <Button variant="secondary" size="sm" onClick={onPlay} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : <IconPlay />}</Button>
    <Button variant="secondary" size="sm" onClick={() => onMove(1)} disabled={index >= count - 1} aria-label="Next turn"><IconChevronRight /></Button>
    <input type="range" min={0} max={Math.max(0, count - 1)} value={index} onChange={(event) => onSeek(Number(event.target.value))} aria-label="Turn position" />
    <span className="replay-position tabular">{index + 1} / {count}</span>
  </div>;
}

/**
 * THE FRAME (§7), worn by both viewers. Header, transport and step label are chrome rows that
 * never move; the layout row beneath them takes the leftover height, and the only thing that
 * scrolls is the side lists' own region.
 *
 * THE ARROW KEYS LIVE HERE, on the column that does not scroll — stepping through a fight must
 * never turn into a scroll gesture. A focused `input`/`select`/`textarea` is handed the key
 * instead of being overridden: the transport's range steps itself to exactly the same place, and
 * a control that owns its arrows should keep them.
 */
function ReplayFrame({ loaded, onMove, children }: Readonly<{ loaded: unknown; onMove: (delta: number) => void; children: ReactNode }>) {
  const frameRef = useRef<HTMLElement | null>(null);
  useEffect(() => { frameRef.current?.focus(); }, [loaded]);
  return <section
    className="replay-panel replay-viewer pane-frame frame-col anim-view"
    ref={frameRef}
    tabIndex={0}
    aria-label="Replay"
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if ((event.target as HTMLElement).closest("input, select, textarea")) return;
      event.preventDefault();
      onMove(event.key === "ArrowLeft" ? -1 : 1);
    }}
  >{children}</section>;
}

/** Loading and error both wear the frame too, so the surface never changes shape underneath you. */
function ReplayNotice({ children }: Readonly<{ children: ReactNode }>) {
  return <section className="replay-panel replay-viewer replay-notice pane-frame frame-col anim-view"><h2>Replay</h2>{children}</section>;
}

/**
 * The side lists — ONE declared region at every width (§7 rule 1: never two sibling scrollers
 * guessing), holding the turn order and the turn's log. Below the 850 rung the two become TABS
 * inside that one region, the dock accordion's bargain in its smallest form (`DockAccordion.tsx`):
 * every choice stays visible, exactly one body holds the space. A phone has already spent a band
 * on the map and cannot also show a turn order and a log end to end.
 */
function ReplaySide({ order, log }: Readonly<{ order: ReactNode; log: ReactNode }>) {
  const [pane, setPane] = useState<"order" | "log">("order");
  return <aside className={`replay-side frame-col is-${pane}`}>
    <SegmentedControl
      className="replay-side-tabs"
      size="sm"
      ariaLabel="What to show beside the map"
      value={pane}
      onChange={(value) => setPane(value === "log" ? "log" : "order")}
      options={[{ value: "order", label: "Turn order" }, { value: "log", label: "This turn" }]}
    />
    <div className="replay-side-scroll scroll-y frame-fill">
      <section className="replay-side-pane replay-side-order"><h3>Turn order</h3>{order}</section>
      <section className="replay-side-pane replay-side-log"><h3>During this turn</h3>{log}</section>
    </div>
  </aside>;
}

// ───────────────────────────────── the GM viewer ─────────────────────────────────

function GmViewer({ gmToken, archiveId, onBack, onLaunched }: Readonly<{ gmToken: string; archiveId: number; onBack: () => void; onLaunched: () => void }>) {
  const [document, setDocument] = useState<ArchiveDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [launching, setLaunching] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();

  useEffect(() => {
    setDocument(null); setError(null);
    readApi(`/api/v1/encounters/${archiveId}`, gmToken)
      .then((body) => { setDocument(body.data.document as ArchiveDocument); setIndex(0); })
      .catch((cause: Error) => setError(cause.message));
  }, [archiveId, gmToken]);

  const steps = useMemo(() => (document ? stepsOf(document) : []), [document]);
  const step = steps[index];

  useEffect(() => {
    if (!playing) return;
    if (index >= steps.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex((current) => Math.min(steps.length - 1, current + 1)), 2500);
    return () => clearTimeout(timer);
  }, [playing, index, steps.length]);

  if (error) return <ReplayNotice><p className="replay-error">{error}</p><Button variant="secondary" onClick={onBack}>Back to replays</Button></ReplayNotice>;
  if (!document || !step) return <ReplayNotice><p>Loading the replay…</p></ReplayNotice>;

  const turnLog = document.log.filter((entry) => entry.revision > step.from && entry.revision <= step.to);
  const move = (delta: number) => { setPlaying(false); setIndex((current) => Math.max(0, Math.min(steps.length - 1, current + delta))); };

  /**
   * D25 launch-from-here, and R3's whole point: this is ONE table. The confirm says the live scene is
   * *parked* — the same motion as switching scenes — never that a second table is opening somewhere.
   */
  const launch = async () => {
    const ok = await confirm({
      title: "Launch from this moment?",
      body: `The table becomes this fight at turn ${index + 1}. Your live scene is parked in Scenes — resume it anytime.`,
      confirmLabel: "Launch"
    });
    if (!ok) return;
    setLaunching(true);
    socket.emit("replay:launch", { commandId: newId(), archiveId, turnIndex: index }, (result: { ok: boolean; message?: string }) => {
      setLaunching(false);
      if (!result.ok) { toast(result.message ?? "That moment could not be launched.", { tone: "error" }); return; }
      toast("The table is live on that moment. Your previous scene is parked in Scenes.", { tone: "success" });
      onLaunched();
    });
  };

  return <ReplayFrame loaded={document} onMove={move}>
    <div className="replay-header">
      <Button variant="ghost" onClick={onBack}><IconChevronLeft /> Replays</Button>
      <div className="replay-header-text">
        <h2>Replay</h2>
        <p className="replay-meta">{when(document.startedAt)} to {when(document.endedAt)} · {document.turns.length} turns</p>
      </div>
      <div className="replay-header-actions">
        <Button variant="primary" onClick={launch} disabled={launching}>{launching ? "Launching…" : "Launch from here"}</Button>
        <Button variant="secondary" onClick={() => exportDocument(archiveId, document.endedAt, document)} title="Download the full machine-readable record: per-turn states, command journal, combat log, dice rolls, and stat blocks."><IconDownload /> Download JSON</Button>
      </div>
    </div>
    <Transport index={index} count={steps.length} playing={playing} onMove={move} onPlay={() => (playing ? setPlaying(false) : (index >= steps.length - 1 && setIndex(0), setPlaying(true)))} onSeek={(next) => { setPlaying(false); setIndex(next); }} />
    <p className="replay-step-label"><strong>{step.label}</strong> · {when(step.at)}</p>
    <div className="replay-layout frame-fill">
      <Stage
        mapAssetId={step.state.combat.mapAssetId}
        bearer={gmToken}
        tokens={step.state.combat.tokens}
        label="Replayed battle map"
        actorFor={(actorId) => {
          const actor = step.state.actors.find((candidate) => candidate.id === actorId);
          if (!actor) return null;
          return {
            name: actor.name,
            tokenAssetId: actor.tokenAssetId ?? null,
            hidden: actor.visibility === "gm-only",
            band: healthBandFor(actor.hp),
            conditions: actor.conditions.map(conditionBadgeLabel),
            active: step.state.combat.turnActorId === actor.id
          };
        }}
      />
      <ReplaySide
        order={<ol className="replay-initiative">
          {step.state.combat.initiative.map((entry) => {
            const actor = step.state.actors.find((candidate) => candidate.id === entry.actorId);
            if (!actor) return null;
            const active = step.state.combat.turnActorId === actor.id;
            return <li key={entry.actorId} className={active ? "active" : ""} aria-current={active ? "step" : undefined}>
              <span className="replay-init-name">{actor.name}{actor.visibility === "gm-only" && <GmOnlyTag />}</span>
              <span className="replay-init-hp tabular">{actor.hp.current}/{actor.hp.maximum}{actor.hp.temporary > 0 ? ` +${actor.hp.temporary}` : ""} hp</span>
              {actor.conditions.length > 0 && <span className="replay-init-conditions">{actor.conditions.map(conditionBadgeLabel).join(" · ")}</span>}
              <strong className="tabular">{entry.score}</strong>
            </li>;
          })}
        </ol>}
        log={turnLog.length === 0
          ? <p className="replay-log-empty">Nothing was logged during this turn.</p>
          : <ol className="replay-log">{turnLog.map((entry) => <li key={entry.id} className={`log-${entry.kind}${entry.gmOnly ? " replay-log-gm" : ""}`}>
              <span>{entry.text}</span>{entry.gmOnly && <GmOnlyTag />}
            </li>)}</ol>}
      />
    </div>
    {dialog}
  </ReplayFrame>;
}

// ───────────────────────────────── the player viewer ─────────────────────────────────

function PlayerViewer({ token, archiveId, onBack }: Readonly<{ token: string; archiveId: number; onBack: () => void }>) {
  const [document, setDocument] = useState<PlayerReplayDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setDocument(null); setError(null);
    readApi(`/api/v1/encounters/${archiveId}`, token)
      .then((body) => { setDocument(body.data.document as PlayerReplayDocument); setIndex(0); })
      .catch((cause: Error) => setError(cause.message));
  }, [archiveId, token]);

  const turns = document?.turns ?? [];
  const turn = turns[index];
  useEffect(() => {
    if (!playing) return;
    if (index >= turns.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex((current) => Math.min(turns.length - 1, current + 1)), 2500);
    return () => clearTimeout(timer);
  }, [playing, index, turns.length]);

  if (error) return <ReplayNotice><p className="replay-error">{error}</p><Button variant="secondary" onClick={onBack}>Back</Button></ReplayNotice>;
  if (!document || !turn) return <ReplayNotice><p>Loading the replay…</p></ReplayNotice>;

  const move = (delta: number) => { setPlaying(false); setIndex((current) => Math.max(0, Math.min(turns.length - 1, current + delta))); };
  const bandOf = (hp: PlayerHp) => hp.kind === "band" ? hp.band : hp.current <= 0 ? "down" as const : hp.current * 2 <= hp.maximum ? "bloodied" as const : "healthy" as const;
  const hpText = (hp: PlayerHp) => hp.kind === "exact" ? `${hp.current}/${hp.maximum} hp` : hp.band === "down" ? "down" : hp.band === "bloodied" ? "bloodied" : "healthy";

  return <ReplayFrame loaded={document} onMove={move}>
    <div className="replay-header">
      <Button variant="ghost" onClick={onBack}><IconChevronLeft /> Back</Button>
      <div className="replay-header-text">
        <h2>Replay</h2>
        <p className="replay-meta">You&rsquo;re watching this fight as the party saw it.</p>
      </div>
    </div>
    <Transport index={index} count={turns.length} playing={playing} onMove={move} onPlay={() => (playing ? setPlaying(false) : (index >= turns.length - 1 && setIndex(0), setPlaying(true)))} onSeek={(next) => { setPlaying(false); setIndex(next); }} />
    <p className="replay-step-label"><strong>{turn.label}</strong> · {when(turn.at)}</p>
    <div className="replay-layout frame-fill">
      <Stage
        mapAssetId={turn.combat.mapAssetId}
        bearer={token}
        tokens={turn.combat.tokens}
        label="Replayed battle map"
        actorFor={(actorId) => {
          const actor = turn.actors.find((candidate) => candidate.id === actorId);
          if (!actor) return null;
          return { name: actor.name, tokenAssetId: null, hidden: false, band: bandOf(actor.hp), conditions: actor.conditions, active: turn.combat.turnActorId === actor.id };
        }}
      />
      <ReplaySide
        order={<ol className="replay-initiative">
          {turn.combat.initiative.map((entry) => {
            const actor = turn.actors.find((candidate) => candidate.id === entry.actorId);
            const active = turn.combat.turnActorId === entry.actorId;
            return <li key={entry.actorId} className={active ? "active" : ""} aria-current={active ? "step" : undefined}>
              <span className="replay-init-name">{entry.name}</span>
              {actor && <span className="replay-init-hp">{hpText(actor.hp)}</span>}
              {actor && actor.conditions.length > 0 && <span className="replay-init-conditions">{actor.conditions.join(" · ")}</span>}
            </li>;
          })}
        </ol>}
        log={turn.log.length === 0
          ? <p className="replay-log-empty">Nothing was logged during this turn.</p>
          : <ol className="replay-log">{turn.log.map((entry) => <li key={entry.id} className={`log-${entry.kind}`}><span>{entry.text}</span></li>)}</ol>}
      />
    </div>
  </ReplayFrame>;
}

/** One URL, two documents. The role decides which reader runs; the server decides what it may read. */
export function ReplayViewer({ role, token, archiveId, onBack, onLaunched }: Readonly<{
  role: "gm" | "player"; token: string; archiveId: number; onBack: () => void; onLaunched?: () => void;
}>) {
  return role === "gm"
    ? <GmViewer gmToken={token} archiveId={archiveId} onBack={onBack} onLaunched={onLaunched ?? onBack} />
    : <PlayerViewer token={token} archiveId={archiveId} onBack={onBack} />;
}

// ───────────────────────────────── the list ─────────────────────────────────

/**
 * A hook rather than a component, because the same fetch feeds the full list and the player's shelf.
 * A player's listing is server-filtered to shared replays, so an empty answer here is the truth about
 * what the GM has shared — never a client-side filter over a longer list.
 */
export function useReplays(token: string | null): Readonly<{ archives: readonly ArchiveSummary[] | null; error: string | null; refresh: () => void }> {
  const [archives, setArchives] = useState<readonly ArchiveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!token) { setArchives([]); return; }
    let cancelled = false;
    readApi("/api/v1/encounters", token)
      .then((body) => { if (!cancelled) { setArchives(body.data.encounters as readonly ArchiveSummary[]); setError(null); } })
      .catch((cause: Error) => { if (!cancelled) { setArchives([]); setError(cause.message); } });
    return () => { cancelled = true; };
  }, [token, tick]);
  return { archives, error, refresh: () => setTick((value) => value + 1) };
}

export function ReplayList({ role, token, onOpen, onBack }: Readonly<{ role: "gm" | "player"; token: string; onOpen: (archiveId: number) => void;
  /** The player reaches this list at its own address, so its way back to the table is a frame row
      here rather than a button stranded above the surface (D27). */
  onBack?: () => void }>) {
  const { archives, error, refresh } = useReplays(token);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const setShared = async (archive: ArchiveSummary, shared: boolean) => {
    setBusy(archive.id);
    try {
      await readApi(`/api/v1/encounters/${archive.id}/visibility`, token, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerVisible: shared }) });
      refresh();
    } catch (cause) { toast((cause as Error).message, { tone: "error" }); }
    finally { setBusy(null); }
  };

  const download = async (archive: ArchiveSummary) => {
    setBusy(archive.id);
    try { const body = await readApi(`/api/v1/encounters/${archive.id}`, token); exportDocument(archive.id, archive.endedAt, body.data.document); }
    catch (cause) { toast((cause as Error).message, { tone: "error" }); }
    finally { setBusy(null); }
  };

  /** Triad Delete: permanent, confirmed, and the confirm says so in those words. */
  const remove = async (archive: ArchiveSummary) => {
    const ok = await confirm({
      title: "Delete this replay?",
      body: `The replay of the fight that ended ${dateOnly(archive.endedAt)} is gone — every turn, every roll, every line. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true
    });
    if (!ok) return;
    setBusy(archive.id);
    try { await readApi(`/api/v1/encounters/${archive.id}`, token, { method: "DELETE" }); toast("Replay deleted.", { tone: "success" }); refresh(); }
    catch (cause) { toast((cause as Error).message, { tone: "error" }); }
    finally { setBusy(null); }
  };

  /* THE FRAME (§7): the heading (and the player's way back) never move; the rows are the one
     region. Not a `.card` any more — the list IS the surface, so it stands on the scene sky and
     the rows are the cards on it. */
  return <section className="replay-panel replay-list-page pane-frame pane-scene scanlines frame-col anim-view">
    <div className="pane-sky" aria-hidden="true" />
    <header className="replay-list-head neon-beam">
      {onBack && <Button variant="ghost" className="replay-list-back" onClick={onBack}><IconChevronLeft /> Back to the table</Button>}
      <h2>Replays</h2>
      {/* The player's line only. A GM knows what their own replay list is; a player needs to know
          why theirs may be short, and that is the one fact this row is worth its height for. */}
      {role === "player" && <p>The fights your GM has shared with the party.</p>}
      {error && <p className="replay-error">{error}</p>}
    </header>
    <div className="replay-list-body scroll-y frame-fill">
    {archives === null && <p>Loading replays…</p>}
    {/* A scene moment (§9), and one with no door: this list fills itself when a fight ends. */}
    {archives !== null && archives.length === 0 && !error && <div className="scene-empty">
      <p>{role === "gm" ? "No replays yet. Every fight that ends is kept here." : "Your GM hasn’t shared a fight yet."}</p>
    </div>}
    {archives !== null && archives.length > 0 && <ul className="replay-rows">
      {archives.map((archive) => {
        const duration = durationOf(archive.startedAt, archive.endedAt);
        return <li key={archive.id} className="nh-card replay-row">
          <div className="replay-row-text">
            <span className="replay-row-title">{dateOnly(archive.endedAt)}</span>
            <span className="replay-row-meta tabular">{archive.turnCount} turns{duration ? ` · ${duration}` : ""}</span>
          </div>
          {role === "gm" && <RevealSwitch
            revealed={archive.playerVisible}
            ariaLabel="Show this replay to players"
            disabled={busy === archive.id}
            onChange={(shared) => void setShared(archive, shared)}
          />}
          <div className="replay-row-actions">
            <Button variant="secondary" size="sm" onClick={() => onOpen(archive.id)}>Watch</Button>
            {role === "gm" && <Menu trigger="More" label="More actions for this replay" align="end">
              <MenuItem onClick={() => void download(archive)}>Download JSON</MenuItem>
              <MenuItem tone="danger" onClick={() => void remove(archive)}>Delete replay</MenuItem>
            </Menu>}
          </div>
        </li>;
      })}
    </ul>}
    </div>
    {dialog}
  </section>;
}

/**
 * The player's shelf (§B4.4): the same shared replays, as a quiet section under their sheet. Renders
 * nothing at all when the GM has shared none — an empty shelf is not a thing to look at.
 */
export function ReplayShelf({ token, onOpen }: Readonly<{ token: string; onOpen: (archiveId: number) => void }>) {
  const { archives } = useReplays(token);
  if (!archives || archives.length === 0) return null;
  return <section className="replay-shelf">
    <h3>Replays</h3>
    <ul>
      {archives.map((archive) => <li key={archive.id}>
        <button type="button" className="replay-shelf-row" onClick={() => onOpen(archive.id)}>
          <span>{dateOnly(archive.endedAt)}</span>
          <span className="replay-shelf-meta tabular">{archive.turnCount} turns</span>
        </button>
      </li>)}
    </ul>
  </section>;
}
