import { useMemo, type ComponentType } from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { ToastProvider } from "@vtt/ui";
import type {
  CodexCalendar,
  CodexChronicleRecord,
  CodexPageSummary,
  CodexQuest,
  CodexSession,
  GmCodexCalendar,
  PlayerCodexChronicleRecord,
  PlayerCodexPageSummary,
  PlayerCodexQuest,
  PlayerCodexSession
} from "@vtt/domain";
import { goTo } from "../../../test/route";
import { navigate, replaceQuery, useRoute } from "../../router";
import { codexSectionOf, recordIdOf, type CodexSection } from "../routes";
import {
  CodexShellContext,
  GmCodexContext,
  PlayerCodexContext,
  type CodexCharacter,
  type CodexShellValue,
  type GmCodexValue,
  type PlayerCodexValue
} from "../shell/context";

/**
 * Mounts one Story view the way the shell does, at an address, over feeds the test hands it. The shell's own tests
 * cover how the feeds are read; these cover what Story does with them. `reload` is a spy, so a test asserts the
 * write and the refetch without a server.
 */

export type GmStoryFeeds = Readonly<{
  records?: readonly CodexChronicleRecord[];
  calendar?: GmCodexCalendar | null;
  pages?: readonly CodexPageSummary[];
  sessions?: readonly CodexSession[];
  activeSessionId?: string | null;
  quests?: readonly CodexQuest[];
  party?: readonly CodexCharacter[];
  actors?: ReadonlyArray<Readonly<{ id: string; name: string; archived?: boolean; kind?: string }>>;
  phone?: boolean;
  /** The campaign feed before its first read lands, or after it fails. */
  campaign?: Readonly<{ loading?: boolean; error?: string | null }>;
  gameHours?: number | null;
}>;

export type PlayerStoryFeeds = Readonly<{
  records?: readonly PlayerCodexChronicleRecord[];
  calendar?: CodexCalendar | null;
  pages?: readonly PlayerCodexPageSummary[];
  sessions?: readonly PlayerCodexSession[];
  quests?: readonly PlayerCodexQuest[];
  phone?: boolean;
}>;

const setFilter = (next: Readonly<Record<string, string | null>>) =>
  replaceQuery((query) => {
    for (const [key, value] of Object.entries(next)) {
      if (value) query.set(key, value);
      else query.delete(key);
    }
  });

function useShellValue(role: "gm" | "player", token: string, phone: boolean): CodexShellValue {
  const route = useRoute();
  return useMemo(
    () => ({
      role,
      token,
      embedded: false,
      section: (codexSectionOf(route.segments) ?? "story") as CodexSection,
      segments: route.segments,
      recordId: recordIdOf(route.segments),
      query: route.query,
      phone,
      go: (path: string, options?: Readonly<{ replace?: boolean }>) => void navigate(path, options),
      setQuery: replaceQuery,
      setFilter,
      openPalette: () => undefined
    }),
    [role, token, route, phone]
  );
}

export function renderGmStory(View: ComponentType, at: string, feeds: GmStoryFeeds = {}) {
  const reload = vi.fn(async () => undefined);
  const quickCreate = vi.fn();
  const onOpenReplay = vi.fn();
  const records = feeds.records ?? [];
  const calendar = feeds.calendar ?? null;
  const sessions = feeds.sessions ?? [];
  const gmFeeds = {
    pages: feeds.pages ?? [],
    sessions,
    activeSessionId: feeds.activeSessionId ?? null,
    quests: feeds.quests ?? [],
    sessionFeed: {
      data: { sessions, activeSessionId: feeds.activeSessionId ?? null },
      loading: false,
      error: null,
      reload
    },
    campaign: { records, calendar, maps: [], standing: [], party: null },
    campaignFeed: {
      data: feeds.campaign?.loading || feeds.campaign?.error ? null : { records, calendar },
      loading: feeds.campaign?.loading ?? false,
      error: feeds.campaign?.error ?? null,
      reload
    }
  };
  const gm = {
    scenes: [],
    actors: feeds.actors ?? [],
    party: feeds.party ?? [],
    activeSceneId: null,
    onActivateScene: vi.fn(),
    onOpenReplay,
    gameHours: feeds.gameHours ?? null,
    autosave: { enabled: true, intervalSeconds: 1 },
    feeds: gmFeeds,
    quickCreate,
    reportError: vi.fn(),
    openPreview: vi.fn()
  } as unknown as GmCodexValue;
  function Harness() {
    const shell = useShellValue("gm", "gm", feeds.phone ?? false);
    return (
      <GmCodexContext.Provider value={gm}>
        <CodexShellContext.Provider value={shell}>
          <View />
        </CodexShellContext.Provider>
      </GmCodexContext.Provider>
    );
  }
  goTo(at);
  const view = render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
  return { ...view, reload, quickCreate, onOpenReplay };
}

export function renderPlayerStory(View: ComponentType, at: string, feeds: PlayerStoryFeeds = {}) {
  const player = {
    feeds: {
      pages: feeds.pages ?? [],
      maps: [],
      timeline: feeds.records ?? [],
      connections: [],
      calendar: feeds.calendar ?? null,
      sessions: feeds.sessions ?? [],
      quests: feeds.quests ?? [],
      standing: [],
      party: null,
      loading: false,
      error: null
    }
  } as unknown as PlayerCodexValue;
  function Harness() {
    const shell = useShellValue("player", "player", feeds.phone ?? false);
    return (
      <PlayerCodexContext.Provider value={player}>
        <CodexShellContext.Provider value={shell}>
          <View />
        </CodexShellContext.Provider>
      </PlayerCodexContext.Provider>
    );
  }
  goTo(at);
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
}

/** A GM chronicle record with every field, so a test names only what it means. */
export const gmRecord = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party crossed the mists.",
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  tags: [],
  attachPageId: null,
  attachMarkerId: null,
  sourceEncounterId: null,
  payload: null,
  fired: false,
  proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

/** A player's chronicle record: the projection's own shape, with no GM field. */
export const playerRecord = (over: Partial<PlayerCodexChronicleRecord> = {}): PlayerCodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party crossed the mists.",
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  inWorldDate: null,
  calendarInstant: null,
  tags: [],
  payload: null,
  fired: false,
  firstShownAt: "2026-07-20T00:00:00.000Z",
  ...over
});
