import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActorDefinition, ContentActionSummary, ContentSpellSummary, GmActor, SpellChoices } from "@vtt/domain";

vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

const spell = (id: string, name: string, level: number, school = "abjuration") =>
  ({
    id,
    name,
    level,
    school,
    classes: [],
    castingOptions: [],
    cantripScaling: [],
    damageTypes: []
  }) as unknown as ContentSpellSummary;
const SPELLS = [
  spell("bless", "Bless", 1),
  spell("cure-wounds", "Cure Wounds", 1),
  spell("shield-of-faith", "Shield of Faith", 1),
  spell("spiritual-weapon", "Spiritual Weapon", 2),
  spell("magic-missile", "Magic Missile", 1),
  spell("web", "Web", 2),
  spell("misty-step", "Misty Step", 2, "conjuration"),
  spell("fireball", "Fireball", 3, "evocation"),
  { ...spell("detect-magic", "Detect Magic", 1), ritual: true } as ContentSpellSummary
];
vi.mock("../encounter/spells", async (original) => ({
  ...(await original<typeof import("../encounter/spells")>()),
  useSpellReference: () => SPELLS
}));

import { SpellsTab } from "./SpellsTab";
import type { SheetEdit } from "./useSheetEdit";
import type { SheetRolls } from "./useSheetRolls";

// After a Long Rest a prepared caster swaps another spell of its class onto its list (a Wizard from its spellbook),
// and a Wizard adds spells to the book: free from its levels, or copied from a scroll or another book.

const ME = "10000000-0000-4000-8000-000000000001";

const caster = (spells: ReadonlyArray<readonly [string, string, number, string]>) =>
  ({
    name: "Mira",
    abilityScores: { str: 10, dex: 12, con: 12, int: 16, wis: 16, cha: 10 },
    proficiencyBonus: 2,
    actions: [],
    spellcasting: {
      ability: "wis",
      slots: [
        { level: 1, max: 4 },
        { level: 2, max: 2 }
      ],
      classes: [{ classId: spells[0]![3], ability: "wis", prepared: spells.length }],
      spells: spells.map(([id, name, level, classId]) => ({
        id,
        name,
        level,
        classId,
        prepared: true,
        alwaysPrepared: false
      }))
    }
  }) as unknown as ActorDefinition;

const mount = (
  definition: ActorDefinition,
  choices: SpellChoices,
  extra: Partial<{
    canPrepare: boolean;
    gm: boolean;
    actor: Record<string, unknown>;
    serverActions: ContentActionSummary[];
    cast: (actionId: string) => void;
  }> = {}
) => {
  const edit = vi.fn(async () => ({ ok: true, inBook: true }));
  render(
    <SpellsTab
      actor={
        {
          id: ME,
          name: "Mira",
          kind: "player-character",
          spellSlots: [],
          preparedSpellIds: ["cure-wounds"],
          inventory: [],
          // The step a Long Rest opens, where the list may change.
          preparation: extra.canPrepare === false ? null : { changesLeft: null },
          ...extra.actor
        } as unknown as GmActor
      }
      definition={definition}
      role={extra.gm ? "gm" : "player"}
      busy={false}
      edit={edit as unknown as SheetEdit}
      rolls={{ rollFlat: vi.fn() } as unknown as SheetRolls}
      onFeedback={() => {}}
      routeSpell={() => false}
      castSpellAction={extra.cast ?? vi.fn()}
      serverActions={extra.serverActions ?? []}
      canPrepare={extra.canPrepare ?? true}
      spellChoices={choices}
    />
  );
  return edit;
};

const CLERIC = caster([
  ["bless", "Bless", 1, "cleric"],
  ["cure-wounds", "Cure Wounds", 1, "cleric"]
]);
const CLERIC_CHOICES: SpellChoices = {
  swaps: [
    {
      classId: "cleric",
      className: "Cleric",
      replaces: ["bless", "cure-wounds"],
      spellIds: ["shield-of-faith", "spiritual-weapon"]
    }
  ],
  spellbook: null
};

describe("swapping a spell in after a Long Rest", () => {
  it("picks a Cleric spell, then the spell it replaces, unprepared ones first", async () => {
    const user = userEvent.setup();
    const edit = mount(CLERIC, CLERIC_CHOICES);
    await user.click(screen.getByRole("button", { name: "Swap in a spell" }));
    await user.click(screen.getByRole("button", { name: /Shield of Faith/ }));
    const dialog = within(screen.getByRole("dialog", { name: "Prepare Shield of Faith in place of another spell" }));
    const replaced = dialog.getByRole("group", { name: "The spell it replaces" });
    expect(
      within(replaced)
        .getAllByRole("button")
        .map((chip) => chip.textContent)
    ).toEqual(["Bless · not prepared", "Cure Wounds"]);
    expect(within(replaced).getByRole("button", { name: "Bless · not prepared" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    await user.click(within(replaced).getByRole("button", { name: "Cure Wounds" }));
    await user.click(dialog.getByRole("button", { name: "Swap" }));
    expect(edit).toHaveBeenCalledWith("character:swap-spell", {
      actorId: ME,
      spellId: "shield-of-faith",
      replaces: "cure-wounds"
    });
  });

  it("is offered only while the list may change", () => {
    mount(CLERIC, CLERIC_CHOICES, { canPrepare: false });
    expect(screen.queryByRole("button", { name: "Swap in a spell" })).toBeNull();
  });
});

const WIZARD = caster([
  ["magic-missile", "Magic Missile", 1, "wizard"],
  ["spiritual-weapon", "Spiritual Weapon", 2, "wizard"]
]);
const WIZARD_CHOICES: SpellChoices = {
  swaps: [{ classId: "wizard", className: "Wizard", replaces: ["magic-missile"], spellIds: ["web"] }],
  spellbook: {
    spellIds: ["magic-missile", "spiritual-weapon", "web"],
    freeLeft: 2,
    freeOfSchool: null,
    maxLevel: 2,
    addable: ["misty-step"]
  }
};

describe("a Wizard's spellbook", () => {
  it("casts a ritual from the book as a Ritual when the server lists that cast (Ritual Adept)", async () => {
    const user = userEvent.setup();
    const cast = vi.fn();
    const ritual = { id: "spell-detect-magic-ritual", name: "Detect Magic (ritual)" } as ContentActionSummary;
    mount(
      WIZARD,
      { ...WIZARD_CHOICES, spellbook: { ...WIZARD_CHOICES.spellbook!, spellIds: ["magic-missile", "detect-magic"] } },
      { canPrepare: false, serverActions: [ritual], cast }
    );
    await user.click(screen.getByRole("button", { name: "Spellbook" }));
    await user.click(screen.getByRole("button", { name: "Cast Detect Magic as a Ritual" }));
    expect(cast).toHaveBeenCalledWith("spell-detect-magic-ritual");
  });

  it("lists what is in the book beyond the sheet, and adds one of the levels' spells free", async () => {
    const user = userEvent.setup();
    const edit = mount(WIZARD, WIZARD_CHOICES);
    // The spellbook view lists a spell only in the book, which waits there.
    await user.click(screen.getByRole("button", { name: "Spellbook" }));
    const web = screen.getByText("Web").closest("li")!;
    expect(web.textContent).toContain("In the book");
    const book = screen.getByRole("group", { name: "Spellbook" });
    await user.click(within(book).getByRole("button", { name: "Add from your levels (2)" }));
    await user.click(screen.getByRole("button", { name: /Misty Step/ }));
    expect(screen.getByText(/It costs nothing\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add Misty Step" }));
    expect(edit).toHaveBeenCalledWith("character:add-to-spellbook", {
      actorId: ME,
      spellId: "misty-step",
      from: "level"
    });
  });

  // SRD Evocation Savant: "whenever you gain access to a new level of spell slots in this class, you can add one Wizard
  // spell from the Evocation school to your spellbook for free".
  it("adds an Evoker's free Evocation spell once the levels' free spells are spent", async () => {
    const user = userEvent.setup();
    const evoker: SpellChoices = {
      swaps: WIZARD_CHOICES.swaps,
      spellbook: {
        ...WIZARD_CHOICES.spellbook!,
        freeLeft: 0,
        freeOfSchool: { school: "evocation", left: 1 },
        maxLevel: 3,
        addable: ["misty-step", "fireball"]
      }
    };
    const edit = mount(WIZARD, evoker);
    await user.click(screen.getByRole("button", { name: "Spellbook" }));
    const book = screen.getByRole("group", { name: "Spellbook" });
    await user.click(within(book).getByRole("button", { name: "Add from your levels (1)" }));
    expect(screen.getByText(/1 more Evocation spell free\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Misty Step/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Fireball/ }));
    await user.click(screen.getByRole("button", { name: "Add Fireball" }));
    expect(edit).toHaveBeenCalledWith("character:add-to-spellbook", {
      actorId: ME,
      spellId: "fireball",
      from: "level"
    });
  });

  it("copies from a scroll in the pack, saying what it costs; only the GM copies from another book", async () => {
    const user = userEvent.setup();
    const scroll = { id: "spell-scroll", name: "Spell Scroll", quantity: 1, spellId: "misty-step" };
    const edit = mount(WIZARD, WIZARD_CHOICES, { actor: { inventory: [scroll] } });
    await user.click(screen.getByRole("button", { name: "Copy a spell" }));
    expect(screen.queryByText("From another spellbook")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Misty Step/ }));
    expect(
      screen.getByText(
        "From the Spell Scroll in the pack. Copying takes 4 hours and 100 GP. Mira makes a DC 12 Intelligence (Arcana) check, and the scroll is used up whether it succeeds or not."
      )
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Copy Misty Step" }));
    expect(edit).toHaveBeenCalledWith("character:add-to-spellbook", {
      actorId: ME,
      spellId: "misty-step",
      from: "scroll",
      itemId: "spell-scroll"
    });
  });

  it("lets the GM copy from another spellbook", async () => {
    const user = userEvent.setup();
    const edit = mount(WIZARD, WIZARD_CHOICES, { gm: true });
    await user.click(screen.getByRole("button", { name: "Copy a spell" }));
    expect(screen.getByText("From another spellbook")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Misty Step/ }));
    await user.click(screen.getByRole("button", { name: "Copy Misty Step" }));
    expect(edit).toHaveBeenCalledWith("character:add-to-spellbook", {
      actorId: ME,
      spellId: "misty-step",
      from: "book"
    });
  });
});
