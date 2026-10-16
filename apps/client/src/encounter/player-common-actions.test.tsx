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

const ME = "10000000-0000-4000-8000-000000000001";

/** One availability row as the server sends it, with only the fields these tests read. */
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
  row("rapier", "Rapier", { attackBonus: 5 }),
  row("sneak-attack", "Sneak Attack", { activation: "other", usesLimit: 1, usesPer: "turn", ridesAHit: true }),
  row("dodge", "Dodge", { builtin: true, targeting: "none" }),
  row("help", "Help", { builtin: true, targeting: "single" }),
  row("dash-bonus", "Cunning Action: Dash", { builtin: true, targeting: "none", activation: "bonus-action" })
];

const ROGUE = {
  name: "Pip",
  actions: [
    {
      id: "rapier",
      name: "Rapier",
      activation: "action",
      description: "Melee weapon attack.",
      attack: { bonus: 5, reachFeet: 5 },
      damage: [{ formula: "1d8 + 3", type: "piercing" }]
    },
    {
      id: "sneak-attack",
      name: "Sneak Attack",
      activation: "other",
      description: "Once per turn, extra damage on a qualifying hit.",
      damage: [],
      uses: { limit: 1, per: "turn", pool: "sneak-attack" }
    }
  ]
} as unknown as ActorDefinition;

const mount = () =>
  render(
    <PlayerActionRunner
      actorId={ME}
      definition={ROGUE}
      revision={1}
      rollMode="auto"
      bonusMode="auto"
      playerDamageMode="proposal"
      targets={[]}
    />
  );

describe("a player's actions on their turn", () => {
  it("offers the generic actions, a feature's Bonus Action forms among the first", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cunning Action: Dash" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Dodge" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Help" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cunning Action: Dash" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith(
        "action:resolve",
        expect.objectContaining({ actorId: ME, actionId: "dash-bonus" })
      )
    );
  });

  it("points Sneak Attack at a hit's result instead of offering a tap the server refuses", async () => {
    mount();
    await waitFor(() => expect(screen.getByText(/add it to a hit on the attack's result/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Sneak Attack/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Rapier/ })).toBeTruthy();
  });
});
