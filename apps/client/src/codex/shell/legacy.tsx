import { useMemo } from "react";
import { AtlasView } from "../AtlasView";
import { CalendarView, PlayerCalendarView } from "../CalendarView";
import { DowntimeView } from "../DowntimeView";
import { JournalView } from "../JournalView";
import { PlayerAtlas } from "../PlayerAtlas";
import { PlayerJournal } from "../PlayerJournal";
import { PlayerSessions } from "../PlayerSessions";
import { SessionsView } from "../SessionsView";
import { usePageLinks } from "../pageLinks";
import { atlasPath, journalEntryPath, pagePath, pathForSection, sessionPath, tagPath } from "../routes";
import { useCodexShell, useGmCodex, usePlayerCodex } from "./context";

/**
 * The views from before the remaster, mounted through the section registry until their replacements land. Each
 * adapter reads the shell's context and passes the props the old view took. This file goes once every section has
 * its new view.
 */

function Legacy({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="scroll-y cx-legacy">{children}</div>;
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
