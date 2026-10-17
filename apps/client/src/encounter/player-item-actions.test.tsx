import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActorDefinition, ContentActionSummary } from "@vtt/domain";

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
import { PlayerActionRunner } from "./PlayerActionRunner";

// What a player's turn offers from the pack: the server says which item actions resolve and whom they pick.

const ME = "10000000-0000-4000-8000-000000000001";
const ALLY = "10000000-0000-4000-8000-000000000002";
const definition = {
  name: "Aria",
  abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
  proficiencyBonus: 2,
  actions: []
} as unknown as ActorDefinition;
const ROW: ContentActionSummary = {
  id: "",
  name: "",
  activation: "action",
  description: "",
  attackBonus: null,
  reachFeet: null,
  rangeFeet: null,
  rangeNormalFeet: null,
  saveAbility: null,
  saveDc: null,
  damage: [],
  area: null,
  attackCount: null,
  usesLimit: null,
  usesPer: null,
  usesRecharge: null,
  usesPool: null,
  requiresEffectTag: null,
  multiattack: null,
  grants: false,
  reaction: null
};
const POTION: ContentActionSummary = {
  ...ROW,
  id: "item-potion-of-healing-drink",
  name: "Drink Potion of Healing",
  activation: "bonus-action",
  healing: { formula: "2d4 + 2" },
  targeting: "single"
};
const SCROLL: ContentActionSummary = {
  ...ROW,
  id: "item-spell-scroll-read",
  name: "Cast Detect Magic (Spell Scroll)",
  targeting: "none"
};
/** Prose the server resolves nothing for: its row says nothing about whom it picks. */
const PROSE: ContentActionSummary = { ...ROW, id: "item-deck-draw", name: "Draw a Card" };

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const sent = (event: string) => emit.mock.calls.filter((call) => call[0] === event).map((call) => call[1]);

describe("a player's item actions in the fight", () => {
  it("offers a potion and a scroll, reads the scroll at a tap, and lets the potion's drinker be its holder", async () => {
    emit.mockImplementation((_event: string, _payload: unknown, ack?: (result: unknown) => void) =>
      ack?.({ ok: true })
    );
    render(
      <PlayerActionRunner
        actorId={ME}
        definition={definition}
        extraActions={[POTION, SCROLL, PROSE]}
        revision={7}
        playerDamageMode="proposal"
        targets={[
          { actorId: ME, name: "Aria" },
          { actorId: ALLY, name: "Brann" }
        ]}
      />
    );
    expect(screen.queryByRole("button", { name: /Draw a Card/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Drink Potion of Healing/ }).textContent).toContain("Heals 2d4 + 2");

    const user = userEvent.setup();
    // Nothing to aim: it resolves on the tap.
    await user.click(screen.getByRole("button", { name: /Cast Detect Magic/ }));
    expect(sent("action:resolve")).toEqual([
      expect.objectContaining({ actorId: ME, actionId: "item-spell-scroll-read", expectedRevision: 7 })
    ]);

    // Drunk or handed over: the holder is one of the creatures it can go to.
    await user.click(screen.getByRole("button", { name: /Drink Potion of Healing/ }));
    const picker = screen.getByRole("group", { name: "Targets for Drink Potion of Healing" });
    expect(within(picker).getByRole("radio", { name: "Aria" })).toBeTruthy();
    expect(within(picker).getByRole("radio", { name: "Brann" })).toBeTruthy();
  });
});

describe("whom a player's own touch can pick", () => {
  it("offers the player's own character for a cure, and never for an attack", async () => {
    const cure: ContentActionSummary = {
      ...ROW,
      id: "spell-lesser-restoration",
      name: "Lesser Restoration",
      targeting: "single",
      conditionChoices: ["blinded", "deafened", "paralyzed", "poisoned"]
    };
    const dart: ContentActionSummary = {
      ...ROW,
      id: "item-dart",
      name: "Dart",
      attackBonus: 4,
      rangeFeet: 60,
      damage: [{ formula: "1d4", type: "piercing" }],
      targeting: "single"
    };
    render(
      <PlayerActionRunner
        actorId={ME}
        definition={definition}
        extraActions={[cure, dart]}
        revision={7}
        playerDamageMode="proposal"
        targets={[
          { actorId: ME, name: "Aria" },
          { actorId: ALLY, name: "Brann" }
        ]}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Lesser Restoration/ }));
    const picker = screen.getByRole("group", { name: "Targets for Lesser Restoration" });
    expect(within(picker).getByRole("radio", { name: "Aria" })).toBeTruthy();
    await user.click(within(picker).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: /Dart/ }));
    const aim = screen.getByRole("group", { name: "Targets for Dart" });
    expect(within(aim).queryByRole("radio", { name: "Aria" })).toBeNull();
    expect(within(aim).getByRole("radio", { name: "Brann" })).toBeTruthy();
  });
});
