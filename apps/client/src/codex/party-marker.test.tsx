import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// The atlas renders a real image-backed surface; this file is about the party flag and leaves the camera alone.
vi.mock("../scene/mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 1000, height: 800 }),
  imagePointFromClient: () => null,
  clampPoint: (point: { x: number; y: number }) => point
}));

const listMaps = vi.fn();
const listMarkers = vi.fn();
const listAssets = vi.fn();
const listPages = vi.fn();
const setPartyMarker = vi.fn();
const moveMarker = vi.fn();
const updateMarker = vi.fn();
const forMarker = vi.fn();

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    codexApi: { ...actual.codexApi, listPages: (...a: unknown[]) => listPages(...a) },
    atlasApi: {
      ...actual.atlasApi,
      listMaps: (...a: unknown[]) => listMaps(...a),
      listMarkers: (...a: unknown[]) => listMarkers(...a),
      listAssets: (...a: unknown[]) => listAssets(...a),
      setPartyMarker: (...a: unknown[]) => setPartyMarker(...a),
      moveMarker: (...a: unknown[]) => moveMarker(...a),
      updateMarker: (...a: unknown[]) => updateMarker(...a)
    },
    journalApi: { ...actual.journalApi, forMarker: (...a: unknown[]) => forMarker(...a) }
  };
});

import { ToastProvider } from "@vtt/ui";
import { AtlasView } from "./AtlasView";
import { MapSurface } from "./MapSurface";
import type { CodexMap, CodexMarker } from "@vtt/domain";

const MAP: CodexMap = {
  id: "m1",
  assetId: "a1",
  name: "Barovia",
  kind: "regional",
  parentMapId: null,
  revealedToPlayers: true,
  sortKey: 0,
  tags: [],
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
  firstShownAt: null
};
const MARKER = (over: Partial<CodexMarker> = {}): CodexMarker => ({
  id: "k1",
  mapId: "m1",
  x: 100,
  y: 200,
  iconId: "village",
  iconColor: "#FF2E9A",
  label: "Vallaki",
  revealedToPlayers: true,
  pageIds: [],
  subMapId: null,
  sceneIds: [],
  actorId: null,
  isParty: false,
  tags: [],
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
  firstShownAt: null,
  ...over
});

/** Feeds the address back like `CodexShell`, since selecting a pin is a navigation (`?pin=`). */
function AtlasHarness() {
  const [href, setHref] = useState("/codex/atlas");
  const [path, search] = href.split("?");
  const query = new URLSearchParams(search ?? "");
  return (
    <ToastProvider>
      <AtlasView
        gmToken="gm"
        scenes={[]}
        actors={[]}
        activeSceneId={null}
        onActivateScene={vi.fn()}
        mapId={path.split("/")[3] ?? null}
        pinId={query.get("pin")}
        autosave={{ enabled: true, intervalSeconds: 1 }}
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

const renderAtlas = async (markers: CodexMarker[]) => {
  listMaps.mockResolvedValue([MAP]);
  listMarkers.mockResolvedValue(markers);
  listAssets.mockResolvedValue([]);
  listPages.mockResolvedValue([]);
  forMarker.mockResolvedValue([]);
  render(<AtlasHarness />);
  await waitFor(() => expect(listMarkers).toHaveBeenCalled());
};

describe("The party pin says so in words, not only by its ring", () => {
  it("draws the words on the map and names the pin for a screen reader", () => {
    render(
      <MapSurface
        token="gm"
        assetId="a1"
        placing={false}
        selectedMarkerId={null}
        markers={[
          { id: "k1", x: 100, y: 200, iconId: "village", iconColor: "#FF2E9A", label: "Vallaki", isParty: true }
        ]}
        onBackgroundClick={vi.fn()}
        onMarkerClick={vi.fn()}
        onMarkerDragEnd={vi.fn()}
      />
    );

    const pin = document.querySelector('[data-marker-id="k1"]')!;
    expect(pin.textContent).toContain("The party is here");
    expect(pin.querySelector("title")!.textContent).toBe("Vallaki, the party is here");
    expect(pin.querySelector(".codex-marker-partyring")).not.toBeNull();
  });

  it("says nothing at all on an ordinary pin", () => {
    render(
      <MapSurface
        token="gm"
        assetId="a1"
        placing={false}
        selectedMarkerId={null}
        markers={[{ id: "k1", x: 100, y: 200, iconId: "village", iconColor: "#FF2E9A", label: "Vallaki" }]}
        onBackgroundClick={vi.fn()}
        onMarkerClick={vi.fn()}
        onMarkerDragEnd={vi.fn()}
      />
    );

    const pin = document.querySelector('[data-marker-id="k1"]')!;
    expect(pin.textContent).not.toContain("The party");
    expect(pin.querySelector("title")).toBeNull();
    expect(pin.querySelector(".codex-marker-partyring")).toBeNull();
  });

  it("the atlas says where the party is in its own chrome", async () => {
    await renderAtlas([MARKER({ isParty: true })]);
    expect(await screen.findByText(/The party is on this map/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the pin" })).toBeInTheDocument();
  });

  /** One render and the real phrase, so a `markers[0]` mutation fails. */
  it("says nothing about the party on a map whose pins are not the party", async () => {
    await renderAtlas([MARKER({ isParty: false })]);
    await waitFor(() => expect(listMarkers).toHaveBeenCalled());
    expect(screen.queryByText(/The party is on this map/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show the pin" })).not.toBeInTheDocument();
  });
});

/**
 * "Show the pin" centres the camera and scrolls the map into view. The camera is checked through the
 * `viewBox`; `scrollIntoView` is a jsdom shim, so it is checked as a call.
 */
describe("Show the pin shows the pin", () => {
  // The 1000x800 image fits at zoom 1 with the camera centred, so the viewBox is "0 0 1000 800".
  const FIT = "0 0 1000 800";
  const svg = () => document.querySelector(".codex-map-svg")!;

  it("centres the camera on the party pin and brings the map into view", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    // Off-centre, so a camera that never moved can't pass.
    await renderAtlas([MARKER({ isParty: true, x: 100, y: 200 })]);
    const user = userEvent.setup();
    expect(svg()).toHaveAttribute("viewBox", FIT);

    await user.click(screen.getByRole("button", { name: "Show the pin" }));

    // Centred on (100, 200): 100 - 500 = -400, 200 - 400 = -200.
    await waitFor(() => expect(svg()).toHaveAttribute("viewBox", "-400 -200 1000 800"));
    expect(scrolled).toHaveBeenCalled();
    scrolled.mockRestore();
  });

  it("does not yank the camera when the GM merely taps a pin", async () => {
    await renderAtlas([MARKER({ isParty: true, x: 100, y: 200 })]);
    const user = userEvent.setup();

    // Selecting must not move the camera out from under the GM's finger.
    await user.click(document.querySelector('[data-marker-id="k1"]')!);

    expect(svg()).toHaveAttribute("viewBox", FIT);
  });
});

describe("One party pin for the whole atlas", () => {
  it("marks a pin as the party through its own route, and re-reads the map's pins", async () => {
    await renderAtlas([MARKER()]);
    const user = userEvent.setup();
    await user.click(document.querySelector('[data-marker-id="k1"]')!);
    const toggle = await screen.findByLabelText("This pin is the party's position");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    setPartyMarker.mockResolvedValue(MARKER({ isParty: true }));
    const readsBefore = listMarkers.mock.calls.length;
    await user.click(toggle);

    await waitFor(() => expect(setPartyMarker).toHaveBeenCalledWith("gm", "k1", true));
    // Setting the party may clear a pin on another map, so the client re-reads.
    await waitFor(() => expect(listMarkers.mock.calls.length).toBeGreaterThan(readsBefore));
    // The party flag never travels on the label PATCH.
    expect(updateMarker).not.toHaveBeenCalled();
  });

  it("clears the party through the same route", async () => {
    await renderAtlas([MARKER({ isParty: true })]);
    const user = userEvent.setup();
    await user.click(document.querySelector('[data-marker-id="k1"]')!);

    const toggle = await screen.findByLabelText("This pin is the party's position");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    setPartyMarker.mockResolvedValue(MARKER({ isParty: false }));
    await user.click(toggle);

    await waitFor(() => expect(setPartyMarker).toHaveBeenCalledWith("gm", "k1", false));
  });

  it("offers no second way to move the party: the pin IS the position", async () => {
    await renderAtlas([MARKER({ isParty: true })]);
    const user = userEvent.setup();
    await user.click(document.querySelector('[data-marker-id="k1"]')!);
    await screen.findByLabelText("This pin is the party's position");

    // Exactly one party control in the inspector: the flag. A second way to move the party would make two.
    const inspector = screen.getByRole("complementary", { name: "Pin" });
    const partyControls = [...inspector.querySelectorAll("button, input, select, textarea")].filter((element) =>
      /party/i.test(`${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`)
    );
    expect(partyControls).toHaveLength(1);
    expect(partyControls[0]).toHaveAttribute("role", "switch");
    expect(moveMarker).not.toHaveBeenCalled();
    expect(
      screen.getByText("Players see this pin marked as the party. Drag the pin to move the party.")
    ).toBeInTheDocument();
  });
});
