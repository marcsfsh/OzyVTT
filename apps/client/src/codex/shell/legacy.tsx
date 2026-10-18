import { useCallback, useMemo, useState } from "react";
import { Input, useToast } from "@vtt/ui";
import { formatWorldDate, type PlayerCodexPageSummary, type PlayerCodexStanding } from "@vtt/domain";
import { codexApi, playerCodexApi } from "../api";
import { AtlasView } from "../AtlasView";
import { CalendarView, PlayerCalendarView } from "../CalendarView";
import { CampaignHome } from "../CampaignHome";
import { DowntimeView } from "../DowntimeView";
import { JournalView } from "../JournalView";
import { PagesView } from "../PagesView";
import { PlayerAtlas } from "../PlayerAtlas";
import { PlayerJournal } from "../PlayerJournal";
import { PlayerPages } from "../PlayerPages";
import { PlayerQuests } from "../PlayerQuests";
import { PlayerSessions } from "../PlayerSessions";
import { QuestsView } from "../QuestsView";
import { ConnectionGraph } from "../RelationshipGraph";
import { SearchResultList, useCodexSearch } from "../SearchResults";
import { SessionsView } from "../SessionsView";
import { StandingAdjuster } from "../StandingAdjuster";
import { campaignFeedProps, playerCampaignFeedProps } from "../dashboard";
import { usePageLinks } from "../pageLinks";
import { pickNextSession } from "../sessions";
import {
  atlasPath,
  journalEntryPath,
  pagePath,
  pathForHit,
  pathForSection,
  questPath,
  sessionPath,
  tagPath,
  CODEX_ROOT
} from "../routes";
import { withQuery } from "../../router";
import { useCodexShell, useGmCodex, usePlayerCodex } from "./context";

/**
 * The views from before the remaster, mounted through the section registry until their replacements land. Each
 * adapter reads the shell's context and passes the props the old view took. This file goes once every section has
 * its new view.
 */

function Legacy({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="scroll-y cx-legacy">{children}</div>;
}

export function GmHomeLegacy() {
  const { go, token } = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  const { campaign, pages, sessions, activeSessionId, quests } = feeds;
  const { toast } = useToast();
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const dash = useMemo(
    () => campaignFeedProps({ records: campaign.records, calendar: campaign.calendar }),
    [campaign.records, campaign.calendar]
  );
  const standing = campaign.standing;
  const standingRows = useMemo(() => {
    const byFaction = new Map(standing.map((row) => [row.factionPageId, row.value]));
    return pages
      .filter((page) => page.entityType === "faction" || byFaction.has(page.id))
      .map((page) => ({
        factionPageId: page.id,
        name: page.title,
        value: byFaction.get(page.id) ?? 0,
        revealed: page.revealedToPlayers
      }));
  }, [pages, standing]);
  const adjusting = adjustingId ? pages.find((page) => page.id === adjustingId) : undefined;
  return (
    <Legacy>
      <CampaignHome
        pages={pages}
        entries={dash.entries}
        maps={campaign.maps}
        today={dash.today}
        loading={feeds.list.loading || feeds.campaignFeed.loading}
        error={feeds.campaignFeed.error}
        session={dash.nextSession(sessions, activeSessionId)}
        onOpenSession={(sessionId) => go(sessionPath(sessionId))}
        quests={quests.map((quest) => ({
          id: quest.id,
          title: quest.title,
          status: quest.status,
          objectives: quest.objectives,
          revealed: quest.revealedToPlayers
        }))}
        onOpenQuest={(questId) => go(questPath(questId))}
        deadlines={dash.deadlines}
        downtimePending={dash.downtimePending}
        onOpenDowntime={() => go(withQuery(pathForSection("story"), { kind: "downtime" }))}
        party={
          campaign.party
            ? {
                label: campaign.party.marker.label,
                mapId: campaign.party.marker.mapId,
                mapName: campaign.party.mapName,
                markerId: campaign.party.marker.id,
                revealed: campaign.party.marker.revealedToPlayers
              }
            : null
        }
        onOpenParty={(mapId, markerId) => go(atlasPath(mapId, markerId))}
        standing={standingRows}
        onAdjustStanding={setAdjustingId}
        onCreate={() => gm.quickCreate({})}
        onOpenPage={(id) => go(pagePath(id))}
        onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
        onOpenMap={(mapId) => go(atlasPath(mapId))}
        onSeeAll={(target) =>
          go(
            pathForSection(
              target === "recent"
                ? "pages"
                : target === "deadlines" || target === "journal" || target === "downtime"
                  ? "story"
                  : target
            )
          )
        }
        onPickType={(type) => go(`${CODEX_ROOT}/pages?type=${type}`)}
        onPickTag={(tag) => go(tagPath(tag))}
      />
      {adjusting && (
        <StandingAdjuster
          key={adjusting.id}
          gmToken={token}
          factionPageId={adjusting.id}
          factionName={adjusting.title}
          standing={standing.find((row) => row.factionPageId === adjusting.id) ?? null}
          onSaved={() => {
            void feeds.campaignFeed.reload();
            toast("Standing updated.", { tone: "success" });
          }}
          onClose={() => setAdjustingId(null)}
        />
      )}
    </Legacy>
  );
}

export function PlayerHomeLegacy() {
  const { go } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const dash = useMemo(
    () =>
      playerCampaignFeedProps({
        records: feeds.timeline,
        today: feeds.calendar?.currentDate ? formatWorldDate(feeds.calendar, feeds.calendar.currentDate) : null
      }),
    [feeds.timeline, feeds.calendar]
  );
  const standing = useMemo(
    () =>
      feeds.standing
        .map((row) => ({ row, summary: feeds.pages.find((candidate) => candidate.id === row.factionPageId) }))
        .filter((pair): pair is { row: PlayerCodexStanding; summary: PlayerCodexPageSummary } => Boolean(pair.summary))
        .map(({ row, summary }) => ({ factionPageId: row.factionPageId, name: summary.title, value: row.value })),
    [feeds.standing, feeds.pages]
  );
  const next = pickNextSession(feeds.sessions);
  return (
    <Legacy>
      <CampaignHome
        pages={feeds.pages}
        entries={dash.entries}
        maps={feeds.maps}
        today={dash.today}
        loading={feeds.loading}
        showReveal={false}
        session={next && { ...next, heading: "Latest recap" }}
        onOpenSession={(sessionId) => go(sessionPath(sessionId))}
        quests={feeds.quests}
        onOpenQuest={(questId) => go(questPath(questId))}
        deadlines={dash.deadlines}
        party={
          feeds.party
            ? {
                label: feeds.party.marker.label,
                mapId: feeds.party.marker.mapId,
                mapName: feeds.party.mapName,
                markerId: feeds.party.marker.id
              }
            : null
        }
        onOpenParty={(mapId, markerId) => go(atlasPath(mapId, markerId))}
        standing={standing}
        onOpenPage={(pageId) => go(pagePath(pageId))}
        onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
        onOpenMap={(mapId) => go(atlasPath(mapId))}
        onSeeAll={(target) =>
          go(
            pathForSection(
              target === "recent"
                ? "pages"
                : target === "deadlines" || target === "journal" || target === "downtime"
                  ? "story"
                  : target
            )
          )
        }
        onPickType={(type) => go(withQuery(pathForSection("pages"), { type }))}
        onPickTag={(tag) => go(tagPath(tag))}
      />
    </Legacy>
  );
}

export function GmPagesLegacy() {
  const { token, recordId, query } = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  return (
    <PagesView
      gmToken={token}
      pages={feeds.pages}
      folders={feeds.folders}
      loading={feeds.list.loading}
      autosave={gm.autosave}
      selectedId={recordId}
      query={query}
      onRefresh={feeds.list.reload}
      onPageChanged={feeds.onPageChanged}
      onQuickCreate={gm.quickCreate}
      onError={gm.reportError}
      onOpenReplay={gm.onOpenReplay}
    />
  );
}

/** A `[[link]]` in a player's text opens the page of that title, when the player can read one. */
function usePlayerFollowLink() {
  const { go } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const knownTitles = useMemo(
    () => new Set(feeds.pages.map((summary) => summary.title.trim().toLowerCase())),
    [feeds.pages]
  );
  const followLink = (target: string) => {
    const match = feeds.pages.find((candidate) => candidate.title.trim().toLowerCase() === target.trim().toLowerCase());
    if (match) go(pagePath(match.id));
  };
  return { knownTitles, followLink };
}

export function PlayerPagesLegacy() {
  const { token, recordId, query, go, setFilter } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const [search, setSearch] = useState("");
  const { knownTitles, followLink } = usePlayerFollowLink();
  return (
    <Legacy>
      <PlayerPages
        token={token}
        pages={feeds.pages}
        loading={feeds.loading}
        pageId={recordId}
        query={query}
        search={search}
        onSearchChange={setSearch}
        onFilterChange={setFilter}
        onOpen={go}
        onFollowLink={followLink}
        knownTitles={knownTitles}
      />
    </Legacy>
  );
}

export function GmAtlasLegacy() {
  const { token, recordId, query, go, setQuery } = useCodexShell();
  const gm = useGmCodex();
  return (
    <Legacy>
      <AtlasView
        gmToken={token}
        scenes={gm.scenes}
        actors={gm.actors}
        activeSceneId={gm.activeSceneId}
        onActivateScene={gm.onActivateScene}
        onOpenReplay={gm.onOpenReplay}
        mapId={recordId}
        pinId={query.get("pin")}
        filter={query.get("q") ?? ""}
        tagFilter={query.get("tag")}
        autosave={gm.autosave}
        onQuickCreate={gm.quickCreate}
        onNavigate={go}
        onReplaceQuery={setQuery}
      />
    </Legacy>
  );
}

export function PlayerAtlasLegacy() {
  const { token, recordId, query, go, setQuery, setFilter } = useCodexShell();
  const { feeds } = usePlayerCodex();
  return (
    <Legacy>
      <PlayerAtlas
        token={token}
        maps={feeds.maps}
        pages={feeds.pages}
        mapId={recordId}
        query={query}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onOpen={go}
      />
    </Legacy>
  );
}

export function GmStoryLegacy() {
  const { token, query, go, setQuery, setFilter } = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  if (query.get("kind") === "downtime")
    return (
      <Legacy>
        <DowntimeView
          gmToken={token}
          records={feeds.campaign.records}
          calendar={feeds.campaign.calendar}
          pages={feeds.pages}
          actors={gm.actors}
          loading={feeds.campaignFeed.loading}
          error={feeds.campaignFeed.error}
          onChanged={feeds.campaignFeed.reload}
          onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
          onOpenPage={(pageId) => go(pagePath(pageId))}
        />
      </Legacy>
    );
  return (
    <Legacy>
      <JournalView
        gmToken={token}
        autosave={gm.autosave}
        pages={feeds.pages}
        onOpenPage={(pageId) => go(pagePath(pageId))}
        onOpenMarker={(markerId) => go(atlasPath(null, markerId))}
        onOpenReplay={gm.onOpenReplay}
        openEntryId={query.get("entry")}
        onOpenedEntry={() => setQuery((params) => params.delete("entry"))}
        kindFilter={query.get("kind")}
        tagFilter={query.get("tag")}
        textFilter={query.get("q") ?? ""}
        onFilterChange={setFilter}
        sessions={feeds.sessions}
        activeSessionId={feeds.activeSessionId}
        onOpenSession={(sessionId) => go(sessionPath(sessionId))}
        onOpenCalendar={() => go(pathForSection("timeline"))}
      />
    </Legacy>
  );
}

export function PlayerStoryLegacy() {
  const { token, query, setFilter } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const { knownTitles, followLink } = usePlayerFollowLink();
  return (
    <Legacy>
      <PlayerJournal
        records={feeds.timeline}
        calendar={feeds.calendar}
        pages={feeds.pages}
        token={token}
        focusedId={query.get("entry")}
        onNavigate={followLink}
        knownTitles={knownTitles}
        kindFilter={query.get("kind")}
        tagFilter={query.get("tag")}
        textFilter={query.get("q") ?? ""}
        onFilterChange={setFilter}
        quests={feeds.quests}
      />
    </Legacy>
  );
}

export function GmTimelineLegacy() {
  const { token, query, go, setQuery } = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  return (
    <Legacy>
      <CalendarView
        gmToken={token}
        calendar={feeds.campaign.calendar}
        gameHours={gm.gameHours}
        records={feeds.campaign.records}
        loading={feeds.campaignFeed.loading}
        error={feeds.campaignFeed.error}
        onChanged={feeds.campaignFeed.reload}
        year={query.get("y")}
        month={query.get("m")}
        onMonthChange={(year, month) =>
          setQuery((params) => {
            params.set("y", String(year));
            params.set("m", String(month));
          })
        }
        onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
        onOpenPage={(pageId) => go(pagePath(pageId))}
      />
    </Legacy>
  );
}

export function PlayerTimelineLegacy() {
  const { query, go, setQuery } = useCodexShell();
  const { feeds } = usePlayerCodex();
  return (
    <Legacy>
      <PlayerCalendarView
        calendar={feeds.calendar}
        records={feeds.timeline}
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
    </Legacy>
  );
}

export function GmSessionsLegacy() {
  const { token, recordId, query, go, setFilter } = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  const followLink = usePageLinks(feeds.pages, gm.quickCreate);
  return (
    <Legacy>
      <SessionsView
        gmToken={token}
        sessions={feeds.sessions}
        activeSessionId={feeds.activeSessionId}
        loading={feeds.sessionFeed.loading}
        error={feeds.sessionFeed.error}
        onChanged={feeds.sessionFeed.reload}
        autosave={gm.autosave}
        pages={feeds.pages}
        actors={gm.actors}
        openSessionId={recordId}
        onOpenSession={(id) => go(id ? sessionPath(id) : pathForSection("sessions"))}
        filter={query.get("q") ?? ""}
        statusFilter={query.get("status")}
        onFilterChange={setFilter}
        onPickTag={(tag) => go(tagPath(tag))}
        onFollowLink={followLink}
      />
    </Legacy>
  );
}

export function PlayerSessionsLegacy() {
  const { token, recordId, query, go, setFilter } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const { knownTitles, followLink } = usePlayerFollowLink();
  return (
    <Legacy>
      <PlayerSessions
        sessions={feeds.sessions}
        loading={feeds.loading}
        openId={recordId}
        token={token}
        onOpen={(id) => go(id ? sessionPath(id) : pathForSection("sessions"))}
        onNavigate={followLink}
        knownTitles={knownTitles}
        filter={query.get("q") ?? ""}
        onFilterChange={setFilter}
        onPickTag={(tag) => go(tagPath(tag))}
      />
    </Legacy>
  );
}

export function GmQuestsLegacy() {
  const { token, recordId, query, go, setFilter } = useCodexShell();
  const gm = useGmCodex();
  const { feeds } = gm;
  const followLink = usePageLinks(feeds.pages, gm.quickCreate);
  return (
    <Legacy>
      <QuestsView
        gmToken={token}
        quests={feeds.quests}
        pages={feeds.pages}
        loading={feeds.questFeed.loading}
        error={feeds.questFeed.error}
        onChanged={feeds.questFeed.reload}
        autosave={gm.autosave}
        openQuestId={recordId}
        onOpenQuest={(id) => go(id ? questPath(id) : pathForSection("quests"))}
        onOpenPage={(pageId) => go(pagePath(pageId))}
        onFollowLink={followLink}
        filter={query.get("q") ?? ""}
        statusFilter={query.get("status")}
        onFilterChange={setFilter}
        onPickTag={(tag) => go(tagPath(tag))}
      />
    </Legacy>
  );
}

export function PlayerQuestsLegacy() {
  const { token, recordId, query, go, setFilter } = useCodexShell();
  const { feeds } = usePlayerCodex();
  const { knownTitles, followLink } = usePlayerFollowLink();
  return (
    <Legacy>
      <PlayerQuests
        quests={feeds.quests}
        pages={feeds.pages}
        loading={feeds.loading}
        openId={recordId}
        token={token}
        onOpen={(id) => go(id ? questPath(id) : pathForSection("quests"))}
        onOpenPage={(pageId) => go(pagePath(pageId))}
        filter={query.get("q") ?? ""}
        statusFilter={query.get("status")}
        onFilterChange={setFilter}
        onNavigate={followLink}
        knownTitles={knownTitles}
      />
    </Legacy>
  );
}

export function GmRelationshipsLegacy() {
  const { query, go, setQuery } = useCodexShell();
  const { feeds } = useGmCodex();
  return (
    <Legacy>
      <ConnectionGraph
        loading={feeds.list.loading}
        nodes={feeds.pages.map((page) => ({ id: page.id, title: page.title, entityType: page.entityType }))}
        connections={feeds.connections}
        onOpen={(pageId) => go(pagePath(pageId))}
        focusPageId={query.get("focus")}
        onFocused={() => setQuery((params) => params.delete("focus"))}
      />
    </Legacy>
  );
}

export function PlayerRelationshipsLegacy() {
  const { query, go, setQuery } = useCodexShell();
  const { feeds } = usePlayerCodex();
  return (
    <Legacy>
      <ConnectionGraph
        loading={feeds.loading}
        nodes={feeds.pages.map((summary) => ({ id: summary.id, title: summary.title, entityType: summary.entityType }))}
        connections={feeds.connections}
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
    </Legacy>
  );
}

export function SearchLegacy() {
  const { token, role, query, go, setFilter } = useCodexShell();
  const text = query.get("q") ?? "";
  const run = useCallback(
    (value: string) => (role === "gm" ? codexApi.search(token, value) : playerCodexApi.search(token, value)),
    [role, token]
  );
  const state = useCodexSearch(text, run);
  return (
    <Legacy>
      <Input aria-label="Search the Codex" value={text} onChange={(event) => setFilter({ q: event.target.value })} />
      <SearchResultList state={state} onOpen={(hit) => go(pathForHit(hit))} emptyLabel="No matches." />
    </Legacy>
  );
}
