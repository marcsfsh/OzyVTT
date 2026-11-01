import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  IconChevronLeft,
  IconButton,
  IconChevronRight,
  IconPause,
  IconPlay,
  Roll,
  SegmentedControl,
  burst,
  canMove,
  comet,
  useDragSurface,
  useOnChange
} from "@vtt/ui";
import { useAuthorizedMapImage } from "../scene/mapImage";
import { TokenStatusBadges } from "../scene/tokenGlyph";
import { AuthorizedTokenGlyph } from "../tokens/tokenImages";
import { lineMarks, lineRounds, turnAt, turnCount, type LineTurn } from "./line";
import { readArchive } from "./replays";
import "./replay.css";

/** The pieces both replay viewers share: the stage, the transport, the frame and its side lists. */

export const when = (iso: string | null) => (
  <span className="tabular">
    {iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "-"}
  </span>
);

/** Loads one archive document; a viewer is keyed by its archive, so this runs once per viewer. */
export function useArchiveDocument<T>(
  archiveId: number,
  token: string
): Readonly<{ document: T | null; error: string | null }> {
  const [document, setDocument] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    readArchive<T>(archiveId, token)
      .then((loaded) => {
        if (!cancelled) setDocument(loaded);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [archiveId, token]);
  return { document, error };
}

/** Steps through `count` positions, auto-advancing every 2.5s while playing and stopping at the end. */
export function usePlayback(count: number) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    if (index >= count - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((current) => Math.min(count - 1, current + 1)), 2500);
    return () => clearTimeout(timer);
  }, [playing, index, count]);
  const move = (delta: number) => {
    setPlaying(false);
    setIndex((current) => Math.max(0, Math.min(count - 1, current + delta)));
  };
  const toggle = () => {
    if (playing) return setPlaying(false);
    if (index >= count - 1) setIndex(0);
    setPlaying(true);
  };
  const seek = (next: number) => {
    setPlaying(false);
    setIndex(next);
  };
  return { index, playing, move, toggle, seek };
}

export function Stage({
  mapAssetId,
  bearer,
  tokens,
  label,
  actorFor
}: Readonly<{
  mapAssetId: string | null;
  bearer: string;
  tokens: ReadonlyArray<{ actorId: string; position: { x: number; y: number } | null; sizePx: number }>;
  label: string;
  /** Everything the stage needs about one token's creature, already role-appropriate. */
  actorFor: (actorId: string) => Readonly<{
    name: string;
    tokenAssetId: string | null;
    hidden: boolean;
    band: "healthy" | "bloodied" | "down";
    conditions: readonly string[];
    active: boolean;
  }> | null;
}>) {
  const image = useAuthorizedMapImage(mapAssetId, bearer);
  const placed = tokens.filter((token) => token.position !== null);
  if (image.status === "error")
    return (
      <div className="replay-stage replay-stage-missing">
        <strong>Map unavailable</strong>
        <span>{image.message} The turn data beside this still applies.</span>
      </div>
    );
  if (image.status !== "ready")
    return (
      <div className="replay-stage replay-stage-missing">
        <span>Loading the battlefield…</span>
      </div>
    );
  /* Like the shared-screen viewer's stage (`.viewer-stage`): the svg fills its box and
     `preserveAspectRatio` letterboxes, so the frame decides the height. */
  return (
    <div className="replay-stage">
      <svg
        viewBox={`0 0 ${image.width} ${image.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
      >
        <image href={image.url} width={image.width} height={image.height} />
        {placed.map((token) => {
          const actor = actorFor(token.actorId);
          if (!actor || !token.position) return null;
          return (
            <g
              key={token.actorId}
              className={`replay-token${actor.hidden ? " replay-token-hidden" : ""}`}
              transform={`translate(${token.position.x} ${token.position.y})`}
            >
              <AuthorizedTokenGlyph
                assetId={actor.tokenAssetId}
                token={bearer}
                sizePx={token.sizePx}
                name={actor.name}
                active={actor.active}
                turnClassName="encounter-token-turn"
                bodyClassName="encounter-token-body"
                initialsClassName="encounter-token-initials"
                nameClassName="encounter-token-name"
                nameY={token.sizePx * 0.72}
                initialsStyle={{ fontSize: Math.max(10, token.sizePx * 0.34) }}
                nameStyle={{ fontSize: Math.max(9, token.sizePx * 0.23) }}
              />
              <TokenStatusBadges
                sizePx={token.sizePx}
                health={actor.band}
                conditions={actor.conditions.map((id) => ({ id, label: id }))}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Previous, Play and Next as icon buttons, then the line of rounds, then the count. The line is a section a round with a
 * tick a turn, the watched part lit up to the knob, and marks under it for damage, healing and a creature at 0.
 * Pressing or dragging on it goes to the nearest turn; the frame's arrow keys step through it as before.
 */
export function Transport({
  index,
  count,
  playing,
  line,
  onMove,
  onPlay,
  onSeek
}: Readonly<{
  index: number;
  count: number;
  playing: boolean;
  /** Each turn's round and health, for the line's sections and marks. */
  line: readonly LineTurn[];
  onMove: (delta: number) => void;
  onPlay: () => void;
  onSeek: (index: number) => void;
}>) {
  const transport = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  // Dragging on the line seeks, so a finger's movement there never becomes a scroll or a fling.
  const lineSurface = useDragSurface<HTMLDivElement>();
  const rounds = useMemo(() => lineRounds(line), [line]);
  const marks = useMemo(() => lineMarks(line), [line]);
  const at = (turn: number) => (count < 2 ? 0 : (turn / (count - 1)) * 100);
  // Moving to another turn runs a comet along the line to it, with a burst where it lands (ADR-0045).
  useOnChange(index, (before, now) => {
    const el = transport.current;
    const bar = rail.current;
    if (!el || !bar || count < 2 || !canMove()) return;
    const x = (turn: number) => bar.offsetLeft + (bar.offsetWidth * turn) / (count - 1);
    const y = bar.offsetTop + bar.offsetHeight / 2;
    comet(el, { from: x(before), to: x(now), line: y, thick: 3, delay: 0, dur: 240 });
    burst(el, { at: x(now), line: y, delay: 220, w: 60, h: 8 });
  });
  const seekFrom = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const turn = turnAt((event.clientX - box.left) / box.width, count);
    if (turn !== index) onSeek(turn);
  };
  return (
    <div ref={transport} className="replay-transport" role="group" aria-label="Replay controls">
      <span className="replay-transport-buttons">
        <IconButton label="Previous turn" onClick={() => onMove(-1)} disabled={index === 0}>
          <IconChevronLeft />
        </IconButton>
        <IconButton label={playing ? "Pause" : "Play"} onClick={onPlay}>
          {playing ? <IconPause /> : <IconPlay />}
        </IconButton>
        <IconButton label="Next turn" onClick={() => onMove(1)} disabled={index >= count - 1}>
          <IconChevronRight />
        </IconButton>
      </span>
      <div
        ref={lineSurface}
        className="replay-line tap-target"
        role="slider"
        tabIndex={0}
        aria-label="Turn position"
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={index + 1}
        aria-valuetext={turnCount(index, count)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          seekFrom(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) seekFrom(event);
        }}
      >
        <div className="replay-line-rounds" aria-hidden="true">
          {rounds.map((round) => (
            <span key={round.start} className="replay-line-round" style={{ flexGrow: round.length }}>
              R{round.round}
            </span>
          ))}
        </div>
        <div ref={rail} className="replay-line-rail" aria-hidden="true">
          <span className="replay-line-watched" style={{ width: `${at(index)}%` }} />
          {line.map((_, turn) => (
            <span
              key={turn}
              className={
                rounds.some((round) => round.start === turn) ? "replay-line-tick is-round" : "replay-line-tick"
              }
              style={{ left: `${at(turn)}%` }}
            />
          ))}
          <span className="replay-line-knob" style={{ left: `${at(index)}%` }} />
        </div>
        <div className="replay-line-marks" aria-hidden="true">
          {marks.map((mark, turn) =>
            mark ? (
              <span
                key={turn}
                className={`replay-line-mark is-${mark}`}
                data-mark={mark}
                style={{ left: `${at(turn)}%` }}
              />
            ) : null
          )}
        </div>
      </div>
      <span className="replay-position tabular">
        <Roll value={turnCount(index, count)} />
      </span>
    </div>
  );
}

/**
 * The frame both viewers wear: header, transport and step label are fixed rows; the layout row
 * below takes the leftover height, and only the side lists scroll.
 * Arrow keys are handled on this non-scrolling column so stepping never becomes scrolling. A
 * focused input/select/textarea keeps its own arrow keys.
 */
export function ReplayFrame({
  loaded,
  onMove,
  children
}: Readonly<{ loaded: unknown; onMove: (delta: number) => void; children: ReactNode }>) {
  const frameRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    frameRef.current?.focus();
  }, [loaded]);
  return (
    <section
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
    >
      {children}
    </section>
  );
}

/** Loading and error wear the frame too, so the surface never changes shape. */
export function ReplayNotice({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <section className="replay-panel replay-viewer replay-notice pane-frame frame-col anim-view">
      <h2>Replay</h2>
      {children}
    </section>
  );
}

/**
 * The side lists: one declared scroll region at every width, holding the turn order and the turn's
 * log. Below 850px the two become tabs inside that region (as in `DockAccordion.tsx`), since a
 * phone cannot show both end to end under the map band.
 */
/** One turn of the whole fight, for the list beside the map. */
export type FightTurn = Readonly<{ label: string; at: ReactNode }>;

/**
 * Beside the map: the whole fight, a row a turn with the one on screen lit and each pressable to go to it (E3 replays
 * spec 2.2), then the turn order and what happened during this turn.
 */
export function ReplaySide({
  order,
  log,
  turns,
  current,
  onSeek
}: Readonly<{
  order: ReactNode;
  log: ReactNode;
  turns?: readonly FightTurn[];
  current?: number;
  onSeek?: (index: number) => void;
}>) {
  const [pane, setPane] = useState<"fight" | "order" | "log">(turns ? "fight" : "order");
  return (
    <aside className={`replay-side frame-col is-${pane}`}>
      <SegmentedControl
        className="replay-side-tabs"
        size="sm"
        ariaLabel="What to show beside the map"
        value={pane}
        onChange={(value) => setPane(value === "log" ? "log" : value === "fight" ? "fight" : "order")}
        options={[
          ...(turns ? [{ value: "fight", label: "Every turn" }] : []),
          { value: "order", label: "Turn order" },
          { value: "log", label: "This turn" }
        ]}
      />
      <div className="replay-side-scroll scroll-y frame-fill">
        {turns && (
          <section className="replay-side-pane replay-side-fight">
            <h3>Every turn of the encounter</h3>
            <ol className="replay-turns">
              {turns.map((turn, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className={index === current ? "replay-turn is-on interactive" : "replay-turn interactive"}
                    aria-current={index === current ? "step" : undefined}
                    onClick={() => onSeek?.(index)}
                  >
                    <span>{turn.label}</span>
                    <small>{turn.at}</small>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
        <section className="replay-side-pane replay-side-order">
          <h3>Turn order</h3>
          {order}
        </section>
        <section className="replay-side-pane replay-side-log">
          <h3>During this turn</h3>
          {log}
        </section>
      </div>
    </aside>
  );
}
