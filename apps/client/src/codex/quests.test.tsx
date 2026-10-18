import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listLinks = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();
const timeline = vi.fn();
const chronicle = vi.fn();
const getCalendar = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const listSessions = vi.fn();
// Write mocks exist so the dashboard test can assert the card writes nothing.
const listQuests = vi.fn();
const createQuest = vi.fn();
const updateQuest = vi.fn();
const revealQuest = vi.fn();
const removeQuest = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerListMarkers = vi.fn();
const playerChronicle = vi.fn();
const playerListRelationships = vi.fn();
const playerListLinks = vi.fn();
const playerSessions = vi.fn();
const playerQuests = vi.fn();
const playerSearch = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listRelationships: (...a: unknown[]) => listRelationships(...a),
      listLinks: (...a: unknown[]) => listLinks(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    journalApi: {
      ...actual.journalApi,
      timeline: (...a: unknown[]) => timeline(...a),
      chronicle: (...a: unknown[]) => chronicle(...a),
      forPage: (...a: unknown[]) => forPage(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    },
    sessionApi: { ...actual.sessionApi, list: (...a: unknown[]) => listSessions(...a) },
    questApi: {
      list: (...a: unknown[]) => listQuests(...a),
      create: (...a: unknown[]) => createQuest(...a),
      update: (...a: unknown[]) => updateQuest(...a),
      reveal: (...a: unknown[]) => revealQuest(...a),
      remove: (...a: unknown[]) => removeQuest(...a),
      get: vi.fn()
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      calendar: (...a: unknown[]) => getCalendar(...a),
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a),
      chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerListRelationships(...a),
      party: (...a: unknown[]) => playerListLinks(...a),
      sessions: (...a: unknown[]) => playerSessions(...a),
      quests: (...a: unknown[]) => playerQuests(...a),
      search: (...a: unknown[]) => playerSearch(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";
import { QUEST_STATUS_LABEL, QUEST_STATUS_ORDER, openQuests, questProgress, questStatusTone } from "./quests";
import type { CodexBlock, CodexCalendar, CodexQuest, CodexSearchHit, PlayerCodexQuest } from "@vtt/domain";

const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

/** An objective as the server lists it, shown to everyone. */
const objective = (text: string, done: boolean, id = `o-${text}`) =>
  ({ id, text, done, audience: "everyone", characterIds: [] }) as const;
/** A hidden block as the server lists it. */
const hidden = (text: string): CodexBlock => ({
  id: `b-${text}`,
  anchor: 1,
  title: null,
  text,
  audience: "hidden",
  characterIds: [],
  reveals: []
});
const QUEST = (over: Partial<CodexQuest> = {}): CodexQuest => ({
  id: "q1",
  title: "The Sunless Crown",
  status: "active",
  playerBody: "The burgomaster wants the crown returned.",
  blocks: [hidden("The crown is a phylactery and the burgomaster knows it.")],
  objectives: [objective("Find the crypt", true), objective("Open the sarcophagus", false)],
  entityIds: [],
  revealedToPlayers: false,
  tags: [],
  rev: 3,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  firstShownAt: null,
  ...over
});
const OPEN = QUEST();
const DONE = QUEST({
  id: "q2",
  title: "The Bell of Vallaki",
  status: "completed",
  blocks: [hidden("Already spent.")],
  objectives: []
});
const LOST = QUEST({
  id: "q3",
  title: "The Missing Caravan",
  status: "failed",
  blocks: [hidden("Eaten.")],
  objectives: []
});
const FRESH = QUEST({
  id: "q0",
  title: "A rumour in Vallaki",
  status: "not-started",
  blocks: [hidden("Bait.")],
  objectives: []
});
const DROPPED = QUEST({
  id: "q4",
  title: "The Amber Bargain",
  status: "canceled",
  blocks: [hidden("They walked away.")],
  objectives: []
});
/** A second open quest. Jumps target this one because the log's fallback would select the first. */
const OTHER = QUEST({
  id: "q4",
  title: "The Amber Temple",
  blocks: [hidden("The vestiges are still bargaining.")],
  objectives: [objective("Cross the pass", false)]
});

const gmDefaults = (quests: CodexQuest[] = [OPEN, OTHER, DONE, LOST]) => {
  listPages.mockResolvedValue([]);
  listRelationships.mockResolvedValue([]);
  listLinks.mockResolvedValue(null);
  listFolders.mockResolvedValue([]);
  getPage.mockResolvedValue({ page: null, connections: [] });
  search.mockResolvedValue({ hits: [], truncated: false });
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
  timeline.mockResolvedValue([]);
  chronicle.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
  listMaps.mockResolvedValue([]);
  listAssets.mockResolvedValue([]);
  listMarkers.mockResolvedValue([]);
  listSessions.mockResolvedValue({ sessions: [], activeSessionId: null });
  listQuests.mockResolvedValue(quests);
};
const renderWorkspace = async () => {
  (goTo("/codex/quests"), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
    </ToastProvider>
  );
  await waitFor(() => expect(listQuests).toHaveBeenCalled());
};

// Mocks are restored between tests but storage is not, and the console persists its state under a `codex-` key.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("What counts as OPEN (the rule, below the components)", () => {
  it("is NOT FINISHED: `not-started` and `active`, never one of the three terminal states", () => {
    // `failed` is what a looser "not completed" predicate would let through.
    expect(openQuests([OPEN, DONE, LOST]).map((quest) => quest.id)).toEqual(["q1"]);
    expect(openQuests([DONE, LOST, DROPPED])).toEqual([]);
    expect(openQuests([FRESH, OPEN, DONE, LOST, DROPPED]).map((quest) => quest.id)).toEqual(["q0", "q1"]);
    expect(openQuests([DROPPED])).toEqual([]);
    const second = QUEST({ id: "qz", title: "Second" });
    expect(openQuests([OPEN, DONE, second]).map((quest) => quest.id)).toEqual(["q1", "qz"]);
  });

  it("names all five statuses, offers them in lifecycle order, and never colours a cancellation as a loss", () => {
    expect(QUEST_STATUS_ORDER).toEqual(["not-started", "active", "completed", "failed", "canceled"]);
    expect(QUEST_STATUS_ORDER.map((status) => QUEST_STATUS_LABEL[status])).toEqual([
      "Not started",
      "Active",
      "Completed",
      "Failed",
      "Canceled"
    ]);
    expect(Object.keys(QUEST_STATUS_LABEL).sort()).toEqual([...QUEST_STATUS_ORDER].sort());
    expect(QUEST_STATUS_ORDER.map(questStatusTone)).toEqual(["neutral", "info", "success", "danger", "neutral"]);
  });

  it("counts progress in words, so it never reads by colour or by a bare ratio", () => {
    expect(questProgress(OPEN.objectives)).toEqual({ done: 1, total: 2, label: "1 of 2 done" });
    expect(questProgress([])).toEqual({ done: 0, total: 0, label: "0 of 0 done" });
  });
});

describe("The dashboard's open-quests card", () => {
  it("shows the GM the open quests only, and lands ON one with no write to get there", async () => {
    gmDefaults();
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "Home" }));
    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.getByText("The Sunless Crown")).toBeInTheDocument();
    expect(card.getByText("The Amber Temple")).toBeInTheDocument();
    expect(card.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
    expect(card.queryByText("The Missing Caravan")).not.toBeInTheDocument();
    expect(card.getByText("1 of 2 done")).toBeInTheDocument();

    // The second open quest, so landing here proves the latch; the default selection would pick the first.
    await user.click(card.getByText("The Amber Temple"));

    const log = within(await screen.findByRole("navigation", { name: "Quests" }));
    await waitFor(() =>
      expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true")
    );
    expect(log.getByRole("button", { name: /The Sunless Crown/ })).not.toHaveAttribute("aria-current");

    // The card is a view: one read, no writes.
    expect(listQuests).toHaveBeenCalledTimes(1);
    for (const write of [createQuest, updateQuest, revealQuest, removeQuest]) expect(write).not.toHaveBeenCalled();
  });

  it("re-opens the SAME quest from a later jump, because the latch clears when its target goes away", async () => {
    /**
     * Driven through the palette, which keeps the quest log mounted between jumps; an unmount would reset
     * the handled-ref and let this pass without the clear.
     */
    gmDefaults();
    search.mockResolvedValue({
      hits: [
        {
          kind: "quest",
          id: "q4",
          title: "The Amber Temple",
          tags: [],
          entityType: null,
          mapId: null,
          type: "quest",
          revealedToPlayers: true,
          modifiedAt: "2026-07-28T00:00:00.000Z",
          columns: {},
          match: null
        } as CodexSearchHit
      ],
      truncated: false
    });
    const user = userEvent.setup();
    await renderWorkspace();

    const jumpViaPalette = async () => {
      await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
      const palette = within(await screen.findByRole("dialog", { name: "Codex command palette" }));
      await user.type(palette.getByLabelText("Search the Codex"), "temple");
      await user.click(await palette.findByText("The Amber Temple"));
    };

    await jumpViaPalette();
    const log = within(await screen.findByRole("navigation", { name: "Quests" }));
    await waitFor(() =>
      expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true")
    );

    await user.click(screen.getByRole("button", { name: "All quests" }));
    await waitFor(() =>
      expect(log.getByRole("button", { name: /The Amber Temple/ })).not.toHaveAttribute("aria-current")
    );

    await jumpViaPalette();
    await waitFor(() =>
      expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true")
    );
  });
});

/** Drives both real status `<select>`s (rail filter and editor) so neither can miss a status. */
describe("The GM can actually pick the new statuses (5d)", () => {
  it("offers all five in both pickers, and sends the chosen one to the server", async () => {
    gmDefaults([OPEN]);
    updateQuest.mockResolvedValue(QUEST());
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getAllByRole("button", { name: "Quests" })[0]);
    const filter = await screen.findByLabelText("Filter by status");
    expect(
      within(filter)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["All quests", "Not started", "Active", "Completed", "Failed", "Canceled"]);

    await user.click(await screen.findByRole("button", { name: /The Sunless Crown/ }));
    await user.click(await screen.findByRole("button", { name: "Details" }));
    const status = await screen.findByLabelText(/Status/);
    expect(
      within(status)
        .getAllByRole("option")
        .map((option) => option.textContent)
    ).toEqual(["Not started", "Active", "Completed", "Failed", "Canceled"]);

    await user.selectOptions(status, "Canceled");
    await waitFor(() => expect(updateQuest).toHaveBeenCalled(), { timeout: 3000 });
    const [, , input] = updateQuest.mock.calls[0] as [string, string, { status: string }];
    expect(input.status).toBe("canceled");
  });
});

describe("The GM's objective checklist", () => {
  it("adds a BLANK row and saves it in place: order is content and a blank line is a real state", async () => {
    // Blank objective rows must survive the save; the server accepts them so "Add objective" works.
    gmDefaults([OPEN]);
    updateQuest.mockResolvedValue(QUEST());
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getAllByRole("button", { name: "Quests" })[0]);
    await user.click(await screen.findByRole("button", { name: /The Sunless Crown/ }));
    await user.click(await screen.findByRole("button", { name: "Details" }));
    const list = within(await screen.findByRole("list", { name: "Objectives" }));
    expect(list.getAllByRole("checkbox")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Add objective" }));
    expect(within(screen.getByRole("list", { name: "Objectives" })).getAllByRole("checkbox")).toHaveLength(3);

    // Saved by autosave (1s debounce by default), with the blank row kept in position.
    await waitFor(() => expect(updateQuest).toHaveBeenCalled(), { timeout: 3000 });
    const [, , input] = updateQuest.mock.calls[0] as [
      string,
      string,
      { objectives: readonly { id?: string; text: string; done: boolean }[]; expectedRev: number }
    ];
    // Existing rows keep their ids, so the server keeps each one's audience; the new row has none yet.
    expect(input.objectives).toEqual([
      { id: "o-Find the crypt", text: "Find the crypt", done: true },
      { id: "o-Open the sarcophagus", text: "Open the sarcophagus", done: false },
      { text: "", done: false }
    ]);
    // A stale edit is a 409, and nothing is silently overwritten.
    expect(input.expectedRev).toBe(3);
  });

  it("ticks an objective without reordering the list", async () => {
    gmDefaults([OPEN]);
    updateQuest.mockResolvedValue(QUEST());
    const user = userEvent.setup();
    await renderWorkspace();

    await user.click(screen.getAllByRole("button", { name: "Quests" })[0]);
    await user.click(await screen.findByRole("button", { name: /The Sunless Crown/ }));
    await user.click(await screen.findByRole("button", { name: "Details" }));
    await screen.findByRole("list", { name: "Objectives" });
    await user.click(screen.getByRole("checkbox", { name: "Open the sarcophagus done" }));

    await waitFor(() => expect(updateQuest).toHaveBeenCalled(), { timeout: 3000 });
    const [, , input] = updateQuest.mock.calls[0] as [
      string,
      string,
      { objectives: readonly { id?: string; text: string; done: boolean }[] }
    ];
    // Order is content: a done item is not moved.
    expect(input.objectives).toEqual([
      { id: "o-Find the crypt", text: "Find the crypt", done: true },
      { id: "o-Open the sarcophagus", text: "Open the sarcophagus", done: true }
    ]);
  });
});

/** Shared by the card and reader tests, which are two views of the same feed. */
const PLAYER_QUEST: PlayerCodexQuest = {
  id: "q1",
  title: "The Sunless Crown",
  status: "active",
  body: "The burgomaster wants the crown returned.",
  blocks: [],
  objectives: [
    { text: "Find the crypt", done: true },
    { text: "Open the sarcophagus", done: false }
  ],
  entityIds: [],
  tags: []
};
/** Finished, so the open-quests card never lists it. */
const PLAYER_DONE: PlayerCodexQuest = {
  id: "q2",
  title: "The Bell of Vallaki",
  status: "completed",
  body: "The bell was hauled back up the hill.",
  blocks: [],
  objectives: [{ text: "Raise the bell", done: true }],
  entityIds: [],
  tags: []
};
const PLAYER_LOST: PlayerCodexQuest = {
  id: "q3",
  title: "The Missing Caravan",
  status: "failed",
  body: "",
  blocks: [],
  objectives: [],
  entityIds: [],
  tags: []
};
const PLAYER_FRESH: PlayerCodexQuest = {
  id: "q0",
  title: "A rumour in Vallaki",
  status: "not-started",
  body: "Someone is buying coffins.",
  blocks: [],
  objectives: [],
  entityIds: [],
  tags: []
};
const PLAYER_DROPPED: PlayerCodexQuest = {
  id: "q4",
  title: "The Amber Bargain",
  status: "canceled",
  body: "The party walked away.",
  blocks: [],
  objectives: [],
  entityIds: [],
  tags: []
};

const playerDefaults = (quests: readonly unknown[] = [PLAYER_QUEST]) => {
  playerListPages.mockResolvedValue([]);
  playerListMaps.mockResolvedValue([]);
  playerListMarkers.mockResolvedValue([]);
  playerChronicle.mockResolvedValue([]);
  playerListRelationships.mockResolvedValue([]);
  playerListLinks.mockResolvedValue(null);
  playerSessions.mockResolvedValue([]);
  playerSearch.mockResolvedValue({ hits: [], truncated: false });
  getCalendar.mockResolvedValue(CALENDAR);
  playerQuests.mockResolvedValue(quests);
};

describe("The player's copy of the card (viewer safety)", () => {
  beforeEach(() => {
    playerDefaults();
  });

  it("shows progress and never a tickable box: no checkbox, no field, nothing focusable", async () => {
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.getByText("The Sunless Crown")).toBeInTheDocument();
    const objectives = within(card.getByRole("list", { name: "Objectives for The Sunless Crown" }));
    expect(objectives.getByText("Find the crypt")).toBeInTheDocument();
    expect(objectives.getByText("Open the sarcophagus")).toBeInTheDocument();
    expect(objectives.getByText(", done")).toBeInTheDocument();
    expect(objectives.getByText(", not done")).toBeInTheDocument();
    // The read-only branch renders no control at all, disabled checkbox included.
    expect(card.queryAllByRole("checkbox")).toHaveLength(0);
    expect(card.queryAllByRole("textbox")).toHaveLength(0);
    expect(card.getByRole("button", { name: /The Sunless Crown/ })).toBeInTheDocument();
  });

  /**
   * The player endpoint returns a GM-shaped row (what a regressed `projectPlayerQuest` would send), so the
   * absence assertions are meaningful.
   */
  it("renders nothing from extra keys if the server ever regresses and sends a GM row", async () => {
    playerDefaults([
      {
        ...PLAYER_QUEST,
        blocks: [hidden("The crown is a phylactery and the burgomaster knows it.")],
        playerBody: "a GM-shaped duplicate of the hook",
        revealedToPlayers: true,
        rev: 3
      }
    ]);
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.getByText("The Sunless Crown")).toBeInTheDocument();
    expect(card.getByText("Find the crypt")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The crown is a phylactery");
    expect(text).not.toContain("a GM-shaped duplicate of the hook");
  });

  it("hides a quest the GM has finished, on the same rule the GM's own card uses", async () => {
    // A player receives revealed quests of any status, so "open" is decided client-side for both audiences.
    playerDefaults([PLAYER_DONE]);
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    await screen.findByRole("heading", { name: "By kind" });
    expect(screen.queryByRole("navigation", { name: "Open quests" })).not.toBeInTheDocument();
    expect(screen.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
  });
});

describe("The player's quest reader", () => {
  const railOf = async () => within(await screen.findByRole("navigation", { name: "Quests" }));
  const readerOf = async () => within(await screen.findByRole("article"));

  it("opens a quest from the dashboard and reads it: title, status, description, objectives", async () => {
    playerDefaults();
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    await user.click(card.getByRole("button", { name: /The Sunless Crown/ }));

    const rail = await railOf();
    await waitFor(() =>
      expect(rail.getByRole("button", { name: /The Sunless Crown/ })).toHaveAttribute("aria-current", "true")
    );

    const reader = await readerOf();
    expect(reader.getByRole("heading", { name: /The Sunless Crown/ })).toBeInTheDocument();
    // Status and progress read as words.
    expect(reader.getByText("Active")).toBeInTheDocument();
    expect(reader.getByText("1 of 2 done")).toBeInTheDocument();
    expect(reader.getByText("The burgomaster wants the crown returned.")).toBeInTheDocument();
    const objectives = within(reader.getByRole("list", { name: "Objectives for The Sunless Crown" }));
    expect(objectives.getByText("Find the crypt")).toBeInTheDocument();
    expect(objectives.getByText(", done")).toBeInTheDocument();
    expect(objectives.getByText(", not done")).toBeInTheDocument();
    /** No writable control in the reader and no checkbox anywhere; the rail's filter is the one input. */
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(reader.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getAllByRole("textbox").map((box) => box.getAttribute("aria-label"))).toEqual(["Filter quests"]);
  });

  it("is where the FINISHED quests live: the dashboard card stays open-only", async () => {
    playerDefaults([PLAYER_QUEST, PLAYER_DONE, PLAYER_LOST]);
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    expect(card.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
    expect(card.queryByText("The Missing Caravan")).not.toBeInTheDocument();

    await user.click(card.getByRole("button", { name: /The Sunless Crown/ }));

    const rail = await railOf();
    expect(rail.getByRole("button", { name: /The Bell of Vallaki/ })).toHaveTextContent("Completed");
    expect(rail.getByRole("button", { name: /The Missing Caravan/ })).toHaveTextContent("Failed");

    await user.click(rail.getByRole("button", { name: /The Bell of Vallaki/ }));
    const reader = await readerOf();
    await waitFor(() => expect(reader.getByRole("heading", { name: /The Bell of Vallaki/ })).toBeInTheDocument());
    expect(reader.getByText("The bell was hauled back up the hill.")).toBeInTheDocument();
  });

  it("lands a search hit ON a completed quest: the jump that used to go nowhere", async () => {
    /** Only finished quests, so the dashboard card doesn't render and the hit must land in the reader. */
    playerDefaults([PLAYER_DONE]);
    playerSearch.mockResolvedValue({
      hits: [
        {
          kind: "quest",
          id: "q2",
          title: "The Bell of Vallaki",
          tags: [],
          entityType: null,
          mapId: null,
          type: "quest",
          revealedToPlayers: true,
          modifiedAt: "2026-07-28T00:00:00.000Z",
          columns: {},
          match: null
        } as CodexSearchHit
      ],
      truncated: false
    });
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    await screen.findByRole("heading", { name: "By kind" });
    expect(screen.queryByRole("navigation", { name: "Open quests" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pages" }));
    await user.type(screen.getAllByLabelText("Search the Codex")[0], "bell");
    const results = within(screen.getByRole("navigation", { name: "Pages" }));
    expect(await results.findByText("Quest")).toBeInTheDocument();
    await user.click(results.getByText("The Bell of Vallaki"));

    const reader = await readerOf();
    expect(reader.getByRole("heading", { name: /The Bell of Vallaki/ })).toBeInTheDocument();
    expect(reader.getByText("Completed")).toBeInTheDocument();
    expect(reader.getByText("The bell was hauled back up the hill.")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/codex/quests/q2");
    const sidebar = within(screen.getByRole("navigation", { name: "Codex sections" }));
    expect(sidebar.getByRole("button", { name: "Quests" })).toHaveAttribute("aria-current", "page");
    expect(sidebar.getByRole("button", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  /** The reader renders the player's state directly, so a GM-shaped row is the real leak risk here. */
  it("survives a GM-shaped row from a regressed server, and never asks the GM feed for one", async () => {
    playerDefaults([
      {
        ...PLAYER_QUEST,
        blocks: [hidden("The crown is a phylactery and the burgomaster knows it.")],
        playerBody: "a GM-shaped duplicate of the hook",
        revealedToPlayers: true,
        rev: 3
      }
    ]);
    const user = userEvent.setup();
    (goTo("/codex"), render)(<PlayerCodex token="player" />);

    const card = within(await screen.findByRole("navigation", { name: "Open quests" }));
    await user.click(card.getByRole("button", { name: /The Sunless Crown/ }));

    const reader = await readerOf();
    expect(reader.getByRole("heading", { name: /The Sunless Crown/ })).toBeInTheDocument();
    expect(reader.getByText("The burgomaster wants the crown returned.")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The crown is a phylactery");
    expect(text).not.toContain("a GM-shaped duplicate of the hook");

    expect(playerQuests).toHaveBeenCalledWith("player");
    expect(listQuests).not.toHaveBeenCalled();
  });
});

/** Rendered and never string-asserted: the sentence combines the verb table, the player's quest feed and the row. */
describe("A quest-history row a player reads (5d)", () => {
  const questRecord = (id: string, questId: string, status: string) => ({
    id,
    kind: "quest" as const,
    title: null,
    text: "",
    tags: [],
    realDate: null,
    inWorldLabel: null,
    inWorldDate: null,
    calendarInstant: null,
    sessionId: null,
    sessionNumber: null,
    firstShownAt: "2026-07-31T00:00:00.000Z",
    payload: { questId, status }
  });

  it("says a quest HAS NOT STARTED and WAS CANCELED, naming the quest from the player's own feed", async () => {
    playerDefaults([PLAYER_FRESH, PLAYER_DROPPED]);
    playerChronicle.mockResolvedValue([questRecord("j1", "q0", "not-started"), questRecord("j2", "q4", "canceled")]);
    (goTo("/codex/journal"), render)(<PlayerCodex token="player" />);

    expect(await screen.findByText("A rumour in Vallaki has not started")).toBeInTheDocument();
    expect(screen.getByText("The Amber Bargain was canceled")).toBeInTheDocument();
  });

  it('falls back to "A quest" for a status whose quest the player cannot see, and invents no name', async () => {
    // A `questId` that matches nothing in the player's feed must still read as a sentence.
    playerDefaults([]);
    playerChronicle.mockResolvedValue([questRecord("j1", "q-unknown", "canceled")]);
    (goTo("/codex/journal"), render)(<PlayerCodex token="player" />);

    expect(await screen.findByText("A quest was canceled")).toBeInTheDocument();
  });
});

describe("A quest in suite-wide search", () => {
  // q4 and never q1: the log's fallback would land on q1 anyway, so a hit for it couldn't fail.
  const HIT: CodexSearchHit = {
    kind: "quest",
    id: "q4",
    title: "The Amber Temple",
    tags: [],
    entityType: null,
    mapId: null,
    type: "quest",
    revealedToPlayers: true,
    modifiedAt: "2026-07-28T00:00:00.000Z",
    columns: {},
    match: null
  };

  it("names its kind in TEXT and opens the quest log ON that quest", async () => {
    gmDefaults();
    search.mockResolvedValue({ hits: [HIT], truncated: false });
    const user = userEvent.setup();
    await renderWorkspace();

    // Search lives in the palette.
    await user.click(screen.getAllByRole("button", { name: "Search" })[0]);
    const results = within(await screen.findByRole("dialog", { name: "Codex command palette" }));
    await user.type(results.getByLabelText("Search the Codex"), "temple");
    // The row names its kind in words.
    expect(await results.findByText("Quest")).toBeInTheDocument();

    await user.click(results.getByText("The Amber Temple"));
    const log = within(await screen.findByRole("navigation", { name: "Quests" }));
    await waitFor(() =>
      expect(log.getByRole("button", { name: /The Amber Temple/ })).toHaveAttribute("aria-current", "true")
    );
    expect(log.getByRole("button", { name: /The Sunless Crown/ })).not.toHaveAttribute("aria-current");
  });
});
