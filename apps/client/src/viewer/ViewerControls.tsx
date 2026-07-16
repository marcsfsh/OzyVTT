import { useEffect, useState } from "react";
import "./viewer-controls.css";

type ViewerMetadata = Readonly<{ id: string; name: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null }>;
type ViewerConnection = Readonly<{ connectionId: string; viewerId: string; name: string; connectedAt: string }>;
type PresentationSummary = Readonly<{ revision: number; enabled: boolean; activeMap: Readonly<{ assetId: string }> | null }>;

type ViewerControlsProps = Readonly<{
  gmToken: string;
  map?: Readonly<{ assetId: string; width: number; height: number; altText: string }>;
}>;

async function api(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Viewer request failed.");
  return body;
}

export function ViewerControls({ gmToken, map }: ViewerControlsProps) {
  const [presentation, setPresentation] = useState<PresentationSummary | null>(null);
  const [viewers, setViewers] = useState<readonly ViewerMetadata[]>([]);
  const [connections, setConnections] = useState<readonly ViewerConnection[]>([]);
  const [pairing, setPairing] = useState<Readonly<{ code: string; expiresAt: string }> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const [state, access] = await Promise.all([
      api("/api/v1/viewer/presentation", gmToken),
      api("/api/v1/viewer/access", gmToken)
    ]);
    setPresentation(state.presentation); setViewers(access.viewers); setConnections(access.connections);
  };
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, [gmToken]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await operation(); await refresh(); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const command = async (payload: Record<string, unknown>) => {
    if (!presentation) throw new Error("Viewer presentation state is still loading.");
    await api("/api/v1/viewer/presentation/commands", gmToken, { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), expectedRevision: presentation.revision, payload }) });
  };
  const connectedIds = new Set(connections.map((connection) => connection.viewerId));

  return <section className="viewer-controls" aria-labelledby="viewer-controls-title">
    <div className="viewer-controls-heading"><div><span>SHARED DISPLAY</span><h2 id="viewer-controls-title">Table viewer</h2></div><strong className={connections.length ? "online" : ""}>{connections.length} connected</strong></div>
    <p>Only explicitly presented, player-safe information appears on paired televisions and projectors.</p>
    <div className="viewer-control-actions">
      <button disabled={busy} onClick={() => window.open("/viewer.html", "vtt-table-viewer")}>Open viewer</button>
      <button disabled={busy} onClick={() => void run(async () => { const body = await api("/api/v1/viewer/pairings", gmToken, { method: "POST", body: "{}" }); setPairing(body.pairing); })}>Create pairing code</button>
      <button disabled={busy || !presentation} onClick={() => void run(() => command({ type: "viewer.enabled.set", enabled: !presentation?.enabled }))}>{presentation?.enabled ? "Pause presentation" : "Begin presentation"}</button>
      <button disabled={busy || !presentation || !map} onClick={() => void run(() => command({ type: "viewer.map.set", assetId: map!.assetId, altText: map!.altText, camera: { center: { x: map!.width / 2, y: map!.height / 2 }, zoom: 1 } }))}>Show current map</button>
    </div>
    {pairing && <div className="viewer-pairing-code" role="status"><span>PAIRING CODE</span><strong>{pairing.code}</strong><small>Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</small><button onClick={() => void navigator.clipboard.writeText(pairing.code)}>Copy code</button></div>}
    {message && <p className="viewer-control-feedback" role="alert">{message}</p>}
    {viewers.length > 0 && <div className="viewer-access-list"><h3>Paired displays</h3><ul>{viewers.map((viewer) => <li key={viewer.id}>
      <div><strong>{viewer.name}</strong><span>{viewer.revokedAt ? "Revoked" : connectedIds.has(viewer.id) ? "Connected" : "Offline"}</span></div>
      {!viewer.revokedAt && <button disabled={busy} onClick={() => { if (window.confirm(`Revoke ${viewer.name}?`)) void run(async () => { await api(`/api/v1/viewer/access/${viewer.id}`, gmToken, { method: "DELETE" }); }); }}>Revoke</button>}
    </li>)}</ul></div>}
  </section>;
}
