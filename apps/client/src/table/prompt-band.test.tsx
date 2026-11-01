import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlayerView } from "@vtt/domain";
import { ToastProvider } from "@vtt/ui";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }) as Record<string, unknown>);
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: vi.fn(async () => ({ ok: false }))
}));
vi.mock("../socket", () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: true, timeout: () => ({ emit: vi.fn() }) }
}));

import { PromptBand } from "./PromptBand";

const LYRA = "10000000-0000-4000-8000-0000000000e1";
const GOBLIN = "10000000-0000-4000-8000-0000000000e2";

const lyra = (changes: Record<string, unknown> = {}) => ({
  id: LYRA,
  name: "Lyra",
  kind: "player-character",
  visibility: "public",
  claimStatus: "mine",
  hp: { kind: "exact", current: 37, maximum: 44, temporary: 0 },
  armorClass: 15,
  conditions: [],
  effects: [],
  ...changes
});

/** A player's view in a fight, with what their prompt slot must answer laid over it. */
function view(combat: Record<string, unknown> = {}, actor = lyra(), rollCalls: unknown[] = []): PlayerView {
  return {
    revision: 3,
    rollCalls,
    actors: [
      actor,
      {
        id: GOBLIN,
        name: "Goblin 1",
        kind: "monster",
        visibility: "public",
        claimStatus: "available",
        hp: { kind: "band", band: "healthy" },
        conditions: [],
        effects: []
      }
    ],
    combat: {
      active: true,
      round: 2,
      turnActorId: GOBLIN,
      turn: { actionUsed: false, bonusActionUsed: false, turnUses: {}, movementUsedFeet: 0 },
      initiative: [],
      tokens: [],
      pendingReactions: [],
      pendingSaves: [],
      pendingInitiative: [],
      ...combat
    }
  } as unknown as PlayerView;
}

const SHIELD = {
  id: "40000000-0000-4000-8000-0000000000e1",
  kind: "attack-would-hit",
  actorId: LYRA,
  actionId: "spell-shield",
  actionName: "Shield (1st, Reaction)",
  targetActorId: LYRA,
  sourceName: "Goblin 1",
  triggerCommandId: "50000000-0000-4000-8000-0000000000e1",
  proposedDamage: 0,
  proposedDamageParts: [],
  critical: false,
  acBonus: 5,
  rollsAttack: false,
  createdAt: 0,
  attackRoll: 16,
  lastsUntilNextTurn: true
};
const SAVE = {
  id: "40000000-0000-4000-8000-0000000000e2",
  targetActorId: LYRA,
  ability: "dex",
  dc: 15,
  actionName: "Fireball",
  sourceName: "Goblin Shaman",
  proposedDamage: 28,
  proposedDamageParts: [{ amount: 28, type: "fire" }],
  halfOnSuccess: true,
  conditionIds: [],
  saveBonus: 2,
  createdAt: 0
};

describe("the band away from the table", () => {
  it("shows the leading prompt with its kind's tag, counts the rest, and sends a save to the table", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <PromptBand state={view({ pendingReactions: [SHIELD], pendingSaves: [SAVE] })} />
      </ToastProvider>
    );
    const band = screen.getByRole("group", { name: /^Reaction: / });
    expect(within(band).getByText("Reaction")).toBeTruthy();
    expect(within(band).getByText("1 more")).toBeTruthy();
    await user.click(within(band).getByRole("button", { name: "Go to the table" }));
    expect(window.location.pathname).toBe("/table");
  });

  it("shows nothing while nothing waits", () => {
    const { container } = render(
      <ToastProvider>
        <PromptBand state={view()} />
      </ToastProvider>
    );
    expect(container.querySelector(".prompt-band-dock")).toBeNull();
  });
});
