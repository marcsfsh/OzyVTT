import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import type { PlayerView, SessionJoinResult } from "@vtt/domain";
import "./styles.css";
import { RendererProof } from "./scene/RendererProof";

const socket = io({ autoConnect: false });
const PLAYER_TOKEN_KEY = "vtt.player-token";
async function api(path: string, init?: RequestInit) { const response = await fetch(path, { headers: { "content-type": "application/json", ...init?.headers }, ...init }); const body = await response.json(); if (!response.ok) throw new Error(body.message ?? "Request failed"); return body; }

function App() {
  const [mode, setMode] = useState<"home" | "player" | "gm">("home");
  const [state, setState] = useState<PlayerView | null>(null);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  useEffect(() => { api("/api/bootstrap/status").then(({ bootstrapped }) => setBootstrapped(bootstrapped)).catch((error) => setMessage(error.message)); socket.on("state:updated", setState); return () => { socket.off("state:updated", setState); }; }, []);
  const joinPlayer = () => { const token = localStorage.getItem(PLAYER_TOKEN_KEY) ?? undefined; socket.auth = { token }; socket.connect(); socket.emit("session:join", { token }, (result: SessionJoinResult) => { if (!result.ok) setMessage(result.message ?? "Could not join."); else { if (result.token) localStorage.setItem(PLAYER_TOKEN_KEY, result.token); setMode("player"); setMessage(""); } }); };
  const loginGm = async () => { try { const { token } = await api("/api/gm/login", { method: "POST", body: JSON.stringify({ password }) }); socket.auth = { token }; socket.connect(); socket.emit("session:join", { token }, (result: SessionJoinResult) => result.ok ? (setMode("gm"), setMessage("")) : setMessage(result.message ?? "Could not enter GM mode.")); } catch (error) { setMessage((error as Error).message); } };
  const bootstrap = async () => { try { await api("/api/bootstrap", { method: "POST", body: JSON.stringify({ password }) }); setBootstrapped(true); setMessage("GM password configured. Enter it to begin."); } catch (error) { setMessage((error as Error).message); } };
  return <main><header><span className="eyebrow">PRIVATE LAN VTT</span><h1>Table ready.</h1><p>Combat-first D&D 5e, hosted by your group.</p></header>{message && <p className="notice">{message}</p>}{mode === "home" && <><section className="choices"><button onClick={joinPlayer}><strong>Join as Player</strong><span>Choose your character and enter the table.</span></button><button className="secondary" onClick={() => setMode("gm")}><strong>Enter as GM</strong><span>Manage the table, encounter, and hidden information.</span></button></section><RendererProof /></>}{mode === "gm" && <section className="card"><h2>{bootstrapped ? "GM sign-in" : "First-run GM setup"}</h2><p>{bootstrapped ? "Enter the GM password." : "This must be completed locally on the host before players join."}</p><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="GM password" autoFocus /><button onClick={bootstrapped ? loginGm : bootstrap}>{bootstrapped ? "Enter table" : "Set GM password"}</button><button className="link" onClick={() => setMode("home")}>Back</button></section>}{mode !== "home" && state && <section className="table"><div><span className="eyebrow">{mode === "gm" ? "GM VIEW" : "PLAYER VIEW"}</span><h2>Combat canvas</h2><p>The real-time connection and role boundary are active. Actor import, encounter tools, and the battle canvas are next.</p></div><div className="empty"><strong>No encounter loaded</strong><span>{state.actors.length ? `${state.actors.length} visible actor(s) are ready.` : "GM will import characters and build the first encounter."}</span></div></section>}</main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
