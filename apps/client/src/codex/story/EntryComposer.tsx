import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Combobox,
  Field,
  Input,
  Modal,
  SegmentedControl,
  Select,
  TagInput,
  FieldAudienceToggle
} from "@vtt/ui";
import {
  formatWorldDate,
  type CodexChronicleRecord,
  type CodexPageSummary,
  type CodexSession,
  type GmCodexCalendar
} from "@vtt/domain";
import { journalApi } from "../api";
import { ARCHIVED_META, charactersFor, type ArchivableActor } from "../characters";
import { CHRONICLE_KIND_META, downtimeProposedDate } from "../chronicle";
import { CodexEditor } from "../CodexEditor";
import { EntityIcon } from "../icons";
import { InWorldDateFields, dateDraftOf, dateOfDraft, type DateDraft } from "../InWorldDateFields";
import { sessionTitle } from "../sessions";
import { newId } from "../../lib/ids";

/** What the chronicle's composer writes. Standing is written with the standing value, so it isn't offered here. */
export const COMPOSER_KINDS = ["entry", "deadline", "downtime", "milestone"] as const;
export type ComposerKind = (typeof COMPOSER_KINDS)[number];

const SUBMIT: Readonly<Record<ComposerKind, string>> = {
  entry: "Add entry",
  deadline: "Add deadline",
  downtime: "Log downtime",
  milestone: "Record milestone"
};
const PLACEHOLDER: Readonly<Record<ComposerKind, string>> = {
  entry: "What happened, as players read it",
  deadline: "The council votes on the harbour tax",
  downtime: "How the time was spent",
  milestone: "What the party did to reach this level"
};
/** The server's bounds, so a slip is a disabled button and never a 400. */
const DOWNTIME_TEXT_MAX = 120;
const DOWNTIME_DAYS_MAX = 3650;
const LEVEL_MIN = 1;
const LEVEL_MAX = 20;
const REASON_MAX = 120;

type Draft = DateDraft &
  Readonly<{
    kind: ComposerKind;
    text: string;
    hidden: string;
    sessionId: string;
    attachPageId: string;
    revealed: boolean;
    tags: readonly string[];
    whoValue: string | null;
    activity: string;
    days: string;
    level: string;
    reason: string;
  }>;

/**
 * Add to the chronicle: an entry, a deadline, downtime or a milestone, in one composer. Text players read and a
 * hidden note are two boxes, each said in words. A new record is filed under the active session and dated at the
 * GM's date unless the GM says otherwise. Editing takes the same form over one record, whose kind is fixed.
 */
export function EntryComposer({
  gmToken,
  open,
  editing,
  calendar,
  sessions,
  activeSessionId,
  pages,
  actors = [],
  tagSuggestions,
  initialKind = "entry",
  onClose,
  onSaved,
  onFollow
}: Readonly<{
  gmToken: string;
  open: boolean;
  /** The record being edited; null writes a new one. */
  editing: CodexChronicleRecord | null;
  calendar: GmCodexCalendar | null;
  sessions: readonly CodexSession[];
  activeSessionId: string | null;
  pages: readonly CodexPageSummary[];
  actors?: readonly ArchivableActor[];
  tagSuggestions: readonly string[];
  initialKind?: ComposerKind;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** Follows a `[[link]]` in the text: to the page of that title, or to create it. */
  onFollow: (target: string) => void;
}>) {
  const fresh = (): Draft => ({
    kind: initialKind,
    text: "",
    hidden: "",
    sessionId: activeSessionId ?? "",
    attachPageId: "",
    revealed: false,
    tags: [],
    whoValue: null,
    activity: "",
    days: "",
    level: "",
    reason: "",
    // A new entry is dated at the GM's date; a deadline's date is when it fires, so it starts blank.
    ...dateDraftOf(initialKind === "entry" ? (calendar?.currentDate ?? null) : null)
  });
  const fromRecord = (record: CodexChronicleRecord): Draft => ({
    ...fresh(),
    kind: "entry",
    text: record.text,
    hidden: record.gmText ?? "",
    sessionId: record.sessionId ?? "",
    attachPageId: record.attachPageId ?? "",
    revealed: record.revealedToPlayers,
    tags: record.tags,
    ...dateDraftOf(record.inWorldDate)
  });
  const [draft, setDraft] = useState<Draft>(() => (editing ? fromRecord(editing) : fresh()));
  const [shownFor, setShownFor] = useState<string | null>(open ? (editing?.id ?? "new") : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each opening starts from the record, or from a clean draft.
  const openKey = open ? (editing?.id ?? "new") : null;
  if (openKey !== shownFor) {
    setShownFor(openKey);
    if (open) {
      setDraft(editing ? fromRecord(editing) : fresh());
      setError(null);
    }
  }
  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const characterOptions = useMemo(
    () =>
      charactersFor(pages, actors).map((option) => ({
        id: option.id,
        label: option.title,
        icon: <EntityIcon type="character" />,
        ...(option.archived ? { meta: ARCHIVED_META } : {})
      })),
    [pages, actors]
  );
  const whoPageId =
    draft.whoValue && characterOptions.some((option) => option.id === draft.whoValue) ? draft.whoValue : null;
  const whoName = whoPageId
    ? (pages.find((page) => page.id === whoPageId)?.title ?? "")
    : (draft.whoValue ?? "").trim();
  const days = Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0)));
  const kind: ComposerKind = editing ? "entry" : draft.kind;
  const fixedKind = editing?.kind ?? draft.kind;
  const needsDate = fixedKind === "deadline";
  const hasText = draft.text.trim() !== "" || draft.hidden.trim() !== "";
  const canSave =
    !busy &&
    (needsDate ? draft.dateYear.trim() !== "" : true) &&
    (editing
      ? hasText
      : kind === "milestone"
        ? draft.level.trim() !== ""
        : kind === "downtime"
          ? whoName !== "" || draft.activity.trim() !== "" || hasText
          : hasText);
  const proposal = !editing && kind === "downtime" && calendar ? downtimeProposedDate(calendar, days) : null;

  const save = async () => {
    setBusy(true);
    setError(null);
    const inWorldDate = dateOfDraft(draft);
    const input = {
      playerText: draft.text,
      gmText: draft.hidden.trim() || null,
      revealedToPlayers: draft.revealed,
      attachPageId: draft.attachPageId || null,
      // An explicit null files it under no session; leaving the key out would file it under the active one.
      sessionId: draft.sessionId || null,
      inWorldDate,
      // Always sent: on an edit, leaving `tags` out would keep the old ones.
      tags: draft.tags,
      commandId: newId()
    };
    try {
      if (editing) await journalApi.update(gmToken, editing.id, input);
      else if (kind === "deadline") {
        if (!inWorldDate) throw new Error("A deadline needs a date. Set its year, month and day.");
        await journalApi.createDeadline(gmToken, { ...input, inWorldDate });
      } else if (kind === "downtime")
        await journalApi.createDowntime(gmToken, {
          ...input,
          downtime: {
            who: whoName.slice(0, DOWNTIME_TEXT_MAX),
            activity: draft.activity.trim().slice(0, DOWNTIME_TEXT_MAX),
            days,
            ...(whoPageId ? { characterPageId: whoPageId } : {})
          }
        });
      else if (kind === "milestone")
        await journalApi.createMilestone(gmToken, {
          ...input,
          milestone: {
            level: Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.trunc(Number(draft.level) || LEVEL_MIN))),
            reason: draft.reason.trim().slice(0, REASON_MAX)
          }
        });
      else await journalApi.create(gmToken, input);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save that to the chronicle.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${CHRONICLE_KIND_META[editing.kind].label.toLowerCase()}` : "Add to the chronicle"}
      ariaLabel={editing ? "Edit a chronicle record" : "Add to the chronicle"}
      className="story-composer"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {editing ? "Save" : SUBMIT[kind]}
          </Button>
        </>
      }
    >
      <div className="story-composer-body">
        {!editing && (
          <SegmentedControl
            ariaLabel="What to add"
            value={draft.kind}
            onChange={(next) => {
              const nextKind = next as ComposerKind;
              set({
                kind: nextKind,
                ...(draft.dateYear.trim() === "" || nextKind === "deadline"
                  ? dateDraftOf(nextKind === "entry" ? (calendar?.currentDate ?? null) : null)
                  : {})
              });
            }}
            options={COMPOSER_KINDS.map((id) => ({ value: id, label: CHRONICLE_KIND_META[id].label }))}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="What players read" htmlFor="story-text">
          <CodexEditor
            id="story-text"
            token={gmToken}
            value={draft.text}
            onChange={(text) => set({ text })}
            ariaLabel="What players read"
            placeholder={PLACEHOLDER[kind]}
            pages={pages}
            onNavigate={onFollow}
            onCreatePage={onFollow}
            rows={5}
          />
        </Field>
        <Field label="Hidden note" htmlFor="story-hidden">
          <CodexEditor
            id="story-hidden"
            token={gmToken}
            value={draft.hidden}
            onChange={(hidden) => set({ hidden })}
            ariaLabel="Hidden note"
            placeholder="What only you see"
            pages={pages}
            onNavigate={onFollow}
            onCreatePage={onFollow}
            gmLayer
            rows={3}
          />
        </Field>
        {!editing && kind === "downtime" && (
          <div className="story-composer-row">
            <Field label="Who" htmlFor="story-who">
              <Combobox
                id="story-who"
                options={characterOptions}
                value={draft.whoValue}
                onChange={(whoValue) => set({ whoValue })}
                allowFreeText
                limit={Math.max(characterOptions.length, 1)}
                ariaLabel="Who spent the time"
                placeholder="Search characters, or type a name"
              />
            </Field>
            <Field label="Activity" htmlFor="story-activity">
              <Input
                id="story-activity"
                maxLength={DOWNTIME_TEXT_MAX}
                value={draft.activity}
                placeholder="Forging a blade"
                onChange={(event) => set({ activity: event.target.value })}
              />
            </Field>
            <Field label="Days" htmlFor="story-days">
              <Input
                id="story-days"
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
        )}
        {proposal && calendar && (
          <p className="story-hint">
            Logging this proposes moving your date to {formatWorldDate(calendar, proposal)}. Nothing moves until you
            confirm it on the record.
          </p>
        )}
        {!editing && kind === "milestone" && (
          <>
            <div className="story-composer-row">
              <Field label="Level reached" htmlFor="story-level">
                <Input
                  id="story-level"
                  type="number"
                  inputMode="numeric"
                  min={LEVEL_MIN}
                  max={LEVEL_MAX}
                  value={draft.level}
                  placeholder="5"
                  onChange={(event) => set({ level: event.target.value })}
                />
              </Field>
              <Field label="Why" htmlFor="story-reason">
                <Input
                  id="story-reason"
                  maxLength={REASON_MAX}
                  value={draft.reason}
                  placeholder="Cleared the Sunken Crypt"
                  onChange={(event) => set({ reason: event.target.value })}
                />
              </Field>
            </div>
            <p className="story-hint">
              A milestone records the level the party reached and when. It changes no character sheet and counts no XP.
            </p>
          </>
        )}
        <div className="story-composer-row">
          <InWorldDateFields
            idPrefix="story"
            draft={draft}
            months={calendar?.months ?? []}
            onChange={set}
            yearHelp={needsDate ? "A deadline fires when your date passes it." : undefined}
          />
        </div>
        {needsDate && !draft.dateYear.trim() && (
          <p className="story-hint">A deadline needs a date. Set its year, month and day.</p>
        )}
        <div className="story-composer-row">
          <Field label="Session" htmlFor="story-session">
            <Select
              id="story-session"
              value={draft.sessionId}
              onChange={(event) => set({ sessionId: event.target.value })}
            >
              <option value="">None</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {sessionTitle(session)}
                  {session.id === activeSessionId ? " (active)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="About a page" htmlFor="story-page">
            <Combobox
              id="story-page"
              options={pages.map((page) => ({
                id: page.id,
                label: page.title,
                icon: <EntityIcon type={page.entityType} />
              }))}
              value={draft.attachPageId || null}
              onChange={(id) => set({ attachPageId: id ?? "" })}
              ariaLabel="About a page"
              placeholder="None"
            />
          </Field>
        </div>
        <Field label="Tags" htmlFor="story-tags">
          <TagInput
            id="story-tags"
            ariaLabel="Tags"
            placeholder="harbour, rumour"
            values={draft.tags}
            onChange={(tags) => set({ tags })}
            max={24}
            maxReachedReason="A record may carry at most 24 tags."
            suggestions={tagSuggestions}
          />
        </Field>
        <div className="story-composer-who">
          <span className="story-eyebrow">Who sees it</span>
          <FieldAudienceToggle
            field="this record"
            hidden={!draft.revealed}
            onChange={(hidden) => set({ revealed: !hidden })}
          />
        </div>
      </div>
    </Modal>
  );
}
