import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Checklist, Combobox, Field, IconButton, IconChevron, IconPlus, IconX, Input, Panel, SaveState, Select, Skeleton, TagInput } from "@vtt/ui";
import { questApi, type CodexAutosaveSettings, type CodexQuest, type CodexQuestObjective, type CodexQuestStatus } from "./api";
import { QUEST_STATUS_LABEL, questProgress, questStatusTone } from "./quests";
import { createQuest } from "./creates";
import { CodexEditor } from "./CodexEditor";
import { GmOnlyTag, RevealSwitch, VisibilityBadge } from "./SecretMarkers";
import { CodexIcon, EntityIcon } from "./icons";
import { useCodexAutosave } from "./autosave";
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
  /** D3: which quest is open comes from the ADDRESS (`/codex/quests/:id`), not from local state. */
  openQuestId?: string | null;
  /**
   * D3/D10: the filters live in the ADDRESS too (`?q=`, `?status=`), as Pages, Atlas and Journal already
   * did. In component state they were lost on every navigation and a filtered log could not be linked to
   * or refreshed back into — two of the five lists behaving unlike the other three.
   */
  filter?: string;
  statusFilter?: string | null;
  onFilterChange?: (next: Readonly<Record<string, string | null>>) => void;
  onOpenQuest: (questId: string | null) => void;
  onChanged: () => void | Promise<void>;
  /** A linked page opens in Pages, which also leaves this section. */
  onOpenPage: (pageId: string) => void;
  autosave: CodexAutosaveSettings;
  onPickTag?: (tag: string) => void;
}>;

export function QuestsView({ gmToken, quests, pages, loading, error, openQuestId = null, onOpenQuest, onChanged, onOpenPage, autosave, onPickTag, filter = "", statusFilter = null, onFilterChange }: QuestsViewProps) {
  const [listError, setListError] = useState<string | null>(null);

  const selected = openQuestId ? quests.find((quest) => quest.id === openQuestId) ?? null : null;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return quests.filter((quest) =>
      (!statusFilter || quest.status === statusFilter)
      && (!needle || quest.title.toLowerCase().includes(needle) || quest.tags.some((tag) => tag.includes(needle))));
  }, [quests, filter, statusFilter]);

  const create = async () => {
    setListError(null);
    try {
      // D7: the SAME create the palette's "New quest" runs — one create per record type, whichever door
      // starts it.
      const quest = await createQuest(gmToken);
      await onChanged();
      onOpenQuest(quest.id);
    } catch (createError) { setListError(createError instanceof Error ? createError.message : "Couldn't create the quest."); }
  };

  return (
    <>
      <div className={`codex-workspace${selected ? " has-selection" : ""}`}>
        <aside className="codex-rail">
          <div className="codex-rail-head">
            <Input value={filter} placeholder="Filter quests" aria-label="Filter quests" onChange={(event) => onFilterChange?.({ q: event.target.value || null })} />
{/* D25, one primary per view. With autosave OFF the editor's Save is the primary act on this
                screen, and the empty state's own create is the primary when there is nothing to select
                — the rail's create steps down rather than competing with either. Two magenta-filled
                buttons at once (twice with the identical label "New page") make neither one the
                answer to "what do I do here". */}
            <Button variant={selected && !autosave.enabled ? "secondary" : "primary"} size="sm" onClick={create}><IconPlus /> New</Button>
          </div>
          <div className="codex-rail-tools">
            <Select aria-label="Filter by status" value={statusFilter ?? ""} onChange={(event) => onFilterChange?.({ status: event.target.value || null })}>
              <option value="">All quests</option>
              <option value="active">{QUEST_STATUS_LABEL.active}</option>
              <option value="completed">{QUEST_STATUS_LABEL.completed}</option>
              <option value="failed">{QUEST_STATUS_LABEL.failed}</option>
            </Select>
          </div>
          {listError && <Alert tone="danger">{listError}</Alert>}
          <nav className="codex-list" aria-label="Quests">
            {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
            {!loading && quests.length === 0 && !error && <p className="codex-list-empty">No quests yet. Create one to start tracking objectives.</p>}
            {!loading && quests.length > 0 && shown.length === 0 && <p className="codex-list-empty">No quests match.</p>}
            {shown.map((quest) => (
              /* `aria-current` as well as the class: the accent is the visual cue, but "which quest am I
                 looking at" has to survive with every stylesheet stripped (R2's colour rule again). */
              <button key={quest.id} type="button" aria-current={quest.id === selected?.id ? "true" : undefined}
                className={`codex-quest-row${quest.id === selected?.id ? " is-active" : ""}`} onClick={() => onOpenQuest(quest.id)}>
                <CodexIcon iconId="quest" className="codex-ent-icon codex-quest-rowglyph" />
                <span className="codex-list-title">{quest.title}</span>
                <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
                <VisibilityBadge revealed={quest.revealedToPlayers} />
              </button>
            ))}
          </nav>
        </aside>

        <section className="codex-main">
          {selected && <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpenQuest(null)}><IconChevron className="codex-chevron-left" aria-hidden="true" />All quests</Button>}
          {/* R4: this surface's own failure. The log reads one feed; a silent one is an empty log that
              looks exactly like a campaign that has never had a quest. */}
          {error && <Alert tone="danger" title="Couldn't load the quests">{error}</Alert>}
          {selected
            ? <QuestEditor key={selected.id} gmToken={gmToken} quest={selected} pages={pages} autosave={autosave} onPickTag={onPickTag}
                onChanged={onChanged} onOpenPage={onOpenPage} onDeleted={() => { onOpenQuest(null); void onChanged(); }} />
            : !loading && !error && <div className="codex-main-empty"><h3>No quest selected</h3><p>A quest holds objectives, the text players read, and GM-only notes. Once a quest is shown to players, its active state appears on their dashboard.</p><Button variant="primary" onClick={create}>New quest</Button></div>}
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
 * D6 / G6: it autosaves now — and this is the surface where that mattered most. **Ticking an objective
 * used to be lost unless the GM also pressed Save**, which is the exact failure "the Codex always keeps
 * your work" exists to end. `expectedRev` still travels, so the 409 path is unchanged.
 */
type QuestDraft = Readonly<{ title: string; status: CodexQuestStatus; playerBody: string; gmBody: string; objectives: readonly CodexQuestObjective[]; entityIds: readonly string[]; tags: readonly string[] }>;

function QuestEditor({ gmToken, quest, pages, autosave, onPickTag, onChanged, onOpenPage, onDeleted }: Readonly<{
  gmToken: string; quest: CodexQuest; pages: readonly QuestPage[]; autosave: CodexAutosaveSettings; onPickTag?: (tag: string) => void;
  onChanged: () => void | Promise<void>; onOpenPage: (pageId: string) => void; onDeleted: () => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<QuestDraft>({
    title: quest.title, status: quest.status, playerBody: quest.playerBody, gmBody: quest.gmBody,
    objectives: quest.objectives, entityIds: quest.entityIds, tags: quest.tags
  });
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef(quest.rev);
  const patch = (next: Partial<QuestDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const linked = draft.entityIds.map((id) => pages.find((page) => page.id === id)).filter((page): page is QuestPage => Boolean(page));
  const unlinked = pages.filter((page) => !draft.entityIds.includes(page.id));
  const progress = questProgress(draft.objectives);

  const write = useCallback(async (next: QuestDraft) => {
    const updated = await questApi.update(gmToken, quest.id, {
      // `|| "Untitled quest"` is `PageEditor`'s rule verbatim: the route requires a non-empty title
      // and would answer a blank one with zod's own wording, which is not a sentence a GM should read.
      title: next.title.trim() || "Untitled quest",
      status: next.status, playerBody: next.playerBody, gmBody: next.gmBody,
      /* Sent EXACTLY as rendered — order is content, and a blank row is a row the GM is in the middle
         of writing, not junk to tidy away. */
      objectives: next.objectives,
      // Always sent, never omitted: omitting `entityIds` leaves the stored list alone, so unlinking the
      // last page has to travel as an explicit empty array (the journal's `tags` contract exactly).
      entityIds: next.entityIds, tags: next.tags,
      expectedRev: revRef.current
    });
    revRef.current = updated.rev;
    setError(null);
    await onChanged();
  }, [gmToken, quest.id, onChanged]);

  const { status: saveStatus, dirty, flush } = useCodexAutosave<QuestDraft>({
    settings: autosave, draft, save: write,
    onConflict: async () => { revRef.current = (await questApi.get(gmToken, quest.id)).rev; }
  });
  useEffect(() => { if (saveStatus === "error") setError("Couldn't save the quest."); }, [saveStatus]);

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
          <SaveState status={saveStatus} onRetry={() => void flush()} onReload={() => void flush()} />
          {!autosave.enabled && <Button variant="primary" size="sm" disabled={!dirty} onClick={() => void flush()}>Save</Button>}
          <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
          <RevealSwitch revealed={quest.revealedToPlayers} onChange={reveal} ariaLabel="Show this quest to players" />
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="codex-composer-meta">
        <Field label="Quest" htmlFor="q-title"><Input id="q-title" value={draft.title} placeholder="Untitled quest" onChange={(event) => patch({ title: event.target.value })} /></Field>
        {/* D11: the server writes a dated Journal record on every status change, so the control says so. */}
        <Field label="Status" htmlFor="q-status" help="Only Active quests appear on Home. Status changes are recorded in the Journal.">
          <Select id="q-status" value={draft.status} onChange={(event) => patch({ status: event.target.value as CodexQuestStatus })}>
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
        <p className="codex-inspector-hint">Objectives are shown to players whenever the quest is.</p>
        <Checklist items={draft.objectives} ariaLabel="Objectives" max={24}
          onChange={(objectives: readonly CodexQuestObjective[]) => patch({ objectives })}
          /* The CALLER appends, because the caller owns what a blank item means here: a fresh row the GM
             is about to type into, which the server accepts precisely so this flow works. */
          onAdd={() => patch({ objectives: [...draft.objectives, { text: "", done: false }] })}
          addLabel="Add objective" />
      </div>

      {/* D10: quests are taggable, on the same vocabulary and the same slug rules pages use. */}
      <Field label="Tags" htmlFor="q-tags">
        <TagInput id="q-tags" ariaLabel="Tags" placeholder="main-arc, faction" values={draft.tags}
          onChange={(tags: readonly string[]) => patch({ tags })} max={24} maxReachedReason="A quest may carry at most 24 tags." />
      </Field>
      {onPickTag && draft.tags.length > 0 && (
        <div className="codex-editor-tagjumps">
          {draft.tags.map((tag) => <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => onPickTag(tag)}>{tag}</button>)}
        </div>
      )}

      {/* D13: the SAME writing surface a page body gets, so a quest body renders as markdown for the
          party instead of as the deliberate plain text it used to be. */}
      <Field label="What the party was told" help="Players see this once the quest is shown to them." htmlFor="q-player">
        <CodexEditor id="q-player" token={gmToken} value={draft.playerBody} onChange={(playerBody) => patch({ playerBody })}
          ariaLabel="What the party was told" placeholder="What players have been told about this quest"
          pages={pages} onNavigate={() => undefined} rows={7} />
      </Field>

      {/* R5: GM-only content is ALWAYS the violet block plus the "GM only" pill — the same pair the
          journal composer, the page editor and the session log use, never a new marking of its own. */}
      <Field label={<span className="codex-composer-gm-label">GM notes <GmOnlyTag /></span>} htmlFor="q-gm">
        <CodexEditor id="q-gm" token={gmToken} value={draft.gmBody} onChange={(gmBody) => patch({ gmBody })}
          ariaLabel="GM notes" placeholder="Details players cannot see"
          pages={pages} onNavigate={() => undefined} gmLayer rows={7} />
      </Field>

      <Field label="Pages this quest concerns" help="Players see only the pages already shown to them.">
        <div className="codex-quest-links">
          {linked.map((page) => (
            <div key={page.id} className="codex-quest-link">
              <button type="button" className="codex-quest-link-open" onClick={() => onOpenPage(page.id)}>
                <EntityIcon type={page.entityType} /> <span className="codex-list-title">{page.title}</span>
              </button>
              <IconButton label={`Unlink ${page.title}`} size="sm" onClick={() => patch({ entityIds: draft.entityIds.filter((id) => id !== page.id) })}><IconX /></IconButton>
            </div>
          ))}
          <Combobox options={unlinked.map((page) => ({ id: page.id, label: page.title, icon: <EntityIcon type={page.entityType} /> }))}
            value={null} onChange={(id) => id && patch({ entityIds: [...draft.entityIds, id] })}
            ariaLabel="Link a page" placeholder="Link a page" />
        </div>
      </Field>

      <div className="codex-composer-foot">
        <Button variant="ghost" size="sm" onClick={remove}>Delete quest</Button>
      </div>
      {confirmDialog}
    </Panel>
  );
}
