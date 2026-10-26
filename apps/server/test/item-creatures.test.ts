import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { addActorFromDefinition, storedDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";
import { answerSave } from "../src/saving-throws.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";
import {
  actionOf,
  catalog,
  catalogRow,
  fighterInput,
  IDS,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";

// SRD 5.2.1 items that bring creatures: Pipes of the Sewers ("expend 1 to 3 charges, calling forth one Swarm of Rats
// with each expended charge ... the swarm makes a DC 15 Wisdom saving throw ... On a failed save, the swarm is swayed by
// the pipes' music and becomes Friendly to you"), a Manual of Golems ("A creature that can't use a Manual of Golems and
// attempts to read it takes 6d6 Psychic damage ... The golem is under your control") and an Apparatus of the Crab.

const library = new ContentLibrary();
const SWARM = "10000000-0000-4000-8000-0000000000d1";
const GM = { role: "gm" } as const;
let sequence = 0;
const nextId = () => `80000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-26T00:00:00.000Z";

const resolveIn =
  (table: Table) =>
  (id: string): ActorDefinition | undefined =>
    storedDefinition(table.state, id) ?? library.monsterForInstance(id);

/** A fight with these creatures in it, the first on turn. */
function fightAll(table: Table, actorIds: readonly string[]): void {
  startEncounter(
    table.state,
    { mapAssetId: IDS.map, entries: actorIds.map((actorId, index) => ({ actorId, score: 20 - index })) },
    () => 1,
    { width: 900, height: 600, calibration: null },
    resolveIn(table),
    Date.now(),
    catalog
  );
}

function use(
  table: Table,
  actorId: string,
  actionId: string,
  input: Partial<ResolveInput> = {},
  faces: number[] = [],
  role: "gm" | "player" = "gm"
) {
  return resolveDefinitionAction(
    table.state,
    actionOf(table, actorId, actionId),
    { actorId, targetIds: [], commandId: nextId(), ...input },
    {
      random: () => faces.shift() ?? 3,
      newRollId: nextId,
      gmSessionId: IDS.gmSession,
      now: NOW,
      definition: table.definition(actorId),
      catalog,
      resolveDefinition: resolveIn(table),
      initiatorRole: role
    }
  );
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The table on a real server with a battlemap, the fight started with `order` in it, two squares apart: for what the
 *  resolve command does beyond the resolution (summons, damage applied). */
async function served(table: Table, order: readonly string[]) {
  const booted = await bootMovementServer(table.state, cleanups);
  await booted.startFight(order, Object.fromEntries(order.map((id, index) => [id, cell(2 + 2 * index, 2)])));
  const resolve = async (actorId: string, actionId: string, targetIds: readonly string[] = []) => {
    const response = await booted.post(GAME_PATHS.actionResolve, booted.gmToken, {
      commandId: randomUUID(),
      actorId,
      actionId,
      ...(targetIds.length > 0 ? { targetIds } : {})
    });
    expect(response.status, await response.clone().text()).toBe(200);
    return response;
  };
  const snapshot = () => booted.server.store.snapshot;
  const actor = (id: string) => snapshot().actors.find((candidate) => candidate.id === id)!;
  return { ...booted, resolve, snapshot, actor };
}

describe("Pipes of the Sewers", () => {
  function piper(fighting = true) {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("pipes-of-the-sewers", { attuned: true }), "gm");
    addActorFromDefinition(table.state, library.monsterForInstance("swarm-of-rats")!, SWARM, "public", catalog);
    if (fighting) fightAll(table, [IDS.wizard, IDS.foe, SWARM]);
    return table;
  }

  it("calls a Swarm of Rats a charge, under no one's control", async () => {
    const table = await served(piper(false), [IDS.wizard, IDS.foe, SWARM]);
    const before = table.snapshot().actors.length;
    await table.resolve(IDS.wizard, "item-pipes-of-the-sewers-call-2");
    const called = table.snapshot().actors.slice(before);
    expect(called.map((actor) => actor.name.startsWith("Swarm of Rats"))).toEqual([true, true]);
    expect(called.every((actor) => actor.control === undefined)).toBe(true);
    expect(table.actor(IDS.wizard).actionUses["pipes-of-the-sewers-charges"]).toBe(2);
  });

  it("sways a swarm within 30 feet that fails its DC 15 Wisdom save, and only a swarm", () => {
    const table = piper();
    expect(() => use(table, IDS.wizard, "item-pipes-of-the-sewers-play", { targetIds: [IDS.foe] })).toThrow(
      /swarm of rats/
    );
    use(table, IDS.wizard, "item-pipes-of-the-sewers-play", { targetIds: [SWARM] });
    const pending = table.state.combat.pendingSaves.find((save) => save.targetActorId === SWARM)!;
    expect(pending).toMatchObject({ ability: "wis", dc: 15, immuneOnSuccess: true, immuneMinutes: 1440 });
    answerSave(table.state, nextId(), pending.id, "manual", 3, true, GM, {
      random: () => 10,
      newRollId: nextId,
      sessionId: IDS.gmSession,
      role: "gm",
      now: NOW,
      resolveDefinition: resolveIn(table),
      catalog
    });
    const swayed = table.actor(SWARM).effects.find((effect) => effect.name.startsWith("Swayed by the Pipes"))!;
    expect(swayed).toMatchObject({ sourceActorId: IDS.wizard });
    expect(swayed.tags).toEqual(expect.arrayContaining(["commanded", "commanded-within-30"]));
  });
});

describe("a Manual of Golems", () => {
  it("deals 6d6 Psychic to a reader that can't use it, which the GM applies, and stays in the pack", async () => {
    const base = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(base, IDS.fighter, catalogRow("manual-of-golems", { variantId: "clay" }), "gm");
    const table = await served(base, [IDS.fighter]);
    const read = await table.resolve(IDS.fighter, "item-manual-of-golems-read", [IDS.fighter]);
    const body = (await read.json()) as {
      data: { resolution: { damage: Array<{ formula: string; type: string }>; damageTotal: number } };
    };
    expect(body.data.resolution.damage[0]).toMatchObject({ formula: "6d6", type: "psychic" });
    expect(table.actor(IDS.fighter).inventory.some((row) => row.id === "manual-of-golems")).toBe(true);
  });

  it("animates its golem under its maker's command when the GM marks the work done, and burns", async () => {
    const base = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(base, IDS.wizard, catalogRow("manual-of-golems", { variantId: "clay" }), "gm");
    expect(() => use(base, IDS.wizard, "item-manual-of-golems-animate", {}, [], "player")).toThrow(/Ask your GM/);
    const table = await served(base, [IDS.wizard]);
    await table.resolve(IDS.wizard, "item-manual-of-golems-animate");
    const golem = table.snapshot().actors.find((actor) => actor.name === "Clay Golem")!;
    expect(golem.control).toMatchObject({ by: IDS.wizard });
    expect(table.actor(IDS.wizard).inventory.some((row) => row.id === "manual-of-golems")).toBe(false);
  });
});

describe("an Apparatus of the Crab", () => {
  it("is a Large AC 20 vehicle of 200 Hit Points whose claws swing at +8 for 2d6", async () => {
    const base = tableOf({ [IDS.fighter]: fighterInput() }, false);
    write(base, IDS.fighter, catalogRow("apparatus-of-the-crab"), "gm");
    const table = await served(base, [IDS.fighter]);
    await table.resolve(IDS.fighter, "item-apparatus-of-the-crab-deploy");
    const crab = table.snapshot().actors.find((actor) => actor.name === "Apparatus of the Crab")!;
    expect(crab).toMatchObject({ armorClass: 20, hp: { maximum: 200 }, size: "large" });
    expect(crab.control).toMatchObject({ by: IDS.fighter });
    const block =
      table.snapshot().definitions.find((entry) => entry.id === crab.definitionId)?.definition ??
      library.monsterForInstance("apparatus-of-the-crab")!;
    expect(block.actions.find((action) => action.id === "claw")).toMatchObject({
      attack: { bonus: 8 },
      damage: [{ formula: "2d6", type: "bludgeoning" }]
    });
    expect(block.actions.find((action) => action.id === "grasping-claw")?.onHit).toEqual([
      { conditions: [{ id: "grappled" }], escapeDc: 15 }
    ]);
  });
});
