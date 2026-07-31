import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Button, Skeleton } from "@vtt/ui";
import { iconChildren } from "./icons";
import { entityColor, entityIconId, ENTITY_DEFS, ENTITY_TYPE_LIST, type EntityType } from "./entities";
import { type CodexConnection, type PlayerCodexConnection } from "./api";

/**
 * The web of the world: pages as nodes (coloured and sized by how connected they are), joined by
 * **ONE kind of edge** (D8). A small deterministic force simulation (Fruchterman-Reingold + gravity)
 * lays it out — the same world always draws the same map — then it is framed to fit. Toggle kinds in
 * the legend, hover to focus a node's neighbourhood, pan/drag + wheel/pinch zoom, click to open.
 *
 * **D8: one edge style.** Typed relationships and `[[wiki links]]` used to be two edge kinds with two
 * line styles and a two-row key explaining the difference. They are one concept now, so the picture
 * draws one line; `origin` survives as a quiet attribute on the label ("mentions" where there is no
 * label of its own), never as a second layer of the render.
 *
 * **Non-page sources stay off the canvas in v1** (a recorded design call). The unified feed carries
 * session-, quest- and journal-sourced connections (D13); the graph draws `fromKind === "page"` edges
 * only and those others surface in the per-page Connections panel, rather than the graph inventing
 * three new node types nobody asked for. D8's "drawn one way" holds for everything it does draw.
 *
 * Viewer-safe by construction: the caller passes whichever node/edge set the role may see.
 */
export type GraphNode = Readonly<{ id: string; title: string; entityType: EntityType }>;

/**
 * CI-8: the two edge kinds flattened to one shape, so everything downstream — layout, degree, adjacency,
 * hit-testing, dimming — treats a connection as a connection and only the *paint* branches on kind.
 * Before this the Graph drew typed relationships alone, and a codex wired together with wiki-links read
 * as a field of orphans: the picture disagreed with the notebook.
 */
type GraphEdge = Readonly<{ key: string; fromPageId: string; toPageId: string; origin: "declared" | "mention"; label: string }>;
/** What an unlabelled derived edge is called on screen, so a line reads without a key. */
const MENTION_LABEL = "mentions";
const VB = { minX: -520, minY: -390, w: 1040, h: 780 };

function hashOf(id: string): number { let hash = 0; for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0; return Math.abs(hash); }

/** Deterministic force-directed layout → id → {x,y}, centered + scaled to frame within the viewBox. */
function computeLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<string, { x: number; y: number }> {
  const count = nodes.length || 1;
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const angle = (index / count) * Math.PI * 2;
    const jitter = hashOf(node.id);
    pos.set(node.id, { x: Math.cos(angle) * 240 + (jitter % 50) - 25, y: Math.sin(angle) * 240 + ((jitter >> 8) % 50) - 25 });
  });
  const ids = [...pos.keys()];
  const known = new Set(ids);
  const links = edges.filter((edge) => known.has(edge.fromPageId) && known.has(edge.toPageId) && edge.fromPageId !== edge.toPageId);
  const ideal = Math.max(70, Math.min(150, 900 / Math.sqrt(count)));
  const iterations = count > 90 ? 160 : 320;
  let temp = 220;
  for (let iter = 0; iter < iterations; iter += 1) {
    const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
        let dx = a.x - b.x, dy = a.y - b.y, dist = Math.hypot(dx, dy);
        if (dist < 0.01) { dx = ((hashOf(ids[i] + ids[j]) % 100) - 50) / 50 || 0.5; dy = 0.5; dist = Math.hypot(dx, dy); } // jog coincident nodes apart deterministically
        const force = (ideal * ideal) / dist;
        const di = disp.get(ids[i])!, dj = disp.get(ids[j])!;
        di.x += (dx / dist) * force; di.y += (dy / dist) * force;
        dj.x -= (dx / dist) * force; dj.y -= (dy / dist) * force;
      }
    }
    for (const edge of links) {
      const a = pos.get(edge.fromPageId)!, b = pos.get(edge.toPageId)!;
      const dx = a.x - b.x, dy = a.y - b.y, dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist * dist) / ideal;
      const da = disp.get(edge.fromPageId)!, db = disp.get(edge.toPageId)!;
      da.x -= (dx / dist) * force; da.y -= (dy / dist) * force;
      db.x += (dx / dist) * force; db.y += (dy / dist) * force;
    }
    for (const id of ids) {
      const move = disp.get(id)!, point = pos.get(id)!;
      move.x -= point.x * 0.09; move.y -= point.y * 0.09;
      const len = Math.hypot(move.x, move.y) || 0.01;
      point.x += (move.x / len) * Math.min(len, temp);
      point.y += (move.y / len) * Math.min(len, temp);
    }
    temp = Math.max(temp * 0.96, 4);
  }
  /**
   * CI-8: frame EVERY node the graph draws.
   *
   * This used to fit the bounding box of the connected web alone — nodes with at least one edge — on the
   * theory that orphans were noise and "stay reachable by panning". They did not: repulsion flings an
   * unconnected node well outside the connected cluster, and once the fit is computed without it the
   * scale/centre are wrong for it by construction. Measured on a 3-entity codex with one relationship,
   * the orphan landed at (-613, -1041) in a 1040×780 viewBox — a page the GM could see in the notebook
   * and could not see in the picture of it, with nothing on screen saying it was off-frame.
   *
   * Fitting the full set costs the connected cluster some scale and is bounded: the fit divides the
   * padded viewBox by the full span, so no node can leave it.
   */
  const xs = ids.map((id) => pos.get(id)!.x), ys = ids.map((id) => pos.get(id)!.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const fit = Math.min((VB.w - 150) / (maxX - minX || 1), (VB.h - 170) / (maxY - minY || 1), 1.4);
  for (const point of pos.values()) { point.x = (point.x - cx) * fit; point.y = (point.y - cy) * fit; }
  return pos;
}

export function ConnectionGraph({ nodes, connections, onOpen, emptyState, loading = false, focusPageId = null, onFocused = () => {} }: Readonly<{
  nodes: readonly GraphNode[];
  /**
   * D8: the ONE connection feed, from `GET /codex/connections`. Role-scoped by the CALLER — the GM shell
   * passes the GM feed and the player shell passes the player feed, and this component filters neither.
   * It cannot: it has no token and no notion of who is looking.
   */
  connections: ReadonlyArray<CodexConnection | PlayerCodexConnection>;
  onOpen: (pageId: string) => void;
  emptyState?: ReactNode;
  /** CF-2: true while the first fetch is in flight — "No pages yet" must not front-run the data. */
  loading?: boolean;
  /**
   * CI-5 / R1: land the graph ON an entity — centred and focused — rather than dropping the GM into the
   * whole web to hunt for it. Same handled-latch shape as `JournalView`'s `openEntryId` and the atlas's
   * `openTarget`: the request is consumed once and acknowledged through `onFocused`, so a refresh
   * cannot yank the view back, and the same node can be reached again from a later jump.
   */
  focusPageId?: string | null;
  onFocused?: () => void;
}>) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false); // survives pointerup so the click handler can tell a pan from a tap
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map()); // live pointers, for two-finger pinch
  const pinch = useRef<{ startDist: number; startK: number } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  /**
   * The viewBox→screen scale. `preserveAspectRatio="xMidYMid meet"` fits the viewBox inside the
   * element, so it is the smaller of the two ratios. Tracked in state (not read during render) so a
   * resize or an orientation change re-sizes the tap targets with it.
   */
  const [fitScale, setFitScale] = useState(1);
  const tapMin = useMemo(() => {
    if (typeof getComputedStyle !== "function") return 44;
    return Number(getComputedStyle(document.documentElement).getPropertyValue("--tap-min").trim().replace("px", "")) || 44;
  }, []);
  /**
   * Attached as the <svg>'s ref CALLBACK, not from an effect.
   *
   * This component returns early — a Skeleton while loading, an empty state with no nodes — so the
   * <svg> frequently does not exist on the render that mounts it. A `useEffect(..., [])` therefore ran
   * once against a null ref, bailed, and (empty deps) never retried: the observer was never attached
   * for the life of that mount, `fitScale` stayed at its 1 default, and every node's "44px" hit circle
   * came out at the painted radius. Reproduced at **14.8px** by switching to Graph while the pages
   * fetch was still in flight. A ref callback fires exactly when the element appears or disappears,
   * which is the actual condition, so the race cannot recur.
   */
  const observerRef = useRef<ResizeObserver | null>(null);
  const attachSvg = useCallback((element: SVGSVGElement | null) => {
    svgRef.current = element;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element || typeof ResizeObserver !== "function") return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) setFitScale(Math.min(box.width / VB.w, box.height / VB.h));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  useEffect(() => () => { observerRef.current?.disconnect(); observerRef.current = null; }, []);
  const [hover, setHover] = useState<string | null>(null);
  /** CI-5: the node a jump landed on. Distinct from `hover` because it must survive the pointer leaving. */
  const [pinned, setPinned] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<EntityType>>(new Set());

  /**
   * One edge list. Page sources only (see the note above); the key falls back to the endpoint pair for
   * a mention, which has no id of its own, and the order is the feed's so the layout stays deterministic.
   */
  const graphEdges = useMemo<GraphEdge[]>(() => connections
    .filter((edge) => edge.fromKind === "page")
    .map((edge) => ({
      key: ("id" in edge && edge.id) ? `c:${edge.id}` : `m:${edge.fromId}>${edge.toPageId}:${edge.label ?? ""}`,
      fromPageId: edge.fromId, toPageId: edge.toPageId, origin: edge.origin,
      label: edge.label ?? MENTION_LABEL
    })), [connections]);

  const signature = nodes.map((node) => node.id).join(",") + "|" + graphEdges.map((edge) => `${edge.fromPageId}>${edge.toPageId}`).join(",");
  const pos = useMemo(() => computeLayout(nodes, graphEdges), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const allEdges = useMemo(() => graphEdges.filter((edge) => pos.has(edge.fromPageId) && pos.has(edge.toPageId) && edge.fromPageId !== edge.toPageId), [graphEdges, pos]);
  const degree = useMemo(() => { const map = new Map<string, number>(); for (const edge of allEdges) { map.set(edge.fromPageId, (map.get(edge.fromPageId) ?? 0) + 1); map.set(edge.toPageId, (map.get(edge.toPageId) ?? 0) + 1); } return map; }, [allEdges]);
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const link = (a: string, b: string) => { let set = map.get(a); if (!set) { set = new Set(); map.set(a, set); } set.add(b); };
    for (const edge of allEdges) { link(edge.fromPageId, edge.toPageId); link(edge.toPageId, edge.fromPageId); }
    return map;
  }, [allEdges]);
  const usedTypes = useMemo(() => ENTITY_TYPE_LIST.filter((type) => nodes.some((node) => node.entityType === type)), [nodes]);

  const visibleNodes = nodes.filter((node) => !hidden.has(node.entityType));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const drawnEdges = allEdges.filter((edge) => visibleIds.has(edge.fromPageId) && visibleIds.has(edge.toPageId));

  // One focus, two sources: the node a jump pinned (CI-5), overridden while the pointer is on another
  // node so hovering still explores. Everything downstream reads `focusId` and cannot tell them apart.
  const focusId = hover ?? pinned;
  const focus = focusId && visibleIds.has(focusId) ? new Set([focusId, ...(adjacency.get(focusId) ?? [])]) : null;
  const radiusOf = (id: string) => 11 + Math.min(9, (degree.get(id) ?? 0) * 1.6);
  /**
   * CF-3 for an SVG node on a zoomable canvas. Neither design-language §4 route applies here: `::after`
   * is a CSS box-model construct that does not reach SVG geometry, and a node's on-screen size is a
   * function of the zoom transform rather than CSS, so no stylesheet can hold it at 44px.
   *
   * So the hit area is geometry: a transparent circle sized to 44px ON SCREEN (44/2 ÷ k, since the
   * parent <g> is scaled by k), capped at half the distance to the nearest other node. The cap is §4's
   * gap budget applied to a canvas — without it, zooming out far enough would make every node's hit
   * area overlap its neighbours, and since SVG hit-testing awards the topmost element, the last node
   * painted would silently swallow its neighbours' taps. Capped, the floor is met wherever it can be
   * met without stealing, and degrades to the painted radius where it cannot.
   */
  const nearestNeighbour = useMemo(() => {
    const out = new Map<string, number>();
    const points = [...pos.entries()];
    for (const [id, a] of points) {
      let best = Infinity;
      for (const [otherId, b] of points) {
        if (otherId === id) continue;
        best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
      }
      out.set(id, best);
    }
    return out;
  }, [pos]);
  const hitRadiusOf = (id: string) => {
    // A node's on-screen size is (viewBox fit scale × view.k). Measuring against view.k alone — as the
    // first cut of this did — silently under-sizes the hit area by the fit scale, which on a phone is
    // ~0.32: a "44px" circle measured 14px. The floor is defined in screen pixels, so convert properly.
    const screenScale = fitScale * view.k;
    // +1px of allowance: `fitScale` is sampled by a ResizeObserver, so it can lag the live layout by a
    // fraction of a pixel, and that was enough to measure 43.7px against a 44px floor. Aim a pixel over
    // so rounding can never land under it.
    const wanted = (tapMin + 1) / 2 / (screenScale || 1);
    const cap = (nearestNeighbour.get(id) ?? Infinity) / 2;
    return Math.max(radiusOf(id), Math.min(wanted, cap));
  };

  /**
   * CI-5 / R1: consume an incoming "focus this entity" request. Preparing the destination means BOTH
   * halves — the node is pinned (so it and its neighbourhood stay lit while everything else dims) and
   * the view is centred on it at 1× (so it is on screen, not somewhere in a panned-away corner). The
   * viewBox is centred on the world origin, so a node at world `p` sits under the middle of the frame
   * exactly when `view.{x,y} === -p.{x,y}` at k = 1.
   *
   * Gated on `loading` and re-run on `pos` so a jump that arrives before the pages do still lands: the
   * latch is only claimed once the layout actually contains the node.
   */
  const handledFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPageId) { handledFocusRef.current = null; return; }
    if (loading || handledFocusRef.current === focusPageId) return;
    const point = pos.get(focusPageId);
    // Nothing to centre on yet. Don't claim the latch — `pos` changing re-runs this.
    if (!point && nodes.length === 0) return;
    handledFocusRef.current = focusPageId;
    if (point) { setPinned(focusPageId); setView({ k: 1, x: -point.x, y: -point.y }); }
    onFocused();
  }, [focusPageId, loading, pos, nodes.length, onFocused]);

  const toggleType = (type: EntityType) => setHidden((prev) => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; });

  const scaleAt = () => { const rect = svgRef.current?.getBoundingClientRect(); return rect ? Math.min(rect.width / VB.w, rect.height / VB.h) : 1; };
  const toViewBox = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const scale = Math.min(rect.width / VB.w, rect.height / VB.h);
    return { vx: VB.minX + (clientX - rect.left - (rect.width - VB.w * scale) / 2) / scale, vy: VB.minY + (clientY - rect.top - (rect.height - VB.h * scale) / 2) / scale };
  };

  const onWheel = (event: ReactWheelEvent) => {
    const { vx, vy } = toViewBox(event.clientX, event.clientY);
    setView((prev) => {
      const k = Math.max(0.25, Math.min(3, prev.k * (1 - event.deltaY * 0.0016)));
      const worldX = (vx - prev.x) / prev.k, worldY = (vy - prev.y) / prev.k;
      return { k, x: vx - worldX * k, y: vy - worldY * k };
    });
  };
  const pinchDistance = () => { const [a, b] = [...pointers.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const onPointerDown = (event: ReactPointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) { pinch.current = { startDist: pinchDistance() || 1, startK: view.k }; drag.current = null; return; }
    drag.current = { x: event.clientX, y: event.clientY }; moved.current = false;
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const dist = pinchDistance();
      const k = Math.max(0.25, Math.min(3, pinch.current.startK * (dist / pinch.current.startDist)));
      const [a, b] = [...pointers.current.values()];
      const { vx, vy } = toViewBox((a.x + b.x) / 2, (a.y + b.y) / 2); // zoom around the pinch midpoint
      setView((prev) => { const worldX = (vx - prev.x) / prev.k, worldY = (vy - prev.y) / prev.k; return { k, x: vx - worldX * k, y: vy - worldY * k }; });
      return;
    }
    if (!drag.current) return;
    const factor = 1 / scaleAt();
    const dx = (event.clientX - drag.current.x) * factor, dy = (event.clientY - drag.current.y) * factor;
    if (Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) > 3) moved.current = true;
    drag.current.x = event.clientX; drag.current.y = event.clientY;
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) { const [remaining] = [...pointers.current.values()]; drag.current = { x: remaining.x, y: remaining.y }; moved.current = true; } // resume pan on the surviving finger
    else if (pointers.current.size === 0) drag.current = null;
  };
  // moved.current persists past the synchronous pointerup→click, so a pan that started on a node doesn't open it.
  const openNode = (id: string) => { if (!moved.current) onOpen(id); };

  const zoomBy = (factor: number) => setView((prev) => {
    const k = Math.max(0.25, Math.min(3, prev.k * factor));
    const worldX = -prev.x / prev.k, worldY = -prev.y / prev.k; // keep the viewBox centre (world origin) fixed
    return { k, x: -worldX * k, y: -worldY * k };
  });

  // CF-2: settle the fetch before claiming emptiness — including the caller-supplied empty state.
  if (loading && nodes.length === 0) return <div className="codex-main-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>;
  if (nodes.length === 0) {
    return emptyState
      ? <div className="codex-main-empty">{emptyState}</div>
      : <div className="codex-main-empty"><h3>No pages yet</h3><p>The Graph draws every page and the connections between them. Create a few in Pages and connect them.</p></div>;
  }

  return (
    <div className="codex-graph">
      <div className="codex-graph-bar">
        {/* D8: ONE count, because there is one kind of connection. The old two-row edge key explaining
            "Relationship" versus "Mention" retires with the two edge styles it described. */}
        <span className="codex-graph-hint">{visibleNodes.length} pages · {drawnEdges.length} connection{drawnEdges.length === 1 ? "" : "s"} · drag to pan, scroll to zoom</span>
        <div className="codex-graph-legend">
          {usedTypes.map((type) => (
            <button key={type} type="button" className={`codex-graph-legenditem${hidden.has(type) ? " is-off" : ""}`} aria-pressed={!hidden.has(type)} title={hidden.has(type) ? `Show ${ENTITY_DEFS[type].label}` : `Hide ${ENTITY_DEFS[type].label}`} onClick={() => toggleType(type)}>
              <i style={{ background: entityColor(type) }} />{ENTITY_DEFS[type].label}
            </button>
          ))}
        </div>
        <div className="codex-graph-zoom">
          <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>−</Button>
          <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</Button>
          {/* Reset clears the CI-5 focus too — otherwise a pinned node keeps the rest of the web dimmed
              with no obvious way back to the whole picture. */}
          <Button variant="ghost" size="sm" onClick={() => { setView({ x: 0, y: 0, k: 1 }); setPinned(null); }}>Reset</Button>
        </div>
      </div>
      <svg ref={attachSvg} className="codex-graph-svg" viewBox={`${VB.minX} ${VB.minY} ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} style={{ touchAction: "none" }}>
        <defs>
          <marker id="codex-graph-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path className="codex-graph-arrowhead" d="M0,0 L10,5 L0,10 z" /></marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {drawnEdges.map((edge) => {
            const a = pos.get(edge.fromPageId)!, b = pos.get(edge.toPageId)!;
            const lit = focusId === edge.fromPageId || focusId === edge.toPageId;
            const dim = focus ? !lit : false;
            const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
            return (
              /* D8: ONE style. Every edge is a solid arrow with its label; `origin` is carried as a data
                 attribute for the label text alone, never as a second line style. */
              <g key={edge.key} data-edgeorigin={edge.origin} className={`codex-graph-edge${lit ? " is-lit" : ""}${dim ? " is-dim" : ""}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#codex-graph-arrow)" />
                {(lit || view.k > 1.4 || drawnEdges.length <= 10) && <text x={midX} y={midY} className="codex-graph-edgelabel">{edge.label}</text>}
              </g>
            );
          })}
          {visibleNodes.map((node) => {
            const point = pos.get(node.id)!;
            const radius = radiusOf(node.id);
            const dim = focus ? !focus.has(node.id) : false;
            const isFocus = pinned === node.id;
            return (
              <g key={node.id} className={`codex-graph-node${hover === node.id ? " is-hover" : ""}${isFocus ? " is-focus" : ""}${dim ? " is-dim" : ""}`} transform={`translate(${point.x} ${point.y})`}
                onPointerEnter={() => setHover(node.id)} onPointerLeave={() => setHover((current) => (current === node.id ? null : current))} onClick={() => openNode(node.id)}
                role="button" tabIndex={0} aria-label={`${ENTITY_DEFS[node.entityType].label}: ${node.title}`}
                /* CI-5: the landing is stated in the accessibility tree too, not only by a ring. */
                aria-current={isFocus ? "true" : undefined}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(node.id); } }}>
                {/* Hit area first so it sits UNDER the paint: same <g>, so the click handler is unchanged. */}
                <circle className="codex-graph-nodehit" r={hitRadiusOf(node.id)} />
                <circle r={radius} style={{ fill: entityColor(node.entityType) }} />
                <g className="codex-graph-nodeicon" transform="translate(-7 -7) scale(0.58)">{iconChildren(entityIconId(node.entityType))}</g>
                <text className="codex-graph-nodelabel" textAnchor="middle" y={radius + 15}>{node.title}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
