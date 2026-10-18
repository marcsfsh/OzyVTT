import { useCallback, useMemo, useState } from "react";
import { Input, useToast } from "@vtt/ui";
import { formatWorldDate, type PlayerCodexPageSummary, type PlayerCodexStanding } from "@vtt/domain";
import { codexApi, playerCodexApi } from "../api";
import { CampaignHome } from "../CampaignHome";
import { PagesView } from "../PagesView";
import { PlayerPages } from "../PlayerPages";
import { PlayerQuests } from "../PlayerQuests";
import { QuestsView } from "../QuestsView";
import { ConnectionGraph } from "../RelationshipGraph";
import { SearchResultList, useCodexSearch } from "../SearchResults";
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
