import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ContentActionSummary, GmActor } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { GearTab } from "./GearTab";
import type { SheetEdit } from "./useSheetEdit";

/** A Gem of Seeing with one of its three charges spent, and the Iron Bands' throw with its one charge spent. */
const PEER = {
  id: "item-gem-of-seeing-peer",
  name: "Peer",
  activation: "action",
  description: "Gain Truesight for 10 minutes.",
  attackBonus: null,
  saveAbility: null,
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
  name: "Pip",
  kind: "player-character",
  inventory: [
    { id: "gem-of-seeing", name: "Gem of Seeing", quantity: 1, equipped: true, attuned: true },
    { id: "iron-bands", name: "Iron Bands", quantity: 1, equipped: true, attuned: false }
  ],
  actionUses: { "gem-of-seeing-charges": 1, "iron-bands-charges": 1 }
} as unknown as GmActor;

/** An item's row: its name, a tap from its detail (the name also reads in the attunement line). */
const rowOf = (name: string) =>
  screen
    .getAllByText(name)
    .map((node) => node.closest("button"))
    .find((button): button is HTMLButtonElement => button !== null)!;

const mount = (actionBlocked: string | null = null) => {
  const onUseAction = vi.fn();
  render(
    <GearTab
      actor={actor}
      role="player"
      busy={false}
      edit={vi.fn() as unknown as SheetEdit}
      place={{ kind: "inline" }}
      serverActions={[PEER, THROW]}
      facts={new Map()}
      inFight={actionBlocked !== null}
      actionBlocked={actionBlocked}
      onUseAction={onUseAction}
    />
  );
  return onUseAction;
};

describe("an item's own actions", () => {
  it("show its charges as boxes, and its detail's primary uses it through the server", () => {
    const onUseAction = mount();
    const gem = rowOf("Gem of Seeing");
    expect(within(gem).getByRole("img", { name: "2 of 3 charges left" })).toBeTruthy();
    fireEvent.click(gem);
    const detail = within(screen.getByRole("region", { name: "Gem of Seeing" }));
    expect(detail.getByText("2 of 3 charges left · Back on a Long Rest")).toBeTruthy();
    fireEvent.click(detail.getByRole("button", { name: "Peer" }));
    expect(onUseAction).toHaveBeenCalledWith(PEER);
  });

  it("wait for a rest once their charges are spent", () => {
    mount();
    fireEvent.click(rowOf("Iron Bands"));
    expect((screen.getByRole("button", { name: "Throw the Bands" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("No charges left. Back on a Long Rest.")).toBeTruthy();
  });

  it("wait for the character's turn in a fight, and say so", () => {
    const onUseAction = mount("It isn't your turn.");
    fireEvent.click(rowOf("Gem of Seeing"));
    const peer = screen.getByRole("button", { name: "Peer" }) as HTMLButtonElement;
    expect(peer.disabled).toBe(true);
    expect(screen.getByText("It isn't your turn.")).toBeTruthy();
    fireEvent.click(peer);
    expect(onUseAction).not.toHaveBeenCalled();
  });
});

describe("a weapon's row", () => {
  it("names the Weapon Mastery the character applies with it, as the server says", () => {
    const swing = { ...THROW, id: "item-greatsword", name: "Greatsword", usesLimit: null, usesPool: null };
    render(
      <GearTab
        actor={
          {
            ...actor,
            inventory: [{ id: "greatsword", name: "Greatsword", quantity: 1, equipped: true, attuned: false }]
          } as unknown as GmActor
        }
        role="player"
        busy={false}
        edit={vi.fn() as unknown as SheetEdit}
        place={{ kind: "inline" }}
        serverActions={[swing as ContentActionSummary]}
        facts={new Map([["item-greatsword", { available: true, reason: null, passive: null, mastery: "Graze" }]])}
        inFight={false}
        onUseAction={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /^Greatsword · Graze/ })).toBeTruthy();
  });
});
