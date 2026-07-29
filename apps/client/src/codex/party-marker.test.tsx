import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));
// The atlas renders a real image-backed surface; this file is about the party FLAG, not the camera.
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

import { AtlasView } from "./AtlasView";
import { MapSurface } from "./MapSurface";
import type { CodexMap, CodexMarker } from "./api";

/**
 * M12 / CT-7 — the party marker on the client.
 *
 * The three things this has to hold, and why each is asserted the way it is:
 *  - **R2** — "the party is here" may never be carried by the ring alone. Colour and shape live entirely
 *    in CSS and SVG attributes, so the proof is that the TEXT of the surface says it: strip every
 *    stylesheet and a reader still knows where the party is. The `<title>` assertion is the same rule for
 *    a reader who cannot see the map at all.
 *  - **M12-C** — one pin for the whole atlas. The client's half of that is that it re-reads instead of
 *    patching one row: the pin that LOST the flag may be on a different map entirely, so a client that
 *    trusted the echo would leave two pins claiming to be the party until the next refresh.
 *  - **One way to move it.** CT-7 says the party is moved by moving the pin. A second control — a
 *    coordinate field, a "move the party here" action — is the drift this asserts against, and it is
 *    asserted by absence because that is the only way to catch a control being added.
 */

const MAP: CodexMap = {
  id: "m1", assetId: "a1", name: "Barovia", kind: "regional", parentMapId: null,
  revealedToPlayers: true, sortKey: 0, tags: [], createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z"
};
const MARKER = (over: Partial<CodexMarker> = {}): CodexMarker => ({
  id: "k1", mapId: "m1", x: 100, y: 200, iconId: "village", iconColor: "#FF2E9A", label: "Vallaki",
  revealedToPlayers: true, pageIds: [], subMapId: null, sceneIds: [], actorId: null, isParty: false,
  tags: [], createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z", ...over
});

const renderAtlas = async (markers: CodexMarker[]) => {
  listMaps.mockResolvedValue([MAP]);
  listMarkers.mockResolvedValue(markers);
  listAssets.mockResolvedValue([]);
  listPages.mockResolvedValue([]);
  forMarker.mockResolvedValue([]);
  render(<AtlasView gmToken="gm" scenes={[]} activeSceneId={null} onOpenPage={vi.fn()} onActivateScene={vi.fn()} />);
  await waitFor(() => expect(listMarkers).toHaveBeenCalled());
};

describe("The party pin says so in words, not only by its ring (CT-7 / R2)", () => {
  it("draws the words on the map and names the pin for a screen reader", () => {
    render(<MapSurface token="gm" assetId="a1" placing={false} selectedMarkerId={null}
      markers={[{ id: "k1", x: 100, y: 200, iconId: "village", iconColor: "#FF2E9A", label: "Vallaki", isParty: true }]}
      onBackgroundClick={vi.fn()} onMarkerClick={vi.fn()} onMarkerDragEnd={vi.fn()} />);

    const pin = document.querySelector('[data-marker-id="k1"]')!;
    expect(pin.textContent).toContain("The party is here");
    expect(pin.querySelector("title")!.textContent).toBe("Vallaki — the party is here");
    // The ring is decoration on top of that, never instead of it.
    expect(pin.querySelector(".codex-marker-partyring")).not.toBeNull();
  });

  it("says nothing at all on an ordinary pin", () => {
    render(<MapSurface token="gm" assetId="a1" placing={false} selectedMarkerId={null}
      markers={[{ id: "k1", x: 100, y: 200, iconId: "village", iconColor: "#FF2E9A", label: "Vallaki" }]}
      onBackgroundClick={vi.fn()} onMarkerClick={vi.fn()} onMarkerDragEnd={vi.fn()} />);

    const pin = document.querySelector('[data-marker-id="k1"]')!;
    expect(pin.textContent).not.toContain("The party");
    expect(pin.querySelector("title")).toBeNull();
    expect(pin.querySelector(".codex-marker-partyring")).toBeNull();
  });

  it("the atlas says where the party is in its own chrome, and says nothing when the pin is elsewhere", async () => {
    await renderAtlas([MARKER({ isParty: true })]);
    expect(await screen.findByText(/The party is on this map/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show the pin" })).toBeInTheDocument();

    // A map with no party pin makes NO claim either way: markers are listed per map, so this view
    // genuinely does not know where the party is when it is not here.
    listMarkers.mockResolvedValue([MARKER()]);
    const { unmount } = render(<AtlasView gmToken="gm" scenes={[]} activeSceneId={null} onOpenPage={vi.fn()} onActivateScene={vi.fn()} />);
    await waitFor(() => expect(listMarkers).toHaveBeenCalledTimes(2));
    expect(screen.queryAllByText(/is not on this map/)).toHaveLength(0);
    unmount();
  });
});

describe("One party pin for the whole atlas (M12-C)", () => {
  it("marks a pin as the party through its own route, and re-reads the map's pins", async () => {
    await renderAtlas([MARKER()]);
    const user = userEvent.setup();
    // Open the inspector by clicking the pin's group (the surface's own click path).
    await user.click(document.querySelector('[data-marker-id="k1"]')!);
    const toggle = await screen.findByLabelText("This pin is the party's position");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    setPartyMarker.mockResolvedValue(MARKER({ isParty: true }));
    const readsBefore = listMarkers.mock.calls.length;
    await user.click(toggle);

    await waitFor(() => expect(setPartyMarker).toHaveBeenCalledWith("gm", "k1", true));
    // M12-C: setting this one CLEARED whichever pin held it before, possibly on another map — so the
    // client re-reads rather than patching the one row it was handed back.
    await waitFor(() => expect(listMarkers.mock.calls.length).toBeGreaterThan(readsBefore));
    // The party flag is not an edit to the pin: it never travels on the PATCH that rewrites its label.
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

  it("offers no second way to move the party — the pin IS the position", async () => {
    await renderAtlas([MARKER({ isParty: true })]);
    const user = userEvent.setup();
    await user.click(document.querySelector('[data-marker-id="k1"]')!);
    await screen.findByLabelText("This pin is the party's position");

    // Asserted by COUNTING, which is the only way to catch a control being added later: exactly ONE
    // control in the inspector is about the party, and it is the flag. A coordinate field or a
    // "move the party here" action would be a second path onto `moveMarker` and would make this two.
    const inspector = screen.getByRole("complementary", { name: "Marker" });
    const partyControls = [...inspector.querySelectorAll("button, input, select, textarea")]
      .filter((element) => /party/i.test(`${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`));
    expect(partyControls).toHaveLength(1);
    expect(partyControls[0]).toHaveAttribute("role", "switch");
    expect(moveMarker).not.toHaveBeenCalled();
    // And the inspector says out loud how it IS moved.
    expect(screen.getByText(/Drag it to move the party/)).toBeInTheDocument();
  });
});
