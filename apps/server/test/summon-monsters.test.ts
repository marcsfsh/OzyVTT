import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { addActorFromDefinition } from "../src/actor-roster.js";
import { cell } from "./movement-fixtures.js";
import { catalog, view } from "./spell-casters.js";
import { BANDIT, bootSummons, CASTER, summonTable } from "./summon-fixtures.js";

// Monsters that bring creatures or take command of one (SRD 5.2.1): a treant's Animate Trees and an aboleth's
// Dominate Mind.

const TREANT = "70000000-0000-4000-8000-0000000000d1";
const ABOLETH = "70000000-0000-4000-8000-0000000000d2";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The summoning table with a monster added, its turn first in the fight. */
async function withMonster(monsterId: string, id: string) {
  const state = summonTable();
  addActorFromDefinition(state, view.monster(monsterId)!, id, "public", catalog);
  const table = await bootSummons(cleanups, state);
  expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
  const started = await table.post(GAME_PATHS.encounterStart, table.gmToken, {
    mapAssetId: table.mapAssetId,
    entries: [
      { actorId: id, score: 25 },
      { actorId: CASTER, score: 20 },
      { actorId: BANDIT, score: 10 }
    ]
  });
  expect(started.status, await started.clone().text()).toBe(200);
  await table.move(id, table.gmToken, { position: cell(12, 8) });
  return table;
}

describe("Treant: Animate Trees", () => {
  it("animates two trees from its stat block, without Animate Trees and with Intelligence and Charisma 1", async () => {
    const table = await withMonster("treant", TREANT);
    const used = await table.resolve({ actorId: TREANT, actionId: "animate-trees", summon: { at: cell(14, 12) } });
    expect(used.status, await used.clone().text()).toBe(200);
    const trees = table.named("Animated Tree");
    expect(trees).toHaveLength(2);
    for (const tree of trees) {
      expect(tree.control).toMatchObject({ by: TREANT, side: "foes" });
      expect(tree.summon).toMatchObject({ endsOnUserDeath: true, leashFeet: 120 });
      const block = table.snapshot().definitions.find((entry) => entry.id === tree.definitionId)!.definition;
      expect(block.abilityScores).toMatchObject({ int: 1, cha: 1 });
      expect(block.actions.some((action) => action.id === "animate-trees")).toBe(false);
    }
    // They take their turns right after the treant's.
    const order = table.snapshot().combat.initiative.map((entry) => entry.actorId);
    expect(order.slice(0, 3)).toEqual([TREANT, ...trees.map((tree) => tree.id)]);
    // "until it dies, the treant dies".
    const treant = table.actor(TREANT)!;
    await table.post(GAME_PATHS.actorDamage.replace("{actorId}", TREANT), table.gmToken, {
      actorId: TREANT,
      amount: treant.hp.current
    });
    expect(table.named("Animated Tree")).toEqual([]);
  });
});

describe("Aboleth: Dominate Mind", () => {
  it("puts a creature that fails its save under the aboleth's command, on the aboleth's side", async () => {
    const table = await withMonster("aboleth", ABOLETH);
    await table.move(CASTER, table.gmToken, { position: cell(12, 12) });
    const used = await table.resolve({ actorId: ABOLETH, actionId: "dominate-mind", targetIds: [CASTER] });
    expect(used.status, await used.clone().text()).toBe(200);
    const save = table.snapshot().combat.pendingSaves.find((pending) => pending.targetActorId === CASTER)!;
    const failed = await table.post(GAME_PATHS.saveAnswer.replace("{saveId}", save.id), table.gmToken, {
      saveId: save.id,
      method: "manual",
      total: 1,
      commit: true
    });
    expect(failed.status, await failed.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.control).toMatchObject({ by: ABOLETH, side: "foes" });
    // Its player can't move it or act for it while the aboleth commands it.
    const player = table.server.auth.issuePlayerSession();
    expect((await table.post(GAME_PATHS.claims, player, { actorId: CASTER })).status).toBe(200);
    const moved = await table.move(CASTER, player, { position: cell(3, 3) });
    expect(moved.status).toBe(403);
  });
});
