import { useCallback, useMemo } from "react";
import { Badge, Skeleton, VisibilityBadge } from "@vtt/ui";
import type { CodexJournalPayload, CodexQuestStatus, PlayerCodexJournalPayload } from "@vtt/domain";
import { codexApi, playerCodexApi } from "./api";
import { chronicleRowSummary, type ChroniclePayloadRef } from "./chronicle";
import { sessionTitle, type SessionRef } from "./sessions";
import { QUEST_STATUS_LABEL, questStatusTone } from "./quests";
import type { EntityType } from "./entities";
import { CodexIcon, EntityIcon } from "./icons";
import { useCodexSearch } from "./SearchResults";
import { atlasPath, journalEntryPath, pagePath, questPath, sessionPath } from "./routes";

/**
 * Everything carrying a tag. Composed client-side from the shell's feeds, filtered by exact slug; pins load
 * per map, so they come from the search route, exact-matched on their tags, with truncation reported.
 *
 * Row shapes are the minimum this view reads, with `revealedToPlayers` optional, so player projections
 * satisfy them unchanged and a missing field simply means no badge.
 */
export type TagPageRef = Readonly<{
  id: string;
  title: string;
  entityType: EntityType;
  tags: readonly string[];
  revealedToPlayers?: boolean;
}>;
export type TagMapRef = Readonly<{ id: string; name: string; tags: readonly string[]; revealedToPlayers?: boolean }>;
export type TagRecordRef = ChroniclePayloadRef<CodexJournalPayload | PlayerCodexJournalPayload> &
  Readonly<{ id: string; text: string; gmText?: string | null; tags: readonly string[]; revealedToPlayers?: boolean }>;
export type TagSessionRef = SessionRef & Readonly<{ tags: readonly string[]; revealedToPlayers?: boolean }>;
export type TagQuestRef = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  tags: readonly string[];
  revealedToPlayers?: boolean;
}>;

export type TagViewProps = Readonly<{
  gmToken: string;
  tag: string;
  pages: readonly TagPageRef[];
  maps: readonly TagMapRef[];
  records: readonly TagRecordRef[];
  sessions: readonly TagSessionRef[];
  quests: readonly TagQuestRef[];
  onNavigate: (path: string) => void;
  /** The player shell reads through `playerCodexApi`, never the GM search. */
  player?: boolean;
}>;

export function TagView({
  gmToken,
  tag,
  pages,
  maps,
  records,
  sessions,
  quests,
  onNavigate,
  player = false
}: TagViewProps) {
  const slug = tag.trim().toLowerCase();
  const runSearch = useCallback(
    (query: string) => (player ? playerCodexApi.search(gmToken, query) : codexApi.search(gmToken, query)),
    [gmToken, player]
  );
  const pinSearch = useCodexSearch(slug, runSearch);

  const taggedPages = useMemo(() => pages.filter((page) => page.tags.includes(slug)), [pages, slug]);
  const taggedMaps = useMemo(() => maps.filter((map) => map.tags.includes(slug)), [maps, slug]);
  const taggedRecords = useMemo(() => records.filter((record) => record.tags.includes(slug)), [records, slug]);
  const taggedSessions = useMemo(() => sessions.filter((session) => session.tags.includes(slug)), [sessions, slug]);
  const taggedQuests = useMemo(() => quests.filter((quest) => quest.tags.includes(slug)), [quests, slug]);
  const pins =
    pinSearch.status === "ready"
      ? pinSearch.hits.filter((hit) => hit.kind === "marker" && hit.tags.includes(slug))
      : [];
  const truncated = pinSearch.status === "ready" && pinSearch.truncated;

  const total =
    taggedPages.length +
    taggedMaps.length +
    taggedRecords.length +
    taggedSessions.length +
    taggedQuests.length +
    pins.length;

  return (
    <div className="codex-tagview">
      <h3 className="codex-campaign-h codex-tagview-h">#{slug}</h3>
      {total === 0 && pinSearch.status !== "loading" && (
        <p className="codex-list-empty">Nothing carries this tag yet.</p>
      )}

      {taggedPages.length > 0 && (
        <section className="codex-campaign-section">
          <h4 className="codex-campaign-h">Pages</h4>
          <nav className="codex-campaign-recent" aria-label="Pages with this tag">
            {taggedPages.map((page) => (
              <button
                key={page.id}
                type="button"
                className="codex-campaign-recentitem"
                onClick={() => onNavigate(pagePath(page.id))}
              >
                <EntityIcon type={page.entityType} className="codex-campaign-recentglyph" />
                <span className="codex-list-title">{page.title}</span>
                {page.revealedToPlayers !== undefined && <VisibilityBadge revealed={page.revealedToPlayers} />}
              </button>
            ))}
          </nav>
        </section>
      )}

      {taggedMaps.length > 0 && (
        <section className="codex-campaign-section">
          <h4 className="codex-campaign-h">Maps</h4>
          <nav className="codex-campaign-recent" aria-label="Maps with this tag">
            {taggedMaps.map((map) => (
              <button
                key={map.id}
                type="button"
                className="codex-campaign-recentitem"
                onClick={() => onNavigate(atlasPath(map.id))}
              >
                <CodexIcon iconId="compass" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{map.name}</span>
                {map.revealedToPlayers !== undefined && <VisibilityBadge revealed={map.revealedToPlayers} />}
              </button>
            ))}
          </nav>
        </section>
      )}

      <section className="codex-campaign-section">
        <h4 className="codex-campaign-h">Pins</h4>
        {pinSearch.status === "loading" && (
          <div className="codex-list-loading">
            {[0, 1].map((row) => (
              <Skeleton key={row} variant="text" />
            ))}
          </div>
        )}
        {pinSearch.status === "ready" && pins.length === 0 && (
          <p className="codex-list-empty">No pins carry this tag.</p>
        )}
        {pins.length > 0 && (
          <nav className="codex-campaign-recent" aria-label="Pins with this tag">
            {pins.map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="codex-campaign-recentitem"
                onClick={() => onNavigate(atlasPath(hit.mapId, hit.id))}
              >
                <CodexIcon iconId="pin" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{hit.title || "Unlabelled pin"}</span>
              </button>
            ))}
          </nav>
        )}
        {truncated && (
          <p className="codex-composer-hint">
            More pins may carry this tag. Filter by tag in the Atlas to see all of them.
          </p>
        )}
      </section>

      {taggedRecords.length > 0 && (
        <section className="codex-campaign-section">
          <h4 className="codex-campaign-h">Journal entries</h4>
          <nav className="codex-campaign-recent" aria-label="Journal entries with this tag">
            {taggedRecords.map((record) => (
              <button
                key={`${record.kind}-${record.id}`}
                type="button"
                className="codex-campaign-recentitem"
                onClick={() => onNavigate(journalEntryPath(record.id))}
              >
                <CodexIcon iconId="book" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{chronicleRowSummary(record) || "Untitled entry"}</span>
                {record.revealedToPlayers !== undefined && <VisibilityBadge revealed={record.revealedToPlayers} />}
              </button>
            ))}
          </nav>
        </section>
      )}

      {taggedSessions.length > 0 && (
        <section className="codex-campaign-section">
          <h4 className="codex-campaign-h">Sessions</h4>
          <nav className="codex-campaign-recent" aria-label="Sessions with this tag">
            {taggedSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className="codex-campaign-recentitem"
                onClick={() => onNavigate(sessionPath(session.id))}
              >
                <CodexIcon iconId="sessions" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{sessionTitle(session)}</span>
                {session.revealedToPlayers !== undefined && <VisibilityBadge revealed={session.revealedToPlayers} />}
              </button>
            ))}
          </nav>
        </section>
      )}

      {taggedQuests.length > 0 && (
        <section className="codex-campaign-section">
          <h4 className="codex-campaign-h">Quests</h4>
          <nav className="codex-campaign-recent" aria-label="Quests with this tag">
            {taggedQuests.map((quest) => (
              <button
                key={quest.id}
                type="button"
                className="codex-campaign-recentitem"
                onClick={() => onNavigate(questPath(quest.id))}
              >
                <CodexIcon iconId="quest" className="codex-ent-icon codex-campaign-recentglyph" />
                <span className="codex-list-title">{quest.title}</span>
                {/* The status label, never the wire value. */}
                <Badge tone={questStatusTone(quest.status)}>{QUEST_STATUS_LABEL[quest.status]}</Badge>
                {quest.revealedToPlayers !== undefined && <VisibilityBadge revealed={quest.revealedToPlayers} />}
              </button>
            ))}
          </nav>
        </section>
      )}
    </div>
  );
}
