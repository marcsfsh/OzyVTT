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
      listPages: (...a: unknown[]) => listPages(...a), listFolders: (...a: unknown[]) => listFolders(...a),
      listConnections: (...a: unknown[]) => listConnections(...a), party: (...a: unknown[]) => party(...a),
      getPage: (...a: unknown[]) => getPage(...a), getSettings: (...a: unknown[]) => getSettings(...a),
      search: (...a: unknown[]) => search(...a), markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      search: (...a: unknown[]) => playerSearch(...a),
      listPages: (...a: unknown[]) => playerListPages(...a), listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: async () => [], chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerConnections(...a), party: (...a: unknown[]) => playerParty(...a),
      sessions: (...a: unknown[]) => playerSessions(...a), quests: (...a: unknown[]) => playerQuests(...a),
      standing: (...a: unknown[]) => playerStanding(...a), calendar: (...a: unknown[]) => playerCalendar(...a)
    },
    journalApi: { ...actual.journalApi, chronicle: (...a: unknown[]) => chronicle(...a), forPage: async () => [] },
    atlasApi: { ...actual.atlasApi, listMaps: (...a: unknown[]) => listMaps(...a), listAssets: async () => [], listMarkers: async () => [] },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    sessionApi: { ...actual.sessionApi, list: (...a: unknown[]) => listSessions(...a), create: (...a: unknown[]) => createSessionCall(...a) },
    questApi: { ...actual.questApi, list: (...a: unknown[]) => listQuests(...a), create: (...a: unknown[]) => createQuestCall(...a) },
    standingApi: { ...actual.standingApi, list: (...a: unknown[]) => listStanding(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";
import type { CodexSearchHit } from "./api";

/**
 * D20 — the Codex quick-switcher, and the scope decision that comes with it.
 *
 * **It is Codex-scoped and deliberately not app-global.** That is the part worth locking, because
 * "make ⌘K global" is the obvious next step, it is one line, and it is a separate decision nobody has
 * taken. A global palette would have to answer for the Encounter tab (what does "go to Journal" mean
 * mid-combat?) and for the player who is on the table view. Until that is decided, the shortcut leaves
 * with the section — and a test says so, rather than a comment.
 *
 * The other half is the PLAYER's palette, which is the same component with `player` set. Its two
 * differences are load-bearing to invariant §1: it searches through `playerCodexApi` and it offers no
 * create verbs. Both are asserted here rather than assumed from the prop.
 */

const PAGE = {
  id: "p1", title: "Strahd von Zarovich", entityType: "character" as const, fields: {}, folder: null, tags: [],
  revealedToPlayers: true, bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
};
const HIT: CodexSearchHit = { kind: "page", id: "p1", title: "Strahd von Zarovich", tags: [], entityType: "character", mapId: null };

const palette = () => screen.findByRole("dialog", { name: "Codex command palette" });
const renderGm = (at = "/codex") => (goTo(at), render)(<ToastProvider><CodexShell gmToken="gm" /></ToastProvider>);

beforeEach(() => {
  listPages.mockResolvedValue([PAGE]);
  listFolders.mockResolvedValue([]);
  listConnections.mockResolvedValue([]);
  party.mockResolvedValue(null);
  getPage.mockResolvedValue({ page: { ...PAGE, playerBody: "", gmBody: "", gmFields: {} }, connections: [] });
  getSettings.mockResolvedValue({ revealWarn: true, autosave: { enabled: true, intervalSeconds: 1 } });
  search.mockResolvedValue({ hits: [], truncated: false });
  playerSearch.mockResolvedValue({ hits: [], truncated: false });
  markersForPage.mockResolvedValue([]);
  chronicle.mockResolvedValue([]);
  playerChronicle.mockResolvedValue([]);
  listMaps.mockResolvedValue([]);
  getCalendar.mockResolvedValue({ yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [], currentInstant: 0, publishedInstant: 0 });
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
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Codex command palette" })).not.toBeInTheDocument());
  });

  it("opens from the sidebar's Search row, which announces the shortcut it duplicates", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    const row = within(screen.getByRole("navigation", { name: "Codex sections" })).getByRole("button", { name: /Search/ });
    // A second way in is only honest if it says it is the same thing.
    expect(row).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
    await user.click(row);
    expect(await palette()).toBeInTheDocument();
  });
});

describe("The scope decision (D20) — Codex-only, deliberately", () => {
  /**
   * The lock. `CommandPalette` is mounted by `CodexShell` and the player shell and by nothing else, so
   * the key listener leaves with the section. If someone lifts the listener to `main.tsx` to make it
   * global, this fails — which is the intent: making it global is a decision, not a refactor.
   */
  it("⌘K does nothing when the Codex is not on screen", async () => {
    /**
     * Rendered against a bare tree rather than against `EncounterPanel`, and that is the stronger
     * shape, not a shortcut around a hard mount. The failure mode being guarded is a listener attached
     * at MODULE scope or in `main.tsx` — either of which fires regardless of what is rendered, so a
     * tree with no Codex in it is exactly the discriminating case. Mounting the encounter would add a
     * whole game state to the setup and prove the same one bit.
     */
    const user = userEvent.setup();
    render(<ToastProvider><div>Some other tab</div></ToastProvider>);
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
    // A palette left open over the destination is the same bug as a drawer left open over it.
    expect(screen.queryByRole("dialog", { name: "Codex command palette" })).not.toBeInTheDocument();
  });

  it("offers a GO TO verb for every sidebar destination — one list, never two", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());

    // Built from GM_SIDEBAR itself, so a new section is offered here the moment it is added. The old
    // palette knew five modes while the app had twelve surfaces.
    for (const label of ["Home", "Pages", "Atlas", "Graph", "Sessions", "Quests", "Journal", "Calendar", "Downtime", "Reveal audit", "Backup", "Settings"]) {
      expect(box.getByText(`Go to ${label}`)).toBeInTheDocument();
    }
    // "Preview as player" is an ACTION, not an address, so it is not a goto verb.
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
    expect(await box.findByText(/New page “Vallaki”/)).toBeInTheDocument();

    // A page always matches its own title, so offering to create it again is noise.
    search.mockResolvedValue({ hits: [HIT], truncated: false });
    await user.clear(box.getByLabelText("Search the Codex"));
    await user.type(box.getByLabelText("Search the Codex"), "Strahd von Zarovich");
    await waitFor(() => expect(box.queryByText(/New page “Strahd von Zarovich”/)).not.toBeInTheDocument());
  });

  it("says when the result list is CLIPPED rather than letting it look complete", async () => {
    search.mockResolvedValue({ hits: [HIT], truncated: true });
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());
    await user.type(box.getByLabelText("Search the Codex"), "a");
    // D19: the Codex is unpaginated by design at LAN scale, which is honest only while a caller can
    // tell a complete list from a clipped one.
    expect(await box.findByText(/Showing the first/)).toBeInTheDocument();
  });

  it("keyboard-drives: arrow down then Enter runs the highlighted action", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    await (await palette()).querySelector("input")!.focus();

    // The first action with an empty query is "New page…", the second "New session"; one press down and
    // Enter must run the second, not the first.
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(createSessionCall).toHaveBeenCalled());
    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s-new"));
  });

  /**
   * D7 — **the create verbs create.** They used to run `onNavigate(pathForSection("sessions"))`: the
   * identical target of the "Go to Sessions" row six lines below, so the palette answered "new session"
   * with a list and the GM still had to find the rail's "+ New". Two rows of the empty-query list were
   * exact duplicates of two others, and both were labelled as creates.
   *
   * Asserted as **the write, then the address of the new record** — landing on the list would satisfy a
   * weaker assertion while leaving the bug exactly as it was.
   */
  it("New session creates a session and opens it — it does not just go to the list", async () => {
    const user = userEvent.setup();
    renderGm();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");

    await user.click(within(await palette()).getByRole("button", { name: "New session" }));

    await waitFor(() => expect(createSessionCall).toHaveBeenCalledTimes(1));
    // The same create the rail runs (`creates.ts`): the next number suggested, planned, and an
    // idempotency key so a double tap on a phone does not leave two sessions behind.
    expect(createSessionCall.mock.calls[0][1]).toMatchObject({ sessionNumber: 1, status: "planned" });
    expect(createSessionCall.mock.calls[0][1].commandId).toEqual(expect.any(String));
    await waitFor(() => expect(window.location.pathname).toBe("/codex/sessions/s-new"));
    // And the palette got out of the way, as it does for every other action.
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

  /**
   * The two rows that are NOT creates must not pretend to be. A journal entry and a downtime record are
   * both composed in a form, so their honest door is the surface that holds the form — "Log …", not
   * "New …" — and they are the only two verbs here that navigate.
   */
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

describe("The player's palette (invariant §1)", () => {
  const renderPlayer = () => (goTo("/codex"), render)(<PlayerCodex token="player" />);

  it("searches through the PLAYER endpoint and never the GM's", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    await user.keyboard("{Control>}k{/Control}");
    await user.type(within(await palette()).getByLabelText("Search the Codex"), "strahd");

    await waitFor(() => expect(playerSearch).toHaveBeenCalledWith("player", "strahd"));
    // Not "the results were filtered" — the GM's search is never CALLED, which is the only version of
    // this that survives a projection regression.
    expect(search).not.toHaveBeenCalled();
  });

  it("offers no create verbs — a player writes nothing", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    await user.keyboard("{Control>}k{/Control}");
    const box = within(await palette());

    for (const verb of [/New page/, /New session/, /New quest/, /Log a journal entry/, /Log downtime/]) {
      expect(box.queryByText(verb)).not.toBeInTheDocument();
    }
  });

  it("offers no GM-only destination — the palette cannot route around the sidebar", async () => {
    const user = userEvent.setup();
    renderPlayer();
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    const box = within(await palette().catch(async () => { await user.keyboard("{Control>}k{/Control}"); return palette(); }));

    // The verbs are built from PLAYER_SIDEBAR, so this is the same list the nav shows. A palette that
    // knew a route the sidebar hides would be a second, quieter way to reach it.
    for (const label of ["Reveal audit", "Backup", "Settings", "Preview as player"]) {
      expect(box.queryByText(`Go to ${label}`)).not.toBeInTheDocument();
    }
    expect(box.getByText("Go to Journal")).toBeInTheDocument();
  });
});
