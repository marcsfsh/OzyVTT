import { describe, expect, it, vi, beforeEach } from "vitest";
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
import { EquipmentPicker } from "./equipment";
import { CharacterSheet } from "./CharacterSheet";

// The sheet's equipment controls: what the picker says about armor, which rows can be attuned, and the GM's
// hand-set Armor Class, resistance pick and hand-over.

const CATALOG: readonly ContentEquipmentSummary[] = loadEquipment().map((item) => ({
  id: item.id,
  name: item.name,
  category: item.category,
  costGp: item.costGp,
  weightLb: item.weightLb,
  description: item.description,
  weapon: item.weapon ?? null,
  armor: item.armor ?? null,
  appliesTo: item.appliesTo ?? null,
  ...(item.damageTypeChoice ? { damageTypeChoice: [...item.damageTypeChoice] } : {}),
  ...(item.spellScroll ? { spellScroll: { ...item.spellScroll } } : {})
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
/** Answers the catalog and spell reads, the sheet's derived numbers (`attunementSlots`), and every command with ok. */
function serve(attunementSlots = 3) {
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "content:equipment") ack?.({ ok: true, equipment: CATALOG, attribution: "SRD 5.2.1, CC BY 4.0." });
    else if (event === "content:spells") ack?.({ ok: true, spells: SPELLS, attribution: "SRD 5.2.1, CC BY 4.0." });
    else if (event === "actor:available-actions")
      ack?.({
        ok: true,
        actions: [],
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

  it("offers Attune only on an item that needs attunement", () => {
    serve();
    render(<CharacterSheet actor={hero()} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const rope = screen.getByText("Rope").closest(".sheet-inv-row") as HTMLElement;
    const ring = screen.getByText("Ring of Resistance").closest(".sheet-inv-row") as HTMLElement;
    expect(within(rope).queryByRole("button", { name: "Attune" })).toBeNull();
    // A partly spent bundle shows the pieces left.
    expect((screen.getByText("Arrows (20)").closest(".sheet-inv-row") as HTMLElement).textContent).toContain("39 left");
    expect(within(ring).getByRole("button", { name: "Attune" })).toBeTruthy();
    // A player never sees the GM's resistance pick control.
    expect(screen.queryByRole("combobox", { name: "Resistance type of Ring of Resistance" })).toBeNull();
  });

  it("counts attunement against the character's own limit", async () => {
    serve(4);
    const attuned = hero();
    attuned.inventory = attuned.inventory.map((item) =>
      item.id === "ring-of-resistance" ? { ...item, attuned: true } : item
    );
    render(<CharacterSheet actor={attuned} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    expect(await screen.findByText("Attunement 1/4")).toBeTruthy();
  });

  it("lets the GM pick a resistance type and hand an item to another character", async () => {
    serve();
    const actor = hero();
    render(<CharacterSheet actor={actor} role="gm" state={stateWith(actor)} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Resistance type of Ring of Resistance" }),
      "acid"
    );
    expect(sent("character:set-inventory").at(-1)).toMatchObject({
      actorId: HERO,
      item: { id: "ring-of-resistance", chosenDamageType: "acid" }
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Item to give" }), "rope");
    await user.selectOptions(screen.getByRole("combobox", { name: "Give it to" }), FRIEND);
    await user.click(screen.getByRole("button", { name: "Give" }));
    expect(sent("character:give-item")).toEqual([
      expect.objectContaining({ actorId: HERO, toActorId: FRIEND, itemId: "rope" })
    ]);
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
    const magic = (await screen.findByText("Ammunition, +1")).closest(".sheet-inv-row") as HTMLElement;
    expect(await within(magic).findByText("(Arrows)")).toBeTruthy();
    expect((screen.getByText("Arrows (20)").closest(".sheet-inv-row") as HTMLElement).textContent).toContain("4 fired");
    await userEvent.setup().click(screen.getByRole("button", { name: "Pick up fired ammunition" }));
    expect(sent("character:recover-ammunition")).toEqual([expect.objectContaining({ actorId: HERO })]);
    unmount();
    // In the fight they come back when it ends, so the sheet offers nothing yet.
    const fighting = { ...stateWith(archer), combat: { active: true, initiative: [{ actorId: HERO }] } } as GmView;
    render(<CharacterSheet actor={archer} role="gm" state={fighting} onClose={() => {}} />, {
      wrapper: ToastProvider
    });
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
    const [bearing, blank] = screen
      .getAllByText("Spell Scroll")
      .map((name) => name.closest(".sheet-inv-row") as HTMLElement);
    expect(await within(bearing).findByText("(Fireball)")).toBeTruthy();
    expect(within(bearing).queryByRole("button", { name: "Choose its spell" })).toBeNull();
    const user = userEvent.setup();
    await user.click(await within(blank).findByRole("button", { name: "Choose its spell" }));
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
    await user.click(screen.getByRole("button", { name: "Armor Class 12. Set it by hand" }));
    const field = screen.getByRole("textbox", { name: "Armor Class" });
    await user.clear(field);
    await user.type(field, "15");
    await user.click(screen.getByRole("button", { name: "Set AC" }));
    expect(sent("actor:set-armor-class")).toEqual([expect.objectContaining({ actorId: HERO, armorClass: 15 })]);

    rerender(<CharacterSheet actor={hero({ armorClass: 15, armorClassOverride: 15 })} role="gm" onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Armor Class 15. Set it by hand" }));
    await user.click(screen.getByRole("button", { name: "Use worn gear" }));
    expect(sent("actor:set-armor-class").at(-1)).toMatchObject({ actorId: HERO, armorClass: null });
  });
});
