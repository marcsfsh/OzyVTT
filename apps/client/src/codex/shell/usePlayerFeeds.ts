import { useCallback } from "react";
import { playerCodexApi } from "../api";
import { useCodexQuery } from "../useCodexQuery";

/** A stable empty feed, so a list that has not loaded yet keeps one identity across renders. */
const EMPTY: readonly never[] = [];

/**
 * The player Codex's shared feeds, every one read through `playerCodexApi` on the player's own token, so
 * everything a player view renders is a field the server chose to send that token. Refreshed on the shared ping.
 */
export function usePlayerFeeds(token: string) {
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
  return {
    feed,
    pages: feed.data?.pages ?? EMPTY,
    maps: feed.data?.maps ?? EMPTY,
    timeline: feed.data?.timeline ?? EMPTY,
    connections: feed.data?.connections ?? EMPTY,
    calendar: feed.data?.calendar ?? null,
    sessions: feed.data?.sessions ?? EMPTY,
    quests: feed.data?.quests ?? EMPTY,
    standing: feed.data?.standing ?? EMPTY,
    party: feed.data?.party ?? null,
    loading: feed.loading,
    error: feed.error && "Couldn't load the Codex. Check your connection and try again."
  };
}

export type PlayerFeeds = ReturnType<typeof usePlayerFeeds>;
