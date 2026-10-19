import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadEquipment, loadSpells } from "@vtt/content-srd-5.2.1";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { ContentEquipmentSummary, ContentSpellSummary, GmActor, GmView } from "@vtt/domain";

// `command()` sends through `socket.timeout(ms).emit` with an error-first ack; routed to `socket.emit` here.
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
import { EquipmentPicker } from "../encounter/equipment";
import { CharacterSheet } from "./CharacterSheet";

// The sheet's equipment controls: what the picker says about armor, which rows can be attuned, and the GM's
// hand-set Armor Class, resistance pick and hand-over.

const CATALOG: readonly ContentEquipmentSummary[] = loadEquipment().map((item) => ({
  id: item.id,
  name: item.name,
  source: item.source,
  category: item.category,
  costGp: item.costGp,
  weightLb: item.weightLb,
  description: item.description,
  weapon: item.weapon ?? null,
  armor: item.armor ?? null,
  appliesTo: item.appliesTo ?? null,
  rarity: item.rarity ?? null,
  attunement: item.attunement ?? null,
  ...(item.damageTypeChoice ? { damageTypeChoice: [...item.damageTypeChoice] } : {}),
  ...(item.spellScroll ? { spellScroll: { ...item.spellScroll } } : {}),
  ...(item.study ? { study: { ...item.study } } : {})
}));
/** The spell reference's fields a scroll's spell list reads. */
const SPELLS = loadSpells().map((spell) => ({
  id: spell.id,
  name: spell.name,
  level: spell.level,
  school: spell.school,
  classes: [...spell.classes]
})) as unknown as readonly ContentSpellSummary[];

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
/** Answers the catalog and spell reads, the sheet's action rows and derived numbers (`attunementSlots`), and every
 *  command with ok. */
function serve(attunementSlots = 3, actions: readonly unknown[] = []) {
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "content:equipment") ack?.({ ok: true, equipment: CATALOG, attribution: "SRD 5.2.1, CC BY 4.0." });
    else if (event === "content:spells") ack?.({ ok: true, spells: SPELLS, attribution: "SRD 5.2.1, CC BY 4.0." });
    else if (event === "actor:available-actions")
      ack?.({
        ok: true,
        actions,
        derived: {
          proficiencyBonus: 3,
          armorClass: 12,
          initiative: 2,
          abilities: [],
          skills: [],
          defences: { resistances: [], immunities: [], vulnerabilities: [] },
          spellSaveDcBonus: 0,
          attunementSlots
        }
      });
    else ack?.({ ok: true });
  });
}
const sent = (event: string) => emit.mock.calls.filter((call) => call[0] === event).map((call) => call[1]);

const DEFINITION = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const HERO = "10000000-0000-4000-8000-000000000001";
const FRIEND = "10000000-0000-4000-8000-000000000002";
function hero(over: Record<string, unknown> = {}): GmActor {
  return {
    id: HERO,
    name: "Aria",
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 30, temporary: 0 },
    armorClass: 12,
    conditions: [],
    effects: [],
    inventory: [
      { id: "rope", name: "Rope", quantity: 1, equipped: false, attuned: false },
      { id: "arrows-20", name: "Arrows (20)", quantity: 2, equipped: false, attuned: false, ammunitionLeft: 39 },
      {
        id: "ring-of-resistance",
        name: "Ring of Resistance",
        quantity: 1,
        equipped: true,
        attuned: false,
        magic: { isMagic: true, attunementRequired: true, slot: "ring" }
      }
    ],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    definitionId: "srd:player-character",
    definition: DEFINITION,
    ...over
  } as unknown as GmActor;
}
afterEach(() => localStorage.clear());

type User = ReturnType<typeof userEvent.setup>;
/** Opens the Gear tab. */
const openGear = async (user: User) => user.click(await screen.findByRole("tab", { name: "Gear" }));
/** An item's row in the Gear tab: its name, one line and charges, a tap from its detail. */
const rowOf = (name: string | RegExp) => screen.getByText(name).closest("button") as HTMLElement;

const stateWith = (actor: GmActor) =>
  ({
    actors: [actor, { ...hero(), id: FRIEND, name: "Brann", inventory: [] }],
    combat: { active: false, initiative: [] },
    rolls: []
  }) as unknown as GmView;

describe("the equipment picker's armor line", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prints the Dex cap, the Strength score and the Stealth Disadvantage", async () => {
    serve();
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={() => {}} onClose={() => {}} />);
    const user = userEvent.setup();
    const search = await screen.findByRole("searchbox", { name: "Search equipment" });
    await user.type(search, "half plate");
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("AC 15 + Dex (max 2) · Stealth Disadvantage");
    await user.clear(search);
    await user.type(search, "plate armor");
    const plate = screen.getByRole("button", { name: "Add Plate Armor" }).closest("li") as HTMLElement;
    expect(plate.textContent).toContain("AC 18 · Str 15 · Stealth Disadvantage");
  });
});

describe("the sheet's inventory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers Attune only on an item that needs attunement, in the item's detail", async () => {
    serve();
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await openGear(user);
    // A partly spent bundle shows the pieces left on its row.
    expect(rowOf("Arrows (20)").textContent).toContain("39 left");
    await user.click(rowOf("Rope"));
    expect(screen.getByRole("region", { name: "Rope" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attune" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(rowOf("Ring of Resistance"));
    expect(screen.getByRole("button", { name: "Attune" }).getAttribute("aria-pressed")).toBe("false");
    // A player never sees the GM's resistance pick control.
    expect(screen.queryByRole("combobox", { name: "Resistance type of Ring of Resistance" })).toBeNull();
  });

  it("counts attunement against the character's own limit, and names what fills it", async () => {
    serve(4);
    const attuned = hero();
    attuned.inventory = attuned.inventory.map((item) =>
      item.id === "ring-of-resistance" ? { ...item, attuned: true } : item
    );
    render(<CharacterSheet actor={attuned} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    await openGear(userEvent.setup());
    const attunement = within(screen.getByRole("region", { name: "Attunement" }));
    expect(await attunement.findByText("1 of 4")).toBeTruthy();
    expect(attunement.getByText("Ring of Resistance")).toBeTruthy();
  });

  it("lets the GM pick a resistance type and hand an item to another character, in violet", async () => {
    serve();
    const actor = hero();
    render(<CharacterSheet actor={actor} role="gm" state={stateWith(actor)} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const user = userEvent.setup();
    await openGear(user);
    await user.click(rowOf("Ring of Resistance"));
    // The GM's narrow sheet opens an item in a drawer, its GM-only controls marked.
    const drawer = within(screen.getByRole("dialog", { name: "Ring of Resistance" }));
    expect(drawer.getByText("GM only")).toBeTruthy();
    await user.selectOptions(
      await drawer.findByRole("combobox", { name: "Resistance type of Ring of Resistance" }),
      "acid"
    );
    expect(sent("character:set-inventory").at(-1)).toMatchObject({
      actorId: HERO,
      item: { id: "ring-of-resistance", chosenDamageType: "acid" }
    });
    await user.selectOptions(drawer.getByRole("combobox", { name: "Give the Ring of Resistance to" }), FRIEND);
    const give = drawer.getByRole("button", { name: "Give" });
    expect(give.classList.contains("cs-gm-control")).toBe(true);
    await user.click(give);
    expect(sent("character:give-item")).toEqual([
      expect.objectContaining({ actorId: HERO, toActorId: FRIEND, itemId: "ring-of-resistance" })
    ]);
  });

  it("lets the GM mark a manual studied, and shows a studied copy's magic spent", async () => {
    serve();
    const actor = hero({
      inventory: [
        { id: "manual-of-bodily-health", name: "Manual of Bodily Health", quantity: 1, equipped: false, attuned: false },
        {
          id: "tome-of-clear-thought",
          name: "Tome of Clear Thought",
          quantity: 1,
          equipped: false,
          attuned: false,
          dormant: true
        }
      ]
    });
    render(<CharacterSheet actor={actor} role="gm" state={stateWith(actor)} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const user = userEvent.setup();
    await openGear(user);
    expect(rowOf("Tome of Clear Thought").textContent).toContain("Magic spent");
    await user.click(rowOf("Manual of Bodily Health"));
    const drawer = within(screen.getByRole("dialog", { name: "Manual of Bodily Health" }));
    expect(
      await drawer.findByText("48 hours of study over 6 days or fewer raise Constitution by 2, to at most 30.")
    ).toBeTruthy();
    const mark = drawer.getByRole("button", { name: "Mark it studied" });
    expect(mark.classList.contains("cs-gm-control")).toBe(true);
    await user.click(mark);
    expect(sent("character:study-item")).toEqual([
      expect.objectContaining({ actorId: HERO, itemId: "manual-of-bodily-health" })
    ]);
  });

  it("keeps the coins in one row, edited together", async () => {
    serve();
    render(
      <CharacterSheet
        actor={hero({ currency: { cp: 3, sp: 0, ep: 0, gp: 12, pp: 0 } })}
        role="player"
        onClose={() => {}}
      />,
      {
        wrapper: ToastProvider
      }
    );
    const user = userEvent.setup();
    await openGear(user);
    const coins = within(screen.getByRole("region", { name: "Coins" }));
    expect(coins.getByText("GP").nextElementSibling?.textContent).toBe("12");
    await user.click(coins.getByRole("button", { name: "Edit" }));
    const gold = coins.getByRole("textbox", { name: "GP coins" });
    await user.clear(gold);
    await user.type(gold, "20");
    await user.click(coins.getByRole("button", { name: "Save coins" }));
    expect(sent("character:set-currency").at(-1)).toMatchObject({
      actorId: HERO,
      currency: { pp: 0, gp: 20, ep: 0, sp: 0, cp: 3 }
    });
  });

  it("names a magic arrow's kind, and picks up fired arrows only outside a fight", async () => {
    serve();
    const archer = hero();
    archer.inventory = [
      ...archer.inventory.map((item) => (item.id === "arrows-20" ? { ...item, ammunitionFired: 4 } : item)),
      {
        id: "ammunition-1",
        name: "Ammunition, +1",
        quantity: 5,
        equipped: true,
        attuned: false,
        category: "ammunition",
        baseId: "arrows-20"
      }
    ];
    const { unmount } = render(<CharacterSheet actor={archer} role="player" onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const user = userEvent.setup();
    await openGear(user);
    expect(await screen.findByText("Ammunition, +1 (Arrows)")).toBeTruthy();
    expect(rowOf("Arrows (20)").textContent).toContain("4 fired");
    await user.click(screen.getByRole("button", { name: "Pick up fired ammunition" }));
    expect(sent("character:recover-ammunition")).toEqual([expect.objectContaining({ actorId: HERO })]);
    unmount();
    // In the fight they come back when it ends, so the sheet offers nothing yet.
    const fighting = {
      ...stateWith(archer),
      combat: { active: true, rulesMode: "strict", ruleExceptions: {}, initiative: [{ actorId: HERO }] }
    } as unknown as GmView;
    render(<CharacterSheet actor={archer} role="gm" state={fighting} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    await openGear(user);
    expect(screen.queryByRole("button", { name: "Pick up fired ammunition" })).toBeNull();
  });

  it("asks which kind a piece of magic ammunition is, naming the weapons each kind fits", async () => {
    serve();
    const added = vi.fn();
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={added} onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "ammunition, +1");
    await user.click(screen.getByRole("button", { name: "Add Ammunition, +1" }));
    expect(screen.getByText(/only a weapon that fires that kind can shoot it/)).toBeTruthy();
    const bolts = screen.getByRole("button", { name: "Make it Crossbow Bolts" }).closest("li") as HTMLElement;
    expect(bolts.textContent).toContain("Bolts for a Hand Crossbow, Light Crossbow or Heavy Crossbow");
    await user.click(screen.getByRole("button", { name: "Make it Crossbow Bolts" }));
    expect(added).toHaveBeenCalledWith(expect.objectContaining({ id: "ammunition-1" }), "crossbow-bolts-20");
  });

  it("asks which spell a Spell Scroll bears, from the levels it can hold", async () => {
    serve();
    const added = vi.fn();
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={added} onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "spell scroll (level 1)");
    await user.click(screen.getByRole("button", { name: "Add Spell Scroll (Level 1)" }));
    const step = screen.getByRole("dialog", { name: "Choose the spell on Spell Scroll (Level 1)" });
    // Level 1 only: no cantrip, and the spell lists say who can read it.
    expect(await within(step).findByRole("button", { name: "Put Magic Missile on the scroll" })).toBeTruthy();
    expect(within(step).queryByRole("button", { name: "Put Fire Bolt on the scroll" })).toBeNull();
    const missile = within(step).getByRole("button", { name: "Put Magic Missile on the scroll" }).closest("li")!;
    expect(missile.textContent).toContain("Level 1 · Evocation · Sorcerer, Wizard");
    await user.click(within(step).getByRole("button", { name: "Put Magic Missile on the scroll" }));
    expect(added).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spell-scroll-level-1" }),
      undefined,
      "magic-missile"
    );
  });

  it("names a scroll's spell on its row, and asks for one on a scroll that has none", async () => {
    serve();
    const reader = hero();
    reader.inventory = [
      { id: "spell-scroll", name: "Spell Scroll", quantity: 1, equipped: false, attuned: false, spellId: "fireball" },
      {
        id: "spell-scroll-2",
        recordId: "spell-scroll",
        name: "Spell Scroll",
        quantity: 1,
        equipped: false,
        attuned: false
      }
    ];
    render(<CharacterSheet actor={reader} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await openGear(user);
    await user.click(rowOf(await screen.findByText("Spell Scroll (Fireball)").then((node) => node.textContent!)));
    expect(screen.queryByRole("button", { name: "Choose its spell" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(rowOf("Spell Scroll"));
    await user.click(await screen.findByRole("button", { name: "Choose its spell" }));
    const step = screen.getByRole("dialog", { name: "Choose the spell on Spell Scroll" });
    // Any level: the chips narrow the list.
    await user.click(within(step).getByRole("button", { name: "Level 3" }));
    expect(within(step).queryByRole("button", { name: "Put Magic Missile on the scroll" })).toBeNull();
    await user.click(within(step).getByRole("button", { name: "Put Fireball on the scroll" }));
    expect(sent("character:set-inventory").at(-1)).toMatchObject({
      actorId: HERO,
      item: { id: "spell-scroll-2", spellId: "fireball" }
    });
  });

  it("casts a scroll's spell on the player's turn with the spell's own choices", async () => {
    // The server's row for a scroll of Chromatic Orb: an attack whose caster picks the damage type.
    serve(3, [
      {
        id: "item-spell-scroll-read",
        name: "Cast Chromatic Orb (Spell Scroll)",
        activation: "action",
        available: true,
        violations: [],
        usesRemaining: null,
        componentsRemaining: null,
        description: "Read the scroll to cast Chromatic Orb.",
        attackBonus: 5,
        reachFeet: null,
        rangeFeet: 90,
        rangeNormalFeet: null,
        attackCount: null,
        saveAbility: null,
        saveDc: null,
        damage: [{ formula: "3d8", type: "acid" }],
        usesLimit: null,
        usesPer: null,
        usesPool: null,
        requiresEffectTag: null,
        multiattack: null,
        reaction: null,
        healing: null,
        targeting: "single",
        darts: null,
        damageTypes: ["acid", "cold", "fire", "lightning", "poison", "thunder"]
      }
    ]);
    const reader = hero();
    reader.inventory = [
      {
        id: "spell-scroll",
        name: "Spell Scroll",
        quantity: 1,
        equipped: false,
        attuned: false,
        spellId: "chromatic-orb"
      }
    ];
    const myTurn = {
      ...stateWith(reader),
      revision: 3,
      combat: {
        active: true,
        rulesMode: "strict",
        ruleExceptions: {},
        turnActorId: HERO,
        playerDamageMode: "proposal",
        pendingSaves: [],
        reactionsUsed: [],
        turn: { actionUsed: false, bonusActionUsed: false, turnUses: {}, movementUsedFeet: 0 },
        initiative: [
          { actorId: HERO, name: "Aria" },
          { actorId: FRIEND, name: "Brann" }
        ]
      }
    } as unknown as GmView;
    render(<CharacterSheet actor={reader} role="player" state={myTurn} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const user = userEvent.setup();
    await openGear(user);
    await user.click(await screen.findByText("Spell Scroll (Chromatic Orb)"));
    // The item's own action is its detail's primary; on the player's turn it is aimed at the top of the tab.
    await user.click(await screen.findByRole("button", { name: /Cast Chromatic Orb/ }));
    const picker = screen.getByRole("group", { name: "Targets for Cast Chromatic Orb (Spell Scroll)" });
    const pick = within(picker).getByRole("combobox", { name: "Damage type" }) as HTMLSelectElement;
    expect([...pick.options].map((option) => option.value)).toEqual([
      "acid",
      "cold",
      "fire",
      "lightning",
      "poison",
      "thunder"
    ]);
  });
});

describe("the hand-set Armor Class", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the party that the GM set it", () => {
    serve();
    render(
      <CharacterSheet actor={hero({ armorClass: 15, armorClassOverride: 15 })} role="player" onClose={() => {}} />,
      {
        wrapper: ToastProvider
      }
    );
    expect(screen.getByText("Set by GM")).toBeTruthy();
  });

  it("lets the GM set it and hand it back to the worn gear", async () => {
    serve();
    const user = userEvent.setup();
    const { rerender } = render(<CharacterSheet actor={hero()} role="gm" onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    // The GM's tools: a tab of their own on a narrow sheet.
    await user.click(await screen.findByRole("tab", { name: "GM" }));
    await user.click(screen.getByRole("button", { name: "Set AC" }));
    const field = screen.getByRole("textbox", { name: "Armor Class" });
    await user.clear(field);
    await user.type(field, "15");
    await user.click(screen.getByRole("button", { name: "Save AC" }));
    expect(sent("actor:set-armor-class")).toEqual([expect.objectContaining({ actorId: HERO, armorClass: 15 })]);

    rerender(<CharacterSheet actor={hero({ armorClass: 15, armorClassOverride: 15 })} role="gm" onClose={() => {}} />);
    expect(screen.getByText("The AC is set by hand.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Set AC" }));
    await user.click(screen.getByRole("button", { name: "Use worn gear" }));
    expect(sent("actor:set-armor-class").at(-1)).toMatchObject({ actorId: HERO, armorClass: null });
  });
});
