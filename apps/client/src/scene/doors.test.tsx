import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContentActionSummary, GmView, PlayerVision } from "@vtt/domain";
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

import { beginTargeting, clearTargeting } from "../encounter/targeting";
import { EncounterMap } from "./EncounterMap";
import { TokenContextMenu } from "./TokenContextMenu";

// Doors and objects on the map: the GM sees which doors are held shut and the hit points of a wall or door that is an
// object, and sets them from a door's menu; a player opens a door or works on it with their character from the same
// menu, and learns nothing of its lock; an attack being aimed takes a tap on a wall as its target.

const LYRA = "10000000-0000-4000-8000-0000000000c1";
const MAP = "20000000-0000-5000-8000-0000000000c1";
const DOOR = "90000000-0000-4000-8000-0000000000d1";
const WALL = "90000000-0000-4000-8000-0000000000d2";
const actors = [
  {
    id: LYRA,
    name: "Lyra",
    kind: "player-character",
    visibility: "public",
    claimStatus: "mine",
    hp: { current: 37, maximum: 44, temporary: 0 },
    conditions: [],
    effects: [],
    presence: null
  }
] as unknown as GmView["actors"];
const tokens = [
  { actorId: LYRA, position: { x: 225, y: 175 }, sizePx: 41, gridSizePx: 50, gridRotationRadians: null, sizeCells: 1 }
];
const lockedDoor = {
  id: DOOR,
  kind: "door",
  a: { x: 250, y: 150 },
  b: { x: 250, y: 200 },
  open: false,
  door: { fastenings: [{ kind: "lock", dc: 15, keyHolderIds: [LYRA] }] },
  object: { name: "Door", armorClass: 15, hitPoints: { current: 12, maximum: 18 } }
};
const stone = { id: WALL, kind: "wall", a: { x: 250, y: 0 }, b: { x: 250, y: 150 } };
const sceneVision = {
  enabled: true,
  ambient: "bright",
  sunlight: false,
  walls: [stone, lockedDoor],
  lights: [],
  areas: [],
  measure: { width: 600, height: 400, pixelsPerFoot: 10 },
  explored: null
} as unknown as GmView["combat"]["vision"];
const playerVision: PlayerVision = {
  enabled: true,
  visible: [[0, 0, 600, 0, 600, 400, 0, 400]],
  explored: [],
  walls: [
    { id: WALL, kind: "wall", a: stone.a, b: stone.b },
    { id: DOOR, kind: "door", a: lockedDoor.a, b: lockedDoor.b, open: false }
  ]
};

const DAGGER = {
  id: "dagger",
  name: "Dagger",
  activation: "action",
  description: "A dagger.",
  attackBonus: 5,
  reachFeet: 5,
  rangeFeet: null,
  rangeNormalFeet: null,
  saveAbility: null,
  saveDc: null,
  damage: [{ formula: "1d4+2", type: "piercing" }],
  area: null,
  attackCount: null,
  usesLimit: null,
  usesPer: null,
  usesRecharge: null,
  usesPool: null,
  requiresEffectTag: null,
  multiattack: null,
  grants: false,
  reaction: null,
  targeting: "single"
} as ContentActionSummary;

function map(role: "gm" | "player") {
  return render(
    <ToastProvider>
      <EncounterMap
        assetId={MAP}
        token={role}
        role={role}
        actors={actors}
        tokens={tokens}
        annotations={[]}
        revision={3}
        activeActorId={null}
        vision={role === "gm" ? sceneVision : playerVision}
      />
    </ToastProvider>
  );
}
const sent = (event: string) => command.mock.calls.filter(([name]) => name === event).map(([, payload]) => payload);
const handle = () => document.querySelector(`[data-door-id="${DOOR}"]`) as Element;
const tap = (element: Element, x = 250, y = 175) =>
  fireEvent.pointerDown(element, { button: 0, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse" });

beforeAll(() => {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
});
afterEach(() => {
  command.mockClear();
  clearTargeting();
});

describe("a door on the GM's map", () => {
  it("marks a door held shut and shows the hit points of a door that is an object", () => {
    map("gm");
    expect(handle().closest(".vision-wall")?.classList.contains("fastened")).toBe(true);
    expect(handle().querySelector(".vision-door-lock")).not.toBeNull();
    expect(handle().getAttribute("aria-label")).toBe("Closed door · held shut");
    expect(document.querySelector(".vision-object-hp")?.textContent).toBe("12/18 HP");
  });

  it("opens the door's menu on a tap, which says what holds it and opens it", async () => {
    const user = userEvent.setup();
    map("gm");
    tap(handle());
    const menu = screen.getByRole("menu", { name: "Door" });
    expect(within(menu).getByText("Locked DC 15 · AC 15 · 12/18 HP")).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Open the door" }));
    expect(sent("door:set-open")).toEqual([expect.objectContaining({ wallId: DOOR, open: true })]);
  });

  it("bars the door from the editor and keeps the lock's key holders", async () => {
    const user = userEvent.setup();
    map("gm");
    tap(handle());
    const menu = screen.getByRole("menu", { name: "Door" });
    await user.click(within(menu).getByRole("menuitem", { name: "Edit lock and strength" }));
    await user.click(within(menu).getByRole("switch", { name: "Barred" }));
    await user.click(within(menu).getByRole("button", { name: "Save door" }));
    expect(sent("door:set-state")).toEqual([
      expect.objectContaining({
        wallId: DOOR,
        door: {
          fastenings: [
            { kind: "lock", dc: 15, keyHolderIds: [LYRA] },
            { kind: "barred", dc: 15 }
          ]
        }
      })
    ]);
    expect(sent("object:set")).toEqual([
      expect.objectContaining({
        wallId: DOOR,
        object: { name: "Door", armorClass: 15, hitPoints: { current: 12, maximum: 18 } }
      })
    ]);
  });
});

describe("a door on a player's map", () => {
  it("shows no lock or hit points, and offers the door's work to the player's character", async () => {
    const user = userEvent.setup();
    map("player");
    expect(handle().querySelector(".vision-door-lock")).toBeNull();
    expect(document.querySelector(".vision-object-hp")).toBeNull();
    tap(handle());
    const menu = screen.getByRole("menu", { name: "Door" });
    expect(within(menu).queryByRole("menuitem", { name: "Edit lock and strength" })).toBeNull();
    expect(within(menu).getByText("Lyra does it. Each takes an action in a fight.")).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Pick the lock" }));
    expect(sent("door:use")).toEqual([expect.objectContaining({ wallId: DOOR, actorId: LYRA, how: "pick" })]);
  });

  it("aims an attack at a wall or a door tapped while it is being aimed", () => {
    map("player");
    act(() => beginTargeting(DAGGER, LYRA));
    tap(handle());
    expect(sent("object:attack")).toEqual([
      expect.objectContaining({ actorId: LYRA, actionId: "dagger", target: { wallId: DOOR } })
    ]);
    expect(screen.queryByRole("menu", { name: "Door" })).toBeNull();
  });
});

describe("what holds a creature", () => {
  const netted = {
    ...actors[0],
    effects: [
      {
        id: "net-1",
        name: "Net",
        tags: [],
        heldBy: { name: "Net", armorClass: 10, hitPoints: { current: 5, maximum: 5 }, immunities: [] }
      }
    ]
  } as unknown as GmView["actors"][number];

  it("tells the GM the Net's Armor Class and hit points, and aims a live attack at it", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <TokenContextMenu
          actor={netted}
          role="gm"
          gmToken="gm"
          x={10}
          y={10}
          reactionUsed={false}
          placed
          onOpenSheet={() => {}}
          onReturnToTray={() => {}}
          onClose={() => {}}
        />
      </ToastProvider>
    );
    expect(screen.getByText("Held by Net · AC 10 · 5/5 HP")).toBeTruthy();
    expect(screen.getByText(/^Breaking the Net frees Lyra\./)).toBeTruthy();
    act(() => beginTargeting(DAGGER, LYRA));
    await user.click(screen.getByRole("menuitem", { name: "Attack the Net with Dagger" }));
    expect(sent("object:attack")).toEqual([
      expect.objectContaining({ actorId: LYRA, actionId: "dagger", target: { actorId: LYRA, effectId: "net-1" } })
    ]);
  });
});
