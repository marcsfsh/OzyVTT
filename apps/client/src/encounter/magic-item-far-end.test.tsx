import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadEquipment } from "@vtt/content-srd-5.2.1";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { ContentEquipmentSummary } from "@vtt/domain";
import type { PlayerActor } from "@vtt/domain";

vi.mock("../socket", () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true } }));

import { socket } from "../socket";
import { EquipmentPicker } from "./equipment";
import { CharacterSheet } from "./CharacterSheet";

/**
 * THE MAGIC-ITEM ETL'S FAR END: a GM browses, adds `Wand of the War Mage, +1`, and the wand's
 * RARITY and ATTUNEMENT REQUIREMENT are on screen — as text a person reads, not as a field a test
 * pulled off a parsed record.
 *
 * The catalog here is the real one. `loadEquipment()` is the folded four-source catalog the server
 * projects, so this test fails if the fourth fold is removed, if the parser mints a different id, or
 * if the rarity stops reaching the string. Nothing about the wand is a fixture except the actor
 * holding it.
 *
 * WHY THE DESCRIPTION IS THE CHANNEL, and it is a finding rather than a convenience:
 * `ContentEquipmentSummary` carries no `rarity` and `ItemMagicMarkerSchema` carries no `rarity`
 * either, so no key on the wire holds one. The description does, and the ETL leads every row with
 * the SRD's own printed type line for exactly this reason. Putting `rarity` on a projection would
 * be a viewer-safety change and is not this unit's to make.
 */

const CATALOG: readonly ContentEquipmentSummary[] = loadEquipment().map((item) => ({
  id: item.id, name: item.name, category: item.category, costGp: item.costGp,
  weightLb: item.weightLb, description: item.description,
  weapon: item.weapon ?? null, armor: item.armor ?? null, appliesTo: item.appliesTo ?? null
}));

/** Answer `content:equipment` with the real catalog, the way the server's projection does. */
function serveCatalog() {
  (socket.emit as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
    (event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "content:equipment") ack?.({ ok: true, equipment: CATALOG, attribution: "SRD 5.2.1, CC BY 4.0." });
    }
  );
}

type EmitCall = [event: string, payload: Record<string, unknown>, ack: (result: unknown) => void];
const emitted = () => (socket.emit as unknown as { mock: { calls: EmitCall[] } }).mock.calls;

/** A real imported PC, so the sheet renders its Inventory section rather than the "no sheet yet" note. */
const DEFINITION = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const ACTOR = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Aria", kind: "player-character", visibility: "public",
  hp: { current: 30, maximum: 30, temporary: 0 },
  conditions: [], effects: [], inventory: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  definitionId: "srd:player-character", definition: DEFINITION
} as unknown as PlayerActor;

describe("the far end of the magic-item ETL", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("puts the wand's rarity and attunement requirement on screen in the browse list", async () => {
    serveCatalog();
    const added: ContentEquipmentSummary[] = [];
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={(item) => added.push(item)} onClose={() => {}} />);

    const search = await screen.findByRole("searchbox", { name: "Search equipment" });
    await userEvent.setup().type(search, "war mage");
    const rows = screen.getAllByRole("listitem");
    // The ladder really did expand into three separately addable rows.
    expect(rows.map((row) => within(row).getByRole("button").getAttribute("aria-label"))).toEqual([
      "Add Wand of the War Mage, +1", "Add Wand of the War Mage, +2", "Add Wand of the War Mage, +3"
    ]);
    // THE RENDERED STRING. Read off the DOM, not off the record.
    expect(rows[0].textContent).toContain("Wand, Uncommon (Requires Attunement by a Spellcaster).");
    // ...and each tier shows its OWN rung, which is the whole reason the ladder expanded.
    expect(rows[1].textContent).toContain("Wand, Rare (");
    expect(rows[2].textContent).toContain("Wand, Very Rare (");
  });

  it("renders that same line on the character's sheet once the GM has added it", async () => {
    serveCatalog();
    let picked: ContentEquipmentSummary | null = null;
    const picker = render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={(item) => { picked = item; }} onClose={() => {}} />);
    await userEvent.setup().type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Wand of the War Mage, +1");
    await userEvent.setup().click(screen.getByRole("button", { name: "Add Wand of the War Mage, +1" }));
    picker.unmount();

    const chosen = picked as ContentEquipmentSummary | null;
    expect(chosen?.id).toBe("wand-of-the-war-mage-1");

    // Exactly what `addFromCatalog` posts for a fresh pick, then exactly what the server would have
    // stored - so the sheet below renders the row the wire really carries, description and all.
    const stored = {
      id: chosen!.id, name: chosen!.name, quantity: 1, equipped: false, attuned: false,
      category: chosen!.category, ...(chosen!.description ? { description: chosen!.description } : {})
    };
    const holding = { ...ACTOR, inventory: [stored] } as unknown as PlayerActor;
    render(<CharacterSheet actor={holding} role="player" onClose={() => {}} />);

    const row = screen.getByText("Wand of the War Mage, +1").closest(".sheet-inv-row") as HTMLElement;
    expect(row).toBeTruthy();
    // THE FAR END. A rendered string on a character's sheet, carrying the rarity and the
    // attunement requirement the SRD prints for this tier.
    expect(row.textContent).toContain("Wand, Uncommon (Requires Attunement by a Spellcaster).");
    expect(row.textContent).toContain("While holding this wand, you gain a bonus to spell attack rolls");
    // The Attune control the requirement is asking about is on the same row.
    expect(within(row).getByRole("button", { name: "Attune" })).toBeTruthy();
  });

  it("makes all 268 magic rows reachable without scrolling a 400-row list", async () => {
    serveCatalog();
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={() => {}} onClose={() => {}} />);
    await screen.findByRole("searchbox", { name: "Search equipment" });
    const user = userEvent.setup();
    // Every magic category the ETL mints has a chip; before them these rows lived only under "All".
    for (const [chip, count] of [["Wondrous", 127], ["Rings", 22], ["Wands & Rods", 34]] as const) {
      await user.click(screen.getByRole("button", { name: chip }));
      expect(screen.getAllByRole("listitem"), chip).toHaveLength(count);
    }
    await user.click(screen.getByRole("button", { name: "Consumables" }));
    // The reconciliation, on screen: the mundane 50 gp potion and the SRD's rarity table both exist.
    const names = screen.getAllByRole("listitem").map((row) => within(row).getByRole("button").getAttribute("aria-label"));
    expect(names).toContain("Add Potion of Healing");
    expect(names).toContain("Add Potions of Healing");
  });

  it("keeps a table-bearing entry legible: Armor of Resistance browses as one row, not ten", async () => {
    serveCatalog();
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={() => {}} onClose={() => {}} />);
    await userEvent.setup().type(await screen.findByRole("searchbox", { name: "Search equipment" }), "armor of resistance");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    // Its d10 table rode into the description rather than becoming ten near-identical browse rows.
    expect(rows[0].textContent).toContain("Armor (Any Light, Medium, or Heavy), Rare (Requires Attunement).");
    expect(rows[0].textContent).toContain("1d10 1: Damage Type Acid");
  });

  it("does not put a wand's mechanics on the wire — only what a browse row and an inventory row already carried", () => {
    // The viewer-safety claim, checked rather than asserted in prose. `ContentEquipmentSummary` is
    // the browse projection; it has exactly these keys and none of them is a rider, a cast or a
    // cursed flag. The ETL added 268 rows to what it lists and no key to its shape.
    //
    // `appliesTo` JOINED THE WIRE 2026-08-14 (C9): the eligibility column - the printed type-line
    // qualifier plus its resolved base ids - crosses so the picker's base chooser can offer the
    // list. It is printed SRD reference text, identical for every viewer, and carries no rider, no
    // cast and nothing GM-secret; the wand's is null (only weapon/armor templates carry one).
    const wand = CATALOG.find((item) => item.id === "wand-of-the-war-mage-1")!;
    expect(wand.appliesTo).toBeNull();
    expect(Object.keys(wand).sort()).toEqual([
      "appliesTo", "armor", "category", "costGp", "description", "id", "name", "weapon", "weightLb"
    ]);
    for (const key of ["modifiers", "effects", "actions", "casts", "cursed", "uses", "grants", "rarity", "attunement"]) {
      expect(wand, key).not.toHaveProperty(key);
    }
  });
});

describe("the C9 base chooser", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("a choice template inserts ONE step: the eligible-base list, and the add completes with the pick", async () => {
    serveCatalog();
    const added: Array<{ id: string; baseId?: string }> = [];
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={(item, baseId) => added.push({ id: item.id, ...(baseId ? { baseId } : {}) })} onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));

    // Nothing was added yet - the chooser opened instead, showing the printed form and real bases.
    expect(added).toEqual([]);
    expect(screen.getByText(/applies to Any Simple or Martial/)).toBeTruthy();
    // All 38 bases are offered, each with its own numbers on the row.
    const options = screen.getAllByRole("listitem");
    expect(options).toHaveLength(38);
    const greatsword = options.find((row) => within(row).queryByRole("button", { name: "Make it a Greatsword" }));
    expect(greatsword!.textContent).toContain("2d6 slashing");

    // The search survives into the chooser - 38 rows is a phone screen's worth of scrolling.
    await user.type(screen.getByRole("searchbox", { name: "Search bases" }), "dagger");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Make it a Dagger" }));
    expect(added).toEqual([{ id: "weapon-1", baseId: "dagger" }]);
  });

  it("a single-base template never asks, and an owned template re-adds without re-asking", async () => {
    serveCatalog();
    const added: Array<{ id: string; baseId?: string }> = [];
    const picker = render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={(item, baseId) => added.push({ id: item.id, ...(baseId ? { baseId } : {}) })} onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Dwarven Thrower");
    await user.click(screen.getByRole("button", { name: "Add Dwarven Thrower" }));
    // Straight through - the server auto-binds the lone base, no chooser, no baseId needed.
    expect(added).toEqual([{ id: "dwarven-thrower" }]);
    picker.unmount();

    // An owned choice template increments its stack keeping its pick - the chooser must NOT reopen.
    render(<EquipmentPicker ownedCounts={new Map([["weapon-1", 1]])} busy={false} onAdd={(item, baseId) => added.push({ id: item.id, ...(baseId ? { baseId } : {}) })} onClose={() => {}} />);
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));
    expect(added).toEqual([{ id: "dwarven-thrower" }, { id: "weapon-1" }]);
  });
});

describe("the C9 wire seam - the real sheet ships the pick", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  /** Serve the catalog AND capture every mutation emit, so the assertion is on the wire itself. */
  function captureEmits(): Array<{ event: string; payload: Record<string, unknown> }> {
    const emits: Array<{ event: string; payload: Record<string, unknown> }> = [];
    (socket.emit as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      (event: string, payload: Record<string, unknown>, ack?: (result: unknown) => void) => {
        if (event === "content:equipment") { ack?.({ ok: true, equipment: CATALOG, attribution: "SRD 5.2.1, CC BY 4.0." }); return; }
        emits.push({ event, payload });
        ack?.({ ok: true });
      }
    );
    return emits;
  }

  it("addFromCatalog carries the chooser's pick as baseId, and ships NO stats - the server copies them", async () => {
    const emits = captureEmits();
    render(<CharacterSheet actor={ACTOR} role="player" onClose={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Browse SRD gear" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));
    await user.click(await screen.findByRole("button", { name: "Make it a Dagger" }));

    const emit = emits.find((entry) => entry.event === "character:set-inventory");
    expect(emit, "the pick never reached the wire").toBeTruthy();
    expect(emit!.payload.item).toMatchObject({ id: "weapon-1", baseId: "dagger", quantity: 1 });
    // A template's catalog summary has weapon: null, so the client ships no block; binding is the
    // server's. A payload that carried stats here would be the client deciding what a weapon does.
    expect((emit!.payload.item as Record<string, unknown>).weapon).toBeUndefined();
  });

  it("a re-add of a bound row keeps its stored pick on the wire, chooser skipped", async () => {
    const emits = captureEmits();
    const bound = {
      id: "weapon-1", name: "Weapon, +1", quantity: 1, equipped: true, attuned: false,
      category: "weapon", baseId: "dagger",
      weapon: { category: "simple", damageDice: "1d4", damageType: "piercing", rangeFeet: 20, longRangeFeet: 60, properties: ["finesse", "light", "thrown"] }
    };
    const holding = { ...ACTOR, inventory: [bound] } as unknown as PlayerActor;
    render(<CharacterSheet actor={holding} role="player" onClose={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Browse SRD gear" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));

    // No chooser: the emit went straight out, quantity 2, the stored pick riding along.
    const emit = emits.find((entry) => entry.event === "character:set-inventory");
    expect(emit!.payload.item).toMatchObject({ id: "weapon-1", baseId: "dagger", quantity: 2 });
  });

  it("an unbound legacy row shows its base chooser, and the bind rides the row it already is", async () => {
    const emits = captureEmits();
    const legacy = { id: "weapon-2", name: "Weapon, +2", quantity: 1, equipped: true, attuned: false, category: "weapon" };
    const holding = { ...ACTOR, inventory: [legacy] } as unknown as PlayerActor;
    render(<CharacterSheet actor={holding} role="player" onClose={() => {}} />);
    const user = userEvent.setup();
    // The bound-base display is absent and the one sheet-side chooser is offered instead.
    await user.click(await screen.findByRole("button", { name: "Choose what it is" }));
    await user.click(await screen.findByRole("button", { name: "Make it a Warhammer" }));

    const emit = emits.find((entry) => entry.event === "character:set-inventory");
    expect(emit!.payload.item).toMatchObject({ id: "weapon-2", baseId: "warhammer", quantity: 1, equipped: true });
  });
});
