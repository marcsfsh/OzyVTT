import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Combobox,
  Field,
  GmOnlyTag,
  IconButton,
  IconX,
  Input,
  Panel,
  RevealSwitch,
  SegmentedControl,
  Select,
  TagInput
} from "@vtt/ui";
import {
  formatWorldDate,
  type CodexChronicleKind,
  type CodexChronicleRecord,
  type CodexPageSummary,
  type CodexSession,
  type GmCodexCalendar
} from "@vtt/domain";
import { journalApi } from "./api";
import { CHRONICLE_KIND_META, downtimeProposedDate, sameInWorldDate } from "./chronicle";
import { CodexEditor } from "./CodexEditor";
import { InWorldDateFields, dateDraftOf, dateOfDraft, type DateDraft } from "./InWorldDateFields";
import { sessionTitle } from "./sessions";
import { BODY_LAYER, TwoLayerBodyTabs, type BodyLayer } from "./TwoLayerBodyTabs";

/** The Journal's composer: writes journal entries and edits them. An `event` row is a page, edited there. */
/**
 * The composer's record shapes, all one journal row. `standing` records are written only by the standing
 * card, together with the value change, so they are not offered here.
 */
const COMPOSER_KINDS = ["entry", "deadline", "downtime", "milestone"] as const;
type ComposerKind = (typeof COMPOSER_KINDS)[number];
/** Per-kind copy. Kind labels come from `CHRONICLE_KIND_META`; the layer names come from `TwoLayerBodyTabs`. */
const COMPOSER_COPY: Readonly<
  Record<ComposerKind, Readonly<{ heading: string; textPlaceholder: string; submit: string }>>
> = {
  entry: { heading: "New journal entry", textPlaceholder: "What players know about this", submit: "Add entry" },
  deadline: { heading: "New deadline", textPlaceholder: "The duke's ultimatum expires", submit: "Add deadline" },
  downtime: { heading: "New downtime", textPlaceholder: "How the time was spent", submit: "Log downtime" },
  milestone: {
    heading: "New milestone",
    textPlaceholder: "What players know about this level",
    submit: "Record milestone"
  }
};
/** The server's bounds, so a slip is a disabled field rather than a 400. */
const DOWNTIME_TEXT_MAX = 120;
const DOWNTIME_DAYS_MAX = 3650;
/** The 5e level range. No XP arithmetic. */
const MILESTONE_LEVEL_MIN = 1;
const MILESTONE_LEVEL_MAX = 20;
const MILESTONE_REASON_MAX = 120;

type Draft = DateDraft & {
  kind: ComposerKind;
  playerText: string;
  gmText: string;
  sessionId: string;
  attachPageId: string;
  revealed: boolean;
  tags: readonly string[];
  who: string;
  activity: string;
  days: string;
  level: string;
  reason: string;
};
const EMPTY: Draft = {
  kind: "entry",
  playerText: "",
  gmText: "",
  sessionId: "",
  dateYear: "",
  dateMonth: "0",
  dateDay: "",
  attachPageId: "",
  revealed: false,
  tags: [],
  who: "",
  activity: "",
  days: "",
  level: "",
  reason: ""
};
const DRAFT_KEY = "codex-journal-draft";
const DETAILS_KEY = "codex-journal-details";
const DETAILS_ID = "codex-journal-details";

const hasContent = (draft: Draft) =>
  Boolean(
    draft.playerText.trim() ||
    draft.gmText.trim() ||
    draft.who.trim() ||
    draft.activity.trim() ||
    draft.level.trim() ||
    draft.reason.trim()
  );

/** Older drafts may lack `tags` or `kind`; fall back to safe defaults. */
function readDraft(): Draft {
  try {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (!saved) return EMPTY;
    const parsed = JSON.parse(saved) as Partial<Draft>;
    return {
      ...EMPTY,
      ...parsed,
      kind: COMPOSER_KINDS.includes(parsed.kind as ComposerKind) ? (parsed.kind as ComposerKind) : "entry",
      tags: Array.isArray(parsed.tags) ? parsed.tags : []
    };
  } catch {
    return EMPTY;
  }
}

/**
 * The composer's draft. A new entry survives tab switches, and editing a record sets it aside rather than
 * losing it, so Edit never destroys it.
 */
export function useJournalDraft() {
  const [draft, setDraft] = useState<Draft>(readDraft);
  /** The record being edited. Its kind is kept so a deadline's date cannot be cleared. */
  const [editing, setEditing] = useState<Readonly<{ id: string; kind: CodexChronicleKind }> | null>(null);
  const [stashed, setStashed] = useState<Draft | null>(null);
  // While editing, the stash is what's worth keeping.
  useEffect(() => {
    try {
      const pending = stashed ?? (editing ? null : draft);
      if (pending && hasContent(pending)) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(pending));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* private mode - fine */
    }
  }, [draft, editing, stashed]);

  const set = useCallback((patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch })), []);
  const edit = (record: CodexChronicleRecord) => {
    if (!editing && hasContent(draft)) setStashed(draft);
    setEditing({ id: record.id, kind: record.kind });
    setDraft({
      // Never read on the edit path: a record's kind is fixed once written.
      kind: "entry",
      playerText: record.text,
      gmText: record.gmText ?? "",
      sessionId: record.sessionId ?? "",
      // The raw date the GM typed, still valid if the calendar changed.
      ...dateDraftOf(record.inWorldDate),
      attachPageId: record.attachPageId ?? "",
      revealed: record.revealedToPlayers,
      tags: record.tags,
      // Payloads have no update route, so they are not editable here.
      who: "",
      activity: "",
      days: "",
      level: "",
      reason: ""
    });
  };
  /** After an edit, the stashed new entry returns; after a create, the composer stays on the same kind. */
  const finish = () => {
    setDraft(editing ? (stashed ?? EMPTY) : { ...EMPTY, kind: draft.kind });
    setStashed(null);
    setEditing(null);
  };
  const cancel = () => {
    setEditing(null);
    setDraft(stashed ?? EMPTY);
    setStashed(null);
  };
  return { draft, set, editing, stashed, edit, finish, cancel };
}

export type JournalDraft = ReturnType<typeof useJournalDraft>;

const downtimeDays = (draft: Draft) => Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0)));

export function JournalComposer({
  gmToken,
  composer,
  calendar,
  sessions,
  activeSessionId,
  pages,
  editorPages,
  tagSuggestions,
  revealWarn,
  onWarnAgain,
  onOpenPage,
  onOpenCalendar,
  onPublish,
  onSaved,
  onError
}: Readonly<{
  gmToken: string;
  composer: JournalDraft;
  calendar: GmCodexCalendar | null;
  sessions: readonly CodexSession[];
  activeSessionId: string | null;
  /** What an entry can be attached to. */
  pages: readonly CodexPageSummary[];
  /** The shell's page feed, for `[[` autocomplete. */
  editorPages: readonly CodexPageSummary[];
  tagSuggestions: readonly string[];
  /** Off means the GM asked to stop the reveal-ahead warning; the composer offers the way back. */
  revealWarn: boolean;
  onWarnAgain: () => void;
  onOpenPage: (pageId: string) => void;
  onOpenCalendar: () => void;
  /** Copies the GM's clock to the players' clock. */
  onPublish: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}>) {
  const { draft, set, editing, stashed, finish, cancel } = composer;
  const [bodyTab, setBodyTab] = useState<BodyLayer>("player");
  const detailsRef = useRef<HTMLElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      return localStorage.getItem(DETAILS_KEY) === "open";
    } catch {
      return false;
    }
  });
  const showDetails = useCallback((open: boolean) => {
    setDetailsOpen(open);
    try {
      localStorage.setItem(DETAILS_KEY, open ? "open" : "closed");
    } catch {
      /* private mode - fine */
    }
  }, []);
  useEffect(() => {
    if (detailsOpen) detailsRef.current?.focus();
  }, [detailsOpen]);

  const submit = async () => {
    const inWorldDate = dateOfDraft(draft);
    const input = {
      playerText: draft.playerText,
      gmText: draft.gmText.trim() || null,
      revealedToPlayers: draft.revealed,
      attachPageId: draft.attachPageId || null,
      /**
       * Sessions are linked by id; `sessionNumber` is a 400 on writes. Send an explicit null for "None",
       * since omitting the key on create would auto-file under the active session.
       */
      sessionId: draft.sessionId ? draft.sessionId : null,
      inWorldDate,
      // Always sent: omitting `tags` on an edit would keep the old ones, so clearing needs `[]`.
      tags: draft.tags
    };
    try {
      // The edit path ignores kind; a record's kind is fixed once written.
      if (editing) await journalApi.update(gmToken, editing.id, input);
      else if (draft.kind === "deadline") {
        // Also guarded by the disabled button.
        if (!inWorldDate) {
          onError("A deadline needs a date. Set the year, month and day above.");
          return;
        }
        await journalApi.createDeadline(gmToken, { ...input, inWorldDate });
      } else if (draft.kind === "downtime") {
        // Creates the record only; the clock moves when the GM confirms on the row.
        await journalApi.createDowntime(gmToken, {
          ...input,
          downtime: {
            who: draft.who.trim().slice(0, DOWNTIME_TEXT_MAX),
            activity: draft.activity.trim().slice(0, DOWNTIME_TEXT_MAX),
            days: downtimeDays(draft)
          }
        });
      } else if (draft.kind === "milestone") {
        // Clamped to the 5e level range, matching the server.
        await journalApi.createMilestone(gmToken, {
          ...input,
          milestone: {
            level: Math.min(
              MILESTONE_LEVEL_MAX,
              Math.max(MILESTONE_LEVEL_MIN, Math.trunc(Number(draft.level) || MILESTONE_LEVEL_MIN))
            ),
            reason: draft.reason.trim().slice(0, MILESTONE_REASON_MAX)
          }
        });
      } else await journalApi.create(gmToken, input);
      finish();
      await onSaved();
    } catch (submitError) {
      onError(submitError instanceof Error ? submitError.message : "Could not save the entry.");
    }
  };

  const followLink = (target: string) => {
    const match = editorPages.find((page) => page.title.toLowerCase() === target.trim().toLowerCase());
    if (match) onOpenPage(match.id);
  };
  // The GM's clock; the prep-clock row shows what players are on.
  const nowLabel = calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null;
  /** The prep-clock row appears only while the GM's clock and the published clock differ. */
  const publishedLabel = calendar?.publishedDate ? formatWorldDate(calendar, calendar.publishedDate) : null;
  const clockDiverged = calendar !== null && !sameInWorldDate(calendar.currentDate, calendar.publishedDate);
  /** The composer's preview of the date this downtime would propose. */
  const composerProposal =
    draft.kind === "downtime" && calendar ? downtimeProposedDate(calendar, downtimeDays(draft)) : null;
  const hasText = draft.playerText.trim() !== "" || draft.gmText.trim() !== "";
  /** A deadline needs its date on edit as well as create; a dateless deadline can never fire. */
  const needsDate = editing ? editing.kind === "deadline" : draft.kind === "deadline";
  const canSubmit =
    (editing || draft.kind === "entry"
      ? hasText
      : draft.kind === "deadline"
        ? hasText && draft.dateYear.trim() !== ""
        : // A milestone needs only its level; prose is optional.
          draft.kind === "milestone"
          ? draft.level.trim() !== ""
          : hasText || draft.who.trim() !== "" || draft.activity.trim() !== "") &&
    (!needsDate || draft.dateYear.trim() !== "");

  return (
    <Panel accent="cyan" className="codex-composer">
      {/* Hidden while editing: a record's kind is fixed once written. */}
      {!editing && (
        <div className="codex-composer-kind">
          <SegmentedControl
            ariaLabel="What to write"
            value={draft.kind}
            onChange={(next) => set({ kind: next as ComposerKind })}
            options={COMPOSER_KINDS.map((id) => ({ value: id, label: CHRONICLE_KIND_META[id].label }))}
          />
        </div>
      )}
      <div className="codex-composer-head">
        <strong>{editing ? "Edit entry" : COMPOSER_COPY[draft.kind].heading}</strong>
        {editing && stashed && (
          <span className="codex-entry-when">Your unsaved entry is kept. It returns when you finish here.</span>
        )}
        <div className="codex-composer-head-actions">
          {nowLabel && (
            <span className="codex-now-chip" title="The date a new record is given">
              Your date: {nowLabel}
            </span>
          )}
          {nowLabel && <GmOnlyTag />}
          <Button variant="ghost" size="sm" onClick={onOpenCalendar}>
            Calendar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={detailsOpen}
            aria-controls={DETAILS_ID}
            onClick={() => showDetails(!detailsOpen)}
          >
            Details
          </Button>
          {editing && (
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
      {/* Rendered only while the two clocks differ. Default-size buttons here: this row sits directly above
          the composer's fields, where a `size="sm"` control's 44px ::after hit area would overlap them. */}
      {clockDiverged && (
        <div className="codex-prepclock">
          <span className="codex-prepclock-label">Players' date:</span>
          <span className="codex-now-chip">{publishedLabel ?? "not shared yet"}</span>
          <Button variant="secondary" onClick={onPublish}>
            Publish the date
          </Button>
          {/* The way back from "Stop warning me about this". */}
          {!revealWarn && (
            <Button variant="ghost" onClick={onWarnAgain}>
              Warn me again before showing an entry
            </Button>
          )}
        </div>
      )}
      <TwoLayerBodyTabs value={bodyTab} onChange={setBodyTab}>
        {bodyTab === "gm" && <GmOnlyTag />}
      </TwoLayerBodyTabs>
      {/* The same editor a page body uses, so `[[links]]` autocomplete and join the connection graph. */}
      {bodyTab === "player" ? (
        <CodexEditor
          id="j-player"
          token={gmToken}
          value={draft.playerText}
          onChange={(playerText) => set({ playerText })}
          ariaLabel={BODY_LAYER.player.label}
          placeholder={COMPOSER_COPY[draft.kind].textPlaceholder}
          pages={editorPages}
          onNavigate={followLink}
          rows={7}
        />
      ) : (
        <CodexEditor
          id="j-gm"
          token={gmToken}
          value={draft.gmText}
          onChange={(gmText) => set({ gmText })}
          ariaLabel={BODY_LAYER.gm.label}
          placeholder="Notes hidden from players"
          pages={editorPages}
          onNavigate={followLink}
          gmLayer
          rows={7}
        />
      )}
      {/* The date is in Details, so the hint says where to set it. */}
      {needsDate && !draft.dateYear.trim() && (
        <p className="codex-composer-hint">
          A deadline needs a date. Set the year, month and day under Details. It fires when your date passes it.
        </p>
      )}
      {!editing && draft.kind === "downtime" && (
        <>
          <div className="codex-composer-meta">
            <Field label="Who" htmlFor="j-who">
              <Input
                id="j-who"
                maxLength={DOWNTIME_TEXT_MAX}
                value={draft.who}
                placeholder="Aldric"
                onChange={(event) => set({ who: event.target.value })}
              />
            </Field>
            <Field label="Activity" htmlFor="j-activity">
              <Input
                id="j-activity"
                maxLength={DOWNTIME_TEXT_MAX}
                value={draft.activity}
                placeholder="Forging a blade"
                onChange={(event) => set({ activity: event.target.value })}
              />
            </Field>
            <Field label="Days" htmlFor="j-days">
              <Input
                id="j-days"
                type="number"
                inputMode="numeric"
                min={0}
                max={DOWNTIME_DAYS_MAX}
                value={draft.days}
                placeholder="7"
                onChange={(event) => set({ days: event.target.value })}
              />
            </Field>
          </div>
          {/* Say up front that logging proposes a date and moves nothing. */}
          {composerProposal && calendar && (
            <p className="codex-composer-hint">
              Logging this proposes moving your date to {formatWorldDate(calendar, composerProposal)}. Nothing moves
              until you confirm it on the record.
            </p>
          )}
        </>
      )}
      {!editing && draft.kind === "milestone" && (
        <>
          <div className="codex-composer-meta">
            <Field label="Level reached" htmlFor="j-level">
              <Input
                id="j-level"
                type="number"
                inputMode="numeric"
                min={MILESTONE_LEVEL_MIN}
                max={MILESTONE_LEVEL_MAX}
                value={draft.level}
                placeholder="5"
                onChange={(event) => set({ level: event.target.value })}
              />
            </Field>
            <Field label="Why" htmlFor="j-reason">
              <Input
                id="j-reason"
                maxLength={MILESTONE_REASON_MAX}
                value={draft.reason}
                placeholder="Cleared the Sunless Citadel"
                onChange={(event) => set({ reason: event.target.value })}
              />
            </Field>
          </div>
          <p className="codex-composer-hint">
            A milestone records the level the party reached and when. It changes no character sheet and counts no XP.
            Leave the date blank to record it at your current date.
          </p>
        </>
      )}
      <div className="codex-composer-foot">
        <RevealSwitch
          revealed={draft.revealed}
          onChange={(revealed) => set({ revealed })}
          ariaLabel="Show this entry to players"
        />
        <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
          {editing ? "Save entry" : COMPOSER_COPY[draft.kind].submit}
        </Button>
      </div>

      {/* Filing details: the same panel as pages and quests, scoped to the composer rather than the viewport. */}
      {detailsOpen && (
        <aside
          id={DETAILS_ID}
          className="codex-editor-context scroll-y"
          aria-label="Entry details"
          tabIndex={-1}
          ref={detailsRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              showDetails(false);
            }
          }}
        >
          <div className="codex-context-head">
            <h3 className="codex-backlinks-title">Entry details</h3>
            <IconButton label="Close entry details" size="sm" onClick={() => showDetails(false)}>
              <IconX />
            </IconButton>
          </div>
          {/* Chosen by record, so renumbering a session relabels entries without a journal write. */}
          <Field label="Session" htmlFor="j-session">
            <Select id="j-session" value={draft.sessionId} onChange={(event) => set({ sessionId: event.target.value })}>
              <option value="">None</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {sessionTitle(session)}
                  {session.id === activeSessionId ? " (active)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="codex-composer-meta">
            <InWorldDateFields idPrefix="j" draft={draft} months={calendar?.months ?? []} onChange={set} />
          </div>
          <Field label="Attach to page" htmlFor="j-page">
            <Combobox
              id="j-page"
              options={pages.map((page) => ({ id: page.id, label: page.title }))}
              value={draft.attachPageId || null}
              onChange={(id) => set({ attachPageId: id ?? "" })}
              ariaLabel="Attach to page"
              placeholder="None"
            />
          </Field>
          <Field label="Tags" htmlFor="j-tags">
            <TagInput
              id="j-tags"
              ariaLabel="Tags"
              placeholder="session-recap, downtime"
              values={draft.tags}
              onChange={(next) => set({ tags: next })}
              max={24}
              maxReachedReason="An entry may carry at most 24 tags."
              suggestions={tagSuggestions}
              /* Keep the default slugify: it matches the server's tag rule, which rejects rather than sanitises. */
            />
          </Field>
        </aside>
      )}
    </Panel>
  );
}
