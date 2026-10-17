import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlayerCombatView } from "@vtt/domain";

const read = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  counted: true,
  speedFeet: 60,
  usedFeet: 10,
  enforcement: "strict"
}));
vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: (...args: unknown[]) => read(...args)
}));

import { PlayerTurnEconomy } from "./PlayerEncounterPanel";

const ME = "10000000-0000-4000-8000-000000000001";

const combat = {
  active: true,
  turnActorId: ME,
  turn: {
    actionUsed: true,
    bonusActionUsed: false,
    actionInstance: null,
    bonusActionInstance: null,
    turnUses: {},
    movementUsedFeet: 10
  },
  rulesMode: "strict",
  ruleExceptions: {},
  reactionsUsed: []
} as unknown as PlayerCombatView;

describe("a player's movement on their turn", () => {
  it("counts against this turn's movement, a Dash included, not the walking speed", async () => {
    render(<PlayerTurnEconomy combat={combat} myId={ME} myTurn mySpeedFeet={30} revision={7} />);
    expect(await screen.findByText("Move 10/60 ft")).toBeDefined();
    expect(read).toHaveBeenCalledWith("actor:movement", { actorId: ME });
  });
});
