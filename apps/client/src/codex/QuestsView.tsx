import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Checklist, Field, Input, Panel, Select, Skeleton, Textarea } from "@vtt/ui";
import { questApi, type CodexQuest, type CodexQuestObjective, type CodexQuestStatus } from "./api";
import { QUEST_STATUS_LABEL, questProgress, questStatusTone } from "./quests";
import { EntityPicker } from "./EntityPicker";
import { GmOnlyTag, RevealSwitch } from "./SecretMarkers";
import { CodexIcon, EntityIcon } from "./icons";
import { useConfirm } from "../components/feedback";
import type { EntityType } from "./entities";

/**
 * M10: the quest log — **the one place a quest is edited**.
 *
 * Deliberately a destination inside the Codex shell rather than a sixth mode tab, for the same reason
 * M9's session log is one: the five existing tabs already overflow a 375px strip, and a sixth would push
 * the overflow past the point where `.codex-modetabs`' cue helps. It is reached from the ops row (which
 * wraps, where a tab strip does not) and from a dashboard card, both of which land ON a quest.
 *
 * It owns no feed. The workspace holds ONE quest list and hands it down here and to the Campaign card,
 * so both are looking at the same records; every write below reports back through `onChanged` and the
 * workspace re-reads. Two quest stores on one screen is precisely how a dashboard ends up disagreeing
 * with the editor beside it.
 */
type QuestPage = Readonly<{ id: string; title: string; entityType: EntityType }>;

type QuestsViewProps = Readonly<{
  gmToken: string;
  quests: readonly CodexQuest[];
  /** The notebook, for the linked-entity picker. Already fetched by the workspace; never re-read here. */
  pages: readonly QuestPage[];
  /** CF-2 / R4: the workspace's quest feed is still in flight — an empty list is not yet "no quests". */
  loading: boolean;
  /** R4: the feed's own failure. Without this a failed read renders as an empty log, silently. */
  error: string | null;
  /** R1: land ON a quest, not merely "the quest log, somewhere". Same latch shape as `openSessionId`. */
  openQuestId?: string | null;
  onOpenedQuest?: () => void;
  onChanged: () => void | Promise<void>;
  /** R1 again: a linked entity opens the notebook ON that page, which also leaves this destination. */
  onOpenPage: (pageId: string) => void;
  onClose: () => void;
}>;

export function QuestsView({ gmToken, quests, pages, loading, error, openQuestId = null, onOpenedQuest = () => {}, onChanged, onOpenPage, onClose }: QuestsViewProps) {
  /**
   * Three states, not two — the session log's rule verbatim. `undefined` is "the GM has not chosen yet",
   * which is what lets the log open on the first open quest; `null` is "explicitly cleared", which is
   * what the phone's `‹ All quests` link means. Collapsing the two would make that link a no-op.
   */
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [listError, setListError] = useState<string | null>(null);

  /**
   * R1: the arriving jump's landing. The same handled-latch the session log and the Journal use, and for
   * the same three reasons: `loading` guards it so a target cannot be dropped before the list exists, the
   * ref stops a re-render re-selecting a quest the GM has since navigated away from, and clearing the ref
   * when the request goes away is what lets the SAME quest be reached again from a later jump.
   */
  const handledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openQuestId) { handledRef.current = null; return; }
    if (loading || handledRef.current === openQuestId) return;
    handledRef.current = openQuestId;
    setSelectedId(openQuestId);
    onOpenedQuest();
  }, [openQuestId, loading, onOpenedQuest]);

  // Nothing chosen yet: land on the first quest that is still open, which is what a GM opening the log
  // between games is almost always after. A campaign whose quests are all finished falls back to the
  // first row rather than an empty pane, because "everything is done" is still a list worth reading.
  const selected = selectedId === undefined
    ? (quests.find((quest) => quest.status === "active") ?? quests[0] ?? null)
    : quests.find((quest) => quest.id === selectedId) ?? null;

  const create = async () => {
    setListError(null);
    try {
      // A title is required by the route (`min(1)`), so one is supplied rather than sending a blank and
      // letting the server 400 at a GM who has not typed anything yet.
      const quest = await questApi.create(gmToken, { title: "Untitled quest" });
      await onChanged();
      setSelectedId(quest.id);
    } catch (createError) { setListError(createError instanceof Error ? createError.message : "Couldn't create the quest."); }
  };

  return (
    <>
      {/* The way out, ABOVE the two panes rather than inside the rail. On a phone the rail is hidden
          while a quest is open (`has-selection`), so an exit living in it would make leaving the log a
          two-tap manoeuvre. §4: `Button` is a `@vtt/ui` primitive and carries the 44px floor itself
          (route 2, `.nh-btn--sm`); the wrapper is layout, not a control. */}
      <div className="codex-sessions-exit"><Button variant="ghost" size="sm" onClick={onClose}>‹ Back to the Codex</Button></div>
      <div className={`codex-workspace${selected ? " has-selection" : ""}`}>
        <aside className="codex-rail">
          <div className="codex-rail-head">
            <strong className="codex-sessions-railtitle">Quests</strong>
            {/* §4: `Button size="sm"` is a `@vtt/ui` primitive and carries the 44px floor itself
                (route 2, `.nh-btn--sm`) — no new control, no new floor to argue about. */}
            <Button variant="ghost" size="sm" onClick={create}>＋ New</Button>
          </div>
          {listError && <Alert tone="danger">{listError}</Alert>}
          <nav className="codex-list" aria-label="Quest log">
            {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
            {!loading && quests.length === 0 && !error && <p className="codex-list-empty">No quests yet. Create one to track what the party is chasing.</p>}
            {quests.map((quest) => (
              /* `aria-current` as well as the class: the accent is the visual cue, but "which quest am I
                 looking at" has to survive with every stylesheet stripped (R2's colour rule again). */
              <button key={quest.id} type="button" aria-current={quest.id === selected?.id ? "true" : undefined}
                className={`codex-quest-row${quest.id === selected?.id ? " is-active" : ""}`} onClick={() => setSelectedId(quest.id)}>
                <CodexIcon iconId="quest" className="codex-ent-icon codex-quest-rowglyph" />
                <span className="codex-list-title">{quest.title}</span>
                <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
                {quest.revealedToPlayers && <Badge tone="info">Shown</Badge>}
              </button>
            ))}
          </nav>
        </aside>

        <section className="codex-main">
          {selected && <button type="button" className="codex-back" onClick={() => setSelectedId(null)}>‹ All quests</button>}
          {/* R4: this surface's own failure. The log reads one feed; a silent one is an empty log that
              looks exactly like a campaign that has never had a quest. */}
          {error && <Alert tone="danger" title="Couldn't load the quests">{error}</Alert>}
          {selected
            ? <QuestEditor key={selected.id} gmToken={gmToken} quest={selected} pages={pages}
                onChanged={onChanged} onOpenPage={onOpenPage} onDeleted={() => { setSelectedId(null); void onChanged(); }} />
            : !loading && !error && <div className="codex-main-empty"><h3>Track what the party is chasing</h3><p>A quest holds the objectives the table is working through, what they were told, and — GM-only — where it is really going. Reveal it and the open ones appear on their dashboard.</p><Button variant="primary" onClick={create}>New quest</Button></div>}
        </section>
      </div>
    </>
  );
}

/**
 * One quest's two layers, its objectives, and what it concerns. Keyed on the quest id by its caller, so
 * selecting another quest gets a fresh draft rather than one component quietly carrying typed text
 * across records.
 *
 * Explicit Save, not the page editor's debounced autosave — the session editor's reasoning, unchanged:
 * `expectedRev` stays meaningful instead of resyncing against itself on every keystroke, and the two
 * bodies here are written in sittings rather than in fast back-and-forth.
 */
function QuestEditor({ gmToken, quest, pages, onChanged, onOpenPage, onDeleted }: Readonly<{
  gmToken: string; quest: CodexQuest; pages: readonly QuestPage[];
  onChanged: () => void | Promise<void>; onOpenPage: (pageId: string) => void; onDeleted: () => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [title, setTitle] = useState(quest.title);
  const [status, setStatus] = useState<CodexQuestStatus>(quest.status);
  const [playerBody, setPlayerBody] = useState(quest.playerBody);
  const [gmBody, setGmBody] = useState(quest.gmBody);
  const [objectives, setObjectives] = useState<readonly CodexQuestObjective[]>(quest.objectives);
  const [entityIds, setEntityIds] = useState<readonly string[]>(quest.entityIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = entityIds.map((id) => pages.find((page) => page.id === id)).filter((page): page is QuestPage => Boolean(page));
  const unlinked = pages.filter((page) => !entityIds.includes(page.id));
  const progress = questProgress(objectives);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await questApi.update(gmToken, quest.id, {
        // `|| "Untitled quest"` is `PageEditor`'s rule verbatim: the route requires a non-empty title
        // and would answer a blank one with zod's own wording, which is not a sentence a GM should read.
        title: title.trim() || "Untitled quest",
        status, playerBody, gmBody,
        /* Sent EXACTLY as rendered — order is content, and a blank row is a row the GM is in the middle
           of writing, not junk to tidy away. The server's `ObjectiveSchema` accepts a blank `text` for
           precisely this reason, so there is nothing to filter and nothing to block the save on. */
        objectives,
        // Always sent, never omitted: omitting `entityIds` leaves the stored list alone, so unlinking the
        // last page has to travel as an explicit empty array (the journal's `tags` contract exactly).
        entityIds,
        expectedRev: quest.rev
      });
      await onChanged();
    } catch (saveError) {
      // Read verbatim: a stale `expectedRev` is the 409 optimistic-concurrency check and its message says
      // so, which a generic "couldn't save" would hide.
      setError(saveError instanceof Error ? saveError.message : "Couldn't save the quest.");
    } finally { setBusy(false); }
  };

  const reveal = async (revealed: boolean) => {
    setError(null);
    // Its own route, deliberately: revealing is not an edit, so it carries no `expectedRev`, does not
    // bump `rev` and does not move `updatedAt`. Sharing a quest must not look like GM activity.
    try { await questApi.reveal(gmToken, quest.id, revealed); await onChanged(); }
    catch { setError("Couldn't change who can see this quest."); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete quest", body: `Delete “${quest.title}”? Its objectives and your GM notes are lost. Pages it links to are not deleted.`, confirmLabel: "Delete", danger: true }))) return;
    try { await questApi.remove(gmToken, quest.id); onDeleted(); }
    catch { setError("Couldn't delete the quest."); }
  };

  return (
    <Panel accent="cyan" className="codex-quest-editor">
      <div className="codex-composer-head">
        <strong>{quest.title}</strong>
        <div className="codex-composer-head-actions">
          <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
          <RevealSwitch revealed={quest.revealedToPlayers} onChange={reveal} ariaLabel="Show this quest to players" />
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="codex-composer-meta">
        <Field label="Quest" htmlFor="q-title"><Input id="q-title" value={title} disabled={busy} placeholder="Untitled quest" onChange={(event) => setTitle(event.target.value)} /></Field>
        <Field label="Status" htmlFor="q-status" help="Only Active quests appear on the dashboard.">
          <Select id="q-status" value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as CodexQuestStatus)}>
            <option value="active">{QUEST_STATUS_LABEL.active}</option>
            <option value="completed">{QUEST_STATUS_LABEL.completed}</option>
            <option value="failed">{QUEST_STATUS_LABEL.failed}</option>
          </Select>
        </Field>
      </div>

      {/* Not wrapped in a `Field`: a checklist has no single control for a `<label for>` to point at, so
          it names itself through `ariaLabel` instead of growing a label that points nowhere. */}
      <div className="codex-quest-objectives">
        <div className="codex-quest-objectives-head">
          <h4 className="codex-quest-subhead">Objectives</h4>
          {progress.total > 0 && <span className="codex-quest-progress">{progress.label}</span>}
        </div>
        <p className="codex-inspector-hint">Objectives are player-facing — they are what the party is working through, so they ride with the quest the moment it is shown.</p>
        <Checklist items={objectives} ariaLabel="Objectives" max={24}
          onChange={setObjectives}
          /* The CALLER appends, because the caller owns what a blank item means here: a fresh row the GM
             is about to type into, which the server accepts precisely so this flow works. */
          onAdd={() => setObjectives([...objectives, { text: "", done: false }])}
          addLabel="Add objective" />
      </div>

      <Field label="What the party was told" help="Shown to players once this quest is revealed." htmlFor="q-player">
        <Textarea id="q-player" className="codex-quest-body" value={playerBody} disabled={busy}
          placeholder="The hook as the table heard it…" onChange={(event) => setPlayerBody(event.target.value)} />
      </Field>

      {/* R5: GM-only content is ALWAYS the violet block plus the "GM only" pill — the same pair the
          journal composer, the page editor and the session log use, never a new marking of its own. */}
      <Field label={<span className="codex-composer-gm-label">Where this is really going <GmOnlyTag /></span>} htmlFor="q-gm">
        <Textarea id="q-gm" className="codex-quest-body codex-gm-block" value={gmBody} disabled={busy}
          placeholder="The truth behind the hook, who is really behind it, how it ends…" onChange={(event) => setGmBody(event.target.value)} />
      </Field>

      <Field label="Entities this quest concerns" help="Players only ever see the ones you have already revealed.">
        <div className="codex-quest-links">
          {linked.map((page) => (
            <div key={page.id} className="codex-quest-link">
              <button type="button" className="codex-quest-link-open" onClick={() => onOpenPage(page.id)}>
                <EntityIcon type={page.entityType} /> <span className="codex-list-title">{page.title}</span>
              </button>
              <button type="button" className="codex-quest-link-x" aria-label={`Unlink ${page.title}`} disabled={busy}
                onClick={() => setEntityIds(entityIds.filter((id) => id !== page.id))}>✕</button>
            </div>
          ))}
          <EntityPicker pages={unlinked} value={null} onChange={(id) => id && setEntityIds([...entityIds, id])} ariaLabel="Link an entity" placeholder="Link an entity…" />
        </div>
      </Field>

      <div className="codex-composer-foot">
        <Button variant="ghost" size="sm" onClick={remove}>Delete quest</Button>
        <Button variant="primary" size="sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save quest"}</Button>
      </div>
      {confirmDialog}
    </Panel>
  );
}
