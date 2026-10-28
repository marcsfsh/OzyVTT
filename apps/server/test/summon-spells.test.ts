import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import type { ActorAction } from "@vtt/schemas";
import { projectPlayerView } from "../src/projections.js";
import { cell } from "./movement-fixtures.js";
import { BANDIT, bootSummons, CASTER, castActionOf, CORPSE, CORPSE_TWO, summonTable, WOLF } from "./summon-fixtures.js";

// The SRD 5.2.1 summoning and commanding spells, each by its own text: what comes, where, how it is commanded, and
// what ends it.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const pathFor = (path: string, actorId: string) => path.replace("{actorId}", actorId);

describe("Find Familiar", () => {
  async function withOwl() {
    const table = await bootSummons(cleanups);
    // Its hour of casting resolves at once outside a fight.
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    const cast = await table.resolve({
      actionId: "spell-find-familiar",
      summon: { picks: [{ monsterId: "owl" }], creatureType: "fey" }
    });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const owl = table.named("Owl")[0]!;
    return { ...table, owl };
  }

  it("brings an owl that is Fey, rolls its own Initiative and can't attack", async () => {
    const table = await withOwl();
    const block = table.snapshot().definitions.find((entry) => entry.id === table.owl.definitionId)!.definition;
    expect((block.extensions["open5e.srd-2024"] as { type: string }).type).toBe("fey");
    expect(table.owl.control).toMatchObject({ by: CASTER, noAttacks: true });
    const entry = table.snapshot().combat.initiative.find((candidate) => candidate.actorId === table.owl.id)!;
    expect(entry.follows).toBeUndefined();
    const started = await table.post(GAME_PATHS.encounterStart, table.gmToken, {
      mapAssetId: table.mapAssetId,
      entries: [
        { actorId: table.owl.id, score: 25 },
        { actorId: CASTER, score: 20 },
        { actorId: BANDIT, score: 10 }
      ]
    });
    expect(started.status).toBe(200);
    expect(table.snapshot().combat.turnActorId).toBe(table.owl.id);
    const talons = await table.resolve({ actorId: table.owl.id, actionId: "talons", targetIds: [BANDIT] });
    expect(talons.status).toBe(409);
    expect(await talons.text()).toContain("Owl can't attack.");
  });

  it("is one at a time: casting again changes its form", async () => {
    const table = await withOwl();
    const again = await table.resolve({ actionId: "spell-find-familiar", summon: { picks: [{ monsterId: "cat" }] } });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(table.named("Owl")).toEqual([]);
    expect(table.named("Cat")).toHaveLength(1);
    // A form the spell doesn't offer is refused; another Beast of Challenge Rating 0 is one.
    const wolf = await table.resolve({ actionId: "spell-find-familiar", summon: { picks: [{ monsterId: "wolf" }] } });
    expect(wolf.status).toBe(409);
    const crab = await table.resolve({ actionId: "spell-find-familiar", summon: { picks: [{ monsterId: "crab" }] } });
    expect(crab.status, await crab.clone().text()).toBe(200);
    expect(table.named("Crab")).toHaveLength(1);
  });

  it("lends its eyes for a Bonus Action, waits in its pocket dimension and comes back beside its caster", async () => {
    const table = await withOwl();
    const look = await table.post(pathFor(GAME_PATHS.summonLook, table.owl.id), table.gmToken, {
      actorId: table.owl.id
    });
    expect(look.status, await look.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.name === "Seeing through Owl")).toBe(true);
    const away = await table.post(pathFor(GAME_PATHS.summonDismiss, table.owl.id), table.gmToken, {
      actorId: table.owl.id,
      temporary: true
    });
    expect(away.status, await away.clone().text()).toBe(200);
    expect(table.snapshot().combat.tokens.find((token) => token.actorId === table.owl.id)!.position).toBeNull();
    // Its commander's player is told the orders it takes, and that it waits away; another player is told nothing.
    const player = table.server.auth.issuePlayerSession();
    expect((await table.post(GAME_PATHS.claims, player, { actorId: CASTER })).status).toBe(200);
    const viewOf = (token: string) =>
      projectPlayerView(table.snapshot(), table.server.auth.verifyPlayer(token)!.sessionId, () => null, Date.now());
    expect(viewOf(player).actors.find((actor) => actor.id === table.owl.id)?.orders).toEqual({
      dismiss: "action",
      look: true,
      away: true
    });
    const stranger = table.server.auth.issuePlayerSession();
    expect(viewOf(stranger).actors.find((actor) => actor.id === table.owl.id)?.orders).toBeUndefined();
    const back = await table.post(pathFor(GAME_PATHS.summonRecall, table.owl.id), table.gmToken, {
      actorId: table.owl.id
    });
    expect(back.status, await back.clone().text()).toBe(200);
    const at = table.snapshot().combat.tokens.find((token) => token.actorId === table.owl.id)!.position!;
    const casterAt = table.snapshot().combat.tokens.find((token) => token.actorId === CASTER)!.position!;
    expect(Math.hypot(at.x - casterAt.x, at.y - casterAt.y)).toBeLessThanOrEqual(80);
    const gone = await table.post(pathFor(GAME_PATHS.summonDismiss, table.owl.id), table.gmToken, {
      actorId: table.owl.id
    });
    expect(gone.status, await gone.clone().text()).toBe(200);
    expect(table.actor(table.owl.id)).toBeUndefined();
  });

  it("delivers a touch spell from its own space with its Reaction", async () => {
    const table = await withOwl();
    await table.move(table.owl.id, table.gmToken, { position: cell(7, 2) });
    const started = await table.post(GAME_PATHS.encounterStart, table.gmToken, {
      mapAssetId: table.mapAssetId,
      entries: [
        { actorId: CASTER, score: 20 },
        { actorId: table.owl.id, score: 15 },
        { actorId: BANDIT, score: 10 }
      ]
    });
    expect(started.status).toBe(200);
    // The bandit stands beside the owl, 30 feet from the Wizard.
    const far = await table.resolve({ actionId: "spell-shocking-grasp", targetIds: [BANDIT], attackNatural: 15 });
    expect(far.status).toBe(409);
    const through = await table.resolve({
      actionId: "spell-shocking-grasp",
      targetIds: [BANDIT],
      attackNatural: 15,
      deliveredBy: table.owl.id
    });
    expect(through.status, await through.clone().text()).toBe(200);
    expect(table.snapshot().combat.reactionsUsed).toContain(table.owl.id);
  });
});

describe("Find Steed", () => {
  it("brings the steed of the type picked at the slot's level, replaces it on a new casting and goes when its caster dies", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({
      actionId: "spell-find-steed",
      slotLevel: 4,
      summon: { picks: [{ monsterId: "otherworldly-steed", form: "fey" }] }
    });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const steed = table.named("Otherworldly Steed")[0]!;
    // AC 10 + 1 per spell level, 5 + 10 Hit Points per spell level, a Fly Speed from level 4.
    expect(steed.armorClass).toBe(14);
    expect(steed.hp.maximum).toBe(45);
    const block = table.snapshot().definitions.find((entry) => entry.id === steed.definitionId)!.definition;
    expect((block.extensions["open5e.srd-2024"] as { speeds: { fly: number } }).speeds.fly).toBe(60);
    expect((block.extensions["open5e.srd-2024"] as { type: string }).type).toBe("fey");
    expect(block.actions.find((action) => action.id === "otherworldly-slam")!.damage[0]).toEqual({
      formula: "1d8 + 4",
      type: "psychic"
    });
    expect(block.actions.map((action) => action.id)).toContain("fey-step");
    expect(block.actions.map((action) => action.id)).not.toContain("healing-touch");
    const order = table.snapshot().combat.initiative.map((entry) => entry.actorId);
    expect(order[order.indexOf(CASTER) + 1]).toBe(steed.id);
    // A new casting replaces the steed.
    expect((await table.endTurn()).status).toBe(200);
    while (table.snapshot().combat.turnActorId !== CASTER) await table.endTurn();
    await table.resolve({ actionId: "spell-find-steed" });
    expect(table.actor(steed.id)).toBeUndefined();
    const second = table.named("Otherworldly Steed")[0]!;
    expect(second.name).toBe("Otherworldly Steed (Celestial)");
    // "The steed disappears if ... you die."
    const killed = await table.post(pathFor(GAME_PATHS.actorDamage, CASTER), table.gmToken, {
      actorId: CASTER,
      amount: 200,
      damageType: "slashing"
    });
    expect(killed.status, await killed.clone().text()).toBe(200);
    expect(table.actor(second.id)).toBeUndefined();
  });
});

describe("Phantom Steed", () => {
  it("is a Riding Horse with a Speed of 100 feet that vanishes when it takes any damage", async () => {
    const table = await bootSummons(cleanups);
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    const cast = await table.resolve({ actionId: "spell-phantom-steed" });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const horse = table.named("Phantom Steed")[0]!;
    expect(horse.speedFeet).toBe(100);
    expect(horse.control).toMatchObject({ by: CASTER, side: "party" });
    const hold = horse.effects.find((effect) => effect.id === horse.summon!.keptBy)!;
    expect(hold.duration).toEqual({ type: "minutes", remaining: 60 });
    const hit = await table.post(pathFor(GAME_PATHS.actorDamage, horse.id), table.gmToken, {
      actorId: horse.id,
      amount: 1,
      damageType: "slashing"
    });
    expect(hit.status, await hit.clone().text()).toBe(200);
    expect(table.actor(horse.id)).toBeUndefined();
  });
});

describe("Unseen Servant", () => {
  it("moves 15 feet on its caster's Bonus Action, and the spell ends past 60 feet", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-unseen-servant", summon: { at: cell(3, 3) } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const servant = table.named("Unseen Servant")[0]!;
    expect(servant.armorClass).toBe(10);
    expect(servant.hp.maximum).toBe(1);
    expect(servant.conditions.map((condition) => condition.id)).toContain("invisible");
    // It takes no turns of its own.
    await table.endTurn();
    expect(table.snapshot().combat.turnActorId).not.toBe(servant.id);
    while (table.snapshot().combat.turnActorId !== CASTER) await table.endTurn();
    const command = await table.post(pathFor(GAME_PATHS.summonCommand, CASTER), table.gmToken, { actorId: CASTER });
    expect(command.status, await command.clone().text()).toBe(200);
    expect(table.snapshot().combat.turn.bonusActionUsed).toBe(true);
    const player = table.server.auth.issuePlayerSession();
    expect((await table.post(GAME_PATHS.claims, player, { actorId: CASTER })).status).toBe(200);
    const moved = await table.move(servant.id, player, { position: cell(5, 3) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    // The GM carries it 65 feet away: the spell ends.
    await table.move(servant.id, table.gmToken, { position: cell(15, 3) });
    expect(table.actor(servant.id)).toBeUndefined();
  });
});

describe("Animate Objects", () => {
  it("animates objects worth up to the caster's modifier, a Large one counting as two", async () => {
    const table = await bootSummons(cleanups);
    const tooMany = await table.resolve({
      actionId: "spell-animate-objects",
      summon: {
        picks: [
          { monsterId: "animated-object", form: "large", count: 2 },
          { monsterId: "animated-object", form: "medium", count: 1 }
        ]
      }
    });
    expect(tooMany.status).toBe(409);
    expect(await tooMany.text()).toContain("animates up to 4 shares of objects");
    const cast = await table.resolve({
      actionId: "spell-animate-objects",
      slotLevel: 6,
      summon: {
        picks: [
          { monsterId: "animated-object", form: "large", count: 1 },
          { monsterId: "animated-object", form: "medium", count: 2 }
        ]
      }
    });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const objects = table.named("Animated Object");
    expect(objects).toHaveLength(3);
    const large = objects.find((actor) => actor.name.startsWith("Animated Object (Large)"))!;
    expect(large.hp.maximum).toBe(20);
    const block = table.snapshot().definitions.find((entry) => entry.id === large.definitionId)!.definition;
    // 2d6 + 3 + the modifier, and 1d6 more for the slot level above 5.
    expect(block.actions.find((action) => action.id === "slam")!.damage[0]).toEqual({
      formula: "3d6 + 7",
      type: "force"
    });
    expect(large.control).toMatchObject({ commandedWith: "bonus-action", commandFeet: 500 });
  });
});

describe("Create Undead", () => {
  it("offers Ghasts from a level 8 slot and refuses them below it", async () => {
    const table = await bootSummons(cleanups);
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    const low = await table.resolve({
      actionId: "spell-create-undead",
      slotLevel: 7,
      targetIds: [CORPSE],
      summon: { picks: [{ monsterId: "ghast" }] }
    });
    expect(low.status).toBe(409);
    const cast = await table.resolve({
      actionId: "spell-create-undead",
      slotLevel: 8,
      targetIds: [CORPSE, CORPSE_TWO],
      summon: { picks: [{ monsterId: "ghast" }] }
    });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const ghasts = table.named("Ghast");
    expect(ghasts).toHaveLength(2);
    expect(ghasts.every((ghast) => ghast.control?.commandFeet === 120)).toBe(true);
  });
});

describe("Animate Dead's second casting", () => {
  it("renews the command over creatures it made instead of raising new ones", async () => {
    const table = await bootSummons(cleanups);
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    await table.resolve({ actionId: "spell-animate-dead", targetIds: [CORPSE] });
    const zombie = table.named("Zombie")[0]!;
    expect((await table.post(GAME_PATHS.timePass, table.gmToken, { hours: 20 })).status).toBe(200);
    expect(table.actor(zombie.id)!.effects.find((effect) => effect.id === zombie.control!.keptBy)!.duration).toEqual({
      type: "minutes",
      remaining: 240
    });
    const again = await table.resolve({ actionId: "spell-animate-dead", targetIds: [zombie.id] });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(table.named("Zombie")).toHaveLength(1);
    expect(table.actor(zombie.id)!.effects.find((effect) => effect.id === zombie.control!.keptBy)!.duration).toEqual({
      type: "minutes",
      remaining: 1440
    });
  });
});

describe("Dominate Person", () => {
  it("puts a Humanoid that fails its save under the caster's command while the spell lasts", async () => {
    // "One Humanoid": a Beast picked takes the cast, and nothing happens to it.
    const beast = await bootSummons(cleanups, summonTable());
    const wolf = await beast.resolve({ actionId: "spell-dominate-person", targetIds: [WOLF] });
    expect(wolf.status, await wolf.clone().text()).toBe(200);
    expect(beast.snapshot().combat.pendingSaves.some((pending) => pending.targetActorId === WOLF)).toBe(false);
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
    expect(table.actor(BANDIT)!.control).toMatchObject({ by: CASTER, side: "party" });
    // Its commander's player acts for it.
    const player = table.server.auth.issuePlayerSession();
    expect((await table.post(GAME_PATHS.claims, player, { actorId: CASTER })).status).toBe(200);
    const moved = await table.move(BANDIT, player, { position: cell(5, 2), override: undefined });
    expect([200, 409]).toContain(moved.status);
    expect(moved.status === 403).toBe(false);
    // The Concentration ends, and so does the command.
    const holding = table.actor(CASTER)!.effects.find((effect) => effect.concentration)!;
    await table.post(
      GAME_PATHS.effectEnd.replace("{actorId}", CASTER).replace("{effectId}", holding.id),
      table.gmToken,
      { actorId: CASTER, effectId: holding.id }
    );
    expect(table.actor(BANDIT)!.control).toBeUndefined();
  });
});

describe("Class features that change a summoning spell", () => {
  /** The spell's cast with no slot, as a feature's free casting mints it, changed the way the feature says. */
  function freeCast(spellId: string, change: (action: ActorAction) => Partial<ActorAction>): ActorAction {
    const { spellSlot: _slot, ...cast } = castActionOf(spellId);
    return { ...cast, id: `spell-${spellId}-free`, uses: { limit: 1, per: "long-rest" }, ...change(cast) };
  }

  it("Dragon Companion casts Summon Dragon without Concentration, and then it lasts 1 minute", async () => {
    const companion = freeCast("summon-dragon", (cast) => ({
      summons: { ...cast.summons!, concentrationOptional: true }
    }));
    const table = await bootSummons(cleanups, summonTable([companion]));
    const cast = await table.resolve({ actionId: companion.id, summon: { withoutConcentration: true } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.concentration)).toBe(false);
    const [spirit] = table.named("Draconic Spirit");
    const keeping = spirit!.effects.find((effect) => effect.id === spirit!.summon!.keptBy)!;
    expect(keeping.duration).toEqual({ type: "rounds", remaining: 10 });
    expect(keeping.castId).toBeUndefined();
  });

  it("the spell from a slot holds Concentration whatever the request asks", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-summon-dragon", summon: { withoutConcentration: true } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.concentration)).toBe(true);
  });

  it("Pact of the Chain's Magic action brings an Imp at once, mid-encounter, on its own Initiative", async () => {
    const chain = freeCast("find-familiar", (cast) => ({
      activation: "action",
      castsAtOnce: true,
      uses: undefined,
      summons: { ...cast.summons!, creatures: [...cast.summons!.creatures, { monsterId: "imp", count: 1 }] }
    }));
    const table = await bootSummons(cleanups, summonTable([chain]));
    const cast = await table.resolve({ actionId: chain.id, summon: { picks: [{ monsterId: "imp" }] } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [imp] = table.named("Imp");
    expect(imp).toBeDefined();
    const entry = table.snapshot().combat.initiative.find((candidate) => candidate.actorId === imp!.id)!;
    expect(entry.follows).toBeUndefined();
  });

  it("Wild Companion's Fey familiar leaves when its Druid finishes a Long Rest", async () => {
    const companion = freeCast("find-familiar", (cast) => ({
      activation: "action",
      castsAtOnce: true,
      summons: { ...cast.summons!, creatureTypes: ["fey"], lasts: { type: "until-long-rest" } }
    }));
    const table = await bootSummons(cleanups, summonTable([companion]));
    const cast = await table.resolve({
      actionId: companion.id,
      summon: { picks: [{ monsterId: "owl" }], creatureType: "fiend" }
    });
    expect(cast.status).toBe(409);
    const fey = await table.resolve({ actionId: companion.id, summon: { picks: [{ monsterId: "owl" }] } });
    expect(fey.status, await fey.clone().text()).toBe(200);
    const [owl] = table.named("Owl");
    const block = table.snapshot().definitions.find((entry) => entry.id === owl!.definitionId)!.definition;
    expect((block.extensions["open5e.srd-2024"] as { type: string }).type).toBe("fey");
    expect((await table.post(GAME_PATHS.encounterEnd, table.gmToken)).status).toBe(200);
    const rested = await table.post(GAME_PATHS.actorRest.replace("{actorId}", CASTER), table.gmToken, {
      actorId: CASTER,
      kind: "long"
    });
    expect(rested.status, await rested.clone().text()).toBe(200);
    expect(table.named("Owl")).toEqual([]);
  });
});
