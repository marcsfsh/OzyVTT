import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { PlayerActor, PlayerView } from "@vtt/domain";

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
import { clearTargeting } from "../encounter/targeting";

// SRD Metamagic: the Sorcerer's cast offers the options it knows, each with its Sorcery Point cost and the server's word
// on whether this spell can take it; the picks travel with the cast, and the creatures an option names are chosen
// among the cast's targets.

const HERO = "10000000-0000-4000-8000-000000000001";
const WOLF = "10000000-0000-4000-8000-000000000002";
const BRAN = "10000000-0000-4000-8000-000000000003";

const BURST = {
  id: "spell-fire-burst",
  name: "Fire Burst",
  activation: "action",
  description: "Each creature you choose makes a Dexterity saving throw, taking 3d6 Fire damage on a failed save.",
  save: { ability: "dex", dc: 15, successDamage: "half", failureConditions: [] },
  damage: [{ formula: "3d6", type: "fire" }],
  spellSlot: { level: 3 },
  spellId: "fire-burst"
};
const SHAPING = {
  limit: 1,
  points: 5,
  options: [
    { id: "careful-spell", name: "Careful Spell", cost: 1, available: true, counted: true, creatures: { count: 3 } },
    { id: "empowered-spell", name: "Empowered Spell", cost: 1, available: true, counted: false },
    { id: "quickened-spell", name: "Quickened Spell", cost: 2, available: true, counted: true },
    {
      id: "transmuted-spell",
      name: "Transmuted Spell",
      cost: 1,
      available: true,
      counted: true,
      damageTypes: ["acid", "cold", "lightning", "poison", "thunder"]
    },
    {
      id: "twinned-spell",
      name: "Twinned Spell",
      cost: 1,
      available: false,
      counted: true,
      reason: "Twinned Spell raises a spell that targets another creature at a higher level, and Fire Burst doesn't."
    }
  ]
};
const BURST_ROW = {
  id: "spell-fire-burst",
  name: "Fire Burst",
  activation: "action",
  available: true,
  violations: [],
  usesRemaining: null,
  description: BURST.description,
  attackBonus: null,
  saveAbility: "dex",
  saveDc: 15,
  damage: BURST.damage,
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  targeting: "multi",
  shaping: SHAPING
};

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const hero = {
  id: HERO,
  name: "Ilde",
  kind: "player-character",
  visibility: "public",
  hp: { current: 30, maximum: 30, temporary: 0 },
  conditions: [],
  effects: [],
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  spellSlots: [{ level: 3, remaining: 2 }],
  preparedSpellIds: ["fire-burst"],
  definitionId: "srd:player-character",
  definition: ActorDefinitionSchema.parse({
    ...fixture,
    actions: [BURST],
    spellcasting: {
      ability: "cha",
      saveDc: 15,
      attackBonus: 7,
      slots: [{ level: 3, max: 2 }],
      spells: [
        {
          id: "fire-burst",
          name: "Fire Burst",
          level: 3,
          prepared: true,
          alwaysPrepared: true,
          actionId: "spell-fire-burst"
        }
      ]
    }
  })
} as unknown as PlayerActor;
const other = (id: string, name: string, kind: string) =>
  ({ ...hero, id, name, kind, definitionId: undefined, definition: undefined }) as unknown as PlayerActor;
const state = {
  revision: 3,
  actors: [hero, other(WOLF, "Wolf", "monster"), other(BRAN, "Bran", "npc")],
  rolls: [],
  rollCalls: [],
  combat: {
    active: true,
    round: 1,
    turnActorId: HERO,
    initiative: [
      { actorId: HERO, name: "Ilde", score: 15 },
      { actorId: WOLF, name: "Wolf", score: 10 },
      { actorId: BRAN, name: "Bran", score: 5 }
    ],
    playerDamageMode: "proposal",
    pendingSaves: [],
    ruleExceptions: {},
    rulesMode: "strict"
  }
} as unknown as PlayerView;

/** The sheet on its Spells tab, with Fire Burst's cast open. */
async function openCast() {
  const user = userEvent.setup();
  render(<CharacterSheet actor={hero} role="player" state={state} presentation="page" onClose={() => {}} />, {
    wrapper: ToastProvider
  });
  await user.click(await screen.findByRole("tab", { name: "Spells" }));
  await user.click(await screen.findByRole("button", { name: "Cast Fire Burst" }));
  return { user, detail: within(screen.getByRole("region", { name: "Cast Fire Burst" })) };
}

/** The `action:resolve` payload the sheet sent. */
const resolved = () =>
  emit.mock.calls.find(([event]) => event === "action:resolve")?.[1] as Record<string, unknown> | undefined;

describe("the cast offers the Sorcerer's Metamagic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTargeting();
    emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "actor:available-actions") ack?.({ ok: true, rulesMode: "strict", actions: [BURST_ROW] });
      else ack?.({ ok: true, resolution: { actionName: "Fire Burst", damage: [], damageTotal: 0 } });
    });
  });

  it("lists each option with its cost, and says why one can't shape this spell", async () => {
    const { user, detail } = await openCast();
    const shape = within(detail.getByRole("group", { name: "Shape the spell" }));
    expect(detail.getByText("Metamagic · 5 Sorcery Points left")).toBeTruthy();
    expect(shape.getByRole("button", { name: /^Quickened Spell/ }).textContent).toContain("2 Sorcery Points");
    const twinned = shape.getByRole("button", { name: /^Twinned Spell/ }) as HTMLButtonElement;
    expect(twinned.disabled).toBe(true);
    expect(twinned.textContent).toContain("and Fire Burst doesn't.");
    // One counted option a spell: picking Quickened Spell closes the other counted ones, and Empowered Spell stays.
    await user.click(shape.getByRole("button", { name: /^Quickened Spell/ }));
    expect((shape.getByRole("button", { name: /^Careful Spell/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((shape.getByRole("button", { name: /^Empowered Spell/ }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(shape.getByRole("button", { name: /^Empowered Spell/ }));
    expect(detail.getByText("It spends 3 Sorcery Points.")).toBeTruthy();
  });

  it("sends Careful Spell with the creature chosen among the targets", async () => {
    const { user, detail } = await openCast();
    await user.click(detail.getByRole("button", { name: /Careful Spell/ }));
    expect(detail.getByText(/Choose who Careful Spell protects when you aim it/)).toBeTruthy();
    await user.click(detail.getByRole("button", { name: "Cast at level 3" }));
    const picker = within(await screen.findByRole("group", { name: "Targets for Fire Burst" }));
    await user.click(picker.getByRole("checkbox", { name: /Wolf/ }));
    await user.click(picker.getByRole("checkbox", { name: /Bran/ }));
    const roll = picker.getByRole("button", { name: "Roll Fire Burst" }) as HTMLButtonElement;
    expect(roll.disabled).toBe(true);
    const careful = within(picker.getByRole("group", { name: /Careful Spell protects · up to 3/ }));
    await user.click(careful.getByRole("checkbox", { name: "Bran" }));
    expect(roll.disabled).toBe(false);
    await user.click(roll);
    expect(resolved()).toMatchObject({
      actionId: "spell-fire-burst",
      targetIds: [WOLF, BRAN],
      slotLevel: 3,
      shaping: [{ id: "careful-spell", creatureIds: [BRAN] }]
    });
  });

  it("sends Transmuted Spell with the damage type picked", async () => {
    const { user, detail } = await openCast();
    await user.click(detail.getByRole("button", { name: /Transmuted Spell/ }));
    await user.selectOptions(detail.getByRole("combobox", { name: "Change its damage to" }), "cold");
    await user.click(detail.getByRole("button", { name: "Cast at level 3" }));
    const picker = within(await screen.findByRole("group", { name: "Targets for Fire Burst" }));
    await user.click(picker.getByRole("checkbox", { name: /Wolf/ }));
    await user.click(picker.getByRole("button", { name: "Roll Fire Burst" }));
    expect(resolved()).toMatchObject({ shaping: [{ id: "transmuted-spell", damageType: "cold" }] });
  });
});
