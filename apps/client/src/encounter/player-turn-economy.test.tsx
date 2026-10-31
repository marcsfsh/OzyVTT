import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { PlayerCombatView } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import type { CostTab } from "../sheet/turn-options";
import { PlayerCostTabs, usePlayerEconomy } from "./PlayerEncounterPanel";

/** The cost tabs as the panel wires them, with their own chosen tab. */
function PlayerTurnEconomy(props: Parameters<typeof usePlayerEconomy>[0] & { myId: string }) {
  const economy = usePlayerEconomy(props);
  const [tab, setTab] = useState<CostTab>(props.myTurn ? "action" : "reaction");
  return <PlayerCostTabs myId={props.myId} economy={economy} tab={tab} onTab={setTab} />;
}

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
    terrain: { difficult: [], water: [], runningWater: [], ice: [] },
    traps: [],
    vision: { enabled: false },
    pendingSaves: [],
    pendingReactions: [],
    pendingRuleAsks: [],
    rewound: false
  };
}

const tab = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const mark = () => screen.getByRole("button", { name: /^Mark (used|ready)$/ }) as HTMLButtonElement;

describe("a player's cost tabs", () => {
  it("lock a spent action and Reaction while the table polices the action economy", () => {
    render(<PlayerTurnEconomy combat={combat("strict")} myId={ME} myTurn />);
    expect(screen.getByRole("button", { name: "Action, used" }).getAttribute("aria-pressed")).toBe("true");
    expect(mark().textContent).toBe("Mark ready");
    expect(mark().disabled).toBe(true);
    expect(mark().title).toBe("Spent. Only the GM can give it back.");
    tab(/^Reaction/);
    expect(mark().disabled).toBe(true);
    // An unspent cost can still be marked.
    tab(/^Bonus Action/);
    expect(mark().textContent).toBe("Mark used");
    expect(mark().disabled).toBe(false);
  });

  it("leave them free when the GM has turned the economy off", () => {
    render(<PlayerTurnEconomy combat={combat("freeform")} myId={ME} myTurn />);
    expect(mark().disabled).toBe(false);
    tab(/^Reaction/);
    expect(mark().disabled).toBe(false);
  });

  it("send the lamps' commands from Mark used and Mark ready", async () => {
    render(<PlayerTurnEconomy combat={combat("freeform")} myId={ME} myTurn />);
    fireEvent.click(mark());
    expect(command).toHaveBeenCalledWith("turn:use", { slot: "action", used: false });
    await waitFor(() => expect(mark().disabled).toBe(false));
    tab(/^Bonus Action/);
    fireEvent.click(mark());
    expect(command).toHaveBeenCalledWith("turn:use", { slot: "bonus-action", used: true });
    await waitFor(() => expect(mark().disabled).toBe(false));
    tab(/^Reaction/);
    fireEvent.click(mark());
    expect(command).toHaveBeenCalledWith("turn:use-reaction", { actorId: ME, used: false });
  });

  it("mark Action and Bonus Action NOT NOW off the player's turn, with the Reaction chosen", () => {
    render(<PlayerTurnEconomy combat={combat("strict")} myId={ME} myTurn={false} />);
    expect(screen.getByRole("button", { name: "Action, not now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bonus Action, not now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reaction, used" }).getAttribute("aria-pressed")).toBe("true");
  });
});
