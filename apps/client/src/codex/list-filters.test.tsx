import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **D3 + D10 — every list filters in place, and its filters are part of its address.**
 *
 * Two halves of one claim, both of which shipped only partly.
 *
 * *D3.* Pages, Atlas and the Journal put their filters in the URL; **Sessions and Quests kept theirs in
 * component state**. So two of the five GM lists lost their filter on any navigation, and a filtered log
 * could be neither linked to nor refreshed back into — while the three beside them could.
 *
 * *D10.* "In-place search/filter on every list" reached the GM's five and **none of the player's**: their
 * kind filter was component state that only a dashboard card could set (a player who cleared it could
 * not set it again), and Sessions, Quests, the Journal and the Atlas had no filter at all.
 *
 * Each test asserts BOTH directions, because either alone leaves half the bug: **the address changes when
 * the control is used**, and **the control shows the address's filter when the view is opened cold** —
 * which is the linkable, refresh-proof half, and the half a `useState` implementation fails.
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
      listPages: (...a: unknown[]) => listPages(...a), listFolders: (...a: unknown[]) => listFolders(...a),
      listConnections: (...a: unknown[]) => listConnections(...a), party: (...a: unknown[]) => party(...a),
      getSettings: (...a: unknown[]) => getSettings(...a), search: (...a: unknown[]) => search(...a),
      markersForPage: async () => []
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      listPages: (...a: unknown[]) => playerListPages(...a), listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: async () => [], chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerConnections(...a), party: (...a: unknown[]) => playerParty(...a),
      sessions: (...a: unknown[]) => playerSessions(...a), quests: (...a: unknown[]) => playerQuests(...a),
      standing: (...a: unknown[]) => playerStanding(...a), calendar: (...a: unknown[]) => playerCalendar(...a),
      search: (...a: unknown[]) => playerSearch(...a)
    },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a), forPage: async () => [] },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a), listAssets: async () => [], listMarkers: async () => [] },
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
  id, sessionNumber: number, realDate: null, attendees: [], prepBody: "", recapBody: recap, status,
  tags: [], revealedToPlayers: true, rev: 1, createdAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:00.000Z"
});
const quest = (id: string, title: string, status: "active" | "completed" | "failed") => ({
  id, title, status, playerBody: "", gmBody: "", objectives: [], entityIds: [], tags: [],
  revealedToPlayers: true, rev: 1, createdAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:00:00.000Z"
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
  getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [], currentInstant: 0, publishedInstant: 0 });
  listSessions.mockResolvedValue({ sessions: [session("s1", 1, "played", "the crypt"), session("s2", 2, "planned")], activeSessionId: null });
  listQuests.mockResolvedValue([quest("q1", "The Sunless Crown", "active"), quest("q2", "The Missing Cask", "completed")]);
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

const renderGm = (at: string) => (goTo(at), render)(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);
const renderPlayer = (at: string) => (goTo(at), render)(<PlayerCodex token="player" />);
const rail = async (name: string) => within(await screen.findByRole("navigation", { name }));

describe("D3 — the GM's Sessions and Quests filters live in the address", () => {
  it("Sessions: opening a filtered address filters the list, and using the control writes the address", async () => {
    const user = userEvent.setup();
    renderGm("/codex/sessions?status=planned");

    // Cold open on a filtered address — the linkable, refresh-proof half. Component state cannot do this.
    const sessions = await rail("Sessions");
    await waitFor(() => expect(sessions.queryByText("Session 1")).not.toBeInTheDocument());
    expect(sessions.getByText("Session 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by status")).toHaveValue("planned");

    await user.type(screen.getByLabelText("Filter sessions"), "crypt");
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("crypt"));
    // …and the two filters compose rather than replacing each other.
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

  /**
   * Opening a record from a filtered list drops the filter from the address — **and that is the
   * behaviour of every list in the suite**, Pages included (`navigate(pagePath(id))` carries no query).
   * Back still returns to the filtered list, because the filtered address is the previous history entry.
   * Pinned here as the current, uniform answer rather than left for the next reader to discover: making
   * the filter ride the record address is a change to all five lists and a design call about how long a
   * filter should stick, not part of putting Sessions and Quests on the same footing as the other three.
   */
  it("drops the filter from the address when a record is opened — uniformly, as Pages does", async () => {
    const user = userEvent.setup();
    renderGm("/codex/sessions?status=planned");

    await user.click((await rail("Sessions")).getByRole("button", { name: /Session 2/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s2"));
    expect(window.location.search).toBe("");
  });
});

describe("D10 — the player's lists filter in place too", () => {
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
      { id: "j1", kind: "entry", title: null, text: "We reached Vallaki", tags: ["travel"], realDate: null, inWorldLabel: null, inWorldDate: null, calendarInstant: null, sessionId: null, sessionNumber: null, createdAt: "2026-07-31T00:00:00.000Z" },
      { id: "j2", kind: "deadline", title: "The feast", text: "Before the feast", tags: [], realDate: null, inWorldLabel: null, inWorldDate: null, calendarInstant: null, sessionId: null, sessionNumber: null, createdAt: "2026-07-31T00:00:00.000Z" }
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
      { id: "p1", title: "Strahd", entityType: "character", folder: null, tags: [], bannerAssetId: null, updatedAt: "2026-07-31T00:00:00.000Z" },
      { id: "p2", title: "Vallaki", entityType: "location", folder: null, tags: [], bannerAssetId: null, updatedAt: "2026-07-31T00:00:00.000Z" }
    ]);
    renderPlayer("/codex/pages");
    await waitFor(() => expect(screen.getByText("Strahd")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Filter by kind"), "location");

    await waitFor(() => expect(screen.queryByText("Strahd")).not.toBeInTheDocument());
    expect(screen.getByText("Vallaki")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("type")).toBe("location");
    // And it can be cleared from where they are standing, which the dashboard-only version could not do
    // once the chip was dismissed.
    await user.selectOptions(screen.getByLabelText("Filter by kind"), "");
    await waitFor(() => expect(screen.getByText("Strahd")).toBeInTheDocument());
  });
});
