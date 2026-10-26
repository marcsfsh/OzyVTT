import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { cell } from "./movement-fixtures.js";
import { BANDIT, bootSummons, CASTER, summonTable, WOLF } from "./summon-fixtures.js";

// SRD 5.2.1 Dominate Person (and Dominate Beast, Dominate Monster): "You can command the target to take a Reaction but
// must take your own Reaction to do so."

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Table = Awaited<ReturnType<typeof bootSummons>>;

/** Dominates the bandit, puts the wolf beside it and brings up the wolf's turn. */
async function dominated(): Promise<Table> {
  const table = await bootSummons(cleanups, summonTable());
  await table.move(BANDIT, table.gmToken, { position: cell(4, 2) });
  const cast = await table.resolve({ actionId: "spell-dominate-person", targetIds: [BANDIT] });
  expect(cast.status, await cast.clone().text()).toBe(200);
  const save = table.snapshot().combat.pendingSaves.find((pending) => pending.targetActorId === BANDIT)!;
  const failed = await table.post(GAME_PATHS.saveAnswer.replace("{saveId}", save.id), table.gmToken, {
    saveId: save.id,
    method: "manual",
    total: 1,
    commit: true
  });
  expect(failed.status, await failed.clone().text()).toBe(200);
  expect(table.actor(BANDIT)!.control).toMatchObject({ by: CASTER });
  await table.move(WOLF, table.gmToken, { position: cell(5, 2) });
  for (let guard = 0; guard < 12 && table.snapshot().combat.turnActorId !== WOLF; guard++) await table.endTurn();
  expect(table.snapshot().combat.turnActorId).toBe(WOLF);
  return table;
}

const opportunity = (table: Table) =>
  table.snapshot().combat.pendingReactions.find((entry) => entry.kind === "leaves-reach" && entry.actorId === BANDIT);

describe("a dominated creature's Reaction", () => {
  it("spends its commander's Reaction too", async () => {
    const table = await dominated();
    const moved = await table.move(WOLF, table.gmToken, { position: cell(10, 2) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const prompt = opportunity(table)!;
    expect(prompt).toBeDefined();
    const answered = await table.post(GAME_PATHS.reactionAnswer.replace("{reactionId}", prompt.id), table.gmToken, {
      commandId: crypto.randomUUID(),
      reactionId: prompt.id,
      use: true,
      commit: true
    });
    expect(answered.status, await answered.clone().text()).toBe(200);
    expect(table.snapshot().combat.reactionsUsed).toEqual(expect.arrayContaining([BANDIT, CASTER]));
  });

  it("isn't offered once its commander's Reaction is spent", async () => {
    const table = await dominated();
    const spent = await table.post(GAME_PATHS.turnReaction, table.gmToken, { actorId: CASTER, used: true });
    expect(spent.status, await spent.clone().text()).toBe(200);
    await table.move(WOLF, table.gmToken, { position: cell(10, 2) });
    expect(opportunity(table)).toBeUndefined();
  });
});
