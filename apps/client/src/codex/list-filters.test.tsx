import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Every list filters in place and keeps its filters in the address, for both GM and player. Each test
 * checks both directions: using the control changes the address, and a cold open shows the address's filter.
 */

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

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
  prepBody: "",
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
  gmBody: "",
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
const rail = async (name: string) => within(await screen.findByRole("navigation", { name }));

describe("the GM's Sessions and Quests filters live in the address", () => {
  it("Sessions: opening a filtered address filters the list, and using the control writes the address", async () => {
    const user = userEvent.setup();
    renderGm("/codex/sessions?status=planned");

    // Cold open on a filtered address.
    const sessions = await rail("Sessions");
    await waitFor(() => expect(sessions.queryByText("Session 1")).not.toBeInTheDocument());
    expect(sessions.getByText("Session 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by status")).toHaveValue("planned");

    await user.type(screen.getByLabelText("Filter sessions"), "crypt");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("crypt"));
    // The two filters compose.
    expect(new URLSearchParams(window.location.search).get("status")).toBe("planned");
  });

  it("Quests: the same, on the same parameters", async () => {
    const user = userEvent.setup();
    renderGm("/codex/quests?status=completed");

    const quests = await rail("Quests");
    await waitFor(() => expect(quests.queryByText("The Sunless Crown")).not.toBeInTheDocument());
    expect(quests.getByText("The Missing Cask")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by status"), "active");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("status")).toBe("active"));
    expect((await rail("Quests")).getByText("The Sunless Crown")).toBeInTheDocument();
  });

  /** Opening a record drops the filter from the address, as every list does; Back returns to the filtered list. */
  it("drops the filter from the address when a record is opened, uniformly, as Pages does", async () => {
    const user = userEvent.setup();
    renderGm("/codex/sessions?status=planned");

    await user.click((await rail("Sessions")).getByRole("button", { name: /Session 2/ }));

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

    const sessions = await rail("Sessions");
    await waitFor(() => expect(sessions.getByText("Session 1")).toBeInTheDocument());

    await user.type(screen.getByLabelText("Filter sessions"), "tavern");
    await waitFor(async () => expect((await rail("Sessions")).queryByText("Session 1")).not.toBeInTheDocument());
    expect((await rail("Sessions")).getByText("Session 2")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("tavern");
  });

  it("Quests: status and text, from a cold filtered address", async () => {
    playerQuests.mockResolvedValue([
      { id: "q1", title: "The Sunless Crown", status: "active", body: "", objectives: [], entityIds: [], tags: [] },
      { id: "q2", title: "The Missing Cask", status: "completed", body: "", objectives: [], entityIds: [], tags: [] }
    ]);
    renderPlayer("/codex/quests?status=completed");

    const quests = await rail("Quests");
    await waitFor(() => expect(quests.getByText("The Missing Cask")).toBeInTheDocument());
    expect(quests.queryByText("The Sunless Crown")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter by status")).toHaveValue("completed");
  });

  it("Journal: the GM's three filters, over the player's own records", async () => {
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
        createdAt: "2026-07-31T00:00:00.000Z"
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
        createdAt: "2026-07-31T00:00:00.000Z"
      }
    ]);
    renderPlayer("/codex/journal");
    await waitFor(() => expect(screen.getByText("We reached Vallaki")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Filter by kind"), "deadline");

    await waitFor(() => expect(screen.queryByText("We reached Vallaki")).not.toBeInTheDocument());
    expect(screen.getByText("Before the feast")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("kind")).toBe("deadline");
  });

  it("Pages: the kind filter is settable IN PLACE, not only by a dashboard card", async () => {
    const user = userEvent.setup();
    playerListPages.mockResolvedValue([
      {
        id: "p1",
        title: "Strahd",
        entityType: "character",
        folder: null,
        tags: [],
        bannerAssetId: null,
        updatedAt: "2026-07-31T00:00:00.000Z"
      },
      {
        id: "p2",
        title: "Vallaki",
        entityType: "location",
        folder: null,
        tags: [],
        bannerAssetId: null,
        updatedAt: "2026-07-31T00:00:00.000Z"
      }
    ]);
    renderPlayer("/codex/pages");
    await waitFor(() => expect(screen.getByText("Strahd")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Filter by kind"), "location");

    await waitFor(() => expect(screen.queryByText("Strahd")).not.toBeInTheDocument());
    expect(screen.getByText("Vallaki")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("type")).toBe("location");
    // And it can be cleared where they are.
    await user.selectOptions(screen.getByLabelText("Filter by kind"), "");
    await waitFor(() => expect(screen.getByText("Strahd")).toBeInTheDocument());
  });
});
