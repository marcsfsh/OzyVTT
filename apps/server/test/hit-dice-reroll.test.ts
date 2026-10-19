import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { holdHitDice, rerollHitDice, spendHitDice } from "../src/rests.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Heroic Inspiration: "If you have Heroic Inspiration, you can expend it to reroll any die immediately after
// rolling it, and you must use the new roll." A Hit Point Die spent on a Short Rest is one such die.

const torva = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));
const HERO = "10000000-0000-4000-8000-000000000c21";
const OWNER = "30000000-0000-4000-8000-000000000c22";
const con = Math.floor((torva.abilityScores.con - 10) / 2);

function game(hero: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HERO,
        name: "Torva",
        kind: "player-character",
        visibility: "public",
        hp: { current: 10, maximum: 75 },
        definitionId: "import-torva",
        hitDice: { die: "d12", maximum: 7, remaining: 7 },
        ownerSessionId: OWNER,
        ...hero
      }
    ],
    definitions: [{ id: "import-torva", definition: torva }]
  });
}

const resolve = (state: GameState) => (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;

/** A spend of two Hit Point Dice showing `faces`, held as the command holds it, with its roll as the latest. */
function spent(state: GameState, faces: number[]) {
  const outcome = spendHitDice(state, HERO, faces, { role: "gm" }, resolve(state), faces.length);
  const rollId = randomUUID();
  state.rolls.push({ id: rollId, actorId: HERO } as GameState["rolls"][number]);
  holdHitDice(state, {
    actorId: HERO,
    rollId,
    dice: faces.map((face) => ({ sides: 12, face })),
    conModifier: outcome.conModifier,
    doubled: outcome.doubled,
    before: outcome.before
  });
}

describe("Heroic Inspiration on a Hit Point Die", () => {
  it("rerolls the lowest die of the latest spend, spends it, and heals by the new roll from where the spend began", () => {
    const state = game({ heroicInspiration: true });
    spent(state, [2, 9]);
    expect(state.actors[0]!.hp.current).toBe(10 + (2 + con) + (9 + con));
    const { healed } = rerollHitDice(state, HERO, { role: "player", sessionId: OWNER }, () => 12, randomUUID());
    expect(healed).toBe(12 + con + (9 + con));
    expect(state.actors[0]!.hp.current).toBe(10 + healed);
    expect(state.actors[0]!.heroicInspiration).toBe(false);
  });

  it("is refused without Heroic Inspiration, and once another roll came after", () => {
    const state = game();
    spent(state, [2, 9]);
    expect(() => rerollHitDice(state, HERO, { role: "player", sessionId: OWNER }, () => 12, randomUUID())).toThrow(
      /no Heroic Inspiration/
    );
    state.actors[0]!.heroicInspiration = true;
    state.rolls.push({ id: randomUUID(), actorId: HERO } as GameState["rolls"][number]);
    expect(() => rerollHitDice(state, HERO, { role: "player", sessionId: OWNER }, () => 12, randomUUID())).toThrow(
      /no Hit Point Die to reroll/
    );
  });
});

describe("the spend command holds its dice for the reroll", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("lets the GM throw the latest spend's dice again", async () => {
    const { server, gmToken, post, close } = await bootServer(game());
    cleanups.push(close);
    const path = GAME_PATHS.actorSpendHitDice.replace("{actorId}", HERO);
    expect((await post(path, gmToken, { commandId: randomUUID(), actorId: HERO, count: 2 })).status).toBe(200);
    const spend = server.store.snapshot.rolls.at(-1)!;
    const again = await post(path, gmToken, { commandId: randomUUID(), actorId: HERO, count: 1, reroll: true });
    expect(again.status).toBe(200);
    const reroll = server.store.snapshot.rolls.at(-1)!;
    expect(reroll.id).not.toBe(spend.id);
    expect(reroll.label).toBe("Hit Point Dice reroll");
    expect(server.store.snapshot.actors[0]!.hp.current).toBe(Math.min(75, 10 + reroll.total));
  });
});
