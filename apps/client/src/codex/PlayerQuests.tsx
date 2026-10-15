import { useMemo } from "react";
import { Badge, Button, Checklist, IconChevron, Input, Select, Skeleton } from "@vtt/ui";
import type { PlayerCodexPageSummary, PlayerCodexQuest } from "@vtt/domain";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexIcon, EntityIcon } from "./icons";
import { QUEST_STATUS_LABEL, questProgress, questStatusTone } from "./quests";

/** Revealed quests, open and finished alike, with the pages each concerns. */
export function PlayerQuests({
  quests,
  pages,
  loading,
  openId,
  token,
  onOpen,
  onOpenPage,
  onNavigate,
  knownTitles,
  filter,
  statusFilter,
  onFilterChange
}: Readonly<{
  quests: readonly PlayerCodexQuest[];
  pages: readonly PlayerCodexPageSummary[];
  loading: boolean;
  openId: string | null;
  token: string;
  onOpen: (id: string | null) => void;
  onOpenPage: (pageId: string) => void;
  onNavigate: (target: string) => void;
  knownTitles: ReadonlySet<string>;
  /** The GM's quest filters over the player's feed; `status` is player-facing on a quest. */
  filter: string;
  statusFilter: string | null;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
}>) {
  const open = openId ? (quests.find((quest) => quest.id === openId) ?? null) : null;
  const questPages = (open?.entityIds ?? [])
    .map((id) => pages.find((summary) => summary.id === id))
    .filter((summary): summary is PlayerCodexPageSummary => Boolean(summary));
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return quests.filter(
      (quest) =>
        (!statusFilter || quest.status === statusFilter) &&
        (!needle || quest.title.toLowerCase().includes(needle) || quest.tags.some((tag) => tag.includes(needle)))
    );
  }, [quests, filter, statusFilter]);
  return (
    <div className={`codex-workspace${open ? " has-selection" : ""}`}>
      <aside className="codex-rail">
        <div className="codex-rail-head">
          <Input
            value={filter}
            placeholder="Filter quests"
            aria-label="Filter quests"
            onChange={(event) => onFilterChange({ q: event.target.value || null })}
          />
        </div>
        <div className="codex-rail-tools">
          <Select
            aria-label="Filter by status"
            value={statusFilter ?? ""}
            onChange={(event) => onFilterChange({ status: event.target.value || null })}
          >
            <option value="">All quests</option>
            <option value="active">{QUEST_STATUS_LABEL.active}</option>
            <option value="completed">{QUEST_STATUS_LABEL.completed}</option>
            <option value="failed">{QUEST_STATUS_LABEL.failed}</option>
          </Select>
        </div>
        <nav className="codex-list scroll-y" aria-label="Quests">
          {loading && quests.length === 0 && (
            <div className="codex-list-loading">
              {[0, 1].map((row) => (
                <Skeleton key={row} variant="text" />
              ))}
            </div>
          )}
          {!loading && quests.length === 0 && <p className="codex-list-empty">No quests shared yet.</p>}
          {!loading && quests.length > 0 && shown.length === 0 && <p className="codex-list-empty">No quests match.</p>}
          {shown.map((quest) => (
            <button
              key={quest.id}
              type="button"
              aria-current={quest.id === open?.id ? "true" : undefined}
              className={`codex-quest-row${quest.id === open?.id ? " is-active" : ""}`}
              onClick={() => onOpen(quest.id)}
            >
              <CodexIcon iconId="quest" className="codex-ent-icon codex-quest-rowglyph" />
              <span className="codex-list-title">{quest.title}</span>
              <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
            </button>
          ))}
        </nav>
      </aside>
      <section className="codex-main scroll-y">
        {open && (
          <Button variant="ghost" size="sm" className="codex-back" onClick={() => onOpen(null)}>
            <IconChevron className="codex-chevron-left" aria-hidden="true" />
            All quests
          </Button>
        )}
        {open ? (
          <article className="codex-reader">
            <h2 className="codex-reader-title">
              <CodexIcon iconId="quest" className="codex-reader-titleicon codex-quest-rowglyph" />
              {open.title}
            </h2>
            <div className="codex-entry-meta">
              <Badge tone={questStatusTone(open.status)}>{QUEST_STATUS_LABEL[open.status]}</Badge>
              {open.objectives.length > 0 && (
                <span className="codex-quest-progress">{questProgress(open.objectives).label}</span>
              )}
            </div>
            <div className="codex-reader-body">
              {open.body.trim() ? (
                <CodexMarkdown text={open.body} onNavigate={onNavigate} token={token} knownTitles={knownTitles} />
              ) : (
                <p className="codex-preview-empty">Nothing written here yet.</p>
              )}
            </div>
            {open.objectives.length > 0 && (
              <div className="codex-quest-objectives">
                <h4 className="codex-quest-subhead">Objectives</h4>
                {/* Read-only: without `onChange` the primitive renders nothing focusable. */}
                <Checklist items={open.objectives} ariaLabel={`Objectives for ${open.title}`} />
              </div>
            )}
            {questPages.length > 0 && (
              <div className="codex-reader-rels">
                <h4 className="codex-backlinks-title">What this concerns</h4>
                <div className="codex-quest-links">
                  {questPages.map((summary) => (
                    <button
                      key={summary.id}
                      type="button"
                      className="codex-quest-link-open"
                      onClick={() => onOpenPage(summary.id)}
                    >
                      {summary.entityType !== "note" && <EntityIcon type={summary.entityType} />}
                      <span className="codex-list-title">{summary.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        ) : (
          <div className="codex-main-empty">
            <h3>No quest selected</h3>
            <p>Quests your GM has shown to the party appear here, open and finished alike.</p>
          </div>
        )}
      </section>
    </div>
  );
}
