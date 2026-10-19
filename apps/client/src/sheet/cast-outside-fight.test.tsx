import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { GmActor, GmView } from "@vtt/domain";

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

// Every spell the sheet knows is cast through the server, a cantrip with nothing to roll included (Light). Outside a
// fight a cast at creatures it helps asks whom it targets first (Aid), so the server can resolve it as in a fight.

const HERO = "10000000-0000-4000-8000-000000000001";
const FRIEND = "10000000-0000-4000-8000-000000000002";

const LIGHT = {
  id: "spell-light",
  name: "Light",
  activation: "action",
  description: "You touch one Large or smaller object.",
  damage: [],
  spellId: "light"
};
const AID = {
  id: "spell-aid",
  name: "Aid",
  activation: "action",
  description: "Choose up to three creatures within range.",
  damage: [],
  spellSlot: { level: 2 },
  spellId: "aid"
};
const row = (action: typeof LIGHT | typeof AID, targeting: "none" | "multi") => ({
  id: action.id,
  name: action.name,
  activation: "action",
  available: true,
  violations: [],
  usesRemaining: null,
  description: action.description,
  attackBonus: null,
  saveAbility: null,
  damage: [],
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  targeting
});

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const sent = (event: string) =>
  emit.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => {
      const { commandId: _commandId, ...payload } = call[1] as Record<string, unknown>;
      return payload;
    });
const fixture = ActorDefinitionSchema.parse(loadActorFixture("player-character"));
const creature = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 30, temporary: 0 },
    conditions: [],
    effects: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ...extra
  }) as unknown as GmActor;
const hero = creature(HERO, "Mira", {
  spellSlots: [{ level: 2, remaining: 3 }],
  preparedSpellIds: ["aid"],
  definitionId: "srd:player-character",
  definition: ActorDefinitionSchema.parse({
    ...fixture,
    actions: [LIGHT, AID],
    spellcasting: {
      ability: "wis",
      saveDc: 13,
      attackBonus: 5,
      slots: [{ level: 2, max: 3 }],
      spells: [
        { id: "light", name: "Light", level: 0, prepared: true, alwaysPrepared: true, actionId: "spell-light" },
        { id: "aid", name: "Aid", level: 2, prepared: true, alwaysPrepared: false, actionId: "spell-aid" }
      ]
    }
  })
});
const state = {
  revision: 2,
  actors: [hero, creature(FRIEND, "Bryn")],
  rolls: [],
  rollCalls: [],
  combat: { active: false, initiative: [], pendingSaves: [], ruleExceptions: {}, rulesMode: "strict" }
} as unknown as GmView;

const mount = () =>
  render(<CharacterSheet actor={hero} role="gm" state={state} presentation="page" onClose={() => {}} />, {
    wrapper: ToastProvider
  });

describe("a spell cast from the Spells tab outside a fight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTargeting();
    emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) => {
      if (event === "actor:available-actions")
        ack?.({ ok: true, rulesMode: "strict", actions: [row(LIGHT, "none"), row(AID, "multi")] });
      else ack?.({ ok: true, route: "resolved" });
    });
  });

  it("sends a cantrip with nothing to roll to the server, which casts it", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("tab", { name: "Spells" }));
    await user.click(await screen.findByRole("button", { name: "Cast Light" }));
    await waitFor(() =>
      expect(sent("action:use")).toEqual([{ actorId: HERO, actionId: "spell-light", includeDamage: true }])
    );
  });

  it("asks whom Aid targets, then sends them with the slot", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("tab", { name: "Spells" }));
    await user.click(await screen.findByRole("button", { name: "Cast Aid" }));
    await user.click(
      within(screen.getByRole("region", { name: "Cast Aid" })).getByRole("button", { name: "Cast at level 2" })
    );
    const dialog = screen.getByRole("dialog", { name: "Who Aid targets" });
    expect(within(dialog).getByText("Choose the creatures Aid targets.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Bryn" }));
    await user.click(within(dialog).getByRole("button", { name: "Cast" }));
    await waitFor(() =>
      expect(sent("action:use")).toEqual([
        { actorId: HERO, actionId: "spell-aid", targetIds: [HERO, FRIEND], slotLevel: 2, includeDamage: true }
      ])
    );
  });
});
