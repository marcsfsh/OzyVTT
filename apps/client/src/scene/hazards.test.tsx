import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GmView, PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: true, counted: false, speedFeet: 30, usedFeet: 0 }))
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

// The GM's ground, traps and weather on the map (SRD 5.2.1 Gameplay Toolbox): water and ice painted by dragging, a
// trap set over a dragged area and marked found, the scene's weather switched on, and a player making a found trap
// safe with their own character.

const LYRA = "10000000-0000-4000-8000-0000000000c1";
const MAP = "20000000-0000-5000-8000-0000000000c1";
const TRAP = "80000000-0000-4000-8000-0000000000c1";
const actor = (claim: Record<string, unknown> = {}) =>
  [
    {
      id: LYRA,
      name: "Lyra",
      kind: "player-character",
      visibility: "public",
      hp: { current: 37, maximum: 44, temporary: 0 },
      conditions: [],
      effects: [],
      presence: null,
      ...claim
    }
  ] as unknown as GmView["actors"];
const tokens = [
  { actorId: LYRA, position: { x: 75, y: 75 }, sizePx: 41, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 }
];
const calm = {
  cold: false,
  heat: false,
  highAltitude: false,
  precipitation: "none",
  wind: "none",
  frigidWater: false,
  deepWater: false
};
const gmState = (traps: unknown[] = []) =>
  ({
    definitions: {},
    actors: actor(),
    combat: {
      active: false,
      initiative: [],
      pendingRuleAsks: [],
      pendingReactions: [],
      pendingSaves: [],
      traps,
      environment: calm
    }
  }) as unknown as GmView;

function gmMap(state: GmView) {
  return render(
    <ToastProvider>
      <EncounterMap
        assetId={MAP}
        token="gm"
        role="gm"
        actors={actor()}
        tokens={tokens}
        annotations={[]}
        revision={3}
        activeActorId={null}
        state={state}
      />
    </ToastProvider>
  );
}
const sent = (event: string) => command.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);
const svgPoint = () => document.querySelector(".encounter-map-stage svg image") as Element;
const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.pointerDown(svgPoint(), {
    button: 0,
    clientX: from.x,
    clientY: from.y,
    pointerId: 1,
    pointerType: "mouse"
  });
  fireEvent.pointerMove(svgPoint(), { clientX: to.x, clientY: to.y, pointerId: 1, pointerType: "mouse" });
  fireEvent.pointerUp(svgPoint(), { clientX: to.x, clientY: to.y, pointerId: 1, pointerType: "mouse" });
};

async function openGroup(user: ReturnType<typeof userEvent.setup>, name: string) {
  const rail = screen.getByRole("toolbar", { name: "Map tools" });
  await user.click(within(rail).getByRole("button", { name }));
  return within(screen.getByRole("group", { name }));
}

beforeAll(() => {
  // jsdom has no pointer capture; the map's drags hold it while they last.
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
});
afterEach(() => command.mockClear());

describe("the GM's ground", () => {
  it("paints running water and ice over a dragged area", async () => {
    const user = userEvent.setup();
    gmMap(gmState());
    const terrain = await openGroup(user, "Terrain");
    await user.click(terrain.getByRole("button", { name: "Running water" }));
    drag({ x: 100, y: 100 }, { x: 220, y: 180 });
    await user.click(terrain.getByRole("button", { name: "Ice" }));
    drag({ x: 300, y: 100 }, { x: 400, y: 150 });
    expect(sent("terrain:paint")).toEqual([
      expect.objectContaining({ op: "running-water", rect: { x: 100, y: 100, width: 120, height: 80 } }),
      expect.objectContaining({ op: "ice", rect: { x: 300, y: 100, width: 100, height: 50 } })
    ]);
  });
});

describe("the GM's traps", () => {
  it("sets the chosen trap at its band of levels over a dragged area", async () => {
    const user = userEvent.setup();
    gmMap(gmState());
    const traps = await openGroup(user, "Traps");
    await user.selectOptions(traps.getByLabelText("Trap"), "falling-net");
    await user.selectOptions(traps.getByLabelText("Party levels"), "2");
    await user.click(traps.getByRole("button", { name: "Set a trap" }));
    drag({ x: 100, y: 100 }, { x: 150, y: 150 });
    expect(sent("trap:place")).toEqual([
      expect.objectContaining({ trapId: "falling-net", tier: 2, rect: { x: 100, y: 100, width: 50, height: 50 } })
    ]);
  });

  it("lists each trap with its band and state, and reveals, sets off, makes safe or removes it", async () => {
    const user = userEvent.setup();
    const trap = {
      id: TRAP,
      trapId: "hidden-pit",
      name: "Hidden Pit",
      tier: 1,
      area: { x: 150, y: 100, width: 50, height: 50 },
      state: "armed",
      found: false,
      activations: 0
    };
    gmMap(gmState([trap]));
    // The GM's map draws the hidden trap, fainter than a found one.
    expect(document.querySelector(".terrain-trap-hidden title")?.textContent).toBe("Hidden Pit");
    const traps = await openGroup(user, "Traps");
    const row = within(traps.getByRole("list", { name: "Traps on this map" })).getByRole("listitem");
    expect(row.textContent).toContain("Levels 1-4 · Armed · Hidden");
    await user.click(within(row).getByRole("button", { name: "Reveal" }));
    await user.click(within(row).getByRole("button", { name: "Set off" }));
    await user.click(within(row).getByRole("button", { name: "Make safe" }));
    await user.click(within(row).getByRole("button", { name: "Remove Hidden Pit" }));
    expect(sent("trap:edit")).toEqual([
      expect.objectContaining({ trapId: TRAP, found: true }),
      expect.objectContaining({ trapId: TRAP, state: "disarmed" })
    ]);
    expect(sent("trap:spring")).toEqual([expect.objectContaining({ trapId: TRAP, actorId: null })]);
    expect(sent("trap:remove")).toEqual([expect.objectContaining({ trapId: TRAP })]);
  });
});

describe("the GM's weather", () => {
  it("switches the encounter's cold on and sets heavy rain", async () => {
    const user = userEvent.setup();
    gmMap(gmState());
    const weather = await openGroup(user, "Weather");
    await user.click(weather.getByRole("switch", { name: "Extreme cold" }));
    await user.selectOptions(weather.getByLabelText("Precipitation"), "rain");
    expect(sent("environment:set")).toEqual([
      expect.objectContaining({ environment: { cold: true } }),
      expect.objectContaining({ environment: { precipitation: "rain" } })
    ]);
  });
});

describe("a player's found trap", () => {
  it("draws it on the map and makes it safe with the player's own character, one of its ways", async () => {
    const user = userEvent.setup();
    const found = {
      id: TRAP,
      name: "Poisoned Darts",
      area: { x: 150, y: 100, width: 50, height: 50 },
      state: "armed",
      ways: [
        { id: "plug", name: "Plug the holes" },
        { id: "wedge-spike", name: "Wedge an Iron Spike under the pressure plate" }
      ]
    };
    const mine = actor({ claimStatus: "mine" }) as unknown as PlayerView["actors"];
    render(
      <ToastProvider>
        <EncounterMap
          assetId={MAP}
          token="player"
          role="player"
          actors={mine}
          tokens={tokens}
          annotations={[]}
          revision={3}
          activeActorId={null}
          state={
            {
              actors: mine,
              combat: { active: false, initiative: [], pendingRuleAsks: [], traps: [found] }
            } as unknown as PlayerView
          }
        />
      </ToastProvider>
    );
    expect(document.querySelector(".terrain-trap title")?.textContent).toBe("Poisoned Darts");
    const traps = await openGroup(user, "Traps");
    await user.click(traps.getByRole("button", { name: "Plug the holes" }));
    expect(sent("trap:disarm")).toEqual([expect.objectContaining({ trapId: TRAP, actorId: LYRA, disarmId: "plug" })]);
  });
});
