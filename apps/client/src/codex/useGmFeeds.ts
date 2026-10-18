import { useCallback } from "react";
import type { CodexPage } from "@vtt/domain";
import {
  atlasApi,
  AUTOSAVE_DEFAULT,
  calendarApi,
  codexApi,
  journalApi,
  questApi,
  sessionApi,
  standingApi
} from "./api";
import type { CodexSection } from "./routes";
import { useCodexQuery } from "./useCodexQuery";

/** Stable empty feeds, so a list that has not loaded yet keeps one identity across renders. */
const EMPTY: readonly never[] = [];
const EMPTY_CAMPAIGN = {
  records: EMPTY,
  maps: EMPTY,
  calendar: null,
  standing: EMPTY,
  party: null
} as const;

/**
 * The GM Codex's shared feeds. Each has one owner, the shell, and is handed down, so two surfaces never
 * disagree about, say, which session is active.
 */
export function useGmFeeds(gmToken: string, section: CodexSection | null) {
  /** Pages, folders and the one edge list the whole graph draws. */
  const list = useCodexQuery(
    useCallback(async () => {
      const [pages, folders, connections] = await Promise.all([
        codexApi.listPages(gmToken),
        codexApi.listFolders(gmToken).catch(() => []),
        codexApi.listConnections(gmToken)
      ]);
      return { pages, folders, connections };
    }, [gmToken]),
    { failure: "Could not load the codex." }
  );
  const pages = list.data?.pages ?? EMPTY;
  const folders = list.data?.folders ?? EMPTY;
  const connections = list.data?.connections ?? EMPTY;

  const sessionFeed = useCodexQuery(
    useCallback(() => sessionApi.list(gmToken), [gmToken]),
    { failure: "Could not load the sessions." }
  );
  const sessions = sessionFeed.data?.sessions ?? EMPTY;
  const activeSessionId = sessionFeed.data?.activeSessionId ?? null;

  const questFeed = useCodexQuery(
    useCallback(() => questApi.list(gmToken), [gmToken]),
    { failure: "Could not load the quests." }
  );
  const quests = questFeed.data ?? EMPTY;

  /** The autosave preference, read once here and handed to every editor so they share one cadence. */
  const settingsFeed = useCodexQuery(
    useCallback(() => codexApi.getSettings(gmToken), [gmToken]),
    { live: false }
  );
  // A failed read leaves the editors on the default cadence.
  const autosave = settingsFeed.data?.autosave ?? AUTOSAVE_DEFAULT;

  /**
   * The campaign feed (chronicle, maps, calendar, standing, party pin). Loaded lazily, only for the
   * sections that read it.
   */
  const needsCampaign =
    section === "home" ||
    section === "story" ||
    section === "timeline" ||
    section === "tags" ||
    section === "relationships";
  const loadCampaignFeed = useCallback(async () => {
    const [records, maps, calendar, standing, party] = await Promise.all([
      journalApi.chronicle(gmToken),
      atlasApi.listMaps(gmToken),
      calendarApi.get(gmToken),
      standingApi.list(gmToken),
      // Not caught separately: a silently missing card is worse than the shared error Alert.
      codexApi.party(gmToken)
    ]);
    return { records, maps, calendar, standing, party };
  }, [gmToken]);
  const campaignFeed = useCodexQuery(needsCampaign ? loadCampaignFeed : null, {
    failure: "Could not load the campaign dashboard."
  });
  const campaign = campaignFeed.data ?? EMPTY_CAMPAIGN;

  const setList = list.setData;
  const onPageChanged = useCallback(
    (page: CodexPage) =>
      setList(
        (prev) =>
          prev && {
            ...prev,
            pages: prev.pages.map((row) =>
              row.id === page.id
                ? {
                    ...row,
                    title: page.title,
                    folder: page.folder,
                    tags: page.tags,
                    entityType: page.entityType,
                    revealedToPlayers: page.revealedToPlayers,
                    rev: page.rev,
                    updatedAt: page.updatedAt,
                    playerUpdatedAt: page.playerUpdatedAt
                  }
                : row
            )
          }
      ),
    [setList]
  );

  return {
    list,
    pages,
    folders,
    connections,
    sessionFeed,
    sessions,
    activeSessionId,
    questFeed,
    quests,
    settingsFeed,
    autosave,
    campaignFeed,
    campaign,
    onPageChanged
  };
}
