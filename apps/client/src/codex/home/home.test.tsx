import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("../api", async (actual) => (await import("../../../test/codex-fakes")).fakeApiModule(await actual()));
vi.mock("../api-records", async () => (await import("../../../test/codex-fakes")).fakeRecordsModule());

import type { CodexHome, PlayerCodexChronicleRecord } from "@vtt/domain";
import { CALENDAR, api, playerQuest, records, resetFakes, summary } from "../../../test/codex-fakes";
import { renderGmCodex, renderPlayerCodex } from "../../../test/codex-render";
import { setViewport } from "../../../test/viewport";

const AT = "2026-10-01T00:00:00.000Z";
const IDS = {
  entry: "00000000-0000-4000-8000-0000000000e1",
  map: "00000000-0000-4000-8000-0000000000a1",
  ysolde: "00000000-0000-4000-8000-0000000000b1",
  lena: "00000000-0000-4000-8000-0000000000b2"
};

const HOME: CodexHome = {
  collections: [
    { type: "character", revealed: 8, hidden: 2 },
    { type: "location", revealed: 3, hidden: 0 },
    { type: "faction", revealed: 1, hidden: 1 },
    { type: "religion", revealed: 1, hidden: 0 },
    { type: "journal", revealed: 4, hidden: 4 }
  ],
  recent: [
    {
      kind: "journal",
      id: IDS.entry,
      title: "The party crossed the mists.",
      type: "journal",
      mapId: null,
      changedAt: "2026-10-03T00:00:00.000Z",
      change: "created",
      audience: "everyone",
      characterIds: []
    },
    {
      kind: "map",
      id: IDS.map,
      title: "Saltmere",
      type: "map",
      mapId: null,
      changedAt: "2026-10-02T00:00:00.000Z",
      change: "revealed",
      audience: "everyone",
      characterIds: []
    },
    {
      kind: "page",
      id: IDS.ysolde,
      title: "Ysolde Varn",
      type: "character",
      mapId: null,
      changedAt: "2026-10-01T00:00:00.000Z",
      change: "edited",
      audience: "hidden",
      characterIds: []
    },
    {
      kind: "page",
      id: IDS.lena,
      title: "Lena's letters",
      type: "note",
      mapId: null,
      changedAt: "2026-09-30T00:00:00.000Z",
      change: "revealed",
      audience: "characters",
      characterIds: ["a-lyra"]
    }
  ],
  revealCheck: {
    rows: [
      {
        reason: "link",
        kind: "page",
        id: IDS.lena,
        title: "Lena's letters",
        mapId: null,
        targetKind: "page",
        targetId: IDS.ysolde,
        targetTitle: "Ysolde Varn",
        fieldKey: null
      }
    ],
    total: 1
  }
};

const SESSION = {
  id: "s6",
  sessionNumber: 6,
  realDate: "Saturday, October 24",
  attendees: [],
  prep: [],
  prepTemplateId: null,
  currentSceneId: null,
  recapBody: "",
  revealedToPlayers: false,
  status: "planned",
  tags: [],
  sceneIds: [],
  rev: 1,
  createdAt: AT,
  updatedAt: AT,
  firstShownAt: null
};

const playerRecord = (over: Partial<PlayerCodexChronicleRecord>): PlayerCodexChronicleRecord => ({
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
  firstShownAt: AT,
  ...over
});

const bar = () => within(screen.getAllByRole("navigation", { name: "Codex sections" })[0]);

beforeEach(() => {
  localStorage.clear();
  resetFakes();
  api.codexApi.listPages.mockResolvedValue([summary()]);
  records.findApi.home.mockResolvedValue(HOME);
  api.calendarApi.get.mockResolvedValue({
    ...CALENDAR,
    currentDate: { year: 1492, month: 0, day: 3 },
    publishedDate: { year: 1492, month: 0, day: 1 }
  });
});

describe("Home is the section name", () => {
  it("on the GM's section bar, lit at /codex, with no 'World' anywhere in it", async () => {
    renderGmCodex("/codex");
    await waitFor(() => expect(records.findApi.home).toHaveBeenCalled());
    expect(bar().getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(bar().queryByRole("button", { name: "World" })).not.toBeInTheDocument();
  });

  it("on a player's section bar too, where a player lands", async () => {
    renderPlayerCodex("/codex");
    await waitFor(() => expect(records.findApi.homeForPlayer).toHaveBeenCalled());
    expect(bar().getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(bar().queryByRole("button", { name: "World" })).not.toBeInTheDocument();
  });

  it("as the command palette's Go to Home, which reaches the section and its cards", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex/quests");
    await waitFor(() => expect(api.codexApi.listPages).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: /Search the Codex/ }));
    const palette = within(screen.getByRole("dialog", { name: "Codex command palette" }));
    expect(palette.queryByText("Go to World")).not.toBeInTheDocument();
    await user.click(palette.getByText("Go to Home"));

    expect(bar().getByRole("button", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("region", { name: "Recently changed" })).toBeInTheDocument();
  });
});

describe("The GM's Home", () => {
  it("shows both dates in one bar, the same bar as Story's", async () => {
    renderGmCodex("/codex");
    const dates = within(await screen.findByRole("group", { name: "The two dates" }));
    expect(dates.getByRole("button", { name: "Your date is Hammer 3, 1492 DR. Change it." })).toHaveTextContent(
      "Hammer 3"
    );
    expect(dates.getByText("Hammer 1")).toBeInTheDocument();
    expect(dates.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("counts each collection in words from the server's numbers, and the hidden part opens Search filtered to Hidden", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex");
    const people = await screen.findByRole("region", { name: "People" });
    await waitFor(() => expect(within(people).getByText("10")).toBeInTheDocument());
    expect(people).toHaveTextContent("8 revealed · 2 hidden");
    // Factions gathers factions and religions, as the Pages index does.
    expect(screen.getByRole("region", { name: "Factions" })).toHaveTextContent("2 revealed · 1 hidden");
    // A journal record is not a page, so it counts toward no tile.
    expect(screen.getByRole("heading", { name: "Codex" }).parentElement).toHaveTextContent(
      "16 pages: 13 revealed · 3 hidden"
    );

    await user.click(within(people).getByRole("button", { name: "2 hidden" }));
    expect(window.location.pathname).toBe("/codex/search");
    expect(new URLSearchParams(window.location.search).get("visibility")).toBe("hidden");
    expect(new URLSearchParams(window.location.search).get("types")).toBe("character");
  });

  it("lists what changed lately in the server's order, saying who sees each change by name", async () => {
    renderGmCodex("/codex");
    const recent = within(await screen.findByRole("region", { name: "Recently changed" }));
    await waitFor(() => expect(recent.getAllByRole("row")).toHaveLength(5));
    const rows = recent.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "The party crossed the mists.",
      "Saltmere",
      "Ysolde Varn",
      "Lena's letters"
    ]);
    expect(rows.map((row) => within(row).getAllByRole("cell")[2].textContent)).toEqual([
      "Everyone",
      "Everyone",
      "Hidden",
      "Lyra Emberwise"
    ]);
    expect(within(rows[0]).getByText("Created")).toBeInTheDocument();
  });

  it("opens a journal row in Story with that entry marked, and a map row on the atlas at that map", async () => {
    const user = userEvent.setup();
    // Story may tidy its own address once it opens, so read where the row sent the browser.
    const push = vi.spyOn(window.history, "pushState");
    const view = renderGmCodex("/codex");
    const recent = within(await screen.findByRole("region", { name: "Recently changed" }));
    await user.click(await recent.findByRole("button", { name: "The party crossed the mists." }));
    expect(push.mock.calls.at(-1)?.[2]).toBe(`/codex/story?entry=${IDS.entry}`);
    view.unmount();

    renderGmCodex("/codex");
    const again = within(await screen.findByRole("region", { name: "Recently changed" }));
    await user.click(await again.findByRole("button", { name: "Saltmere" }));
    expect(window.location.pathname).toBe(`/codex/atlas/${IDS.map}`);
  });

  it("says Home failed to load and never poses as an empty Codex", async () => {
    records.findApi.home.mockRejectedValue(new Error("The codex request failed (500)."));
    renderGmCodex("/codex");
    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    expect(screen.queryByRole("region", { name: "Make your first page" })).not.toBeInTheDocument();
  });

  it("offers the first page when there are no pages, and still shows the records that do exist", async () => {
    const user = userEvent.setup();
    records.findApi.home.mockResolvedValue({ ...HOME, collections: [{ type: "journal", revealed: 2, hidden: 0 }] });
    renderGmCodex("/codex");
    const first = await screen.findByRole("region", { name: "Make your first page" });
    expect(within(screen.getByRole("region", { name: "Recently changed" })).getAllByRole("row")).toHaveLength(5);

    await user.click(within(first).getByRole("button", { name: "New page" }));
    expect(await screen.findByRole("dialog", { name: /New page/i })).toBeInTheDocument();
  });

  it("names the next session, opens its prep, and starts it through the session's own route", async () => {
    const user = userEvent.setup();
    api.sessionApi.list.mockResolvedValue({ sessions: [SESSION], activeSessionId: null });
    api.sessionApi.activate.mockResolvedValue({ ...SESSION, status: "planned" });
    renderGmCodex("/codex");
    const card = await screen.findByRole("region", { name: "Next · Session 6" });
    expect(card).toHaveTextContent("Saturday, October 24");

    await user.click(within(card).getByRole("button", { name: "Start session 6" }));
    await waitFor(() => expect(api.sessionApi.activate).toHaveBeenCalledWith("gm", "s6"));

    await user.click(within(card).getByRole("button", { name: "Open prep" }));
    expect(window.location.pathname).toBe("/codex/sessions/s6");
  });

  it("lists the reveal check's rows in words and opens the record each names", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex");
    const check = within(await screen.findByRole("region", { name: "Reveal check" }));
    const row = await check.findByRole("button", { name: /Lena's letters/ });
    expect(row).toHaveTextContent("It names Ysolde Varn, which is Hidden.");
    await user.click(row);
    expect(window.location.pathname).toBe(`/codex/pages/${IDS.lena}`);
  });

  it("sends a long reveal check to Search filtered to Hidden", async () => {
    const user = userEvent.setup();
    const row = HOME.revealCheck.rows[0];
    records.findApi.home.mockResolvedValue({
      ...HOME,
      revealCheck: { rows: Array.from({ length: 8 }, (_, at) => ({ ...row, title: `Letter ${at}` })), total: 12 }
    });
    renderGmCodex("/codex");
    const check = within(await screen.findByRole("region", { name: "Reveal check" }));
    await user.click(await check.findByRole("button", { name: "See every Hidden record" }));
    expect(window.location.pathname).toBe("/codex/search");
    expect(window.location.search).toBe("?visibility=hidden");
  });

  it("says no pin marks the party, then shows the party's map and opens the atlas there", async () => {
    const view = renderGmCodex("/codex");
    expect(await screen.findByText(/No pin marks the party yet/)).toBeInTheDocument();
    view.unmount();

    const user = userEvent.setup();
    api.codexApi.party.mockResolvedValue({
      marker: {
        id: "pin1",
        mapId: IDS.map,
        x: 10,
        y: 20,
        iconId: "pin",
        iconColor: "#fff",
        label: "Gull and Lantern",
        revealedToPlayers: true
      },
      mapName: "Saltmere"
    });
    api.atlasApi.listMaps.mockResolvedValue([{ id: IDS.map, assetId: "asset1", name: "Saltmere" }]);
    renderGmCodex("/codex");
    const card = within(await screen.findByRole("region", { name: "Where the party is" }));
    expect(await card.findByText("Gull and Lantern, Saltmere")).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Open the atlas" }));
    expect(window.location.pathname).toBe(`/codex/atlas/${IDS.map}`);
    expect(new URLSearchParams(window.location.search).get("pin")).toBe("pin1");
  });
});

describe("A player's Home reads only the player's projection (viewer safety)", () => {
  it("asks the player routes for everything, and no GM route at all", async () => {
    renderPlayerCodex("/codex");
    await waitFor(() => expect(records.findApi.homeForPlayer).toHaveBeenCalledWith("player", null));
    await waitFor(() => expect(api.playerCodexApi.listPages).toHaveBeenCalled());
    expect(records.findApi.home).not.toHaveBeenCalled();
    expect(api.codexApi.listPages).not.toHaveBeenCalled();
    expect(api.calendarApi.get).not.toHaveBeenCalled();
    expect(api.journalApi.chronicle).not.toHaveBeenCalled();
  });

  it("lists what is new since the last visit in the server's order, and sends that visit next time", async () => {
    const user = userEvent.setup();
    records.findApi.homeForPlayer.mockResolvedValue({
      newSince: [
        {
          kind: "journal",
          id: IDS.entry,
          title: "We met Ysolde.",
          type: "journal",
          mapId: null,
          at: AT,
          change: "new"
        },
        {
          kind: "page",
          id: IDS.lena,
          title: "Lena's letters",
          type: "note",
          mapId: null,
          at: "2026-09-01T00:00:00.000Z",
          change: "updated"
        }
      ],
      truncated: false
    });
    const view = renderPlayerCodex("/codex");
    const card = within(await screen.findByRole("region", { name: "New since your last visit" }));
    const rows = (await card.findAllByRole("row")).slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1].textContent)).toEqual(["New", "Changed"]);
    const push = vi.spyOn(window.history, "pushState");
    await user.click(card.getByRole("button", { name: "We met Ysolde." }));
    expect(push.mock.calls.at(-1)?.[2]).toBe(`/codex/story?entry=${IDS.entry}`);
    view.unmount();

    const visited = localStorage.getItem("codex-last-visit");
    expect(visited).not.toBeNull();
    renderPlayerCodex("/codex");
    await waitFor(() => expect(records.findApi.homeForPlayer).toHaveBeenLastCalledWith("player", visited));
  });

  it("gives a player none of the GM's cards or words", async () => {
    renderPlayerCodex("/codex");
    await screen.findByRole("region", { name: "New since your last visit" });
    expect(screen.queryByRole("region", { name: "Reveal check" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "The two dates" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No pin marks the party/)).not.toBeInTheDocument();
    expect(screen.getByText("The party's place isn't on a map you can see yet.")).toBeInTheDocument();
  });

  it("names the latest recap's session and opens it", async () => {
    const user = userEvent.setup();
    api.playerCodexApi.sessions.mockResolvedValue([
      { id: "s2", sessionNumber: 2, realDate: null, recap: "They left Daggerford.", tags: [] },
      { id: "s3", sessionNumber: 3, realDate: null, recap: "They crossed the mists.", tags: [] }
    ]);
    renderPlayerCodex("/codex");
    const card = within(await screen.findByRole("region", { name: "Latest recap" }));
    expect(card.getByText("Session 3")).toBeInTheDocument();
    expect(card.getByText("They crossed the mists.")).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Open the session" }));
    expect(window.location.pathname).toBe("/codex/sessions/s3");
  });

  it("renders nothing from a GM-shaped session row, should the server ever send one", async () => {
    api.playerCodexApi.sessions.mockResolvedValue([
      {
        id: "s8",
        sessionNumber: 8,
        realDate: null,
        recap: "They reached the spire.",
        tags: [],
        prep: [{ id: "prep-8", type: "text", title: "Prep notes", text: "The heart of the castle." }],
        attendees: ["Ana"],
        recapBody: "a GM-shaped duplicate of the recap"
      }
    ]);
    renderPlayerCodex("/codex");
    expect(await screen.findByText("They reached the spire.")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("The heart of the castle.");
    expect(text).not.toContain("Ana");
    expect(text).not.toContain("a GM-shaped duplicate of the recap");
  });

  it("lists the clocks a player knows, passed first, each saying which, and opens the record", async () => {
    const user = userEvent.setup();
    api.playerCodexApi.chronicle.mockResolvedValue([
      playerRecord({ kind: "deadline", id: "d1", text: "The duke's ultimatum expires.", fired: false }),
      playerRecord({ id: "j9", text: "An ordinary entry." }),
      playerRecord({ kind: "deadline", id: "d2", text: "The tide turns.", fired: true })
    ]);
    renderPlayerCodex("/codex");
    const card = within(await screen.findByRole("region", { name: "Clocks" }));
    const rows = await card.findAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("The tide turns.Passed"),
      expect.stringContaining("The duke's ultimatum expires.Approaching")
    ]);
    expect(card.queryByText("An ordinary entry.")).not.toBeInTheDocument();
    const push = vi.spyOn(window.history, "pushState");
    await user.click(rows[1]);
    expect(push.mock.calls.at(-1)?.[2]).toBe("/codex/story?entry=d1");
  });

  it("lists the open quests with progress in words and nothing to tick, leaving finished ones to Quests", async () => {
    api.playerCodexApi.quests.mockResolvedValue([
      playerQuest(),
      playerQuest({ id: "q2", title: "The Bell of Vallaki", status: "completed" })
    ]);
    renderPlayerCodex("/codex");
    const card = within(await screen.findByRole("region", { name: "Open quests" }));
    expect(await card.findByText("The Sunless Crown")).toBeInTheDocument();
    expect(card.getByText("1 of 2 done")).toBeInTheDocument();
    expect(card.queryByText("The Bell of Vallaki")).not.toBeInTheDocument();
    expect(card.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("Home on a phone", () => {
  beforeEach(() => setViewport(390));

  it("lists the GM's collections as rows with their counts, and a row opens that group's pages", async () => {
    const user = userEvent.setup();
    renderGmCodex("/codex");
    const people = await screen.findByRole("button", { name: /^People/ });
    await waitFor(() => expect(people).toHaveTextContent("8 revealed · 2 hidden"));
    await user.click(people);
    expect(window.location.pathname).toBe("/codex/pages");
    expect(window.location.search).toBe("?group=people");
  });

  it("marks how many pages in a group are new for a player", async () => {
    api.playerCodexApi.listPages.mockResolvedValue([
      {
        id: IDS.ysolde,
        title: "Ysolde Varn",
        entityType: "character",
        tags: [],
        bannerAssetId: null,
        playerUpdatedAt: AT
      }
    ]);
    records.findApi.homeForPlayer.mockResolvedValue({
      newSince: [
        { kind: "page", id: IDS.ysolde, title: "Ysolde Varn", type: "character", mapId: null, at: AT, change: "new" }
      ],
      truncated: false
    });
    renderPlayerCodex("/codex");
    const people = await screen.findByRole("button", { name: /^People/ });
    await waitFor(() => expect(people).toHaveTextContent("1 new"));
  });
});
