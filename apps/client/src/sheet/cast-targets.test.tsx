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

// A spell cast from the sheet on the player's turn aims where the server says it aims: Spirit Guardians' Emanation
// moves with its caster, so its cast picks no creature.

const HERO = "10000000-0000-4000-8000-000000000001";
const WOLF = "10000000-0000-4000-8000-000000000002";

const GUARDIANS = {
  id: "spell-spirit-guardians",
  name: "Spirit Guardians",
  activation: "action",
  description: "Protective spirits flit around you in a 15-foot Emanation.",
  damage: [],
  spellSlot: { level: 3 },
  spellId: "spirit-guardians"
};
// A weapon, so the sheet's runner has a row of its own to show.
const MACE = {
  id: "mace",
  name: "Mace",
  activation: "action",
  description: "Melee Attack Roll: +5, reach 5 ft.",
  attack: { bonus: 5, reachFeet: 5 },
  damage: [{ formula: "1d6 + 3", type: "bludgeoning" }]
};
const GUARDIANS_ROW = {
  id: "spell-spirit-guardians",
  name: "Spirit Guardians",
  activation: "action",
  available: true,
  violations: [],
  usesRemaining: null,
  description: GUARDIANS.description,
  attackBonus: null,
  damage: [],
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  targeting: "none"
};

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const hero = {
  id: HERO,
  name: "Mira",
  kind: "player-character",
  visibility: "public",
  hp: { current: 30, maximum: 30, temporary: 0 },
  conditions: [],
  effects: [],
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  spellSlots: [{ level: 3, remaining: 2 }],
  preparedSpellIds: ["spirit-guardians"],
  definitionId: "srd:player-character",
  definition: ActorDefinitionSchema.parse({
    ...fixture,
    actions: [MACE, GUARDIANS],
    spellcasting: {
      ability: "wis",
      saveDc: 15,
      attackBonus: 7,
      slots: [{ level: 3, max: 2 }],
      spells: [
        {
          id: "spirit-guardians",
          name: "Spirit Guardians",
          level: 3,
          prepared: true,
          alwaysPrepared: true,
          actionId: "spell-spirit-guardians"
        }
      ]
    }
  })
} as unknown as PlayerActor;
const wolf = { ...hero, id: WOLF, name: "Wolf", kind: "monster", definitionId: undefined, definition: undefined };
const state = {
  revision: 3,
  actors: [hero, wolf],
  rolls: [],
  rollCalls: [],
  combat: {
    active: true,
    round: 1,
    turnActorId: HERO,
    initiative: [
      { actorId: HERO, name: "Mira", score: 15 },
      { actorId: WOLF, name: "Wolf", score: 10 }
    ],
    playerDamageMode: "proposal",
    pendingSaves: [],
    ruleExceptions: {},
    rulesMode: "strict"
  }
} as unknown as PlayerView;

describe("a spell cast from the sheet in a fight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTargeting();
    emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "actor:available-actions") ack?.({ ok: true, rulesMode: "strict", actions: [GUARDIANS_ROW] });
      else ack?.({ ok: true });
    });
  });

  it("picks no target for a cast the server aims at no one", async () => {
    const user = userEvent.setup();
    render(<CharacterSheet actor={hero} role="player" state={state} presentation="page" onClose={() => {}} />, {
      wrapper: ToastProvider
    });
    // From the Spells tab: the cast detail names the slot, then the aim opens at the top of the tab.
    await user.click(await screen.findByRole("tab", { name: "Spells" }));
    await user.click(await screen.findByRole("button", { name: "Cast Spirit Guardians" }));
    const detail = within(screen.getByRole("region", { name: "Cast Spirit Guardians" }));
    expect(detail.getByText(/Next you place its area on the map|It takes effect at once/)).toBeTruthy();
    await user.click(detail.getByRole("button", { name: "Cast at level 3" }));
    const picker = await screen.findByRole("group", { name: "Targets for Spirit Guardians" });
    expect(picker.textContent).toContain("no target to choose. Roll to use it.");
    expect(within(picker).queryByRole("checkbox")).toBeNull();
    expect((within(picker).getByRole("button", { name: "Roll Spirit Guardians" }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});
