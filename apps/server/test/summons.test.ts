import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { ContentLibrary } from "../src/content-library.js";
import { projectPlayerView } from "../src/projections.js";
import { cell } from "./movement-fixtures.js";
import { bootSummons, CASTER, CORPSE, CORPSE_TWO, BANDIT, WOLF } from "./summon-fixtures.js";

// SRD 5.2.1 summoned creatures: a spell brings a creature from its stat block, scaled by the slot it was cast with, on
// its caster's side and under its caster's command, in the turn order right after its caster or on its own roll, and
// takes it away when the spell ends or it drops to 0 Hit Points.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const content = new ContentLibrary();
const sight = { definition: (id: string) => content.monsterForInstance(id) };

describe("Summon Dragon", () => {
  it("brings a Draconic Spirit at the slot's level that acts right after its caster and shares a Resistance", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({
      actionId: "spell-summon-dragon",
      slotLevel: 6,
      summon: { damageType: "cold", resistance: "fire", at: cell(4, 2) }
    });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [spirit] = table.named("Draconic Spirit");
    expect(spirit).toBeDefined();
    // AC 14 + the spell's level, 50 Hit Points + 10 for each level above 5.
    expect(spirit!.armorClass).toBe(20);
    expect(spirit!.hp).toEqual({ current: 60, maximum: 60, temporary: 0 });
    expect(spirit!.control).toEqual({ by: CASTER, side: "party", dodgesUncommanded: true });
    expect(spirit!.summon?.spell).toEqual({ id: "summon-dragon", level: 6 });
    const block = table.snapshot().definitions.find((entry) => entry.id === spirit!.definitionId)!.definition;
    const rend = block.actions.find((action) => action.id === "rend")!;
    // The caster's spell attack modifier, and 1d6 + 4 + the spell's level.
    expect(rend.attack?.bonus).toBe(7);
    expect(rend.damage[0]).toEqual({ formula: "1d6 + 10", type: "piercing" });
    // Half the spell's level of Rends, and the breath at the caster's DC in the type picked at the cast.
    expect(block.actions.find((action) => action.id === "multiattack")!.multiattack).toEqual([
      { actionId: "rend", count: 3 },
      { actionId: "breath-weapon", count: 1 }
    ]);
    const breath = block.actions.find((action) => action.id === "breath-weapon")!;
    expect(breath.save?.dc).toBe(15);
    expect(breath.damage[0]!.type).toBe("cold");
    // Its turn is right after its caster's, on the same count.
    const order = table.snapshot().combat.initiative.map((entry) => entry.actorId);
    expect(order[order.indexOf(CASTER) + 1]).toBe(spirit!.id);
    expect(table.snapshot().combat.initiative.find((entry) => entry.actorId === spirit!.id)!.follows).toBe(CASTER);
    // It appears where the caster chose.
    const at = table.snapshot().combat.tokens.find((token) => token.actorId === spirit!.id)!.position!;
    expect(Math.hypot(at.x - cell(4, 2).x, at.y - cell(4, 2).y)).toBeLessThan(80);
    // "You have Resistance to the chosen damage type until the spell ends."
    const shared = table.actor(CASTER)!.effects.find((effect) => effect.name.includes("Resistance to fire"))!;
    expect(shared.modifiers).toEqual([{ type: "damage-resistance", damageTypes: ["fire"] }]);
  });

  it("refuses a spot farther than the spell's range", async () => {
    const table = await bootSummons(cleanups);
    const far = await table.resolve({ actionId: "spell-summon-dragon", summon: { at: cell(18, 2) } });
    expect(far.status).toBe(409);
    expect(await far.text()).toContain("Summon Dragon brings its creatures within 60 ft");
    expect(table.named("Draconic Spirit")).toEqual([]);
  });

  it("goes with the caster's Concentration, and so does the shared Resistance", async () => {
    const table = await bootSummons(cleanups);
    await table.resolve({ actionId: "spell-summon-dragon", summon: { resistance: "acid" } });
    const spirit = table.named("Draconic Spirit")[0]!;
    const holding = table.actor(CASTER)!.effects.find((effect) => effect.concentration)!;
    const ended = await table.post(
      GAME_PATHS.effectEnd.replace("{actorId}", CASTER).replace("{effectId}", holding.id),
      table.gmToken,
      { actorId: CASTER, effectId: holding.id }
    );
    expect(ended.status, await ended.clone().text()).toBe(200);
    expect(table.actor(spirit.id)).toBeUndefined();
    expect(table.snapshot().combat.initiative.some((entry) => entry.actorId === spirit.id)).toBe(false);
    expect(table.snapshot().combat.tokens.some((token) => token.actorId === spirit.id)).toBe(false);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.name.includes("Resistance"))).toBe(false);
    // Its scaled stat block goes with it.
    expect(table.snapshot().definitions.some((entry) => entry.id.startsWith("summon-"))).toBe(false);
  });

  it("disappears at 0 Hit Points", async () => {
    const table = await bootSummons(cleanups);
    await table.resolve({ actionId: "spell-summon-dragon" });
    const spirit = table.named("Draconic Spirit")[0]!;
    const hit = await table.post(GAME_PATHS.actorDamage.replace("{actorId}", spirit.id), table.gmToken, {
      actorId: spirit.id,
      amount: 80,
      damageType: "slashing"
    });
    expect(hit.status, await hit.clone().text()).toBe(200);
    expect(table.actor(spirit.id)).toBeUndefined();
    // The spell itself goes on until its Concentration ends.
    expect(table.actor(CASTER)!.effects.some((effect) => effect.concentration)).toBe(true);
  });
});

describe("a player commanding a summoned creature", () => {
  it("acts for the creature and sees its stat block, and for nothing else", async () => {
    const table = await bootSummons(cleanups);
    const player = table.server.auth.issuePlayerSession();
    const claimed = await table.post(GAME_PATHS.claims, player, { actorId: CASTER });
    expect(claimed.status, await claimed.clone().text()).toBe(200);
    const cast = await table.resolve({ actionId: "spell-summon-dragon" }, player);
    expect(cast.status, await cast.clone().text()).toBe(200);
    const spirit = table.named("Draconic Spirit")[0]!;
    const session = table.server.auth.verifyPlayer(player)!.sessionId;
    const view = projectPlayerView(table.snapshot(), session, () => null, Date.now(), sight);
    const seen = view.actors.find((actor) => actor.id === spirit.id)!;
    expect(seen.commanded).toBe(true);
    expect(seen.hp).toEqual({ kind: "exact", current: 50, maximum: 50, temporary: 0 });
    expect(seen.definition?.actions.some((action) => action.id === "rend")).toBe(true);
    // The bandit stays a stranger: no stat block, a health band.
    const bandit = view.actors.find((actor) => actor.id === BANDIT)!;
    expect(bandit.commanded).toBeUndefined();
    expect(bandit.definition).toBeUndefined();
    // The caster's turn ends, and the spirit's comes next: its player moves it and has it attack.
    expect((await table.endTurn(player)).status).toBe(200);
    expect(table.snapshot().combat.turnActorId).toBe(spirit.id);
    const moved = await table.move(spirit.id, player, { position: cell(6, 2) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const rend = await table.resolve({ actorId: spirit.id, actionId: "rend", targetIds: [BANDIT] }, player);
    expect(rend.status, await rend.clone().text()).toBe(200);
    // Nothing else is the player's: not the bandit, and not the spirit's sheet edits.
    expect((await table.move(BANDIT, player, { position: cell(9, 2) })).status).toBe(403);
    const stranger = table.server.auth.issuePlayerSession();
    expect((await table.move(spirit.id, stranger, { position: cell(6, 3) })).status).toBe(403);
    const strangerView = projectPlayerView(
      table.snapshot(),
      table.server.auth.verifyPlayer(stranger)!.sessionId,
      () => null,
      Date.now(),
      sight
    );
    expect(strangerView.actors.find((actor) => actor.id === spirit.id)?.commanded).toBeUndefined();
  });
});

describe("Giant Insect", () => {
  it("takes the picked form at the slot's level", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({
      actionId: "spell-giant-insect",
      slotLevel: 5,
      summon: { picks: [{ monsterId: "giant-insect", form: "spider" }] }
    });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const insect = table.named("Giant Insect")[0]!;
    expect(insect.name).toBe("Giant Insect (Spider)");
    expect(insect.armorClass).toBe(16);
    expect(insect.hp.maximum).toBe(40);
    const block = table.snapshot().definitions.find((entry) => entry.id === insect.definitionId)!.definition;
    const ids = block.actions.map((action) => action.id);
    expect(ids).toContain("web-bolt");
    expect(ids).not.toContain("venomous-spew");
    expect(ids).not.toContain("buzzing-wings");
    expect(block.actions.find((action) => action.id === "poison-jab")!.damage[0]!.formula).toBe("1d6 + 8");
    expect(block.actions.find((action) => action.id === "web-bolt")!.save?.dc).toBe(15);
  });
});

describe("Animate Dead", () => {
  it("raises a Zombie from a dead Humanoid in its space, under the caster's command for 24 hours", async () => {
    const table = await bootSummons(cleanups);
    // Its 1-minute casting resolves at once outside a fight.
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    const corpseAt = table.snapshot().combat.tokens.find((token) => token.actorId === CORPSE)!.position!;
    const two = await table.resolve({ actionId: "spell-animate-dead", targetIds: [CORPSE, CORPSE_TWO] });
    expect(two.status).toBe(409);
    expect(await two.text()).toContain("raises one creature at this level");
    const cast = await table.resolve({ actionId: "spell-animate-dead", targetIds: [CORPSE] });
    expect(cast.status, await cast.clone().text()).toBe(200);
    expect(table.actor(CORPSE)).toBeUndefined();
    const zombie = table.named("Zombie")[0]!;
    expect(table.snapshot().combat.tokens.find((token) => token.actorId === zombie.id)!.position).toEqual(corpseAt);
    expect(zombie.control).toMatchObject({ by: CASTER, side: "party", commandedWith: "bonus-action" });
    const hold = zombie.effects.find((effect) => effect.id === zombie.control!.keptBy)!;
    expect(hold.duration).toEqual({ type: "minutes", remaining: 1440 });
    // A living creature is no corpse.
    await table.move(BANDIT, table.gmToken, { position: cell(1, 2) });
    const living = await table.resolve({ actionId: "spell-animate-dead", targetIds: [BANDIT] });
    expect(living.status).toBe(409);
    expect(await living.text()).toContain("isn't dead");
  });

  it("raises two more for each slot level above 3, and the 24 hours end the command, not the creature", async () => {
    const table = await bootSummons(cleanups);
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    const cast = await table.resolve({ actionId: "spell-animate-dead", slotLevel: 4, targetIds: [CORPSE, CORPSE_TWO] });
    expect(cast.status, await cast.clone().text()).toBe(200);
    expect(table.named("Zombie")).toHaveLength(2);
    const passed = await table.post(GAME_PATHS.timePass, table.gmToken, { hours: 24 });
    expect(passed.status, await passed.clone().text()).toBe(200);
    const zombies = table.named("Zombie");
    expect(zombies).toHaveLength(2);
    expect(zombies.every((zombie) => zombie.control === undefined)).toBe(true);
  });

  it("an uncommanded creature takes the Dodge action, and a Bonus Action command lets it act", async () => {
    const table = await bootSummons(cleanups);
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    await table.resolve({ actionId: "spell-animate-dead", targetIds: [CORPSE] });
    const zombie = table.named("Zombie")[0]!;
    const started = await table.post(GAME_PATHS.encounterStart, table.gmToken, {
      mapAssetId: table.mapAssetId,
      entries: [
        { actorId: CASTER, score: 20 },
        { actorId: zombie.id, score: 15 },
        { actorId: BANDIT, score: 10 },
        { actorId: WOLF, score: 5 }
      ]
    });
    expect(started.status, await started.clone().text()).toBe(200);
    expect(table.snapshot().combat.turnActorId).toBe(CASTER);
    expect((await table.endTurn()).status).toBe(200);
    expect(table.snapshot().combat.turnActorId).toBe(zombie.id);
    expect(table.actor(zombie.id)!.effects.some((effect) => effect.name === "Dodging")).toBe(true);
    expect(table.snapshot().combat.turn.actionUsed).toBe(true);
    // Next round the caster spends its Bonus Action on the command, and the zombie keeps its action.
    await table.endTurn();
    await table.endTurn();
    await table.endTurn();
    expect(table.snapshot().combat.turnActorId).toBe(CASTER);
    const command = await table.post(GAME_PATHS.summonCommand.replace("{actorId}", CASTER), table.gmToken, {
      actorId: CASTER
    });
    expect(command.status, await command.clone().text()).toBe(200);
    expect(table.snapshot().combat.turn.bonusActionUsed).toBe(true);
    expect(table.actor(zombie.id)!.control?.commanded).toBe(true);
    await table.endTurn();
    expect(table.snapshot().combat.turnActorId).toBe(zombie.id);
    expect(table.snapshot().combat.turn.actionUsed).toBe(false);
  });
});
