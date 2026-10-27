import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { finishPartyShortRest, spendHitDice, startOwnShortRest, startPartyRest } from "../src/rests.js";

// SRD 5.2.1 Hit Point Dice: "A creature can spend Hit Dice during a Short Rest to regain Hit Points". Short Rest: "a
// period of downtime, at least 1 hour long".

const torva = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));
const HERO = "10000000-0000-4000-8000-000000000001";
const OWNER = "30000000-0000-4000-8000-00000000000b";
const player = { role: "player", sessionId: OWNER } as const;

function game(): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Torva",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 75 },
        definitionId: "import-torva",
        ownerSessionId: OWNER,
        hitDice: { die: "d12", maximum: 7, remaining: 7 }
      }
    ],
    definitions: [{ id: "import-torva", definition: torva }]
  });
}
const resolve = (state: GameState) => (definitionId: string) =>
  state.definitions.find((entry) => entry.id === definitionId)?.definition;

describe("Hit Point Dice are spent during a Short Rest", () => {
  it("refuses a player's spend with no Short Rest under way", () => {
    const state = game();
    expect(() => spendHitDice(state, HERO, [6], player, resolve(state))).toThrow(/spent during a Short Rest/);
    expect(state.actors[0]).toMatchObject({ hp: { current: 20 }, hitDice: { remaining: 7 } });
  });

  it("heals a player's character in the party's Short Rest", () => {
    const state = game();
    startPartyRest(state, [HERO], "short");
    spendHitDice(state, HERO, [6], player, resolve(state));
    expect(state.actors[0].hitDice?.remaining).toBe(6);
    expect(state.actors[0].hp.current).toBeGreaterThan(20);
  });

  it("puts a player's own Short Rest under way, and its spends stop when the GM ends it an hour later", () => {
    const state = game();
    expect(startOwnShortRest(state, HERO, player)).toBe(false);
    expect(state.rest.shortRest).toEqual({ actorIds: [HERO], done: [] });
    spendHitDice(state, HERO, [6], player, resolve(state));
    finishPartyShortRest(state, true, resolve(state));
    expect(state.rest).toMatchObject({ clockHours: 1, shortRest: null });
    expect(() => spendHitDice(state, HERO, [6], player, resolve(state))).toThrow(/spent during a Short Rest/);
  });

  it("lets the GM spend a creature's dice outside a fight", () => {
    const state = game();
    spendHitDice(state, HERO, [6], { role: "gm" }, resolve(state));
    expect(state.actors[0].hitDice?.remaining).toBe(6);
  });
});
