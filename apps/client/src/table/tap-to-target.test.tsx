import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ContentActionSummary, PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: false }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));
// The map's picture and grid come over HTTP in the app; here the map is ready at once, 600 by 400 on a 5-foot grid.
vi.mock("../scene/mapImage", () => ({
  useAuthorizedMapImage: () => ({ status: "ready", url: "blob:map", width: 600, height: 400 })
}));
const GRID = vi.hoisted(() => ({
  status: "ready",
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
}));
vi.mock("../scene/gridPreview", async (original) => ({
  ...(await original<typeof import("../scene/gridPreview")>()),
  useMapCalibration: () => GRID
}));

import { ActionTargetPicker } from "../encounter/ActionTargetPicker";
import { beginTargeting, clearTargeting, useTargeting } from "../encounter/targeting";
import { EncounterMap } from "../scene/EncounterMap";
import { usePlayerTargetRows } from "./targetRows";

const LYRA = "10000000-0000-4000-8000-0000000000f1";
const BORIN = "10000000-0000-4000-8000-0000000000f2";
const GOBLIN_A = "10000000-0000-4000-8000-0000000000f3";
const GOBLIN_B = "10000000-0000-4000-8000-0000000000f4";
const MAP = "20000000-0000-5000-8000-0000000000f1";

const FIRE_BOLT = {
  id: "fire-bolt",
  name: "Fire Bolt",
  activation: "action",
  description: "A mote of fire.",
  attackBonus: 5,
  reachFeet: null,
  rangeFeet: 120,
  rangeNormalFeet: null,
  saveAbility: null,
  saveDc: null,
  damage: [{ formula: "2d10", type: "fire" }],
  area: null
} as unknown as ContentActionSummary;

const actor = (id: string, name: string, kind: string, changes: Record<string, unknown> = {}) => ({
  id,
  name,
  kind,
  visibility: "public",
  claimStatus: "available",
  hp: { kind: "band", band: "healthy" },
  conditions: [],
  effects: [],
  ...changes
});
const token = (actorId: string, x: number, y: number) => ({
  actorId,
  position: { x, y },
  sizePx: 41,
  gridSizePx: 50,
  sizeCells: 1
});

/** Lyra's turn: Borin beside her, two goblins 10 and 15 feet off. */
const STATE = {
  revision: 4,
  rollCalls: [],
  actors: [
    actor(LYRA, "Lyra", "player-character", { claimStatus: "mine", armorClass: 15 }),
    actor(BORIN, "Borin", "player-character", { armorClass: 18 }),
    actor(GOBLIN_A, "Goblin 1", "monster"),
    actor(GOBLIN_B, "Goblin 2", "monster")
  ],
  combat: {
    active: true,
    round: 1,
    turnActorId: LYRA,
    mapAssetId: MAP,
    turn: { actionUsed: false, bonusActionUsed: false, turnUses: {}, movementUsedFeet: 0 },
    initiative: [
      { actorId: LYRA, name: "Lyra" },
      { actorId: BORIN, name: "Borin" },
      { actorId: GOBLIN_A, name: "Goblin 1" },
      { actorId: GOBLIN_B, name: "Goblin 2" }
    ],
    tokens: [token(LYRA, 75, 75), token(BORIN, 75, 125), token(GOBLIN_A, 175, 75), token(GOBLIN_B, 225, 75)],
    annotations: [],
    pendingReactions: [],
    pendingSaves: [],
    pendingInitiative: [],
    fog: { enabled: false, shapes: [] },
    vision: { enabled: false }
  }
} as unknown as PlayerView;

/** The player's table as far as targeting goes: the map, and the panel's target list beside it. */
function Table() {
  const picking = useTargeting();
  const { rows } = usePlayerTargetRows(STATE, LYRA);
  return (
    <>
      <EncounterMap
        assetId={MAP}
        token="player-token"
        role="player"
        actors={STATE.actors}
        tokens={STATE.combat.tokens}
        annotations={[]}
        revision={STATE.revision}
        activeActorId={LYRA}
        state={STATE}
      />
      {picking && (
        <ActionTargetPicker
          picking={picking}
          targets={[GOBLIN_A, GOBLIN_B, BORIN].map((id) => rows.get(id) ?? { id, label: id })}
          onMap
          busy={false}
          onRoll={() => {}}
        />
      )}
    </>
  );
}

const tap = (element: Element) => {
  fireEvent.pointerDown(element, { button: 0, pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(element, { button: 0, pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 });
};

describe("tap-to-target for a player", () => {
  it("keeps the map and the target list in step, with each target's number, distance and the AC the player knows", () => {
    render(
      <ToastProvider>
        <Table />
      </ToastProvider>
    );
    act(() => beginTargeting(FIRE_BOLT, LYRA));
    const list = screen.getByRole("group", { name: "Targets for Fire Bolt" });
    // Each target reads as its token does, with its distance; a player sees the AC of the party only.
    const first = within(list).getByRole("radio", { name: /Goblin 1/ });
    expect(within(list).getByText("10 ft")).toBeTruthy();
    expect(within(list).getByText("5 ft · AC 18")).toBeTruthy();
    expect(within(list).queryByText(/AC 1[0-4]/)).toBeNull();

    // A tap on the token picks it in the list.
    const goblinOnMap = document.querySelector(`[data-token-id="${GOBLIN_A}"]`)!;
    expect(goblinOnMap.getAttribute("aria-label")).toContain("can be targeted");
    tap(goblinOnMap);
    expect((first as HTMLInputElement).checked).toBe(true);
    expect(goblinOnMap.getAttribute("aria-label")).toContain(", targeted");

    // Picking the other in the list marks its token and lets the first go.
    fireEvent.click(within(list).getByRole("radio", { name: /Goblin 2/ }));
    const second = document.querySelector(`[data-token-id="${GOBLIN_B}"]`)!;
    expect(second.getAttribute("aria-label")).toContain(", targeted");
    expect(goblinOnMap.getAttribute("aria-label")).toContain("can be targeted");
    // The caster's own token is never a target.
    expect(document.querySelector(`[data-token-id="${LYRA}"]`)!.getAttribute("aria-label")).not.toContain("target");
    act(() => clearTargeting());
  });
});
