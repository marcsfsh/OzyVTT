import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

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
import type { CodexSearchHit } from "@vtt/domain";

/**
 * The Codex command palette. It is scoped to the Codex; making it global is a separate decision.
 * The player palette searches through `playerCodexApi` and offers no create verbs.
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

const palette = () => screen.findByRole("dialog", { name: "Codex command palette" });
const renderGm = (at = "/codex") =>
  (goTo(at), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
    </ToastProvider>
  );

beforeEach(() => {
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Codex command palette" })).not.toBeInTheDocument()
    );
  });

  it("opens from the sidebar's Search row, which announces the shortcut it duplicates", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const row = within(screen.getByRole("navigation", { name: "Codex sections" })).getByRole("button", {
      name: /Search/
    });
    expect(row).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
    await user.click(row);
    expect(await palette()).toBeInTheDocument();
  });
});

describe("The scope decision: Codex-only, deliberately", () => {
  /** Fails if the key listener moves to `main.tsx` or module scope. */
  it("⌘K does nothing when the Codex is not on screen", async () => {
    /** A bare tree is the discriminating case: a global listener would fire regardless of what's rendered. */
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <div>Some other tab</div>
      </ToastProvider>
    );
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Codex command palette" })).not.toBeInTheDocument();
  });

  it("stops listening once the Codex unmounts", async () => {
    const user = userEvent.setup();
    const view = renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    view.unmount();

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog", { name: "Codex command palette" })).not.toBeInTheDocument();
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
    await user.click(await box.findByText("Strahd von Zarovich"));

    await waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p1"));
    // The palette closes after navigating.
    expect(screen.queryByRole("dialog", { name: "Codex command palette" })).not.toBeInTheDocument();
  });

  it("offers a GO TO verb for every sidebar destination: one list, never two", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());

    // Built from GM_SIDEBAR, so new sections appear automatically.
    for (const label of [
      "Home",
      "Pages",
      "Atlas",
      "Graph",
      "Sessions",
      "Quests",
      "Journal",
      "Calendar",
      "Downtime",
      "Reveal audit",
      "Backup",
      "Autosave and history"
    ]) {
      expect(box.getByText(`Go to ${label}`)).toBeInTheDocument();
    }
    // An action, and no address.
    expect(box.queryByText("Go to Preview as player")).not.toBeInTheDocument();
  });

  it("navigates on a goto verb", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    await user.click(within(await palette()).getByText("Go to Downtime"));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/downtime"));
  });

  it("offers to CREATE the thing you typed, unless a page already has that exact title", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());

    await user.type(box.getByLabelText("Search the Codex"), "Vallaki");
    expect(await box.findByText(/New page "Vallaki"/)).toBeInTheDocument();

    search.mockResolvedValue({ hits: [HIT], truncated: false });
    await user.clear(box.getByLabelText("Search the Codex"));
    await user.type(box.getByLabelText("Search the Codex"), "Strahd von Zarovich");
    await waitFor(() => expect(box.queryByText(/New page "Strahd von Zarovich"/)).not.toBeInTheDocument());
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
    await (await palette()).querySelector("input")!.focus();

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

    await user.click(within(await palette()).getByRole("button", { name: "New session" }));

    await waitFor(() => expect(createSessionCall).toHaveBeenCalledTimes(1));
    // The rail's create (`creates.ts`): next number, planned, with an idempotency key.
    expect(createSessionCall.mock.calls[0][1]).toMatchObject({ sessionNumber: 1, status: "planned" });
    expect(createSessionCall.mock.calls[0][1].commandId).toEqual(expect.any(String));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s-new"));
    expect(screen.queryByRole("dialog", { name: "Codex command palette" })).not.toBeInTheDocument();
  });

  it("New quest creates a quest and opens it", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");

    await user.click(within(await palette()).getByRole("button", { name: "New quest" }));

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

    await user.click(within(await palette()).getByRole("button", { name: "Log downtime" }));

    await waitFor(() => expect(window.location.pathname).toBe("/codex/downtime"));
    expect(createSessionCall).not.toHaveBeenCalled();
    expect(createQuestCall).not.toHaveBeenCalled();
  });
});

describe("The player's palette", () => {
  const renderPlayer = () => (goTo("/codex"), render)(<PlayerCodex token="player" />);

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

  it("offers no GM-only destination: the palette cannot route around the sidebar", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    const box = within(
      await palette().catch(async () => {
        await user.keyboard("{Control>}k{/Control}");
        return palette();
      })
    );

    // Built from PLAYER_SIDEBAR, so the palette can't reach a route the nav hides.
    for (const label of ["Reveal audit", "Backup", "Autosave and history", "Preview as player"]) {
      expect(box.queryByText(`Go to ${label}`)).not.toBeInTheDocument();
    }
    expect(box.getByText("Go to Journal")).toBeInTheDocument();
  });
});
