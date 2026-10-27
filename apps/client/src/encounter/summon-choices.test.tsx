import { afterEach, describe, expect, it, vi } from "vitest";
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
import { clearTargeting } from "./targeting";

// A summon whose user picks the creature (an Ivory Goat, Find Familiar's forms) asks for it before it resolves; the
// server checks the pick.

const ME = "10000000-0000-4000-8000-000000000001";
const definition = {
  name: "Aria",
  abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
  proficiencyBonus: 2,
  actions: []
} as unknown as ActorDefinition;
/** A summon the server lists from the pack, with the picks its user makes. */
const GOATS: ContentActionSummary = {
  id: "item-figurine-of-wondrous-power-ivory-goats",
  name: "Throw the Ivory Goats",
  activation: "action",
  description: "Throw the figurine: it becomes the goat it is.",
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
  reaction: null,
  targeting: "none",
  summonChoices: {
    forms: [
      { monsterId: "giant-goat", form: "terror", label: "Goat of Terror" },
      { monsterId: "giant-goat", form: "travail", label: "Goat of Travail" }
    ],
    creatureTypes: ["beast", "fey"]
  }
};

const emit = socket.emit as unknown as ReturnType<typeof vi.fn>;
const sent = (event: string) => emit.mock.calls.filter((call) => call[0] === event).map((call) => call[1]);

afterEach(() => clearTargeting());

describe("a summon whose creature its user picks", () => {
  it("asks for the creature and its creature type, and sends both", async () => {
    emit.mockImplementation((event: string, _payload: unknown, ack?: (result: unknown) => void) =>
      ack?.(event === "actor:available-actions" ? { ok: true, rulesMode: "strict", actions: [] } : { ok: true })
    );
    render(
      <PlayerActionRunner
        actorId={ME}
        definition={definition}
        extraActions={[GOATS]}
        revision={4}
        playerDamageMode="proposal"
        targets={[{ actorId: ME, name: "Aria" }]}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Throw the Ivory Goats/ }));
    const picker = screen.getByRole("group", { name: "Targets for Throw the Ivory Goats" });
    expect(within(picker).getByText(/choose its form, then Use/)).toBeTruthy();
    await user.selectOptions(within(picker).getByLabelText("Form"), "Goat of Travail");
    await user.selectOptions(within(picker).getByLabelText("Type"), "Fey");
    await user.click(screen.getByRole("button", { name: "Use Throw the Ivory Goats" }));
    expect(sent("action:resolve")).toEqual([
      expect.objectContaining({
        actorId: ME,
        actionId: "item-figurine-of-wondrous-power-ivory-goats",
        summon: { picks: [{ monsterId: "giant-goat", form: "travail" }], creatureType: "fey" }
      })
    ]);
  });
});
