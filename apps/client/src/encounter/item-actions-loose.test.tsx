import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActorDefinition, ContentActionSummary, GmActor } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { SheetActions } from "./SheetActions";
import type { SheetRolls } from "./useSheetRolls";

const definition = {
  name: "Pip",
  abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 12, cha: 10 },
  proficiencyBonus: 2,
  actions: []
} as unknown as ActorDefinition;
const rolls = { rolling: false, rollD20: vi.fn(), rollFlat: vi.fn() } as unknown as SheetRolls;

/** A Gem of Seeing with one of its three charges spent, and the Iron Bands' throw. */
const PEER = {
  id: "item-gem-of-seeing-peer",
  name: "Peer",
  activation: "action",
  description: "Gain Truesight for 10 minutes.",
  attackBonus: null,
  damage: [],
  usesLimit: 3,
  usesPer: "long-rest",
  usesPool: "gem-of-seeing-charges"
} as unknown as ContentActionSummary;
const THROW = {
  ...PEER,
  id: "item-iron-bands-throw",
  name: "Throw the Bands",
  description: "Ranged attack.",
  attackBonus: 5,
  usesLimit: 1,
  usesPool: "iron-bands-charges"
} as unknown as ContentActionSummary;
const actor = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "player-character",
  inventory: [],
  actionUses: { "gem-of-seeing-charges": 1, "iron-bands-charges": 1 }
} as unknown as GmActor;

const mount = (onLooseUse: ((actionId: string) => void) | null) =>
  render(
    <SheetActions
      actor={actor}
      definition={definition}
      serverActions={[PEER, THROW]}
      rolls={rolls}
      structuredAttacks={false}
      inline={null}
      runnerRef={createRef()}
      routeAttack={vi.fn()}
      structuredActionFor={() => null}
      onLooseUse={onLooseUse}
    />
  );

describe("an item's actions outside the fight", () => {
  it("are used through the server, which spends the charge, and say how many are left", () => {
    const onLooseUse = vi.fn();
    mount(onLooseUse);
    expect(screen.getByText(/2 of 3 charges left per Long Rest/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(onLooseUse).toHaveBeenCalledWith("item-gem-of-seeing-peer");
    // The bands' only charge is spent, so their throw waits for a rest.
    expect((screen.getByRole("button", { name: "+5 to hit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offer no Use button inside the fight, where the turn's own flow resolves them", () => {
    mount(null);
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
  });
});
