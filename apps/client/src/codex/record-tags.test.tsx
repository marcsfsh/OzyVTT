import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// The atlas surface fetches an authorized image and does pointer geometry — neither is what CI-2 is
// about, and jsdom cannot honestly render either (see test/setup.ts).
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
      updateMarker: (...a: unknown[]) => updateMarker(...a)
    }
  };
});

import { JournalView } from "./JournalView";
import { MarkerInspector } from "./MarkerInspector";
import { AtlasView } from "./AtlasView";
import type { CodexCalendar, CodexChronicleRecord, CodexJournalEntry, CodexMap, CodexMarker } from "./api";

/**
 * CI-2 (client): **tags are no longer a pages-only idea.**
 *
 * The server half (4818887) gave maps, markers and journal entries the same `tags_json` column and the
 * same validator pages use — max 24, each `/^[a-z0-9][a-z0-9-]*$/`, and it THROWS on a non-slug rather
 * than cleaning one up. So the client's job is two things, and these pin both:
 *
 * 1. every one of the three record types can show and edit its tags, and
 * 2. what leaves the client already satisfies the server's slug rule — which is exactly why every editor
 *    keeps `TagInput`'s default `slugify` normalizer. Typing "Session Recap" must reach the API as
 *    "session-recap"; sending the raw words would come back as a generic save failure the GM cannot act on.
 *
 * Out of scope on purpose (a later milestone): clicking a tag still filters Pages and nothing else.
 */
const CALENDAR: CodexCalendar = { yearName: "DR", months: [{ name: "Hammer", days: 30 }], weekdays: [] };

const ENTRY = (over: Partial<CodexJournalEntry> = {}): CodexJournalEntry => ({
  id: "j1", playerText: "The party reached Barovia.", gmText: null, revealedToPlayers: false, kind: "note",
  attachMarkerId: null, attachPageId: null, sourceEncounterId: null, payload: null,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  sortKey: 0, tags: ["dark-gift"], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

/** CT-11: the Journal reads the CHRONICLE, so its rows arrive in the unified record shape, not as raw entries. */
const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry", id: "j1", title: null, text: "The party reached Barovia.", gmText: null, revealedToPlayers: false,
  sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null, inWorldDate: null,
  tags: ["dark-gift"], attachPageId: null, attachMarkerId: null, sourceEncounterId: null, payload: null, fired: false, proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

const MAP = (over: Partial<CodexMap> = {}): CodexMap => ({
  id: "m1", assetId: "a1", name: "Barovia", kind: "regional", parentMapId: null, revealedToPlayers: false,
  sortKey: 0, tags: ["faerun"], createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

const MARKER = (over: Partial<CodexMarker> = {}): CodexMarker => ({
  id: "k1", mapId: "m1", x: 0.5, y: 0.5, iconId: "pin", iconColor: "#FF2E9A", label: "Old Svalich Road",
  revealedToPlayers: false, pageIds: [], subMapId: null, sceneIds: [], actorId: null, isParty: false, tags: ["dungeon"],
  createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z", ...over
});

// ----- Journal entries -----

describe("Journal entry tags (CI-2)", () => {
  const renderJournal = async (records: CodexChronicleRecord[]) => {
    chronicle.mockResolvedValue(records);
    listPages.mockResolvedValue([]);
    getCalendar.mockResolvedValue(CALENDAR);
    render(<JournalView gmToken="gm" onOpenPage={vi.fn()} />);
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

    await user.type(screen.getByLabelText("Player-facing summary"), "They crossed the mists.");
    // Two words with a capital: the server would REJECT "Session Recap" outright.
    await user.type(screen.getByLabelText("Tags"), "Session Recap{Enter}");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    await waitFor(() => expect(createEntry).toHaveBeenCalled());
    expect(createEntry.mock.calls[0][1]).toMatchObject({ tags: ["session-recap"] });
  });

  it("loads an existing entry's tags into the composer on Edit and saves them back", async () => {
    await renderJournal([RECORD({ tags: ["dark-gift"] })]);
    updateEntry.mockResolvedValue(ENTRY());
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Edit" }));
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
        gmToken="gm" marker={marker} maps={[MAP()]} pages={[]} scenes={[]} actors={[]}
        activeSceneId={null} onUpdated={vi.fn()} onDeleted={vi.fn()} onOpenMap={vi.fn()} onOpenPage={vi.fn()}
        onCreatePage={vi.fn()} onRevealPage={vi.fn()} onActivateScene={vi.fn()} onClose={vi.fn()}
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

    await waitFor(() => expect(updateMarker).toHaveBeenCalled());
    expect(updateMarker).toHaveBeenCalledWith("gm", "k1", { tags: ["dungeon", "old-mill"] });
  });
});

// ----- Maps -----

describe("Map tags (CI-2)", () => {
  const openMapSettings = async (map: CodexMap) => {
    listMaps.mockResolvedValue([map]);
    listAssets.mockResolvedValue([]);
    listMarkers.mockResolvedValue([]);
    listPages.mockResolvedValue([]);
    render(<AtlasView gmToken="gm" scenes={[]} activeSceneId={null} onOpenPage={vi.fn()} onActivateScene={vi.fn()} />);
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
