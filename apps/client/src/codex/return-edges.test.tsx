import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// The atlas surface fetches an authorized image and does pointer geometry — neither is what CI-6 is
// about, and jsdom can honestly render neither (see test/setup.ts). The mock keeps the two props that
// ARE the contract under test: which map is on screen, and which pin is selected on it.
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
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { CodexShell } from "./CodexShell";
import type { CodexCalendar, CodexChronicleRecord, CodexJournalEntry, CodexMap, CodexMarker } from "./api";

/**
 * CI-6: **return edge — a journal entry back to its marker and to its combat replay.**
 *
 * The star topology the assessment named is that every surface points INTO Pages and nothing points
 * back out. A battle the combat bridge logs is the clearest case: the entry records where it happened
 * (`attachMarkerId`) and which encounter produced it (`sourceEncounterId`), and until now the GM could
 * read both facts and act on neither.
 *
 * What these pin, and why each is the interesting half:
 *
 * 1. the marker jump lands on the pin's OWN map with the pin selected — an entry stores only the pin,
 *    never its map, so this is the one edge in the suite whose destination has to be *resolved* before
 *    it can be prepared (R1). Two maps, target second, so a jump that skips the resolution fails loudly;
 * 2. a pin that no longer exists says so (R4) rather than dumping the GM on an arbitrary map;
 * 3. the replay edge runs the SAME `onOpenReplay` the page timeline already takes — one replay path;
 * 4. an entry with neither fact offers neither button, so the footer states what is actually there.
 *
 * The fixtures are typed as the real API rows on purpose: a fixture free to invent fields would let a
 * test pass against a shape the server never produces.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const ENTRY = (over: Partial<CodexJournalEntry> = {}): CodexJournalEntry => ({
  id: "j1", playerText: "A battle was fought here.", gmText: null, revealedToPlayers: false, kind: "note",
  attachMarkerId: null, attachPageId: null, sourceEncounterId: null, payload: null,
  sessionId: null, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

/** CT-11: the Journal reads the CHRONICLE, so its rows arrive in the unified record shape, not as raw entries. */
const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry", id: "j1", title: null, text: "A battle was fought here.", gmText: null, revealedToPlayers: false,
  sessionId: null, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  tags: [], attachPageId: null, attachMarkerId: null, sourceEncounterId: null, payload: null, fired: false, proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

/** The atlas defaults to `maps[0]`, so the pin's map is deliberately SECOND: a jump that never resolves
    the marker's map lands on Castle Ravenloft and every assertion below fails. */
const MAP_OTHER: CodexMap = { id: "m0", assetId: "a0", name: "Castle Ravenloft", kind: "battlemap", parentMapId: null, revealedToPlayers: false, sortKey: 0, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" };
const MAP_TARGET: CodexMap = { ...MAP_OTHER, id: "m1", assetId: "a1", name: "Barovia", kind: "regional" };
const MARKER: CodexMarker = { id: "k1", mapId: "m1", x: 0.4, y: 0.6, iconId: "pin", iconColor: "#FF2E9A", label: "Old Svalich Road", revealedToPlayers: false, pageIds: [], subMapId: null, sceneIds: [], actorId: null, isParty: false, tags: [], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z" };

const renderWorkspace = (onOpenReplay?: (archiveId: number) => void) =>
  render(<ToastProvider><CodexShell gmToken="gm" onOpenReplay={onOpenReplay} /></ToastProvider>);

/** Land on the Journal the way a GM does — via the mode bar — and wait for the chronicle to arrive. */
const openJournal = async (user: ReturnType<typeof userEvent.setup>) => {
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  await user.click(screen.getByRole("tab", { name: "Journal" }));
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
};

describe("Journal entry → its marker (CI-6 / R1)", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue([]);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
    search.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    forMarker.mockResolvedValue([]);
    listAssets.mockResolvedValue([]);
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
    listMarkers.mockImplementation(async (_token: string, mapId: string) => (mapId === "m1" ? [MARKER] : []));
  });

  it("opens the Atlas on the pin's own map AND selects the pin — both halves", async () => {
    chronicle.mockResolvedValue([RECORD({ attachMarkerId: "k1" })]);
    const user = userEvent.setup();
    renderWorkspace();
    await openJournal(user);

    await user.click(await screen.findByRole("button", { name: "Open marker" }));

    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    // Half one — the pin's map is open, not the atlas's default first map.
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(within(screen.getByRole("navigation", { name: "Map path" })).getByRole("button", { name: "Barovia" })).toBeInTheDocument();
    // Half two — the pin itself is selected: its inspector is open on the right marker, and the surface
    // has been told which pin to mark.
    expect(await screen.findByRole("complementary", { name: "Marker" })).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveValue("Old Svalich Road");
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("says the pin is gone rather than silently landing on some other map (R4)", async () => {
    // The entry still names a pin the atlas no longer has — deleted since the battle was logged.
    chronicle.mockResolvedValue([RECORD({ attachMarkerId: "vanished" })]);
    const user = userEvent.setup();
    renderWorkspace();
    await openJournal(user);

    await user.click(await screen.findByRole("button", { name: "Open marker" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That pin is no longer on any map in the atlas.");
    expect(await screen.findByTestId("map-surface")).toHaveAttribute("data-selected", "");
  });

  it("offers no marker jump on an entry that names no pin", async () => {
    chronicle.mockResolvedValue([RECORD({ attachMarkerId: null })]);
    const user = userEvent.setup();
    renderWorkspace();
    await openJournal(user);

    expect(await screen.findByText("A battle was fought here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open marker" })).not.toBeInTheDocument();
  });
});

describe("Journal entry → its combat replay (CI-6)", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue([]);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, backlinks: [], relationships: [] });
    search.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    listMaps.mockResolvedValue([]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockResolvedValue([]);
    forMarker.mockResolvedValue([]);
  });

  it("opens the encounter the entry came from, through the same handler the page timeline uses", async () => {
    chronicle.mockResolvedValue([RECORD({ kind: "combat", sourceEncounterId: 7, attachMarkerId: "k1" })]);
    const onOpenReplay = vi.fn();
    const user = userEvent.setup();
    renderWorkspace(onOpenReplay);
    await openJournal(user);

    await user.click(await screen.findByRole("button", { name: "Open replay" }));

    // The archive id off the entry, not a stand-in: a replay opened on the wrong encounter is worse
    // than none at all.
    expect(onOpenReplay).toHaveBeenCalledWith(7);
  });

  it("offers no replay when the entry records no encounter", async () => {
    chronicle.mockResolvedValue([RECORD({ kind: "combat", sourceEncounterId: null })]);
    const user = userEvent.setup();
    renderWorkspace(vi.fn());
    await openJournal(user);

    expect(await screen.findByText("A battle was fought here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open replay" })).not.toBeInTheDocument();
  });
});
