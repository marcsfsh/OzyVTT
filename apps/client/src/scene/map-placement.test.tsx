import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { GmView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: true }))
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
  calibration: { kind: "square", origin: { x: 10, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
}));
vi.mock("./gridPreview", async (original) => ({
  ...(await original<typeof import("./gridPreview")>()),
  useMapCalibration: () => GRID
}));

import { EncounterMap } from "./EncounterMap";
import { armPlacement } from "./tableGeometry";

// Anything placed on a map has two ways in: a button and then a press on the map, or a right-click (a long press on a
// phone) at the spot. A map that only shows sends nothing.

const LYRA = "10000000-0000-4000-8000-0000000000b1";
const GOBLIN = "10000000-0000-4000-8000-0000000000b2";
const MAP = "20000000-0000-5000-8000-0000000000b1";
const SCENE = "30000000-0000-4000-8000-0000000000b1";
const actor = (id: string, name: string, kind: string) => ({
  id,
  name,
  kind,
  visibility: "public",
  hp: { current: 10, maximum: 10, temporary: 0 },
  conditions: [],
  effects: [],
  presence: null
});
const actors = [
  actor(LYRA, "Lyra", "player-character"),
  actor(GOBLIN, "Goblin", "monster")
] as unknown as GmView["actors"];
const tokens = [
  { actorId: LYRA, position: { x: 75, y: 75 }, sizePx: 41, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 },
  { actorId: GOBLIN, position: null, sizePx: 41, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 }
];

function map(props: Partial<Parameters<typeof EncounterMap>[0]> = {}) {
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
        moveSceneId={SCENE}
        {...props}
      />
    </ToastProvider>
  );
}
const stage = () => document.querySelector(".encounter-map-interaction") as HTMLElement;
const svgPoint = () => document.querySelector(".encounter-map-stage svg image") as Element;
const moves = () => command.mock.calls.filter(([event]) => event === "token:move").map(([, payload]) => payload);

afterEach(() => {
  command.mockClear();
  act(() => armPlacement(null));
});

describe("placing on the map", () => {
  it("places an armed creature where the map is pressed next, and Cancel withdraws it", () => {
    map();
    act(() => armPlacement(GOBLIN));
    const banner = screen.getByText("Tap the map where Goblin goes.").closest("[role=status]") as HTMLElement;
    fireEvent.click(within(banner).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/where Goblin goes/)).toBeNull();

    act(() => armPlacement(GOBLIN));
    fireEvent.pointerDown(svgPoint(), { button: 0, clientX: 320, clientY: 180, pointerId: 1, pointerType: "mouse" });
    expect(moves()).toEqual([
      expect.objectContaining({ actorId: GOBLIN, position: { x: 320, y: 180 }, encounterId: SCENE })
    ]);
    expect(screen.queryByText(/where Goblin goes/)).toBeNull();
  });

  it("offers what can go on a spot from a right-click there: the waiting creature, and a light for the GM", () => {
    map();
    fireEvent.contextMenu(svgPoint(), { clientX: 200, clientY: 150 });
    const menu = screen.getByRole("menu", { name: "Place here" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["Place Goblin here", "Place a light here · Torch · 20 ft + 20 ft"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Place Goblin here" }));
    expect(moves()).toEqual([
      expect.objectContaining({ actorId: GOBLIN, position: { x: 200, y: 150 }, encounterId: SCENE })
    ]);
    expect(screen.queryByRole("menu", { name: "Place here" })).toBeNull();
  });

  it("opens the spot's menu from a finger held still on an empty spot", () => {
    vi.useFakeTimers();
    try {
      map();
      fireEvent.pointerDown(svgPoint(), { button: 0, clientX: 260, clientY: 210, pointerId: 4, pointerType: "touch" });
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByRole("menu", { name: "Place here" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a map that only shows", () => {
  it("keeps View alone in its rail, sends nothing on a drag, and can draw its grid", () => {
    map({ readOnly: true, showGrid: true });
    const rail = screen.getByRole("toolbar", { name: "Map tools" });
    expect(
      within(rail)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["View"]);
    expect(document.querySelector(".encounter-token-tray")).toBeNull();
    const token = document.querySelector(`[data-token-id="${LYRA}"]`) as Element;
    fireEvent.pointerDown(token, { button: 0, clientX: 75, clientY: 75, pointerId: 2, pointerType: "mouse" });
    fireEvent.pointerUp(stage(), { button: 0, clientX: 300, clientY: 300, pointerId: 2, pointerType: "mouse" });
    fireEvent.contextMenu(svgPoint(), { clientX: 200, clientY: 150 });
    expect(command).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    // Lines every 50 pixels from the origin's offset, across a 600 by 400 map.
    const lines = [...document.querySelectorAll(".map-grid-lines line")];
    expect(
      lines.filter((line) => line.getAttribute("x1") === line.getAttribute("x2")).map((line) => line.getAttribute("x1"))
    ).toEqual(["10", "60", "110", "160", "210", "260", "310", "360", "410", "460", "510", "560"]);
    expect(lines.filter((line) => line.getAttribute("y1") === line.getAttribute("y2"))).toHaveLength(9);
  });
});
