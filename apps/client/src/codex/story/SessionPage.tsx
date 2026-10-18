import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Field,
  IconMore,
  Input,
  Menu,
  MenuItem,
  Modal,
  SaveState,
  SegmentedControl,
  Select,
  TagInput,
  useToast,
  revealedLabel,
  type PartyCharacter
} from "@vtt/ui";
import type {
  CodexAutosaveSettings,
  CodexChronicleRecord,
  CodexPrepLink,
  CodexPrepSection,
  CodexPrepTemplate,
  CodexSession,
  CodexSessionHappened,
  CodexSessionStatus,
  GmCodexCalendar
} from "@vtt/domain";
import { useConfirm } from "../../components/feedback";
import { sessionApi } from "../api";
import { useCodexAutosave } from "../autosave";
import { archivedOptionLabel, charactersFor, type ArchivableActor } from "../characters";
import { CHRONICLE_KIND_META, chronicleKindOfJournal } from "../chronicle";
import { CodexEditor } from "../CodexEditor";
import { CodexIcon } from "../icons";
import { liveApi, prepSessionApi, templateApi } from "../prep/api";

import { sessionTitle } from "../sessions";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexQuery } from "../useCodexQuery";
import { realDateLabel, recordDay, sessionDays } from "./model";
import { PrepEditor, linkLine, useBlockTitles, type PrepContext } from "./PrepEditor";
import { PrepReader } from "./PrepReader";
import { recordLine } from "./Chronicle";

type Draft = Readonly<{
  sessionNumber: string;
  realDate: string;
  attendees: readonly string[];
  status: CodexSessionStatus;
  tags: readonly string[];
  recapBody: string;
  prep: readonly CodexPrepSection[];
}>;

const draftOf = (session: CodexSession): Draft => ({
  sessionNumber: session.sessionNumber?.toString() ?? "",
  realDate: session.realDate ?? "",
  attendees: session.attendees,
  status: session.status,
  tags: session.tags,
  recapBody: session.recapBody,
  prep: session.prep ?? []
});

export type SessionMode = "prep" | "recap";
type PhoneTab = "prep" | "places" | "entries" | "recap";

/**
 * One session's page, made from its prep template: the prep sections before play, and after it the recap step,
 * with what happened (the reveals, the clues ticked and the lines logged) beside the recap players read. Start makes
 * the session the table's live board; Share the recap shows the recap to players. Everything typed follows the
 * autosave setting in one draft, and a tick at the table moves the session's `rev`, so a stale save is a conflict.
 */
export function SessionPage({
  gmToken,
  session,
  sessions,
  isActive,
  records,
  calendar,
  context,
  party,
  actors = [],
  autosave,
  phone,
  onChanged,
  onDeleted,
  onBack,
  onOpenTemplate
}: Readonly<{
  gmToken: string;
  session: CodexSession;
  sessions: readonly CodexSession[];
  isActive: boolean;
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  context: PrepContext;
  party: readonly PartyCharacter[];
  actors?: readonly ArchivableActor[];
  autosave: CodexAutosaveSettings;
  phone: boolean;
  onChanged: () => void | Promise<void>;
  onDeleted: () => void;
  onBack: () => void;
  onOpenTemplate: (templateId: string) => void;
}>) {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => draftOf(session));
  const revRef = useRef(session.rev);
  const markSavedRef = useRef<((draft: Draft) => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>(session.status === "played" ? "recap" : "prep");
  const [phoneTab, setPhoneTab] = useState<PhoneTab>("prep");
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** A phone reads the prep through; Edit the prep in the menu swaps in the editors. */
  const [editingPrep, setEditingPrep] = useState(false);
  const [reapplyOpen, setReapplyOpen] = useState(false);
  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));

  const library = useCodexQuery(
    useCallback(() => templateApi.list(gmToken), [gmToken]),
    { live: false }
  );
  const templates = library.data?.templates ?? [];
  const madeFrom = templates.find((template) => template.id === session.prepTemplateId) ?? null;

  const save = useCallback(
    async (next: Draft) => {
      const number = next.sessionNumber.trim() === "" ? null : Math.trunc(Number(next.sessionNumber));
      const saved = await sessionApi.update(gmToken, session.id, {
        sessionNumber: number !== null && Number.isFinite(number) ? number : null,
        realDate: next.realDate.trim() || null,
        attendees: next.attendees,
        status: next.status,
        tags: next.tags,
        recapBody: next.recapBody,
        prep: next.prep,
        expectedRev: revRef.current
      });
      revRef.current = saved.rev;
      setError(null);
      await onChanged();
    },
    [gmToken, session.id, onChanged]
  );
  const saving = useCodexAutosave<Draft>({
    settings: autosave,
    draft,
    save,
    // A tick or a log at the table moved the session on: show that version, which is the one the table has.
    onConflict: async () => {
      const fresh = await sessionApi.get(gmToken, session.id);
      revRef.current = fresh.rev;
      const next = draftOf(fresh);
      setDraft(next);
      markSavedRef.current?.(next);
      setError("This session changed at the table, so it now shows that version. Your last edit was not saved.");
    }
  });
  markSavedRef.current = saving.markSaved;
  useEffect(() => {
    if (saving.status === "error") setError("Couldn't save the session. Check the session number isn't already taken.");
  }, [saving.status]);

  const days = sessionDays(records, session.id, calendar);
  const meta = [
    realDateLabel(session.realDate, true),
    days,
    session.attendees.length > 0 ? session.attendees.join(", ") : null
  ]
    .filter(Boolean)
    .join(" · ");
  const blockTitles = useBlockTitles(gmToken, draft.prep);
  const prepContext = useMemo(() => ({ ...context, blockTitles }), [context, blockTitles]);

  const act = async (run: () => Promise<unknown>, failure: string, done?: string) => {
    setError(null);
    try {
      await run();
      await onChanged();
      if (done) toast(done, { tone: "success" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    }
  };
  const start = () =>
    act(
      () => sessionApi.activate(gmToken, session.id),
      "Couldn't start the session.",
      `${sessionTitle(session)} is on the table's Tonight tab.`
    );
  const share = (revealed: boolean) =>
    act(
      () => sessionApi.reveal(gmToken, session.id, revealed),
      "Couldn't change who reads the recap.",
      revealed ? "Players can read the recap in Story." : "The recap is hidden again."
    );
  const remove = async () => {
    if (
      !(await confirm({
        title: "Delete session",
        body: `Delete ${sessionTitle(session).toLowerCase()}? Its prep and recap are lost. Records filed under it are kept.`,
        confirmLabel: "Delete",
        danger: true
      }))
    )
      return;
    try {
      await sessionApi.remove(gmToken, session.id);
      onDeleted();
    } catch {
      setError("Couldn't delete the session.");
    }
  };
  const reapply = async (template: CodexPrepTemplate) => {
    setReapplyOpen(false);
    await saving.flush();
    await act(
      async () => {
        const fresh = await prepSessionApi.applyTemplate(gmToken, session.id, template.id, revRef.current);
        revRef.current = fresh.rev;
        const next = draftOf(fresh);
        setDraft(next);
        saving.markSaved(next);
      },
      "Couldn't re-apply the template.",
      `${sessionTitle(session)} has ${template.name}'s sections, with what was written kept.`
    );
  };

  const primary =
    session.status === "planned" && !isActive ? (
      <Button variant="primary" size={phone ? "sm" : "md"} onClick={() => void start()}>
        {phone ? "Start" : `Start ${sessionTitle(session).toLowerCase()}`}
      </Button>
    ) : session.status === "played" && !session.revealedToPlayers ? (
      <Button variant="primary" size={phone ? "sm" : "md"} onClick={() => void share(true)}>
        {phone ? "Share" : "Share the recap"}
      </Button>
    ) : null;

  const more = (
    <Menu icon align="end" label={`${sessionTitle(session)} options`} trigger={<IconMore />}>
      <MenuItem onClick={() => setDetailsOpen(true)}>Edit details</MenuItem>
      {phone && (
        <MenuItem onClick={() => setEditingPrep((now) => !now)}>
          {editingPrep ? "Read the prep" : "Edit the prep"}
        </MenuItem>
      )}
      <MenuItem onClick={() => setReapplyOpen(true)}>Re-apply a template</MenuItem>
      {!isActive && <MenuItem onClick={() => void start()}>Make active</MenuItem>}
      {session.status === "planned" ? (
        <MenuItem onClick={() => patch({ status: "played" })}>Mark as played</MenuItem>
      ) : (
        <MenuItem onClick={() => patch({ status: "planned" })}>Mark as planned</MenuItem>
      )}
      {session.revealedToPlayers && <MenuItem onClick={() => void share(false)}>Hide the recap</MenuItem>}
      <MenuItem tone="danger" onClick={() => void remove()}>
        Delete session
      </MenuItem>
    </Menu>
  );

  const chips = (
    <div className="session-chips">
      <span className="session-status">{draft.status === "played" ? "Played" : "Planned"}</span>
      {isActive && <Badge tone="success">Active</Badge>}
      {session.prepTemplateId && (
        <button
          type="button"
          className="session-madefrom"
          onClick={() => madeFrom && onOpenTemplate(madeFrom.id)}
          disabled={!madeFrom}
        >
          <CodexIcon iconId="scroll" className="story-item-icon" />
          {madeFrom ? `Made from ${madeFrom.name}` : "Made from a deleted template"}
        </button>
      )}
      <span className="session-recapstate">{session.revealedToPlayers ? "Recap shared" : "Recap hidden"}</span>
    </div>
  );

  const onPhoneTab = (section: CodexPrepSection) =>
    phoneTab === "places" ? section.type === "pages" : section.type !== "pages";
  const prepEditor =
    phone && !editingPrep ? (
      <PrepReader
        sections={draft.prep.filter(onPhoneTab)}
        context={prepContext}
        onTick={(sectionId, itemId, done) =>
          patch({
            prep: draft.prep.map((section) =>
              section.id === sectionId && section.type === "checklist"
                ? { ...section, items: section.items.map((item) => (item.id === itemId ? { ...item, done } : item)) }
                : section
            )
          })
        }
      />
    ) : (
      <PrepEditor
        sections={draft.prep}
        context={prepContext}
        onChange={(prep) => patch({ prep })}
        filter={phone ? onPhoneTab : undefined}
      />
    );
  const recap = (
    <RecapStep
      gmToken={gmToken}
      session={session}
      sessions={sessions}
      party={party}
      context={prepContext}
      recapBody={draft.recapBody}
      prep={draft.prep}
      onRecap={(recapBody) => patch({ recapBody })}
      phone={phone}
    />
  );
  const entries = records.filter((record) => record.sessionId === session.id);

  return (
    <article className={`session-page${phone ? " is-phone" : ""}`} aria-label={sessionTitle(session)}>
      {phone ? (
        <CodexPhoneBar title={sessionTitle(session)} onBack={onBack} actions={primary} />
      ) : (
        <header className="session-head">
          <div className="session-head-text">
            <div className="session-titlerow">
              <h2 className="session-title">{sessionTitle(session)}</h2>
              {chips}
            </div>
            {meta && <span className="session-meta">{meta}</span>}
          </div>
          <SaveState status={saving.status} onRetry={() => void saving.flush()} />
          {!autosave.enabled && (
            <Button variant="secondary" size="sm" disabled={!saving.dirty} onClick={() => void saving.flush()}>
              Save
            </Button>
          )}
          <SegmentedControl
            ariaLabel="Prep or recap"
            value={mode}
            onChange={(next) => setMode(next as SessionMode)}
            options={[
              { value: "prep", label: "Prep" },
              { value: "recap", label: "Recap" }
            ]}
          />
          {primary}
          {more}
        </header>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {phone ? (
        <div className="session-phonebody scroll-y">
          {chips}
          <div className="session-phonetabs">
            <SegmentedControl
              ariaLabel="Session"
              value={phoneTab}
              onChange={(next) => setPhoneTab(next as PhoneTab)}
              options={[
                { value: "prep", label: "Prep" },
                { value: "places", label: "Cast and places" },
                { value: "entries", label: "Entries" },
                { value: "recap", label: "Recap" }
              ]}
            />
            {more}
          </div>
          {(phoneTab === "prep" || phoneTab === "places") && prepEditor}
          {phoneTab === "entries" && (
            <EntryList
              records={entries}
              calendar={calendar}
              lineOf={(record) => recordLine(record, context.quests, context.pages)}
            />
          )}
          {phoneTab === "recap" && recap}
        </div>
      ) : (
        <div className="session-body scroll-y">{mode === "prep" ? prepEditor : recap}</div>
      )}
      {detailsOpen && (
        <SessionDetails
          draft={draft}
          actors={actors}
          pages={context.pages}
          onChange={patch}
          onClose={() => {
            setDetailsOpen(false);
            void saving.flush();
          }}
        />
      )}
      {reapplyOpen && (
        <ReapplyDialog
          templates={templates}
          current={session.prepTemplateId}
          onCancel={() => setReapplyOpen(false)}
          onApply={(template) => void reapply(template)}
        />
      )}
      {confirmDialog}
    </article>
  );
}

/** A session's filing details: its number, when it was played, its status, tags and who played. */
function SessionDetails({
  draft,
  actors,
  pages,
  onChange,
  onClose
}: Readonly<{
  draft: Draft;
  actors: readonly ArchivableActor[];
  pages: PrepContext["pages"];
  onChange: (next: Partial<Draft>) => void;
  onClose: () => void;
}>) {
  const characters = useMemo(
    () => charactersFor(pages.filter((page) => page.entityType === "character") as never, actors),
    [pages, actors]
  );
  return (
    <Modal open onClose={onClose} size="md" title="Session details" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="story-composer-row">
        <Field label="Session" htmlFor="s-number">
          <Input
            id="s-number"
            type="number"
            inputMode="numeric"
            value={draft.sessionNumber}
            onChange={(event) => onChange({ sessionNumber: event.target.value })}
          />
        </Field>
        <Field label="Played on" htmlFor="s-date">
          <Input
            id="s-date"
            value={draft.realDate}
            placeholder="2026-10-24"
            onChange={(event) => onChange({ realDate: event.target.value })}
          />
        </Field>
        <Field label="Status" htmlFor="s-status">
          <Select
            id="s-status"
            value={draft.status}
            onChange={(event) => onChange({ status: event.target.value as CodexSessionStatus })}
          >
            <option value="planned">Planned</option>
            <option value="played">Played</option>
          </Select>
        </Field>
      </div>
      <Field label="Tags" htmlFor="s-tags">
        <TagInput
          id="s-tags"
          ariaLabel="Tags"
          placeholder="arc-one, tavern"
          values={draft.tags}
          onChange={(tags) => onChange({ tags })}
          max={24}
          maxReachedReason="A session may carry at most 24 tags."
        />
      </Field>
      <Field label="Who played" htmlFor="s-attendees">
        <TagInput
          id="s-attendees"
          ariaLabel="Who played"
          placeholder="Add a name"
          values={draft.attendees}
          onChange={(attendees) => onChange({ attendees })}
          max={24}
          maxReachedReason="A session may list at most 24 people."
          suggestions={characters.map((option) => option.title)}
          pick
          optionLabel={(name) =>
            archivedOptionLabel(name, characters.find((option) => option.title === name)?.archived ?? false)
          }
          normalize={(raw) => raw.trim().slice(0, 40)}
        />
      </Field>
    </Modal>
  );
}

function ReapplyDialog({
  templates,
  current,
  onCancel,
  onApply
}: Readonly<{
  templates: readonly CodexPrepTemplate[];
  current: string | null;
  onCancel: () => void;
  onApply: (template: CodexPrepTemplate) => void;
}>) {
  const [chosen, setChosen] = useState(current ?? templates.find((template) => template.isDefault)?.id ?? "");
  const template = templates.find((each) => each.id === chosen) ?? null;
  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title="Re-apply a template"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!template} onClick={() => template && onApply(template)}>
            Re-apply
          </Button>
        </>
      }
    >
      <Field label="Template" htmlFor="s-reapply">
        <Select id="s-reapply" value={chosen} onChange={(event) => setChosen(event.target.value)}>
          {templates.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="story-hint">
        The session gets the template's sections in its order. A section that matches one already here keeps what was
        written, and a section with anything in it that matches nothing stays at the end.
      </p>
    </Modal>
  );
}

function EntryList({
  records,
  calendar,
  lineOf
}: Readonly<{
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  lineOf: (record: CodexChronicleRecord) => string;
}>) {
  if (records.length === 0) return <p className="story-hint">Nothing is filed under this session yet.</p>;
  return (
    <ul className="session-lines">
      {records.map((record) => {
        const meta = CHRONICLE_KIND_META[record.kind];
        return (
          <li key={record.id} className="session-line">
            <CodexIcon iconId={meta.iconId} className="story-item-icon" />
            <span className="prep-row-text">
              <span className="prep-row-line">
                {[recordDay(record, calendar), meta.label].filter(Boolean).join(" · ")}
              </span>
              <span className="prep-row-title">{lineOf(record)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ----- The recap step -----

type HappenedLine = Readonly<{ key: string; iconId: string; meta: string; text: string }>;

/** What happened, from the live board, beside the recap players read. Add copies a line into the recap. */
function RecapStep({
  gmToken,
  session,
  sessions,
  party,
  context,
  recapBody,
  prep,
  onRecap,
  phone
}: Readonly<{
  gmToken: string;
  session: CodexSession;
  sessions: readonly CodexSession[];
  party: readonly PartyCharacter[];
  context: PrepContext;
  recapBody: string;
  prep: readonly CodexPrepSection[];
  onRecap: (recapBody: string) => void;
  phone: boolean;
}>) {
  const { toast } = useToast();
  const happened = useCodexQuery(
    useCallback(() => liveApi.happened(gmToken, session.id), [gmToken, session.id]),
    { failure: "Couldn't read what happened in this session." }
  );
  const lines = useMemo(
    () => happenedLines(happened.data ?? null, party, context.quests, context.pages),
    [happened.data, party, context.quests, context.pages]
  );
  const notReached = prep.flatMap((section) =>
    section.type === "checklist" ? section.items.filter((item) => !item.done).map((item) => ({ item, section })) : []
  );
  const next = useMemo(
    () =>
      sessions
        .filter(
          (each) =>
            each.id !== session.id &&
            each.status === "planned" &&
            (session.sessionNumber === null || (each.sessionNumber ?? 0) > session.sessionNumber)
        )
        .sort((a, b) => (a.sessionNumber ?? 0) - (b.sessionNumber ?? 0))[0] ?? null,
    [sessions, session]
  );
  const addLine = (text: string) => onRecap(recapBody.trim() ? `${recapBody.trimEnd()}\n\n${text}` : text);
  const carry = async (text: string, link: CodexPrepLink | null) => {
    if (!next) return;
    try {
      const fresh = await sessionApi.get(gmToken, next.id);
      const prepNext = fresh.prep ?? [];
      const at = prepNext.findIndex((section) => section.type === "checklist");
      const item = { text, done: false, link };
      const updated =
        at === -1
          ? [
              ...prepNext,
              {
                type: "checklist" as const,
                title: "Secrets and clues",
                prompt: null,
                templateSectionId: null,
                items: [item]
              }
            ]
          : prepNext.map((section, index) =>
              index === at && section.type === "checklist" ? { ...section, items: [...section.items, item] } : section
            );
      await sessionApi.update(gmToken, next.id, { prep: updated, expectedRev: fresh.rev });
      toast(`Added to ${sessionTitle(next)}'s clues.`, { tone: "success" });
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Couldn't move the clue.", { tone: "error" });
    }
  };

  return (
    <div className={`recap${phone ? " is-phone" : ""}`}>
      <section className="recap-happened" aria-label="What happened">
        <h3 className="recap-title is-gm">What happened</h3>
        <p className="story-hint">These lines come from the live board. Add copies a line into the recap.</p>
        {happened.error && <Alert tone="danger">{happened.error}</Alert>}
        {!happened.loading && lines.length === 0 && (
          <p className="story-hint">Nothing was logged, ticked or revealed in this session.</p>
        )}
        <ul className="session-lines">
          {lines.map((line) => (
            <li key={line.key} className="session-line">
              <CodexIcon iconId={line.iconId} className="story-item-icon" />
              <span className="prep-row-text">
                <span className="prep-row-line">{line.meta}</span>
                <span className="prep-row-title">{line.text}</span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Add to the recap: ${line.text}`}
                onClick={() => addLine(line.text)}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
        {notReached.length > 0 && (
          <>
            <h4 className="story-eyebrow is-gm">Not reached</h4>
            <ul className="session-lines">
              {notReached.map(({ item }) => (
                <li key={item.id} className="session-line">
                  <span className="prep-check is-static" aria-hidden="true" />
                  <span className="prep-row-text">
                    <span className="prep-row-title">{item.text}</span>
                    {item.link && <span className="prep-row-line">{linkLine(item.link, context)}</span>}
                  </span>
                  {next && (
                    <Button variant="ghost" size="sm" onClick={() => void carry(item.text, item.link)}>
                      Move to {sessionTitle(next).toLowerCase()}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="recap-forplayers" aria-label="Recap for players">
        <h3 className="recap-title">Recap for players</h3>
        <CodexEditor
          id={`recap-${session.id}`}
          token={gmToken}
          value={recapBody}
          onChange={onRecap}
          ariaLabel="Recap for players"
          placeholder="What the party did, as they will read it"
          pages={context.pages}
          onNavigate={context.onFollow ?? (() => undefined)}
          onCreatePage={context.onFollow}
          rows={phone ? 8 : 14}
        />
        <p className="story-hint">
          Players read this in Story once you share it.
          {next ? ` A clue not reached can move to ${sessionTitle(next).toLowerCase()}'s checklist.` : ""}
        </p>
      </section>
    </div>
  );
}

/** The recap's sources as lines, oldest first: reveals, ticked clues, then everything filed under the session. */
type Named = Readonly<{ id: string; title: string }>;
export function happenedLines(
  happened: CodexSessionHappened | null,
  party: readonly PartyCharacter[],
  quests: readonly Named[] = [],
  pages: readonly Named[] = []
): HappenedLine[] {
  if (!happened) return [];
  const reveals: HappenedLine[] = happened.reveals.map((reveal) => ({
    key: `reveal-${reveal.blockId}-${reveal.to}`,
    iconId: "eye",
    meta: revealedLabel(
      reveal.to === "everyone"
        ? { audience: "everyone", characterIds: [] }
        : { audience: "characters", characterIds: [reveal.to] },
      party
    ),
    text: `${reveal.recordTitle} · ${reveal.blockTitle?.trim() || "a hidden block"}`
  }));
  const clues: HappenedLine[] = happened.cluesTicked.map((clue) => ({
    key: `clue-${clue.id}`,
    iconId: "star",
    meta: "Clue ticked",
    text: clue.text
  }));
  const logged: HappenedLine[] = happened.entries.map((entry) => {
    const kind = chronicleKindOfJournal(entry.kind);
    const record = { ...entry, kind, text: entry.playerText, title: null, calendarInstant: null, sessionNumber: null };
    return {
      key: `entry-${entry.id}`,
      iconId: CHRONICLE_KIND_META[kind].iconId,
      meta: [entry.inWorldLabel, CHRONICLE_KIND_META[kind].label].filter(Boolean).join(" · "),
      text: recordLine(record, quests, pages) || "A record with no text"
    };
  });
  return [...reveals, ...clues, ...logged];
}
