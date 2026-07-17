import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { setCondition } from "../src/actor-conditions.js";
import { projectPlayerView } from "../src/projections.js";

const IDS = {
  pc: "10000000-0000-4000-8000-000000000001",
  monster: "10000000-0000-4000-8000-000000000002",
  session: "30000000-0000-4000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const OWNER = { role: "player", sessionId: IDS.session } as const;

function state() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.pc, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, ownerSessionId: IDS.session },
    { id: IDS.monster, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 } }
  ] });
}

describe("condition tracking", () => {
  it("sets, re-sets, and clears conditions in sorted order", () => {
    const game = state();
    setCondition(game, IDS.monster, "prone", true, undefined, GM);
    setCondition(game, IDS.monster, "grappled", true, undefined, GM);
    expect(game.actors[1].conditions).toEqual([{ id: "grappled" }, { id: "prone" }]);
    setCondition(game, IDS.monster, "prone", true, undefined, GM); // idempotent re-set
    expect(game.actors[1].conditions).toEqual([{ id: "grappled" }, { id: "prone" }]);
    setCondition(game, IDS.monster, "prone", false, undefined, GM);
    setCondition(game, IDS.monster, "stunned", false, undefined, GM); // clearing an absent one is a no-op
    expect(game.actors[1].conditions).toEqual([{ id: "grappled" }]);
    expect(GameStateSchema.safeParse(game).success).toBe(true);
  });

  it("tracks exhaustion levels and rejects levels on other conditions", () => {
    const game = state();
    setCondition(game, IDS.pc, "exhaustion", true, undefined, GM);
    expect(game.actors[0].conditions).toEqual([{ id: "exhaustion", level: 1 }]);
    setCondition(game, IDS.pc, "exhaustion", true, 3, GM);
    expect(game.actors[0].conditions).toEqual([{ id: "exhaustion", level: 3 }]);
    expect(() => setCondition(game, IDS.pc, "prone", true, 2, GM)).toThrow(/Only exhaustion/);
  });

  it("scopes players to their own character and projects conditions publicly", () => {
    const game = state();
    setCondition(game, IDS.pc, "poisoned", true, undefined, OWNER);
    expect(() => setCondition(game, IDS.monster, "prone", true, undefined, OWNER)).toThrow(/own character/);
    setCondition(game, IDS.monster, "restrained", true, undefined, GM);
    const view = projectPlayerView(game, IDS.session, () => null);
    expect(view.actors.find((actor) => actor.id === IDS.pc)?.conditions).toEqual([{ id: "poisoned" }]);
    expect(view.actors.find((actor) => actor.id === IDS.monster)?.conditions).toEqual([{ id: "restrained" }]);
  });
});
