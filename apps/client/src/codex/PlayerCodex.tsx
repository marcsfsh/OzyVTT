import { useCallback, useMemo, useState } from "react";
import { Alert } from "@vtt/ui";
import {
  formatWorldDate,
  type CodexSearchHit,
  type PlayerCodexPageSummary,
  type PlayerCodexStanding
} from "@vtt/domain";
import { playerCodexApi } from "./api";
import { pickNextSession } from "./sessions";
import { CampaignHome } from "./CampaignHome";
import { ConnectionGraph } from "./RelationshipGraph";
import { PlayerCalendarView } from "./CalendarView";
import { PlayerDowntimeView } from "./DowntimeView";
import { CommandPalette } from "./CommandPalette";
import { CodexFrame } from "./CodexFrame";
import { PlayerAtlas } from "./PlayerAtlas";
import { PlayerJournal } from "./PlayerJournal";
import { PlayerPages } from "./PlayerPages";
import { PlayerQuests } from "./PlayerQuests";
import { PlayerSessions } from "./PlayerSessions";
import { TagView } from "./TagView";
import { NotFoundView } from "../components/NotFoundView";
import { playerCampaignFeedProps } from "./dashboard";
import { useCodexQuery } from "./useCodexQuery";
import {
  PLAYER_SIDEBAR,
  SECTION_TITLE,
  atlasPath,
  codexSectionOf,
  journalEntryPath,
  pagePath,
  pathForHit,
  pathForSection,
  questPath,
  recordIdOf,
  sessionPath,
  tagPath
} from "./routes";
import { navigate, replaceQuery, useRoute, withQuery } from "../router";
import "./codex.css";

/**
 * The player Codex: the GM's navigation minus the Tools group, at the same addresses.
 *
 * Viewer safety: every read goes through `playerCodexApi`, never the GM feeds, so everything rendered is
 * a field the server chose to send this player's token. Reading rules come from `chronicle.ts` so both
 * journals agree on what a row says.
 */
const PLAYER_SIDEBAR_KEY = "codex-player-sidebar";
/** A stable empty feed, so a list that has not loaded yet keeps one identity across renders. */
const EMPTY: readonly never[] = [];

export function PlayerCodex({ token, embedded = false }: Readonly<{ token: string; embedded?: boolean }>) {
  /**
   * The GM's "Preview as player" mounts this in a modal with a real player token. Embedded, it runs on a
   * local route so it never drives the browser address.
   */
  const globalRoute = useRoute();
  const [localPath, setLocalPath] = useState("/codex");
  const path = embedded ? localPath.split("?")[0] : globalRoute.path;
  const query = useMemo(
    () => (embedded ? new URLSearchParams(localPath.split("?")[1] ?? "") : globalRoute.query),
    [embedded, localPath, globalRoute.query]
  );
  const go = useCallback(
    (next: string) => {
      if (embedded) setLocalPath(next);
      else navigate(next);
    },
    [embedded]
  );
  const setQuery = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      if (!embedded) {
        replaceQuery(mutate);
        return;
      }
      const [base, search] = localPath.split("?");
      const params = new URLSearchParams(search ?? "");
      mutate(params);
      const next = params.toString();
      setLocalPath(next ? `${base}?${next}` : base);
    },
    [embedded, localPath]
  );

  const segments = path.split("/").filter(Boolean);
  const section = codexSectionOf(segments);
  const recordId = recordIdOf(segments);
  /** A GM-only address renders the not-found view, identical to an unknown address, so it confirms nothing. */
  const gmOnly = section === "audit" || section === "backup" || section === "settings";

  /** Every player feed at once, refreshed on the shared ping. */
  const feed = useCodexQuery(
    useCallback(async () => {
      const [pages, maps, timeline, connections, calendar, sessions, quests, standing, party] = await Promise.all([
        playerCodexApi.listPages(token),
        playerCodexApi.listMaps(token),
        playerCodexApi.chronicle(token),
        playerCodexApi.listConnections(token),
        // A missing calendar shouldn't cost the player the whole codex.
        playerCodexApi.calendar(token).catch(() => null),
        playerCodexApi.sessions(token).catch(() => []),
        playerCodexApi.quests(token).catch(() => []),
        playerCodexApi.standing(token).catch(() => []),
        // null covers both "no party pin" and "hidden from you", deliberately indistinguishable.
        playerCodexApi.party(token).catch(() => null)
      ]);
      return { pages, maps, timeline, connections, calendar, sessions, quests, standing, party };
    }, [token])
  );
  const pages = feed.data?.pages ?? EMPTY;
  const maps = feed.data?.maps ?? EMPTY;
  const timeline = feed.data?.timeline ?? EMPTY;
  const connections = feed.data?.connections ?? EMPTY;
  const calendar = feed.data?.calendar ?? null;
  const sessions = feed.data?.sessions ?? EMPTY;
  const quests = feed.data?.quests ?? EMPTY;
  const standing = feed.data?.standing ?? EMPTY;
  const party = feed.data?.party ?? null;
  const loading = feed.loading;
  const error = feed.error && "Couldn't load the Codex. Check your connection and try again.";
  const [search, setSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Filters live in the address like the GM's, via `setQuery` so the embedded preview keeps its own route. */
  const textFilter = query.get("q") ?? "";
  const statusFilter = query.get("status");
  const kindFilter = query.get("kind");
  const setFilter = useCallback(
    (next: Readonly<Record<string, string | null>>) => {
      setQuery((params) => {
        for (const [key, value] of Object.entries(next)) {
          if (value) params.set(key, value);
          else params.delete(key);
        }
      });
    },
    [setQuery]
  );

  const knownTitles = useMemo(() => new Set(pages.map((summary) => summary.title.trim().toLowerCase())), [pages]);
  const followLink = useCallback(
    (target: string) => {
      const match = pages.find((candidate) => candidate.title.trim().toLowerCase() === target.trim().toLowerCase());
      if (match) go(pagePath(match.id));
    },
    [pages, go]
  );

  const dash = useMemo(
    () =>
      playerCampaignFeedProps({
        records: timeline,
        today: calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null
      }),
    [timeline, calendar]
  );
  const campaignStanding = useMemo(
    () =>
      standing
        .map((row) => ({ row, summary: pages.find((candidate) => candidate.id === row.factionPageId) }))
        // Drop standings whose faction page is unrevealed, since their bar would have no name.
        .filter((pair): pair is { row: PlayerCodexStanding; summary: PlayerCodexPageSummary } => Boolean(pair.summary))
        .map(({ row, summary }) => ({ factionPageId: row.factionPageId, name: summary.title, value: row.value })),
    [standing, pages]
  );

  return (
    <CodexFrame
      groups={PLAYER_SIDEBAR}
      activePath={path}
      /* A GM-only address must not even show its section title. */
      title={section && !gmOnly ? SECTION_TITLE[section] : "Codex"}
      sidebarKey={PLAYER_SIDEBAR_KEY}
      className="codex-player"
      embedded={embedded}
      onLocalNavigate={setLocalPath}
      paletteOpen={paletteOpen}
      onPaletteChange={setPaletteOpen}
      notices={
        error && (
          <Alert tone="danger" title="Couldn't load the Codex">
            {error}
          </Alert>
        )
      }
      overlays={
        paletteOpen && (
          <CommandPalette
            gmToken={token}
            player
            onOpenHit={(hit: CodexSearchHit) => go(pathForHit(hit))}
            onNavigate={go}
            onClose={() => setPaletteOpen(false)}
          />
        )
      }
    >
      {(section === null || gmOnly) && <NotFoundView role="player" />}

      {section === "home" && !gmOnly && (
        <CampaignHome
          pages={pages}
          entries={dash.entries}
          maps={maps}
          today={dash.today}
          loading={loading}
          showReveal={false}
          /* Players only see revealed recaps, which are always past sessions. */
          session={(() => {
            const next = pickNextSession(sessions);
            return next && { ...next, heading: "Latest recap" };
          })()}
          onOpenSession={(sessionId) => go(sessionPath(sessionId))}
          quests={quests}
          onOpenQuest={(questId) => go(questPath(questId))}
          deadlines={dash.deadlines}
          party={
            party
              ? {
                  label: party.marker.label,
                  mapId: party.marker.mapId,
                  mapName: party.mapName,
                  markerId: party.marker.id
                }
              : null
          }
          onOpenParty={(mapId, markerId) => go(atlasPath(mapId, markerId))}
          standing={campaignStanding}
          onOpenPage={(pageId) => go(pagePath(pageId))}
          onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
          onOpenMap={(mapId) => go(atlasPath(mapId))}
          onSeeAll={(target) =>
            go(
              pathForSection(
                target === "recent"
                  ? "pages"
                  : target === "deadlines"
                    ? "journal"
                    : target === "atlas"
                      ? "atlas"
                      : target
              )
            )
          }
          /* Sets the same `?type=` filter as the Pages rail. */
          onPickType={(type) => go(withQuery(pathForSection("pages"), { type }))}
          onPickTag={(tag) => go(tagPath(tag))}
        />
      )}

      {section === "pages" && (
        <PlayerPages
          token={token}
          pages={pages}
          loading={loading}
          pageId={recordId}
          query={query}
          search={search}
          onSearchChange={setSearch}
          onFilterChange={setFilter}
          onOpen={go}
          onFollowLink={followLink}
          knownTitles={knownTitles}
        />
      )}

      {section === "atlas" && (
        <PlayerAtlas
          token={token}
          maps={maps}
          pages={pages}
          mapId={recordId}
          query={query}
          onFilterChange={setFilter}
          onQueryChange={setQuery}
          onOpen={go}
        />
      )}

      {section === "graph" && (
        <ConnectionGraph
          loading={loading}
          nodes={pages.map((summary) => ({ id: summary.id, title: summary.title, entityType: summary.entityType }))}
          connections={connections}
          onOpen={(pageId) => go(pagePath(pageId))}
          focusPageId={query.get("focus")}
          onFocused={() => setQuery((params) => params.delete("focus"))}
          emptyState={
            <>
              <h3>Nothing connected yet</h3>
              <p>Connections between pages appear here once your GM shows those pages to players.</p>
            </>
          }
        />
      )}

      {section === "sessions" && (
        <PlayerSessions
          sessions={sessions}
          loading={loading}
          openId={recordId}
          token={token}
          onOpen={(id) => go(id ? sessionPath(id) : pathForSection("sessions"))}
          onNavigate={followLink}
          knownTitles={knownTitles}
          filter={textFilter}
          onFilterChange={setFilter}
          onPickTag={(tag) => go(tagPath(tag))}
        />
      )}

      {section === "quests" && (
        <PlayerQuests
          quests={quests}
          pages={pages}
          loading={loading}
          openId={recordId}
          token={token}
          onOpen={(id) => go(id ? questPath(id) : pathForSection("quests"))}
          onOpenPage={(pageId) => go(pagePath(pageId))}
          filter={textFilter}
          statusFilter={statusFilter}
          onFilterChange={setFilter}
          onNavigate={followLink}
          knownTitles={knownTitles}
        />
      )}

      {section === "journal" && (
        <PlayerJournal
          records={timeline}
          calendar={calendar}
          pages={pages}
          token={token}
          focusedId={query.get("entry")}
          onNavigate={followLink}
          knownTitles={knownTitles}
          kindFilter={kindFilter}
          tagFilter={query.get("tag")}
          textFilter={textFilter}
          onFilterChange={setFilter}
          quests={quests}
        />
      )}

      {section === "calendar" && (
        <PlayerCalendarView
          calendar={calendar}
          records={timeline}
          year={query.get("y")}
          month={query.get("m")}
          onMonthChange={(year, month) =>
            setQuery((params) => {
              params.set("y", String(year));
              params.set("m", String(month));
            })
          }
          onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
        />
      )}

      {section === "downtime" && (
        <PlayerDowntimeView
          records={timeline}
          pages={pages}
          onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
          onOpenPage={(pageId) => go(pagePath(pageId))}
        />
      )}

      {/* Player rows carry no reveal state, so `TagView` cannot badge one. */}
      {section === "tags" && (
        <TagView
          gmToken={token}
          player
          tag={decodeURIComponent(segments[2] ?? "")}
          pages={pages}
          maps={maps}
          records={timeline}
          sessions={sessions}
          quests={quests}
          onNavigate={go}
        />
      )}
    </CodexFrame>
  );
}
