import { Alert, Badge, Button, Drawer, Skeleton } from "@vtt/ui";
import { CodexMarkdown } from "./CodexMarkdown";
import { GmOnlyTag } from "./SecretMarkers";
import { sessionTitle } from "./sessions";
import type { CodexSession } from "./api";

/**
 * M9: the session console — tonight's prep, readable from ANY Codex mode.
 *
 * The problem it solves is a running-the-game problem: prep is written in Sessions, but it is
 * *needed* while the GM is in the Atlas dropping a pin or in Pages reading an NPC. Before this, consulting
 * it meant leaving whatever surface the game was actually happening on.
 *
 * **It is a view, and that is a hard property, not a description.** It fetches nothing and writes
 * nothing: the session it renders is the very record Sessions is editing, handed down from the
 * workspace's single feed, and every action here is either "close" or "go where editing happens". A
 * console that wrote would be a second editor for one record, on screen at the same time as the first.
 *
 * It rides `@vtt/ui`'s `Drawer` (R9) precisely because that primitive is NON-modal — no top layer, no
 * focus trap, no scroll lock, no swallowing of Escape. A panel you consult *while you keep working*
 * cannot make the thing you are working on unreachable; `Modal` would.
 */
export function SessionConsole({ open, onClose, gmToken, session, loading, error, onOpenSession, onOpenSessions }: Readonly<{
  open: boolean;
  onClose: () => void;
  gmToken: string;
  /** The active session, or null when the GM has not pointed the table at one. */
  session: CodexSession | null;
  /** CF-2: the workspace's session feed is still in flight, so "no active session" cannot yet be claimed. */
  loading: boolean;
  /** R4: the feed's own failure, surfaced here rather than rendering as a blank console. */
  error: string | null;
  /** R1: the jump prepares its destination — Sessions opens ON this session. */
  onOpenSession: (sessionId: string) => void;
  /** Reaching Sessions with nothing selected, for the no-active-session empty state. */
  onOpenSessions: () => void;
}>) {
  return (
    <Drawer open={open} onClose={onClose} ariaLabel="Session prep" title={session ? sessionTitle(session) : "Session prep"} className="codex-prepdrawer">
      {/* R4: the feed's failure is visible HERE, and gated on `open` — the drawer stays mounted while
          closed so its slide plays both ways, and an `Alert` is an announcement (`role="alert"`). A
          console nobody has opened must not announce a failure over the mode the GM is actually using;
          it says so the moment they open it, which is when this surface is a surface at all. */}
      {open && error && <Alert tone="danger" title="Couldn't load the session">{error}</Alert>}
      {loading && !session && !error && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}

      {!loading && !error && !session && (
        <div className="codex-console-empty">
          <p>No session is active. Make one active in Sessions and its prep appears here from every part of the Codex — and new journal entries and logged battles file themselves under it.</p>
          {/* §4: `Button` is a `@vtt/ui` primitive and carries the 44px floor itself — no new control. */}
          <Button variant="primary" size="sm" onClick={onOpenSessions}>Open Sessions</Button>
        </div>
      )}

      {session && (
        <div className="codex-console">
          <div className="codex-console-meta">
            <Badge tone="success">● Active</Badge>
            <Badge tone={session.status === "played" ? "neutral" : "info"}>{session.status === "played" ? "Played" : "Planned"}</Badge>
            {session.realDate && <span className="codex-entry-when">{session.realDate}</span>}
            {session.revealedToPlayers ? <Badge tone="info">Recap shown to players</Badge> : <Badge>Recap hidden from players</Badge>}
          </div>
          {session.attendees.length > 0 && <p className="codex-console-attendees">Playing: {session.attendees.join(", ")}</p>}

          {/* R5: the violet block plus the "GM only" pill, the same pair every other GM-secret body in
              the Codex wears. This panel is the one most likely to be open while a screen is shared. */}
          <div className="codex-console-prep codex-gm-block">
            <GmOnlyTag />
            {session.prepBody.trim()
              ? <CodexMarkdown text={session.prepBody} token={gmToken} />
              : <p className="codex-preview-empty">Nothing prepped for this session yet.</p>}
          </div>

          {/* The console shows; the log edits. One record, one place to change it. */}
          <Button variant="secondary" size="sm" onClick={() => onOpenSession(session.id)}>Open this session</Button>
        </div>
      )}
    </Drawer>
  );
}
