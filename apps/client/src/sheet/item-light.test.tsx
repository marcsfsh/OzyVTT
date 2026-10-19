import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadEquipment } from "@vtt/content-srd-5.2.1";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { ContentEquipmentSummary, GmActor } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

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
import { CharacterSheet } from "./CharacterSheet";

// A light source on the Gear tab: lit and put out on its row once it is in hand, a Hooded Lantern's hood lowered, and
// a Bullseye Lantern's Cone aimed. The server checks the Tinderbox and spends the Bonus Action.

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
  ...(item.light
    ? {
        light: {
          ...(item.light.always ? { always: true as const } : {}),
          ...(item.light.hooded ? { hooded: true as const } : {}),
          ...(item.light.cone ? { cone: true as const } : {})
        }
      }
    : {})
}));

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
function serve() {
  emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
    if (event === "content:equipment") ack?.({ ok: true, equipment: CATALOG, attribution: "SRD 5.2.1, CC BY 4.0." });
    else if (event === "content:spells") ack?.({ ok: true, spells: [], attribution: "SRD 5.2.1, CC BY 4.0." });
    else ack?.({ ok: true });
  });
}
const sent = (event: string) => emit.mock.calls.filter((call) => call[0] === event).map((call) => call[1]);

const HERO = "10000000-0000-4000-8000-000000000001";
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  quantity: 1,
  equipped: true,
  attuned: false,
  ...extra
});
const hero = (inventory: readonly unknown[]) =>
  ({
    id: HERO,
    name: "Aria",
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 30, temporary: 0 },
    armorClass: 12,
    conditions: [],
    effects: [],
    inventory,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    definitionId: "srd:player-character",
    definition: ActorDefinitionSchema.parse(loadActorFixture("player-character"))
  }) as unknown as GmActor;

const openItem = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole("tab", { name: "Gear" }));
  await user.click((await screen.findByText(name)).closest("button") as HTMLElement);
};

describe("a light source on the Gear tab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lights a torch in hand and puts it out again", async () => {
    serve();
    const { rerender } = render(
      <CharacterSheet actor={hero([row("torch", "Torch")])} role="player" onClose={() => {}} />,
      { wrapper: ToastProvider }
    );
    const user = userEvent.setup();
    await openItem(user, "Torch");
    const light = await screen.findByRole("button", { name: "Light it" });
    expect(light.getAttribute("aria-pressed")).toBe("false");
    await user.click(light);
    expect(sent("item:set-light")).toEqual([expect.objectContaining({ actorId: HERO, itemId: "torch", lit: true })]);
    rerender(<CharacterSheet actor={hero([row("torch", "Torch", { lit: true })])} role="player" onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Lit" }));
    expect(sent("item:set-light").at(-1)).toMatchObject({ itemId: "torch", lit: false });
  });

  it("asks for a light in the pack to be equipped first", async () => {
    serve();
    render(
      <CharacterSheet actor={hero([row("torch", "Torch", { equipped: false })])} role="player" onClose={() => {}} />,
      {
        wrapper: ToastProvider
      }
    );
    await openItem(userEvent.setup(), "Torch");
    expect(await screen.findByText("Equip it to light it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Light it" })).toBeNull();
  });

  it("lowers a Hooded Lantern's hood and aims a Bullseye Lantern", async () => {
    serve();
    const inventory = [row("hooded-lantern", "Lantern, Hooded"), row("bullseye-lantern", "Lantern, Bullseye")];
    render(<CharacterSheet actor={hero(inventory)} role="player" onClose={() => {}} />, { wrapper: ToastProvider });
    const user = userEvent.setup();
    await openItem(user, "Lantern, Hooded");
    await user.click(await screen.findByRole("button", { name: "Lower the hood" }));
    expect(sent("item:set-light").at(-1)).toMatchObject({ itemId: "hooded-lantern", hoodLowered: true });
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByText("Lantern, Bullseye").closest("button") as HTMLElement);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Aim the Lantern, Bullseye" }), "90");
    expect(sent("item:set-light").at(-1)).toMatchObject({ itemId: "bullseye-lantern", facingDegrees: 90 });
  });
});
