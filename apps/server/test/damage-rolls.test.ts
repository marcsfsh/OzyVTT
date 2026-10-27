import { describe, expect, it } from "vitest";
import { GameStateSchema, PendingSaveSchema, type ActionResolution } from "@vtt/domain";
import { damageDiceOf, damageRange, holdForDamageRolls, reportedTotal } from "../src/damage-rolls.js";

// ADR-0043: what a player's damage roll asks for, and what a resolve's saves wait on.

const CASTER = "10000000-0000-4000-8000-000000000001";
const GOBLIN = "10000000-0000-4000-8000-000000000002";
const resolution = (over: Partial<ActionResolution> = {}) =>
  ({
    actionName: "Burning Hands",
    activation: "action",
    attack: null,
    save: null,
    damage: [{ formula: "3d6", type: "fire", total: 11 }],
    damageTotal: 11,
    crit: false,
    ...over
  }) as ActionResolution;

describe("a damage roll's dice", () => {
  it("adds up the dice of every part and what is added to them, flat effects included", () => {
    const dice = damageDiceOf(
      resolution({
        damage: [
          { formula: "2d8 + 3", type: "slashing", total: 12 },
          { formula: "1d6", type: "fire", total: 4, source: "Flame Tongue" }
        ],
        bonusDamage: [{ amount: 2, type: "slashing", source: "Rage" }]
      })
    );
    expect(dice).toEqual({
      formula: "2d8 + 1d6 + 5",
      dice: [
        { count: 2, sides: 8 },
        { count: 1, sides: 6 }
      ],
      fixed: 5
    });
    expect(damageRange(dice!)).toEqual({ min: 8, max: 27 });
    expect(reportedTotal(dice!, { faces: [8, 1, 6] })).toBe(20);
    expect(() => reportedTotal(dice!, { faces: [8, 1] })).toThrow("Type each die of 2d8 + 1d6 + 5: 3 in all.");
    expect(damageDiceOf(resolution({ damage: [{ formula: "7", type: "fire", total: 7 }] }))).toBeNull();
  });

  it("holds the saves a resolve opened, and none it found already waiting", () => {
    const old = PendingSaveSchema.parse({
      id: "20000000-0000-4000-8000-000000000001",
      targetActorId: GOBLIN,
      ability: "dex",
      dc: 13,
      sourceActorId: CASTER,
      sourceName: "Lyra",
      actionName: "Earlier",
      proposedDamage: 5,
      createdAt: 1
    });
    const opened = {
      ...old,
      id: "20000000-0000-4000-8000-000000000002",
      actionName: "Burning Hands",
      proposedDamage: 11
    };
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    state.combat = { ...state.combat, pendingSaves: [old, opened] };
    holdForDamageRolls(
      state,
      resolution(),
      { actorId: CASTER, name: "Lyra" },
      "total",
      { proposalIds: new Set(), saveIds: new Set([old.id]) },
      false,
      { newId: () => "30000000-0000-4000-8000-000000000001", now: () => 5 }
    );
    expect(state.combat.damageRolls).toMatchObject([
      { id: "30000000-0000-4000-8000-000000000001", formula: "3d6", saveIds: [opened.id], mode: "total" }
    ]);
    expect(state.combat.pendingSaves.map((save) => save.damageRollId)).toEqual([
      undefined,
      "30000000-0000-4000-8000-000000000001"
    ]);
  });
});
