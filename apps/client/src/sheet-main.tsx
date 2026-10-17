import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { GmActor, GmView, PlayerActor, PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";
// The global styles load before any component's own stylesheet, as in main.tsx: CSS lands in import order.
import "@vtt/ui/styles.css";
import "./styles.css";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { CharacterSheet } from "./sheet/CharacterSheet";
import { joinTable, storedPlayerToken } from "./lib/session";
import { socket } from "./socket";
import "./encounter/encounter-panel.css";

/**
 * The character sheet in its own browser tab, opened from the sheet's "New tab" button. It rejoins
 * the table session with the stored player token (the server allows a second connection per
 * session) and renders the player's own actor. GM tokens are not persisted, so this is player-only.
 */
function StandaloneSheet() {
  const [state, setState] = useState<GmView | PlayerView | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "denied">("connecting");
  const joined = useRef(false);
  const actorId = new URLSearchParams(window.location.search).get("actor");

  useEffect(() => {
    // The state listener is symmetric, so it survives StrictMode's mount→cleanup→mount. connect +
    // session:join must run once: a second join would double-count presence (not deduped server-side).
    // The ref guard persists across the remount.
    const onState = (next: GmView | PlayerView) => setState(next);
    socket.on("state:updated", onState);
    if (!joined.current) {
      joined.current = true;
      void joinTable(storedPlayerToken()).then((result) =>
        setStatus(result.ok && (result.role === "player" || result.role === "gm") ? "ready" : "denied")
      );
    }
    return () => {
      socket.off("state:updated", onState);
    };
  }, []);

  if (status === "denied")
    return (
      <Message>
        Open your character sheet from the table first, then choose <strong>Open in a new tab</strong> in its menu.
      </Message>
    );
  if (!actorId) return <Message>No character was specified for this tab.</Message>;
  if (!state) return <Message>Connecting to the table…</Message>;
  const actor = (state.actors as Array<GmActor | PlayerActor>).find((candidate) => candidate.id === actorId);
  if (!actor)
    return <Message>That character isn't available to you. Claim it at the table, then reopen this tab.</Message>;
  return (
    <div className="cs-standalone">
      <CharacterSheet actor={actor} role="player" state={state} presentation="page" onClose={() => window.close()} />
    </div>
  );
}

function Message({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="cs-standalone-msg">
      <p>{children}</p>
    </div>
  );
}

createRoot(document.getElementById("sheet-root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ToastProvider>
        <StandaloneSheet />
      </ToastProvider>
    </AppErrorBoundary>
  </StrictMode>
);
