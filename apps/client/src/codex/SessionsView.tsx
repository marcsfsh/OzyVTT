import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Field, Input, Panel, Select, Skeleton, TagInput, Textarea } from "@vtt/ui";
import { sessionApi, type CodexSession, type CodexSessionStatus } from "./api";
import { pickNextSession, sessionTitle } from "./sessions";
import { GmOnlyTag, RevealSwitch } from "./SecretMarkers";
import { useConfirm } from "../components/feedback";

/**
 * M9: the session log — **the one place a session is edited**.
 *
 * Deliberately a destination inside the Codex shell rather than a sixth mode tab. The five existing
 * tabs already overflow a 375px strip by 67px (`.codex-modetabs` carries the overflow cue for exactly
 * that reason); a sixth would push the overflow past the point where the cue helps, and sessions are a
 * place the GM visits between games rather than a lens they keep switching between mid-fight.
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
  /** R1: land ON a session, not merely "the session log, somewhere". Same latch shape as `openEntryId`. */
  openSessionId?: string | null;
  onOpenedSession?: () => void;
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}>;

export function SessionsView({ gmToken, sessions, activeSessionId, loading, error, openSessionId = null, onOpenedSession = () => {}, onChanged, onClose }: SessionsViewProps) {
  /**
   * Three states, not two. `undefined` is "the GM has not chosen yet", which is what lets the log open
   * on the active session; `null` is "explicitly cleared", which is what the phone's `‹ All sessions`
   * link means. Collapsing the two would make that link a no-op, because the fallback would instantly
   * re-select the very session it just closed.
   */
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [listError, setListError] = useState<string | null>(null);

  /**
   * R1: the arriving jump's landing. The same handled-latch the Journal's `openEntryId` uses, and for
   * the same three reasons: `loading` guards it so a target cannot be dropped before the list exists,
   * the ref stops a re-render re-selecting a session the GM has since navigated away from, and clearing
   * the ref when the request goes away is what lets the SAME session be reached again from a later jump.
   */
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openSessionId) { handledRef.current = null; return; }
    if (loading || handledRef.current === openSessionId) return;
    handledRef.current = openSessionId;
    setSelectedId(openSessionId);
    onOpenedSession();
  }, [openSessionId, loading, onOpenedSession]);

  // Nothing chosen yet: land on the session the table is pointed at, which is what a GM opening the
  // log between games is almost always after. `pickNextSession` is the SAME rule the dashboard card and
  // the console use, so the three never disagree about which session "now" means.
  const selected = selectedId === undefined
    ? pickNextSession(sessions, activeSessionId)
    : sessions.find((session) => session.id === selectedId) ?? null;

  const create = async () => {
    setListError(null);
    // Suggest the next number rather than asking for one. A duplicate is a clean 400 with a message
    // written for a GM to read, so the suggestion can be wrong without being destructive.
    const highest = sessions.reduce((best, session) => Math.max(best, session.sessionNumber ?? 0), 0);
    try {
      const session = await sessionApi.create(gmToken, { sessionNumber: highest + 1, status: "planned" });
      await onChanged();
      setSelectedId(session.id);
    } catch (createError) { setListError(createError instanceof Error ? createError.message : "Couldn't create the session."); }
  };

  return (
    <>
      {/* The way out, ABOVE the two panes rather than inside the rail. On a phone the rail is hidden
          while a session is open (`has-selection`), so an exit living in it would make leaving the log
          a two-tap manoeuvre — back to the list, then back to the Codex. §4: `Button` is a `@vtt/ui`
          primitive and carries the 44px floor itself; the wrapper is layout, not a control. */}
      <div className="codex-sessions-exit"><Button variant="ghost" size="sm" onClick={onClose}>‹ Back to the Codex</Button></div>
      <div className={`codex-workspace${selected ? " has-selection" : ""}`}>
        <aside className="codex-rail">
          <div className="codex-rail-head">
            <strong className="codex-sessions-railtitle">Sessions</strong>
            {/* §4: `Button size="sm"` is a `@vtt/ui` primitive and carries the 44px floor itself
                (route 2, `.nh-btn--sm`) — no new control, no new floor to argue about. */}
            <Button variant="ghost" size="sm" onClick={create}>＋ New</Button>
          </div>
          {listError && <Alert tone="danger">{listError}</Alert>}
          <nav className="codex-list" aria-label="Session log">
            {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
            {!loading && sessions.length === 0 && !error && <p className="codex-list-empty">No sessions yet. Create one to prep the next game.</p>}
            {sessions.map((session) => (
              /* `aria-current` as well as the class: the accent is the visual cue, but "which session am
                 I looking at" has to survive with every stylesheet stripped (R2's colour rule again). */
              <button key={session.id} type="button" aria-current={session.id === selected?.id ? "true" : undefined}
                className={`codex-session-row${session.id === selected?.id ? " is-active" : ""}`} onClick={() => setSelectedId(session.id)}>
                <span className="codex-list-title">{sessionTitle(session)}</span>
                {session.id === activeSessionId && <Badge tone="success">Active</Badge>}
                {session.revealedToPlayers && <Badge tone="info">Shown</Badge>}
              </button>
            ))}
          </nav>
        </aside>

        <section className="codex-main">
          {selected && <button type="button" className="codex-back" onClick={() => setSelectedId(null)}>‹ All sessions</button>}
          {/* R4: this surface's own failure. The log reads one feed; a silent one is an empty log that
              looks exactly like a campaign that has never had a session. */}
          {error && <Alert tone="danger" title="Couldn't load the sessions">{error}</Alert>}
          {selected
            ? <SessionEditor key={selected.id} gmToken={gmToken} session={selected} isActive={selected.id === activeSessionId}
                onChanged={onChanged} onDeleted={() => { setSelectedId(null); void onChanged(); }} />
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
 * Explicit Save, not the page editor's debounced autosave: `prepBody` is written in long sittings and
 * `recapBody` is written once, after the game — neither is the fast back-and-forth that made autosave
 * right for a wiki page, and an explicit save keeps `expectedRev` meaningful instead of resyncing
 * against itself on every keystroke.
 */
function SessionEditor({ gmToken, session, isActive, onChanged, onDeleted }: Readonly<{
  gmToken: string; session: CodexSession; isActive: boolean; onChanged: () => void | Promise<void>; onDeleted: () => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [sessionNumber, setSessionNumber] = useState(session.sessionNumber?.toString() ?? "");
  const [realDate, setRealDate] = useState(session.realDate ?? "");
  const [attendees, setAttendees] = useState<readonly string[]>(session.attendees);
  const [status, setStatus] = useState<CodexSessionStatus>(session.status);
  const [prepBody, setPrepBody] = useState(session.prepBody);
  const [recapBody, setRecapBody] = useState(session.recapBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await sessionApi.update(gmToken, session.id, {
        sessionNumber: sessionNumber.trim() ? Number(sessionNumber) : null,
        realDate: realDate.trim() || null,
        // Always sent, never omitted: omitting `attendees` leaves the stored list alone, so removing the
        // last name has to travel as an explicit empty array (the journal's `tags` contract exactly).
        attendees,
        prepBody, recapBody, status,
        expectedRev: session.rev
      });
      await onChanged();
    } catch (saveError) {
      // Two different server answers, both worth reading verbatim: a duplicate session number is a 400
      // whose message is written for a GM ("Session 7 already exists…"), and a stale `expectedRev` is
      // the 409 optimistic-concurrency check. A generic "couldn't save" would hide the fix in both.
      setError(saveError instanceof Error ? saveError.message : "Couldn't save the session.");
    } finally { setBusy(false); }
  };

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
          {isActive
            ? <Badge tone="success">● Active session</Badge>
            : <Button variant="secondary" size="sm" onClick={activate}>Make active</Button>}
          <RevealSwitch revealed={session.revealedToPlayers} onChange={reveal} ariaLabel="Show this recap to players" />
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {isActive && <p className="codex-inspector-hint">New journal entries and logged battles file themselves under this session automatically.</p>}

      <div className="codex-composer-meta">
        <Field label="Session #" htmlFor="s-number"><Input id="s-number" type="number" inputMode="numeric" value={sessionNumber} disabled={busy} onChange={(event) => setSessionNumber(event.target.value)} /></Field>
        <Field label="Date played" htmlFor="s-date" help="The real-world date — the campaign calendar is the in-world one."><Input id="s-date" value={realDate} placeholder="2026-07-26" disabled={busy} onChange={(event) => setRealDate(event.target.value)} /></Field>
        <Field label="Status" htmlFor="s-status">
          <Select id="s-status" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as CodexSessionStatus)}>
            <option value="planned">Planned</option>
            <option value="played">Played</option>
          </Select>
        </Field>
      </div>

      {/* Its own full-width row rather than a cell in `.codex-composer-meta`, whose `flex: 1 1 130px`
          columns would squeeze a wrapping chip cloud into a 130px gutter on a phone. */}
      <Field label="Who played" htmlFor="s-attendees">
        <TagInput id="s-attendees" ariaLabel="Who played" placeholder="Add a name…" values={attendees}
          onChange={setAttendees} max={24} maxReachedReason="A session may list at most 24 people."
          /* The default slugify normalizer is OVERRIDDEN here, and this is the one place in the Codex
             where that is right: these are people's names, not tags. The server takes any trimmed
             string up to 40 characters (`AttendeesSchema`), so "Garrett P." must survive as typed —
             slugifying it to "garrett-p" would be the control quietly rewriting real-world data. */
          normalize={(raw) => raw.trim().slice(0, 40)} />
      </Field>

      {/* R5: GM-only content is ALWAYS the violet block plus the "GM only" pill — the same pair the
          journal composer and the page editor use, never a new marking of its own. */}
      <Field label={<span className="codex-composer-gm-label">Prep for this session <GmOnlyTag /></span>} htmlFor="s-prep">
        <Textarea id="s-prep" className="codex-session-body codex-gm-block" value={prepBody} disabled={busy}
          placeholder="Beats, encounters, the questions you want answered tonight…" onChange={(event) => setPrepBody(event.target.value)} />
      </Field>

      <Field label="Recap" help="Shown to players once this session is revealed." htmlFor="s-recap">
        <Textarea id="s-recap" className="codex-session-body" value={recapBody} disabled={busy}
          placeholder="What the table did, in the party's own words…" onChange={(event) => setRecapBody(event.target.value)} />
      </Field>

      <div className="codex-composer-foot">
        <Button variant="ghost" size="sm" onClick={remove}>Delete session</Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save session"}</Button>
      </div>
      {confirmDialog}
    </Panel>
  );
}
