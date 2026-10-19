import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ActorDefinition, GmActor, Rechoice } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { SpellsTab } from "./SpellsTab";
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
    <SpellsTab
      actor={actor}
      definition={definition}
      role="player"
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
    fireEvent.click(screen.getByRole("button", { name: "Cast Hunter's Mark" }));
    // The cast detail: each way to cast it, with what is left.
    const detail = within(screen.getByRole("region", { name: "Cast Hunter's Mark" }));
    expect(detail.getByRole("button", { name: /Level 1.*2 of 2 left/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(detail.getByRole("button", { name: "Cast at level 1" }));
    expect(cast).toHaveBeenLastCalledWith("spell-hunters-mark", 1);

    fireEvent.click(screen.getByRole("button", { name: "Cast Hunter's Mark" }));
    fireEvent.click(screen.getByRole("button", { name: /Without a slot.*1 free cast left/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cast without a slot" }));
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
      <SpellsTab
        actor={actor}
        definition={sheet}
        role="player"
        busy={false}
        edit={vi.fn(async () => ({ ok: true })) as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={onFeedback}
        routeSpell={() => false}
        castSpellAction={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cast Detect Magic" }));
    fireEvent.click(screen.getByRole("button", { name: "Cast at level 1" }));
    await vi.waitFor(() => expect(onFeedback).toHaveBeenLastCalledWith("Cast Detect Magic with a level 1 spell slot."));
  });

  it("casts past an empty slot when the table doesn't police spell slots, and not when it does", () => {
    const spent = { ...actor, spellSlots: [{ level: 1, remaining: 0 }] } as unknown as GmActor;
    const cast = vi.fn();
    const props = {
      definition,
      role: "player" as const,
      busy: false,
      edit: vi.fn() as unknown as SheetEdit,
      rolls: { rollFlat: vi.fn() } as unknown as SheetRolls,
      onFeedback: () => {},
      routeSpell: () => false,
      castSpellAction: cast
    };
    const { unmount } = render(<SpellsTab actor={spent} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cast Hunter's Mark" }));
    // The empty level says why it can't be chosen; the free cast is what the primary offers.
    const level = screen.getByRole("button", { name: /Level 1/ }) as HTMLButtonElement;
    expect(level.disabled).toBe(true);
    expect(level.textContent).toContain("No level 1 spell slots left.");
    expect(screen.getByRole("button", { name: "Cast without a slot" })).toBeTruthy();
    unmount();
    render(<SpellsTab actor={spent} {...props} policeSlots={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Cast Hunter's Mark" }));
    fireEvent.click(screen.getByRole("button", { name: "Cast at level 1" }));
    expect(cast).toHaveBeenLastCalledWith("spell-hunters-mark", 1);
  });

  it("offers an invocation's spell only at will, without a slot, in one tap", () => {
    const cast = mount();
    expect(screen.getByText("At will")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cast Jump" }));
    expect(cast).toHaveBeenLastCalledWith("spell-jump-free");
  });
});

describe("a Warlock's Pact Magic on the sheet", () => {
  /** Warlock 5: two level 3 Pact Magic slots, one spent; Hex from the builder, Hold Person from a PDF (no action). */
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
      <SpellsTab
        actor={vex}
        definition={warlock}
        role="player"
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

  it("gives a player no pip that restores a slot, and gives the GM one", () => {
    mountWarlock();
    expect(screen.queryByRole("button", { name: "Restore a Pact Magic slot" })).toBeNull();
    render(
      <SpellsTab
        actor={vex}
        definition={warlock}
        role="gm"
        busy={false}
        edit={vi.fn() as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={() => {}}
        routeSpell={() => false}
        castSpellAction={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Restore a Pact Magic slot" })).toBeTruthy();
  });

  it("casts a spell with a pact slot at the pact level, through its action or from the pool", () => {
    const { castSpellAction, edit } = mountWarlock();
    fireEvent.click(screen.getByRole("button", { name: "Cast Hex" }));
    expect(screen.getByRole("button", { name: /Level 3.*1 of 2 left · Pact Magic/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cast at level 3" }));
    expect(castSpellAction).toHaveBeenLastCalledWith("spell-hex", 3);
    fireEvent.click(screen.getByRole("button", { name: "Cast Hold Person" }));
    fireEvent.click(screen.getByRole("button", { name: "Cast at level 3" }));
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
      <SpellsTab
        actor={{ ...actor, preparedSpellIds: [], preparation } as unknown as GmActor}
        definition={cleric}
        role="player"
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

  it("offers the step and its Done, with the prepare toggles live and the count of the cap", () => {
    const edit = mountCleric({ changesLeft: null }, true);
    const step = within(screen.getByRole("group", { name: "Change prepared spells" }));
    expect(step.getByText(/The Long Rest opened this step\. 0 of 1 are prepared/)).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Prepare Bless" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(edit).toHaveBeenLastCalledWith("character:set-prepared", {
      actorId: actor.id,
      spellId: "bless",
      prepared: true
    });
    fireEvent.click(step.getByRole("button", { name: "Done" }));
    expect(edit).toHaveBeenLastCalledWith("character:finish-preparing", { actorId: actor.id });
  });

  it("holds the toggles, and won't cast an unprepared spell, outside the step", () => {
    mountCleric(null, false);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.queryByRole("button", { name: "Prepare Bless" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cast Bless" })).toBeNull();
    expect(screen.getByText("Not prepared")).toBeTruthy();
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
      <SpellsTab
        actor={
          {
            ...actor,
            preparedSpellIds: [],
            preparation: canPrepare ? { changesLeft: null } : null
          } as unknown as GmActor
        }
        definition={cleric}
        role="player"
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
      <SpellsTab
        actor={{ ...actor, preparedSpellIds: ["alarm"] } as unknown as GmActor}
        definition={wizardSheet}
        role="player"
        busy={false}
        edit={vi.fn() as unknown as SheetEdit}
        rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
        onFeedback={() => {}}
        routeSpell={() => false}
        castSpellAction={cast}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cast Alarm" }));
    fireEvent.click(screen.getByRole("button", { name: /As a Ritual/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cast as a Ritual" }));
    expect(cast).toHaveBeenLastCalledWith("spell-alarm-ritual");
  });
});
