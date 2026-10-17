import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadActorFixture } from "@vtt/test-fixtures";
import type { ActorDefinition } from "@vtt/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { deriveActorSheet } from "../src/actor-derived.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { answerSave, auraOfProtection, createPendingSaves } from "../src/saving-throws.js";
import { createServer } from "../src/server.js";

// SRD Aura of Protection: "You and your allies in the aura gain a bonus to saving throws equal to your Charisma modifier
// (minimum bonus of +1)", in a 10-foot Emanation (30 feet with Aura Expansion), inactive while Incapacitated.

const PALADIN = "10000000-0000-4000-8000-0000000000f1";
const ALLY = "10000000-0000-4000-8000-0000000000f2";
const FAR = "10000000-0000-4000-8000-0000000000f3";
const GOBLIN_ID = "10000000-0000-4000-8000-0000000000f4";
const GOBLIN = loadMonsterDefinitions().find((monster) => monster.source?.externalId === "goblin-warrior")!;

/** The fixture's sheet (Dex 14, Con 14, Cha 8), as a Paladin 6 with Charisma `cha` when `features` say so. */
function sheet(name: string, features: readonly string[] = [], cha = 16): ActorDefinition {
  const base = loadActorFixture("player-character") as ActorDefinition;
  return {
    ...base,
    name,
    abilityScores: { ...base.abilityScores, cha },
    character: {
      classes: [{ id: "paladin", name: "Paladin", level: 6 }],
      feats: [],
      features: features.map((id) => ({ id, kind: "class" as const, sourceId: "paladin" }))
    }
  };
}

const PALADIN_SHEET = sheet("Sir Ada", ["aura-of-protection"]);
const PLAIN_SHEET = sheet("Plain", [], 8);

function table(paladin: ActorDefinition = PALADIN_SHEET): {
  state: GameState;
  resolve: (id: string) => ActorDefinition | undefined;
} {
  const definitions: Record<string, ActorDefinition> = {
    "paladin-def": paladin,
    "plain-def": PLAIN_SHEET,
    "goblin-def": GOBLIN
  };
  const pc = (id: string, name: string, definitionId: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 30, maximum: 30 },
    definitionId
  });
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      pc(PALADIN, "Sir Ada", "paladin-def"),
      pc(ALLY, "Bran", "plain-def"),
      pc(FAR, "Cass", "plain-def"),
      {
        id: GOBLIN_ID,
        name: "Goblin",
        kind: "monster",
        visibility: "public",
        hp: { current: 7, maximum: 7 },
        definitionId: "goblin-def"
      }
    ]
  });
  return { state, resolve: (id) => definitions[id] };
}

/** Bran stands 10 feet from Sir Ada, Cass 15, the Goblin 5. */
const FEET: Readonly<Record<string, number>> = { [ALLY]: 10, [FAR]: 15, [GOBLIN_ID]: 5 };
const distanceFeet = (a: string, b: string) => (a === b ? 0 : (FEET[a === PALADIN ? b : a] ?? null));

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;

describe("Aura of Protection", () => {
  it("gives the Paladin and allies within 10 feet the Charisma modifier, and no one else", () => {
    const { state, resolve } = table();
    const context = { resolveDefinition: resolve, distanceFeet };
    expect(auraOfProtection(state, actor(state, PALADIN), context)).toEqual({
      amount: 3,
      source: "Aura of Protection"
    });
    expect(auraOfProtection(state, actor(state, ALLY), context)).toEqual({
      amount: 3,
      source: "Sir Ada's Aura of Protection"
    });
    expect(auraOfProtection(state, actor(state, FAR), context)).toBeNull();
    // A foe in the aura gets nothing.
    expect(auraOfProtection(state, actor(state, GOBLIN_ID), context)).toBeNull();
    // With no map to measure, only the Paladin's own is known to reach.
    expect(auraOfProtection(state, actor(state, ALLY), { resolveDefinition: resolve })).toBeNull();
  });

  it("reaches 30 feet with Aura Expansion, gives at least +1, and stops while the Paladin is Incapacitated", () => {
    const expanded = table(sheet("Sir Ada", ["aura-of-protection", "aura-expansion"], 8));
    const context = { resolveDefinition: expanded.resolve, distanceFeet };
    expect(auraOfProtection(expanded.state, actor(expanded.state, FAR), context)).toMatchObject({ amount: 1 });
    actor(expanded.state, PALADIN).conditions = [{ id: "stunned" }];
    expect(auraOfProtection(expanded.state, actor(expanded.state, FAR), context)).toBeNull();
    expect(auraOfProtection(expanded.state, actor(expanded.state, PALADIN), context)).toBeNull();
  });

  it("keeps a hidden Paladin's aura off a visible creature's save, which would reveal the Paladin", () => {
    const { state, resolve } = table();
    actor(state, PALADIN).visibility = "gm-only";
    expect(auraOfProtection(state, actor(state, ALLY), { resolveDefinition: resolve, distanceFeet })).toBeNull();
  });

  it("adds to the save the server rolls, and to the Paladin's own save chips", () => {
    const { state, resolve } = table();
    createPendingSaves(state, {
      sourceActorId: GOBLIN_ID,
      sourceName: "Goblin",
      actionName: "Firebomb",
      ability: "dex",
      dc: 15,
      targetIds: [ALLY],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      newSaveId: () => "60000000-0000-4000-8000-0000000000f1",
      createdAt: 0
    });
    const { outcome } = answerSave(
      state,
      randomUUID(),
      "60000000-0000-4000-8000-0000000000f1",
      "roll",
      undefined,
      true,
      { role: "gm" },
      {
        random: () => 10,
        newRollId: () => "40000000-0000-4000-8000-0000000000f1",
        sessionId: "30000000-0000-4000-8000-00000000000a",
        role: "gm",
        now: () => "2026-10-16T00:00:00.000Z",
        resolveDefinition: resolve,
        distanceFeet
      }
    );
    // 10 + Dex 2 + the aura's 3 meets DC 15.
    expect(outcome).toMatchObject({ natural: 10, total: 15, success: true });

    const paladin = actor(state, PALADIN);
    const own = deriveActorSheet(paladin, PALADIN_SHEET, deriveEquipment(paladin, PALADIN_SHEET, undefined), []);
    expect(own.abilities.find((row) => row.ability === "dex")!.save).toBe(5);
    const bran = actor(state, ALLY);
    const plain = deriveActorSheet(bran, PLAIN_SHEET, deriveEquipment(bran, PLAIN_SHEET, undefined), []);
    expect(plain.abilities.find((row) => row.ability === "dex")!.save).toBe(2);
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("the sheet's save chip rolls under the save rules", () => {
  it("adds the Paladin's own aura to a loose save and fails a Paralyzed creature's Strength save without a die", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-aura-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: GameStateSchema.parse({
        schemaVersion: 1,
        definitions: [{ id: "paladin-def", definition: { ...PALADIN_SHEET, id: "paladin-def" } }],
        actors: [
          {
            id: PALADIN,
            name: "Sir Ada",
            kind: "player-character",
            visibility: "public",
            hp: { current: 30, maximum: 30 },
            definitionId: "paladin-def"
          }
        ]
      })
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind.");
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${address.port}`;
    const post = (body: unknown) =>
      fetch(base + GAME_PATHS.saveRoll, {
        method: "POST",
        headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    const rolled = await (await post({ commandId: randomUUID(), actorId: PALADIN, ability: "dex", face: 9 })).json();
    // 9 + Dex 2 + the aura's 3.
    expect(rolled.data).toMatchObject({ route: "loose", outcome: { natural: 9, total: 14 } });
    expect(server.store.snapshot.rolls.at(-1)).toMatchObject({ typed: true, total: 14, label: "DEX save" });

    await fetch(base + GAME_PATHS.actorConditions.replace("{actorId}", PALADIN), {
      method: "POST",
      headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
      body: JSON.stringify({ commandId: randomUUID(), actorId: PALADIN, conditionId: "paralyzed", active: true })
    });
    const recorded = server.store.snapshot.rolls.length;
    const failed = await (await post({ commandId: randomUUID(), actorId: PALADIN, ability: "str" })).json();
    expect(failed.data).toMatchObject({ route: "loose", outcome: { autoFailed: "paralyzed", total: 0 } });
    expect(server.store.snapshot.rolls).toHaveLength(recorded);
  });
});
