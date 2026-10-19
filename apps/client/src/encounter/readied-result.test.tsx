import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ActionResolution, ActorDefinition } from "@vtt/domain";

vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: vi.fn(async () => ({ ok: true, actions: [] }))
}));

import { PlayerActionRunner } from "./PlayerActionRunner";
import { setTargetingResult } from "./targeting";

// A readied spell is released off its caster's turn, which ends the Ready. Its result stays on the sheet until the
// player closes it; a result from the character's own turn goes when the turn moves on.

const ME = "10000000-0000-4000-8000-0000000000c1";
const MAGE = {
  name: "Ansel",
  actions: [
    {
      id: "dagger",
      name: "Dagger",
      activation: "action",
      description: "Melee weapon attack.",
      attack: { bonus: 4, reachFeet: 5 },
      damage: [{ formula: "1d4 + 2", type: "piercing" }]
    }
  ]
} as unknown as ActorDefinition;
const RESULT = { actionName: "Fire Bolt", rolls: [], damage: [], effects: [] } as unknown as ActionResolution;

const runner = (myTurn: boolean, offTurn: boolean) => (
  <PlayerActionRunner
    actorId={ME}
    definition={MAGE}
    revision={1}
    playerDamageMode="proposal"
    targets={[]}
    myTurn={myTurn}
    offTurn={offTurn}
  />
);

describe("a result got off the character's turn", () => {
  it("stays after a readied spell is released, until the player closes it", () => {
    const { rerender } = render(runner(true, true));
    act(() => setTargetingResult(RESULT));
    expect(screen.getByText("Fire Bolt")).toBeTruthy();
    rerender(runner(false, false));
    expect(screen.getByText("Fire Bolt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss result" }));
    expect(screen.queryByText("Fire Bolt")).toBeNull();
  });

  it("goes when the character's own turn moves on", () => {
    const { rerender } = render(runner(true, false));
    act(() => setTargetingResult(RESULT));
    expect(screen.getByText("Fire Bolt")).toBeTruthy();
    rerender(runner(false, false));
    expect(screen.queryByText("Fire Bolt")).toBeNull();
  });
});
