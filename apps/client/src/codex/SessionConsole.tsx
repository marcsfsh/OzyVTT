import { Alert, Badge, Button, Drawer, GmOnlyTag, Skeleton, VisibilityBadge } from "@vtt/ui";
import { CodexMarkdown } from "./CodexMarkdown";
import { sessionTitle } from "./sessions";
import type { CodexSession } from "@vtt/domain";

/**
 * The session console: tonight's prep, readable from any Codex section. A view only: it fetches and writes
 * nothing, rendering the record Sessions edits. Uses the non-modal `Drawer` so the GM can keep working
 * behind it.
 */
export function SessionConsole({
  open,
  onClose,
  gmToken,
  session,
  loading,
  error,
  onOpenSession,
  onOpenSessions
}: Readonly<{
  open: boolean;
  onClose: () => void;
  gmToken: string;
  /** The active session, or null when the GM has not pointed the table at one. */
  session: CodexSession | null;
  /** The feed is still loading, so "no active session" can't be claimed yet. */
  loading: boolean;
  /** The feed's own failure, shown rather than a blank console. */
  error: string | null;
  /** Opens Sessions on this session. */
  onOpenSession: (sessionId: string) => void;
  /** Reaching Sessions with nothing selected, for the no-active-session empty state. */
  onOpenSessions: () => void;
}>) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      ariaLabel="Session prep"
      title={session ? sessionTitle(session) : "Session prep"}
      className="codex-prepdrawer"
    >
      {/* Gated on `open`: the drawer stays mounted while closed, and an unopened console must not announce a failure. */}
      {open && error && (
        <Alert tone="danger" title="Couldn't load the session">
          {error}
        </Alert>
      )}
      {loading && !session && !error && (
        <div className="codex-list-loading">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} variant="text" />
          ))}
        </div>
      )}

      {!loading && !error && !session && (
        <div className="codex-console-empty">
          <p>
            No session is active. Make one active in Sessions and its prep appears here from every part of the Codex.
            New journal entries and logged battles are filed under the active session.
          </p>
          <Button variant="primary" size="sm" onClick={onOpenSessions}>
            Open Sessions
          </Button>
        </div>
      )}

      {session && (
        <div className="codex-console">
          <div className="codex-console-meta">
            <Badge tone="success">
              <span className="codex-dot" aria-hidden="true" /> Active
            </Badge>
            <Badge tone={session.status === "played" ? "neutral" : "info"}>
              {session.status === "played" ? "Played" : "Planned"}
            </Badge>
            {session.realDate && <span className="codex-entry-when">{session.realDate}</span>}
            {/* The shared visibility badge, worded like every other list. */}
            <VisibilityBadge revealed={session.revealedToPlayers} />
          </div>
          {session.attendees.length > 0 && (
            <p className="codex-console-attendees">Playing: {session.attendees.join(", ")}</p>
          )}

          {/* Likely open while screen-sharing, so the prep wears the GM-only marking. */}
          <div className="codex-console-prep codex-gm-block">
            <GmOnlyTag />
            {session.prepBody.trim() ? (
              <CodexMarkdown text={session.prepBody} token={gmToken} />
            ) : (
              <p className="codex-preview-empty">Nothing prepped for this session yet.</p>
            )}
          </div>

          {/* The console shows; Sessions edits. */}
          <Button variant="secondary" size="sm" onClick={() => onOpenSession(session.id)}>
            Open this session
          </Button>
        </div>
      )}
    </Drawer>
  );
}
