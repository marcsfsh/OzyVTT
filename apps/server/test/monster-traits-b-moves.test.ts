import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { ContentLibrary } from "../src/content-library.js";
import { TRANSPARENT_TAG, transparentEffects } from "../src/transparent.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";

// SRD 5.2.1 traits that act as tokens move, through the commands: a hydra's Reactive Heads ("For each head the hydra
// has beyond one, it gets an extra Reaction that can be used only for Opportunity Attacks") and a gelatinous cube's
// Transparent, which ends once the cube is seen to move.

const HERO = "10000000-0000-4000-8000-0000000000e1";
const FOE = "10000000-0000-4000-8000-0000000000e2";
const library = new ContentLibrary();

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fight(slug: string, foeAt: { x: number; y: number }) {
  const definition = library.monsterForInstance(slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30, hp: { current: 30, maximum: 30 } },
      {
        id: FOE,
        name: definition.name,
        kind: "monster",
        speedFeet: definition.speedFeet,
        size: definition.size,
        definitionId: slug,
        hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum },
        effects: transparentEffects(FOE, definition.name, definition)
      }
    ].map((actor) => ({ ...actor, visibility: "public" }))
  });
  const table = await bootMovementServer(state, cleanups);
  await table.startFight([HERO, FOE], { [HERO]: cell(1, 2), [FOE]: foeAt });
  return table;
}

describe("a hydra's Reactive Heads", () => {
  it("still gives it an Opportunity Attack once its own Reaction is spent, one for each head beyond the first", async () => {
    const { server, gmToken, move, post } = await fight("hydra", cell(3, 2));
    const spent = await post(GAME_PATHS.turnReaction, gmToken, { actorId: FOE, used: true });
    expect(spent.status, await spent.clone().text()).toBe(200);
    const moved = await move(HERO, gmToken, { position: cell(1, 8) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const prompt = server.store.snapshot.combat.pendingReactions.find((entry) => entry.kind === "leaves-reach");
    expect(prompt?.actorId).toBe(FOE);
    const answered = await post(GAME_PATHS.reactionAnswer.replace("{reactionId}", prompt!.id), gmToken, {
      reactionId: prompt!.id,
      use: true,
      commit: true
    });
    expect(answered.status, await answered.clone().text()).toBe(200);
    const hydra = server.store.snapshot.actors.find((actor) => actor.id === FOE)!;
    expect(hydra.actionUses["reactive-heads:spent"]).toBe(1);
  });
});

describe("a gelatinous cube's Transparent", () => {
  it("is noticed once it moves", async () => {
    const { server, gmToken, move } = await fight("gelatinous-cube", cell(5, 2));
    const cube = () => server.store.snapshot.actors.find((actor) => actor.id === FOE)!;
    expect(cube().effects.some((effect) => effect.tags.includes(TRANSPARENT_TAG))).toBe(true);
    const moved = await move(FOE, gmToken, { position: cell(6, 2) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(cube().effects.some((effect) => effect.tags.includes(TRANSPARENT_TAG))).toBe(false);
    expect(cube().conditions.map((condition) => condition.id)).not.toContain("invisible");
  });
});
