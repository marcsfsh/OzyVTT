import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActorDefinition, GmActor, Rechoice } from "@vtt/domain";

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

  it("names the spell slot a sheet without the spell's action spends, in SRD terms", async () => {
    const onFeedback = vi.fn();
    const sheet = {
      ...definition,
      actions: [],
      spellcasting: {
        ability: "wis",
        slots: [{ level: 1, max: 2 }],
        spells: [{ id: "detect-magic", name: "Detect Magic", level: 1, prepared: true, alwaysPrepared: true }]
      }
    } as unknown as ActorDefinition;
    render(
      <SheetSpells
        actor={actor}
        definition={sheet}
        busy={false}
        edit={vi.fn(async () => ({ ok: true })) as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={onFeedback}
        routeSpell={() => false}
        castSpellAction={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cast" }));
    await vi.waitFor(() => expect(onFeedback).toHaveBeenLastCalledWith("Cast Detect Magic with a level 1 spell slot."));
  });

  it("casts past an empty slot when the table doesn't police spell slots, and not when it does", () => {
    const spent = { ...actor, spellSlots: [{ level: 1, remaining: 0 }] } as unknown as GmActor;
    const cast = vi.fn();
    const props = {
      definition,
      busy: false,
      edit: vi.fn() as unknown as SheetEdit,
      rolls: { rollFlat: vi.fn() } as unknown as SheetRolls,
      onFeedback: () => {},
      routeSpell: () => false,
      castSpellAction: cast
    };
    const { unmount } = render(<SheetSpells actor={spent} {...props} />);
    expect((screen.getAllByRole("button", { name: "Cast" })[0] as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<SheetSpells actor={spent} {...props} policeSlots={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Cast" })[0]);
    expect(cast).toHaveBeenLastCalledWith("spell-hunters-mark", 1);
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
    expect(screen.getAllByRole("option", { name: "Level 3 · 1/2 · pact · upcast" }).length).toBe(2);
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

describe("the prepare step after a Long Rest", () => {
  const cleric = {
    ...definition,
    actions: [],
    spellcasting: {
      ability: "wis",
      slots: [{ level: 1, max: 2 }],
      classes: [{ classId: "cleric", ability: "wis", prepared: 1 }],
      spells: [{ id: "bless", name: "Bless", level: 1, prepared: true, alwaysPrepared: false, classId: "cleric" }]
    }
  } as unknown as ActorDefinition;
  const mountCleric = (preparation: { changesLeft: number | null } | null, canPrepare: boolean) => {
    const edit = vi.fn(() => Promise.resolve({ ok: true }));
    render(
      <SheetSpells
        actor={{ ...actor, preparedSpellIds: [], preparation } as unknown as GmActor}
        definition={cleric}
        busy={false}
        edit={edit as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={() => {}}
        routeSpell={() => false}
        castSpellAction={vi.fn()}
        canPrepare={canPrepare}
      />
    );
    return edit;
  };

  it("offers the step and its Done, with the prepare toggles live", () => {
    const edit = mountCleric({ changesLeft: null }, true);
    expect(screen.getByText("After the Long Rest you can change your prepared spells.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Prepare" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(edit).toHaveBeenLastCalledWith("character:finish-preparing", { actorId: actor.id });
  });

  it("holds the toggles, and won't cast an unprepared spell, outside the step", () => {
    mountCleric(null, false);
    expect((screen.getByRole("button", { name: "Prepare" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cast" }) as HTMLButtonElement).disabled).toBe(true);
  });

  // SRD Circle of the Land Spells: "Whenever you finish a Long Rest, choose one type of land".
  const land: Rechoice = {
    offer: "feature:circle-of-the-land-spells",
    label: "Circle of the Land Spells",
    per: "long-rest",
    options: [
      { id: "arid", name: "Arid Land" },
      { id: "polar", name: "Polar Land" }
    ],
    chosen: "polar"
  };
  const mountDruid = (canPrepare: boolean) => {
    const edit = vi.fn(() => Promise.resolve({ ok: true }));
    const onFeedback = vi.fn();
    render(
      <SheetSpells
        actor={
          {
            ...actor,
            preparedSpellIds: [],
            preparation: canPrepare ? { changesLeft: null } : null
          } as unknown as GmActor
        }
        definition={cleric}
        busy={false}
        edit={edit as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={onFeedback}
        routeSpell={() => false}
        castSpellAction={vi.fn()}
        canPrepare={canPrepare}
        rechoices={[land]}
      />
    );
    return { edit, onFeedback };
  };

  it("chooses a Land Druid's land in the step, which the server makes into the land's spells", async () => {
    const { edit, onFeedback } = mountDruid(true);
    const picker = screen.getByRole("combobox", { name: "Circle of the Land Spells" }) as HTMLSelectElement;
    expect(picker.value).toBe("polar");
    fireEvent.change(picker, { target: { value: "arid" } });
    expect(edit).toHaveBeenLastCalledWith("actor:rechoose", {
      actorId: actor.id,
      offer: "feature:circle-of-the-land-spells",
      id: "arid"
    });
    await vi.waitFor(() => expect(onFeedback).toHaveBeenLastCalledWith("Circle of the Land Spells: Arid Land."));
  });

  it("keeps the land fixed outside the step", () => {
    mountDruid(false);
    expect(screen.queryByRole("combobox", { name: "Circle of the Land Spells" })).toBeNull();
  });
});

describe("a ritual spell on the sheet", () => {
  it("can be cast as a Ritual, through its own action with no slot", () => {
    const cast = vi.fn();
    const wizardSheet = {
      ...definition,
      actions: [
        {
          id: "spell-alarm",
          name: "Alarm",
          activation: "action",
          description: "",
          damage: [],
          spellSlot: { level: 1 }
        },
        { id: "spell-alarm-ritual", name: "Alarm (ritual)", activation: "action", description: "", damage: [] }
      ],
      spellcasting: {
        ability: "int",
        slots: [{ level: 1, max: 2 }],
        spells: [
          {
            id: "alarm",
            name: "Alarm",
            level: 1,
            prepared: true,
            alwaysPrepared: false,
            actionId: "spell-alarm",
            ritualActionId: "spell-alarm-ritual"
          }
        ]
      }
    } as unknown as ActorDefinition;
    render(
      <SheetSpells
        actor={{ ...actor, preparedSpellIds: ["alarm"] } as unknown as GmActor}
        definition={wizardSheet}
        busy={false}
        edit={vi.fn() as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={() => {}}
        routeSpell={() => false}
        castSpellAction={cast}
      />
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Cast Alarm at level" }), { target: { value: "ritual" } });
    fireEvent.click(screen.getByRole("button", { name: "Cast" }));
    expect(cast).toHaveBeenLastCalledWith("spell-alarm-ritual");
  });
});
