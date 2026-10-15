import { useEffect, useRef, useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { CombatLogDrawer } from "../encounter/CombatLog";
import {
  currentHref,
  navigate,
  redirectForRetiredPath,
  rememberLocation,
  resumeTarget,
  useRoute,
  type Route
} from "../router";
import { TableEventToasts } from "../scene/toasts";
import { GmShell, GmTabBar } from "./GmShell";
import { Landing, useEntryAnimation } from "./Landing";
import { PlayerShell, PlayerTabBar } from "./PlayerShell";
import { useSession } from "./useSession";

/**
 * Keyboard safety under the locked shell: the body cannot scroll, so a focused text field is
 * scrolled into view within its own scrolling region (scrollIntoView stops at the first ancestor
 * that can help). Done twice: immediately, and again after the on-screen keyboard has resized the
 * viewport. The regions' scroll-padding keeps the landing spot clear of sticky chrome.
 */
const FOCUS_NUDGE_TARGETS = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
function installKeyboardFocusHelper(): () => void {
  const nudge = (field: HTMLElement) => field.scrollIntoView({ block: "nearest" });
  const onFocusIn = (event: FocusEvent) => {
    const field = event.target;
    if (!(field instanceof HTMLElement) || !field.matches(FOCUS_NUDGE_TARGETS)) return;
    nudge(field);
    window.setTimeout(() => {
      if (document.activeElement === field) nudge(field);
    }, 300);
  };
  document.addEventListener("focusin", onFocusIn);
  return () => document.removeEventListener("focusin", onFocusIn);
}

/**
 * The app reopens where you left it: every signed-in address is remembered, and a fresh sign-in
 * without a deep link resumes there. A deep link always wins (the sign-in renders at the requested
 * path). A player who deep-linked a GM-only address gets the not-found view, not a redirect that would
 * confirm the address means something; only the resume default is rewritten. Old addresses redirect
 * to their new homes (`/encounter` → `/table`, `/setup` → `/settings`, `/scenes?view=maps` →
 * `/scenes/maps`) so bookmarks land; `replace` keeps Back honest.
 */
function useAddressMemory(role: "gm" | "player" | null, route: Route) {
  const resumedFor = useRef<"gm" | "player" | null>(null);
  useEffect(() => {
    if (resumedFor.current === role) return;
    resumedFor.current = role;
    if (!role) return;
    const target = resumeTarget(role, route.path);
    if (target) navigate(target, { replace: true });
  }, [role, route.path]);
  useEffect(() => {
    if (role) rememberLocation(role, currentHref());
  }, [role, route.path, route.query]);
  useEffect(() => {
    if (!role) return;
    const target = redirectForRetiredPath(route.path, route.query);
    if (target) navigate(target, { replace: true });
  }, [role, route.path, route.query]);
}

/**
 * The frame: <main> is a 100dvh grid with rows [connection strip][tab bar][content pane], and the
 * page never scrolls. Every in-flow child has an explicit grid row (styles.css); overlays, dialogs and
 * the texture take none.
 */
export function App() {
  const route = useRoute();
  const entry = useEntryAnimation();
  const table = useSession(entry.begin);
  const { session, state, connection } = table;
  /**
   * The combat log drawer's state lives here because its door is in two places (the dock, and the
   * docked-into-the-map arm with no dock), and the drawer itself sits outside the pane.
   */
  const [logOpen, setLogOpen] = useState(false);
  /** Keyboard safety is shell plumbing: installed once, for every region on every surface. */
  useEffect(() => installKeyboardFocusHelper(), []);
  useAddressMemory(session?.role ?? null, route);
  /** The signed-in shell. It mounts during the entry drive, behind the opaque curtain. */
  const shell = session && state ? { ...session, state } : null;
  const openLog = () => setLogOpen(true);

  return (
    <main className={entry.phase === "settle" ? "anim-cascade" : undefined}>
      <div className="app-texture" aria-hidden="true" />
      {session && <TableEventToasts />}
      {/* Row 1: the connection strip. A real frame row, so it never paints over a surface and nothing
        covers it, full-page layers included. */}
      {session && connection !== "online" && (
        <p className="connection-banner" role="status">
          {connection === "reconnecting" ? "Reconnecting to the table…" : "Connection lost. Trying to reconnect…"}
        </p>
      )}
      {/* Row 2: the tab bar. It stays up while a full-page layer is open. */}
      {shell?.role === "gm" && <GmTabBar />}
      {shell?.role === "player" && <PlayerTabBar token={shell.token} />}
      {/* Row 3: the pane. Each surface is its one child, a `.frame-col` with chrome rows above a
        `.scroll-y` region; the pane gives out the height and the surface divides it. */}
      <div className="app-pane">
        {(!session || entry.phase === "drive") && (
          <Landing
            driving={entry.phase === "drive"}
            bootstrapped={table.bootstrapped}
            busy={table.busy}
            notice={table.notice}
            onJoin={table.joinPlayer}
            onSignIn={(password) => void table.signInGm(password)}
            onSetPassword={(password) => void table.setGmPassword(password)}
            onClearNotice={table.clearNotice}
          />
        )}
        {shell?.role === "gm" && (
          <GmShell
            state={shell.state as GmView}
            token={shell.token}
            connection={connection}
            busy={table.busy}
            onOpenLog={openLog}
            onSignOut={() => void table.signOutGm()}
            onRevokeAll={() => void table.revokeAllGmSessions()}
          />
        )}
        {shell?.role === "player" && (
          <PlayerShell
            state={shell.state as PlayerView}
            token={shell.token}
            connection={connection}
            onOpenLog={openLog}
            onLeave={table.leavePlayer}
          />
        )}
      </div>
      {/* The combat log drawer lives outside the pane because it is `position: fixed` and the pane is
        where transforms happen. Non-modal, so the table stays live behind it. */}
      {shell && <CombatLogDrawer open={logOpen} onClose={() => setLogOpen(false)} />}
    </main>
  );
}
