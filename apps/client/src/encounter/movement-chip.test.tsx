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

import { useState } from "react";
import type { CostTab } from "../sheet/turn-options";
import { PlayerCostTabs, usePlayerEconomy } from "./PlayerEncounterPanel";

/** The cost tabs as the panel wires them, with their own chosen tab. */
function PlayerTurnEconomy(props: Parameters<typeof usePlayerEconomy>[0] & { myId: string }) {
  const economy = usePlayerEconomy(props);
  const [tab, setTab] = useState<CostTab>(props.myTurn ? "action" : "reaction");
  return <PlayerCostTabs myId={props.myId} economy={economy} tab={tab} onTab={setTab} />;
}

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
    render(<PlayerTurnEconomy combat={combat as never} myId={ME} myTurn mySpeedFeet={30} revision={7} />);
    expect(await screen.findByRole("button", { name: "Move, 50 feet left" })).toBeDefined();
    expect(read).toHaveBeenCalledWith("actor:movement", { actorId: ME });
  });
});
