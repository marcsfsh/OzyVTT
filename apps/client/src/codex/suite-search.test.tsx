import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// The atlas surface fetches an authorized image and does pointer geometry — neither is what CI-1 is
// about, and jsdom can honestly render neither (see test/setup.ts). The mock keeps the two props that
// ARE the contract under test: which map is on screen, and which pin is selected on it.
vi.mock("./MapSurface", () => ({
  MapSurface: (props: { assetId: string; selectedMarkerId: string | null }) =>
    <div data-testid="map-surface" data-asset={props.assetId} data-selected={props.selectedMarkerId ?? ""} />
}));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const timeline = vi.fn();
const forMarker = vi.fn();
const getCalendar = vi.fn();
const playerSearch = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerListMarkers = vi.fn();
const playerTimeline = vi.fn();
const playerListRelationships = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listRelationships: (...a: unknown[]) => listRelationships(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a)
    },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    },
    journalApi: { ...actual.journalApi, timeline: (...a: unknown[]) => timeline(...a), forMarker: (...a: unknown[]) => forMarker(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    playerCodexApi: {
      ...actual.playerCodexApi,
      search: (...a: unknown[]) => playerSearch(...a),
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a),
      timeline: (...a: unknown[]) => playerTimeline(...a),
      listRelationships: (...a: unknown[]) => playerListRelationships(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { CodexWorkspace } from "./CodexWorkspace";
import { PlayerCodex } from "./PlayerCodex";
import type { CodexCalendar, CodexJournalEntry, CodexMap, CodexMarker, CodexSearchHit, PlayerCodexMap, PlayerCodexMarker } from "./api";

/**
 * CI-1 (client): **suite-wide search — one box, one result list, every record kind.**
 *
 * The server half already returns `hits` over pages, journal entries, maps and markers, filtered per role.
 * These pin the client's side of that contract, which was previously pages-only in three separate places:
 *
 * 1. all four kinds reach the eye (R8) and each states its kind in TEXT, not colour alone (R2);
 * 2. every hit opens a *prepared* destination (R1) — and for a marker that means the map AND the pin,
 *    which is the one case that needs two fields off the hit and is therefore the one worth pinning hardest;
 * 3. a failed search says so (R4) instead of the old lie, "No notes match.";
 * 4. the rail and the palette are the same search — the milestone's A-6 bar names both;
 * 5. the player surface renders whatever kinds the SERVER hands it, rather than assuming pages.
 *
 * The fixtures below are typed as the real `CodexSearchHit`, deliberately: a fixture free to invent
 * fields would let a test pass against a shape the API never produces.
 */
const HIT_PAGE: CodexSearchHit = { kind: "page", id: "p1", title: "Strahd von Zarovich", tags: ["villain"], entityType: "character", mapId: null };
const HIT_JOURNAL: CodexSearchHit = { kind: "journal", id: "j1", title: "The party crossed the mists.", tags: [], entityType: null, mapId: null };
const HIT_MAP: CodexSearchHit = { kind: "map", id: "m1", title: "Barovia", tags: ["gothic"], entityType: null, mapId: null };
const HIT_MARKER: CodexSearchHit = { kind: "marker", id: "k1", title: "Old Svalich Road", tags: ["road"], entityType: null, mapId: "m1" };
const HITS: readonly CodexSearchHit[] = [HIT_PAGE, HIT_JOURNAL, HIT_MAP, HIT_MARKER];

/** Two maps, and the TARGET is deliberately second: the atlas defaults to `maps[0]`, so a jump that
    forgets to open `hit.mapId` lands on Castle Ravenloft and every marker assertion below fails. */
const MAP_OTHER: CodexMap = { id: "m0", assetId: "a0", name: "Castle Ravenloft", kind: "battlemap", parentMapId: null, revealedToPlayers: false, sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" };
const MAP_TARGET: CodexMap = { ...MAP_OTHER, id: "m1", assetId: "a1", name: "Barovia", kind: "regional" };
const MARKER: CodexMarker = { id: "k1", mapId: "m1", x: 0.4, y: 0.6, iconId: "pin", iconColor: "#FF2E9A", label: "Old Svalich Road", revealedToPlayers: false, pageIds: [], subMapId: null, sceneIds: [], actorId: null, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" };

const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };
const ENTRY = (id: string, playerText: string): CodexJournalEntry => ({
  id, playerText, gmText: null, revealedToPlayers: false, kind: "note", attachMarkerId: null, attachPageId: null,
  sourceEncounterId: null, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});

const renderWorkspace = () => render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);
/** Type into the rail's search box and wait for the result list to settle. */
const searchInRail = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  await user.type(screen.getByLabelText("Search the notebook"), query);
};
const railResults = () => screen.getByRole("navigation", { name: "Campaign notebook" });

describe("Suite-wide search — the rail result list (CI-1 / R8)", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
    search.mockResolvedValue(HITS);
  });

  it("shows all four record kinds in ONE list", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    const results = within(await screen.findByRole("navigation", { name: "Campaign notebook" }));
    expect(await results.findByText("Strahd von Zarovich")).toBeInTheDocument();
    expect(results.getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(results.getByText("Barovia")).toBeInTheDocument();
    expect(results.getByText("Old Svalich Road")).toBeInTheDocument();
  });

  it("states each row's kind in TEXT, so kind never reads by colour alone (R2)", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    const results = within(await screen.findByRole("navigation", { name: "Campaign notebook" }));
    // A page reads as its entity type — the name the rest of the suite already calls it.
    expect(await results.findByText("Character")).toBeInTheDocument();
    expect(results.getByText("Journal")).toBeInTheDocument();
    expect(results.getByText("Map")).toBeInTheDocument();
    expect(results.getByText("Marker")).toBeInTheDocument();
  });

  it("says the search FAILED rather than claiming nothing matched (R4)", async () => {
    search.mockRejectedValue(new Error("The codex request failed (500)."));
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    // The old behaviour: catch → `setSearchHits([])` → an empty-state that asserts a fact it never learned.
    expect(within(railResults()).queryByText(/matches/i)).not.toBeInTheDocument();
  });

  it("still reports a genuinely empty result set (the error state must not swallow it)", async () => {
    search.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    expect(await screen.findByText("Nothing in the codex matches.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Suite-wide search — every jump prepares its destination (CI-1 / R1)", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
    search.mockResolvedValue(HITS);
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockImplementation(async (_token: string, mapId: string) => (mapId === "m1" ? [MARKER] : []));
    forMarker.mockResolvedValue([]);
    timeline.mockResolvedValue([ENTRY("j0", "Nothing to do with this."), ENTRY("j1", "The party crossed the mists.")]);
    getCalendar.mockResolvedValue(CALENDAR);
  });

  it("a MARKER hit opens the Atlas on its map AND selects the pin — both halves", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "svalich");
    await user.click(await screen.findByText("Old Svalich Road"));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    // Half one — the pin's OWN map is open, not the atlas's default first map.
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(within(screen.getByRole("navigation", { name: "Map path" })).getByRole("button", { name: "Barovia" })).toBeInTheDocument();
    // Half two — the pin itself is selected: its inspector is open on the right marker, and the surface
    // has been told which pin to mark.
    expect(await screen.findByRole("complementary", { name: "Marker" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue("Old Svalich Road");
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("a MAP hit opens the Atlas on that map, with no pin selected", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");
    await user.click(await screen.findByText("Barovia"));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(surface).toHaveAttribute("data-selected", "");
    expect(screen.queryByRole("complementary", { name: "Marker" })).not.toBeInTheDocument();
  });

  it("a JOURNAL hit lands on the Journal with that entry marked", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "mists");
    await user.click(await screen.findByText("The party crossed the mists."));

    expect(screen.getByRole("tab", { name: "Journal" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(document.getElementById("codex-entry-j1")).toHaveAttribute("aria-current", "true"));
    expect(document.getElementById("codex-entry-j0")).not.toHaveAttribute("aria-current");
  });

  it("a PAGE hit stays on Pages and opens the page", async () => {
    getPage.mockResolvedValue({
      page: { id: "p1", title: "Strahd von Zarovich", entityType: "character", fields: {}, gmFields: {}, folder: null, tags: [], revealedToPlayers: false, bannerAssetId: null, rev: 1, playerBody: "", gmBody: "", createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" },
      backlinks: [], relationships: []
    });
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "strahd");
    await user.click(await screen.findByText("Strahd von Zarovich"));

    expect(screen.getByRole("tab", { name: "Pages" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(getPage).toHaveBeenCalledWith("gm", "p1"));
  });
});

describe("Suite-wide search — the command palette is the SAME search (CI-1 / A-6)", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
    search.mockResolvedValue(HITS);
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockImplementation(async (_token: string, mapId: string) => (mapId === "m1" ? [MARKER] : []));
    forMarker.mockResolvedValue([]);
  });

  const openPalette = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByLabelText("Command palette"), query);
    return within(screen.getByRole("dialog", { name: "Codex command palette" }));
  };

  it("renders all four kinds, with the same kind labels the rail uses", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const palette = await openPalette(user, "barovia");

    expect(await palette.findByText("Old Svalich Road")).toBeInTheDocument();
    expect(palette.getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(palette.getByText("Barovia")).toBeInTheDocument();
    expect(palette.getByText("Strahd von Zarovich")).toBeInTheDocument();
    expect(palette.getByText("Character")).toBeInTheDocument();
    expect(palette.getByText("Journal")).toBeInTheDocument();
    expect(palette.getByText("Map")).toBeInTheDocument();
    expect(palette.getByText("Marker")).toBeInTheDocument();
  });

  it("opens a marker from the palette with the same prepared destination as the rail", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const palette = await openPalette(user, "svalich");
    await user.click(await palette.findByText("Old Svalich Road"));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("does not answer a failed palette search with 'No matches.' (R4)", async () => {
    search.mockRejectedValue(new Error("The codex is unreachable."));
    const user = userEvent.setup();
    renderWorkspace();
    const palette = await openPalette(user, "barovia");

    expect(await palette.findByRole("alert")).toHaveTextContent("The codex is unreachable.");
    expect(palette.queryByText("No matches.")).not.toBeInTheDocument();
  });
});

describe("Suite-wide search — the player surface (CI-1, viewer safety)", () => {
  const PLAYER_MAP: PlayerCodexMap = { id: "m1", assetId: "a1", name: "Barovia", kind: "regional", parentMapId: null, tags: [] };
  const PLAYER_OTHER: PlayerCodexMap = { id: "m0", assetId: "a0", name: "Castle Ravenloft", kind: "battlemap", parentMapId: null, tags: [] };
  const PLAYER_MARKER: PlayerCodexMarker = { id: "k1", mapId: "m1", x: 0.4, y: 0.6, iconId: "pin", iconColor: "#FF2E9A", label: "Old Svalich Road", pageIds: [], subMapId: null, tags: [] };

  beforeEach(() => {
    playerListPages.mockResolvedValue([]);
    // `m0` first, so a player jump that ignores `hit.mapId` lands on Castle Ravenloft instead.
    playerListMaps.mockResolvedValue([PLAYER_OTHER, PLAYER_MAP]);
    playerTimeline.mockResolvedValue([]);
    playerListRelationships.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([PLAYER_MARKER]);
    // The server has ALREADY dropped everything this player may not see; the client renders what arrives.
    playerSearch.mockResolvedValue([HIT_MAP, HIT_MARKER]);
  });

  const searchAsPlayer = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Lore" }));
    await user.type(screen.getByLabelText("Search the codex"), query);
  };

  it("renders the non-page kinds the server hands it — the client must not assume page-only", async () => {
    const user = userEvent.setup();
    await searchAsPlayer(user, "barovia");

    const results = within(await screen.findByRole("navigation", { name: "Revealed pages" }));
    expect(await results.findByText("Old Svalich Road")).toBeInTheDocument();
    expect(results.getByText("Barovia")).toBeInTheDocument();
    expect(results.getByText("Marker")).toBeInTheDocument();
    expect(results.getByText("Map")).toBeInTheDocument();
  });

  it("a player's marker hit opens the pin's map and marks the pin", async () => {
    const user = userEvent.setup();
    await searchAsPlayer(user, "svalich");
    await user.click(await screen.findByText("Old Svalich Road"));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("tells a player the search failed instead of 'nothing matches' (R4)", async () => {
    playerSearch.mockRejectedValue(new Error("Couldn't reach the table."));
    const user = userEvent.setup();
    await searchAsPlayer(user, "barovia");

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the table.");
    expect(screen.queryByText("Nothing you know matches that.")).not.toBeInTheDocument();
  });
});
