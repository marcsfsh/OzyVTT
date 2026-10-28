import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

import { PromptSlot } from "./PromptSlot";

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

const slot = (state: PlayerView, onSettled?: () => HTMLElement | null) =>
  render(
    <ToastProvider>
      <PromptSlot state={state} {...(onSettled ? { onSettled } : {})} />
    </ToastProvider>
  );

describe("the player's prompt slot", () => {
  it("holds one prompt at a time, the reaction first, says what comes after, and takes the focus", () => {
    slot(view({ pendingReactions: [SHIELD], pendingSaves: [SAVE] }));
    const region = screen.getByRole("region", { name: "Answer now" });
    expect(region).toBeTruthy();
    const heading = screen.getByRole("heading", { name: "Goblin 1's attack would hit you" });
    expect(document.activeElement).toBe(heading);
    expect(
      screen.getByText(
        "The roll is 16 against your AC 15. Shield gives you +5 AC until the start of your next turn, so this hit becomes a miss."
      )
    ).toBeTruthy();
    // The numbers the choice turns on: the roll the player saw, their AC, and their AC with Shield.
    const numbers = [...document.querySelectorAll(".prompt-card-numbers > div")].map((cell) => cell.textContent);
    expect(numbers).toEqual(["16Their roll", "15Your AC", "20With Shield"]);
    expect(screen.getByRole("button", { name: "Take the hit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cast Shield" }).className).toContain("encounter-primary");
    expect(screen.getByText("1 more after this: DC 15 Dexterity saving throw")).toBeTruthy();
    // The reaction is announced for a screen reader.
    expect(screen.getByText("Answer now: Goblin 1's attack would hit you.")).toBeTruthy();
  });

  it("moves on to the next prompt once one is answered, and gives the focus back when the slot empties", () => {
    const back = document.createElement("button");
    document.body.append(back);
    const { rerender } = slot(view({ pendingReactions: [SHIELD], pendingSaves: [SAVE] }), () => back);
    rerender(
      <ToastProvider>
        <PromptSlot state={view({ pendingSaves: [SAVE] })} onSettled={() => back} />
      </ToastProvider>
    );
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "DC 15 Dexterity saving throw" }));
    expect(screen.getByText("Goblin Shaman's Fireball: 28 damage on a failure, half on a success.")).toBeTruthy();
    rerender(
      <ToastProvider>
        <PromptSlot state={view()} onSettled={() => back} />
      </ToastProvider>
    );
    expect(screen.queryByRole("region", { name: "Answer now" })).toBeNull();
    expect(document.activeElement).toBe(back);
    back.remove();
  });

  it("opens a dying character's turn on the death save, and lets it go once this turn's save is made", () => {
    const dying = lyra({
      hp: { kind: "exact", current: 0, maximum: 44, temporary: 0 },
      deathSaves: { successes: 0, failures: 1, stable: false }
    });
    const { rerender } = slot(view({ turnActorId: LYRA }, dying));
    expect(screen.getByRole("heading", { name: /You are dying/ })).toBeTruthy();
    expect(screen.getByText("0 successes · 1 failure")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roll death save" })).toBeTruthy();
    rerender(
      <ToastProvider>
        <PromptSlot
          state={view(
            { turnActorId: LYRA, turn: { actionUsed: false, bonusActionUsed: false, deathSaveRolled: true } },
            dying
          )}
        />
      </ToastProvider>
    );
    expect(screen.queryByRole("button", { name: "Roll death save" })).toBeNull();
  });

  it("takes the GM's call for a roll like any other prompt", async () => {
    command.mockClear();
    command.mockResolvedValueOnce({
      ok: true,
      check: { label: "Wisdom (Perception)", total: 14, natural: 13, dc: null, success: null, rollModeSources: [] }
    });
    slot(
      view({}, lyra(), [
        {
          id: "60000000-0000-4000-8000-0000000000e1",
          kind: "check",
          subject: { ability: "wis", skill: "perception" },
          dc: null,
          blind: false,
          entries: [{ actorId: LYRA, answered: false }],
          createdAt: 0
        }
      ])
    );
    expect(screen.getByText("The GM calls for a roll", { selector: "p" })).toBeTruthy();
    const roll = screen.getByRole("button", { name: "Roll Wisdom (Perception) check" });
    await act(async () => roll.click());
    expect(command).toHaveBeenCalledWith("roll-call:answer", {
      callId: "60000000-0000-4000-8000-0000000000e1",
      actorId: LYRA
    });
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });
});
