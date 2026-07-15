import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";

type ProofToken = { label: string; color: number; x: number; y: number; controlled?: boolean };

const CELL = 64;
const TOKENS: ProofToken[] = [
  { label: "You", color: 0x4387d8, x: 5.5, y: 5.5, controlled: true },
  { label: "Goblin A", color: 0xb14b43, x: 10.5, y: 4.5 },
  { label: "Goblin B", color: 0xb14b43, x: 12.5, y: 7.5 }
];

/** Phase 0 only: validates WebGL, high-DPI rendering, pan/zoom, pointer drag and touch pinch. */
export function RendererProof() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Interactive renderer proof — local-only, no encounter state is changed.");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    const app = new Application();
    const viewport = new Container();
    let zoom = 1;
    let pan = { x: 0, y: 0 };
    let dragStart: { x: number; y: number; panX: number; panY: number } | undefined;
    let pinchStart: { distance: number; zoom: number } | undefined;
    const applyTransform = () => { viewport.position.set(pan.x, pan.y); viewport.scale.set(zoom); };
    const draw = () => {
      const map = new Graphics().rect(0, 0, CELL * 20, CELL * 14).fill(0x342d21);
      for (let x = 0; x <= 20; x++) map.moveTo(x * CELL, 0).lineTo(x * CELL, 14 * CELL).stroke({ color: 0x8b7a55, width: 1, alpha: 0.55 });
      for (let y = 0; y <= 14; y++) map.moveTo(0, y * CELL).lineTo(20 * CELL, y * CELL).stroke({ color: 0x8b7a55, width: 1, alpha: 0.55 });
      viewport.addChild(map);
      for (const token of TOKENS) {
        const tokenGraphic = new Graphics().circle(0, 0, 25).fill(token.color).stroke({ color: token.controlled ? 0xf6c452 : 0x1b1711, width: token.controlled ? 5 : 3 });
        tokenGraphic.eventMode = "static"; tokenGraphic.cursor = "grab"; tokenGraphic.x = token.x * CELL; tokenGraphic.y = token.y * CELL;
        tokenGraphic.on("pointertap", () => setStatus(`${token.label} selected. Selection and targeting remain distinct in the domain model.`));
        viewport.addChild(tokenGraphic);
        const label = new Text({ text: token.label, style: { fill: 0xf8f1e7, fontFamily: "system-ui", fontSize: 14, fontWeight: "600" } });
        label.anchor.set(0.5, 0); label.x = token.x * CELL; label.y = token.y * CELL + 32; viewport.addChild(label);
      }
      applyTransform();
    };
    const touchDistance = (event: TouchEvent) => Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    const start = async () => {
      await app.init({ background: 0x16120c, resizeTo: mount, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) });
      if (disposed) return app.destroy();
      mount.appendChild(app.canvas); app.stage.addChild(viewport); pan = { x: Math.max(20, mount.clientWidth * 0.12), y: Math.max(20, mount.clientHeight * 0.1) }; draw();
      mount.addEventListener("wheel", (event) => { event.preventDefault(); zoom = Math.min(2.5, Math.max(0.45, zoom * (event.deltaY < 0 ? 1.1 : 0.9))); applyTransform(); setStatus(`Zoom ${Math.round(zoom * 100)}%.`); }, { passive: false });
      mount.addEventListener("pointerdown", (event) => { if ((event.target as HTMLElement).tagName === "CANVAS") { dragStart = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; mount.setPointerCapture?.(event.pointerId); } });
      mount.addEventListener("pointermove", (event) => { if (dragStart) { pan = { x: dragStart.panX + event.clientX - dragStart.x, y: dragStart.panY + event.clientY - dragStart.y }; applyTransform(); } });
      mount.addEventListener("pointerup", () => { if (dragStart) setStatus("Map panned. Token movement will become a server-authorized command in Phase 2."); dragStart = undefined; });
      mount.addEventListener("touchstart", (event) => { if (event.touches.length === 2) pinchStart = { distance: touchDistance(event), zoom }; }, { passive: true });
      mount.addEventListener("touchmove", (event) => { if (event.touches.length === 2 && pinchStart) { zoom = Math.min(2.5, Math.max(0.45, pinchStart.zoom * (touchDistance(event) / pinchStart.distance))); applyTransform(); } }, { passive: true });
      mount.addEventListener("touchend", () => { if (pinchStart) setStatus(`Pinch zoom ${Math.round(zoom * 100)}%.`); pinchStart = undefined; }, { passive: true });
    };
    void start();
    return () => { disposed = true; app.destroy({ removeView: true }, { children: true }); };
  }, []);

  return <section className="renderer-proof" aria-label="Map renderer technical proof"><div className="proof-heading"><div><span className="eyebrow">PHASE 0 TECHNICAL PROOF</span><h2>Map, token, and touch renderer</h2></div><p aria-live="polite">{status}</p></div><div ref={mountRef} className="proof-canvas" tabIndex={0} aria-label="Interactive proof map. Scroll to zoom, drag empty map to pan, select a token by tapping it." /></section>;
}
