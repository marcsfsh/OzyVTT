import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// jsdom can't render the real surface; the mock keeps the contract under test: which map and which pin.
vi.mock("./atlas/AtlasMap", () => ({
  AtlasMap: (props: { assetId: string; selectedPinId: string | null }) => (
    <div data-testid="map-surface" data-asset={props.assetId} data-selected={props.selectedPinId ?? ""} />
  )
}));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listLinks = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const chronicle = vi.fn();
const forMarker = vi.fn();
const getCalendar = vi.fn();
const playerSearch = vi.fn();
const playerListPages = vi.fn();
const playerListMaps = vi.fn();
const playerListMarkers = vi.fn();
const playerChronicle = vi.fn();
const playerListRelationships = vi.fn();
const playerListLinks = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      listConnections: (...a: unknown[]) => listRelationships(...a),
      party: (...a: unknown[]) => listLinks(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a),
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
    journalApi: {
      ...actual.journalApi,
      forPage: (...a: unknown[]) => forPage(...a),
      chronicle: (...a: unknown[]) => chronicle(...a),
      forMarker: (...a: unknown[]) => forMarker(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    playerCodexApi: {
      ...actual.playerCodexApi,
      calendar: (...a: unknown[]) => getCalendar(...a),
      search: (...a: unknown[]) => playerSearch(...a),
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a),
      chronicle: (...a: unknown[]) => playerChronicle(...a),
      listConnections: (...a: unknown[]) => playerListRelationships(...a),
      party: (...a: unknown[]) => playerListLinks(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { navigate } from "../router";
import { CodexShell } from "./CodexShell";
import { PlayerCodex } from "./PlayerCodex";
import type {
  CodexCalendar,
  CodexChronicleRecord,
  CodexMap,
  CodexMarker,
  CodexSearchHit,
  PlayerCodexMap,
  PlayerCodexMarker
} from "@vtt/domain";

/**
 * Suite-wide search on the client: every kind reaches the list and states its kind in text; each hit
 * opens a prepared destination (a marker opens its map and the pin); failures say so; the rail and
 * palette are one search; the player renders whatever kinds the server sends. Fixtures use the real
 * `CodexSearchHit` type.
 */
const HIT_PAGE: CodexSearchHit = {
  kind: "page",
  id: "p1",
  title: "Strahd von Zarovich",
  tags: ["villain"],
  entityType: "character",
  mapId: null
};
const HIT_JOURNAL: CodexSearchHit = {
  kind: "journal",
  id: "j1",
  title: "The party crossed the mists.",
  tags: [],
  entityType: null,
  mapId: null
};
const HIT_MAP: CodexSearchHit = {
  kind: "map",
  id: "m1",
  title: "Barovia",
  tags: ["gothic"],
  entityType: null,
  mapId: null
};
const HIT_MARKER: CodexSearchHit = {
  kind: "marker",
  id: "k1",
  title: "Old Svalich Road",
  tags: ["road"],
  entityType: null,
  mapId: "m1"
};
const HITS: readonly CodexSearchHit[] = [HIT_PAGE, HIT_JOURNAL, HIT_MAP, HIT_MARKER];

/** The target map is second, so a jump ignoring `hit.mapId` lands on the default and fails. */
const MAP_OTHER: CodexMap = {
  id: "m0",
  assetId: "a0",
  name: "Castle Ravenloft",
  kind: "battlemap",
  parentMapId: null,
  revealedToPlayers: false,
  sortKey: 0,
  tags: [],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
};
const MAP_TARGET: CodexMap = { ...MAP_OTHER, id: "m1", assetId: "a1", name: "Barovia", kind: "regional" };
const MARKER: CodexMarker = {
  id: "k1",
  mapId: "m1",
  x: 0.4,
  y: 0.6,
  iconId: "pin",
  iconColor: "#FF2E9A",
  label: "Old Svalich Road",
  revealedToPlayers: false,
  pageIds: [],
  subMapId: null,
  sceneIds: [],
  actorId: null,
  isParty: false,
  tags: [],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
};

const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };
/** The Journal reads the chronicle record shape. */
const RECORD = (id: string, text: string): CodexChronicleRecord => ({
  kind: "entry",
  id,
  title: null,
  text,
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  tags: [],
  attachPageId: null,
  attachMarkerId: null,
  sourceEncounterId: null,
  payload: null,
  fired: false,
  proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z"
});

const renderWorkspace = () =>
  (goTo("/codex/pages"), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" />
    </ToastProvider>
  );
const searchInRail = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  await user.type(screen.getAllByLabelText("Search the Codex")[0], query);
};
const railResults = () => screen.getByRole("navigation", { name: "Campaign pages" });

describe("Suite-wide search: the rail result list", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, connections: [] });
    search.mockResolvedValue({ hits: HITS, truncated: false });
  });

  it("shows all four record kinds in ONE list", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    const results = within(await screen.findByRole("navigation", { name: "Campaign pages" }));
    expect(await results.findByText("Strahd von Zarovich")).toBeInTheDocument();
    expect(results.getByText("The party crossed the mists.")).toBeInTheDocument();
    expect(results.getByText("Barovia")).toBeInTheDocument();
    expect(results.getByText("Old Svalich Road")).toBeInTheDocument();
  });

  it("states each row's kind in TEXT, so kind never reads by colour alone", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    const results = within(await screen.findByRole("navigation", { name: "Campaign pages" }));
    // A page reads as its entity type.
    expect(await results.findByText("Character")).toBeInTheDocument();
    expect(results.getByText("Journal")).toBeInTheDocument();
    expect(results.getByText("Map")).toBeInTheDocument();
    expect(results.getByText("Pin")).toBeInTheDocument();
  });

  it("says the search FAILED rather than claiming nothing matched", async () => {
    search.mockRejectedValue(new Error("The codex request failed (500)."));
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
    // A failed search must not render an empty-results message.
    expect(within(railResults()).queryByText(/matches/i)).not.toBeInTheDocument();
  });

  it("still reports a genuinely empty result set (the error state must not swallow it)", async () => {
    search.mockResolvedValue({ hits: [], truncated: false });
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");

    expect(await screen.findByText("Nothing in the Codex matches.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Suite-wide search: every jump prepares its destination", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, connections: [] });
    search.mockResolvedValue({ hits: HITS, truncated: false });
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockImplementation(async (_token: string, mapId: string) => (mapId === "m1" ? [MARKER] : []));
    forMarker.mockResolvedValue([]);
    chronicle.mockResolvedValue([
      RECORD("j0", "Nothing to do with this."),
      RECORD("j1", "The party crossed the mists.")
    ]);
    getCalendar.mockResolvedValue(CALENDAR);
  });

  it("a MARKER hit opens the Atlas on its map AND selects the pin: both halves", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "svalich");
    await user.click(await screen.findByText("Old Svalich Road"));

    expect(screen.getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-current", "page");
    // The pin's own map, where the default would be wrong.
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(within(screen.getByRole("navigation", { name: "Map path" })).getByText("Barovia")).toBeInTheDocument();
    // The pin is selected: its inspector is open.
    expect(await screen.findByRole("region", { name: "Pin: Old Svalich Road" })).toBeInTheDocument();
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("a MAP hit opens the Atlas on that map, with no pin selected", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "barovia");
    await user.click(await screen.findByText("Barovia"));

    expect(screen.getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-current", "page");
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(surface).toHaveAttribute("data-selected", "");
    expect(screen.queryByRole("region", { name: /^Pin: / })).not.toBeInTheDocument();
  });

  it("a JOURNAL hit lands on the Journal with that entry marked", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "mists");
    await user.click(await screen.findByText("The party crossed the mists."));

    expect(screen.getByRole("button", { name: "Story" })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(document.getElementById("codex-entry-j1")).toHaveAttribute("aria-current", "true"));
    expect(document.getElementById("codex-entry-j0")).not.toHaveAttribute("aria-current");
  });

  it("a PAGE hit stays on Pages and opens the page", async () => {
    getPage.mockResolvedValue({
      page: {
        id: "p1",
        title: "Strahd von Zarovich",
        entityType: "character",
        fields: {},
        gmFields: {},
        folder: null,
        tags: [],
        revealedToPlayers: false,
        bannerAssetId: null,
        rev: 1,
        playerBody: "",
        gmBody: "",
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z"
      },
      connections: []
    });
    const user = userEvent.setup();
    renderWorkspace();
    await searchInRail(user, "strahd");
    await user.click(await screen.findByText("Strahd von Zarovich"));

    expect(window.location.pathname).toBe("/codex/pages/p1");
    await waitFor(() => expect(getPage).toHaveBeenCalledWith("gm", "p1"));
  });
});

describe("Suite-wide search: the command palette is the SAME search", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, connections: [] });
    search.mockResolvedValue({ hits: HITS, truncated: false });
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockImplementation(async (_token: string, mapId: string) => (mapId === "m1" ? [MARKER] : []));
    forMarker.mockResolvedValue([]);
  });

  const openPalette = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Search the Codex/ }));
    // Rail and palette boxes share a name; the palette's is inside the dialog.
    const palette = within(await screen.findByRole("dialog", { name: "Codex command palette" }));
    await user.type(palette.getByLabelText("Search the Codex"), query);
    return palette;
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
    expect(palette.getByText("Pin")).toBeInTheDocument();
  });

  it("opens a marker from the palette with the same prepared destination as the rail", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const palette = await openPalette(user, "svalich");
    await user.click(await palette.findByText("Old Svalich Road"));

    expect(screen.getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-current", "page");
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("does not answer a failed palette search with 'No matches.'", async () => {
    search.mockRejectedValue(new Error("The codex is unreachable."));
    const user = userEvent.setup();
    renderWorkspace();
    const palette = await openPalette(user, "barovia");

    expect(await palette.findByRole("alert")).toHaveTextContent("The codex is unreachable.");
    expect(palette.queryByText("No matches.")).not.toBeInTheDocument();
  });
});

describe("Suite-wide search: the player surface (viewer safety)", () => {
  const PLAYER_MAP: PlayerCodexMap = {
    id: "m1",
    assetId: "a1",
    name: "Barovia",
    kind: "regional",
    parentMapId: null,
    tags: []
  };
  const PLAYER_OTHER: PlayerCodexMap = {
    id: "m0",
    assetId: "a0",
    name: "Castle Ravenloft",
    kind: "battlemap",
    parentMapId: null,
    tags: []
  };
  const PLAYER_MARKER: PlayerCodexMarker = {
    id: "k1",
    mapId: "m1",
    x: 0.4,
    y: 0.6,
    iconId: "pin",
    iconColor: "#FF2E9A",
    label: "Old Svalich Road",
    pageIds: [],
    subMapId: null,
    isParty: false,
    tags: []
  };

  beforeEach(() => {
    playerListPages.mockResolvedValue([]);
    // `m0` first, so ignoring `hit.mapId` lands on the wrong map.
    playerListMaps.mockResolvedValue([PLAYER_OTHER, PLAYER_MAP]);
    playerChronicle.mockResolvedValue([]);
    playerListRelationships.mockResolvedValue([]);
    playerListLinks.mockResolvedValue(null);
    playerListMarkers.mockResolvedValue([PLAYER_MARKER]);
    // Already filtered by the server; the client renders what arrives.
    playerSearch.mockResolvedValue({ hits: [HIT_MAP, HIT_MARKER], truncated: false });
  });

  const searchAsPlayer = async (user: ReturnType<typeof userEvent.setup>, query: string) => {
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    await navigate("/codex/pages");
    await user.type((await screen.findAllByLabelText("Search the Codex"))[0], query);
  };

  it("renders the non-page kinds the server hands it: the client must not assume page-only", async () => {
    const user = userEvent.setup();
    await searchAsPlayer(user, "barovia");

    const results = within(await screen.findByRole("navigation", { name: "Pages" }));
    expect(await results.findByText("Old Svalich Road")).toBeInTheDocument();
    expect(results.getByText("Barovia")).toBeInTheDocument();
    expect(results.getByText("Pin")).toBeInTheDocument();
    expect(results.getByText("Map")).toBeInTheDocument();
  });

  it("a player's marker hit opens the pin's map and marks the pin", async () => {
    const user = userEvent.setup();
    await searchAsPlayer(user, "svalich");
    await user.click(await screen.findByText("Old Svalich Road"));

    expect(screen.getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-current", "page");
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("tells a player the search failed instead of 'nothing matches'", async () => {
    playerSearch.mockRejectedValue(new Error("Couldn't reach the table."));
    const user = userEvent.setup();
    await searchAsPlayer(user, "barovia");

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the table.");
    expect(screen.queryByText("No pages match.")).not.toBeInTheDocument();
  });
});

/**
 * One settled query, one request (debounced in the shared hook, so all three callers are checked).
 * `delay: null` types without pauses, so without the debounce each character would be a call.
 */
describe("Suite-wide search: one settled query, one request", () => {
  const gmMocks = () => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, connections: [] });
    listMaps.mockResolvedValue([]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockResolvedValue([]);
    chronicle.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    search.mockResolvedValue({ hits: HITS, truncated: false });
  };

  it("the rail sends ONE request for a six-character query, not one per keystroke", async () => {
    gmMocks();
    const user = userEvent.setup({ delay: null });
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.type(screen.getAllByLabelText("Search the Codex")[0], "strahd");

    await waitFor(() => expect(search).toHaveBeenCalledWith("gm", "strahd"));
    expect(search).toHaveBeenCalledTimes(1);
    // Named prefixes, so a failure says which partial query was sent.
    for (const prefix of ["s", "st", "str", "stra", "strah"]) expect(search).not.toHaveBeenCalledWith("gm", prefix);
  });

  it("the command palette debounces the same way: it is the same hook", async () => {
    gmMocks();
    const user = userEvent.setup({ delay: null });
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /Search the Codex/ }));
    await user.type(
      within(await screen.findByRole("dialog", { name: "Codex command palette" })).getByLabelText("Search the Codex"),
      "strahd"
    );

    await waitFor(() => expect(search).toHaveBeenCalledWith("gm", "strahd"));
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("the player's Pages rail debounces too", async () => {
    playerListPages.mockResolvedValue([]);
    playerListMaps.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([]);
    playerChronicle.mockResolvedValue([]);
    playerListRelationships.mockResolvedValue([]);
    playerListLinks.mockResolvedValue(null);
    playerSearch.mockResolvedValue({ hits: [HIT_MAP], truncated: false });
    const user = userEvent.setup({ delay: null });
    (goTo("/codex"), render)(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    await navigate("/codex/pages");
    await user.type((await screen.findAllByLabelText("Search the Codex"))[0], "barovia");

    await waitFor(() => expect(playerSearch).toHaveBeenCalledWith("player", "barovia"));
    expect(playerSearch).toHaveBeenCalledTimes(1);
  });

  it("clearing the box resets the list at once and asks the server nothing", async () => {
    gmMocks();
    const user = userEvent.setup({ delay: null });
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    const box = screen.getAllByLabelText("Search the Codex")[0];
    await user.type(box, "strahd");
    expect(await screen.findByText("Strahd von Zarovich")).toBeInTheDocument();

    search.mockClear();
    await user.clear(box);
    // Cleared at once, before the debounce runs.
    expect(screen.queryByText("Strahd von Zarovich")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No pages yet.")).toBeInTheDocument());
    expect(search).not.toHaveBeenCalled();
  });
});
