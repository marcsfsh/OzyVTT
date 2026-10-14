import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// jsdom can't render the real surface, and it isn't what this file tests.
vi.mock("./MapSurface", () => ({ MapSurface: () => <div data-testid="map-surface" /> }));

const timeline = vi.fn();
const chronicle = vi.fn();
const createEntry = vi.fn();
const updateEntry = vi.fn();
const listPages = vi.fn();
const getCalendar = vi.fn();
const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const updateMap = vi.fn();
const updateMarker = vi.fn();
const revealMarker = vi.fn();
const forMarker = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a) },
    calendarApi: { ...actual.calendarApi, get: (...a: unknown[]) => getCalendar(...a) },
    journalApi: {
      ...actual.journalApi,
      timeline: (...a: unknown[]) => timeline(...a),
      chronicle: (...a: unknown[]) => chronicle(...a),
      forMarker: (...a: unknown[]) => forMarker(...a),
      create: (...a: unknown[]) => createEntry(...a),
      update: (...a: unknown[]) => updateEntry(...a)
    },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a),
      updateMap: (...a: unknown[]) => updateMap(...a),
      updateMarker: (...a: unknown[]) => updateMarker(...a),
      revealMarker: (...a: unknown[]) => revealMarker(...a)
    }
  };
});

import { JournalView } from "./JournalView";
import { MarkerInspector } from "./MarkerInspector";
import { ToastProvider } from "@vtt/ui";
import { AtlasView } from "./AtlasView";
import type { CodexCalendar, CodexChronicleRecord, CodexJournalEntry, CodexMap, CodexMarker } from "./api";

/**
 * Maps, markers and journal entries show and edit tags, and what leaves the client already satisfies the
 * server's slug rule (it rejects non-slugs), which is why editors keep `TagInput`'s default slugify.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const ENTRY = (over: Partial<CodexJournalEntry> = {}): CodexJournalEntry => ({
  id: "j1",
  playerText: "The party reached Barovia.",
  gmText: null,
  revealedToPlayers: false,
  kind: "note",
  attachMarkerId: null,
  attachPageId: null,
  sourceEncounterId: null,
  payload: null,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  sortKey: 0,
  tags: ["dark-gift"],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

/** The Journal reads the chronicle record shape. */
const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party reached Barovia.",
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  tags: ["dark-gift"],
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

const MAP = (over: Partial<CodexMap> = {}): CodexMap => ({
  id: "m1",
  assetId: "a1",
  name: "Barovia",
  kind: "regional",
  parentMapId: null,
  revealedToPlayers: false,
  sortKey: 0,
  tags: ["faerun"],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

const MARKER = (over: Partial<CodexMarker> = {}): CodexMarker => ({
  id: "k1",
  mapId: "m1",
  x: 0.5,
  y: 0.5,
  iconId: "pin",
  iconColor: "#FF2E9A",
  label: "Old Svalich Road",
  revealedToPlayers: false,
  pageIds: [],
  subMapId: null,
  sceneIds: [],
  actorId: null,
  isParty: false,
  tags: ["dungeon"],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

// ----- Journal entries -----

/** Filing fields live in the Details panel, whose open state persists across mounts. */
const openEntryDetails = async (user: ReturnType<typeof userEvent.setup>) => {
  const details = await screen.findByRole("button", { name: "Details" });
  if (details.getAttribute("aria-expanded") !== "true") await user.click(details);
};

describe("Journal entry tags (CI-2)", () => {
  const renderJournal = async (records: CodexChronicleRecord[]) => {
    chronicle.mockResolvedValue(records);
    listPages.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    render(
      <JournalView gmToken="gm" autosave={{ enabled: true, intervalSeconds: 1 }} pages={[]} onOpenPage={vi.fn()} />
    );
    await waitFor(() => expect(chronicle).toHaveBeenCalled());
  };

  it("shows an entry's stored tags on its card, without opening the editor", async () => {
    await renderJournal([RECORD({ tags: ["dark-gift", "session-3"] })]);
    const tags = await screen.findByRole("list", { name: "Entry tags" });
    expect(tags).toHaveTextContent("dark-gift");
    expect(tags).toHaveTextContent("session-3");
  });

  it("sends a tag typed in the composer with the new entry, slugified to the server's rule", async () => {
    await renderJournal([]);
    createEntry.mockResolvedValue(ENTRY());
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Player-visible notes"), "They crossed the mists.");
    await openEntryDetails(user);
    // The server would reject "Session Recap" as typed.
    await user.type(screen.getByLabelText("Tags"), "Session Recap{Enter}");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    await waitFor(() => expect(createEntry).toHaveBeenCalled());
    expect(createEntry.mock.calls[0][1]).toMatchObject({ tags: ["session-recap"] });
  });

  it("loads an existing entry's tags into the composer on Edit and saves them back", async () => {
    await renderJournal([RECORD({ tags: ["dark-gift"] })]);
    updateEntry.mockResolvedValue(ENTRY());
    const user = userEvent.setup();

    // Scoped to the entry row: the composer's editors also have Edit/Preview controls.
    const row = within(await screen.findByRole("article"));
    await user.click(row.getByRole("button", { name: "Edit" }));
    await openEntryDetails(user);
    expect(await screen.findByRole("list", { name: /chosen/i })).toHaveTextContent("dark-gift");

    await user.type(screen.getByLabelText("Tags"), "Ravenloft{Enter}");
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => expect(updateEntry).toHaveBeenCalled());
    expect(updateEntry.mock.calls[0][2]).toMatchObject({ tags: ["dark-gift", "ravenloft"] });
  });
});

// ----- Markers -----

describe("Marker tags (CI-2)", () => {
  const renderInspector = (marker: CodexMarker) => {
    forMarker.mockResolvedValue([]);
    return render(
      <MarkerInspector
        gmToken="gm"
        marker={marker}
        maps={[MAP()]}
        pages={[]}
        scenes={[]}
        actors={[]}
        activeSceneId={null}
        autosave={{ enabled: true, intervalSeconds: 1 }}
        onUpdated={vi.fn()}
        onDeleted={vi.fn()}
        onOpenMap={vi.fn()}
        onOpenPage={vi.fn()}
        onCreatePage={vi.fn()}
        onRevealPage={vi.fn()}
        onActivateScene={vi.fn()}
        onClose={vi.fn()}
      />
    );
  };

  it("shows the pin's stored tags", () => {
    renderInspector(MARKER({ tags: ["dungeon", "shop"] }));
    const chosen = screen.getByRole("list", { name: /chosen/i });
    expect(chosen).toHaveTextContent("dungeon");
    expect(chosen).toHaveTextContent("shop");
  });

  it("saves a new tag onto the pin, slugified, keeping the ones already there", async () => {
    updateMarker.mockResolvedValue(MARKER());
    renderInspector(MARKER({ tags: ["dungeon"] }));
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Tags"), "Old Mill{Enter}");

    // The pin's typed fields autosave after the interval, label and tags in one write.
    await waitFor(() => expect(updateMarker).toHaveBeenCalled(), { timeout: 4_000 });
    expect(updateMarker).toHaveBeenCalledWith("gm", "k1", { label: "Old Svalich Road", tags: ["dungeon", "old-mill"] });
  });

  /** With autosave off, the typed fields hold a local draft behind Save and the leave guard. */
  describe("with autosave OFF", () => {
    const renderOff = (marker: CodexMarker) => {
      forMarker.mockResolvedValue([]);
      return render(
        <MarkerInspector
          gmToken="gm"
          marker={marker}
          maps={[MAP()]}
          pages={[]}
          scenes={[]}
          actors={[]}
          activeSceneId={null}
          autosave={{ enabled: false, intervalSeconds: 1 }}
          onUpdated={vi.fn()}
          onDeleted={vi.fn()}
          onOpenMap={vi.fn()}
          onOpenPage={vi.fn()}
          onCreatePage={vi.fn()}
          onRevealPage={vi.fn()}
          onActivateScene={vi.fn()}
          onClose={vi.fn()}
        />
      );
    };

    it("holds a typed label as a draft, says it is unsaved, and writes only on Save", async () => {
      updateMarker.mockResolvedValue(MARKER());
      renderOff(MARKER({ tags: [] }));
      const user = userEvent.setup();

      await user.clear(screen.getByLabelText("Label"));
      await user.type(screen.getByLabelText("Label"), "Tser Pool");
      // Nothing sent yet, and the panel doesn't claim "Saved".
      expect(updateMarker).not.toHaveBeenCalled();
      expect(await screen.findByText(/Unsaved changes/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Save pin" }));
      await waitFor(() => expect(updateMarker).toHaveBeenCalledWith("gm", "k1", { label: "Tser Pool", tags: [] }));
    });

    it("offers no Save button while there is nothing to save", () => {
      renderOff(MARKER({ tags: [] }));
      expect(screen.getByRole("button", { name: "Save pin" })).toBeDisabled();
    });

    it("keeps the discrete pickers immediate — choosing is an act, not an edit in progress", async () => {
      // Discrete acts like reveal stay immediate.
      revealMarker.mockResolvedValue(MARKER());
      renderOff(MARKER({ tags: [] }));
      const user = userEvent.setup();
      await user.click(screen.getByRole("switch", { name: "Show this pin to players" }));
      await waitFor(() => expect(revealMarker).toHaveBeenCalled());
    });
  });
});

// ----- Maps -----

describe("Map tags (CI-2)", () => {
  const openMapSettings = async (map: CodexMap) => {
    listMaps.mockResolvedValue([map]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockResolvedValue([]);
    listPages.mockResolvedValue([]);
    render(
      <ToastProvider>
        <AtlasView
          gmToken="gm"
          scenes={[]}
          actors={[]}
          activeSceneId={null}
          onActivateScene={vi.fn()}
          mapId={null}
          pinId={null}
          autosave={{ enabled: true, intervalSeconds: 1 }}
          onQuickCreate={vi.fn()}
          onNavigate={vi.fn()}
          onReplaceQuery={vi.fn()}
        />
      </ToastProvider>
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Map settings" }));
    return user;
  };

  it("shows the map's stored tags in Map settings", async () => {
    await openMapSettings(MAP({ tags: ["faerun", "sword-coast"] }));
    const chosen = await screen.findByRole("list", { name: /chosen/i });
    expect(chosen).toHaveTextContent("faerun");
    expect(chosen).toHaveTextContent("sword-coast");
  });

  it("saves a new tag onto the map, slugified, keeping the ones already there", async () => {
    updateMap.mockResolvedValue(MAP());
    const user = await openMapSettings(MAP({ tags: ["faerun"] }));

    await user.type(await screen.findByLabelText("Tags"), "High Forest{Enter}");

    await waitFor(() => expect(updateMap).toHaveBeenCalled());
    expect(updateMap).toHaveBeenCalledWith("gm", "m1", { tags: ["faerun", "high-forest"] });
  });
});
