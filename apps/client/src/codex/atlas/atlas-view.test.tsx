import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

vi.mock("../../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// A 1000 by 800 map, ready at once; jsdom has no screen matrix, so a client point is the map point here.
vi.mock("../../scene/mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 1000, height: 800 }),
  imagePointFromClient: (_svg: unknown, x: number, y: number) => ({ x, y }),
  clampPoint: (point: { x: number; y: number }) => point
}));

const listMaps = vi.fn();
const listAssets = vi.fn();
const listMarkers = vi.fn();
const listPages = vi.fn();
const marker = vi.fn();
const updateMarker = vi.fn();
const setPartyMarker = vi.fn();
const forMarker = vi.fn();
const setParty = vi.fn();
const updateMap = vi.fn();
const revealMap = vi.fn();

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    codexApi: {
      ...actual.codexApi,
      listPages: (...a: unknown[]) => listPages(...a),
      marker: (...a: unknown[]) => marker(...a)
    },
    journalApi: { ...actual.journalApi, forMarker: (...a: unknown[]) => forMarker(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a),
      updateMarker: (...a: unknown[]) => updateMarker(...a),
      updateMap: (...a: unknown[]) => updateMap(...a),
      revealMap: (...a: unknown[]) => revealMap(...a),
      setPartyMarker: (...a: unknown[]) => setPartyMarker(...a)
    }
  };
});
vi.mock("../prep/api", () => ({ partyApi: { set: (...a: unknown[]) => setParty(...a) } }));

import { ToastProvider } from "@vtt/ui";
import type { CodexMap, CodexMarker, CodexPageSummary } from "@vtt/domain";
import { AtlasView } from "./AtlasView";
import { currentHref, navigate, replaceQuery, useRoute } from "../../router";
import { goTo } from "../../../test/route";

const MAP = (id: string, name: string, revealedToPlayers = true, parentMapId: string | null = null): CodexMap => ({
  id,
  assetId: `a-${id}`,
  name,
  kind: "regional",
  parentMapId,
  revealedToPlayers,
  sortKey: 0,
  tags: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  firstShownAt: null
});
const PIN = (id: string, label: string, over: Partial<CodexMarker> = {}): CodexMarker => ({
  id,
  mapId: "m1",
  x: 100,
  y: 200,
  label,
  iconId: "village",
  iconColor: "#FF2E9A",
  tags: [],
  pageIds: [],
  encounterIds: [],
  subMapId: null,
  actorId: null,
  isParty: false,
  revealedToPlayers: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  firstShownAt: null,
  ...over
});
const PAGE = (id: string, title: string, over: Partial<CodexPageSummary> = {}) =>
  ({
    id,
    title,
    entityType: "character",
    folder: null,
    tags: [],
    fields: {},
    revealedToPlayers: true,
    bannerAssetId: null,
    rev: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    playerUpdatedAt: "2026-10-01T00:00:00.000Z",
    inWorldDate: null,
    inWorldLabel: null,
    calendarInstant: null,
    ...over
  }) as unknown as CodexPageSummary;

const MAPS = [
  MAP("m1", "Saltmere"),
  MAP("m2", "Drowned Isles"),
  MAP("m3", "Tunnels", false, "m1"),
  MAP("m4", "Docks", true, "m1")
];
const PINS = [
  PIN("k1", "Harbourmaster's Tower", { pageIds: ["p1"] }),
  PIN("k2", "Tunnel mouth", { revealedToPlayers: false, x: 400, y: 300 })
];
const PAGES = [PAGE("p1", "Ysolde Varn", { fields: { role: "Harbourmaster of Saltmere" } })];

/** The atlas fed its own address back, as the shell does: selecting a pin is a navigation. */
function Harness({ autosave = true }: Readonly<{ autosave?: boolean }>) {
  const [href, setHref] = useState("/codex/atlas/m1");
  const [path, search] = href.split("?");
  const query = new URLSearchParams(search ?? "");
  return (
    <ToastProvider>
      <AtlasView
        gmToken="gm"
        scenes={[]}
        actors={[]}
        activeEncounterId={null}
        onActivateScene={vi.fn()}
        mapId={path.split("/")[3] ?? null}
        pinId={query.get("pin")}
        filter={query.get("q") ?? ""}
        tagFilter={query.get("tag")}
        autosave={{ enabled: autosave, intervalSeconds: 1 }}
        onQuickCreate={vi.fn()}
        onNavigate={setHref}
        onReplaceQuery={(mutate) => {
          const next = new URLSearchParams(search ?? "");
          mutate(next);
          setHref(next.toString() ? `${path}?${next}` : path);
        }}
      />
    </ToastProvider>
  );
}

const svg = () => document.querySelector(".atlas-map-svg") as SVGSVGElement;
/** A tap on a pin drawn on the map. */
function tapPin(id: string) {
  const glyph = document.querySelector(`[data-pin-id="${id}"] circle`)!;
  fireEvent.pointerDown(glyph, { pointerId: 9, pointerType: "mouse", clientX: 1, clientY: 1 });
  fireEvent.pointerUp(svg(), { pointerId: 9, pointerType: "mouse", clientX: 1, clientY: 1 });
}

beforeEach(() => {
  // The layers are kept per device; each test starts with every layer on.
  localStorage.clear();
  listMaps.mockResolvedValue(MAPS);
  listAssets.mockResolvedValue([]);
  listMarkers.mockResolvedValue(PINS);
  listPages.mockResolvedValue(PAGES);
  forMarker.mockResolvedValue([]);
});

describe("The GM's atlas", () => {
  it("lists the map's pins with their links, and says who sees the map", async () => {
    render(<Harness />);
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).getByText("Ysolde Varn")).toBeInTheDocument());
    expect(within(table).getByText("Tunnel mouth")).toBeInTheDocument();
    expect(screen.getByText("Regional map")).toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "Saltmere" })).getAllByText("Everyone")[0]
    ).toBeInTheDocument();
    // One hidden pin here and one hidden map inside.
    expect(screen.getByText(/1 pin and 1 map\s+hidden/)).toBeInTheDocument();
  });

  it("reads a pin first and edits it on Edit pin", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: /Harbourmaster's Tower/ }));

    const view = await screen.findByRole("region", { name: "Pin: Harbourmaster's Tower" });
    expect(within(view).getByText("Ysolde Varn")).toBeInTheDocument();
    expect(within(view).getByText("Harbourmaster of Saltmere")).toBeInTheDocument();
    expect(within(view).queryByLabelText("Label")).not.toBeInTheDocument();

    await user.click(within(view).getByRole("button", { name: "Edit pin" }));
    const editor = await screen.findByRole("region", { name: "Edit pin" });
    expect(within(editor).getByLabelText("Label")).toHaveValue("Harbourmaster's Tower");
    await user.click(within(editor).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("region", { name: "Pin: Harbourmaster's Tower" })).toBeInTheDocument();
  });

  it("sets the party's position with the button and then a tap on the map", async () => {
    const user = userEvent.setup();
    setParty.mockResolvedValue({ marker: PIN("party", "The party", { isParty: true }), created: true });
    render(<Harness />);
    await screen.findByRole("table");
    const reads = listMarkers.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Set party position" }));
    expect(screen.getByRole("status")).toHaveTextContent("where the party is");
    fireEvent.pointerDown(svg(), { pointerId: 1, pointerType: "mouse", clientX: 420, clientY: 310 });
    fireEvent.pointerUp(svg(), { pointerId: 1, pointerType: "mouse", clientX: 420, clientY: 310 });

    await waitFor(() => expect(setParty).toHaveBeenCalledWith("gm", { mapId: "m1", x: 420, y: 310 }));
    // The party pin may have come from another map, so the map's pins are read again.
    await waitFor(() => expect(listMarkers.mock.calls.length).toBeGreaterThan(reads));
    expect(await screen.findByText("The party is on Saltmere.")).toBeInTheDocument();
  });

  it("sets the party's position from a right-click at the spot", async () => {
    const user = userEvent.setup();
    setParty.mockResolvedValue({ marker: PIN("party", "The party", { isParty: true }), created: false });
    render(<Harness />);
    await screen.findByRole("table");
    fireEvent.contextMenu(svg(), { clientX: 250, clientY: 120 });
    await user.click(screen.getByRole("menuitem", { name: "Set party position here" }));
    await waitFor(() => expect(setParty).toHaveBeenCalledWith("gm", { mapId: "m1", x: 250, y: 120 }));
  });

  it("sets the party's position at a pin, from the pin's view", async () => {
    const user = userEvent.setup();
    setParty.mockResolvedValue({ marker: PIN("party", "The party", { isParty: true }), created: false });
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: /Harbourmaster's Tower/ }));
    await user.click(await screen.findByRole("button", { name: "Set party position here" }));
    await waitFor(() => expect(setParty).toHaveBeenCalledWith("gm", { mapId: "m1", x: 100, y: 200 }));
  });

  it("marks a pin as the party's through its own route in the editor, and reads the pins again", async () => {
    const user = userEvent.setup();
    setPartyMarker.mockResolvedValue(PIN("k1", "Harbourmaster's Tower", { isParty: true }));
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: /Harbourmaster's Tower/ }));
    await user.click(await screen.findByRole("button", { name: "Edit pin" }));
    const toggle = await screen.findByLabelText("This pin marks the party");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    const reads = listMarkers.mock.calls.length;
    await user.click(toggle);
    await waitFor(() => expect(setPartyMarker).toHaveBeenCalledWith("gm", "k1", true));
    await waitFor(() => expect(listMarkers.mock.calls.length).toBeGreaterThan(reads));
    expect(updateMarker).not.toHaveBeenCalled();
  });

  it("takes hidden pins off the map with the Hidden pins layer", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole("table");
    await waitFor(() => expect(document.querySelector('[data-pin-id="k2"]')).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "Hidden pins" }));
    expect(document.querySelector('[data-pin-id="k2"]')).toBeNull();
    expect(document.querySelector('[data-pin-id="k1"]')).not.toBeNull();
    // The people layer stands Ysolde at the tower.
    expect(document.querySelector('[data-pin-id="k1"] .atlas-person')).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "People" }));
    expect(document.querySelector('[data-pin-id="k1"] .atlas-person')).toBeNull();
  });

  it("lists the maps inside, marks the hidden ones, and reaches the other top-level maps", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("tab", { name: "Maps inside" }));
    const inside = screen.getByRole("list", { name: "Maps inside this one" });
    const tunnels = within(inside).getByRole("button", { name: /Tunnels/ });
    expect(within(tunnels).getByRole("img", { name: "Hidden" }).querySelector("svg")).toHaveAttribute(
      "fill",
      "currentColor"
    );
    expect(
      within(within(inside).getByRole("button", { name: /Docks/ })).queryByRole("img", { name: "Hidden" })
    ).toBeNull();
    const others = screen.getByRole("list", { name: "Other top-level maps" });
    expect(within(others).getByRole("button", { name: /Drowned Isles/ })).toBeInTheDocument();
  });

  it("keeps a map's settings in Details: its tags, slugified, and who sees it", async () => {
    const user = userEvent.setup();
    listMaps.mockResolvedValue([{ ...MAP("m1", "Saltmere"), tags: ["coast"] }]);
    updateMap.mockResolvedValue({ ...MAP("m1", "Saltmere"), tags: ["coast", "old-town"] });
    revealMap.mockResolvedValue(MAP("m1", "Saltmere", false));
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Edit this map" }));
    expect(screen.getByRole("list", { name: /chosen/i })).toHaveTextContent("coast");
    await user.type(screen.getByLabelText("Tags"), "Old Town{Enter}");
    await waitFor(() => expect(updateMap).toHaveBeenCalledWith("gm", "m1", { tags: ["coast", "old-town"] }));
    await user.click(screen.getByRole("switch", { name: "Who sees this map: Everyone" }));
    await waitFor(() => expect(revealMap).toHaveBeenCalledWith("gm", "m1", false));
  });

  it("finds a pin's map when the address names only the pin", async () => {
    marker.mockResolvedValue(PIN("k1", "Harbourmaster's Tower", { mapId: "m1" }));
    function PinOnly() {
      const [href, setHref] = useState("/codex/atlas?pin=k1");
      const [path, search] = href.split("?");
      const query = new URLSearchParams(search ?? "");
      return (
        <ToastProvider>
          <AtlasView
            gmToken="gm"
            scenes={[]}
            activeEncounterId={null}
            onActivateScene={vi.fn()}
            mapId={path.split("/")[3] ?? null}
            pinId={query.get("pin")}
            autosave={{ enabled: true, intervalSeconds: 1 }}
            onQuickCreate={vi.fn()}
            onNavigate={setHref}
            onReplaceQuery={vi.fn()}
          />
        </ToastProvider>
      );
    }
    render(<PinOnly />);
    await waitFor(() => expect(marker).toHaveBeenCalledWith("gm", "k1"));
    expect(await screen.findByRole("region", { name: "Pin: Harbourmaster's Tower" })).toBeInTheDocument();
  });
});

/** Selecting a pin is a navigation, so an editor with unsaved changes asks first. Uses the real router. */
describe("Selecting another pin passes the unsaved-changes guard", () => {
  function RoutedAtlas() {
    const { query } = useRoute();
    return (
      <ToastProvider>
        <AtlasView
          gmToken="gm"
          scenes={[]}
          activeEncounterId={null}
          onActivateScene={vi.fn()}
          mapId="m1"
          pinId={query.get("pin")}
          filter={query.get("q") ?? ""}
          tagFilter={query.get("tag")}
          autosave={{ enabled: false, intervalSeconds: 1 }}
          onQuickCreate={vi.fn()}
          onNavigate={navigate}
          onReplaceQuery={replaceQuery}
        />
      </ToastProvider>
    );
  }
  beforeEach(() => goTo("/codex/atlas/m1?pin=k1"));
  afterEach(() => vi.restoreAllMocks());

  async function dirtyEditor(user: ReturnType<typeof userEvent.setup>) {
    render(<RoutedAtlas />);
    await user.click(await screen.findByRole("button", { name: "Edit pin" }));
    await user.type(await screen.findByLabelText("Label"), " keep");
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());
  }

  it("prompts, and staying keeps the pin and the typed label", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await dirtyEditor(user);
    tapPin("k2");
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(currentHref()).toBe("/codex/atlas/m1?pin=k1");
    expect(screen.getByLabelText("Label")).toHaveValue("Harbourmaster's Tower keep");
    expect(updateMarker).not.toHaveBeenCalled();
  });

  it("moves when the GM leaves, keeping the pin filter in the address", async () => {
    const user = userEvent.setup();
    goTo("/codex/atlas/m1?q=tun&pin=k1");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    await dirtyEditor(user);
    tapPin("k2");
    await waitFor(() => expect(currentHref()).toBe("/codex/atlas/m1?q=tun&pin=k2"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("region", { name: "Pin: Tunnel mouth" })).toBeInTheDocument();
  });
});
