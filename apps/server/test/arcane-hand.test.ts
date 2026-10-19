import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import { mapCover } from "../src/cover.js";
import { laterSpellAction } from "../src/item-actions.js";
import { zoneGround } from "../src/zone-ground.js";
import { cell } from "./movement-fixtures.js";
import { BANDIT, bootSummons, CASTER, WOLF } from "./summon-fixtures.js";

// SRD 5.2.1 Arcane Hand: "When you cast the spell and as a Bonus Action on your later turns, you can move the hand up
// to 60 feet and then cause one of the following effects": Clenched Fist, Forceful Hand, Grasping Hand (and its crush
// while the hand grapples the target) and Interposing Hand.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type Table = Awaited<ReturnType<typeof bootSummons>>;

const positionOf = (table: Table, actorId: string) =>
  table.snapshot().combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;

async function failSave(table: Table, targetId: string) {
  const save = table.snapshot().combat.pendingSaves.find((pending) => pending.targetActorId === targetId)!;
  expect(save).toBeDefined();
  const failed = await table.post(GAME_PATHS.saveAnswer.replace("{saveId}", save.id), table.gmToken, {
    saveId: save.id,
    method: "manual",
    total: 1,
    commit: true
  });
  expect(failed.status, await failed.clone().text()).toBe(200);
}

async function toCastersTurn(table: Table) {
  await table.endTurn();
  for (let guard = 0; guard < 12 && table.snapshot().combat.turnActorId !== CASTER; guard++) await table.endTurn();
  expect(table.snapshot().combat.turnActorId).toBe(CASTER);
}

describe("Arcane Hand's effects", () => {
  it("pushes and grapples only a Huge or smaller creature", () => {
    const hand = loadSpells().find((spell) => spell.id === "arcane-hand")!;
    const row = (name: string) => hand.effect!.laterActions!.find((later) => later.name === name)!;
    const numbers = { attackBonus: 7, saveDc: 15, bearersDc: true, modifier: 3 };
    expect(laterSpellAction(hand, row("forceful hand"), numbers).save?.failurePush).toEqual({
      feet: 20,
      upTo: true,
      maxTargetSize: "huge"
    });
    expect(laterSpellAction(hand, row("grasping hand"), numbers).save?.failureMaxSize).toBe("huge");
  });

  it("takes one effect with the cast at no further cost, and later ones as a Bonus Action", async () => {
    const table = await bootSummons(cleanups);
    const cast = await table.resolve({ actionId: "spell-arcane-hand", summon: { at: cell(7, 2) } });
    expect(cast.status, await cast.clone().text()).toBe(200);
    const fist = await table.resolve({
      actionId: "spell-arcane-hand-then-clenched-fist",
      targetIds: [BANDIT],
      attackTotal: 30
    });
    expect(fist.status, await fist.clone().text()).toBe(200);
    expect(table.snapshot().combat.turn.bonusActionUsed).toBe(false);
    // A second effect this turn is the Bonus Action.
    const again = await table.resolve({
      actionId: "spell-arcane-hand-then-clenched-fist",
      targetIds: [BANDIT],
      attackTotal: 30
    });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(table.snapshot().combat.turn.bonusActionUsed).toBe(true);
  });

  it("crushes only the creature the hand grapples, for 4d6 plus 2d6 a slot level above 5", async () => {
    const table = await bootSummons(cleanups);
    await table.resolve({ actionId: "spell-arcane-hand", slotLevel: 7, summon: { at: cell(7, 2) } });
    const loose = await table.resolve({ actionId: "spell-arcane-hand-then-crush", targetIds: [BANDIT] });
    expect(loose.status).toBe(409);
    expect(await loose.text()).toContain("isn't under");
    const grasp = await table.resolve({ actionId: "spell-arcane-hand-then-grasping-hand", targetIds: [BANDIT] });
    expect(grasp.status, await grasp.clone().text()).toBe(200);
    await failSave(table, BANDIT);
    expect(table.actor(BANDIT)!.effects.some((effect) => effect.linkedConditionIds.includes("grappled"))).toBe(true);
    await toCastersTurn(table);
    const crush = await table.resolve({ actionId: "spell-arcane-hand-then-crush", targetIds: [BANDIT] });
    expect(crush.status, await crush.clone().text()).toBe(200);
    const body = (await crush.json()) as { data: { resolution: { damage?: Array<{ formula: string }> } } };
    expect(body.data.resolution.damage?.[0]?.formula).toMatch(/^8d6 \+ 4/);
    const other = await table.resolve({ actionId: "spell-arcane-hand-then-crush", targetIds: [WOLF] });
    expect(other.status).toBe(409);
  });

  it("pushes a creature that fails its Strength save 5 feet plus five times the modifier, the hand following", async () => {
    const table = await bootSummons(cleanups);
    await table.resolve({ actionId: "spell-arcane-hand", summon: { at: cell(7, 2) } });
    const push = await table.resolve({
      actionId: "spell-arcane-hand-then-forceful-hand",
      targetIds: [BANDIT],
      summon: { at: cell(7, 2) }
    });
    expect(push.status, await push.clone().text()).toBe(200);
    const hand = table.named("Arcane Hand")[0]!;
    const handBefore = positionOf(table, hand.id)!;
    const bandit = positionOf(table, BANDIT)!;
    await failSave(table, BANDIT);
    // +4 spellcasting modifier: 25 feet straight away from the hand, five cells on the 50px grid.
    const pushed = positionOf(table, BANDIT)!;
    expect(pushed.x - bandit.x).toBe(250);
    expect(positionOf(table, hand.id)).toEqual({
      x: handBefore.x + pushed.x - bandit.x,
      y: handBefore.y + pushed.y - bandit.y
    });
  });

  it("interposes: Half Cover for its caster through its space and Difficult Terrain there for enemies", async () => {
    const table = await bootSummons(cleanups);
    await table.resolve({ actionId: "spell-arcane-hand", summon: { at: cell(7, 2) } });
    expect(mapCover(table.snapshot(), BANDIT, CASTER)).toBeNull();
    const interpose = await table.resolve({
      actionId: "spell-arcane-hand-then-interposing-hand",
      summon: { at: cell(5, 2) }
    });
    expect(interpose.status, await interpose.clone().text()).toBe(200);
    expect(mapCover(table.snapshot(), BANDIT, CASTER)).toBe("half");
    const ground = zoneGround(table.snapshot(), BANDIT, {
      geometry: null as never,
      resolveDefinition: () => undefined,
      catalog: undefined
    });
    expect(ground!.difficult.some((inside) => inside(cell(5, 2), 1))).toBe(true);
    // Another effect ends the interposing.
    await toCastersTurn(table);
    await table.resolve({ actionId: "spell-arcane-hand-then-clenched-fist", targetIds: [BANDIT], attackTotal: 30 });
    expect(mapCover(table.snapshot(), BANDIT, CASTER)).toBeNull();
  });
});
