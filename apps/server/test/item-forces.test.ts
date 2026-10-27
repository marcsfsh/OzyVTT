import { afterEach, describe, expect, it } from "vitest";
import { InventoryItemSchema } from "@vtt/schemas";
import { storedDefinition } from "../src/actor-roster.js";
import { effectiveActions } from "../src/effective-actions.js";
import { setInventoryItem } from "../src/inventory.js";
import { cell } from "./movement-fixtures.js";
import { catalog } from "./spell-casters.js";
import { BANDIT, bootSummons, CASTER, summonTable, WOLF } from "./summon-fixtures.js";

// Items that put a force on the map and strike from it (SRD 5.2.1): a Dancing Sword ("the weapon begins to hover,
// flies up to 30 feet, and attacks one creature of your choice within 5 feet of itself ... After the hovering weapon
// attacks for the fourth time, it flies back to you ... It also ceases to hover if you ... are more than 30 feet away
// from it") and a Feather Token's whip ("a melee spell attack against a creature within 10 feet of the whip, with an
// attack bonus of +9 ... As a Bonus Action, you can direct the whip to fly up to 20 feet and repeat the attack").

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The summoning Wizard carrying `rows`, bound and placed as the sheet's picker sends them. */
function carrying(...rows: ReadonlyArray<Record<string, unknown>>) {
  const state = summonTable();
  for (const row of rows)
    setInventoryItem(state, CASTER, InventoryItemSchema.parse(row), (id) => storedDefinition(state, id), {
      catalog,
      role: "gm"
    });
  return state;
}

type Table = Awaited<ReturnType<typeof bootSummons>>;
const positionOf = (table: Table, actorId: string) =>
  table.snapshot().combat.tokens.find((token) => token.actorId === actorId)?.position ?? null;

/** Ends this turn, and the others until it is the caster's again. */
async function toCastersTurn(table: Table) {
  await table.endTurn();
  for (let guard = 0; guard < 12 && table.snapshot().combat.turnActorId !== CASTER; guard++) await table.endTurn();
  expect(table.snapshot().combat.turnActorId).toBe(CASTER);
}

const SWORD = {
  id: "dancing-sword",
  name: "Dancing Sword",
  baseId: "longsword",
  equipped: true,
  attuned: true
};

describe("a Dancing Sword", () => {
  it("is tossed to strike from where it hovers, moves 30 feet to strike again, and flies back after its fourth attack", async () => {
    const table = await bootSummons(cleanups, carrying(SWORD));
    const toss = await table.resolve({ actionId: "item-dancing-sword-toss", targetIds: [BANDIT], attackTotal: 30 });
    expect(toss.status, await toss.clone().text()).toBe(200);
    const [sword] = table.named("Dancing Sword");
    expect(sword!.summon).toMatchObject({ by: CASTER, strikesFrom: { reachFeet: 5, moveFeet: 30, attacks: 4 } });
    expect(positionOf(table, sword!.id)).toEqual(cell(8, 2));
    // The wielder's own swing with it: a Longsword's 1d8 with the wielder's Strength modifier.
    const tossed = (await toss.clone().json()) as {
      data: { resolution: { attack: { outcome: string }; damage: Array<{ formula: string }> } };
    };
    expect(tossed.data.resolution.attack.outcome).toBe("hit");
    expect(tossed.data.resolution.damage[0]!.formula).toBe("1d8 - 1");
    for (const round of [1, 2, 3]) {
      await toCastersTurn(table);
      const dance = await table.resolve({ actionId: "item-dancing-sword-dance", targetIds: [WOLF], attackTotal: 30 });
      expect(dance.status, await dance.clone().text()).toBe(200);
      if (round < 3) expect(positionOf(table, sword!.id)).toEqual(cell(8, 4));
    }
    // The fourth attack sends it back.
    expect(table.named("Dancing Sword")).toEqual([]);
  });

  it("stays within 30 feet of its wielder and falls when its wielder is farther", async () => {
    const table = await bootSummons(cleanups, carrying(SWORD));
    await table.resolve({ actionId: "item-dancing-sword-toss", targetIds: [BANDIT], attackTotal: 30 });
    await toCastersTurn(table);
    const far = await table.resolve({
      actionId: "item-dancing-sword-dance",
      targetIds: [WOLF],
      summon: { at: cell(9, 4) }
    });
    expect(far.status).toBe(409);
    expect(await far.text()).toContain("within 30 feet");
    await table.move(CASTER, table.gmToken, { position: cell(1, 8) });
    expect(table.named("Dancing Sword")).toEqual([]);
  });
});

describe("a Feather Token's whip", () => {
  it("floats where it is thrown and strikes at +9 for 1d6 + 5 Force after the token is gone", async () => {
    const table = await bootSummons(
      cleanups,
      carrying({ id: "feather-token", name: "Feather Token", variantId: "whip", equipped: false })
    );
    const thrown = await table.resolve({ actionId: "item-feather-token-whip", summon: { at: cell(4, 2) } });
    expect(thrown.status, await thrown.clone().text()).toBe(200);
    expect(table.named("Floating Whip")).toHaveLength(1);
    expect(table.actor(CASTER)!.inventory.some((row) => row.id === "feather-token")).toBe(false);
    const crack = await table.resolve({
      actionId: "item-feather-token-whip-strike",
      targetIds: [BANDIT],
      attackTotal: 30
    });
    expect(crack.status, await crack.clone().text()).toBe(200);
    const body = (await crack.json()) as {
      data: { resolution: { attack: { outcome: string }; damage: Array<{ formula: string; type: string }> } };
    };
    expect(body.data.resolution.attack.outcome).toBe("hit");
    expect(body.data.resolution.damage[0]).toMatchObject({ formula: "1d6 + 5", type: "force" });
    const caster = table.actor(CASTER)!;
    const strike = effectiveActions(storedDefinition(table.snapshot(), caster.definitionId!), caster, catalog).find(
      (action) => action.id === "item-feather-token-whip-strike"
    );
    expect(strike?.attack?.bonus).toBe(9);
    expect(positionOf(table, table.named("Floating Whip")[0]!.id)).toEqual(cell(8, 2));
  });
});

describe("a Deck of Illusions", () => {
  it("draws a card on the d100 and throws an illusion within 30 feet that can't attack or be touched", async () => {
    const table = await bootSummons(
      cleanups,
      carrying({ id: "deck-of-illusions", name: "Deck of Illusions", equipped: true })
    );
    const before = table.snapshot().actors.length;
    const drawn = await table.resolve({ actionId: "item-deck-of-illusions-draw", summon: { at: cell(4, 2) } });
    expect(drawn.status, await drawn.clone().text()).toBe(200);
    const made = table.snapshot().actors.slice(before);
    // A 97-00 shows the drawer, which the GM places; every other face is a creature.
    expect(made.length).toBeLessThanOrEqual(1);
    for (const illusion of made) {
      expect(illusion.summon).toMatchObject({ by: CASTER, intangible: true });
      expect(illusion.control).toMatchObject({ by: CASTER, noAttacks: true, commandedWith: "action" });
    }
    expect(table.actor(CASTER)!.actionUses["deck-of-illusions-cards"]).toBe(1);
  });
});
