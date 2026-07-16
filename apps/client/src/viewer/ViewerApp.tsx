import { useEffect, useMemo, useRef, useState } from "react";
import "./viewer.css";

type Point = Readonly<{ x: number; y: number }>;
type Presentation = Readonly<{
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  activeMap: Readonly<{ assetId: string; altText: string }> | null;
  camera: Readonly<{ center: Point; zoom: number }> | null;
  measurement: Readonly<{ id: string; points: readonly Point[]; distanceLabel: string }> | null;
  pings: readonly Readonly<{ id: string; point: Point; label?: string; expiresAt: number }>[];
  initiative: Readonly<{ visible: boolean; round: number; hiddenTurn: boolean; entries: readonly Readonly<{ actorId: string; name: string; initiative: number; active: boolean }>[] }>;
  encounter: Readonly<{ mapAssetId: string | null; tokens: readonly Readonly<{ actorId: string; name: string; kind: "player-character" | "monster" | "npc"; position: Point; sizePx: number; active: boolean }>[] }>;
}>;

type ConnectionState = "pairing" | "connecting" | "live" | "reconnecting";

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Viewer request failed.");
  return body;
}

function imageUrl(assetId: string) {
  return `/api/v1/map-assets/${encodeURIComponent(assetId)}/content`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function Pairing({ onPaired }: Readonly<{ onPaired: () => void }>) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("Table display");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/viewer/pairings/exchange", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
      await responseJson(response); onPaired();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="viewer-pairing"><form onSubmit={submit} aria-labelledby="pair-title">
    <span className="viewer-eyebrow">SHARED TABLE VIEWER</span>
    <h1 id="pair-title">Pair this screen</h1>
    <p>Ask the GM for the temporary pairing code. This screen receives only player-safe presentation data.</p>
    <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoComplete="off" /></label>
    <label>Pairing code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" autoFocus /></label>
    <button disabled={busy}>{busy ? "Pairing…" : "Pair viewer"}</button>
    <p className="viewer-feedback" role="alert">{message}</p>
  </form></main>;
}

function Initiative({ presentation }: Readonly<{ presentation: Presentation }>) {
  if (!presentation.initiative.visible) return null;
  return <aside className="viewer-initiative" aria-label={`Initiative, round ${presentation.initiative.round}`}>
    <div><span>INITIATIVE</span><strong>Round {presentation.initiative.round}</strong></div>
    {presentation.initiative.hiddenTurn && <p className="viewer-hidden-turn">GM turn</p>}
    <ol>{presentation.initiative.entries.map((entry) => <li key={entry.actorId} className={entry.active ? "active" : ""} aria-current={entry.active ? "step" : undefined}>
      <span>{entry.name}</span><strong>{entry.initiative}</strong>
    </li>)}</ol>
  </aside>;
}

function MapStage({ presentation }: Readonly<{ presentation: Presentation }>) {
  const [size, setSize] = useState({ width: 16, height: 9 });
  const href = presentation.activeMap ? imageUrl(presentation.activeMap.assetId) : "";
  const viewBox = useMemo(() => {
    const camera = presentation.camera;
    if (!camera) return `0 0 ${size.width} ${size.height}`;
    const width = size.width / camera.zoom;
    const height = size.height / camera.zoom;
    return `${camera.center.x - width / 2} ${camera.center.y - height / 2} ${width} ${height}`;
  }, [presentation.camera, size]);
  if (!presentation.activeMap) return <section className="viewer-waiting"><span className="viewer-eyebrow">VIEWER CONNECTED</span><h1>Waiting for a map</h1><p>The GM controls what appears here.</p></section>;
  const measurementPoints = presentation.measurement?.points.map((point) => `${point.x},${point.y}`).join(" ");
  const tokens = presentation.encounter.mapAssetId === presentation.activeMap.assetId ? presentation.encounter.tokens : [];
  return <section className="viewer-stage" aria-label={presentation.activeMap.altText || "Shared battlemap"}>
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={presentation.activeMap.altText || "Shared battlemap"}>
      <image href={href} width={size.width} height={size.height} onLoad={(event) => {
        const image = event.currentTarget as SVGImageElement;
        const source = image.href.baseVal;
        const probe = new Image(); probe.onload = () => setSize({ width: probe.naturalWidth, height: probe.naturalHeight }); probe.src = source;
      }} />
      {tokens.map((token) => <g className={`viewer-token ${token.kind}${token.active ? " active" : ""}`} key={token.actorId} transform={`translate(${token.position.x} ${token.position.y})`}>
        {token.active && <circle className="viewer-token-turn" r={token.sizePx * .62} />}
        <circle className="viewer-token-body" r={token.sizePx / 2} />
        <text className="viewer-token-initials">{initials(token.name)}</text>
        <text className="viewer-token-name" y={token.sizePx * .78}>{token.name}</text>
      </g>)}
      {measurementPoints && <polyline className="viewer-measurement" points={measurementPoints} />}
      {presentation.pings.map((ping) => <g className="viewer-ping" key={ping.id} transform={`translate(${ping.point.x} ${ping.point.y})`}>
        <circle r={Math.max(8, Math.min(size.width, size.height) / 40)} /><circle r={Math.max(3, Math.min(size.width, size.height) / 100)} />
      </g>)}
    </svg>
    {presentation.measurement && <output className="viewer-distance">{presentation.measurement.distanceLabel}</output>}
    {presentation.pings.filter((ping) => ping.label).map((ping) => <div className="viewer-ping-label" key={ping.id}>{ping.label}</div>)}
  </section>;
}

export function ViewerApp() {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [message, setMessage] = useState("");
  const sourceRef = useRef<EventSource | null>(null);

  const connect = async () => {
    setConnection("connecting"); setMessage(""); sourceRef.current?.close();
    try {
      const response = await fetch("/api/v1/viewer/presentation");
      if (response.status === 401) { setConnection("pairing"); return; }
      const body = await responseJson(response); setPresentation(body.presentation); setConnection("live");
      const source = new EventSource("/api/v1/viewer/events"); sourceRef.current = source;
      source.addEventListener("presentation", (event) => { setPresentation(JSON.parse((event as MessageEvent).data)); setConnection("live"); });
      source.onerror = async () => {
        setConnection("reconnecting");
        try {
          const check = await fetch("/api/v1/viewer/presentation");
          if (check.status === 401) { source.close(); setConnection("pairing"); }
        } catch { /* EventSource continues its bounded browser-managed reconnect loop. */ }
      };
    } catch (error) { setMessage((error as Error).message); setConnection("reconnecting"); }
  };

  useEffect(() => { void connect(); return () => sourceRef.current?.close(); }, []);
  if (connection === "pairing") return <Pairing onPaired={() => void connect()} />;
  if (!presentation) return <main className="viewer-waiting"><span className="viewer-eyebrow">SHARED TABLE VIEWER</span><h1>{connection === "reconnecting" ? "Reconnecting…" : "Connecting…"}</h1><p role="alert">{message}</p></main>;
  if (!presentation.enabled) return <main className="viewer-waiting"><span className="viewer-eyebrow">VIEWER CONNECTED</span><h1>Presentation paused</h1><p>The GM will begin when the table is ready.</p></main>;
  return <main className="viewer-shell">
    <button className="viewer-fullscreen" onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>Fullscreen</button>
    <div className={`viewer-connection ${connection}`} role="status">{connection === "live" ? "Live" : "Reconnecting"}</div>
    <MapStage presentation={presentation} />
    <Initiative presentation={presentation} />
  </main>;
}
