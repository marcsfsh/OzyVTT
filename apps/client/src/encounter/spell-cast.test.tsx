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

describe("a Warlock's Pact Magic on the sheet", () => {
  /** Warlock 5: two 3rd-level pact slots, one spent; Hex from the builder, Hold Person from a PDF (no action). */
  const warlock = {
    ...definition,
    actions: [
      {
        id: "spell-hex",
        name: "Hex",
        activation: "bonus-action",
        description: "",
        damage: [],
        spellSlot: { level: 1 }
      }
    ],
    spellcasting: {
      ability: "cha",
      slots: [],
      pact: { level: 3, max: 2 },
      spells: [
        { id: "hex", name: "Hex", level: 1, prepared: true, alwaysPrepared: false, actionId: "spell-hex" },
        { id: "hold-person", name: "Hold Person", level: 2, prepared: true, alwaysPrepared: false }
      ]
    }
  } as unknown as ActorDefinition;
  const vex = { ...actor, spellSlots: [], pactSlots: { level: 3, remaining: 1 } } as unknown as GmActor;

  const mountWarlock = () => {
    const castSpellAction = vi.fn();
    const edit = vi.fn(() => Promise.resolve({ ok: false }));
    render(
      <SheetSpells
        actor={vex}
        definition={warlock}
        busy={false}
        edit={edit as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={() => {}}
        routeSpell={() => false}
        castSpellAction={castSpellAction}
      />
    );
    return { castSpellAction, edit };
  };

  it("shows the pact slots as pips, spent and restored in their own pool", () => {
    const { edit } = mountWarlock();
    expect(screen.getByRole("group", { name: "Pact Magic slots (1 of 2 left)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Spend a Pact Magic slot" }));
    expect(edit).toHaveBeenLastCalledWith("character:set-slot", {
      actorId: vex.id,
      level: 3,
      remaining: 0,
      pact: true
    });
  });

  it("casts a spell with a pact slot at the pact level, through its action or from the pool", () => {
    const { castSpellAction, edit } = mountWarlock();
    expect(screen.getAllByRole("option", { name: "3rd · 1/2 · pact · upcast" }).length).toBe(2);
    const casts = screen.getAllByRole("button", { name: "Cast" });
    fireEvent.click(casts[0]);
    expect(castSpellAction).toHaveBeenLastCalledWith("spell-hex", 3);
    fireEvent.click(casts[1]);
    expect(edit).toHaveBeenLastCalledWith("character:set-slot", {
      actorId: vex.id,
      level: 3,
      remaining: 0,
      pact: true
    });
  });
});
