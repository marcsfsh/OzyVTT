import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import type { InventoryItem } from "@vtt/schemas";
import { catalogRow } from "./equipment-table.js";
import { bootSummons, CASTER, summonTable } from "./summon-fixtures.js";

// The SRD 5.2.1 items whose waits count from when their creature leaves, whose creature's death ends them, and whose
// uses are time spent from a pool: a figurine "can't be used again until a certain amount of time has passed" once it
// reverts, the Staff of the Python shatters when its snake dies, and Boots of Speed hold 10 minutes a Long Rest.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The caster carrying these items, equipped and attuned; "id#kind" is a copy of that kind. */
async function carrying(...ids: string[]) {
  const state = summonTable();
  const caster = state.actors.find((actor) => actor.id === CASTER)!;
  caster.inventory = [
    ...caster.inventory,
    ...ids.map((entry): InventoryItem => {
      const [id, variantId] = entry.split("#") as [string, string | undefined];
      return catalogRow(id, { attuned: true, equipped: true, ...(variantId ? { variantId } : {}) });
    })
  ];
  const table = await bootSummons(cleanups, state);
  const now = () => table.snapshot().rest.clockHours * 60 + table.snapshot().rest.clockMinutes;
  /** Ends turns until the caster's comes round again. */
  const nextCasterTurn = async () => {
    for (let step = 0; step < 12; step += 1) {
      await table.endTurn();
      if (table.snapshot().combat.turnActorId === CASTER) return;
    }
    throw new Error("The caster's turn never came round.");
  };
  const dismiss = (creatureId: string) =>
    table.post(GAME_PATHS.summonDismiss.replace("{actorId}", creatureId), table.gmToken, { actorId: creatureId });
  const damage = (actorId: string, amount: number) =>
    table.post(GAME_PATHS.actorDamage.replace("{actorId}", actorId), table.gmToken, { amount });
  return { ...table, now, nextCasterTurn, dismiss, damage };
}

describe("Staff of the Python", () => {
  it("waits an hour from when the snake turns back, and shatters when the snake dies", async () => {
    const table = await carrying("staff-of-the-python");
    const thrown = await table.resolve({ actionId: "item-staff-of-the-python-snake" });
    expect(thrown.status, await thrown.clone().text()).toBe(200);
    // The hour starts when it turns back, not as it is thrown.
    expect(table.actor(CASTER)!.readyAt["item-staff-of-the-python-snake"]).toBeUndefined();
    const [snake] = table.named("Giant Constrictor Snake");
    const back = await table.dismiss(snake!.id);
    expect(back.status, await back.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.readyAt["item-staff-of-the-python-snake"]?.minute).toBe(table.now() + 60);
    await table.nextCasterTurn();
    const again = await table.resolve({ actionId: "item-staff-of-the-python-snake" });
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("no uses remaining");
  });

  it("the snake dropping to 0 Hit Points destroys the staff", async () => {
    const table = await carrying("staff-of-the-python");
    await table.resolve({ actionId: "item-staff-of-the-python-snake" });
    const [snake] = table.named("Giant Constrictor Snake");
    const killed = await table.damage(snake!.id, 500);
    expect(killed.status, await killed.clone().text()).toBe(200);
    expect(table.named("Giant Constrictor Snake")).toEqual([]);
    expect(table.actor(CASTER)!.inventory.some((row) => row.id === "staff-of-the-python")).toBe(false);
  });
});

describe("Ring of Djinni Summoning", () => {
  it("its 24 hours count from when the djinni departs", async () => {
    const table = await carrying("ring-of-djinni-summoning");
    await table.resolve({ actionId: "item-ring-of-djinni-summoning-summon-djinni" });
    expect(table.actor(CASTER)!.readyAt["item-ring-of-djinni-summoning-summon-djinni"]).toBeUndefined();
    const holding = table.actor(CASTER)!.effects.find((effect) => effect.concentration)!;
    await table.post(
      GAME_PATHS.effectEnd.replace("{actorId}", CASTER).replace("{effectId}", holding.id),
      table.gmToken,
      {
        actorId: CASTER,
        effectId: holding.id
      }
    );
    expect(table.named("Djinni")).toEqual([]);
    expect(table.actor(CASTER)!.readyAt["item-ring-of-djinni-summoning-summon-djinni"]?.minute).toBe(
      table.now() + 24 * 60
    );
  });

  it("a djinni dropped to 0 leaves its ring with no magic", async () => {
    const table = await carrying("ring-of-djinni-summoning");
    await table.resolve({ actionId: "item-ring-of-djinni-summoning-summon-djinni" });
    const [djinni] = table.named("Djinni");
    const killed = await table.damage(djinni!.id, 1000);
    expect(killed.status, await killed.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.inventory.find((row) => row.id === "ring-of-djinni-summoning")).toMatchObject({
      dormant: true,
      attuned: false
    });
  });
});

describe("Figurine of Wondrous Power", () => {
  it("each Golden Lion is thrown and waits on its own", async () => {
    const table = await carrying("figurine-of-wondrous-power#golden-lions");
    const first = await table.resolve({ actionId: "item-figurine-of-wondrous-power-golden-lion-first" });
    expect(first.status, await first.clone().text()).toBe(200);
    expect(table.named("Lion")).toHaveLength(1);
    const [lion] = table.named("Lion");
    await table.nextCasterTurn();
    await table.dismiss(lion!.id);
    const caster = table.actor(CASTER)!;
    expect(caster.readyAt["figurine-of-wondrous-power-golden-lion-first"]?.minute).toBe(table.now() + 7 * 24 * 60);
    expect(caster.readyAt["figurine-of-wondrous-power-golden-lion-second"]).toBeUndefined();
    await table.nextCasterTurn();
    const second = await table.resolve({ actionId: "item-figurine-of-wondrous-power-golden-lion-second" });
    expect(second.status, await second.clone().text()).toBe(200);
  });

  it("the Goat of Terror can't attack, and waits 15 days once it reverts", async () => {
    const table = await carrying("figurine-of-wondrous-power#ivory-goats");
    const thrown = await table.resolve({ actionId: "item-figurine-of-wondrous-power-goat-of-terror" });
    expect(thrown.status, await thrown.clone().text()).toBe(200);
    const [goat] = table.named("Goat of Terror");
    expect(goat!.control).toMatchObject({ by: CASTER, noAttacks: true });
    await table.damage(goat!.id, 500);
    expect(table.actor(CASTER)!.readyAt["figurine-of-wondrous-power-goat-of-terror"]?.minute).toBe(
      table.now() + 15 * 24 * 60
    );
    // The figurine is not spent by its goat's fall.
    expect(table.actor(CASTER)!.inventory.some((row) => row.id === "figurine-of-wondrous-power")).toBe(true);
  });

  it("the Goat of Traveling spends an hour or part of one each time, and waits 7 days only when its 24 are spent", async () => {
    const table = await carrying("figurine-of-wondrous-power#ivory-goats");
    const pool = "figurine-of-wondrous-power-goat-of-traveling";
    await table.resolve({ actionId: "item-figurine-of-wondrous-power-goat-of-traveling" });
    let [goat] = table.named("Goat of Traveling");
    expect(goat!.effects.find((effect) => effect.id === goat!.summon!.keptBy)!.duration).toEqual({
      type: "minutes",
      remaining: 24 * 60
    });
    await table.nextCasterTurn();
    await table.dismiss(goat!.id);
    // Out for a round, it cost 1 of its 24, and there is no wait.
    expect(table.actor(CASTER)!.actionUses[pool]).toBe(1);
    expect(table.actor(CASTER)!.readyAt[pool]).toBeUndefined();
    await table.nextCasterTurn();
    const again = await table.resolve({ actionId: "item-figurine-of-wondrous-power-goat-of-traveling" });
    expect(again.status, await again.clone().text()).toBe(200);
    [goat] = table.named("Goat of Traveling");
    expect(goat!.effects.find((effect) => effect.id === goat!.summon!.keptBy)!.duration).toEqual({
      type: "minutes",
      remaining: 23 * 60
    });
    // Its 23 hours run out away from the fight: it reverts with all 24 spent, and waits 7 days.
    const ended = await table.post(GAME_PATHS.encounterEnd, table.gmToken, { commandId: randomUUID() });
    expect(ended.status, await ended.clone().text()).toBe(200);
    const passed = await table.post(GAME_PATHS.timePass, table.gmToken, { commandId: randomUUID(), hours: 24 });
    expect(passed.status, await passed.clone().text()).toBe(200);
    expect(table.named("Goat of Traveling")).toEqual([]);
    expect(table.actor(CASTER)!.actionUses[pool]).toBe(24);
    expect(table.actor(CASTER)!.readyAt[pool]).toBeDefined();
  });

  it("the Onyx Dog has Blindsight 60 feet, and the Silver Raven comes with Animal Messenger to cast on it", async () => {
    const table = await carrying("figurine-of-wondrous-power#onyx-dog", "figurine-of-wondrous-power#silver-raven");
    const dog = await table.resolve({ actionId: "item-figurine-of-wondrous-power-onyx-dog" });
    expect(dog.status, await dog.clone().text()).toBe(200);
    const [mastiff] = table.named("Mastiff");
    const stored = table.snapshot().definitions.find((entry) => entry.id === mastiff!.definitionId)!.definition;
    expect((stored.extensions["open5e.srd-2024"] as { senses: string[] }).senses).toContain("blindsight 60 ft.");
    expect(stored.abilityScores.int).toBe(8);
  });
});

describe("Boots of Speed", () => {
  it("a click lasts what is left of the 10 minutes, and ending it early gives the rest back", async () => {
    const table = await carrying("boots-of-speed");
    const pool = "boots-of-speed-rounds";
    const clicked = await table.resolve({ actionId: "item-boots-of-speed-click-heels" });
    expect(clicked.status, await clicked.clone().text()).toBe(200);
    const effectOf = () => table.actor(CASTER)!.effects.find((effect) => effect.name === "Boots of Speed");
    expect(effectOf()!.duration).toEqual({ type: "rounds", remaining: 100 });
    expect(table.actor(CASTER)!.actionUses[pool]).toBe(100);
    await table.nextCasterTurn();
    expect(effectOf()!.duration).toEqual({ type: "rounds", remaining: 99 });
    const effect = effectOf()!;
    const ended = await table.post(
      GAME_PATHS.effectEnd.replace("{actorId}", CASTER).replace("{effectId}", effect.id),
      table.gmToken,
      { actorId: CASTER, effectId: effect.id }
    );
    expect(ended.status, await ended.clone().text()).toBe(200);
    expect(table.actor(CASTER)!.actionUses[pool]).toBe(1);
    await table.nextCasterTurn();
    const again = await table.resolve({ actionId: "item-boots-of-speed-click-heels" });
    expect(again.status, await again.clone().text()).toBe(200);
    expect(effectOf()!.duration).toEqual({ type: "rounds", remaining: 99 });
    expect(table.actor(CASTER)!.actionUses[pool]).toBe(100);
  });
});
