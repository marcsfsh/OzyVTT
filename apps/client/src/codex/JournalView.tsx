import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Combobox, Field, Input, Panel, SegmentedControl, Select, Skeleton, TagInput, Textarea } from "@vtt/ui";
import { socket } from "../socket";
import { calendarApi, calendarYearOf, codexApi, dateToInstant, formatWorldDate, journalApi, type CodexAutosaveSettings, type CodexChronicleKind, type CodexChronicleRecord, type CodexPageSummary, type CodexSession, type GmCodexCalendar } from "./api";
import { CHRONICLE_FILTER_KINDS, CHRONICLE_KIND_META, CHRONICLE_LENSES, questEventLabel, questEventOf, chronicleWhenLabel, deadlineFired, deadlinesPassedBy, deadlineStateLabel, deadlineStateTone, downtimeOf, downtimeProposedDate, downtimeSummaryLabel, groupChronicle, milestoneOf, milestoneSummaryLabel, revealAheadOfPlayers, sameInWorldDate, standingChangeLabel, standingOf, type ChronicleLens } from "./chronicle";
import { CodexIcon } from "./icons";
import { CodexMarkdown } from "./CodexMarkdown";
import { CalendarEditor } from "./CalendarEditor";
import { CodexEditor } from "./CodexEditor";
import { RevealSwitch, GmOnlyTag } from "./SecretMarkers";
import { sessionByNumber, sessionTitle } from "./sessions";
import { Notice, useConfirm, type NoticeMessage } from "../components/feedback";

/**
 * The campaign chronicle (CT-11 / CT-12): **one** timeline carrying GM-written two-layer journal entries
 * AND dated `event` pages, placed on the world's own calendar and readable through two lenses — by
 * in-world date or by session. A structured in-world date is what puts a record on it; entries can also
 * carry a session #, be pinned to a page, and reveal to players. Logged encounters auto-post here.
 *
 * The composer below writes JOURNAL ENTRIES only. An `event` row is a wiki page: its two layers, its
 * fields and its date are edited on the page itself, which is why an event row offers "Open page" where
 * an entry row offers Edit/Delete. One timeline, two kinds of record, each edited where it lives.
 */
/**
 * M12: the composer writes FOUR shapes of the same record — an entry, a deadline (CT-5), downtime
 * (CT-10) and a milestone (CT-8). One composer rather than four, because they are one row in one table:
 * two layers of prose, a reveal flag and an in-world date. A deadline adds only the rule that the date is
 * required (a deadline with no date can never fire); downtime adds who/activity/days; a milestone adds
 * the level reached and why.
 *
 * A `standing` record is deliberately NOT a fifth option here. It is not something a GM writes on the
 * timeline — it is written BY the standing card, as the second half of one transaction that also moves
 * the number. Offering it in this switch would be a second way to write a record that must never exist
 * without the table change it describes.
 */
const COMPOSER_KINDS = ["entry", "deadline", "downtime", "milestone"] as const;
type ComposerKind = (typeof COMPOSER_KINDS)[number];
/** The words each shape uses. The KIND labels come from `CHRONICLE_KIND_META`, so the composer's switch
    and the rows it produces can never call the same record two different things. */
const COMPOSER_COPY: Readonly<Record<ComposerKind, Readonly<{ heading: string; textLabel: string; textPlaceholder: string; submit: string }>>> = {
  entry: { heading: "New journal entry", textLabel: "Player-facing summary", textPlaceholder: "What the party knows about this…", submit: "Add entry" },
  // D11-C: a deadline stores no payload — WHAT will happen is this text, WHEN is the record's own date.
  deadline: { heading: "New deadline", textLabel: "What will happen", textPlaceholder: "The duke's ultimatum expires…", submit: "Add deadline" },
  downtime: { heading: "New downtime", textLabel: "What the party knows", textPlaceholder: "How the time was spent…", submit: "Log downtime" },
  milestone: { heading: "New milestone", textLabel: "What the party knows", textPlaceholder: "The company came back from the Underdark changed…", submit: "Record milestone" }
};
/** The server's bounds, stated here too, so a slip is a disabled field rather than a generic 400. */
const DOWNTIME_TEXT_MAX = 120;
const DOWNTIME_DAYS_MAX = 3650;
/** CT-8: the 5e level range. "No XP arithmetic" — the GM says which level was reached, nothing is computed. */
const MILESTONE_LEVEL_MIN = 1;
const MILESTONE_LEVEL_MAX = 20;
const MILESTONE_REASON_MAX = 120;

type Draft = { kind: ComposerKind; playerText: string; gmText: string; sessionId: string; dateYear: string; dateMonth: string; dateDay: string; attachPageId: string; revealed: boolean; tags: readonly string[]; who: string; activity: string; days: string; level: string; reason: string };
const EMPTY: Draft = { kind: "entry", playerText: "", gmText: "", sessionId: "", dateYear: "", dateMonth: "0", dateDay: "", attachPageId: "", revealed: false, tags: [], who: "", activity: "", days: "", level: "", reason: "" };
const DRAFT_KEY = "codex-journal-draft";
const LENS_KEY = "codex-chronicle-lens";
/**
 * OWNER DECISION (2026-07-30): the prep-clock reveal warning is switchable off, and the switch is per
 * DEVICE — `localStorage`, like every other GM reading preference in this app (`vtt.show-occupied`,
 * `codex-notebook-sort`). Deliberately not server state: it changes nothing a player can observe and
 * nothing the server authorises, so putting it in `codex_meta` would have cost a migration, a route and an
 * API-contract change to store a preference about a dialog. Absent means ON — a warning that defaults off
 * because storage is unavailable is not a warning.
 */
const REVEAL_WARN_KEY = "codex.warn-reveal-ahead";
const readRevealWarn = (): boolean => { try { return localStorage.getItem(REVEAL_WARN_KEY) !== "off"; } catch { return true; } };
const writeRevealWarn = (on: boolean) => { try { localStorage.setItem(REVEAL_WARN_KEY, on ? "on" : "off"); } catch { /* private mode - the preference stays in-session */ } };

/**
 * CI-6 (return edge): an entry knows where it happened (`attachMarkerId`, set by the combat bridge when
 * a battle is logged at a pin) and which encounter produced it (`sourceEncounterId`). Both jumps are
 * owned by surfaces above this one — the Atlas for the pin, the replay panel for the fight — so the
 * journal hands the id up rather than reaching sideways into either. `onOpenReplay` is the SAME prop
 * `PageTimeline` already takes, threaded from the same place, so there is one replay path and not two.
 */
export function JournalView({ gmToken, autosave, pages: shellPages, onOpenPage, onOpenMarker, onOpenReplay, openEntryId = null, onOpenedEntry = () => {}, sessions = [], activeSessionId = null, onOpenSession, onOpenCalendar, kindFilter = null, tagFilter = null, textFilter = "", onFilterChange }: Readonly<{
  gmToken: string;
  /** D6: the GM's cadence, for the edit path. The composer keeps an explicit Add (creation ≠ editing). */
  autosave: CodexAutosaveSettings;
  /** The shell's one page feed, for `[[` autocomplete. Never a second fetch. */
  pages: readonly CodexPageSummary[];
  onOpenPage: (pageId: string) => void;
  onOpenMarker?: (markerId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  openEntryId?: string | null;
  onOpenedEntry?: () => void;
  /** D10: in-place filters, held in the URL so a dashboard card can deep-link to a filtered Journal. */
  kindFilter?: string | null;
  tagFilter?: string | null;
  textFilter?: string;
  onFilterChange?: (next: Readonly<Record<string, string | null>>) => void;
  /** D17: the Calendar is a section of its own now, not a modal opened from here. */
  onOpenCalendar?: () => void;
  activeSessionId?: string | null;
  /**
   * M9: the session RECORDS, handed down from the workspace's single feed rather than fetched here.
   * A second read would be a second answer to "which sessions exist", and the by-session lens would be
   * the surface where the two disagreed.
   */
  sessions?: readonly CodexSession[];
  /** R1: opens Sessions ON that session. Absent = the lens keeps rendering exactly as it did. */
  onOpenSession?: (sessionId: string) => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [records, setRecords] = useState<CodexChronicleRecord[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [calendar, setCalendar] = useState<GmCodexCalendar | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // A draft saved before CI-2 has no `tags` key, so EMPTY supplies one; the Array guard also stops a
  // corrupt value reaching TagInput, which maps over it. `kind` is parsed the same fail-closed way (a
  // draft saved before M11 has none, and an unknown one must land on `entry` rather than on undefined).
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (!saved) return EMPTY;
      const parsed = JSON.parse(saved) as Partial<Draft>;
      return {
        ...EMPTY, ...parsed,
        kind: COMPOSER_KINDS.includes(parsed.kind as ComposerKind) ? (parsed.kind as ComposerKind) : "entry",
        tags: Array.isArray(parsed.tags) ? parsed.tags : []
      };
    } catch { return EMPTY; }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingKind, setEditingKind] = useState<CodexChronicleKind | null>(null);
  // An in-progress NEW entry, set aside while the composer is borrowed to edit an existing one. Without
  // this, clicking Edit overwrote the draft AND (via the effect below) deleted its sessionStorage backup.
  const [stashedDraft, setStashedDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // CF-2: an empty list is ambiguous until the first fetch settles — without this the journal
  // asserts "No journal entries yet." over a campaign that simply has not loaded.
  const [loading, setLoading] = useState(true);
  /**
   * Publishing the clock used to be silent: the prep-clock row renders only WHILE the two clocks disagree,
   * so a successful publish made the row — and with it the only readout of what the table is on — vanish,
   * which reads identically to a click that did nothing. This is the acknowledgement, and it names the date
   * so the answer to "what do the players think it is?" survives the row it was asked on.
   */
  const [notice, setNotice] = useState<NoticeMessage>(null);
  /** The reveal warning's own switch (see `REVEAL_WARN_KEY`). State, not a raw read, so turning it back on re-arms without a reload. */
  const [revealWarn, setRevealWarn] = useState(readRevealWarn);

  // CT-12: the lens is a reading preference, so it survives leaving and returning to the mode — the same
  // sessionStorage discipline the composer draft uses, and for the same reason.
  const [lens, setLens] = useState<ChronicleLens>(() => {
    try { return sessionStorage.getItem(LENS_KEY) === "session" ? "session" : "date"; } catch { return "date"; }
  });
  useEffect(() => { try { sessionStorage.setItem(LENS_KEY, lens); } catch { /* private mode - fine */ } }, [lens]);

  const load = useCallback(async () => {
    try {
      const [nextRecords, nextPages, nextCalendar] = await Promise.all([journalApi.chronicle(gmToken), codexApi.listPages(gmToken), calendarApi.get(gmToken)]);
      setRecords(nextRecords); setPages(nextPages); setCalendar(nextCalendar); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the journal."); }
    finally { setLoading(false); }
  }, [gmToken]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onChanged = () => { void load(); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);
  // Persist an in-progress NEW entry so switching Codex tabs mid-compose doesn't silently drop it. While
  // editing an existing entry the composer holds that entry, so the thing worth keeping is the stash.
  useEffect(() => {
    try {
      const pending = stashedDraft ?? (editingId ? null : draft);
      // M11: a downtime draft can be worth keeping with no prose at all — who/activity carry it — so
      // emptiness has to ask about those too, or switching tabs mid-compose would silently drop one.
      // M12: a milestone draft is the same case — its level and reason ARE the record.
      const isEmpty = !pending || (!pending.playerText.trim() && !pending.gmText.trim() && !pending.who.trim() && !pending.activity.trim() && !pending.level.trim() && !pending.reason.trim());
      if (isEmpty) sessionStorage.removeItem(DRAFT_KEY); else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(pending));
    } catch { /* private mode - fine */ }
  }, [draft, editingId, stashedDraft]);

  // CI-1 / R1: arriving from a search hit, the destination is prepared — the entry is marked and scrolled
  // to, not merely "the Journal mode, somewhere in a year of entries". Same handled-latch shape as the
  // atlas target and ReplayPanel's `openArchiveId`; the latch clears when the request does, so the same
  // entry can be reached again from a later search.
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const handledEntryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openEntryId) { handledEntryRef.current = null; return; }
    if (loading || handledEntryRef.current === openEntryId) return;
    handledEntryRef.current = openEntryId;
    setFocusedEntryId(openEntryId);
    onOpenedEntry();
  }, [openEntryId, loading, onOpenedEntry]);
  // Runs on `records` too: the article only exists once the timeline has rendered it.
  useEffect(() => {
    if (!focusedEntryId) return;
    document.getElementById(`codex-entry-${focusedEntryId}`)?.scrollIntoView({ block: "center" });
  }, [focusedEntryId, records]);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const submit = async () => {
    const inWorldDate = draft.dateYear.trim()
      ? { year: Math.trunc(Number(draft.dateYear) || 0), month: Number(draft.dateMonth || 0), day: Math.max(1, Math.trunc(Number(draft.dateDay) || 1)) }
      : null;
    const input = {
      playerText: draft.playerText, gmText: draft.gmText.trim() || null, revealedToPlayers: draft.revealed,
      attachPageId: draft.attachPageId || null,
      /**
       * D9: entries join their session **by identity**. `sessionNumber` is display data the server
       * resolves from the linked record and is a 400 on any write body, so it is never serialized here.
       * An empty string means "— none —" and travels as an explicit null; omitting the key on a CREATE
       * would auto-file under the active session, which is a different (and also correct) behaviour, so
       * the composer states its choice rather than relying on the default.
       */
      sessionId: draft.sessionId ? draft.sessionId : null,
      inWorldDate,
      // Always sent, never omitted: on an edit, omitting `tags` would leave the old ones in place, so
      // removing the last tag from an entry has to travel as an explicit empty array.
      tags: draft.tags
    };
    try {
      // `editingId` is asked FIRST and the kind is never consulted on that path. The PATCH route edits
      // an entry's prose, date, session, pin and tags whatever kind the row is; it has no notion of kind
      // at all, which is why the switch is hidden while editing — a record's kind is fixed once written.
      if (editingId) await journalApi.update(gmToken, editingId, input);
      else if (draft.kind === "deadline") {
        // Guarded here as well as by the disabled button: `createDeadline` requires a date, and a
        // rejected create is a worse way to learn that than a button that will not arm.
        if (!inWorldDate) { setError("A deadline needs a date — that is what makes it fire."); return; }
        await journalApi.createDeadline(gmToken, { ...input, inWorldDate });
      } else if (draft.kind === "downtime") {
        // O-3: this creates a RECORD and nothing else. The clock does not move here, and the response's
        // proposed date is not applied — confirming it is a separate action on the row itself.
        await journalApi.createDowntime(gmToken, {
          ...input,
          downtime: {
            who: draft.who.trim().slice(0, DOWNTIME_TEXT_MAX),
            activity: draft.activity.trim().slice(0, DOWNTIME_TEXT_MAX),
            days: Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0)))
          }
        });
      } else if (draft.kind === "milestone") {
        // CT-8: level history, and nothing derived from it. The level is clamped to the 5e range here as
        // well as on the server, for the same reason downtime's days are — a rejected create is a worse
        // way to learn a bound than a field that would not accept the value.
        await journalApi.createMilestone(gmToken, {
          ...input,
          milestone: {
            level: Math.min(MILESTONE_LEVEL_MAX, Math.max(MILESTONE_LEVEL_MIN, Math.trunc(Number(draft.level) || MILESTONE_LEVEL_MIN))),
            reason: draft.reason.trim().slice(0, MILESTONE_REASON_MAX)
          }
        });
      } else await journalApi.create(gmToken, input);
      // Finishing an edit hands the composer back to whatever new entry was in progress; finishing a NEW
      // record keeps the composer on the kind it was on, since a GM setting deadlines usually sets several.
      setDraft(editingId ? (stashedDraft ?? EMPTY) : { ...EMPTY, kind: draft.kind }); setStashedDraft(null); setEditingId(null); setEditingKind(null); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save the entry."); }
  };
  const edit = (record: CodexChronicleRecord) => {
    // Set aside an unsaved NEW entry before the composer is reused, so Edit can never destroy it.
    if (!editingId && (draft.playerText.trim() || draft.gmText.trim() || draft.who.trim() || draft.activity.trim() || draft.level.trim() || draft.reason.trim())) setStashedDraft(draft);
    setEditingId(record.id);
    // What KIND is being edited. The composer's own `kind` is a new-record choice and is parked below, so
    // without this the edit path could not tell a deadline from a note — and a deadline's date is the one
    // field an edit must not be allowed to clear (D11-C).
    setEditingKind(record.kind);
    const date = record.inWorldDate; // the raw date the GM typed - correct even if the calendar has since changed
    setDraft({
      // The composer's kind is a NEW-record choice; on the edit path it is never read (see `submit`), so
      // it is parked back on `entry` rather than pretending a deadline's kind can be changed here.
      kind: "entry",
      playerText: record.text, gmText: record.gmText ?? "", sessionId: record.sessionId ?? "",
      dateYear: date ? String(date.year) : "", dateMonth: date ? String(date.month) : "0", dateDay: date ? String(date.day) : "",
      attachPageId: record.attachPageId ?? "", revealed: record.revealedToPlayers, tags: record.tags,
      // A downtime's who/activity/days and a milestone's level/reason are not editable — there is no
      // route that rewrites a payload — so the composer does not pretend to offer them on the edit path.
      who: "", activity: "", days: "", level: "", reason: ""
    });
  };
  /**
   * O-3, the confirmation itself: mark this downtime applied and move the campaign clock by its days, in
   * one server-side transaction. The whole chronicle is re-read afterwards rather than patched from the
   * response, because moving the clock changes what every dated row's "Today" marker and every deadline's
   * fired state say — the clock is not a field on this record, it is the frame the whole timeline hangs in.
   */
  const applyDowntime = async (record: CodexChronicleRecord) => {
    try { await journalApi.applyDowntime(gmToken, record.id); await load(); }
    catch (applyError) { setError(applyError instanceof Error ? applyError.message : "Could not advance the campaign clock."); }
  };
  /** O-1 / D11-H: hand the GM's clock to the table. The only thing on this client that publishes it. */
  const publishDate = async () => {
    // Read the date BEFORE the round-trip: `load()` replaces `calendar`, and after a successful publish the
    // two clocks agree, so "the date players now see" and "the GM's clock" are the same value either way —
    // but naming it from the pre-publish state is what makes the message true even if the GM edits the
    // calendar between the click and the refetch.
    const published = calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null;
    try {
      await calendarApi.publish(gmToken);
      await load();
      setNotice({ tone: "success", text: published ? `Players now see ${published}.` : "The date is published to players." });
    }
    catch (publishError) { setError(publishError instanceof Error ? publishError.message : "Could not publish the date."); }
  };
  const cancelEdit = () => { setEditingId(null); setEditingKind(null); setDraft(stashedDraft ?? EMPTY); setStashedDraft(null); };
  /**
   * Reveal from the row, whichever kind it is. Both branches call the record type's OWN reveal route —
   * an event row's switch flips the page's reveal flag, which is the same flag the page editor shows,
   * because there is one reveal state per record and the chronicle is a view of it, not a second copy.
   */
  const reveal = async (record: CodexChronicleRecord, revealed: boolean) => {
    /**
     * OWNER DECISION (2026-07-30): warn before a reveal hands players a date the GM has not published.
     *
     * Gated on `revealed` — HIDING a record discloses nothing, so it is never worth a dialog. The switch is
     * controlled by `record.revealedToPlayers`, which nothing here mutates, so a cancelled warning leaves it
     * visibly off rather than showing a reveal that did not happen.
     *
     * Only the chronicle warns, and only about ITS records. A page carries an in-world date solely because
     * the GM typed one in the page editor, so revealing it discloses a date they chose deliberately; these
     * six kinds auto-date at the prep clock without being asked, which is the whole reason this exists.
     */
    if (revealed && revealWarn && revealAheadOfPlayers(record, calendar)) {
      const dated = record.inWorldLabel ?? (record.inWorldDate && calendar ? formatWorldDate(calendar, record.inWorldDate) : "a later date");
      const seen = calendar?.publishedDate && calendar ? formatWorldDate(calendar, calendar.publishedDate) : "no date yet";
      const proceed = await confirm({
        title: "This is dated ahead of the players",
        body: `Players' date is still ${seen} — showing this tells them the story has reached ${dated}. Publish the date first if that's not what you want.`,
        confirmLabel: "Show anyway",
        suppress: { label: "Stop warning me about this", onChange: (suppressed) => { if (suppressed) { setRevealWarn(false); writeRevealWarn(false); } } }
      });
      if (!proceed) return;
    }
    if (record.kind === "event") await codexApi.revealPage(gmToken, record.id, revealed);
    else await journalApi.reveal(gmToken, record.id, revealed);
    await load();
  };
  const remove = async (record: CodexChronicleRecord) => { if (await confirm({ title: "Delete entry", body: "Delete this journal entry? This cannot be undone.", confirmLabel: "Delete", danger: true })) { await journalApi.remove(gmToken, record.id); await load(); } };

  // One vocabulary across the suite: hint with the tags already in use on pages AND on other entries, so
  // the GM reuses "session-recap" instead of inventing a near-duplicate. Free entry stays open (datalist).
  const tagSuggestions = useMemo(() => [...new Set([...pages.flatMap((page) => page.tags), ...records.flatMap((record) => record.tags)])].sort(), [pages, records]);

  // CT-12: the same records, grouped for whichever lens is on. Regrouping only — nothing is refetched and
  // nothing is written, so toggling can never change what the chronicle contains.
  /**
   * D10: the filtered set, then the groups. Filtering BEFORE grouping is what keeps an empty group from
   * rendering as a heading with nothing under it.
   */
  const allTags = useMemo(() => [...new Set(records.flatMap((record) => record.tags))].sort(), [records]);
  const filtered = useMemo(() => {
    const needle = textFilter.trim().toLowerCase();
    return records.filter((record) =>
      (!kindFilter || record.kind === kindFilter)
      && (!tagFilter || record.tags.includes(tagFilter))
      && (!needle || record.text.toLowerCase().includes(needle) || (record.gmText ?? "").toLowerCase().includes(needle) || (record.title ?? "").toLowerCase().includes(needle)));
  }, [records, kindFilter, tagFilter, textFilter]);
  const groups = useMemo(() => groupChronicle(filtered, lens, calendar), [filtered, lens, calendar]);

  // The world's "now": a readout + a Today marker placed in its year on the timeline. Since M11 this is
  // explicitly the GM's OWN clock — see the prep-clock row below for what the table is currently on.
  const now = calendar?.currentDate ?? null;
  const nowYear = now && calendar ? calendarYearOf(calendar, dateToInstant(calendar, now)) : null;
  const nowLabel = now && calendar ? formatWorldDate(calendar, now) : null;
  /**
   * O-1, the prep clock. Two values, and this is the only place both are on screen.
   *
   * The quiet state is the normal state: while the two agree there is nothing here at all — no chip, no
   * button, no "in sync" badge — because a GM who has never run ahead of the party should not have to
   * learn a second clock exists. It appears the moment they diverge, which is the moment it matters.
   */
  const publishedLabel = calendar?.publishedDate ? formatWorldDate(calendar, calendar.publishedDate) : null;
  const clockDiverged = calendar !== null && !sameInWorldDate(calendar.currentDate, calendar.publishedDate);
  /** The composer's own preview of what logging this downtime would later propose (O-3, stated up front). */
  const composerProposal = draft.kind === "downtime" && calendar
    ? downtimeProposedDate(calendar, Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0))))
    : null;
  const hasText = draft.playerText.trim() !== "" || draft.gmText.trim() !== "";
  /**
   * What each shape needs before it can be written. A deadline needs its date (the store rejects one
   * without it); downtime can stand on its who/activity alone, because the payload IS the record for a
   * downtime that nobody has written prose about yet.
   */
  /**
   * A deadline needs its date on the EDIT path too, not only on create.
   *
   * The store rejects an edit that clears it, but a disabled button is a better way to learn that a field
   * is not optional than a save that fails. The create path guarded this from the start; the edit path did
   * not, and clearing the Year field on an existing deadline produced a row that says "Deadline -
   * Approaching" forever and can never fire.
   */
  const needsDate = editingId ? editingKind === "deadline" : draft.kind === "deadline";
  const canSubmit = (editingId || draft.kind === "entry"
    ? hasText
    : draft.kind === "deadline"
    ? hasText && draft.dateYear.trim() !== ""
    // CT-8: a milestone stands on its LEVEL alone. "The party reached 5" is the whole record; the prose
    // is optional colour, exactly as a downtime's is, and requiring text would make the one field that
    // actually carries the record optional and the decoration mandatory.
    : draft.kind === "milestone"
    ? draft.level.trim() !== ""
    : hasText || draft.who.trim() !== "" || draft.activity.trim() !== "")
    && (!needsDate || draft.dateYear.trim() !== "");

  return (
    <div className="codex-journal">
      <Panel accent="cyan" className="codex-composer">
        {/* M11: which shape of record this is. Hidden while editing — a record's kind is fixed once it is
            written, and there is no route that changes one. `SegmentedControl` is the `@vtt/ui` primitive
            (R9) and carries its own 44px floor; the labels come from the chronicle's own kind vocabulary. */}
        {!editingId && (
          <div className="codex-composer-kind">
            <SegmentedControl ariaLabel="What to write" value={draft.kind} onChange={(next) => set({ kind: next as ComposerKind })}
              options={COMPOSER_KINDS.map((id) => ({ value: id, label: CHRONICLE_KIND_META[id].label }))} />
          </div>
        )}
        <div className="codex-composer-head">
          <strong>{editingId ? "Edit entry" : COMPOSER_COPY[draft.kind].heading}</strong>
          {editingId && stashedDraft && <span className="codex-entry-when">Your unsaved entry is kept — it returns when you finish here.</span>}
          <div className="codex-composer-head-actions">
            {nowLabel && <span className="codex-now-chip" title="Your own clock — what a new record is dated at">Your date: {nowLabel}</span>}
            {nowLabel && <GmOnlyTag />}
            <Button variant="ghost" size="sm" onClick={() => (onOpenCalendar ? onOpenCalendar() : setCalendarOpen(true))}>Calendar</Button>
            {editingId && <Button variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>}
          </div>
        </div>
        {/* O-1: what the TABLE is currently on, and the one control that changes it. Rendered only while
            the two clocks disagree (see `clockDiverged`). §4: `Button` at its default size is route 1 —
            it grows the paint to 44px and has no `::after` at all — which is what this row needs, sitting
            as it does directly above the composer's own stack of fields. */}
        {clockDiverged && (
          <div className="codex-prepclock">
            <span className="codex-prepclock-label">Players' date:</span>
            <span className="codex-now-chip">{publishedLabel ?? "not shared yet"}</span>
            {/* SECONDARY here, primary on the Calendar. §5 allows one primary action per view, and on the
                Journal that is the composer's own submit. */}
            <Button variant="secondary" onClick={publishDate}>Publish the date</Button>
            {/* The way BACK from "Stop warning me about this". It lives here rather than in a settings screen
                because this row is the only place both clocks are on screen, and it renders exactly when the
                warning would have mattered — so the GM meets the switch at the moment they want it, instead
                of having to remember which dialog they dismissed. Absent while the warning is on: nothing to
                offer a GM who never turned it off. */}
            {/* §4 ROUTE 1, like `Publish the date` beside it and for the row's stated reason: this row sits
                directly above the composer's stack of fields, so a `size="sm"` control here would meet the
                floor through `.tap-target`'s ::after — a 44px box centred on 32px of paint, overhanging 6px
                into the first Textarea's top edge. Measured at 176x32 paint before this was corrected.
                Default size grows the paint itself and carries no ::after at all. */}
            {!revealWarn && (
              <Button variant="ghost" onClick={() => { setRevealWarn(true); writeRevealWarn(true); }}>Warn me again before showing an entry</Button>
            )}
          </div>
        )}
        {/* D13: the SAME writing surface a page body gets, so `[[links]]` typed into a journal entry
            autocomplete and join the connection graph instead of silently doing nothing. */}
        <Field label={COMPOSER_COPY[draft.kind].textLabel} htmlFor="j-player">
          <CodexEditor id="j-player" token={gmToken} value={draft.playerText} onChange={(playerText) => set({ playerText })}
            ariaLabel={COMPOSER_COPY[draft.kind].textLabel} placeholder={COMPOSER_COPY[draft.kind].textPlaceholder}
            pages={shellPages} onNavigate={(target) => { const match = shellPages.find((page) => page.title.toLowerCase() === target.trim().toLowerCase()); if (match) onOpenPage(match.id); }} rows={5} />
        </Field>
        <Field label={<span className="codex-composer-gm-label">GM-only notes <GmOnlyTag /></span>} htmlFor="j-gm">
          <CodexEditor id="j-gm" token={gmToken} value={draft.gmText} onChange={(gmText) => set({ gmText })}
            ariaLabel="GM-only notes" placeholder="Notes hidden from players…"
            pages={shellPages} onNavigate={(target) => { const match = shellPages.find((page) => page.title.toLowerCase() === target.trim().toLowerCase()); if (match) onOpenPage(match.id); }} gmLayer rows={4} />
        </Field>
        <div className="codex-composer-meta">
          {/* D9: a session is chosen by RECORD, not by typing a number. Renumbering then relabels every
              entry with no journal write at all, and a hidden session's number can no longer leak. */}
          <Field label="Session" htmlFor="j-session">
            <Select id="j-session" value={draft.sessionId} onChange={(event) => set({ sessionId: event.target.value })}>
              <option value="">— none —</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>{sessionTitle(session)}{session.id === activeSessionId ? " (active)" : ""}</option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="j-year"><Input id="j-year" type="number" inputMode="numeric" value={draft.dateYear} placeholder="1492" onChange={(event) => set({ dateYear: event.target.value })} /></Field>
          <Field label="Month" htmlFor="j-month"><Select id="j-month" value={draft.dateMonth} disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateMonth: event.target.value })}>{(calendar?.months ?? []).map((month, index) => <option key={index} value={String(index)}>{month.name}</option>)}</Select></Field>
          <Field label="Day" htmlFor="j-day"><Input id="j-day" type="number" inputMode="numeric" value={draft.dateDay} placeholder="1" disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateDay: event.target.value })} /></Field>
          <Field label="Attach to page" htmlFor="j-page">
            <Combobox id="j-page" options={pages.map((page) => ({ id: page.id, label: page.title }))} value={draft.attachPageId || null}
              onChange={(id) => set({ attachPageId: id ?? "" })} ariaLabel="Attach to page" placeholder="— none —" />
          </Field>
        </div>
        {/* A deadline's date is not optional metadata, it is half the record — so say so where the button
            will not arm, rather than letting the GM discover it as a save failure. */}
        {needsDate && !draft.dateYear.trim() && (
          <p className="codex-composer-hint">A deadline needs a date — that is what makes it fire when the campaign passes it.</p>
        )}
        {/* CT-10's payload. Its own row, sharing the meta row's column rules so the composer keeps one
            grid rather than growing a second layout for three more fields. */}
        {!editingId && draft.kind === "downtime" && (
          <>
            <div className="codex-composer-meta">
              <Field label="Who" htmlFor="j-who"><Input id="j-who" maxLength={DOWNTIME_TEXT_MAX} value={draft.who} placeholder="Aldric" onChange={(event) => set({ who: event.target.value })} /></Field>
              <Field label="Activity" htmlFor="j-activity"><Input id="j-activity" maxLength={DOWNTIME_TEXT_MAX} value={draft.activity} placeholder="Forging a blade" onChange={(event) => set({ activity: event.target.value })} /></Field>
              <Field label="Days" htmlFor="j-days"><Input id="j-days" type="number" inputMode="numeric" min={0} max={DOWNTIME_DAYS_MAX} value={draft.days} placeholder="7" onChange={(event) => set({ days: event.target.value })} /></Field>
            </div>
            {/* O-3 stated BEFORE the record exists, not only after: logging downtime proposes a date and
                changes nothing. Without this the "Confirm" that appears on the row afterwards would be
                the first the GM heard that the clock was involved at all. */}
            {composerProposal && calendar && (
              <p className="codex-composer-hint">Logging this proposes moving your date to {formatWorldDate(calendar, composerProposal)} — nothing moves until you confirm it on the record.</p>
            )}
          </>
        )}
        {/* CT-8's payload, on downtime's terms exactly: its own row sharing the meta row's column rules,
            so the composer keeps one grid rather than growing a third layout for two more fields. */}
        {!editingId && draft.kind === "milestone" && (
          <>
            <div className="codex-composer-meta">
              <Field label="Level reached" htmlFor="j-level">
                <Input id="j-level" type="number" inputMode="numeric" min={MILESTONE_LEVEL_MIN} max={MILESTONE_LEVEL_MAX}
                  value={draft.level} placeholder="5" onChange={(event) => set({ level: event.target.value })} />
              </Field>
              <Field label="Why" htmlFor="j-reason">
                <Input id="j-reason" maxLength={MILESTONE_REASON_MAX} value={draft.reason} placeholder="Cleared the Sunless Citadel"
                  onChange={(event) => set({ reason: event.target.value })} />
              </Field>
            </div>
            {/* CT-8 is level HISTORY, not a level tracker: nothing here computes XP, and the record does
                not change anyone's sheet. Said out loud so a GM does not go looking for the half that
                is deliberately absent. */}
            <p className="codex-composer-hint">A milestone records that the party reached a level, and when. It changes no character sheet and counts no XP — leave the date blank to record it at the campaign's current date.</p>
          </>
        )}
        {/* Its own full-width row rather than a cell in .codex-composer-meta: that row's `flex: 1 1 130px`
            columns would squeeze a wrapping chip cloud into a 130px gutter on a phone. The composer is
            also the edit surface, so this one control covers both the new-entry and the edit path. */}
        <Field label="Tags" htmlFor="j-tags">
          <TagInput id="j-tags" ariaLabel="Tags" placeholder="session-recap, downtime" values={draft.tags}
            onChange={(next) => set({ tags: next })}
            max={24} maxReachedReason="An entry may carry at most 24 tags."
            suggestions={tagSuggestions}
            /* DEFAULT slugify on purpose — it IS the server contract (`codex-store.ts` tags():
               /^[a-z0-9][a-z0-9-]*$/, which throws rather than sanitising). Overriding it here would
               let "Session Recap" through as a value the PATCH rejects with a generic save failure. */ />
        </Field>
        <div className="codex-composer-foot">
          {/* O-2 / P2: a deadline and a downtime hide by default exactly as an entry does, and are
              revealed by this same switch. There is no kind-specific visibility anywhere. */}
          <RevealSwitch revealed={draft.revealed} onChange={(revealed) => set({ revealed })} ariaLabel="Show this entry to players" />
          <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>{editingId ? "Save entry" : COMPOSER_COPY[draft.kind].submit}</Button>
        </div>
      </Panel>

      {error && <Alert tone="danger">{error}</Alert>}
      {/* Publishing's acknowledgement (see `publishDate`). `Notice` announces politely via `role="status"`,
          so it reaches a screen reader without interrupting; `error` above stays the assertive channel. */}
      <Notice notice={notice} />

      {/* CT-12: the lens toggle, and D10's in-place filters beside it. Above the timeline and outside
          the groups, because both govern all of them. Filter state lives in the URL, so a dashboard card
          can deep-link to "the Journal, deadlines only". Client-side over the records already fetched —
          the chronicle is one read and filtering it is not a second one. */}
      <div className="codex-timeline-lens">
        <SegmentedControl ariaLabel="Journal lens" value={lens} onChange={(next) => setLens(next as ChronicleLens)}
          options={CHRONICLE_LENSES.map((option) => ({ value: option.id, label: option.label }))} />
        <Select aria-label="Filter by kind" value={kindFilter ?? ""} onChange={(event) => onFilterChange?.({ kind: event.target.value || null })}>
          <option value="">All kinds</option>
          {CHRONICLE_FILTER_KINDS.map((kind) => <option key={kind} value={kind}>{CHRONICLE_KIND_META[kind].label}</option>)}
        </Select>
        <Input aria-label="Filter the journal" placeholder="Filter the journal…" value={textFilter}
          onChange={(event) => onFilterChange?.({ q: event.target.value || null })} />
        {allTags.length > 0 && (
          <Select aria-label="Filter by tag" value={tagFilter ?? ""} onChange={(event) => onFilterChange?.({ tag: event.target.value || null })}>
            <option value="">All tags</option>
            {allTags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
          </Select>
        )}
      </div>

      <div className="codex-timeline">
        {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
        {!loading && records.length === 0 && <p className="codex-list-empty">No journal entries yet.</p>}
        {!loading && records.length > 0 && filtered.length === 0 && <p className="codex-list-empty">Nothing in the Journal matches these filters.</p>}
        {groups.map((group) => {
          /**
           * M9: a session heading opens the session — but ONLY when a session record actually exists
           * for that number, and only under the session lens.
           *
           * Both halves matter. Under the date lens `group.key` is a calendar YEAR, so resolving it as
           * a session number would open session 1492. And M9 ships with **no backfill**, so most
           * numbered groups on an existing campaign have no record behind them: those must keep
           * rendering exactly as they render today rather than becoming buttons that 404. The heading
           * is only promoted to a control when there is something real on the other end of it.
           */
          const groupSession = lens === "session" && group.key !== "none" && onOpenSession
            ? sessionByNumber(sessions, Number(group.key))
            : null;
          return (
          <section key={group.key} className="codex-timeline-group">
            {groupSession
              /* §4 route 1 (grow the paint) — see `.codex-timeline-year.is-openable` in codex.css. */
              ? <button type="button" className="codex-timeline-year is-openable" onClick={() => onOpenSession!(groupSession.id)}>
                  {group.label}<span className="codex-timeline-year-open" aria-hidden="true">›</span>
                </button>
              : <div className="codex-timeline-year">{group.label}</div>}
            {/* The "Today" marker belongs to the in-world reading; under the session lens a calendar year
                is not what the groups mean, so placing it there would be an answer to a question nobody asked. */}
            {lens === "date" && nowYear !== null && group.key === String(nowYear) && <div className="codex-timeline-now">Today — {nowLabel}</div>}
            {group.records.map((record) => {
              // R2: ONE row shape for every record; the kind reads by icon + label, never by colour alone.
              const meta = CHRONICLE_KIND_META[record.kind];
              const isEvent = record.kind === "event";
              // M11: `fired` is the SERVER's derivation, read through the one client-side reader; the
              // payload is present only on a downtime. A record that is neither answers null/false and
              // renders exactly as it did before this milestone.
              const isDeadline = record.kind === "deadline";
              const fired = deadlineFired(record);
              // M12: every payload is opened through its own kind gate (`chronicle.ts`), so a record's
              // payload can only ever be rendered as the kind it actually is.
              const downtime = downtimeOf(record);
              const milestone = milestoneOf(record);
              const standing = standingOf(record);
              const questEvent = questEventOf(record);
              // The SERVER's proposed date, not a second local computation: Confirm says this date out
              // loud and then the server decides where the clock actually lands, so only one of the two
              // can be authoritative. `downtimeProposedDate` stays for the composer's preview, where no
              // record exists yet for the server to answer about.
              const proposed = downtime && !downtime.applied ? record.proposedDate : null;
              // OWNER DECISION (2026-07-30): say what the clock move would COST before the button that does
              // it. Counted against the whole chronicle, not this group — a deadline sitting in next year's
              // group is exactly the one the GM has forgotten about. Zero says nothing rather than "passes 0
              // deadlines", which would be noise on every downtime in a campaign that has none.
              const passing = proposed ? deadlinesPassedBy(records, calendar, proposed) : 0;
              return (
              <article key={`${record.kind}-${record.id}`} id={`codex-entry-${record.id}`} aria-current={record.id === focusedEntryId ? "true" : undefined}
                className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${isEvent ? " is-event" : ""}${isDeadline ? " is-deadline" : ""}${downtime ? " is-downtime" : ""}${record.id === focusedEntryId ? " is-focused" : ""}`}>
                <header className="codex-entry-head">
                  <div className="codex-entry-meta">
                    <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {/* CT-5: a deadline's state is a WORD beside its kind, never the row's colour — the
                        badge tone is a scanning aid and nothing is said by it alone. */}
                    {isDeadline && <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>}
                    <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
                    {/* D9 / ruling R2: render whatever the row carries, never a label built from a number.
                        `sessionId` present → a link. `sessionId` null with a number → a deleted-but-once-
                        revealed session's bare label, with nothing to navigate to. Both are real states. */}
                    {record.sessionId && onOpenSession
                      ? <button type="button" className="codex-entry-sessionlink" onClick={() => onOpenSession(record.sessionId!)}>
                          {record.sessionNumber !== null ? `Session ${record.sessionNumber}` : "This session"}
                        </button>
                      : record.sessionNumber !== null && <span className="codex-entry-when">Session {record.sessionNumber}</span>}
                  </div>
                  <RevealSwitch revealed={record.revealedToPlayers} onChange={(revealed) => reveal(record, revealed)} ariaLabel={isEvent ? "Show this event to players" : "Show this entry to players"} />
                </header>
                {/* An event page has a name; a journal entry does not. Same slot either way, so the row
                    shape does not change - it is simply empty for the kind that has nothing to put in it. */}
                {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
                {record.text.trim() && <div className="codex-entry-body"><CodexMarkdown text={record.text} token={gmToken} onNavigate={(target) => { const page = pages.find((candidate) => candidate.title.toLowerCase() === target.toLowerCase()); if (page) onOpenPage(page.id); }} /></div>}
                {record.gmText && <div className="codex-entry-gm"><GmOnlyTag /><CodexMarkdown text={record.gmText} token={gmToken} /></div>}
                {/* Read-only on purpose. An entry's tags are otherwise invisible until you open Edit, but
                    making them clickable would be the cross-type tag navigation that belongs to a later
                    milestone — clicking a tag still filters Pages and nothing else. */}
                {record.tags.length > 0 && (
                  <ul className="codex-entry-tags" aria-label="Entry tags">
                    {record.tags.map((tag) => <li key={tag}><Badge>{tag}</Badge></li>)}
                  </ul>
                )}
                {/* CT-10 / O-3: what this downtime was, and — until the GM confirms it — what confirming
                    would do, said in full BEFORE the button that does it. The button is deliberately the
                    only thing on this row that moves the campaign clock, and it exists only while the
                    record is unapplied: an applied downtime has no second confirmation to give. */}
                {downtime && (
                  <div className="codex-downtime">
                    <p className="codex-downtime-what">{downtimeSummaryLabel(downtime)}</p>
                    {downtime.applied
                      ? <p className="codex-downtime-state">Your date has already been moved for this downtime.</p>
                      : proposed && calendar
                      ? <div className="codex-downtime-apply">
                          <span className="codex-downtime-proposal">Move your date to {formatWorldDate(calendar, proposed)}{passing > 0 ? ` — this passes ${passing} ${passing === 1 ? "deadline" : "deadlines"}.` : ""}</span>
                          {/* §4 route 1: `Button` at its default size grows its own paint to 44px and
                              has no `::after`, which is what a control stacked above the row's footer
                              buttons needs — a route-2 overhang here would reach into their hit areas.
                              SECONDARY, not primary: the row already states the consequence in words, and
                              the view's one primary action is the composer's own submit (§5). */}
                          <Button variant="secondary" onClick={() => applyDowntime(record)}>Confirm</Button>
                        </div>
                      : <p className="codex-downtime-state">Set your date on the Calendar to move the clock from this downtime.</p>}
                  </div>
                )}
                {/* CT-8 / CT-6: what the record actually says, beyond its prose. Both are read-only — a
                    milestone's level and a standing change's delta are history, and there is no route
                    that rewrites a payload. A standing row names its faction where the page is known;
                    where it is not, the shared label says "A faction" rather than inventing a name. */}
                {milestone && <p className="codex-downtime-what">{milestoneSummaryLabel(milestone)}</p>}
                {/* D11: a quest-history row carries no prose at all, so its whole sentence is this — the
                    quest's title resolved against the shell's quest feed where we have one. */}
                {questEvent && <p className="codex-downtime-what">{questEventLabel(questEvent, null)}</p>}
                {standing && <p className="codex-downtime-what">{standingChangeLabel(standing, pages.find((page) => page.id === standing.factionPageId)?.title ?? null)}</p>}
                {/* CI-6: the entry's two return edges sit beside the page edge it already had, so an
                    entry reads as "here is what happened, here is where, here is the fight itself".
                    §4: `Button size="sm"` is a `@vtt/ui` primitive and carries the 44px floor itself
                    (route 2, `.nh-btn--sm`) — no new control and no new floor to argue about.
                    An EVENT row's actions are deliberately just "Open page": the record is a wiki page,
                    and editing or deleting it from a timeline row would be a second place to do both. */}
                <footer className="codex-entry-foot">
                  {isEvent && <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.id)}>Open page</Button>}
                  {!isEvent && record.attachPageId && <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.attachPageId!)}>Open page</Button>}
                  {record.attachMarkerId && onOpenMarker &&
                    <Button variant="ghost" size="sm" onClick={() => onOpenMarker(record.attachMarkerId!)}>Open pin</Button>}
                  {record.kind === "combat" && record.sourceEncounterId !== null && onOpenReplay &&
                    <Button variant="ghost" size="sm" onClick={() => onOpenReplay(record.sourceEncounterId!)}>Open replay</Button>}
                  {!isEvent && <Button variant="ghost" size="sm" onClick={() => edit(record)}>Edit</Button>}
                  {!isEvent && <Button variant="ghost" size="sm" onClick={() => remove(record)}>Delete</Button>}
                </footer>
              </article>
              );
            })}
          </section>
          );
        })}
      </div>

      {/* The editor answers with the calendar the PUT echoed, which carries the world's shape and the
          GM's clock but says nothing about what the table is on — so the whole GM read is taken again
          rather than trusted, or moving the clock here would leave the prep-clock row above stale. */}
      {calendarOpen && calendar && <CalendarEditor gmToken={gmToken} calendar={calendar} onSaved={() => { void load(); }} onClose={() => setCalendarOpen(false)} />}
      {confirmDialog}
    </div>
  );
}
