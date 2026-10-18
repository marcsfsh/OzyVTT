import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const live = vi.hoisted(() => ({
  board: vi.fn(),
  tick: vi.fn(),
  log: vi.fn(),
  currentScene: vi.fn()
}));
const reads = vi.hoisted(() => ({
  calendar: vi.fn(),
  listPages: vi.fn(),
  revealPage: vi.fn(),
  revealQuest: vi.fn(),
  getPage: vi.fn(),
  setPageBlockAudience: vi.fn(),
  setQuestBlockAudience: vi.fn()
}));

vi.mock("../codex/prep/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../codex/prep/api")>();
  return { ...actual, liveApi: { ...actual.liveApi, ...live } };
});
vi.mock("../codex/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../codex/api")>();
  return {
    ...actual,
    calendarApi: { ...actual.calendarApi, get: reads.calendar },
    codexApi: { ...actual.codexApi, listPages: reads.listPages, revealPage: reads.revealPage },
    questApi: { ...actual.questApi, reveal: reads.revealQuest }
  };
});
vi.mock("../codex/api-records", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../codex/api-records")>();
  return {
    ...actual,
    pageRecordApi: {
      ...actual.pageRecordApi,
      get: reads.getPage,
      blocks: { ...actual.pageRecordApi.blocks, setAudience: reads.setPageBlockAudience }
    },
    questRecordApi: {
      ...actual.questRecordApi,
      blocks: { ...actual.questRecordApi.blocks, setAudience: reads.setQuestBlockAudience }
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import type { CodexLiveBoard, CodexLiveClue, GmCodexCalendar } from "@vtt/domain";
import { goTo } from "../../test/route";
import { TonightTab, untilLabel } from "./TonightTab";

/**
 * The Tonight tab is the live board for the active session: it reads `GET /board` and writes through the board's own
 * commands. A ticked clue that links something players can't read offers to reveal it, and nothing is revealed
 * until the GM picks who.
 */

const CALENDAR: GmCodexCalendar = {
  yearName: "SR",
  eras: [],
  months: [{ name: "Emberfall", days: 36 }],
  weekdays: [],
  currentDate: { year: 412, month: 0, day: 14 },
  publishedDate: { year: 412, month: 0, day: 14 }
};
const DAY = (day: number) => 412 * 36 + day - 1;

const clue = (over: Partial<CodexLiveClue> = {}): CodexLiveClue => ({
  id: "c1",
  text: "Ysolde owes the Tidebound 4,000 GP.",
  done: false,
  doneAt: null,
  link: { recordKind: "page", recordId: "p-ysolde", blockId: "b-debt" },
  linkTitle: "Ysolde Varn",
  blockTitle: "The debt",
  linkRevealed: false,
  ...over
});

const BOARD: CodexLiveBoard = {
  sessionId: "s6",
  sessionNumber: 6,
  rev: 3,
  currentSceneId: "sc2",
  scenes: [
    {
      sectionId: "sec-sc",
      id: "sc1",
      title: "Morning at the Gull",
      placePageId: null,
      placeTitle: "Gull and Lantern",
      notes: "",
      current: false
    },
    {
      sectionId: "sec-sc",
      id: "sc2",
      title: "The tower at night",
      placePageId: null,
      placeTitle: "Harbourmaster's Tower",
      notes: "The lamps are out on the top floor.",
      current: true
    }
  ],
  pageGroups: [
    {
      sectionId: "sec-cast",
      title: "Cast",
      pages: [
        { id: "p-ysolde", title: "Ysolde Varn", entityType: "character", revealedToPlayers: true },
        { id: "p-brannoc", title: "Brannoc", entityType: "character", revealedToPlayers: false }
      ]
    }
  ],
  checklists: [
    {
      sectionId: "sec-clues",
      title: "Secrets and clues",
      items: [
        clue(),
        clue({
          id: "c2",
          text: "The ledger is in the tower.",
          link: { recordKind: "page", recordId: "p-ledger", blockId: null },
          linkTitle: "Harbour Ledger",
          blockTitle: null
        }),
        clue({ id: "c3", text: "Wren is alive.", link: null, linkTitle: null, blockTitle: null, linkRevealed: null })
      ]
    }
  ],
  clocks: [
    {
      id: "d1",
      text: "The council votes on the harbour tax.",
      inWorldLabel: "Emberfall 18",
      calendarInstant: DAY(18),
      fired: false,
      revealedToPlayers: true
    },
    {
      id: "d2",
      text: "The Black Gull sails.",
      inWorldLabel: "Emberfall 20",
      calendarInstant: DAY(20),
      fired: false,
      revealedToPlayers: false
    }
  ],
  quests: [{ id: "q1", title: "The Black Gull", status: "active", revealedToPlayers: true }],
  encounterSceneIds: ["fight-1", "fight-2"],
  logged: [
    {
      id: "l1",
      kind: "note",
      text: "The party paid Mother Quill.",
      revealedToPlayers: false,
      createdAt: "2026-10-17T20:00:00.000Z"
    }
  ]
};

const PARTY = [
  { id: "a-mirena", name: "Mirena Dawnbright" },
  { id: "a-lyra", name: "Lyra Emberwise" }
];
const SCENES = [
  { id: "fight-1", name: "Ambush on the stair" },
  { id: "fight-2", name: "The roof" }
];

const renderTonight = (onMakeLive = vi.fn()) => {
  goTo("/table");
  render(
    <ToastProvider>
      <TonightTab token="gm" party={PARTY} scenes={SCENES} liveSceneId="fight-2" onMakeLive={onMakeLive} />
    </ToastProvider>
  );
  return onMakeLive;
};
const clues = () => within(screen.getByRole("region", { name: "Secrets and clues" }));
/** Waits for the board, then the clue list. */
const loadedClues = async () => within(await screen.findByRole("region", { name: "Secrets and clues" }));
const tickAnswer = (over: Partial<CodexLiveClue> = {}) => ({ session: {}, clue: clue({ done: true, ...over }) });

beforeEach(() => {
  for (const fn of [...Object.values(live), ...Object.values(reads)]) fn.mockReset();
  live.board.mockResolvedValue(BOARD);
  live.currentScene.mockResolvedValue({});
  live.log.mockResolvedValue({});
  reads.calendar.mockResolvedValue(CALENDAR);
  reads.listPages.mockResolvedValue([
    {
      id: "p-ysolde",
      title: "Ysolde Varn",
      entityType: "character",
      fields: { role: "Harbourmaster of Saltmere", goals: "Clear the Tidebound debt." },
      hiddenFields: ["goals"]
    }
  ]);
  reads.setPageBlockAudience.mockResolvedValue({});
  reads.revealPage.mockResolvedValue({});
  reads.getPage.mockResolvedValue({
    page: {
      id: "p-ysolde",
      blocks: [{ id: "b-debt", title: "The debt", text: "Ysolde lost a cargo and pays in silence." }]
    },
    connections: []
  });
});

describe("With no session running", () => {
  it("says so and opens Sessions", async () => {
    live.board.mockResolvedValue(null);
    const user = userEvent.setup();
    renderTonight();
    expect(await screen.findByText(/No session is running/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open sessions" }));
    expect(window.location.pathname).toBe("/codex/sessions");
  });
});

describe("The board", () => {
  it("names the session and the players' date, and marks the current scene with its notes", async () => {
    renderTonight();
    expect(await screen.findByText("Session 6 · Live")).toBeInTheDocument();
    expect(screen.getByText("Players' date: Emberfall 14, 412 SR")).toBeInTheDocument();
    const scenes = within(screen.getByRole("region", { name: "Scenes" }));
    expect(scenes.getByRole("button", { name: /The tower at night/ })).toHaveAttribute("aria-pressed", "true");
    expect(scenes.getByRole("button", { name: /The tower at night/ })).toHaveTextContent("2 · Now");
    expect(scenes.getByRole("button", { name: /Morning at the Gull/ })).toHaveAttribute("aria-pressed", "false");
    expect(scenes.getByText("The lamps are out on the top floor.")).toBeInTheDocument();
  });

  it("moves the current scene through the board's own command", async () => {
    const user = userEvent.setup();
    renderTonight();
    await user.click(await screen.findByRole("button", { name: /Morning at the Gull/ }));
    await waitFor(() => expect(live.currentScene).toHaveBeenCalledWith("gm", "s6", "sc1"));
    // Tapping the current scene again clears it.
    await user.click(screen.getByRole("button", { name: /The tower at night/ }));
    await waitFor(() => expect(live.currentScene).toHaveBeenLastCalledWith("gm", "s6", null));
  });

  it("shows the cast with each role and drive, says Hidden for a page players can't read, and opens a page", async () => {
    const user = userEvent.setup();
    renderTonight();
    const cast = within(await screen.findByRole("region", { name: "Cast" }));
    const ysolde = cast.getByRole("button", { name: /Ysolde Varn/ });
    expect(ysolde).toHaveTextContent("Harbourmaster of Saltmere");
    expect(ysolde).toHaveTextContent("Clear the Tidebound debt.");
    expect(ysolde).not.toHaveTextContent("Hidden");
    expect(cast.getByRole("button", { name: /Brannoc/ })).toHaveTextContent("Hidden");
    await user.click(ysolde);
    expect(window.location.pathname).toBe("/codex/pages/p-ysolde");
  });

  it("counts clocks from the GM's date and marks a hidden one", async () => {
    renderTonight();
    const clocks = within(await screen.findByRole("region", { name: "Clocks" }));
    expect(clocks.getByText("Emberfall 18 · in 4 days")).toBeInTheDocument();
    expect(clocks.getByText("The Black Gull sails.").closest("li")).toHaveTextContent("Hidden");
  });

  it("lists the quests and the fights, and makes a fight live", async () => {
    const user = userEvent.setup();
    const onMakeLive = renderTonight();
    expect(
      within(await screen.findByRole("region", { name: "Quests" })).getByText("The Black Gull")
    ).toBeInTheDocument();
    const encounters = within(screen.getByRole("region", { name: "Fights" }));
    expect(encounters.getByText("The roof").closest("li")).toHaveTextContent("Live");
    await user.click(encounters.getByRole("button", { name: "Make live" }));
    expect(onMakeLive).toHaveBeenCalledWith("fight-1");
  });
});

describe("Ticking a clue", () => {
  it("ticks through the board and offers to reveal the hidden block it links", async () => {
    live.tick.mockResolvedValue(tickAnswer());
    const user = userEvent.setup();
    renderTonight();
    await user.click(await (await loadedClues()).findByRole("checkbox", { name: /Ysolde owes the Tidebound/ }));

    await waitFor(() => expect(live.tick).toHaveBeenCalledWith("gm", "s6", "c1", true));
    const offer = within(await screen.findByRole("group", { name: "Reveal what this clue links" }));
    expect(offer.getByText("This clue links the hidden block The debt. Reveal it to:")).toBeInTheDocument();
    // Nothing is revealed by the tick itself.
    expect(reads.setPageBlockAudience).not.toHaveBeenCalled();

    await user.click(offer.getByRole("button", { name: "Everyone" }));
    await waitFor(() =>
      expect(reads.setPageBlockAudience).toHaveBeenCalledWith("gm", "p-ysolde", "b-debt", { audience: "everyone" })
    );
    expect(await screen.findByText("The debt is revealed to everyone.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Reveal what this clue links" })).toBeNull();
  });

  it("reveals to chosen characters from the shared panel, which shows what they will read", async () => {
    live.tick.mockResolvedValue(tickAnswer());
    const user = userEvent.setup();
    renderTonight();
    await user.click(await (await loadedClues()).findByRole("checkbox", { name: /Ysolde owes the Tidebound/ }));
    await user.click(await screen.findByRole("button", { name: "Choose characters" }));

    const panel = within(await screen.findByRole("dialog", { name: "Reveal The debt" }));
    expect(panel.getByText("Ysolde lost a cargo and pays in silence.")).toBeInTheDocument();
    await user.click(panel.getByRole("checkbox", { name: "Mirena Dawnbright" }));
    await user.click(panel.getByRole("button", { name: "Reveal to Mirena Dawnbright" }));

    await waitFor(() =>
      expect(reads.setPageBlockAudience).toHaveBeenCalledWith("gm", "p-ysolde", "b-debt", {
        audience: "characters",
        characterIds: ["a-mirena"]
      })
    );
    expect(await screen.findByText("The debt is revealed to Mirena Dawnbright.")).toBeInTheDocument();
  });

  it("writes nothing on Not now", async () => {
    live.tick.mockResolvedValue(tickAnswer());
    const user = userEvent.setup();
    renderTonight();
    await user.click(await (await loadedClues()).findByRole("checkbox", { name: /Ysolde owes the Tidebound/ }));
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("group", { name: "Reveal what this clue links" })).toBeNull();
    expect(reads.setPageBlockAudience).not.toHaveBeenCalled();
  });

  it("offers to show a linked page whole when the clue names no block", async () => {
    live.tick.mockResolvedValue(
      tickAnswer({
        id: "c2",
        link: { recordKind: "page", recordId: "p-ledger", blockId: null },
        linkTitle: "Harbour Ledger",
        blockTitle: null
      })
    );
    const user = userEvent.setup();
    renderTonight();
    await user.click(await (await loadedClues()).findByRole("checkbox", { name: /The ledger is in the tower/ }));
    const offer = within(await screen.findByRole("group", { name: "Reveal what this clue links" }));
    expect(offer.getByText("This clue links Harbour Ledger, which players can't read yet.")).toBeInTheDocument();
    expect(offer.queryByRole("button", { name: "Choose characters" })).toBeNull();
    await user.click(offer.getByRole("button", { name: "Show it to players" }));
    await waitFor(() => expect(reads.revealPage).toHaveBeenCalledWith("gm", "p-ledger", true));
  });

  it("offers nothing when players can already read the link, or when there is no link", async () => {
    const user = userEvent.setup();
    live.tick.mockResolvedValueOnce(tickAnswer({ linkRevealed: true }));
    renderTonight();
    await user.click(await (await loadedClues()).findByRole("checkbox", { name: /Ysolde owes the Tidebound/ }));
    await waitFor(() => expect(live.tick).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("group", { name: "Reveal what this clue links" })).toBeNull();

    live.tick.mockResolvedValueOnce(tickAnswer({ id: "c3", link: null, linkRevealed: null }));
    await user.click(clues().getByRole("checkbox", { name: /Wren is alive/ }));
    await waitFor(() => expect(live.tick).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("group", { name: "Reveal what this clue links" })).toBeNull();
  });

  it("offers nothing on an untick", async () => {
    live.board.mockResolvedValue({
      ...BOARD,
      checklists: [{ ...BOARD.checklists[0], items: [clue({ done: true }), ...BOARD.checklists[0].items.slice(1)] }]
    });
    live.tick.mockResolvedValue(tickAnswer({ done: false }));
    const user = userEvent.setup();
    renderTonight();
    await user.click(await (await loadedClues()).findByRole("checkbox", { name: /Ysolde owes the Tidebound/ }));
    await waitFor(() => expect(live.tick).toHaveBeenCalledWith("gm", "s6", "c1", false));
    expect(screen.queryByRole("group", { name: "Reveal what this clue links" })).toBeNull();
  });

  it("names what each clue links, and says Hidden while players can't read it", async () => {
    renderTonight();
    const row = (await (await loadedClues()).findByRole("checkbox", { name: /Ysolde owes the Tidebound/ })).closest(
      "li"
    )!;
    expect(row).toHaveTextContent("Ysolde Varn · The debt");
    expect(row).toHaveTextContent("Hidden");
  });
});

describe("Log what happens", () => {
  it("files a hidden line under the session, or one players read when the GM says so", async () => {
    const user = userEvent.setup();
    renderTonight();
    const log = within(await screen.findByRole("region", { name: "Log what happens" }));
    expect(log.getByRole("button", { name: "Log" })).toBeDisabled();
    await user.type(log.getByRole("textbox", { name: "What happened" }), "Borin broke the lock.");
    await user.click(log.getByRole("button", { name: "Log" }));
    await waitFor(() => expect(live.log).toHaveBeenCalledWith("gm", "s6", "Borin broke the lock.", false));

    await user.click(log.getByRole("switch", { name: "Who sees this line: Hidden" }));
    await user.type(log.getByRole("textbox", { name: "What happened" }), "The tower bell rang.");
    await user.click(log.getByRole("button", { name: "Log" }));
    await waitFor(() => expect(live.log).toHaveBeenLastCalledWith("gm", "s6", "The tower bell rang.", true));
  });

  it("lists what was logged tonight, Hidden where players can't read it", async () => {
    renderTonight();
    const logged = within(await screen.findByRole("list", { name: "Logged tonight" }));
    expect(logged.getByText("The party paid Mother Quill.").closest("li")).toHaveTextContent("Hidden");
  });
});

describe("Counting to a clock", () => {
  it("says today, tomorrow, in days, or how long ago, from the GM's date", () => {
    expect(untilLabel(DAY(14), CALENDAR)).toBe("today");
    expect(untilLabel(DAY(15), CALENDAR)).toBe("tomorrow");
    expect(untilLabel(DAY(18), CALENDAR)).toBe("in 4 days");
    expect(untilLabel(DAY(13), CALENDAR)).toBe("yesterday");
    expect(untilLabel(DAY(10), CALENDAR)).toBe("4 days ago");
    expect(untilLabel(null, CALENDAR)).toBeNull();
    expect(untilLabel(DAY(18), { ...CALENDAR, currentDate: null })).toBeNull();
  });
});
