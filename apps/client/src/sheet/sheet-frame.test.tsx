import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { GmActor, GmView, PlayerActor, PlayerView } from "@vtt/domain";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit`.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { ToastProvider } from "@vtt/ui";
import { CharacterSheet } from "./CharacterSheet";
import { HitPointDice } from "./HitPointDice";

// The sheet's frame: which tabs it shows where, the phone's Hit Points drawer and Level box, the Hit Point Dice per
// die, and the GM's controls in violet with the GM only mark.

const HERO = "10000000-0000-4000-8000-000000000001";
const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const wizard = ActorDefinitionSchema.parse({
  ...fixture,
  character: { ...fixture.character, classes: [{ id: "wizard", name: "Wizard", level: 7, hitDie: "d6" }] },
  spellcasting: {
    ability: "int",
    slots: [{ level: 1, max: 4 }],
    spells: [{ id: "magic-missile", name: "Magic Missile", level: 1, prepared: true, alwaysPrepared: false }]
  }
});

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const sent = (event: string) =>
  emit.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => {
      const { commandId: _commandId, ...payload } = call[1] as Record<string, unknown>;
      return payload;
    });

function hero(over: Record<string, unknown> = {}) {
  return {
    id: HERO,
    name: "Lyra",
    kind: "player-character",
    visibility: "public",
    claimStatus: "mine",
    hp: { kind: "exact", current: 30, maximum: 44, temporary: 0 },
    armorClass: 12,
    conditions: [],
    effects: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    definitionId: "srd:player-character",
    definition: wizard,
    ...over
  } as unknown as PlayerActor;
}
const view = (actor: PlayerActor, builder: "open" | "gm-only" = "open") =>
  ({
    revision: 1,
    actors: [actor],
    rolls: [],
    rollCalls: [],
    builderPolicy: { playerBuilder: builder, playerRandom: "open", maxLevel: 20 },
    rest: { requests: [], shortRest: null },
    combat: { active: false, initiative: [], pendingSaves: [] }
  }) as unknown as PlayerView;

/** The device the sheet is on: a laptop's width matches the sheet's wide query, a phone's doesn't. */
function onLaptop(wide: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: wide && query.includes("min-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  onLaptop(false);
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "character:next-level")
      ack?.({
        ok: true,
        level: 8,
        classId: "wizard",
        className: "Wizard",
        classLevel: 8,
        lines: ["Ability Score Improvement", "A second level 4 spell slot", "Hit Points: 1d6 + 2, or the average of 6"]
      });
    else ack?.({ ok: true });
  });
});
afterEach(() => localStorage.clear());

const tabNames = (name: string) =>
  within(screen.getByRole("tablist", { name }))
    .getAllByRole("tab")
    .map((tab) => tab.textContent);

describe("the sheet's tabs", () => {
  it("puts every tab under a player's thumb, and drops Spells for a character with none", () => {
    const { unmount } = render(
      <CharacterSheet actor={hero()} role="player" state={view(hero())} onClose={() => {}} />,
      {
        wrapper: ToastProvider
      }
    );
    expect(tabNames("Sheet")).toEqual(["Play", "Actions", "Checks", "Spells", "Gear", "Features", "Notes"]);
    unmount();
    const fighter = hero({ definition: { ...wizard, spellcasting: undefined } });
    render(<CharacterSheet actor={fighter} role="player" state={view(fighter)} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    expect(tabNames("Sheet")).toEqual(["Play", "Actions", "Checks", "Gear", "Features", "Notes"]);
  });

  it("swaps Notes for the violet GM tab on the GM's narrow sheet", () => {
    render(<CharacterSheet actor={hero() as unknown as GmActor} role="gm" onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    expect(tabNames("Sheet")).toEqual(["Play", "Actions", "Checks", "Spells", "Gear", "Features", "GM"]);
    expect(screen.getByRole("tab", { name: "GM" }).classList.contains("is-gm")).toBe(true);
  });

  it("remembers the last tab on this device", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CharacterSheet actor={hero()} role="player" state={view(hero())} onClose={() => {}} />,
      {
        wrapper: ToastProvider
      }
    );
    await user.click(screen.getByRole("tab", { name: "Gear" }));
    expect(localStorage.getItem("vtt.sheet.tab.narrow")).toBe("gear");
    unmount();
    render(<CharacterSheet actor={hero()} role="player" state={view(hero())} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    expect(screen.getByRole("tab", { name: "Gear" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the checks in a column of their own on a laptop", () => {
    onLaptop(true);
    render(<CharacterSheet actor={hero()} role="player" state={view(hero())} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    expect(tabNames("Sheet")).toEqual(["Play", "Actions", "Spells", "Gear", "Features", "Notes"]);
    expect(
      within(screen.getByLabelText("Checks")).getByRole("button", { name: /^Roll a Strength check/ })
    ).toBeTruthy();
  });

  it("drops Play from the table's Sheet tab in an encounter, where the Turn tab holds it", () => {
    render(
      <CharacterSheet
        actor={hero()}
        role="player"
        state={view(hero())}
        presentation="panel"
        hidePlay
        onClose={() => {}}
      />,
      { wrapper: ToastProvider }
    );
    expect(tabNames("Sheet")).toEqual(["Checks", "Spells", "Gear", "Features", "Notes"]);
  });
});

describe("Heroic Inspiration", () => {
  const strip = () => within(screen.getAllByRole("group", { name: "Live states" })[0]!);
  const inspired = () => hero({ heroicInspiration: true });

  it("shows once on a phone's Play tab, in the Vitals, and on the strip from another tab", async () => {
    const user = userEvent.setup();
    render(<CharacterSheet actor={inspired()} role="player" state={view(inspired())} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const vitals = within(screen.getByRole("region", { name: "Vitals" }));
    expect(vitals.getByText("Held")).toBeTruthy();
    expect(screen.queryByText("Heroic Inspiration", { selector: ".nh-chip, .nh-chip *" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Notes" }));
    expect(strip().getByText("Heroic Inspiration")).toBeTruthy();
  });

  it("stays off the table's compact row while the Vitals show it", async () => {
    const user = userEvent.setup();
    render(
      <CharacterSheet
        actor={inspired()}
        role="player"
        state={view(inspired())}
        presentation="panel"
        phone
        onClose={() => {}}
      />,
      { wrapper: ToastProvider }
    );
    expect(strip().queryByText("Heroic Inspiration")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Gear" }));
    expect(strip().getByText("Heroic Inspiration")).toBeTruthy();
  });

  it("stays off a laptop's strip, since the band shows it", () => {
    onLaptop(true);
    render(<CharacterSheet actor={inspired()} role="player" state={view(inspired())} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    expect(strip().queryByText("Heroic Inspiration")).toBeNull();
    expect(screen.getByText("Heroic Inspiration", { selector: ".cs-band *" })).toBeTruthy();
  });
});

describe("the phone's header", () => {
  it("opens the Hit Points drawer from its tile", async () => {
    const user = userEvent.setup();
    render(<CharacterSheet actor={hero()} role="player" state={view(hero())} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    // The Play tab's Vitals hold the numbers, so another tab shows the header's tiles.
    await user.click(screen.getByRole("tab", { name: "Notes" }));
    await user.click(
      screen.getByRole("button", { name: "Hit Points 30 of 44. Change Hit Points and see the other vitals" })
    );
    const drawer = within(screen.getByRole("dialog", { name: "Hit Points" }));
    for (const name of ["Damage", "Heal", "Temp"]) expect(drawer.getByRole("button", { name })).toBeTruthy();
    // The vitals the compact header leaves out are here too.
    for (const label of ["Speed", "Init"]) expect(drawer.getByText(label)).toBeTruthy();
    expect(drawer.queryByText("GM only")).toBeNull();
  });

  it("gives the GM's drawer the Set, marked GM only", async () => {
    const user = userEvent.setup();
    render(<CharacterSheet actor={hero() as unknown as GmActor} role="gm" onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    await user.click(
      screen.getByRole("button", { name: "Hit Points 30 of 44. Change Hit Points and see the other vitals" })
    );
    const set = within(
      within(screen.getByRole("dialog", { name: "Hit Points" })).getByRole("group", { name: "Set Hit Points" })
    );
    expect(set.getByText("GM only")).toBeTruthy();
    expect(set.getByRole("button", { name: "Set" })).toBeTruthy();
  });

  it("levels up from the Level box, saying what the level brings", async () => {
    const user = userEvent.setup();
    const onLevel = vi.fn();
    render(<CharacterSheet actor={hero()} role="player" state={view(hero())} onLevel={onLevel} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    await user.click(screen.getByRole("button", { name: "Level 7. Level up or down" }));
    const panel = within(screen.getByRole("group", { name: "Level 7" }));
    expect(panel.getByText("Level 7 · Wizard")).toBeTruthy();
    expect(
      await panel.findByText(
        "Level 8 brings Ability Score Improvement · A second level 4 spell slot · Hit Points: 1d6 + 2, or the average of 6."
      )
    ).toBeTruthy();
    expect(sent("character:next-level")).toEqual([{ actorId: HERO }]);
    expect(panel.getByRole("button", { name: "Level down to 6" })).toBeTruthy();
    await user.click(panel.getByRole("button", { name: "Level up to 8" }));
    expect(onLevel).toHaveBeenCalled();
    // On a phone the menu doesn't repeat what the Level box holds.
    await user.click(screen.getByLabelText("Sheet menu for Lyra"));
    expect(screen.queryByRole("menuitem", { name: "Level up to 8" })).toBeNull();
  });

  it("shows the level as plain text when the GM builds the characters, and asks nothing", () => {
    render(
      <CharacterSheet
        actor={hero()}
        role="player"
        state={view(hero(), "gm-only")}
        onLevel={() => {}}
        onClose={() => {}}
      />,
      { wrapper: ToastProvider }
    );
    expect(screen.getByRole("img", { name: "Level 7" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Level up or down/ })).toBeNull();
    expect(sent("character:next-level")).toEqual([]);
  });

  it("puts the level in the laptop's menu", async () => {
    onLaptop(true);
    const user = userEvent.setup();
    render(<CharacterSheet actor={hero()} role="player" state={view(hero())} onLevel={() => {}} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    await user.click(screen.getByLabelText("Sheet menu for Lyra"));
    expect(screen.getByRole("menuitem", { name: "Level up to 8" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Level down to 6" })).toBeTruthy();
  });
});

describe("the Hit Point Dice", () => {
  const corwin = {
    die: "d10",
    maximum: 5,
    remaining: 4,
    entries: [
      { die: "d10", maximum: 3, remaining: 3 },
      { die: "d8", maximum: 2, remaining: 1 }
    ]
  } as const;

  it("names each die a multiclass character holds, and spends from the pool", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<HitPointDice actorId={HERO} hitDice={corwin} constitution={2} onFeedback={() => {}} />);
    const dice = within(screen.getByRole("group", { name: "Hit Point Dice" }));
    expect(dice.getByText("3 of 3 d10 · 1 of 2 d8")).toBeTruthy();
    expect(dice.getByText("Spend on a Short Rest · d10 + 2 or d8 + 2 each")).toBeTruthy();
    await user.click(dice.getByRole("button", { name: "Increase" }));
    await user.click(dice.getByRole("button", { name: "Spend" }));
    expect(sent("actor:spend-hit-dice")).toEqual([{ actorId: HERO, count: 2 }]);
    unmount();
    // The phone's Vitals show each die as boxes.
    render(<HitPointDice actorId={HERO} hitDice={corwin} boxes onFeedback={() => {}} />);
    expect(screen.getByRole("img", { name: "3 of 3 d10" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "1 of 2 d8" })).toBeTruthy();
  });

  it("offers to reroll the lowest die of a spend with Heroic Inspiration", async () => {
    const user = userEvent.setup();
    render(<HitPointDice actorId={HERO} hitDice={corwin} canReroll onFeedback={() => {}} />);
    const dice = within(screen.getByRole("group", { name: "Hit Point Dice" }));
    expect(dice.queryByRole("button", { name: /Reroll the lowest die/ })).toBeNull();
    await user.click(dice.getByRole("button", { name: "Spend" }));
    await user.click(await dice.findByRole("button", { name: "Reroll the lowest die · Heroic Inspiration" }));
    expect(sent("actor:spend-hit-dice").at(-1)).toEqual({ actorId: HERO, count: 1, reroll: true });
  });

  it("offers no Spend outside a Short Rest, where the dice are spent", () => {
    render(<HitPointDice actorId={HERO} hitDice={corwin} constitution={2} canSpend={false} onFeedback={() => {}} />);
    const dice = within(screen.getByRole("group", { name: "Hit Point Dice" }));
    expect(dice.getByText("Spend on a Short Rest · d10 + 2 or d8 + 2 each")).toBeTruthy();
    expect(dice.queryByRole("button", { name: "Spend" })).toBeNull();
  });
});

describe("the GM's sheet on a laptop", () => {
  it("marks itself and its tools GM only, the tools in violet", () => {
    onLaptop(true);
    const state = {
      actors: [hero()],
      definitions: [],
      rolls: [],
      combat: { active: false, initiative: [], pendingSaves: [] }
    } as unknown as GmView;
    render(<CharacterSheet actor={hero() as unknown as GmActor} role="gm" state={state} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const sheet = within(screen.getByRole("dialog", { name: "Lyra character sheet" }));
    const tools = within(sheet.getByRole("region", { name: "GM tools" }));
    expect(tools.getByText("GM only")).toBeTruthy();
    for (const name of ["Set HP", "Set AC", "Give Heroic Inspiration", "Long Rest"])
      expect(tools.getByRole("button", { name }).classList.contains("cs-gm-control")).toBe(true);
    expect(sheet.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});
