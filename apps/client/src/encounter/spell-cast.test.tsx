import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActorDefinition, GmActor } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { SheetSpells } from "./SheetSpells";
import type { SheetEdit } from "./useSheetEdit";
import type { SheetRolls } from "./useSheetRolls";

/** A Ranger with Hunter's Mark (slot, or free twice a day, one spent) and an at-will Jump from an invocation. */
const definition = {
  name: "Ash",
  abilityScores: { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 10 },
  proficiencyBonus: 2,
  actions: [
    {
      id: "spell-hunters-mark",
      name: "Hunter's Mark",
      activation: "bonus-action",
      description: "",
      damage: [],
      spellSlot: { level: 1 }
    },
    {
      id: "spell-hunters-mark-free",
      name: "Hunter's Mark (no slot)",
      activation: "bonus-action",
      description: "",
      damage: [],
      uses: { limit: 2, per: "long-rest", pool: "favored-enemy" }
    },
    { id: "spell-jump-free", name: "Jump (no slot)", activation: "action", description: "", damage: [] }
  ],
  spellcasting: {
    ability: "wis",
    slots: [{ level: 1, max: 2 }],
    spells: [
      {
        id: "hunters-mark",
        name: "Hunter's Mark",
        level: 1,
        prepared: true,
        alwaysPrepared: true,
        actionId: "spell-hunters-mark",
        freeActionId: "spell-hunters-mark-free"
      },
      {
        id: "jump",
        name: "Jump",
        level: 1,
        prepared: true,
        alwaysPrepared: true,
        withSlot: false,
        freeActionId: "spell-jump-free"
      }
    ]
  }
} as unknown as ActorDefinition;

const actor = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "player-character",
  spellSlots: [{ level: 1, remaining: 2 }],
  preparedSpellIds: [],
  actionUses: { "favored-enemy": 1 }
} as unknown as GmActor;

const mount = () => {
  const castSpellAction = vi.fn();
  render(
    <SheetSpells
      actor={actor}
      definition={definition}
      busy={false}
      edit={vi.fn() as unknown as SheetEdit}
      rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
      onFeedback={() => {}}
      routeSpell={() => false}
      castSpellAction={castSpellAction}
    />
  );
  return castSpellAction;
};

describe("casting a leveled spell from the sheet", () => {
  it("casts through its action with the chosen slot, or without one through the grant's free casting", () => {
    const cast = mount();
    const casts = screen.getAllByRole("button", { name: "Cast" });
    fireEvent.click(casts[0]);
    expect(cast).toHaveBeenLastCalledWith("spell-hunters-mark", 1);

    const select = screen.getByRole("combobox", { name: "Cast Hunter's Mark at level" });
    expect(screen.getByRole("option", { name: "No slot · 1 left" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "free" } });
    fireEvent.click(casts[0]);
    expect(cast).toHaveBeenLastCalledWith("spell-hunters-mark-free");
  });

  it("offers an invocation's spell only at will, without a slot", () => {
    const cast = mount();
    expect(screen.getByText("At will")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cast" })[1]);
    expect(cast).toHaveBeenLastCalledWith("spell-jump-free");
  });
});
