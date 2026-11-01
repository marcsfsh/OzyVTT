import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./atlas/AtlasMap", () => ({ AtlasMap: () => <div data-testid="map-surface" /> }));

const listPages = vi.fn();
const listFolders = vi.fn();
const listConnections = vi.fn();
const party = vi.fn();
const getPage = vi.fn();
const getSettings = vi.fn();
const search = vi.fn();
const playerSearch = vi.fn();
const markersForPage = vi.fn();
const chronicle = vi.fn();
const playerChronicle = vi.fn();
const listMaps = vi.fn();
const getCalendar = vi.fn();
const playerCalendar = vi.fn();
const listSessions = vi.fn();
const listQuests = vi.fn();
const createSessionCall = vi.fn();
const createQuestCall = vi.fn();
const listStanding = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerConnections = vi.fn();
const playerParty = vi.fn();
const playerSessions = vi.fn();
const playerQuests = vi.fn();
const playerStanding = vi.fn();

// The palette and the tag view search through the record API; each call reads as (token, words) here.
vi.mock("./api-records", () => ({
  findApi: {
    search: (token: string, params: { q: string }) => search(token, params.q),
    searchAsPlayer: (token: string, params: { q: string }) => playerSearch(token, params.q)
  }
}));
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
      getPage: (...a: unknown[]) => getPage(...a),
      getSettings: (...a: unknown[]) => getSettings(...a),
      search: (...a: unknown[]) => search(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      search: (...a: unknown[]) => playerSearch(...a),
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: async () => [],
      chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerConnections(...a),
      party: (...a: unknown[]) => playerParty(...a),
      sessions: (...a: unknown[]) => playerSessions(...a),
      quests: (...a: unknown[]) => playerQuests(...a),
      standing: (...a: unknown[]) => playerStanding(...a),
      calendar: (...a: unknown[]) => playerCalendar(...a)
    },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a), forPage: async () => [] },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: async () => [],
      listMarkers: async () => []
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    sessionApi: {
      ...actual.sessionApi,
      list: (...a: unknown[]) => listSessions(...a),
      create: (...a: unknown[]) => createSessionCall(...a)
    },
    questApi: {
      ...actual.questApi,
      list: (...a: unknown[]) => listQuests(...a),
      create: (...a: unknown[]) => createQuestCall(...a)
    },
    standingApi: { ...actual.standingApi, list: (...a: unknown[]) => listStanding(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";
import { SearchDialog } from "../shell/SearchDialog";
import { closeSearch } from "../shell/search-store";
import type { CodexSearchHit } from "@vtt/domain";

/**
 * The Codex's search and commands, as the one search's Codex place (ADR-0049, frame rule 3.4): Ctrl K opens it on
 * every page, and the Codex adds its creates while it is mounted. A player searches through `searchAsPlayer` and
 * gets no create verbs.
 */

const PAGE = {
  id: "p1",
  title: "Strahd von Zarovich",
  entityType: "character" as const,
  fields: {},
  folder: null,
  tags: [],
  revealedToPlayers: true,
  bannerAssetId: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  rev: 1,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
};
const HIT: CodexSearchHit = {
  kind: "page",
  id: "p1",
  title: "Strahd von Zarovich",
  tags: [],
  entityType: "character",
  mapId: null,
  type: "character",
  revealedToPlayers: true,
  modifiedAt: "2026-07-28T00:00:00.000Z",
  columns: {},
  match: null
};

const palette = () => screen.findByRole("dialog", { name: "Search" });
const noPalette = () => expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
const renderGm = (at = "/codex") =>
  (goTo(at), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
      <SearchDialog role="gm" token="gm" sections={[]} />
    </ToastProvider>
  );

beforeEach(() => {
  closeSearch();
  listPages.mockResolvedValue([PAGE]);
  listFolders.mockResolvedValue([]);
  listConnections.mockResolvedValue([]);
  party.mockResolvedValue(null);
  getPage.mockResolvedValue({ page: { ...PAGE, playerBody: "", blocks: [] }, connections: [] });
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: true, intervalSeconds: 1 } });
  search.mockResolvedValue({ hits: [], truncated: false });
  playerSearch.mockResolvedValue({ hits: [], truncated: false });
  markersForPage.mockResolvedValue([]);
  chronicle.mockResolvedValue([]);
  playerChronicle.mockResolvedValue([]);
  listMaps.mockResolvedValue([]);
  getCalendar.mockResolvedValue({
    yearName: "DR",
    months: [{ name: "Hammer", days: 30 }],
    weekdays: [],
    currentInstant: 0,
    publishedInstant: 0
  });
  playerCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] });
  listSessions.mockResolvedValue({ sessions: [], activeSessionId: null });
  listQuests.mockResolvedValue([]);
  createSessionCall.mockResolvedValue({ id: "s-new", sessionNumber: 1, status: "planned" });
  createQuestCall.mockResolvedValue({ id: "q-new", title: "Untitled quest", status: "active" });
  listStanding.mockResolvedValue([]);
  playerListPages.mockResolvedValue([]);
  playerListMaps.mockResolvedValue([]);
  playerConnections.mockResolvedValue([]);
  playerParty.mockResolvedValue(null);
  playerSessions.mockResolvedValue([]);
  playerQuests.mockResolvedValue([]);
  playerStanding.mockResolvedValue([]);
});

describe("Opening and closing", () => {
  it("opens on Ctrl-K and closes on Escape", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.keyboard("{Control>}k{/Control}");
    expect(await palette()).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(noPalette);
  });

  it("opens from the bar's search box, which announces the shortcut it duplicates", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const row = screen.getByRole("button", { name: /Search the Codex/ });
    expect(row).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
    await user.click(row);
    expect(await palette()).toBeInTheDocument();
  });
});

describe("One Ctrl K, with the Codex's creates while it is mounted", () => {
  it("opens the same search on a page with no Codex, without the Codex's creates", async () => {
    const user = userEvent.setup();
    goTo("/table");
    render(
      <ToastProvider>
        <div>Some other tab</div>
        <SearchDialog role="gm" token="gm" sections={[]} />
      </ToastProvider>
    );
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());
    await user.click(within(box.getByRole("group", { name: "Where to look" })).getByRole("button", { name: "Codex" }));
    expect(box.getByText("Go to Story")).toBeInTheDocument();
    expect(box.queryByText("New session")).not.toBeInTheDocument();
  });

  it("drops the creates once the Codex unmounts", async () => {
    const user = userEvent.setup();
    const view = renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    view.unmount();
    render(<SearchDialog role="gm" token="gm" sections={[]} />);

    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());
    await user.click(within(box.getByRole("group", { name: "Where to look" })).getByRole("button", { name: "Codex" }));
    expect(box.queryByText("New session")).not.toBeInTheDocument();
  });
});

describe("What it can do", () => {
  it("jumps to a record, and closes behind itself", async () => {
    search.mockResolvedValue({ hits: [HIT], truncated: false });
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());
    await user.type(box.getByLabelText("Search the Codex"), "strahd");
    await user.click(await box.findByRole("button", { name: /Strahd von Zarovich/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p1"));
    // The search closes after navigating.
    noPalette();
  });

  it("ends the hits with See all results, which opens the Codex's search page, and keeps New page last", async () => {
    search.mockResolvedValue({ hits: [HIT], truncated: false });
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());
    await user.type(box.getByLabelText("Search the Codex"), "strahd");
    const seeAll = await box.findByRole("button", { name: /See all 1 result/ });
    const names = box.getAllByRole("option").map((option) => option.textContent ?? "");
    expect(names.findIndex((name) => name.startsWith("See all"))).toBe(1);
    expect(names.at(-1)).toMatch(/^New page "strahd"/);
    await user.click(seeAll);
    await waitFor(() => expect(window.location.pathname).toBe("/codex/search"));
    expect(new URLSearchParams(window.location.search).get("q")).toBe("strahd");
  });

  it("offers a GO TO verb for every place the shell opens: one list, never two", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());

    // Built from `codexDestinations`, so new sections appear automatically.
    for (const label of [
      "Home",
      "Search",
      "Pages",
      "Atlas",
      "Story",
      "Timeline",
      "Sessions",
      "Quests",
      "Relationships",
      "Prep templates",
      "Backup",
      "Autosave and history"
    ]) {
      expect(box.getByText(`Go to ${label}`)).toBeInTheDocument();
    }
    // An action of the GM menu, with no address.
    expect(box.queryByText(/Go to See as/)).not.toBeInTheDocument();
  });

  it("navigates on a goto verb", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    await user.click(within(await palette()).getByText("Go to Relationships"));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/relationships"));
  });

  it("offers to CREATE the thing you typed, unless a page already has that exact title", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());

    await user.type(box.getByLabelText("Search the Codex"), "Vallaki");
    expect(await box.findByRole("button", { name: /New page "Vallaki"/ })).toBeInTheDocument();

    search.mockResolvedValue({ hits: [HIT], truncated: false });
    await user.clear(box.getByLabelText("Search the Codex"));
    await user.type(box.getByLabelText("Search the Codex"), "Strahd von Zarovich");
    await waitFor(() =>
      expect(box.queryByRole("button", { name: /New page "Strahd von Zarovich"/ })).not.toBeInTheDocument()
    );
  });

  it("says when the result list is CLIPPED rather than letting it look complete", async () => {
    search.mockResolvedValue({ hits: [HIT], truncated: true });
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());
    await user.type(box.getByLabelText("Search the Codex"), "a");
    // A clipped list says so.
    expect(await box.findByText(/Showing the first/)).toBeInTheDocument();
  });

  it("keyboard-drives: arrow down then Enter runs the highlighted action", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    (await palette()).querySelector("input")!.focus();

    // ArrowDown then Enter must run the second action.
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(createSessionCall).toHaveBeenCalled());
    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s-new"));
  });

  /** Asserts the write and then the new record's address; landing on the list is not a create. */
  it("New session creates a session and opens it, beyond going to the list", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");

    await user.click(within(await palette()).getByRole("button", { name: /^New session/ }));

    await waitFor(() => expect(createSessionCall).toHaveBeenCalledTimes(1));
    // The rail's create (`creates.ts`): next number, planned, with an idempotency key.
    expect(createSessionCall.mock.calls[0][1]).toMatchObject({ sessionNumber: 1, status: "planned" });
    expect(createSessionCall.mock.calls[0][1].commandId).toEqual(expect.any(String));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s-new"));
    noPalette();
  });

  it("New quest creates a quest and opens it", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");

    await user.click(within(await palette()).getByRole("button", { name: /^New quest/ }));

    await waitFor(() => expect(createQuestCall).toHaveBeenCalledTimes(1));
    expect(createQuestCall.mock.calls[0][1]).toMatchObject({ title: "Untitled quest" });
    await waitFor(() => expect(window.location.pathname).toBe("/codex/quests/q-new"));
  });

  /** Journal entries and downtime are composed in forms, so their verbs ("Log ...") navigate and write nothing. */
  it("the two Log verbs go to their composer and write nothing", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");

    await user.click(within(await palette()).getByRole("button", { name: /^Log downtime/ }));

    await waitFor(() => expect(window.location.pathname).toBe("/codex/story"));
    expect(window.location.search).toBe("?kind=downtime");
    expect(createSessionCall).not.toHaveBeenCalled();
    expect(createQuestCall).not.toHaveBeenCalled();
  });
});

describe("The player's Codex search", () => {
  const renderPlayer = () =>
    (goTo("/codex"), render)(
      <>
        <PlayerCodex token="player" />
        <SearchDialog role="player" token="player" sections={[]} />
      </>
    );

  it("searches through the PLAYER endpoint and never the GM's", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    await user.keyboard("{Control>}k{/Control}");
    await user.type(within(await palette()).getByLabelText("Search the Codex"), "strahd");

    await waitFor(() => expect(playerSearch).toHaveBeenCalledWith("player", "strahd"));
    // The GM search is never called at all, and nothing is filtered after.
    expect(search).not.toHaveBeenCalled();
  });

  it("offers no create verbs: a player writes nothing", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());

    for (const verb of [/New page/, /New session/, /New quest/, /Log a journal entry/, /Log downtime/]) {
      expect(box.queryByText(verb)).not.toBeInTheDocument();
    }
  });

  it("offers no GM-only destination: the palette cannot route around the shell", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    const box = within(
      await palette().catch(async () => {
        await user.keyboard("{Control>}k{/Control}");
        return palette();
      })
    );

    // Built from the player's destinations, so the palette can't reach a route the shell hides.
    for (const label of ["Prep templates", "Backup", "Autosave and history"]) {
      expect(box.queryByText(`Go to ${label}`)).not.toBeInTheDocument();
    }
    expect(box.getByText("Go to Story")).toBeInTheDocument();
  });
});
