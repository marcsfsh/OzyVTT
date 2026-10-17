import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checklist,
  Combobox,
  Field,
  IconButton,
  IconChevron,
  IconPlus,
  IconX,
  Input,
  RevealSwitch,
  SaveState,
  Select,
  Skeleton,
  TagInput,
  VisibilityBadge
} from "@vtt/ui";
import type { CodexAutosaveSettings, CodexQuest, CodexQuestObjective, CodexQuestStatus } from "@vtt/domain";
import { questApi } from "./api";
import { QUEST_STATUS_LABEL, QUEST_STATUS_ORDER, questProgress, questStatusTone } from "./quests";
import { createQuest } from "./creates";
import { CodexEditor } from "./CodexEditor";
import { BODY_LAYER, TwoLayerBodyTabs, type BodyLayer } from "./TwoLayerBodyTabs";
import { CodexIcon, EntityIcon } from "./icons";
import { useCodexAutosave } from "./autosave";
import { useConfirm } from "../components/feedback";
import type { EntityType } from "./entities";

/**
 * The quest log, the one place a quest is edited. It owns no feed: the shell's single quest list is
 * handed down here and to Home, and every write reports through `onChanged` for a re-read.
 */
type QuestPage = Readonly<{ id: string; title: string; entityType: EntityType }>;

type QuestsViewProps = Readonly<{
  gmToken: string;
  quests: readonly CodexQuest[];
  /** The shell's page list, for the linked-entity picker. */
  pages: readonly QuestPage[];
  /** The feed is still loading, so an empty list isn't "no quests" yet. */
  loading: boolean;
  /** The feed's own failure, so it doesn't render as an empty log. */
  error: string | null;
  /** The open quest comes from the address (`/codex/quests/:id`). */
  openQuestId?: string | null;
  /** Filters live in the address too (`?q=`, `?status=`). */
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

export function QuestsView({
  gmToken,
  quests,
  pages,
  loading,
  error,
  openQuestId = null,
  onOpenQuest,
  onChanged,
  onOpenPage,
  autosave,
  onPickTag,
  filter = "",
  statusFilter = null,
  onFilterChange
}: QuestsViewProps) {
  const [listError, setListError] = useState<string | null>(null);

  const selected = openQuestId ? (quests.find((quest) => quest.id === openQuestId) ?? null) : null;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return quests.filter(
      (quest) =>
        (!statusFilter || quest.status === statusFilter) &&
        (!needle || quest.title.toLowerCase().includes(needle) || quest.tags.some((tag) => tag.includes(needle)))
    );
  }, [quests, filter, statusFilter]);

  const create = async () => {
    setListError(null);
    try {
      // The same create the palette's "New quest" runs.
      const quest = await createQuest(gmToken);
      await onChanged();
      onOpenQuest(quest.id);
    } catch (createError) {
      setListError(createError instanceof Error ? createError.message : "Couldn't create the quest.");
    }
  };

  return (
    <>
      <div className={`codex-workspace${selected ? " has-selection" : ""}`}>
        <aside className="codex-rail">
          <div className="codex-rail-head">
            <Input
              value={filter}
              placeholder="Filter quests"
              aria-label="Filter quests"
              onChange={(event) => onFilterChange?.({ q: event.target.value || null })}
            />
            {/* One primary per view: the rail's create steps down when the editor's Save (autosave off) is primary. */}
            <Button variant={selected && !autosave.enabled ? "secondary" : "primary"} size="sm" onClick={create}>
              <IconPlus /> New
            </Button>
          </div>
          <div className="codex-rail-tools">
            <Select
              aria-label="Filter by status"
              value={statusFilter ?? ""}
              onChange={(event) => onFilterChange?.({ status: event.target.value || null })}
            >
              <option value="">All quests</option>
              {/* Built from `QUEST_STATUS_ORDER` so filter and editor offer the same statuses. */}
              {QUEST_STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {QUEST_STATUS_LABEL[status]}
                </option>
              ))}
            </Select>
          </div>
          {listError && <Alert tone="danger">{listError}</Alert>}
          <nav className="codex-list scroll-y" aria-label="Quests">
            {loading && (
              <div className="codex-list-loading">
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} variant="text" />
                ))}
              </div>
            )}
            {!loading && quests.length === 0 && !error && (
              <p className="codex-list-empty">No quests yet. Create one to start tracking objectives.</p>
            )}
            {!loading && quests.length > 0 && shown.length === 0 && (
              <p className="codex-list-empty">No quests match.</p>
            )}
            {shown.map((quest) => (
              /* `aria-current` too, so the selection survives without styles. */
              <button
                key={quest.id}
                type="button"
                aria-current={quest.id === selected?.id ? "true" : undefined}
                className={`codex-quest-row${quest.id === selected?.id ? " is-active" : ""}`}
                onClick={() => onOpenQuest(quest.id)}
              >
                <CodexIcon iconId="quest" className="codex-ent-icon codex-quest-rowglyph" />
                <span className="codex-list-title">{quest.title}</span>
                <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
                <VisibilityBadge revealed={quest.revealedToPlayers} />
              </button>
            ))}
          </nav>
        </aside>

        <section className="codex-main scroll-y">
          {selected && (
            <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpenQuest(null)}>
              <IconChevron className="codex-chevron-left" aria-hidden="true" />
              All quests
            </Button>
          )}
          {/* The feed's own failure, distinct from a campaign with no quests. */}
          {error && (
            <Alert tone="danger" title="Couldn't load the quests">
              {error}
            </Alert>
          )}
          {selected ? (
            <QuestEditor
              key={selected.id}
              gmToken={gmToken}
              quest={selected}
              pages={pages}
              autosave={autosave}
              onPickTag={onPickTag}
              onChanged={onChanged}
              onOpenPage={onOpenPage}
              onDeleted={() => {
                onOpenQuest(null);
                void onChanged();
              }}
            />
          ) : (
            !loading &&
            !error && (
              <div className="codex-main-empty">
                <h3>No quest selected</h3>
                <p>
                  A quest holds objectives, the text players read, and GM-only notes. Once a quest is shown to players,
                  its active state appears on their dashboard.
                </p>
                <Button variant="primary" onClick={create}>
                  New quest
                </Button>
              </div>
            )
          )}
        </section>
      </div>
    </>
  );
}

/**
 * One quest's layers, objectives and links. Keyed on the quest id by its caller, so switching quests
 * gets a fresh draft. Autosaves (ticking an objective included); `expectedRev` still guards with 409.
 */
type QuestDraft = Readonly<{
  title: string;
  status: CodexQuestStatus;
  playerBody: string;
  gmBody: string;
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
  tags: readonly string[];
}>;

/** A quest uses the page editor's shape: one body at a time behind `TwoLayerBodyTabs`, everything else behind Details. */
const QUEST_DETAILS_KEY = "codex-quest-details";
const QUEST_DETAILS_ID = "codex-quest-details";

function QuestEditor({
  gmToken,
  quest,
  pages,
  autosave,
  onPickTag,
  onChanged,
  onOpenPage,
  onDeleted
}: Readonly<{
  gmToken: string;
  quest: CodexQuest;
  pages: readonly QuestPage[];
  autosave: CodexAutosaveSettings;
  onPickTag?: (tag: string) => void;
  onChanged: () => void | Promise<void>;
  onOpenPage: (pageId: string) => void;
  onDeleted: () => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [tab, setTab] = useState<BodyLayer>("player");
  const detailsRef = useRef<HTMLElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      return localStorage.getItem(QUEST_DETAILS_KEY) === "open";
    } catch {
      return false;
    }
  });
  const showDetails = useCallback((open: boolean) => {
    setDetailsOpen(open);
    try {
      localStorage.setItem(QUEST_DETAILS_KEY, open ? "open" : "closed");
    } catch {
      /* private mode - fine */
    }
  }, []);
  useEffect(() => {
    if (detailsOpen) detailsRef.current?.focus();
  }, [detailsOpen]);
  const [draft, setDraft] = useState<QuestDraft>({
    title: quest.title,
    status: quest.status,
    playerBody: quest.playerBody,
    gmBody: quest.gmBody,
    objectives: quest.objectives,
    entityIds: quest.entityIds,
    tags: quest.tags
  });
  const [error, setError] = useState<string | null>(null);
  const revRef = useRef(quest.rev);
  const patch = (next: Partial<QuestDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const linked = draft.entityIds
    .map((id) => pages.find((page) => page.id === id))
    .filter((page): page is QuestPage => Boolean(page));
  const unlinked = pages.filter((page) => !draft.entityIds.includes(page.id));
  const progress = questProgress(draft.objectives);

  const write = useCallback(
    async (next: QuestDraft) => {
      const updated = await questApi.update(gmToken, quest.id, {
        // Like `PageEditor`: the route rejects an empty title with a message a GM shouldn't read.
        title: next.title.trim() || "Untitled quest",
        status: next.status,
        playerBody: next.playerBody,
        gmBody: next.gmBody,
        /* Sent exactly as rendered: order is content and a blank row is one the GM is still writing. */
        objectives: next.objectives,
        // Always sent: omitting `entityIds` keeps the stored list, so unlinking the last page needs `[]`.
        entityIds: next.entityIds,
        tags: next.tags,
        expectedRev: revRef.current
      });
      revRef.current = updated.rev;
      setError(null);
      await onChanged();
    },
    [gmToken, quest.id, onChanged]
  );

  const {
    status: saveStatus,
    dirty,
    flush
  } = useCodexAutosave<QuestDraft>({
    settings: autosave,
    draft,
    save: write,
    onConflict: async () => {
      revRef.current = (await questApi.get(gmToken, quest.id)).rev;
    }
  });
  useEffect(() => {
    if (saveStatus === "error") setError("Couldn't save the quest.");
  }, [saveStatus]);

  const reveal = async (revealed: boolean) => {
    setError(null);
    // Its own route: revealing isn't an edit (no `expectedRev`, no `rev` bump, no `updatedAt` change).
    try {
      await questApi.reveal(gmToken, quest.id, revealed);
      await onChanged();
    } catch {
      setError("Couldn't change who can see this quest.");
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: "Delete quest",
        body: `Delete “${quest.title}”? Its objectives and your GM-only notes are lost. Pages it links to are not deleted.`,
        confirmLabel: "Delete",
        danger: true
      }))
    )
      return;
    try {
      await questApi.remove(gmToken, quest.id);
      onDeleted();
    } catch {
      setError("Couldn't delete the quest.");
    }
  };

  return (
    <div className="codex-editor codex-quest-editor">
      <div className="codex-editor-head">
        <div className="codex-editor-titlewrap">
          <Input
            variant="title"
            className="codex-title-input"
            value={draft.title}
            placeholder="Untitled quest"
            aria-label="Quest"
            onChange={(event) => patch({ title: event.target.value })}
          />
        </div>
        <div className="codex-editor-actions">
          <SaveState status={saveStatus} onRetry={() => void flush()} onReload={() => void flush()} />
          {!autosave.enabled && (
            <Button variant="primary" size="sm" disabled={!dirty} onClick={() => void flush()}>
              Save
            </Button>
          )}
          <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
          <RevealSwitch
            revealed={quest.revealedToPlayers}
            onChange={reveal}
            ariaLabel="Show this quest to players"
            labelled
          />
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={detailsOpen}
            aria-controls={QUEST_DETAILS_ID}
            onClick={() => showDetails(!detailsOpen)}
          >
            Details
          </Button>
          <Button variant="ghost" size="sm" onClick={remove}>
            Delete
          </Button>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="codex-editor-cols">
        <div className="codex-editor-center">
          <TwoLayerBodyTabs value={tab} onChange={setTab} />
          {/* The same editor as a page body; the GM layer keeps its violet block and "GM only" pill. */}
          {tab === "player" ? (
            <CodexEditor
              id="q-player"
              token={gmToken}
              value={draft.playerBody}
              onChange={(playerBody) => patch({ playerBody })}
              fill
              ariaLabel={BODY_LAYER.player.label}
              placeholder="What players have been told about this quest"
              pages={pages}
              onNavigate={() => undefined}
            />
          ) : (
            <CodexEditor
              id="q-gm"
              token={gmToken}
              value={draft.gmBody}
              onChange={(gmBody) => patch({ gmBody })}
              fill
              ariaLabel={BODY_LAYER.gm.label}
              placeholder="Details players cannot see"
              pages={pages}
              onNavigate={() => undefined}
              gmLayer
            />
          )}
          <p className="codex-composer-hint">
            {tab === "player"
              ? "Players see this once the quest is shown to them."
              : "Never sent to a player, whatever the quest's reveal state."}
          </p>
        </div>

        {detailsOpen && (
          <aside
            id={QUEST_DETAILS_ID}
            className="codex-editor-context scroll-y"
            aria-label="Quest details"
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
              <h3 className="codex-backlinks-title">Quest details</h3>
              <IconButton label="Close quest details" size="sm" onClick={() => showDetails(false)}>
                <IconX />
              </IconButton>
            </div>

            {/* The server records each status change in the Journal; the help names the statuses that drop off Home. */}
            <Field
              label="Status"
              htmlFor="q-status"
              help="Completed, Failed and Canceled quests drop off Home. Status changes are recorded in the Journal."
            >
              <Select
                id="q-status"
                value={draft.status}
                onChange={(event) => patch({ status: event.target.value as CodexQuestStatus })}
              >
                {QUEST_STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {QUEST_STATUS_LABEL[status]}
                  </option>
                ))}
              </Select>
            </Field>

            {/* No `Field`: a checklist has no single control to label, so it names itself via `ariaLabel`. */}
            <div className="codex-quest-objectives">
              <div className="codex-quest-objectives-head">
                <h4 className="codex-quest-subhead">Objectives</h4>
                {progress.total > 0 && <span className="codex-quest-progress">{progress.label}</span>}
              </div>
              <p className="codex-inspector-hint">Objectives are shown to players whenever the quest is.</p>
              <Checklist
                items={draft.objectives}
                ariaLabel="Objectives"
                max={24}
                onChange={(objectives: readonly CodexQuestObjective[]) => patch({ objectives })}
                /* The caller appends the blank row the GM is about to type into. */
                onAdd={() => patch({ objectives: [...draft.objectives, { text: "", done: false }] })}
                addLabel="Add objective"
              />
            </div>

            <Field label="Tags" htmlFor="q-tags">
              <TagInput
                id="q-tags"
                ariaLabel="Tags"
                placeholder="main-arc, faction"
                values={draft.tags}
                onChange={(tags: readonly string[]) => patch({ tags })}
                max={24}
                maxReachedReason="A quest may carry at most 24 tags."
              />
            </Field>
            {onPickTag && draft.tags.length > 0 && (
              <div className="codex-editor-tagjumps">
                {draft.tags.map((tag) => (
                  <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => onPickTag(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            )}

            <Field label="Pages this quest concerns" help="Players see only the pages already shown to them.">
              <div className="codex-quest-links">
                {linked.map((page) => (
                  <div key={page.id} className="codex-quest-link">
                    <button type="button" className="codex-quest-link-open" onClick={() => onOpenPage(page.id)}>
                      <EntityIcon type={page.entityType} /> <span className="codex-list-title">{page.title}</span>
                    </button>
                    <IconButton
                      label={`Unlink ${page.title}`}
                      size="sm"
                      onClick={() => patch({ entityIds: draft.entityIds.filter((id) => id !== page.id) })}
                    >
                      <IconX />
                    </IconButton>
                  </div>
                ))}
                <Combobox
                  options={unlinked.map((page) => ({
                    id: page.id,
                    label: page.title,
                    icon: <EntityIcon type={page.entityType} />
                  }))}
                  value={null}
                  onChange={(id) => id && patch({ entityIds: [...draft.entityIds, id] })}
                  ariaLabel="Link a page"
                  placeholder="Link a page"
                />
              </div>
            </Field>
          </aside>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
