import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import "./styles.css";
import { ActorRoster } from "./actors/ActorRoster";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DicePanel } from "./dice/DicePanel";
import { EncounterPanel } from "./encounter/EncounterPanel";
import { IntegrationsPanel } from "./integrations/IntegrationsPanel";
import { MapManager, type MapSelection } from "./maps/MapManager";
import { EncounterMap } from "./scene/EncounterMap";
import { RendererProof } from "./scene/RendererProof";
import { socket } from "./socket";
import { ViewerControls } from "./viewer/ViewerControls";

const PLAYER_TOKEN_KEY = "vtt.player-token";
async function api(path: string, init?: RequestInit) { const response = await fetch(path, { headers: { "content-type": "application/json", ...init?.headers }, ...init }); const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "Request failed"); return body; }

function App() {
  const [mode, setMode] = useState<"home" | "player" | "gm">("home");
  const [state, setState] = useState<PlayerView | GmView | null>(null);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [gmToken, setGmToken] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<MapSelection | null>(null);
  useEffect(() => { api("/api/bootstrap/status").then(({ bootstrapped }) => setBootstrapped(bootstrapped)).catch((error) => setMessage(error.message)); socket.on("state:updated", setState); return () => { socket.off("state:updated", setState); }; }, []);
  const joinPlayer = () => { const token = localStorage.getItem(PLAYER_TOKEN_KEY) ?? undefined; socket.auth = { token }; socket.connect(); socket.emit("session:join", { token }, (result: SessionJoinResult) => { if (!result.ok) setMessage(result.message ?? "Could not join."); else { if (result.token) localStorage.setItem(PLAYER_TOKEN_KEY, result.token); setMode("player"); setMessage(""); } }); };
  const loginGm = async () => { try { const { token } = await api("/api/gm/login", { method: "POST", body: JSON.stringify({ password }) }); setGmToken(token); socket.auth = { token }; socket.connect(); socket.emit("session:join", { token }, (result: SessionJoinResult) => result.ok ? (setMode("gm"), setMessage("")) : setMessage(result.message ?? "Could not enter GM mode.")); } catch (error) { setMessage((error as Error).message); } };
  const bootstrap = async () => { try { await api("/api/bootstrap", { method: "POST", body: JSON.stringify({ password }) }); setBootstrapped(true); setMessage("GM password configured. Enter it to begin."); } catch (error) { setMessage((error as Error).message); } };
  const leaveGmSession = (notice: string) => { socket.disconnect(); setGmToken(null); setSelectedMap(null); setPassword(""); setMode("home"); setState(null); setMessage(notice); };
  const signOutGm = async () => { const token = gmToken; try { if (token) await api("/api/gm/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }); } catch (error) { setMessage((error as Error).message); return; } leaveGmSession("Signed out."); };
  const revokeAllGmSessions = async () => { const token = gmToken; if (!token) return; if (!window.confirm("Revoke every GM session, including this one? Every signed-in GM browser will need to sign in again.")) return; try { await api("/api/gm/sessions/revoke-all", { method: "POST", headers: { authorization: `Bearer ${token}` } }); } catch (error) { setMessage((error as Error).message); return; } leaveGmSession("All GM sessions revoked. Sign in again to continue."); };
  const mapToken = mode === "gm" ? gmToken : localStorage.getItem(PLAYER_TOKEN_KEY);
  return <main><header><span className="eyebrow">PRIVATE LAN VTT</span><h1>Table ready.</h1><p>Combat-first D&D 5e, hosted by your group.</p></header>{message && <p className="notice">{message}</p>}{mode === "home" && <><section className="choices"><button onClick={joinPlayer}><strong>Join as Player</strong><span>Choose your character and enter the table.</span></button><button className="secondary" onClick={() => setMode("gm")}><strong>Enter as GM</strong><span>Manage the table, encounter, and hidden information.</span></button></section><RendererProof /></>}{mode === "gm" && <section className="card"><h2>{bootstrapped ? "GM sign-in" : "First-run GM setup"}</h2><p>{bootstrapped ? "Enter the GM password." : "This must be completed locally on the host before players join."}</p><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="GM password" autoFocus /><button onClick={bootstrapped ? loginGm : bootstrap}>{bootstrapped ? "Enter table" : "Set GM password"}</button><button className="link" onClick={() => setMode("home")}>Back</button></section>}{mode !== "home" && state && <><ActorRoster {...(mode === "gm" ? { role: "gm" as const, state: state as GmView } : { role: "player" as const, state: state as PlayerView })} /><section className="table"><div><span className="eyebrow">{mode === "gm" ? "GM VIEW" : "PLAYER VIEW"}</span><h2>Combat canvas</h2><p>{state.combat.active ? `Encounter active · Round ${state.combat.round}` : "The real-time connection and role boundary are active. Start an encounter below."}</p></div>{state.combat.active && state.combat.mapAssetId ? <EncounterMap assetId={state.combat.mapAssetId} token={mapToken} altText={selectedMap?.id === state.combat.mapAssetId ? selectedMap.name : "Active encounter battlemap"} /> : <div className="empty"><strong>No encounter loaded</strong><span>{state.actors.length ? `${state.actors.length} visible actor(s) are ready.` : "GM will import characters and build the first encounter."}</span></div>}</section>{mode === "gm" && gmToken && <MapManager gmToken={gmToken} preferredMapId={(state as GmView).combat.mapAssetId} onSelectionChange={setSelectedMap} />}<EncounterPanel {...(mode === "gm" ? { role: "gm" as const, state: state as GmView, selectedMap } : { role: "player" as const, state: state as PlayerView })} />{mode === "gm" && gmToken && <ViewerControls gmToken={gmToken} {...(selectedMap ? { map: { assetId: selectedMap.id, width: selectedMap.width, height: selectedMap.height, altText: selectedMap.name, calibration: selectedMap.calibration, scale: selectedMap.scale, ...(selectedMap.previewUrl ? { previewUrl: selectedMap.previewUrl } : {}) } } : {})} />}{mode === "gm" && <section className="gm-session-controls"><button className="secondary" onClick={signOutGm}>Sign out</button><button className="danger" onClick={revokeAllGmSessions}>Revoke all GM sessions</button></section>}{mode === "gm" && gmToken && <IntegrationsPanel gmToken={gmToken} />}<DicePanel role={mode} state={state} /></>}</main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>);
