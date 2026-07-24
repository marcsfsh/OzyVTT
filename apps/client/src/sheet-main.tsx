import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { GmActor, GmView, PlayerActor, PlayerView, SessionJoinResult } from "@vtt/domain";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { CharacterSheet } from "./encounter/CharacterSheet";
import { socket } from "./socket";
import "@vtt/ui/styles.css";
import "./styles.css";
import "./encounter/encounter-panel.css";

/** localStorage key the main app writes the player's session token to (shared across same-origin tabs). */
const PLAYER_TOKEN_KEY = "vtt.player-token";

/**
 * The character sheet in its own browser tab (feedback #9.3). A player opens it from the sheet's
 * "New tab" button; this entry rejoins the same table session with the persisted player token (the
 * server tolerates a second connection for the same session, like opening the app twice), then renders
 * the player's own actor standalone. GM tokens aren't persisted, so this tab is player-only by design.
 */
function StandaloneSheet() {
  const [state, setState] = useState<GmView | PlayerView | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "denied">("connecting");
  const joined = useRef(false);
  const actorId = new URLSearchParams(window.location.search).get("actor");

  useEffect(() => {
    // The state listener is symmetric (add on mount, remove on cleanup) so it survives StrictMode's
    // dev-only mount→cleanup→mount. connect + session:join must run ONCE, though - a second join would
    // double-count this session's presence connection (server presence.connect isn't deduped) and never
    // fully release. The ref guard persists across the StrictMode remount, so we join exactly once.
    const onState = (next: GmView | PlayerView) => setState(next);
    socket.on("state:updated", onState);
    if (!joined.current) {
      joined.current = true;
      const token = localStorage.getItem(PLAYER_TOKEN_KEY) ?? undefined;
      socket.auth = { token };
      socket.connect();
      socket.emit("session:join", { token }, (result: SessionJoinResult) => {
        if (result.ok && (result.role === "player" || result.role === "gm")) {
          if (result.token) localStorage.setItem(PLAYER_TOKEN_KEY, result.token);
          setStatus("ready");
        } else setStatus("denied");
      });
    }
    return () => { socket.off("state:updated", onState); };
  }, []);

  if (status === "denied") return <Message>Open your character sheet from the table first, then use <strong>New tab</strong>.</Message>;
  if (!actorId) return <Message>No character was specified for this tab.</Message>;
  if (!state) return <Message>Connecting to the table…</Message>;
  const actor = (state.actors as Array<GmActor | PlayerActor>).find((candidate) => candidate.id === actorId);
  if (!actor) return <Message>That character isn’t available to you. Claim it at the table, then reopen this tab.</Message>;
  return <CharacterSheet actor={actor} role="player" state={state} standalone onClose={() => window.close()} />;
}

function Message({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="sheet-standalone-msg"><p>{children}</p></div>;
}

createRoot(document.getElementById("sheet-root")!).render(<StrictMode><AppErrorBoundary><StandaloneSheet /></AppErrorBoundary></StrictMode>);
