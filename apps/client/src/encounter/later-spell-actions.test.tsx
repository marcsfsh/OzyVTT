import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ActorDefinition } from "@vtt/domain";

let rows: unknown[] = [];
const read = vi.fn(async (..._args: unknown[]) => ({ ok: true, actions: rows }));
vi.mock("../lib/command", () => ({
  command: vi.fn(async () => ({ ok: true })),
  read: (...args: unknown[]) => read(...args)
}));

import { PlayerActionRunner } from "./PlayerActionRunner";

// What a spell lets its caster do on later turns is offered while the spell is up, at the level it was cast at;
// what its area does is the server's to run, never a player's tap.

const ME = "10000000-0000-4000-8000-000000000001";

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  activation: "bonus-action",
  available: true,
  violations: [],
  usesRemaining: null,
  componentsRemaining: null,
  description: `${name}.`,
  attackBonus: 7,
  reachFeet: 65,
  rangeFeet: null,
  rangeNormalFeet: null,
  attackCount: null,
  saveAbility: null,
  saveDc: null,
  damage: [{ formula: "1d8 + 4", type: "force" }],
  usesLimit: null,
  usesPer: null,
  usesPool: null,
  requiresEffectTag: null,
  multiattack: null,
  reaction: null,
  ...extra
});

const CLERIC = {
  name: "Mira",
  actions: [
    {
      id: "spell-spiritual-weapon-then-attack",
      name: "Spiritual Weapon: attack",
      activation: "bonus-action",
      description: "On your later turns, a Bonus Action moves the force up to 20 feet and repeats the attack.",
      attack: { bonus: 7, reachFeet: 65 },
      damage: [{ formula: "1d8 + 4", type: "force" }],
      spellId: "spiritual-weapon"
    },
    {
      id: "spell-spirit-guardians-then-save",
      name: "Spirit Guardians: save",
      activation: "other",
      description: "When the Emanation enters a creature's space, it makes the save.",
      save: { ability: "wis", dc: 15, successDamage: "half", failureConditions: [] },
      damage: [{ formula: "3d8", type: "radiant" }],
      spellId: "spirit-guardians"
    }
  ]
} as unknown as ActorDefinition;

const mount = (effectTags: readonly string[] = []) =>
  render(
    <PlayerActionRunner
      actorId={ME}
      definition={CLERIC}
      revision={1}
      playerDamageMode="proposal"
      targets={[]}
      effectTags={effectTags}
    />
  );

describe("a spell's later actions on a player's turn", () => {
  it("waits for the spell to be up before offering its attack", async () => {
    rows = [
      row("spell-spiritual-weapon-then-attack", "Spiritual Weapon: attack", {
        available: false,
        violations: [
          { rule: "feature.requires-effect", message: "Mira doesn't have Spiritual Weapon up - cast it first." }
        ]
      })
    ];
    mount();
    await waitFor(() => expect(read).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: /Spiritual Weapon: attack/ })).toBeNull());
  });

  it("offers it at the level the spell was cast at, and never the area's save", async () => {
    rows = [
      row("spell-spiritual-weapon-then-attack", "Spiritual Weapon: attack", {
        damage: [{ formula: "2d8 + 4", type: "force" }]
      })
    ];
    mount(["concentrating"]);
    const attack = await screen.findByRole("button", { name: /Spiritual Weapon: attack/ });
    await waitFor(() => expect(attack.textContent).toContain("2d8 + 4 force damage"));
    expect(screen.queryByRole("button", { name: /Spirit Guardians: save/ })).toBeNull();
  });
});
