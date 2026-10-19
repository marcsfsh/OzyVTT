import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import type { EffectNarration } from "../src/effects.js";
import { pushThroughZones } from "../src/pushed-through.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";
import { build, druidInput, fight, FOE, HERO } from "./spell-casters.js";
import { drawArea, GRID, place, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Trampling Charge: "The centaur moves up to its Speed without provoking Opportunity Attacks and can move
// through the spaces of Medium or smaller creatures. Each creature whose space the centaur enters is targeted once by
// the following effect." Fire Form: "The first time it enters a creature's space on a turn, that creature takes 5
// (1d10) Fire damage." And a creature moved by force meets the spell areas on its way.

const CENTAUR = "10000000-0000-4000-8000-0000000000e1";
const ELEMENTAL = "10000000-0000-4000-8000-0000000000e2";
const GOBLIN = "10000000-0000-4000-8000-0000000000e3";
const ORC = "10000000-0000-4000-8000-0000000000e4";
const CAST = "60000000-0000-4000-8000-0000000000e5";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function field(leader: { id: string; name: string; definitionId: string }) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { ...leader, kind: "monster" },
      { id: GOBLIN, name: "Goblin", kind: "monster" },
      { id: ORC, name: "Orc", kind: "monster" }
    ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 60, maximum: 60 } }))
  });
  const table = await bootMovementServer(state, cleanups);
  await table.startFight([leader.id, GOBLIN, ORC], {
    [leader.id]: cell(1, 1),
    [GOBLIN]: cell(3, 1),
    [ORC]: cell(5, 1)
  });
  return table;
}

describe("a move that meets the creatures whose spaces it enters", () => {
  it("asks each creature the centaur charges through for Trampling Charge's save, once a charge", async () => {
    const { server, gmToken, post, move } = await field({
      id: CENTAUR,
      name: "Centaur Trooper",
      definitionId: "centaur-trooper"
    });
    const charge = await post(GAME_PATHS.actionResolve, gmToken, {
      actorId: CENTAUR,
      actionId: "trampling-charge-recharge-5-6"
    });
    expect(charge.status, await charge.clone().text()).toBe(200);
    expect(server.store.snapshot.combat.pendingSaves).toEqual([]);
    const moved = await move(CENTAUR, gmToken, { position: cell(7, 1) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const saves = server.store.snapshot.combat.pendingSaves;
    expect(saves.map((save) => save.targetActorId).sort()).toEqual([GOBLIN, ORC].sort());
    expect(saves[0]).toMatchObject({ ability: "str", dc: 14, actionName: "Trampling Charge (Recharge 5-6)" });
    // Back through the orc's space: met once during the move, so no second save.
    expect((await move(CENTAUR, gmToken, { position: cell(4, 2) })).status).toBe(200);
    expect(server.store.snapshot.combat.pendingSaves).toHaveLength(2);
  });

  it("burns a creature the first time on a turn a fire elemental enters its space", async () => {
    const { server, gmToken, move } = await field({
      id: ELEMENTAL,
      name: "Fire Elemental",
      definitionId: "fire-elemental"
    });
    const hp = (id: string) => server.store.snapshot.actors.find((actor) => actor.id === id)!.hp.current;
    expect((await move(ELEMENTAL, gmToken, { position: cell(4, 1) })).status).toBe(200);
    expect(hp(GOBLIN)).toBeLessThan(60);
    expect(hp(ORC)).toBe(60);
    const burnt = hp(GOBLIN);
    expect((await move(ELEMENTAL, gmToken, { position: cell(2, 1) })).status).toBe(200);
    expect(hp(GOBLIN)).toBe(burnt);
  });
});

describe("a creature moved by force through a spell's area", () => {
  it("takes Spike Growth's damage for the feet it is pushed through the Sphere", () => {
    const caster = fight(build(druidInput(["spike-growth"])));
    place(caster.state, { [HERO]: cell(0, 10), [FOE]: cell(6, 10) });
    caster.resolve("spell-spike-growth", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [14, 10], 4);
    const events: EffectNarration[] = [];
    const moved = pushThroughZones(
      caster.state,
      { actorId: FOE, awayFromActorId: HERO, distanceFeet: 30 },
      GRID,
      zoneDeps([1, 1, 1, 1, 1, 1, 1, 1]),
      events
    );
    expect(moved?.value).toBe(30);
    expect(events.map((event) => event.text).join(" ")).toMatch(/Goblin moves through Spike Growth and takes \d+/);
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.hp.current).toBeLessThan(200);
  });
});
