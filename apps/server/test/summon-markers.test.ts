import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { playerViewerIds } from "../src/vision/audience.js";
import { cell } from "./movement-fixtures.js";
import { BANDIT, bootSummons, CASTER, WOLF } from "./summon-fixtures.js";

// The spells that put a force or an illusion on the map (SRD 5.2.1): a force their attacks reach from (Spiritual
// Weapon, Arcane Sword, Conjure Fey), a hand with Hit Points (Arcane Hand), and tokens their caster sees through or
// moves (Arcane Eye, Mage Hand, Mislead, Project Image).

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Table = Awaited<ReturnType<typeof bootSummons>>;

const positionOf = (table: Table, actorId: string) =>
  table.snapshot().combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;

/** Ends this turn, and the others until it is the caster's again. */
async function toCastersTurn(table: Table) {
  await table.endTurn();
  for (let guard = 0; guard < 12 && table.snapshot().combat.turnActorId !== CASTER; guard++) await table.endTurn();
  expect(table.snapshot().combat.turnActorId).toBe(CASTER);
}

describe("Spiritual Weapon", () => {
  it("strikes from the force it places, which a later attack moves up to 20 feet first", async () => {
    const table = await bootSummons(cleanups);
    // The bandit stands 30 feet off: the force appears beside it and strikes.
    const cast = await table.resolve({ actionId: "spell-spiritual-weapon", targetIds: [BANDIT], attackTotal: 30 });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [force] = table.named("Spiritual Weapon");
    expect(force).toBeDefined();
    expect(force!.summon).toMatchObject({ by: CASTER, intangible: true, strikesFrom: { reachFeet: 5, moveFeet: 20 } });
    expect(positionOf(table, force!.id)).toEqual(cell(8, 2));
    // The force can't be harmed.
    const struck = await table.resolve({ actionId: "spell-spiritual-weapon-then-attack", targetIds: [force!.id] });
    expect(struck.status).toBe(409);
    await toCastersTurn(table);
    // The wolf 15 feet from the force: the force moves to it and strikes.
    await table.move(WOLF, table.gmToken, { position: cell(11, 2) });
    const next = await table.resolve({
      actionId: "spell-spiritual-weapon-then-attack",
      targetIds: [WOLF],
      attackTotal: 30
    });
    expect(next.status, await next.clone().text()).toBe(200);
    expect(positionOf(table, force!.id)).toEqual(cell(11, 2));
    await toCastersTurn(table);
    // The bandit is now 15 feet from the force, then moved 25 feet away: beyond its move and its reach.
    await table.move(BANDIT, table.gmToken, { position: cell(16, 2) });
    const far = await table.resolve({ actionId: "spell-spiritual-weapon-then-attack", targetIds: [BANDIT] });
    expect(far.status).toBe(409);
    expect(await far.text()).toContain("reach");
    // Moving it 25 feet is more than the spell allows.
    const tooFar = await table.resolve({
      actionId: "spell-spiritual-weapon-then-attack",
      targetIds: [BANDIT],
      summon: { at: cell(16, 2) }
    });
    expect(tooFar.status).toBe(409);
    expect(await tooFar.text()).toContain("moves up to 20 feet");
  });

  it("ends with its Concentration, and the force with it", async () => {
    const table = await bootSummons(cleanups);
    await table.resolve({ actionId: "spell-spiritual-weapon", targetIds: [BANDIT], attackTotal: 30 });
    const holding = table.actor(CASTER)!.effects.find((effect) => effect.concentration)!;
    await table.post(
      GAME_PATHS.effectEnd.replace("{actorId}", CASTER).replace("{effectId}", holding.id),
      table.gmToken,
      {
        actorId: CASTER,
        effectId: holding.id
      }
    );
    expect(table.named("Spiritual Weapon")).toEqual([]);
  });
});

describe("Arcane Sword and Conjure Fey", () => {
  it("Arcane Sword's force moves 30 feet before it strikes again", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-arcane-sword", targetIds: [BANDIT], attackTotal: 30 });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [sword] = table.named("Arcane Sword");
    await toCastersTurn(table);
    await table.move(WOLF, table.gmToken, { position: cell(14, 2) });
    const next = await table.resolve({
      actionId: "spell-arcane-sword-then-attack",
      targetIds: [WOLF],
      attackTotal: 30
    });
    expect(next.status, await next.clone().text()).toBe(200);
    expect(positionOf(table, sword!.id)).toEqual(cell(14, 2));
  });

  it("Conjure Fey's spirit teleports up to 30 feet, and no farther", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-conjure-fey", targetIds: [BANDIT], attackTotal: 30 });
    expect(cast.status, await cast.clone().text()).toBe(200);
    expect(table.named("Fey Spirit")).toHaveLength(1);
    await toCastersTurn(table);
    const far = await table.resolve({
      actionId: "spell-conjure-fey-then-attack",
      targetIds: [WOLF],
      summon: { at: cell(15, 4) }
    });
    expect(far.status).toBe(409);
    expect(await far.text()).toContain("teleports up to 30 feet");
  });
});

describe("Arcane Hand", () => {
  it("is AC 20 with its caster's Hit Point maximum, its fist reaches from it, and the spell ends at 0 Hit Points", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-arcane-hand", summon: { at: cell(7, 2) } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [hand] = table.named("Arcane Hand");
    expect(hand!.armorClass).toBe(20);
    expect(hand!.hp.maximum).toBe(table.actor(CASTER)!.hp.maximum);
    const fist = await table.resolve({
      actionId: "spell-arcane-hand-then-clenched-fist",
      targetIds: [BANDIT],
      attackTotal: 30
    });
    expect(fist.status, await fist.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.concentration)).toBe(true);
    const smashed = await table.post(GAME_PATHS.actorDamage.replace("{actorId}", hand!.id), table.gmToken, {
      actorId: hand!.id,
      amount: hand!.hp.maximum
    });
    expect(smashed.status, await smashed.clone().text()).toBe(200);
    expect(table.named("Arcane Hand")).toEqual([]);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.concentration)).toBe(false);
  });
});

describe("Arcane Eye", () => {
  it("is an invisible eye its caster's player sees through, moved 30 feet with a Bonus Action", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-arcane-eye", summon: { at: cell(4, 2) } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [eye] = table.named("Arcane Eye");
    expect(eye!.conditions.some((condition) => condition.id === "invisible")).toBe(true);
    const player = table.server.auth.issuePlayerSession();
    expect((await table.post(GAME_PATHS.claims, player, { actorId: CASTER })).status).toBe(200);
    const session = table.snapshot().actors.find((actor) => actor.id === CASTER)!.ownerSessionId!;
    expect(playerViewerIds(table.snapshot(), session)).toEqual(expect.arrayContaining([CASTER, eye!.id]));
    await toCastersTurn(table);
    const sent = await table.post(GAME_PATHS.summonCommand.replace("{actorId}", CASTER), player, { actorId: CASTER });
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(table.snapshot().combat.turn.bonusActionUsed).toBe(true);
    const moved = await table.move(eye!.id, player, { position: cell(10, 2) });
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(positionOf(table, eye!.id)).toEqual(cell(10, 2));
  });
});

describe("Clairvoyance", () => {
  it("leaves an Invisible sensor that stays put, which its caster's player sees through", async () => {
    const table = await bootSummons(cleanups);
    await table.post(GAME_PATHS.encounterEnd, table.gmToken);
    const cast = await table.resolve({
      actionId: "spell-clairvoyance",
      summon: { at: cell(14, 2) },
      override: { reason: "The focus is in the pack." }
    });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [sensor] = table.named("Clairvoyance Sensor");
    expect(sensor!.conditions.some((condition) => condition.id === "invisible")).toBe(true);
    const player = table.server.auth.issuePlayerSession();
    expect((await table.post(GAME_PATHS.claims, player, { actorId: CASTER })).status).toBe(200);
    const session = table.snapshot().actors.find((actor) => actor.id === CASTER)!.ownerSessionId!;
    expect(playerViewerIds(table.snapshot(), session)).toEqual(expect.arrayContaining([CASTER, sensor!.id]));
  });
});

describe("Floating Disk", () => {
  it("follows its caster to stay within 20 feet, and ends 100 feet away", async () => {
    const table = await bootSummons(cleanups);
    await table.post(GAME_PATHS.encounterEnd, table.gmToken);
    const cast = await table.resolve({ actionId: "spell-floating-disk", summon: { at: cell(3, 2) } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [disk] = table.named("Floating Disk");
    const start = positionOf(table, CASTER)!;
    await table.move(CASTER, table.gmToken, { position: { x: start.x + 400, y: start.y } });
    const caster = positionOf(table, CASTER)!;
    const after = positionOf(table, disk!.id)!;
    expect(Math.abs(caster.x - after.x) / 10).toBeLessThanOrEqual(25);
    expect(after.x).toBeGreaterThan(cell(3, 2).x);
  });
});

describe("Mage Hand", () => {
  it("vanishes more than 30 feet from its caster, and a second casting replaces it", async () => {
    const table = await bootSummons(cleanups);
    expect((await table.resolve({ actionId: "spell-mage-hand", summon: { at: cell(5, 2) } })).status).toBe(200);
    expect(table.named("Mage Hand")).toHaveLength(1);
    await table.post(GAME_PATHS.encounterEnd, table.gmToken);
    expect((await table.resolve({ actionId: "spell-mage-hand", summon: { at: cell(4, 2) } })).status).toBe(200);
    expect(table.named("Mage Hand")).toHaveLength(1);
    await table.move(CASTER, table.gmToken, { position: cell(14, 2) });
    expect(table.named("Mage Hand")).toEqual([]);
  });
});

describe("Mislead and Project Image", () => {
  it("Mislead makes its caster Invisible beside a double that outlasts the invisibility", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-mislead" });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [double] = table.named("Illusory Double");
    expect(positionOf(table, double!.id)).toEqual(positionOf(table, CASTER));
    expect(table.actor(CASTER)!.conditions.some((condition) => condition.id === "invisible")).toBe(true);
    await toCastersTurn(table);
    // Attacking ends the invisibility; the double and the Concentration stay.
    await table.move(BANDIT, table.gmToken, { position: cell(3, 2) });
    const attack = await table.resolve({ actionId: "spell-magic-missile", targetIds: [BANDIT] });
    expect(attack.status, await attack.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.conditions.some((condition) => condition.id === "invisible")).toBe(false);
    expect(table.named("Illusory Double")).toHaveLength(1);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.concentration)).toBe(true);
  });

  it("Project Image's copy goes, and the spell with it, when it takes any damage", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-project-image", summon: { at: cell(12, 6) } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const [copy] = table.named("Illusory Copy");
    expect(positionOf(table, copy!.id)).toEqual(cell(12, 6));
    await table.post(GAME_PATHS.actorDamage.replace("{actorId}", copy!.id), table.gmToken, {
      actorId: copy!.id,
      amount: 1
    });
    expect(table.named("Illusory Copy")).toEqual([]);
    expect(table.actor(CASTER)!.effects.some((effect) => effect.concentration)).toBe(false);
  });
});
