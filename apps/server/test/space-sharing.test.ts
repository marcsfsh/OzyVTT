import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { spaceSharingFor } from "../src/space-sharing.js";

// SRD 5.2.1 Air Form: "The elemental can enter a creature's space and stop there". Swarm: "The swarm can occupy another
// creature's space and vice versa". The movement reply tells the drag preview both, as movement-rules.ts charges them.

const HERO = "76000000-0000-4000-8000-000000000001";
const ELEMENTAL = "76000000-0000-4000-8000-000000000002";
const RATS = "76000000-0000-4000-8000-000000000003";
const BATS = "76000000-0000-4000-8000-000000000004";
const monsters = new Map(loadMonsterDefinitions().map((definition) => [definition.source.externalId, definition]));
const resolve = (definitionId: string) => monsters.get(definitionId);

const state = GameStateSchema.parse({
  schemaVersion: 1,
  actors: [
    { id: HERO, name: "Borin", kind: "player-character" },
    { id: ELEMENTAL, name: "Air Elemental", kind: "monster", definitionId: "air-elemental" },
    { id: RATS, name: "Swarm of Rats", kind: "monster", definitionId: "swarm-of-rats" },
    { id: BATS, name: "Swarm of Bats", kind: "monster", definitionId: "swarm-of-bats" }
  ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 10, maximum: 10 } })),
  combat: {
    initiative: [HERO, ELEMENTAL, RATS, BATS].map((actorId, index) => ({ actorId, score: 20 - index })),
    tokens: [HERO, ELEMENTAL, RATS, BATS].map((actorId, index) => ({
      actorId,
      position: { x: 25 + 50 * index, y: 25 },
      sizePx: 40,
      sizeCells: 1
    }))
  }
});

describe("what the drag preview hears of creatures that share spaces", () => {
  it("says an elemental passes creatures, and a character doesn't", () => {
    expect(spaceSharingFor(state, ELEMENTAL, resolve, () => false).passesCreatures).toBe(true);
    expect(spaceSharingFor(state, HERO, resolve, () => false).passesCreatures).toBeUndefined();
  });

  it("names the swarms the asker can see, and no other", () => {
    expect(spaceSharingFor(state, HERO, resolve, () => false).swarmIds).toEqual([RATS, BATS]);
    expect(spaceSharingFor(state, HERO, resolve, (id) => id === BATS).swarmIds).toEqual([RATS]);
    // A swarm moving is a mover that passes creatures, and isn't its own obstacle.
    expect(spaceSharingFor(state, RATS, resolve, () => false)).toEqual({ passesCreatures: true, swarmIds: [BATS] });
  });
});
