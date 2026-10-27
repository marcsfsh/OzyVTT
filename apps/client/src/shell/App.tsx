import { useEffect, useRef } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { RollCallPrompts } from "../encounter/RollCallPrompt";
import {
  currentHref,
  navigate,
  redirectForRetiredPath,
  rememberLocation,
  resumeTarget,
  useRoute,
  type Route
} from "../router";
import { useRecapBadge } from "../codex/useRecapBadge";
import { TableEventToasts } from "../scene/toasts";
import { GmBottomTabs, GmTopBar, PlayerBottomTabs, PlayerTopBar, usePhoneShell } from "./AppBar";
import { GmShell } from "./GmShell";
import { Landing, useEntryAnimation } from "./Landing";
import { onPlayerTable, PlayerShell } from "./PlayerShell";
import { ReconnectBar } from "./ReconnectBar";
import { TableCurrent } from "./table-current";
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
 * path). A player who deep-linked a GM-only address gets the not-found view, with no redirect that would
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
 * The frame: <main> is a 100dvh grid with rows [top bar][reconnecting bar][content pane][bottom tabs], and the page
 * never scrolls. Every in-flow child has an explicit grid row (styles.css); overlays and dialogs take none. A phone
 * puts the sections in the bottom tabs and keeps the top bar for the utilities.
 */
export function App() {
  const route = useRoute();
  const entry = useEntryAnimation();
  const session = useSession(entry.begin);
  const { signedIn, state, connection } = session;
  /** Keyboard safety is shell plumbing: installed once, for every region on every surface. */
  useEffect(() => installKeyboardFocusHelper(), []);
  useAddressMemory(signedIn?.role ?? null, route);
  /** The signed-in shell. It mounts during the entry drive, behind the opaque curtain. */
  const shell = signedIn && state ? { ...signedIn, state } : null;
  const phone = usePhoneShell();
  // "A recap you haven't read", for the player's Codex tab in both bars.
  const recap = useRecapBadge(shell?.role === "player" ? shell.token : null);

  return (
    <main className={entry.phase === "settle" ? "anim-cascade" : undefined}>
      {signedIn && <TableEventToasts />}
      {/* Row 1: the top bar. It stays up while a full-page layer is open. */}
      {shell?.role === "gm" && <GmTopBar state={shell.state as GmView} token={shell.token} />}
      {shell?.role === "player" && (
        <PlayerTopBar state={shell.state as PlayerView} codexUnread={recap.unread} onCodexSeen={recap.markSeen} />
      )}
      {/* Row 2: the reconnecting bar. A real frame row, so it never paints over a surface. */}
      {signedIn && <ReconnectBar current={session.current} />}
      {/* Row 3: the pane. Each surface is its one child, a `.frame-col` with chrome rows above a
        `.scroll-y` region; the pane gives out the height and the surface divides it. */}
      <TableCurrent.Provider value={session.current}>
        <div className="app-pane">
          {/* The GM's calls for a roll follow the player to every page as a row that pushes the page down; on the
          table they wait in its prompt slot instead. */}
          {shell?.role === "player" && entry.phase !== "drive" && !onPlayerTable(route) && (
            <RollCallPrompts state={shell.state as PlayerView} />
          )}
          {(!signedIn || entry.phase === "drive") && (
            <Landing
              driving={entry.phase === "drive"}
              bootstrapped={session.bootstrapped}
              busy={session.busy}
              resuming={session.resuming}
              gmPrompt={session.gmPrompt}
              notice={session.notice}
              onJoin={session.joinPlayer}
              onSignIn={(password, keep) => void session.signInGm(password, keep)}
              onSetPassword={(password) => void session.setGmPassword(password)}
              onClearNotice={session.clearNotice}
            />
          )}
          {shell?.role === "gm" && (
            <GmShell
              state={shell.state as GmView}
              token={shell.token}
              connection={connection}
              busy={session.busy}
              onSignOut={() => void session.signOutGm()}
              onRevokeAll={() => void session.revokeAllGmSessions()}
              onChangePassword={session.changeGmPassword}
            />
          )}
          {shell?.role === "player" && (
            <PlayerShell
              state={shell.state as PlayerView}
              token={shell.token}
              connection={connection}
              onLeave={session.leavePlayer}
            />
          )}
        </div>
      </TableCurrent.Provider>
      {/* Row 4: a phone's bottom tabs, the sections under the thumb. */}
      {shell?.role === "gm" && phone && <GmBottomTabs />}
      {shell?.role === "player" && phone && (
        <PlayerBottomTabs codexUnread={recap.unread} onCodexSeen={recap.markSeen} />
      )}
    </main>
  );
}
