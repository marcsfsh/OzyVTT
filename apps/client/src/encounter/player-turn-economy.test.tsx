import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PlayerCombatView } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { PlayerTurnEconomy } from "./PlayerEncounterPanel";

const ME = "10000000-0000-4000-8000-000000000001";

/** A fight on the player's turn with the action and Reaction spent. */
function combat(rulesMode: PlayerCombatView["rulesMode"]): PlayerCombatView {
  return {
    active: true,
    round: 1,
    turnActorId: ME,
    mapAssetId: null,
    hiddenTurn: false,
    initiative: [],
    tokens: [],
    annotations: [],
    turn: {
      actionUsed: true,
      bonusActionUsed: false,
      actionInstance: null,
      bonusActionInstance: null,
      turnUses: {},
      movementUsedFeet: 0
    },
    rulesMode,
    ruleExceptions: {},
    playerDamageMode: "proposal",
    pendingInitiative: [],
    playerInitiativeMode: "immediate",
    underwater: false,
    reactionsUsed: [ME],
    fog: { enabled: false, shapes: [] },
    terrain: { difficult: [] },
    vision: { enabled: false },
    pendingSaves: [],
    pendingReactions: [],
    pendingRuleAsks: [],
    rewound: false
  };
}

describe("a player's turn resources", () => {
  it("lock a spent action and Reaction while the table polices the action economy", () => {
    render(<PlayerTurnEconomy combat={combat("strict")} myId={ME} myTurn />);
    const action = screen.getByRole("button", { name: "Action" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(action.title).toBe("Spent. Only the GM can give it back.");
    expect((screen.getByRole("button", { name: "Reaction" }) as HTMLButtonElement).disabled).toBe(true);
    // An unspent slot can still be marked.
    expect((screen.getByRole("button", { name: "Bonus" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("leave them free when the GM has turned the economy off", () => {
    render(<PlayerTurnEconomy combat={combat("freeform")} myId={ME} myTurn />);
    expect((screen.getByRole("button", { name: "Action" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Reaction" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
