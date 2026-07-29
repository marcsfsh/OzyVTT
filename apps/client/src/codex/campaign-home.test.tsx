import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
vi.mock("./MapSurface", () => ({
  MapSurface: (props: { assetId: string; selectedMarkerId: string | null }) =>
    <div data-testid="map-surface" data-asset={props.assetId} data-selected={props.selectedMarkerId ?? ""} />
}));

const listPages = vi.fn();
const listRelationships = vi.fn();
const listLinks = vi.fn();
const markersForPage = vi.fn();
const forPage = vi.fn();
const listFolders = vi.fn();
const getPage = vi.fn();
const search = vi.fn();
const timeline = vi.fn();
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
      markersForPage: (...a: unknown[]) => markersForPage(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a)
    },
    journalApi: { ...actual.journalApi, forPage: (...a: unknown[]) => forPage(...a), timeline: (...a: unknown[]) => timeline(...a), chronicle: (...a: unknown[]) => chronicle(...a), forMarker: (...a: unknown[]) => forMarker(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    },
    playerCodexApi: {
      ...actual.playerCodexApi,
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
import type { CodexCalendar, CodexJournalEntry, CodexMap, CodexPageSummary, PlayerCodexChronicleRecord, PlayerCodexMap, PlayerCodexPageSummary } from "./api";

/**
 * CI-7: **`World` is renamed `Campaign`, and becomes the dashboard.**
 *
 * The plan names the risk exactly: "the rename touches both GM and player mode bars and the command
 * palette's goto targets; miss one and the vocabulary splits". So the first three tests here are the
 * three places the word appears, checked from the OUTSIDE — the label a GM reads, the label a player
 * reads, and the palette action that has to still reach the mode under its new name. Asserting the
 * absence of "World" alongside each is the half that catches a half-done rename.
 *
 * The rest cover the dashboard itself, bounded to data that exists TODAY (entities by type, recent
 * journal activity, atlas presence, the in-world date). CI-7's spec text also names next session, open
 * quests, deadlines, party position and faction standing — those records are Phase 4 (M8–M12) and the
 * M7 plan excludes them, so there is nothing here to test and no placeholder pretending otherwise.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [], currentDate: { year: 1492, month: 0, day: 3 } };

const summary = (id: string, title: string, entityType: CodexPageSummary["entityType"], tags: string[] = []): CodexPageSummary => ({
  id, title, entityType, fields: {}, folder: null, tags, revealedToPlayers: false,
  bannerAssetId: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  rev: 1, createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z"
});
const PAGES = [summary("p1", "Strahd", "character", ["villain"]), summary("p2", "Barovia", "location")];

const ENTRY = (over: Partial<CodexJournalEntry> = {}): CodexJournalEntry => ({
  id: "j1", playerText: "The party crossed the mists.", gmText: null, revealedToPlayers: false, kind: "note",
  attachMarkerId: null, attachPageId: null, sourceEncounterId: null,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

const MAP_OTHER: CodexMap = { id: "m0", assetId: "a0", name: "Castle Ravenloft", kind: "battlemap", parentMapId: null, revealedToPlayers: false, sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" };
const MAP_TARGET: CodexMap = { ...MAP_OTHER, id: "m1", assetId: "a1", name: "Barovia map", kind: "regional", revealedToPlayers: true };

const renderWorkspace = () => render(<ToastProvider><CodexWorkspace gmToken="gm" /></ToastProvider>);
const gmDefaults = () => {
  listPages.mockResolvedValue(PAGES);
  listRelationships.mockResolvedValue([]);
  listLinks.mockResolvedValue([]);
  markersForPage.mockResolvedValue([]);
  forPage.mockResolvedValue([]);
  listFolders.mockResolvedValue([]);
  getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
  search.mockResolvedValue([]);
  timeline.mockResolvedValue([]);
  chronicle.mockResolvedValue([]);
  listMaps.mockResolvedValue([]);
  listAssets.mockResolvedValue([]);
  listMarkers.mockResolvedValue([]);
  forMarker.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
};

const PLAYER_PAGES: PlayerCodexPageSummary[] = [
  { id: "p1", title: "Strahd", entityType: "character", folder: null, tags: ["villain"], bannerAssetId: null, updatedAt: "2026-07-28T00:00:00.000Z" }
];
const PLAYER_MAPS: PlayerCodexMap[] = [{ id: "m1", assetId: "a1", name: "Barovia map", kind: "regional", parentMapId: null, tags: [] }];
// CT-11: the player Journal reads the CHRONICLE, so a player's rows arrive in the unified record shape.
const PLAYER_ENTRY: PlayerCodexChronicleRecord = { kind: "entry", id: "j1", title: null, text: "The party crossed the mists.", sessionNumber: 3, realDate: null, inWorldLabel: null, tags: [], createdAt: "2026-07-20T00:00:00.000Z" };
const PLAYER_OLDER: PlayerCodexChronicleRecord = { ...PLAYER_ENTRY, id: "j0", text: "They left Daggerford.", sessionNumber: 1, createdAt: "2026-07-01T00:00:00.000Z" };
/** A revealed dated `event` page on the same chronicle — the record kind CT-11 added to this feed. */
const PLAYER_EVENT: PlayerCodexChronicleRecord = { kind: "event", id: "p9", title: "The Sundering", text: "The sky tore open.", sessionNumber: null, realDate: null, inWorldLabel: "Hammer 1, 1492 DR", tags: [], createdAt: "2026-07-10T00:00:00.000Z" };
const playerDefaults = () => {
  playerListPages.mockResolvedValue(PLAYER_PAGES);
  playerListMaps.mockResolvedValue(PLAYER_MAPS);
  playerListMarkers.mockResolvedValue([]);
  // Oldest first, as the server's revealed timeline arrives.
  playerChronicle.mockResolvedValue([PLAYER_OLDER, PLAYER_EVENT, PLAYER_ENTRY]);
  playerListRelationships.mockResolvedValue([]);
  playerListLinks.mockResolvedValue([]);
  getCalendar.mockResolvedValue(CALENDAR);
};

describe("The mode is called Campaign — everywhere (CI-7)", () => {
  it("on the GM mode bar, and 'World' is gone from it", async () => {
    gmDefaults();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    expect(screen.getByRole("tab", { name: "Campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "World" })).not.toBeInTheDocument();
  });

  it("on the PLAYER mode bar too — the split the plan warned about is between these two", async () => {
    playerDefaults();
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    expect(screen.getByRole("tab", { name: "Campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "World" })).not.toBeInTheDocument();
    // And it is where a player LANDS (CI-7: "both GM and players land here").
    expect(screen.getByRole("tab", { name: "Campaign" })).toHaveAttribute("aria-selected", "true");
  });

  it("as the command palette's goto target — which must still reach the mode, not just be relabelled", async () => {
    gmDefaults();
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Search" }));
    const palette = within(screen.getByRole("dialog", { name: "Codex command palette" }));
    expect(palette.queryByText("Go to World")).not.toBeInTheDocument();
    await user.click(palette.getByText("Go to Campaign"));

    // The target is the mode, not the label: a renamed action wired to a dead id would leave Pages open.
    expect(screen.getByRole("tab", { name: "Campaign" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("navigation", { name: "Recently updated pages" })).toBeInTheDocument();
  });
});

describe("The Campaign dashboard shows what exists today (CI-7)", () => {
  beforeEach(() => {
    gmDefaults();
    // In the SERVER's order — `listTimeline()` is ascending, so the newer entry arrives last. Anything
    // the dashboard claims about recency has to be work it did, not an accident of the feed's order.
    timeline.mockResolvedValue([
      ENTRY({ id: "j1", playerText: "The party crossed the mists.", createdAt: "2026-07-01T00:00:00.000Z" }),
      ENTRY({ id: "j2", playerText: "A battle was fought here.", kind: "combat", sourceEncounterId: 7, createdAt: "2026-07-20T00:00:00.000Z" })
    ]);
    // The Journal reads the chronicle (CT-11), so the same two records must exist there for the
    // dashboard's jump to land on one - the dashboard's own feed is still the journal-entry read.
    chronicle.mockResolvedValue([
      { kind: "entry" as const, id: "j1", title: null, text: "The party crossed the mists.", gmText: null, revealedToPlayers: false, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null, tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" },
      { kind: "combat" as const, id: "j2", title: null, text: "A battle was fought here.", gmText: null, revealedToPlayers: false, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null, tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: 7, createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z" }
    ]);
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
  });

  const openCampaign = async (user: ReturnType<typeof userEvent.setup>) => {
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Campaign" }));
    await waitFor(() => expect(timeline).toHaveBeenCalled());
  };

  it("entities by type, recent journal activity, atlas presence, and the in-world date", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    // Entities by type — the notebook, grouped (the one panel the World home already had).
    expect(await screen.findByText("Character")).toBeInTheDocument();
    // Recent journal activity, newest first — the feed arrives oldest-first, so the order is the
    // dashboard's own work. "Recent" that lists the oldest thing first is not recent.
    const journal = within(await screen.findByRole("navigation", { name: "Recent journal activity" }));
    const rows = journal.getAllByRole("button").map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("A battle was fought here.");
    expect(rows[1]).toContain("The party crossed the mists.");
    // R2: a combat record reads by a TEXT badge, not by colour — remove all colour and it still reads.
    expect(journal.getByText("Battle")).toBeInTheDocument();
    // Atlas presence.
    const atlas = within(await screen.findByRole("navigation", { name: "Maps in the atlas" }));
    expect(atlas.getByText("Barovia map")).toBeInTheDocument();
    expect(atlas.getByText("Castle Ravenloft")).toBeInTheDocument();
    // The campaign's current date, formatted against the campaign's own calendar.
    expect(screen.getByText("Now: Hammer 3, 1492 DR")).toBeInTheDocument();
  });

  it("a journal row jumps to the Journal with THAT entry marked (R1)", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const journal = within(await screen.findByRole("navigation", { name: "Recent journal activity" }));
    await user.click(journal.getByText("The party crossed the mists."));

    expect(screen.getByRole("tab", { name: "Journal" })).toHaveAttribute("aria-selected", "true");
    // Prepared, not merely "the Journal, somewhere in a year of entries".
    await waitFor(() => expect(document.getElementById("codex-entry-j1")).toHaveAttribute("aria-current", "true"));
    expect(document.getElementById("codex-entry-j2")).not.toHaveAttribute("aria-current");
  });

  it("an atlas row opens the Atlas ON that map (R1)", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    const atlas = within(await screen.findByRole("navigation", { name: "Maps in the atlas" }));
    // The SECOND map, so landing on the atlas's default first map is a failure rather than a pass.
    await user.click(atlas.getByText("Barovia map"));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByTestId("map-surface")).toHaveAttribute("data-asset", "a1"));
  });

  it("says a feed failed rather than rendering one section fewer, silently (R4)", async () => {
    timeline.mockRejectedValue(new Error("The codex request failed (500)."));
    const user = userEvent.setup();
    renderWorkspace();
    await waitFor(() => expect(listPages).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Campaign" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The codex request failed (500).");
  });

  it("does not claim the campaign is empty when the notebook is empty but the journal is not", async () => {
    // The old World home keyed its empty state off pages alone; a campaign with a running journal and a
    // charted atlas is not empty, and being told to "create your first page" over it is a lie.
    listPages.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWorkspace();
    await openCampaign(user);

    expect(await screen.findByRole("navigation", { name: "Recent journal activity" })).toBeInTheDocument();
    expect(screen.queryByText(/No entries yet/i)).not.toBeInTheDocument();
  });
});

describe("The player's Campaign dashboard is the server's projection (CI-7, viewer safety)", () => {
  beforeEach(playerDefaults);

  it("renders the entries and maps the SERVER sent, with no reveal state a player was never given", async () => {
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    const journal = within(await screen.findByRole("navigation", { name: "Recent journal activity" }));
    expect(journal.getByText("The party crossed the mists.")).toBeInTheDocument();
    // Same notion of "recent" as the GM's dashboard, over the revealed set the server sent.
    expect((journal.getAllByRole("button")[0].textContent ?? "")).toContain("The party crossed the mists.");
    expect(within(await screen.findByRole("navigation", { name: "Maps in the atlas" })).getByText("Barovia map")).toBeInTheDocument();
    // A player's map row carries no `revealedToPlayers` at all — the projection does not send one — so
    // the dashboard must show neither the "Shown" nor the "GM only" marker the GM's rows carry.
    expect(screen.queryByText("GM only")).not.toBeInTheDocument();
    expect(screen.queryByText("Shown")).not.toBeInTheDocument();
    expect(screen.queryByText("revealed to players")).not.toBeInTheDocument();
  });

  it("a player's journal row jumps to the revealed timeline with that entry marked (R1)", async () => {
    const user = userEvent.setup();
    render(<PlayerCodex token="player" />);
    await waitFor(() => expect(playerListPages).toHaveBeenCalled());

    await user.click(within(await screen.findByRole("navigation", { name: "Recent journal activity" })).getByText("The party crossed the mists."));

    expect(screen.getByRole("tab", { name: "Journal" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(document.getElementById("codex-player-entry-j1")).toHaveAttribute("aria-current", "true"));
  });
});
