import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// The atlas surface fetches an authorized image and does pointer geometry — neither is what these edges
// are about, and jsdom can honestly render neither (see test/setup.ts). The mock keeps the two props
// that ARE the contract under test: which map is on screen, and which pin is selected on it.
vi.mock("./MapSurface", () => ({
  MapSurface: (props: { assetId: string; selectedMarkerId: string | null }) =>
    <div data-testid="map-surface" data-asset={props.assetId} data-selected={props.selectedMarkerId ?? ""} />
}));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listLinks = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();
const chronicle = vi.fn();
const forMarker = vi.fn();
const getCalendar = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
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
      listRelationships: (...a: unknown[]) => listRelationships(...a),
      listLinks: (...a: unknown[]) => listLinks(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a)
    },
    journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a), chronicle: (...a: unknown[]) => chronicle(...a), forMarker: (...a: unknown[]) => forMarker(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
      // M11: the player's own calendar read. It was `calendarApi.get` until O-1 split the two clocks;
      // it is stubbed with the SAME mock, so what this file asserts about the date is unchanged.
      calendar: (...a: unknown[]) => getCalendar(...a),
      listPages: (...a: unknown[]) => playerListPages(...a),
      listMaps: (...a: unknown[]) => playerListMaps(...a),
      listMarkers: (...a: unknown[]) => playerListMarkers(...a),
      chronicle: (...a: unknown[]) => playerChronicle(...a),
      listRelationships: (...a: unknown[]) => playerListRelationships(...a),
      listLinks: (...a: unknown[]) => playerListLinks(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { CodexWorkspace } from "./CodexWorkspace";
import { PlayerCodex } from "./PlayerCodex";
import type { CodexCalendar, CodexChronicleRecord, CodexJournalEntry, CodexMap, CodexMarker, CodexPage, CodexPageSummary, PlayerCodexPageSummary } from "./api";

/**
 * **M7's three page return edges (CI-3, CI-4, CI-5) and the Graph telling the truth (CI-8).**
 *
 * The assessment's "star topology" is that every surface points INTO Pages and nothing points back out.
 * CI-6 (`return-edges.test.tsx`) fixed that for a journal entry; this file is the page's own three:
 * its journal entries, its atlas pins, and its node in the Graph.
 *
 * Every one of them is asserted the same way, and the assertion is deliberately in two halves — the MODE
 * plus the SELECTION — because R1 is not "you end up in the right tab", it is "the destination is
 * prepared". A jump that lands on the Journal without focusing the entry, on the Atlas without selecting
 * the pin, or on the Graph without finding the node is the failure these tests exist to catch, and each
 * fixture is arranged so that a jump which drops the selection lands somewhere visibly wrong rather than
 * somewhere plausible.
 *
 * CI-8 is two claims, tested separately: wiki-link edges are drawn and are distinguishable from typed
 * relationships by something OTHER than colour, and no node the graph draws is outside the fitted frame.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const summary = (id: string, title: string, entityType: CodexPageSummary["entityType"] = "location"): CodexPageSummary => ({
  id, title, entityType, fields: {}, folder: null, tags: [], revealedToPlayers: false,
  bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});
const full = (row: CodexPageSummary): CodexPage => ({ ...row, playerBody: "", gmBody: "", gmFields: {} });

const PAGE = summary("p1", "Barovia");
const OTHER = summary("p2", "Strahd", "character");

const ENTRY = (over: Partial<CodexJournalEntry> = {}): CodexJournalEntry => ({
  id: "j1", playerText: "The mists closed behind them.", gmText: null, revealedToPlayers: false, kind: "note",
  attachMarkerId: null, attachPageId: "p1", sourceEncounterId: null, payload: null,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

/** CT-11: the Journal reads the CHRONICLE, so its rows arrive in the unified record shape. */
const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry", id: "j1", title: null, text: "The mists closed behind them.", gmText: null, revealedToPlayers: false,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  tags: [], attachPageId: "p1", attachMarkerId: null, sourceEncounterId: null, payload: null, fired: false,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

/** The atlas defaults to `maps[0]`, so the pin's map is deliberately SECOND: a jump that drops the map
    half lands on Castle Ravenloft and every assertion below fails. */
const MAP_OTHER: CodexMap = { id: "m0", assetId: "a0", name: "Castle Ravenloft", kind: "battlemap", parentMapId: null, revealedToPlayers: false, sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" };
const MAP_TARGET: CodexMap = { ...MAP_OTHER, id: "m1", assetId: "a1", name: "Barovia valley", kind: "regional" };
const MARKER: CodexMarker = { id: "k1", mapId: "m1", x: 0.4, y: 0.6, iconId: "pin", iconColor: "#FF2E9A", label: "Old Svalich Road", revealedToPlayers: false, pageIds: ["p1"], subMapId: null, sceneIds: [], actorId: null, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" };

const renderWorkspace = () => render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);

const gmDefaults = () => {
  listPages.mockResolvedValue([PAGE, OTHER]);
  listRelationships.mockResolvedValue([]);
  listLinks.mockResolvedValue([]);
  listFolders.mockResolvedValue([]);
  getPage.mockResolvedValue({ page: full(PAGE), backlinks: [], relationships: [] });
  search.mockResolvedValue([]);
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
  chronicle.mockResolvedValue([]);
  forMarker.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
  listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
  listAssets.mockResolvedValue([]);
  listMarkers.mockImplementation(async (_token: string, mapId: string) => (mapId === "m1" ? [MARKER] : []));
};

/** Open the page the way a GM does — from the notebook rail — and hand back its Connections area. */
const openPage = async (user: ReturnType<typeof userEvent.setup>) => {
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  await user.click(await screen.findByRole("treeitem", { name: "Barovia" }));
  return within(await screen.findByRole("region", { name: "Connections" }));
};

describe("Page → its connections, in one place (CI-3 / CI-4 / CI-5)", () => {
  beforeEach(gmDefaults);

  it("groups all three edges under one Connections heading rather than scattering them", async () => {
    markersForPage.mockResolvedValue([MARKER]);
    forPage.mockResolvedValue([ENTRY()]);
    const user = userEvent.setup();
    renderWorkspace();
    const connections = await openPage(user);

    // One area, and every edge inside it — the grouping is the requirement, not three loose buttons.
    for (const heading of ["Linked from", "On the atlas", "In the journal"]) {
      expect(connections.getByText(heading)).toBeInTheDocument();
    }
    expect(await connections.findByRole("button", { name: /Old Svalich Road/ })).toBeInTheDocument();
    expect(await connections.findByRole("button", { name: /The mists closed behind them/ })).toBeInTheDocument();
    expect(connections.getByRole("button", { name: "Show in graph" })).toBeInTheDocument();
  });

  it("CI-3: a journal row lands on the Journal WITH that entry focused", async () => {
    // Two entries, and the page's is the SECOND: a jump that reaches the Journal but focuses whatever
    // is first would pass a mode-only assertion and fail this one.
    forPage.mockResolvedValue([ENTRY({ id: "j9", playerText: "The mists closed behind them." })]);
    chronicle.mockResolvedValue([RECORD({ id: "j0", text: "They left Daggerford.", attachPageId: null }), RECORD({ id: "j9" })]);
    const user = userEvent.setup();
    renderWorkspace();
    const connections = await openPage(user);

    await user.click(await connections.findByRole("button", { name: /The mists closed behind them/ }));

    expect(screen.getByRole("tab", { name: "Journal" })).toHaveAttribute("aria-selected", "true");
    // The selection half: the Journal marks the entry it was sent, not merely "the Journal, somewhere".
    await waitFor(() => expect(document.getElementById("codex-entry-j9")).toHaveAttribute("aria-current", "true"));
    expect(document.getElementById("codex-entry-j0")).not.toHaveAttribute("aria-current");
  });

  it("CI-4: a pin row lands on the Atlas WITH the pin's own map open and the pin selected", async () => {
    markersForPage.mockResolvedValue([MARKER]);
    const user = userEvent.setup();
    renderWorkspace();
    const connections = await openPage(user);

    await user.click(await connections.findByRole("button", { name: /Old Svalich Road/ }));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    const surface = await screen.findByTestId("map-surface");
    // Half one — the pin's map, not the atlas's default first map.
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    // Half two — the pin itself, with its inspector open on the right marker.
    await waitFor(() => expect(surface).toHaveAttribute("data-selected", "k1"));
    expect(await screen.findByRole("complementary", { name: "Marker" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue("Old Svalich Road");
  });

  it("CI-5: Show in graph lands on the Graph WITH this entity's node focused", async () => {
    listLinks.mockResolvedValue([{ fromPageId: "p1", toPageId: "p2" }]);
    const user = userEvent.setup();
    renderWorkspace();
    const connections = await openPage(user);

    await user.click(connections.getByRole("button", { name: "Show in graph" }));

    expect(screen.getByRole("tab", { name: "Graph" })).toHaveAttribute("aria-selected", "true");
    // The selection half: THIS entity's node carries the landing, and the other one does not — a jump
    // that merely switched mode would leave both unmarked.
    const focused = await screen.findByRole("button", { name: "Location: Barovia" });
    await waitFor(() => expect(focused).toHaveAttribute("aria-current", "true"));
    expect(screen.getByRole("button", { name: "Character: Strahd" })).not.toHaveAttribute("aria-current");
  });

  it("R4: says the pin lookup failed rather than reporting the page has no pins", async () => {
    markersForPage.mockRejectedValue(new Error("The atlas is unreachable."));
    const user = userEvent.setup();
    renderWorkspace();
    const connections = await openPage(user);

    expect(await connections.findByRole("alert")).toHaveTextContent("The atlas is unreachable.");
    expect(connections.queryByText("No map pins link to this page yet.")).not.toBeInTheDocument();
  });
});

/** The `<g transform="translate(x y)">` each node is drawn at, as numbers. */
function nodePoint(node: Element): { x: number; y: number } {
  const transform = node.getAttribute("transform") ?? "";
  const match = /translate\(\s*(\S+)\s+(\S+?)\s*\)/.exec(transform);
  const x = Number(match?.[1]), y = Number(match?.[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`node has no usable translate transform: "${transform}"`);
  return { x, y };
}
/** The viewBox `RelationshipGraph` draws into — the frame every node has to be inside. */
const VIEWBOX = { halfW: 520, halfH: 390 };

const openGraph = async (user: ReturnType<typeof userEvent.setup>) => {
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  await user.click(screen.getByRole("tab", { name: "Graph" }));
};

describe("The Graph tells the truth (CI-8)", () => {
  beforeEach(gmDefaults);

  it("draws wiki-link edges beside typed relationships", async () => {
    listRelationships.mockResolvedValue([{ id: "r1", fromPageId: "p1", toPageId: "p2", type: "ally", createdAt: "2026-07-28T00:00:00.000Z" }]);
    listLinks.mockResolvedValue([{ fromPageId: "p2", toPageId: "p1" }]);
    const user = userEvent.setup();
    renderWorkspace();
    await openGraph(user);

    // Both kinds are drawn, and the bar counts them separately — a codex wired with [[links]] used to
    // report "0 relationships" over a picture of unconnected dots.
    await waitFor(() => expect(document.querySelectorAll(".codex-graph-edge")).toHaveLength(2));
    expect(screen.getByText(/1 relationship · 1 mention/)).toBeInTheDocument();
  });

  it("R2: a wiki-link is distinguishable from a typed edge WITHOUT colour", async () => {
    listRelationships.mockResolvedValue([{ id: "r1", fromPageId: "p1", toPageId: "p2", type: "ally", createdAt: "2026-07-28T00:00:00.000Z" }]);
    listLinks.mockResolvedValue([{ fromPageId: "p2", toPageId: "p1" }]);
    const user = userEvent.setup();
    renderWorkspace();
    await openGraph(user);

    await waitFor(() => expect(document.querySelectorAll(".codex-graph-edge")).toHaveLength(2));
    const typed = document.querySelector('[data-edgekind="typed"]')!;
    const link = document.querySelector('[data-edgekind="link"]')!;

    // 1. Shape: the typed edge carries an arrowhead, the wiki-link deliberately does not — a mention
    //    claims no direction. This survives greyscale and a colour-blind reader.
    expect(typed.querySelector("line")).toHaveAttribute("marker-end", "url(#codex-graph-arrow)");
    expect(link.querySelector("line")).not.toHaveAttribute("marker-end");
    // 2. Weight/dash: distinct classes, so the dashed lighter stroke is a fact about the markup rather
    //    than about a stylesheet jsdom never loads.
    expect(typed).toHaveClass("is-typed");
    expect(link).toHaveClass("is-link");
    // 3. Words: each edge labels its own kind, and the bar carries a permanent key for when the
    //    per-edge labels are zoomed out of view.
    expect(within(typed as HTMLElement).getByText("ally of")).toBeInTheDocument();
    expect(within(link as HTMLElement).getByText("mentions")).toBeInTheDocument();
    expect(screen.getByText("Relationship")).toBeInTheDocument();
    expect(screen.getByText("Mention")).toBeInTheDocument();
  });

  it("frames every node it draws — an orphan is inside the fitted view, not off in the margins", async () => {
    // Three entities, one relationship. `p3` is connected to nothing, which is exactly the node the old
    // fit excluded: framing the connected web alone put it at (-613, -1041) in a 1040×780 viewBox — on
    // screen in the notebook, off screen in the picture of it, with nothing saying so.
    listPages.mockResolvedValue([PAGE, OTHER, summary("p3", "Vallaki")]);
    listRelationships.mockResolvedValue([{ id: "r1", fromPageId: "p1", toPageId: "p2", type: "ally", createdAt: "2026-07-28T00:00:00.000Z" }]);
    const user = userEvent.setup();
    renderWorkspace();
    await openGraph(user);

    const orphan = await screen.findByRole("button", { name: "Location: Vallaki" });
    const point = nodePoint(orphan);
    expect(Math.abs(point.x)).toBeLessThanOrEqual(VIEWBOX.halfW);
    expect(Math.abs(point.y)).toBeLessThanOrEqual(VIEWBOX.halfH);
    // And not at the cost of the connected web: every node the graph draws is framed, not just this one.
    for (const name of ["Location: Barovia", "Character: Strahd"]) {
      const other = nodePoint(screen.getByRole("button", { name }));
      expect(Math.abs(other.x)).toBeLessThanOrEqual(VIEWBOX.halfW);
      expect(Math.abs(other.y)).toBeLessThanOrEqual(VIEWBOX.halfH);
    }
  });
});

describe("The player Graph reads the PLAYER links feed (CI-8, viewer safety)", () => {
  const PLAYER_PAGES: PlayerCodexPageSummary[] = [
    { id: "p1", title: "Barovia", entityType: "location", folder: null, tags: [], bannerAssetId: null, updatedAt: "2026-07-28T00:00:00.000Z" },
    { id: "p2", title: "Strahd", entityType: "character", folder: null, tags: [], bannerAssetId: null, updatedAt: "2026-07-28T00:00:00.000Z" }
  ];

  beforeEach(() => {
    gmDefaults();
    playerListPages.mockResolvedValue(PLAYER_PAGES);
    playerListMaps.mockResolvedValue([]);
    playerListMarkers.mockResolvedValue([]);
    playerChronicle.mockResolvedValue([]);
    playerListRelationships.mockResolvedValue([]);
    // What the SERVER chose to send this player: one edge. The GM feed below is a different, larger
    // answer to the same question — if the player surface ever read that one, the extra edge appears.
    playerListLinks.mockResolvedValue([{ fromPageId: "p1", toPageId: "p2" }]);
    listLinks.mockResolvedValue([{ fromPageId: "p1", toPageId: "p2" }, { fromPageId: "p2", toPageId: "p1" }]);
  });

  it("draws the player's links, and never asks the GM feed", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><PlayerCodex token="player" /></ToastProvider>);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Graph" }));

    await waitFor(() => expect(screen.getByText(/0 relationships · 1 mention/)).toBeInTheDocument());
    expect(document.querySelectorAll('[data-edgekind="link"]')).toHaveLength(1);
    expect(playerListLinks).toHaveBeenCalledWith("player");
    // The GM feed is never touched from a player session — not fetched-and-filtered, not fetched at all.
    expect(listLinks).not.toHaveBeenCalled();
  });
});
