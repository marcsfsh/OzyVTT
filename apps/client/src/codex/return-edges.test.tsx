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
/** The marker-by-id read. */
const markerById = vi.fn();
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
      listConnections: (...a: unknown[]) => listRelationships(...a),
      party: (...a: unknown[]) => listLinks(...a),
      markersForPage: (...a: unknown[]) => markersForPage(...a),
      marker: (...a: unknown[]) => markerById(...a),
      listFolders: (...a: unknown[]) => listFolders(...a),
      getPage: (...a: unknown[]) => getPage(...a),
      search: (...a: unknown[]) => search(...a)
    },
    journalApi: {
      ...actual.journalApi,
      forPage: (...a: unknown[]) => forPage(...a),
      timeline: (...a: unknown[]) => timeline(...a),
      chronicle: (...a: unknown[]) => chronicle(...a),
      forMarker: (...a: unknown[]) => forMarker(...a)
    },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    // Story reads the shell's campaign feed, which reads standing alongside the chronicle.
    standingApi: { ...actual.standingApi, list: async () => [] },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a)
    }
  };
});

import { ToastProvider } from "@vtt/ui";
import { goTo } from "../../test/route";
import { CodexShell } from "./CodexShell";
import type { CodexCalendar, CodexChronicleRecord, CodexMap, CodexMarker } from "@vtt/domain";

/**
 * A journal entry's jumps back to its pin and its combat replay. An entry stores only the pin, so the atlas
 * must resolve the map first (two maps, target second); a vanished pin says so; the replay uses the same
 * `onOpenReplay` as the page timeline; an entry with neither offers neither button.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

/** The Journal reads the chronicle record shape. */
const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "A battle was fought here.",
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
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

/** The atlas defaults to `maps[0]`, so the pin's map is second and a jump that skips resolving it fails. */
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

const renderWorkspace = (onOpenReplay?: (archiveId: number) => void) =>
  (goTo("/codex/pages"), render)(
    <ToastProvider>
      <CodexShell gmToken="gm" onOpenReplay={onOpenReplay} />
    </ToastProvider>
  );

/** Open Story from the nav, wait for the chronicle, and open the entry's row on the spine. */
const openJournal = async (user: ReturnType<typeof userEvent.setup>) => {
  await waitFor(() => expect(listPages).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: "Story" }));
  await waitFor(() => expect(chronicle).toHaveBeenCalled());
  await user.click(await screen.findByRole("button", { name: /A battle was fought here/ }));
};

describe("Chronicle entry → its marker", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    // One read resolves the pin's map.
    markerById.mockImplementation(async (_token: string, id: string) =>
      id === MARKER.id ? MARKER : Promise.reject(new Error("not found"))
    );
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, connections: [] });
    search.mockResolvedValue({ hits: [], truncated: false });
    getCalendar.mockResolvedValue(CALENDAR);
    forMarker.mockResolvedValue([]);
    listAssets.mockResolvedValue([]);
    listMaps.mockResolvedValue([MAP_OTHER, MAP_TARGET]);
    listMarkers.mockImplementation(async (_token: string, mapId: string) => (mapId === "m1" ? [MARKER] : []));
  });

  it("opens the Atlas on the pin's own map AND selects the pin: both halves", async () => {
    chronicle.mockResolvedValue([RECORD({ attachMarkerId: "k1" })]);
    const user = userEvent.setup();
    renderWorkspace();
    await openJournal(user);

    await user.click(await screen.findByRole("button", { name: "Open pin" }));

    expect(screen.getByRole("button", { name: "Atlas" })).toHaveAttribute("aria-current", "page");
    // The pin's map, where the default would be wrong.
    const surface = await screen.findByTestId("map-surface");
    await waitFor(() => expect(surface).toHaveAttribute("data-asset", "a1"));
    expect(within(screen.getByRole("navigation", { name: "Map path" })).getByText("Barovia")).toBeInTheDocument();
    // The pin is selected: its inspector is open.
    expect(await screen.findByRole("region", { name: "Pin: Old Svalich Road" })).toBeInTheDocument();
    expect(surface).toHaveAttribute("data-selected", "k1");
  });

  it("says the pin is gone rather than silently landing on some other map", async () => {
    // The entry names a pin that has since been deleted.
    chronicle.mockResolvedValue([RECORD({ attachMarkerId: "vanished" })]);
    markerById.mockRejectedValue(new Error("The codex request failed (404)."));
    const user = userEvent.setup();
    renderWorkspace();
    await openJournal(user);

    await user.click(await screen.findByRole("button", { name: "Open pin" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That pin is no longer in the atlas.");
    expect(await screen.findByTestId("map-surface")).toHaveAttribute("data-selected", "");
  });

  it("offers no marker jump on an entry that names no pin", async () => {
    chronicle.mockResolvedValue([RECORD({ attachMarkerId: null })]);
    const user = userEvent.setup();
    renderWorkspace();
    await openJournal(user);

    expect(await screen.findByRole("article", { name: /^Entry/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open pin" })).not.toBeInTheDocument();
  });
});

describe("Chronicle entry → its combat replay", () => {
  beforeEach(() => {
    listPages.mockResolvedValue([]);
    listRelationships.mockResolvedValue([]);
    listLinks.mockResolvedValue(null);
    markersForPage.mockResolvedValue([]);
    forPage.mockResolvedValue([]);
    listFolders.mockResolvedValue([]);
    getPage.mockResolvedValue({ page: null, connections: [] });
    search.mockResolvedValue({ hits: [], truncated: false });
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

    // The archive id from the entry itself.
    expect(onOpenReplay).toHaveBeenCalledWith(7);
  });

  it("offers no replay when the entry records no encounter", async () => {
    chronicle.mockResolvedValue([RECORD({ kind: "combat", sourceEncounterId: null })]);
    const user = userEvent.setup();
    renderWorkspace(vi.fn());
    await openJournal(user);

    expect(await screen.findByRole("article", { name: /^Battle/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open replay" })).not.toBeInTheDocument();
  });
});
