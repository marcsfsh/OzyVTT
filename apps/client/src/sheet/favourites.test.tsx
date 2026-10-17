import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ActorDefinition, PlayerActor } from "@vtt/domain";

const timed = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => timed }
}));

import { PlayerActionRunner } from "../encounter/PlayerActionRunner";

// The turn card's pins live on the character: the server stores them, checks each is one of its options now, and
// sends them back with the next state.

const ME = "10000000-0000-4000-8000-000000000001";
const definition = {
  name: "Lyra",
  abilityScores: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
  proficiencyBonus: 3,
  actions: [
    {
      id: "spell-fire-bolt",
      name: "Fire Bolt",
      activation: "action",
      description: "",
      attack: { bonus: 7, rangeFeet: 120 },
      damage: [{ formula: "2d10", type: "fire" }],
      spellId: "fire-bolt"
    },
    {
      id: "second-wind",
      name: "Second Wind",
      activation: "bonus-action",
      description: "",
      damage: [],
      healing: { formula: "1d10 + 7", self: true },
      uses: { limit: 2, per: "long-rest" }
    }
  ]
} as unknown as ActorDefinition;
const lyra = (pins: string[]) =>
  ({
    id: ME,
    name: "Lyra",
    kind: "player-character",
    favouriteOptionIds: pins,
    optionUseCounts: {}
  }) as unknown as PlayerActor;

describe("the turn card's favourites", () => {
  it("are the character's own pins, set through the server", () => {
    timed.emit.mockImplementation((_event: string, _payload: unknown, ack: (error: null, reply: unknown) => void) =>
      ack(null, { ok: true })
    );
    render(
      <PlayerActionRunner
        actorId={ME}
        definition={definition}
        revision={4}
        playerDamageMode="proposal"
        targets={[]}
        actor={lyra(["second-wind"])}
        look="card"
        round={1}
      />
    );
    // Pinned: the card shows the pins alone.
    expect(screen.getByRole("button", { name: /Second Wind/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fire Bolt/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit favourites" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Choose the favourites" })).getByRole("button", { name: /Fire Bolt/ })
    );
    const pinned = timed.emit.mock.calls.filter((call) => call[0] === "character:set-favourites");
    expect(pinned).toHaveLength(1);
    expect(pinned[0]![1]).toMatchObject({ actorId: ME, optionIds: ["second-wind", "spell-fire-bolt"] });
  });
});
