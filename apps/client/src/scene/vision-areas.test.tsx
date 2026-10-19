import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView, PlayerVision } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: true, enabled: true, visible: [], actorIds: [] }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// jsdom has no layout, so a client point is the image point.
vi.mock("./mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 600, height: 400 }),
  imagePointFromClient: (_svg: unknown, x: number, y: number) => ({ x, y })
}));
const GRID = vi.hoisted(() => ({
  status: "ready",
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
}));
vi.mock("./gridPreview", async (original) => ({
  ...(await original<typeof import("./gridPreview")>()),
  useMapCalibration: () => GRID
}));

import { EncounterMap } from "./EncounterMap";

// Light and obscurement on the map: the GM paints an area over the ambient light, turns bright ambient light into
// sunlight, and removes an area with Remove. A player sees Dim Light in sight as a light shade, and the creatures one
// of their characters senses (Divine Sense) as a ring named with its creature type.

const LYRA = "10000000-0000-4000-8000-0000000000b1";
const MAP = "20000000-0000-5000-8000-0000000000b1";
const AREA = "80000000-0000-4000-8000-0000000000a1";
const actors = [
  {
    id: LYRA,
    name: "Lyra",
    kind: "player-character",
    visibility: "public",
    hp: { current: 37, maximum: 44, temporary: 0 },
    conditions: [],
    effects: [],
    presence: null
  }
] as unknown as GmView["actors"];
const tokens = [
  { actorId: LYRA, position: { x: 75, y: 75 }, sizePx: 41, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 }
];
const sceneVision = (fields: Record<string, unknown> = {}) =>
  ({
    enabled: true,
    ambient: "bright",
    sunlight: false,
    walls: [],
    lights: [],
    areas: [],
    measure: { width: 600, height: 400, pixelsPerFoot: 10 },
    explored: null,
    ...fields
  }) as unknown as GmView["combat"]["vision"];

function gmMap(vision: GmView["combat"]["vision"]) {
  return render(
    <ToastProvider>
      <EncounterMap
        assetId={MAP}
        token="gm"
        role="gm"
        actors={actors}
        tokens={tokens}
        annotations={[]}
        revision={3}
        activeActorId={null}
        vision={vision}
      />
    </ToastProvider>
  );
}
const sent = (event: string) => command.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);
const svgPoint = () => document.querySelector(".encounter-map-stage svg image") as Element;

beforeAll(() => {
  // jsdom has no pointer capture; the map's drags hold it while they last.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
});
afterEach(() => command.mockClear());

async function openLight(user: ReturnType<typeof userEvent.setup>) {
  const rail = screen.getByRole("toolbar", { name: "Map tools" });
  await user.click(within(rail).getByRole("button", { name: "Light" }));
  return within(screen.getByRole("group", { name: "Light" }));
}

describe("the GM's areas of light and obscurement", () => {
  it("paints the chosen area over a dragged rectangle", async () => {
    const user = userEvent.setup();
    gmMap(sceneVision());
    const light = await openLight(user);
    await user.selectOptions(light.getByLabelText("Area to paint"), "magical-darkness");
    await user.click(light.getByRole("button", { name: "Paint area" }));
    fireEvent.pointerDown(svgPoint(), { button: 0, clientX: 100, clientY: 100, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerMove(svgPoint(), { clientX: 220, clientY: 180, pointerId: 1, pointerType: "mouse" });
    fireEvent.pointerUp(svgPoint(), { clientX: 220, clientY: 180, pointerId: 1, pointerType: "mouse" });
    expect(sent("vision:add-area")).toEqual([
      expect.objectContaining({ kind: "magical-darkness", rect: { x: 100, y: 100, width: 120, height: 80 } })
    ]);
  });

  it("draws each area for the GM, and Remove takes one away", async () => {
    const user = userEvent.setup();
    const area = { id: AREA, kind: "dark", shape: { type: "rect", x: 200, y: 100, width: 100, height: 100 } };
    gmMap(sceneVision({ areas: [area] }));
    const drawn = document.querySelector(`[data-area-id="${AREA}"]`) as Element;
    expect(drawn.querySelector("title")?.textContent).toBe("Darkness");
    const light = await openLight(user);
    await user.click(light.getByRole("button", { name: "Remove" }));
    fireEvent.pointerDown(drawn.querySelector(".vision-hit") as Element, {
      button: 0,
      clientX: 250,
      clientY: 150,
      pointerId: 2,
      pointerType: "mouse"
    });
    expect(sent("vision:remove-area")).toEqual([expect.objectContaining({ areaId: AREA })]);
  });

  it("makes bright ambient light sunlight, and only bright", async () => {
    const user = userEvent.setup();
    const { unmount } = gmMap(sceneVision());
    const light = await openLight(user);
    await user.click(light.getByRole("switch", { name: "Sunlight" }));
    expect(sent("vision:set-ambient")).toEqual([expect.objectContaining({ ambient: "bright", sunlight: true })]);
    unmount();
    gmMap(sceneVision({ ambient: "dim" }));
    const dim = await openLight(user);
    expect(dim.getByRole("switch", { name: "Sunlight" }).hasAttribute("disabled")).toBe(true);
    expect(dim.getByText("Sunlight needs bright ambient light.")).toBeTruthy();
  });
});

describe("what a player sees of the light", () => {
  const square = (x: number, y: number, side: number) => [x, y, x + side, y, x + side, y + side, x, y + side];
  const playerVision: PlayerVision = {
    enabled: true,
    visible: [square(0, 0, 300)],
    bright: [square(0, 0, 100)],
    explored: [],
    walls: [],
    sensed: [{ x: 450, y: 75, creatureType: "undead" }]
  };

  it("shades the Dim Light in sight and marks a creature its character senses", () => {
    render(
      <ToastProvider>
        <EncounterMap
          assetId={MAP}
          token="player"
          role="player"
          actors={actors}
          tokens={tokens}
          annotations={[]}
          revision={3}
          activeActorId={null}
          vision={playerVision}
        />
      </ToastProvider>
    );
    const mask = document.querySelector("mask[id*='v']") as Element;
    const fills = [...mask.querySelectorAll("polygon")].map((polygon) => polygon.getAttribute("fill"));
    // What is in sight keeps a light shade, and the bright part of it none.
    expect(fills).toEqual(["#2a2a2a", "black"]);
    const sensed = document.querySelector(".vision-sensed") as Element;
    expect(sensed.querySelector("title")?.textContent).toBe("You sense an Undead here");
    expect(sensed.querySelector("text")?.textContent).toBe("Undead");
  });
});
