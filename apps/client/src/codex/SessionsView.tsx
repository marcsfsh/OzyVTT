import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Field, GmOnlyTag, IconChevron, IconPlus, Input, Panel, RevealSwitch, SaveState, Select, Skeleton, TagInput, VisibilityBadge } from "@vtt/ui";
import { sessionApi, type CodexAutosaveSettings, type CodexPageSummary, type CodexSession, type CodexSessionStatus } from "./api";
import { pickNextSession, sessionTitle } from "./sessions";
import { createSession } from "./creates";
import { CodexEditor } from "./CodexEditor";
import { TagChip } from "./TagChip";
import { archivedOptionLabel, charactersFor, type ArchivableActor } from "./characters";
import { useCodexAutosave } from "./autosave";
import { useConfirm } from "../components/feedback";

/**
 * The session log at `/codex/sessions[/:id]`, the one place a session is edited. It owns no feed: the
 * shell's single session list is handed down here, to Home, the journal lens and the console drawer.
 */
type SessionsViewProps = Readonly<{
  gmToken: string;
  sessions: readonly CodexSession[];
  activeSessionId: string | null;
  /** The feed is still loading, so an empty list isn't "no sessions" yet. */
  loading: boolean;
  /** The feed's own failure, so it doesn't render as an empty log. */
  error: string | null;
  /** The open session comes from the address (`/codex/sessions/:id`). */
  openSessionId?: string | null;
  /** Filters live in the address too (`?q=`, `?status=`). */
  filter?: string;
  statusFilter?: string | null;
  onFilterChange?: (next: Readonly<Record<string, string | null>>) => void;
  /** Navigate. `null` goes back to the list. */
  onOpenSession: (sessionId: string | null) => void;
  onChanged: () => void | Promise<void>;
  autosave: CodexAutosaveSettings;
  /** For `[[` autocomplete: the shell's page feed. */
  pages: readonly CodexPageSummary[];
  /** The table's roster, used only to tell whether a character is archived (see `characters.ts`). */
  actors?: readonly ArchivableActor[];
  onPickTag?: (tag: string) => void;
}>;

export function SessionsView({ gmToken, sessions, activeSessionId, loading, error, openSessionId = null, onOpenSession, onChanged, autosave, pages, actors = [], onPickTag, filter = "", statusFilter = null, onFilterChange }: SessionsViewProps) {
  const [listError, setListError] = useState<string | null>(null);

  const selected = openSessionId ? sessions.find((session) => session.id === openSessionId) ?? null : null;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return sessions.filter((session) =>
      (!statusFilter || session.status === statusFilter)
      && (!needle || sessionTitle(session).toLowerCase().includes(needle)
        || (session.realDate ?? "").toLowerCase().includes(needle)
        || session.tags.some((tag) => tag.includes(needle))
        || session.recapBody.toLowerCase().includes(needle)));
  }, [sessions, filter, statusFilter]);

  const create = async () => {
    setListError(null);
    // The same create (and number suggestion) the palette's "New session" runs.
    try {
      const session = await createSession(gmToken, sessions);
      await onChanged();
      onOpenSession(session.id);
    } catch (createError) { setListError(createError instanceof Error ? createError.message : "Couldn't create the session."); }
  };

  return (
    <>
      <div className={`codex-workspace${selected ? " has-selection" : ""}`}>
        <aside className="codex-rail">
          <div className="codex-rail-head">
            <Input value={filter} placeholder="Filter sessions" aria-label="Filter sessions" onChange={(event) => onFilterChange?.({ q: event.target.value || null })} />
{/* One primary per view: the rail's create steps down when the editor's Save (autosave off) is primary. */}
            <Button variant={selected && !autosave.enabled ? "secondary" : "primary"} size="sm" onClick={create}><IconPlus /> New</Button>
          </div>
          <div className="codex-rail-tools">
            <Select aria-label="Filter by status" value={statusFilter ?? ""} onChange={(event) => onFilterChange?.({ status: event.target.value || null })}>
              <option value="">All sessions</option>
              <option value="planned">Planned</option>
              <option value="played">Played</option>
            </Select>
          </div>
          {listError && <Alert tone="danger">{listError}</Alert>}
          <nav className="codex-list scroll-y" aria-label="Sessions">
            {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
            {!loading && sessions.length === 0 && !error && <p className="codex-list-empty">No sessions yet. Create one to prep the next session.</p>}
            {!loading && sessions.length > 0 && shown.length === 0 && <p className="codex-list-empty">No sessions match.</p>}
            {shown.map((session) => (
              /* `aria-current` too, so the selection survives without styles. */
              <button key={session.id} type="button" aria-current={session.id === selected?.id ? "true" : undefined}
                className={`codex-session-row${session.id === selected?.id ? " is-active" : ""}`} onClick={() => onOpenSession(session.id)}>
                <span className="codex-list-title">{sessionTitle(session)}</span>
                {session.id === activeSessionId && <Badge tone="success">Active</Badge>}
                <VisibilityBadge revealed={session.revealedToPlayers} />
                {/* The same clickable chip the editor renders. */}
                {session.tags.slice(0, 2).map((tag) => <TagChip key={tag} tag={tag} onPick={onPickTag} />)}
              </button>
            ))}
          </nav>
        </aside>

        <section className="codex-main scroll-y">
          {selected && <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpenSession(null)}><IconChevron className="codex-chevron-left" aria-hidden="true" />All sessions</Button>}
          {/* The feed's own failure, distinct from a campaign with no sessions. */}
          {error && <Alert tone="danger" title="Couldn't load the sessions">{error}</Alert>}
          {selected
            ? <SessionEditor key={selected.id} gmToken={gmToken} session={selected} isActive={selected.id === activeSessionId}
                autosave={autosave} pages={pages} actors={actors} onPickTag={onPickTag}
                onChanged={onChanged} onDeleted={() => { onOpenSession(null); void onChanged(); }} />
            : !loading && !error && <div className="codex-main-empty"><h3>No session selected</h3><p>A session holds GM-only prep and a recap for players. While a session is active, new journal entries and logged battles are filed under it.</p><Button variant="primary" onClick={create}>New session</Button></div>}
        </section>
      </div>
    </>
  );
}

/**
 * One session's two layers. Keyed on the session id by its caller, so switching sessions gets a fresh
 * draft. Autosaves; `expectedRev` still guards with 409.
 */
type SessionDraft = Readonly<{ sessionNumber: string; realDate: string; attendees: readonly string[]; status: CodexSessionStatus; prepBody: string; recapBody: string; tags: readonly string[] }>;

function SessionEditor({ gmToken, session, isActive, autosave, pages, actors = [], onPickTag, onChanged, onDeleted }: Readonly<{
  gmToken: string; session: CodexSession; isActive: boolean; autosave: CodexAutosaveSettings;
  pages: readonly CodexPageSummary[]; actors?: readonly ArchivableActor[]; onPickTag?: (tag: string) => void;
  onChanged: () => void | Promise<void>; onDeleted: () => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<SessionDraft>({
    sessionNumber: session.sessionNumber?.toString() ?? "", realDate: session.realDate ?? "",
    attendees: session.attendees, status: session.status, prepBody: session.prepBody, recapBody: session.recapBody, tags: session.tags
  });
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef(session.rev);
  const patch = (next: Partial<SessionDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  /** The characters "Who played" offers; the field stores names. */
  const characters = useMemo(() => charactersFor(pages, actors), [pages, actors]);
  const attendeeSuggestions = useMemo(() => characters.map((option) => option.title), [characters]);
  /** Display only: the stored value is the name itself. */
  const attendeeLabel = useCallback(
    (name: string) => archivedOptionLabel(name, characters.find((option) => option.title === name)?.archived ?? false),
    [characters]
  );

  const write = useCallback(async (next: SessionDraft) => {
    const updated = await sessionApi.update(gmToken, session.id, {
      sessionNumber: next.sessionNumber.trim() ? Number(next.sessionNumber) : null,
      realDate: next.realDate.trim() || null,
      // Always sent: omitting `attendees` keeps the stored list, so removing the last name needs `[]`.
      attendees: next.attendees,
      prepBody: next.prepBody, recapBody: next.recapBody, status: next.status, tags: next.tags,
      expectedRev: revRef.current
    });
    revRef.current = updated.rev;
    setError(null);
    await onChanged();
  }, [gmToken, session.id, onChanged]);

  const { status: saveStatus, dirty, flush } = useCodexAutosave<SessionDraft>({
    settings: autosave, draft, save: write,
    // A duplicate session number is a 400 written for the GM, so it is shown verbatim.
    onConflict: async () => { revRef.current = (await sessionApi.get(gmToken, session.id)).rev; }
  });
  useEffect(() => { if (saveStatus === "error") setError("Couldn't save the session. Check the session number isn't already taken."); }, [saveStatus]);

  const reveal = async (revealed: boolean) => {
    setError(null);
    // Its own route: revealing isn't an edit (no `expectedRev`, no `rev` bump, no `updatedAt` change).
    try { await sessionApi.reveal(gmToken, session.id, revealed); await onChanged(); }
    catch { setError("Couldn't change who can see this recap."); }
  };
  const activate = async () => {
    setError(null);
    try { await sessionApi.activate(gmToken, session.id); await onChanged(); }
    catch { setError("Couldn't make this session active."); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete session", body: `Delete ${sessionTitle(session).toLowerCase()}? Its prep and recap are lost. Journal entries filed under it are not deleted.`, confirmLabel: "Delete", danger: true }))) return;
    try { await sessionApi.remove(gmToken, session.id); onDeleted(); }
    catch { setError("Couldn't delete the session."); }
  };

  return (
    <Panel accent="cyan" className="codex-session-editor">
      <div className="codex-composer-head">
        <strong>{sessionTitle(session)}</strong>
        <div className="codex-composer-head-actions">
          <SaveState status={saveStatus} onRetry={() => void flush()} onReload={() => void flush()} />
          {!autosave.enabled && <Button variant="primary" size="sm" disabled={!dirty} onClick={() => void flush()}>Save</Button>}
          {isActive
            ? <Badge tone="success"><span className="codex-dot" aria-hidden="true" /> Active session</Badge>
            : <Button variant="secondary" size="sm" onClick={activate}>Make active</Button>}
          <RevealSwitch revealed={session.revealedToPlayers} onChange={reveal} ariaLabel="Show this recap to players" />
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {isActive && <p className="codex-inspector-hint">New journal entries and logged battles are filed under this session.</p>}

      <div className="codex-composer-meta">
        <Field label="Session #" htmlFor="s-number"><Input id="s-number" type="number" inputMode="numeric" value={draft.sessionNumber} onChange={(event) => patch({ sessionNumber: event.target.value })} /></Field>
        {/* No help string: a 3-row field would stretch its neighbours (see `align-content: start` in codex.css). */}
        <Field label="Date played" htmlFor="s-date"><Input id="s-date" value={draft.realDate} placeholder="2026-07-26" onChange={(event) => patch({ realDate: event.target.value })} /></Field>
        <Field label="Status" htmlFor="s-status">
          <Select id="s-status" value={draft.status} onChange={(event) => patch({ status: event.target.value as CodexSessionStatus })}>
            <option value="planned">Planned</option>
            <option value="played">Played</option>
          </Select>
        </Field>
      </div>

      <Field label="Tags" htmlFor="s-tags">
        <TagInput id="s-tags" ariaLabel="Tags" placeholder="arc-one, tavern" values={draft.tags}
          onChange={(tags: readonly string[]) => patch({ tags })} max={24} maxReachedReason="A session may carry at most 24 tags." />
      </Field>
      {onPickTag && draft.tags.length > 0 && (
        <div className="codex-editor-tagjumps">
          {draft.tags.map((tag) => <TagChip key={tag} tag={tag} onPick={onPickTag} />)}
        </div>
      )}

      {/* Its own full-width row so the chip cloud isn't squeezed on a phone. */}
      {/* `pick` shows a chooser over character pages (active first, archived marked); `allowFreeText`
          keeps guests without a page. Stores names, not page ids. */}
      <Field label="Who played" htmlFor="s-attendees">
        <TagInput id="s-attendees" ariaLabel="Who played" placeholder="Add a name" values={draft.attendees}
          onChange={(attendees: readonly string[]) => patch({ attendees })} max={24} maxReachedReason="A session may list at most 24 people."
          suggestions={attendeeSuggestions} pick optionLabel={attendeeLabel}
          /* Not slugified: these are people's names (the server accepts any trimmed string up to 40 chars). */
          normalize={(raw) => raw.trim().slice(0, 40)} />
      </Field>

      {/* The same editor as a page body; GM layer, so it takes the violet block. */}
      <Field label={<span className="codex-composer-gm-label">Prep for this session <GmOnlyTag /></span>} htmlFor="s-prep">
        <CodexEditor id="s-prep" token={gmToken} value={draft.prepBody} onChange={(prepBody) => patch({ prepBody })}
          ariaLabel="Prep for this session" placeholder="Prep notes for this session"
          pages={pages} onNavigate={() => undefined} gmLayer rows={8} />
      </Field>

      <Field label="Recap" help="Players see this once the session is shown to them." htmlFor="s-recap">
        <CodexEditor id="s-recap" token={gmToken} value={draft.recapBody} onChange={(recapBody) => patch({ recapBody })}
          ariaLabel="Recap" placeholder="Recap of this session"
          pages={pages} onNavigate={() => undefined} rows={8} />
      </Field>

      <div className="codex-composer-foot">
        <Button variant="ghost" size="sm" onClick={remove}>Delete session</Button>
      </div>
      {confirmDialog}
    </Panel>
  );
}
