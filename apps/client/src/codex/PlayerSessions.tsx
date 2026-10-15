import { useMemo } from "react";
import { Button, IconChevron, Input, Skeleton } from "@vtt/ui";
import type { PlayerCodexSession } from "@vtt/domain";
import { CodexMarkdown } from "./CodexMarkdown";
import { sessionTitle } from "./sessions";
import { TagChip } from "./TagChip";

/** Revealed sessions, recaps rendered as markdown. */
export function PlayerSessions({
  sessions,
  loading,
  openId,
  token,
  onOpen,
  onNavigate,
  knownTitles,
  onPickTag,
  filter,
  onFilterChange
}: Readonly<{
  sessions: readonly PlayerCodexSession[];
  loading: boolean;
  openId: string | null;
  token: string;
  onOpen: (id: string | null) => void;
  onNavigate: (target: string) => void;
  knownTitles: ReadonlySet<string>;
  onPickTag: (tag: string) => void;
  /** The GM's Sessions filter, over the fields a player gets. */
  filter: string;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
}>) {
  const open = openId ? (sessions.find((session) => session.id === openId) ?? null) : null;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter(
      (session) =>
        sessionTitle(session).toLowerCase().includes(needle) ||
        (session.realDate ?? "").toLowerCase().includes(needle) ||
        session.tags.some((tag) => tag.includes(needle)) ||
        session.recap.toLowerCase().includes(needle)
    );
  }, [sessions, filter]);
  return (
    <div className={`codex-workspace${open ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input
            value={filter}
            placeholder="Filter sessions"
            aria-label="Filter sessions"
            onChange={(event) => onFilterChange({ q: event.target.value || null })}
          />
        </div>
        <nav className="codex-list scroll-y" aria-label="Sessions">
          {loading && sessions.length === 0 && (
            <div className="codex-list-loading">
              {[0, 1].map((row) => (
                <Skeleton key={row} variant="text" />
              ))}
            </div>
          )}
          {!loading && sessions.length === 0 && <p className="codex-list-empty">No recaps shared yet.</p>}
          {!loading && sessions.length > 0 && shown.length === 0 && (
            <p className="codex-list-empty">No sessions match.</p>
          )}
          {shown.map((session) => (
            <button
              key={session.id}
              type="button"
              aria-current={session.id === open?.id ? "true" : undefined}
              className={`codex-session-row${session.id === open?.id ? " is-active" : ""}`}
              onClick={() => onOpen(session.id)}
            >
              <span className="codex-list-title">{sessionTitle(session)}</span>
              {session.realDate && <span className="codex-campaign-recentwhen">{session.realDate}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <section className="codex-main scroll-y">
        {open && (
          <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpen(null)}>
            <IconChevron className="codex-chevron-left" aria-hidden="true" />
            All sessions
          </Button>
        )}
        {open ? (
          <article className="codex-reader">
            <h2 className="codex-reader-title">{sessionTitle(open)}</h2>
            {open.realDate && (
              <div className="codex-entry-meta">
                <span className="codex-entry-when">{open.realDate}</span>
              </div>
            )}
            {open.tags.length > 0 && (
              <div className="codex-entry-meta">
                {open.tags.map((tag) => (
                  <TagChip key={tag} tag={tag} onPick={onPickTag} />
                ))}
              </div>
            )}
            <div className="codex-reader-body">
              {open.recap.trim() ? (
                <CodexMarkdown text={open.recap} onNavigate={onNavigate} token={token} knownTitles={knownTitles} />
              ) : (
                <p className="codex-preview-empty">No recap written yet.</p>
              )}
            </div>
          </article>
        ) : (
          <div className="codex-main-empty">
            <h3>No session selected</h3>
            <p>Session recaps your GM has shown to players appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
