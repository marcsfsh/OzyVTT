import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadEquipment } from "@vtt/content-srd-5.2.1";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { ContentEquipmentSummary } from "@vtt/domain";
import type { PlayerActor } from "@vtt/domain";

// `command()` and `read()` send through `socket.timeout(ms).emit` with an error-first ack; it is routed to
// `socket.emit` here so the assertions read one call list.
vi.mock("../socket", () => {
  const emit = vi.fn();
  const timed = {
    emit: (event: string, payload: unknown, ack: (error: null, reply: unknown) => void) =>
      emit(event, payload, (reply: unknown) => ack(null, reply))
  };
  return { socket: { on: vi.fn(), off: vi.fn(), emit, connected: true, timeout: () => timed } };
});

import { socket } from "../socket";
import { EquipmentPicker } from "./equipment";
import { ToastProvider } from "@vtt/ui";
import { CharacterSheet } from "../sheet/CharacterSheet";

/**
 * A GM adds `Wand of the War Mage, +1` and its rarity and attunement requirement appear on screen,
 * using the real folded catalog (`loadEquipment()`). Only the actor holding it is a fixture.
 * The description is the channel: neither `ContentEquipmentSummary` nor `ItemMagicMarkerSchema`
 * carries a `rarity`, and adding one to a projection would be a viewer-safety change.
 */

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
  appliesTo: item.appliesTo ?? null
}));

/** Answer `content:equipment` with the real catalog, the way the server's projection does. */
function serveCatalog() {
  (socket.emit as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
    (event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "content:equipment") ack?.({ ok: true, equipment: CATALOG, attribution: "SRD 5.2.1, CC BY 4.0." });
    }
  );
}

afterEach(() => localStorage.clear());
/** Opens the sheet's Gear tab, where the inventory and its picker live. */
const openGear = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole("tab", { name: "Gear" }));

/** A real imported PC, so the sheet renders its Inventory section and no "no sheet yet" note. */
const DEFINITION = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const ACTOR = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Aria",
  kind: "player-character",
  visibility: "public",
  hp: { current: 30, maximum: 30, temporary: 0 },
  conditions: [],
  effects: [],
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  definitionId: "srd:player-character",
  definition: DEFINITION
} as unknown as PlayerActor;

describe("the far end of the magic-item ETL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts the wand's rarity and attunement requirement on screen in the browse list", async () => {
    serveCatalog();
    const added: ContentEquipmentSummary[] = [];
    render(
      <EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={(item) => added.push(item)} onClose={() => {}} />
    );

    const search = await screen.findByRole("searchbox", { name: "Search equipment" });
    await userEvent.setup().type(search, "war mage");
    const rows = screen.getAllByRole("listitem");
    // The ladder expands into three separately addable rows.
    expect(rows.map((row) => within(row).getByRole("button").getAttribute("aria-label"))).toEqual([
      "Add Wand of the War Mage, +1",
      "Add Wand of the War Mage, +2",
      "Add Wand of the War Mage, +3"
    ]);
    // Read off the DOM, never the record.
    expect(rows[0].textContent).toContain("Wand, Uncommon (Requires Attunement by a Spellcaster).");
    // ...and each tier shows its own rung.
    expect(rows[1].textContent).toContain("Wand, Rare (");
    expect(rows[2].textContent).toContain("Wand, Very Rare (");
  });

  it("renders that same line on the character's sheet once the GM has added it", async () => {
    serveCatalog();
    let picked: ContentEquipmentSummary | null = null;
    const picker = render(
      <EquipmentPicker
        ownedCounts={new Map()}
        busy={false}
        onAdd={(item) => {
          picked = item;
        }}
        onClose={() => {}}
      />
    );
    await userEvent
      .setup()
      .type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Wand of the War Mage, +1");
    await userEvent.setup().click(screen.getByRole("button", { name: "Add Wand of the War Mage, +1" }));
    picker.unmount();

    const chosen = picked as ContentEquipmentSummary | null;
    expect(chosen?.id).toBe("wand-of-the-war-mage-1");

    // Exactly what `addFromCatalog` posts for a fresh pick, then what the server would store, so the
    // sheet renders the row the wire really carries.
    const stored = {
      id: chosen!.id,
      name: chosen!.name,
      quantity: 1,
      equipped: false,
      attuned: false,
      category: chosen!.category,
      ...(chosen!.description ? { description: chosen!.description } : {}),
      // The marker the server stamps from the record, which the Attune control reads.
      magic: { isMagic: true, attunementRequired: true, slot: "held" }
    };
    const holding = { ...ACTOR, inventory: [stored] } as unknown as PlayerActor;
    render(<CharacterSheet actor={holding} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await openGear(user);

    const row = screen.getByText("Wand of the War Mage, +1").closest("button") as HTMLElement;
    expect(row).toBeTruthy();
    // The rendered row on the sheet carries the SRD rarity and attunement requirement for this tier.
    expect(row.textContent).toContain("Wand, Uncommon (Requires Attunement by a Spellcaster).");
    // Its detail holds the whole entry, and the Attune control the requirement is asking about.
    await user.click(row);
    const detail = within(screen.getByRole("region", { name: "Wand of the War Mage, +1" }));
    expect(detail.getByText(/While holding this wand, you gain a bonus to spell attack rolls/)).toBeTruthy();
    expect(detail.getByRole("button", { name: "Attune" })).toBeTruthy();
  });

  it("makes all 270 magic rows reachable without scrolling a 400-row list", async () => {
    serveCatalog();
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={() => {}} onClose={() => {}} />);
    await screen.findByRole("searchbox", { name: "Search equipment" });
    const user = userEvent.setup();
    // Every magic category has a filter chip.
    for (const [chip, count] of [
      ["Wondrous", 127],
      ["Rings", 22],
      ["Wands & Rods", 34]
    ] as const) {
      await user.click(screen.getByRole("button", { name: chip }));
      expect(screen.getAllByRole("listitem"), chip).toHaveLength(count);
    }
    await user.click(screen.getByRole("button", { name: "Consumables" }));
    // The 50 gp potion and the three stronger ones the magic item table prints, each its own row.
    const names = screen
      .getAllByRole("listitem")
      .map((row) => within(row).getByRole("button").getAttribute("aria-label"));
    expect(names).toContain("Add Potion of Healing");
    for (const strength of ["greater", "superior", "supreme"])
      expect(names).toContain(`Add Potion of Healing (${strength})`);
    expect(names).not.toContain("Add Potions of Healing");
  });

  it("keeps a table-bearing entry legible: Armor of Resistance browses as one row, not ten", async () => {
    serveCatalog();
    render(<EquipmentPicker ownedCounts={new Map()} busy={false} onAdd={() => {}} onClose={() => {}} />);
    await userEvent
      .setup()
      .type(await screen.findByRole("searchbox", { name: "Search equipment" }), "armor of resistance");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    // Its d10 table went into the description, so there are no ten near-identical browse rows.
    expect(rows[0].textContent).toContain("Armor (Any Light, Medium, or Heavy), Rare (Requires Attunement).");
    expect(rows[0].textContent).toContain("1d10 1: Damage Type Acid");
  });

  it("does not put a wand's mechanics on the wire, only what a browse row and an inventory row already carried", () => {
    // The browse projection has exactly these keys, none of them a rider, a cast or a cursed flag.
    // `appliesTo` (the printed eligibility qualifier plus resolved base ids) is SRD reference text,
    // identical for every viewer; it is null for the wand (only weapon/armor templates carry one).
    const wand = CATALOG.find((item) => item.id === "wand-of-the-war-mage-1")!;
    expect(wand.appliesTo).toBeNull();
    expect(Object.keys(wand).sort()).toEqual([
      "appliesTo",
      "armor",
      "category",
      "costGp",
      "description",
      "id",
      "name",
      "source",
      "weapon",
      "weightLb"
    ]);
    for (const key of [
      "modifiers",
      "effects",
      "actions",
      "casts",
      "cursed",
      "uses",
      "grants",
      "rarity",
      "attunement"
    ]) {
      expect(wand, key).not.toHaveProperty(key);
    }
  });
});

describe("the base chooser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a choice template inserts ONE step: the eligible-base list, and the add completes with the pick", async () => {
    serveCatalog();
    const added: Array<{ id: string; baseId?: string }> = [];
    render(
      <EquipmentPicker
        ownedCounts={new Map()}
        busy={false}
        onAdd={(item, baseId) => added.push({ id: item.id, ...(baseId ? { baseId } : {}) })}
        onClose={() => {}}
      />
    );
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));

    // Nothing added yet: the chooser opened and shows the printed form and real bases.
    expect(added).toEqual([]);
    expect(screen.getByText(/applies to Any Simple or Martial/)).toBeTruthy();
    // All 38 bases are offered, each with its own numbers on the row.
    const options = screen.getAllByRole("listitem");
    expect(options).toHaveLength(38);
    const greatsword = options.find((row) => within(row).queryByRole("button", { name: "Make it a Greatsword" }));
    expect(greatsword!.textContent).toContain("2d6 slashing");

    // The search carries into the chooser.
    await user.type(screen.getByRole("searchbox", { name: "Search bases" }), "dagger");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Make it a Dagger" }));
    expect(added).toEqual([{ id: "weapon-1", baseId: "dagger" }]);
  });

  it("a single-base template never asks, and an owned choice template asks again for the new copy", async () => {
    serveCatalog();
    const added: Array<{ id: string; baseId?: string }> = [];
    const picker = render(
      <EquipmentPicker
        ownedCounts={new Map()}
        busy={false}
        onAdd={(item, baseId) => added.push({ id: item.id, ...(baseId ? { baseId } : {}) })}
        onClose={() => {}}
      />
    );
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Dwarven Thrower");
    await user.click(screen.getByRole("button", { name: "Add Dwarven Thrower" }));
    // The server auto-binds the lone base: no chooser, no baseId.
    expect(added).toEqual([{ id: "dwarven-thrower" }]);
    picker.unmount();

    // Another copy may be another base (a +1 longsword beside a +1 dagger), so the chooser opens again.
    render(
      <EquipmentPicker
        ownedCounts={new Map([["weapon-1", 1]])}
        busy={false}
        onAdd={(item, baseId) => added.push({ id: item.id, ...(baseId ? { baseId } : {}) })}
        onClose={() => {}}
      />
    );
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));
    expect(added).toEqual([{ id: "dwarven-thrower" }]);
    await user.click(screen.getByRole("button", { name: "Make it a Longsword" }));
    expect(added).toEqual([{ id: "dwarven-thrower" }, { id: "weapon-1", baseId: "longsword" }]);
  });
});

describe("the wire seam: the real sheet ships the pick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Serves the catalog and captures every mutation emit, so assertions are on the wire itself. */
  function captureEmits(): Array<{ event: string; payload: Record<string, unknown> }> {
    const emits: Array<{ event: string; payload: Record<string, unknown> }> = [];
    (socket.emit as unknown as { mockImplementation: (fn: unknown) => void }).mockImplementation(
      (event: string, payload: Record<string, unknown>, ack?: (result: unknown) => void) => {
        if (event === "content:equipment") {
          ack?.({ ok: true, equipment: CATALOG, attribution: "SRD 5.2.1, CC BY 4.0." });
          return;
        }
        emits.push({ event, payload });
        ack?.({ ok: true });
      }
    );
    return emits;
  }

  it("addFromCatalog carries the chooser's pick as baseId, and ships NO stats - the server copies them", async () => {
    const emits = captureEmits();
    render(<CharacterSheet actor={ACTOR} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await openGear(user);
    await user.click(await screen.findByRole("button", { name: "Browse SRD gear" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));
    await user.click(await screen.findByRole("button", { name: "Make it a Dagger" }));

    const emit = emits.find((entry) => entry.event === "character:set-inventory");
    expect(emit, "the pick never reached the wire").toBeTruthy();
    expect(emit!.payload.item).toMatchObject({ id: "weapon-1", baseId: "dagger", quantity: 1 });
    // A template's catalog summary has `weapon: null`, so the client sends no block; binding is the
    // server's job.
    expect((emit!.payload.item as Record<string, unknown>).weapon).toBeUndefined();
  });

  it("a copy on the same base grows the stack; on another base it is its own row of the same record", async () => {
    const emits = captureEmits();
    const bound = {
      id: "weapon-1",
      name: "Weapon, +1",
      quantity: 1,
      equipped: true,
      attuned: false,
      category: "weapon",
      baseId: "dagger",
      weapon: {
        category: "simple",
        damageDice: "1d4",
        damageType: "piercing",
        rangeFeet: 20,
        longRangeFeet: 60,
        properties: ["finesse", "light", "thrown"]
      }
    };
    const holding = { ...ACTOR, inventory: [bound] } as unknown as PlayerActor;
    render(<CharacterSheet actor={holding} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await openGear(user);
    await user.click(await screen.findByRole("button", { name: "Browse SRD gear" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));
    await user.click(await screen.findByRole("button", { name: "Make it a Dagger" }));
    const sent = () =>
      emits.filter((entry) => entry.event === "character:set-inventory").map((entry) => entry.payload.item);
    expect(sent()[0]).toMatchObject({ id: "weapon-1", baseId: "dagger", quantity: 2 });
    expect((sent()[0] as Record<string, unknown>).recordId).toBeUndefined();

    await user.click(await screen.findByRole("button", { name: "Browse SRD gear" }));
    await user.type(await screen.findByRole("searchbox", { name: "Search equipment" }), "Weapon, +1");
    await user.click(screen.getByRole("button", { name: "Add Weapon, +1" }));
    await user.click(await screen.findByRole("button", { name: "Make it a Longsword" }));
    expect(sent()[1]).toMatchObject({ id: "weapon-1-2", recordId: "weapon-1", baseId: "longsword", quantity: 1 });
  });

  it("an unbound legacy row shows its base chooser, and the bind rides the row it already is", async () => {
    const emits = captureEmits();
    const legacy = {
      id: "weapon-2",
      name: "Weapon, +2",
      quantity: 1,
      equipped: true,
      attuned: false,
      category: "weapon"
    };
    const holding = { ...ACTOR, inventory: [legacy] } as unknown as PlayerActor;
    render(<CharacterSheet actor={holding} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await openGear(user);
    await user.click(await screen.findByText("Weapon, +2"));
    // The bound-base display is absent and the one sheet-side chooser is offered instead.
    await user.click(await screen.findByRole("button", { name: "Choose what it is" }));
    await user.click(await screen.findByRole("button", { name: "Make it a Warhammer" }));

    const emit = emits.find((entry) => entry.event === "character:set-inventory");
    expect(emit!.payload.item).toMatchObject({ id: "weapon-2", baseId: "warhammer", quantity: 1, equipped: true });
  });
});
