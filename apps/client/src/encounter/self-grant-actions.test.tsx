import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ActorDefinition } from "@vtt/domain";

const command = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
const read = vi.fn(async (..._args: unknown[]) => ({ ok: true, actions: ROWS }));
vi.mock("../lib/command", () => ({
  command: (...args: unknown[]) => command(...args),
  read: (...args: unknown[]) => read(...args)
}));

import { PlayerActionRunner } from "./PlayerActionRunner";

// A feature whose whole effect is a grant to its user (Reckless Attack, Steady Aim) is on the player's turn list, and
// a tap takes it with no target.

const ME = "10000000-0000-4000-8000-000000000002";

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  activation: "action",
  available: true,
  violations: [],
  usesRemaining: null,
  componentsRemaining: null,
  description: `${name}.`,
  attackBonus: null,
  reachFeet: null,
  rangeFeet: null,
  rangeNormalFeet: null,
  attackCount: null,
  saveAbility: null,
  saveDc: null,
  damage: [],
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  requiresEffectTag: null,
  multiattack: null,
  reaction: null,
  ...extra
});

const ROWS = [
  row("reckless-attack", "Reckless Attack", { activation: "other", targeting: "none" }),
  row("steady-aim", "Steady Aim", { activation: "bonus-action", targeting: "none" })
];

const grant = (name: string) => ({
  name,
  tags: [],
  target: "self",
  duration: { type: "until-source-next-turn" },
  modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage" }]
});

const HERO = {
  name: "Brakka",
  actions: [
    {
      id: "reckless-attack",
      name: "Reckless Attack",
      activation: "other",
      description: "Advantage on Strength attack rolls this turn; attacks against you have Advantage.",
      damage: [],
      grants: grant("Reckless Attack")
    },
    {
      id: "steady-aim",
      name: "Steady Aim",
      activation: "bonus-action",
      description: "Advantage on your next attack roll this turn.",
      damage: [],
      grants: grant("Steady Aim")
    }
  ]
} as unknown as ActorDefinition;

describe("a feature that grants its user an effect", () => {
  it("is offered on the player's turn list and taken with no target", async () => {
    render(
      <PlayerActionRunner
        actorId={ME}
        definition={HERO}
        revision={1}
        playerDamageMode="proposal"
        targets={[]}
        effectTags={[]}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: /Reckless Attack/ }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith(
        "action:resolve",
        expect.objectContaining({ actorId: ME, actionId: "reckless-attack" })
      )
    );
    const sent = command.mock.calls.find((call) => call[0] === "action:resolve")![1] as { targetIds?: unknown };
    expect(sent.targetIds ?? []).toEqual([]);
    expect(screen.getByRole("button", { name: /Steady Aim/ })).toBeTruthy();
  });
});
