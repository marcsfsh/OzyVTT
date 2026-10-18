import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Every list filters in place and keeps its filters in the address, for both GM and player. Each test
 * checks both directions: using the control changes the address, and a cold open shows the address's filter.
 */

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./atlas/AtlasMap", () => ({ AtlasMap: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();
const listFolders = vi.fn();
const listConnections = vi.fn();
const party = vi.fn();
const getSettings = vi.fn();
const search = vi.fn();
const chronicle = vi.fn();
const listMaps = vi.fn();
const getCalendar = vi.fn();
const listSessions = vi.fn();
const listQuests = vi.fn();
const listStanding = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerChronicle = vi.fn();
const playerConnections = vi.fn();
const playerParty = vi.fn();
const playerSessions = vi.fn();
const playerQuests = vi.fn();
const playerStanding = vi.fn();
const playerCalendar = vi.fn();
const playerSearch = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      listConnections: (...a: unknown[]) => listConnections(...a),
      party: (...a: unknown[]) => party(...a),
      getSettings: (...a: unknown[]) => getSettings(...a),
      search: (...a: unknown[]) => search(...a),
      markersForPage: async () => []
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: async () => [],
      chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerConnections(...a),
      party: (...a: unknown[]) => playerParty(...a),
      sessions: (...a: unknown[]) => playerSessions(...a),
      quests: (...a: unknown[]) => playerQuests(...a),
      standing: (...a: unknown[]) => playerStanding(...a),
      calendar: (...a: unknown[]) => playerCalendar(...a),
      search: (...a: unknown[]) => playerSearch(...a)
    },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a), forPage: async () => [] },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: async () => [],
      listMarkers: async () => []
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    sessionApi: { ...actual.sessionApi, list: (...a: unknown[]) => listSessions(...a) },
    questApi: { ...actual.questApi, list: (...a: unknown[]) => listQuests(...a) },
    standingApi: { ...actual.standingApi, list: (...a: unknown[]) => listStanding(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";

const session = (id: string, number: number, status: "planned" | "played", recap = "") => ({
  id,
  sessionNumber: number,
  realDate: null,
  attendees: [],
  prep: [],
  prepTemplateId: null,
  currentSceneId: null,
  recapBody: recap,
  status,
  tags: [],
  revealedToPlayers: true,
  rev: 1,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z"
});
const quest = (id: string, title: string, status: "active" | "completed" | "failed") => ({
  id,
  title,
  status,
  playerBody: "",
  blocks: [],
  objectives: [],
  entityIds: [],
  tags: [],
  revealedToPlayers: true,
  rev: 1,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z"
});

beforeEach(() => {
  listPages.mockResolvedValue([]);
  listFolders.mockResolvedValue([]);
  listConnections.mockResolvedValue([]);
  party.mockResolvedValue(null);
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: true, intervalSeconds: 1 } });
  search.mockResolvedValue({ hits: [], truncated: false });
  chronicle.mockResolvedValue([]);
  listMaps.mockResolvedValue([]);
  getCalendar.mockResolvedValue({
    yearName: "DR",
    months: [{ name: "Hammer", days: 30 }],
    weekdays: [],
    currentInstant: 0,
    publishedInstant: 0
  });
  listSessions.mockResolvedValue({
    sessions: [session("s1", 1, "played", "the crypt"), session("s2", 2, "planned")],
    activeSessionId: null
  });
  listQuests.mockResolvedValue([
    quest("q1", "The Sunless Crown", "active"),
    quest("q2", "The Missing Cask", "completed")
  ]);
  listStanding.mockResolvedValue([]);
  playerListPages.mockResolvedValue([]);
  playerListMaps.mockResolvedValue([]);
  playerChronicle.mockResolvedValue([]);
  playerConnections.mockResolvedValue([]);
  playerParty.mockResolvedValue(null);
  playerSessions.mockResolvedValue([]);
  playerQuests.mockResolvedValue([]);
  playerStanding.mockResolvedValue([]);
  playerCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] });
  playerSearch.mockResolvedValue({ hits: [], truncated: false });
});

const renderGm = (at: string) =>
  (goTo(at), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
    </ToastProvider>
  );
const renderPlayer = (at: string) => (goTo(at), render)(<PlayerCodex token="player" />);

describe("the GM's Sessions and Quests filters live in the address", () => {
  it("Sessions: opening a filtered address filters the list, and using the control writes the address", async () => {
    const user = userEvent.setup();
    renderGm("/codex/sessions?status=planned");

    // Cold open on a filtered address: the flyout opens on the filtered list.
    const sessions = within(await screen.findByRole("list", { name: "Sessions" }));
    await waitFor(() => expect(sessions.queryByText("Session 1")).not.toBeInTheDocument());
    expect(sessions.getByText("Session 2")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: "Planned" })
    ).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByLabelText("Filter sessions"), "crypt");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("crypt"));
    // The two filters compose.
    expect(new URLSearchParams(window.location.search).get("status")).toBe("planned");
  });
  it("drops the filter from the address when a record is opened, uniformly, as Pages does", async () => {
    const user = userEvent.setup();
    renderGm("/codex/sessions?status=planned");

    await user.click(
      within(await screen.findByRole("list", { name: "Sessions" })).getByRole("button", { name: /Session 2/ })
    );

    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s2"));
    expect(window.location.search).toBe("");
  });
});

describe("the player's lists filter in place too", () => {
  it("Sessions: a filter box that narrows the recaps and writes the address", async () => {
    const user = userEvent.setup();
    playerSessions.mockResolvedValue([
      { id: "s1", sessionNumber: 1, realDate: "2026-01-02", recap: "the crypt", tags: [] },
      { id: "s2", sessionNumber: 2, realDate: null, recap: "the tavern", tags: [] }
    ]);
    renderPlayer("/codex/sessions");

    await user.click(await screen.findByRole("button", { name: "Filters" }));
    const list = () => within(screen.getByRole("list", { name: "Sessions" }));
    await waitFor(() => expect(list().getByText("Session 1")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Filter sessions"), "tavern");
    await waitFor(() => expect(list().queryByText("Session 1")).not.toBeInTheDocument());
    expect(list().getByText("Session 2")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("tavern");
  });

  it("Story: the GM's three filters, over the player's own records", async () => {
    const user = userEvent.setup();
    playerChronicle.mockResolvedValue([
      {
        id: "j1",
        kind: "entry",
        title: null,
        text: "We reached Vallaki",
        tags: ["travel"],
        realDate: null,
        inWorldLabel: null,
        inWorldDate: null,
        calendarInstant: null,
        sessionId: null,
        sessionNumber: null,
        firstShownAt: "2026-07-31T00:00:00.000Z"
      },
      {
        id: "j2",
        kind: "deadline",
        title: "The feast",
        text: "Before the feast",
        tags: [],
        realDate: null,
        inWorldLabel: null,
        inWorldDate: null,
        calendarInstant: null,
        sessionId: null,
        sessionNumber: null,
        firstShownAt: "2026-07-31T00:00:00.000Z"
      }
    ]);
    // The old Journal address still lands on Story.
    renderPlayer("/codex/journal");
    await waitFor(() => expect(screen.getByText("We reached Vallaki")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(within(screen.getByRole("group", { name: "Kind" })).getByRole("button", { name: "Deadline" }));

    await waitFor(() => expect(screen.queryByText("We reached Vallaki")).not.toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: "Clocks" })).getByText("The feast")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("kind")).toBe("deadline");
  });
});
