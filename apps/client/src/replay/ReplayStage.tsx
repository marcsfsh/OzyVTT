import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconChevronLeft, IconChevronRight, IconPlay, SegmentedControl } from "@vtt/ui";
import { TokenStatusBadges, useAuthorizedMapImage } from "../scene/mapImage";
import { AuthorizedTokenGlyph } from "../tokens/tokenImages";
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

/** Prev / play / next / scrubber: one control group, shared by both viewers. */
export function Transport({
  index,
  count,
  playing,
  onMove,
  onPlay,
  onSeek
}: Readonly<{
  index: number;
  count: number;
  playing: boolean;
  onMove: (delta: number) => void;
  onPlay: () => void;
  onSeek: (index: number) => void;
}>) {
  return (
    <div className="replay-transport" role="group" aria-label="Replay controls">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        aria-label="Previous turn"
      >
        <IconChevronLeft />
      </Button>
      <Button variant="secondary" size="sm" onClick={onPlay} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "Pause" : <IconPlay />}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onMove(1)}
        disabled={index >= count - 1}
        aria-label="Next turn"
      >
        <IconChevronRight />
      </Button>
      <input
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        value={index}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Turn position"
      />
      <span className="replay-position tabular">
        {index + 1} / {count}
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
export function ReplaySide({ order, log }: Readonly<{ order: ReactNode; log: ReactNode }>) {
  const [pane, setPane] = useState<"order" | "log">("order");
  return (
    <aside className={`replay-side frame-col is-${pane}`}>
      <SegmentedControl
        className="replay-side-tabs"
        size="sm"
        ariaLabel="What to show beside the map"
        value={pane}
        onChange={(value) => setPane(value === "log" ? "log" : "order")}
        options={[
          { value: "order", label: "Turn order" },
          { value: "log", label: "This turn" }
        ]}
      />
      <div className="replay-side-scroll scroll-y frame-fill">
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
