import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Button } from "@vtt/ui";
import { entityColor, entityIcon, ENTITY_DEFS, ENTITY_TYPE_LIST, RELATIONSHIP_TYPES, type EntityType } from "./entities";
import { type CodexRelationshipEdge } from "./api";

/**
 * The web of the world: entities as nodes (colored + sized by how connected they are), typed
 * relationships as directed, labeled edges. A small deterministic force simulation (Fruchterman-Reingold
 * + gravity) lays it out — the same world always draws the same map — then it's framed to fit. Toggle
 * types in the legend, hover to focus a node's neighborhood, pan/drag + wheel/pinch zoom, click to open.
 * Viewer-safe by construction: the caller passes whichever node/edge set the role may see.
 */
export type GraphNode = Readonly<{ id: string; title: string; entityType: EntityType }>;

const REL_LABEL = new Map(RELATIONSHIP_TYPES.map((entry) => [entry.type, entry.label]));
const VB = { minX: -520, minY: -390, w: 1040, h: 780 };

function hashOf(id: string): number { let hash = 0; for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0; return Math.abs(hash); }

/** Deterministic force-directed layout → id → {x,y}, centered + scaled to frame within the viewBox. */
function computeLayout(nodes: readonly GraphNode[], edges: readonly CodexRelationshipEdge[]): Map<string, { x: number; y: number }> {
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
  // Frame: center + scale to fit the viewBox so every node (incl. orphans flung outward) is visible.
  const xs = [...pos.values()].map((point) => point.x), ys = [...pos.values()].map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const fit = Math.min((VB.w - 150) / (maxX - minX || 1), (VB.h - 170) / (maxY - minY || 1), 1.4);
  for (const point of pos.values()) { point.x = (point.x - cx) * fit; point.y = (point.y - cy) * fit; }
  return pos;
}

export function RelationshipGraph({ nodes, edges, onOpen }: Readonly<{ nodes: readonly GraphNode[]; edges: readonly CodexRelationshipEdge[]; onOpen: (pageId: string) => void }>) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false); // survives pointerup so the click handler can tell a pan from a tap
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<EntityType>>(new Set());

  const signature = nodes.map((node) => node.id).join(",") + "|" + edges.map((edge) => `${edge.fromPageId}>${edge.toPageId}`).join(",");
  const pos = useMemo(() => computeLayout(nodes, edges), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const allEdges = useMemo(() => edges.filter((edge) => pos.has(edge.fromPageId) && pos.has(edge.toPageId) && edge.fromPageId !== edge.toPageId), [edges, pos]);
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
  const focus = hover && visibleIds.has(hover) ? new Set([hover, ...(adjacency.get(hover) ?? [])]) : null;
  const radiusOf = (id: string) => 11 + Math.min(9, (degree.get(id) ?? 0) * 1.6);

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
  const onPointerDown = (event: ReactPointerEvent) => { drag.current = { x: event.clientX, y: event.clientY }; moved.current = false; (event.target as Element).setPointerCapture?.(event.pointerId); };
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag.current) return;
    const factor = 1 / scaleAt();
    const dx = (event.clientX - drag.current.x) * factor, dy = (event.clientY - drag.current.y) * factor;
    if (Math.abs(event.clientX - drag.current.x) + Math.abs(event.clientY - drag.current.y) > 3) moved.current = true;
    drag.current.x = event.clientX; drag.current.y = event.clientY;
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };
  const onPointerUp = () => { drag.current = null; };
  // moved.current persists past the synchronous pointerup→click, so a pan that started on a node doesn't open it.
  const openNode = (id: string) => { if (!moved.current) onOpen(id); };

  const zoomBy = (factor: number) => setView((prev) => {
    const k = Math.max(0.25, Math.min(3, prev.k * factor));
    const worldX = -prev.x / prev.k, worldY = -prev.y / prev.k; // keep the viewBox centre (world origin) fixed
    return { k, x: -worldX * k, y: -worldY * k };
  });

  if (nodes.length === 0) {
    return <div className="codex-main-empty"><h3>No entities yet</h3><p>The relationship graph draws every entity and the links between them. Create a few in the Pages tab and connect them.</p></div>;
  }

  return (
    <div className="codex-graph">
      <div className="codex-graph-bar">
        <span className="codex-graph-hint">{visibleNodes.length} entities · {drawnEdges.length} links · drag to pan, scroll to zoom</span>
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
          <Button variant="ghost" size="sm" onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset</Button>
        </div>
      </div>
      <svg ref={svgRef} className="codex-graph-svg" viewBox={`${VB.minX} ${VB.minY} ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} style={{ touchAction: "none" }}>
        <defs>
          <marker id="codex-graph-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path className="codex-graph-arrowhead" d="M0,0 L10,5 L0,10 z" /></marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {drawnEdges.map((edge) => {
            const a = pos.get(edge.fromPageId)!, b = pos.get(edge.toPageId)!;
            const lit = hover === edge.fromPageId || hover === edge.toPageId;
            const dim = focus ? !lit : false;
            const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
            return (
              <g key={edge.id} className={`codex-graph-edge${lit ? " is-lit" : ""}${dim ? " is-dim" : ""}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#codex-graph-arrow)" />
                {(lit || view.k > 1.4) && <text x={midX} y={midY} className="codex-graph-edgelabel">{REL_LABEL.get(edge.type) ?? edge.type}</text>}
              </g>
            );
          })}
          {visibleNodes.map((node) => {
            const point = pos.get(node.id)!;
            const radius = radiusOf(node.id);
            const dim = focus ? !focus.has(node.id) : false;
            return (
              <g key={node.id} className={`codex-graph-node${hover === node.id ? " is-hover" : ""}${dim ? " is-dim" : ""}`} transform={`translate(${point.x} ${point.y})`}
                onPointerEnter={() => setHover(node.id)} onPointerLeave={() => setHover((current) => (current === node.id ? null : current))} onClick={() => openNode(node.id)}
                role="button" tabIndex={0} aria-label={`${ENTITY_DEFS[node.entityType].label}: ${node.title}`}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(node.id); } }}>
                <circle r={radius} style={{ fill: entityColor(node.entityType) }} />
                <text className="codex-graph-nodeicon" textAnchor="middle" dy="5">{entityIcon(node.entityType)}</text>
                <text className="codex-graph-nodelabel" textAnchor="middle" y={radius + 15}>{node.title}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
