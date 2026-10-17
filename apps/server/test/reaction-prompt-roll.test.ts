import { GameStateSchema, type GameState } from "@vtt/domain";
import { describe, expect, it } from "vitest";
import { projectPlayerView } from "../src/projections.js";

// A player's Shield prompt carries the roll it answers only when that roll is already in the player's dice log: a roll
// the GM kept hidden never reaches them through the prompt.

const LYRA = "10000000-0000-4000-8000-0000000000f1";
const BOSS = "10000000-0000-4000-8000-0000000000f2";
const PLAYER = "30000000-0000-4000-8000-0000000000f1";
const GM = "30000000-0000-4000-8000-0000000000f2";

function game(visibility: "public" | "gm-only", heldFace = 12): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: LYRA, name: "Lyra", kind: "player-character", ownerSessionId: PLAYER, hp: { current: 37, maximum: 44 } },
      { id: BOSS, name: "Goblin Boss", kind: "monster", hp: { current: 21, maximum: 21 } }
    ],
    rolls: [
      {
        id: "40000000-0000-4000-8000-0000000000f1",
        commandId: "50000000-0000-4000-8000-0000000000f1",
        initiatorSessionId: GM,
        initiatorRole: "gm",
        actorId: BOSS,
        purpose: "attack",
        visibility,
        formula: "1d20+4",
        normalizedFormula: "1d20+4",
        dice: [{ group: 0, sides: 20, face: 12, kept: true, sign: 1 }],
        modifiers: [{ value: 4, sign: 1 }],
        total: 16,
        createdAt: "2026-10-17T00:00:00.000Z"
      }
    ],
    combat: {
      active: true,
      round: 1,
      turnActorId: BOSS,
      initiative: [
        { actorId: LYRA, score: 12 },
        { actorId: BOSS, score: 15 }
      ],
      pendingReactions: [
        {
          id: "60000000-0000-4000-8000-0000000000f1",
          kind: "attack-would-hit",
          actorId: LYRA,
          actionId: "spell-shield",
          actionName: "Shield",
          sourceActorId: BOSS,
          sourceName: "Goblin Boss",
          triggerCommandId: "50000000-0000-4000-8000-0000000000f2",
          acBonus: 5,
          // The server threw the die: the held attack keeps its face, and the total is the whole attack's.
          attackTotal: 17,
          parkedAttack: {
            actionId: "shortbow",
            builtin: false,
            attackNatural: heldFace,
            attackTotal: null,
            cover: null,
            conditionId: null,
            attackKinds: [],
            pushFeet: null,
            slotLevel: null,
            distanceFeet: 30,
            initiatorRole: "gm",
            initiatorSessionId: GM,
            untilNextTurn: true
          },
          createdAt: 1
        }
      ]
    }
  });
}

describe("a player's Shield prompt", () => {
  it("names the roll the player saw, and that Shield lasts", () => {
    const [prompt] = projectPlayerView(game("public"), PLAYER, () => null).combat.pendingReactions;
    // The d20 roll the player saw, with the attack's other bonuses the total carries.
    expect(prompt.attackRoll).toBe(17);
    expect(prompt.lastsUntilNextTurn).toBe(true);
  });

  it("leaves out a roll the GM kept hidden", () => {
    const [prompt] = projectPlayerView(game("gm-only"), PLAYER, () => null).combat.pendingReactions;
    expect(prompt.attackRoll).toBeUndefined();
    expect(JSON.stringify(prompt)).not.toContain("17");
  });

  it("names a typed total the GM showed before sending it", () => {
    const shown = game("public");
    const [roll] = shown.rolls;
    const [pending] = shown.combat.pendingReactions;
    const typed: GameState = {
      ...shown,
      rolls: [{ ...roll!, formula: "16", normalizedFormula: "16", dice: [], modifiers: [] }],
      combat: {
        ...shown.combat,
        pendingReactions: [
          {
            ...pending!,
            attackTotal: 16,
            parkedAttack: { ...pending!.parkedAttack!, attackNatural: null, attackTotal: 16 }
          }
        ]
      }
    };
    expect(projectPlayerView(typed, PLAYER, () => null).combat.pendingReactions[0]?.attackRoll).toBe(16);
  });

  it("leaves out a total when the latest roll the player saw is another attack's", () => {
    const [prompt] = projectPlayerView(game("public", 9), PLAYER, () => null).combat.pendingReactions;
    expect(prompt.attackRoll).toBeUndefined();
  });
});
