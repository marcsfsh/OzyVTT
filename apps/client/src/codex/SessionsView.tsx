import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Field, IconChevron, IconPlus, Input, Panel, SaveState, Select, Skeleton, TagInput } from "@vtt/ui";
import { sessionApi, type CodexAutosaveSettings, type CodexPageSummary, type CodexSession, type CodexSessionStatus } from "./api";
import { pickNextSession, sessionTitle } from "./sessions";
import { createSession } from "./creates";
import { CodexEditor } from "./CodexEditor";
import { GmOnlyTag, RevealSwitch, VisibilityBadge } from "./SecretMarkers";
import { TagChip } from "./TagChip";
import { useCodexAutosave } from "./autosave";
import { useConfirm } from "../components/feedback";

/**
 * Sessions — **the one place a session is edited**, and since D1 a first-class sidebar section at
 * `/codex/sessions[/:id]` rather than a hidden destination laid over the content region.
 *
 * It owns no feed. The workspace holds ONE session list and hands it down here, to the Campaign card,
 * to the journal's by-session lens and to the console drawer, so all four are looking at the same
 * records; every write below reports back through `onChanged` and the workspace re-reads. Two session
 * stores on one screen is precisely how a console ends up disagreeing with the editor beside it.
 */
type SessionsViewProps = Readonly<{
  gmToken: string;
  sessions: readonly CodexSession[];
  activeSessionId: string | null;
  /** CF-2 / R4: the workspace's session feed is still in flight — an empty list is not yet "no sessions". */
  loading: boolean;
  /** R4: the feed's own failure. Without this a failed read renders as an empty log, silently. */
  error: string | null;
  /** D3: which session is open comes from the ADDRESS (`/codex/sessions/:id`), not from local state. */
  openSessionId?: string | null;
  /**
   * D3/D10: the filters live in the ADDRESS too (`?q=`, `?status=`), as Pages, Atlas and Journal already
   * did. In component state they were lost on every navigation and a filtered log could not be linked to
   * or refreshed back into — two of the five lists behaving unlike the other three.
   */
  filter?: string;
  statusFilter?: string | null;
  onFilterChange?: (next: Readonly<Record<string, string | null>>) => void;
  /** Navigate. `null` goes back to the list. */
  onOpenSession: (sessionId: string | null) => void;
  onChanged: () => void | Promise<void>;
  autosave: CodexAutosaveSettings;
  /** For the editor's `[[` autocomplete — the shell's one page feed, never a second fetch. */
  pages: readonly CodexPageSummary[];
  onPickTag?: (tag: string) => void;
}>;

export function SessionsView({ gmToken, sessions, activeSessionId, loading, error, openSessionId = null, onOpenSession, onChanged, autosave, pages, onPickTag, filter = "", statusFilter = null, onFilterChange }: SessionsViewProps) {
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
    // D7: the SAME create the palette's "New session" runs — one create per record type, whichever door
    // starts it, including the number suggestion.
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
            <Input value={filter} placeholder="Filter sessions…" aria-label="Filter sessions" onChange={(event) => onFilterChange?.({ q: event.target.value || null })} />
{/* D25, one primary per view. With autosave OFF the editor's Save is the primary act on this
                screen, and the empty state's own create is the primary when there is nothing to select
                — the rail's create steps down rather than competing with either. Two magenta-filled
                buttons at once (twice with the identical label "New page") make neither one the
                answer to "what do I do here". */}
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
          <nav className="codex-list" aria-label="Sessions">
            {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
            {!loading && sessions.length === 0 && !error && <p className="codex-list-empty">No sessions yet. Create one to prep the next game.</p>}
            {!loading && sessions.length > 0 && shown.length === 0 && <p className="codex-list-empty">No sessions match.</p>}
            {shown.map((session) => (
              /* `aria-current` as well as the class: the accent is the visual cue, but "which session am
                 I looking at" has to survive with every stylesheet stripped (R2's colour rule again). */
              <button key={session.id} type="button" aria-current={session.id === selected?.id ? "true" : undefined}
                className={`codex-session-row${session.id === selected?.id ? " is-active" : ""}`} onClick={() => onOpenSession(session.id)}>
                <span className="codex-list-title">{sessionTitle(session)}</span>
                {session.id === activeSessionId && <Badge tone="success">Active</Badge>}
                <VisibilityBadge revealed={session.revealedToPlayers} />
                {/* The SAME chip the editor two components down renders, and clickable for the same
                    reason: D10 says a tag opens the cross-type view from anywhere. It was inert here
                    and a button there — one session, two behaviours, one line apart in one feature. */}
                {session.tags.slice(0, 2).map((tag) => <TagChip key={tag} tag={tag} onPick={onPickTag} />)}
              </button>
            ))}
          </nav>
        </aside>

        <section className="codex-main">
          {selected && <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpenSession(null)}><IconChevron className="codex-chevron-left" aria-hidden="true" />All sessions</Button>}
          {/* R4: this surface's own failure. The log reads one feed; a silent one is an empty log that
              looks exactly like a campaign that has never had a session. */}
          {error && <Alert tone="danger" title="Couldn't load the sessions">{error}</Alert>}
          {selected
            ? <SessionEditor key={selected.id} gmToken={gmToken} session={selected} isActive={selected.id === activeSessionId}
                autosave={autosave} pages={pages} onPickTag={onPickTag}
                onChanged={onChanged} onDeleted={() => { onOpenSession(null); void onChanged(); }} />
            : !loading && !error && <div className="codex-main-empty"><h3>Prep the next session</h3><p>A session holds your GM-only prep and the recap the table reads afterwards. Make one active and new journal entries and logged battles file themselves under it.</p><Button variant="primary" onClick={create}>New session</Button></div>}
        </section>
      </div>
    </>
  );
}

/**
 * One session's two layers. Keyed on the session id by its caller, so selecting another session gets a
 * fresh draft rather than one component quietly carrying typed text across records.
 *
 * D6: it autosaves now, like everything else. Its old explicit "Save session" was the second cadence in
 * the suite — a GM who typed a recap and navigated away lost it, with no warning, because this surface
 * alone did not keep your work. `expectedRev` still travels, so the 409 path is unchanged.
 */
type SessionDraft = Readonly<{ sessionNumber: string; realDate: string; attendees: readonly string[]; status: CodexSessionStatus; prepBody: string; recapBody: string; tags: readonly string[] }>;

function SessionEditor({ gmToken, session, isActive, autosave, pages, onPickTag, onChanged, onDeleted }: Readonly<{
  gmToken: string; session: CodexSession; isActive: boolean; autosave: CodexAutosaveSettings;
  pages: readonly CodexPageSummary[]; onPickTag?: (tag: string) => void;
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

  const write = useCallback(async (next: SessionDraft) => {
    const updated = await sessionApi.update(gmToken, session.id, {
      sessionNumber: next.sessionNumber.trim() ? Number(next.sessionNumber) : null,
      realDate: next.realDate.trim() || null,
      // Always sent, never omitted: omitting `attendees` leaves the stored list alone, so removing the
      // last name has to travel as an explicit empty array (the journal's `tags` contract exactly).
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
    // A duplicate session number is a 400 whose message is written for a GM to read ("Session 7 already
    // exists…"), so it is surfaced verbatim rather than collapsed into "couldn't save".
    onConflict: async () => { revRef.current = (await sessionApi.get(gmToken, session.id)).rev; }
  });
  useEffect(() => { if (saveStatus === "error") setError("Couldn't save the session. Check the session number isn't already taken."); }, [saveStatus]);

  const reveal = async (revealed: boolean) => {
    setError(null);
    // Its own route, deliberately: revealing is not an edit, so it carries no `expectedRev`, does not
    // bump `rev` and does not move `updatedAt`. Publishing a recap must not look like GM activity.
    try { await sessionApi.reveal(gmToken, session.id, revealed); await onChanged(); }
    catch { setError("Couldn't change who can see this recap."); }
  };
  const activate = async () => {
    setError(null);
    try { await sessionApi.activate(gmToken, session.id); await onChanged(); }
    catch { setError("Couldn't point the table at this session."); }
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
      {isActive && <p className="codex-inspector-hint">New journal entries and logged battles file themselves under this session automatically.</p>}

      <div className="codex-composer-meta">
        <Field label="Session #" htmlFor="s-number"><Input id="s-number" type="number" inputMode="numeric" value={draft.sessionNumber} onChange={(event) => patch({ sessionNumber: event.target.value })} /></Field>
        <Field label="Date played" htmlFor="s-date" help="The real-world date — the Calendar is the in-world one."><Input id="s-date" value={draft.realDate} placeholder="2026-07-26" onChange={(event) => patch({ realDate: event.target.value })} /></Field>
        <Field label="Status" htmlFor="s-status">
          <Select id="s-status" value={draft.status} onChange={(event) => patch({ status: event.target.value as CodexSessionStatus })}>
            <option value="planned">Planned</option>
            <option value="played">Played</option>
          </Select>
        </Field>
      </div>

      {/* D10: sessions are taggable, on the same vocabulary and the same slug rules pages use. */}
      <Field label="Tags" htmlFor="s-tags">
        <TagInput id="s-tags" ariaLabel="Tags" placeholder="arc-one, tavern" values={draft.tags}
          onChange={(tags: readonly string[]) => patch({ tags })} max={24} maxReachedReason="A session may carry at most 24 tags." />
      </Field>
      {onPickTag && draft.tags.length > 0 && (
        <div className="codex-editor-tagjumps">
          {draft.tags.map((tag) => <TagChip key={tag} tag={tag} onPick={onPickTag} />)}
        </div>
      )}

      {/* Its own full-width row rather than a cell in `.codex-composer-meta`, whose `flex: 1 1 130px`
          columns would squeeze a wrapping chip cloud into a 130px gutter on a phone. */}
      <Field label="Who played" htmlFor="s-attendees">
        <TagInput id="s-attendees" ariaLabel="Who played" placeholder="Add a name…" values={draft.attendees}
          onChange={(attendees: readonly string[]) => patch({ attendees })} max={24} maxReachedReason="A session may list at most 24 people."
          /* The default slugify normalizer is OVERRIDDEN here, and this is the one place in the Codex
             where that is right: these are people's names, not tags. The server takes any trimmed
             string up to 40 characters (`AttendeesSchema`), so "Garrett P." must survive as typed —
             slugifying it to "garrett-p" would be the control quietly rewriting real-world data. */
          normalize={(raw) => raw.trim().slice(0, 40)} />
      </Field>

      {/* R5: GM-only content is ALWAYS the violet block plus the "GM only" pill — the same pair the
          journal composer and the page editor use, never a new marking of its own. */}
      {/* D13: the SAME writing surface a page body gets — toolbar, `[[` autocomplete, image drop. Before
          this, typing `[[` in a session's prep did nothing at all. GM-layer, so it takes the violet block. */}
      <Field label={<span className="codex-composer-gm-label">Prep for this session <GmOnlyTag /></span>} htmlFor="s-prep">
        <CodexEditor id="s-prep" token={gmToken} value={draft.prepBody} onChange={(prepBody) => patch({ prepBody })}
          ariaLabel="Prep for this session" placeholder="Beats, encounters, the questions you want answered tonight…"
          pages={pages} onNavigate={() => undefined} gmLayer rows={8} />
      </Field>

      <Field label="Recap" help="Shown to players once you show this session to them." htmlFor="s-recap">
        <CodexEditor id="s-recap" token={gmToken} value={draft.recapBody} onChange={(recapBody) => patch({ recapBody })}
          ariaLabel="Recap" placeholder="What the table did, in the party's own words…"
          pages={pages} onNavigate={() => undefined} rows={8} />
      </Field>

      <div className="codex-composer-foot">
        <Button variant="ghost" size="sm" onClick={remove}>Delete session</Button>
      </div>
      {confirmDialog}
    </Panel>
  );
}
