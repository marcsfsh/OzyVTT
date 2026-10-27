import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { giveItem, setInventoryItem } from "../src/inventory.js";
import { studyItem } from "../src/item-study.js";
import { buildRequestOf } from "../src/ledger-rechoice.js";
import { STUDIED_ITEM_KIND, withStoredStudies } from "../src/study-ledger.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Manual of Bodily Health: "If you spend 48 hours over a period of 6 days or fewer studying the book's
// contents and practicing its guidelines, your Constitution increases by 2, to a maximum of 30. The manual then loses
// its magic but regains it in a century."

const library = new ContentLibrary().forAudience("play");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const deps = { library, policy, catalog };
const HERO = "75000000-0000-4000-8000-000000000001";
const FRIEND = "75000000-0000-4000-8000-000000000002";
const MANUAL = "manual-of-bodily-health";

function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

function fighter(): ActorDefinition {
  const { request } = generateCharacterRequest({ classId: "fighter", level: 4 }, library, policy, seeded(3));
  return buildCharacterDefinition(request, library, policy);
}

const manual = (quantity = 1): InventoryItem => ({
  id: MANUAL,
  name: "Manual of Bodily Health",
  quantity,
  equipped: false,
  attuned: false
});

function table(quantity = 1): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, fighter(), HERO, "public", catalog);
  importActorDefinition(state, fighter(), FRIEND, "public", catalog);
  const hero = state.actors.find((actor) => actor.id === HERO)!;
  hero.inventory = [...hero.inventory, manual(quantity)];
  return state;
}
const actor = (state: GameState, id = HERO) => state.actors.find((entry) => entry.id === id)!;
const sheet = (state: GameState, id = HERO) =>
  state.definitions.find((entry) => entry.id === `import-${id}`)!.definition;
const resolve = (state: GameState) => (definitionId: string) =>
  state.definitions.find((entry) => entry.id === definitionId)?.definition;

describe("studying a manual", () => {
  it("raises Constitution by 2, the Hit Point maximum by the level, and spends the copy", () => {
    const state = table();
    const constitution = sheet(state).abilityScores.con;
    const maximum = actor(state).hp.maximum;
    expect(studyItem(state, HERO, MANUAL, deps)).toEqual({
      item: "Manual of Bodily Health",
      ability: "Constitution",
      before: constitution,
      after: constitution + 2
    });
    expect(sheet(state).abilityScores.con).toBe(constitution + 2);
    expect(actor(state).hp.maximum).toBe(maximum + 4);
    expect(actor(state).inventory.find((item) => item.id === MANUAL)!.dormant).toBe(true);
    expect(sheet(state).character!.choices!.filter((row) => row.kind === STUDIED_ITEM_KIND)).toEqual([
      { level: 4, kind: STUDIED_ITEM_KIND, id: MANUAL, payload: { ability: "con", amount: 2, maximum: 30 } }
    ]);
  });

  it("refuses a second reader of the same copy", () => {
    const state = table();
    studyItem(state, HERO, MANUAL, deps);
    expect(() => studyItem(state, HERO, MANUAL, deps)).toThrow(/has lost its magic/);
    giveItem(state, HERO, FRIEND, MANUAL, resolve(state), { catalog, role: "gm" });
    expect(() => studyItem(state, FRIEND, MANUAL, deps)).toThrow(/has lost its magic/);
  });

  it("reads one copy of a stack, which leaves it as its own spent row", () => {
    const state = table(2);
    const constitution = sheet(state).abilityScores.con;
    studyItem(state, HERO, MANUAL, deps);
    const rows = actor(state).inventory.filter((item) => (item.recordId ?? item.id) === MANUAL);
    expect(rows.map((item) => [item.quantity, item.dormant ?? false])).toEqual([
      [1, false],
      [1, true]
    ]);
    studyItem(state, HERO, MANUAL, deps);
    expect(sheet(state).abilityScores.con).toBe(constitution + 4);
  });

  it("keeps the spent magic through an inventory edit", () => {
    const state = table();
    studyItem(state, HERO, MANUAL, deps);
    const { dormant: _spent, ...sent } = actor(state).inventory.find((item) => item.id === MANUAL)!;
    setInventoryItem(state, HERO, { ...sent, equipped: true }, resolve(state), { catalog, role: "player" });
    expect(actor(state).inventory.find((item) => item.id === MANUAL)!.dormant).toBe(true);
  });

  it("is kept by every rebuild, and a request can neither add a study nor drop one", () => {
    const state = table();
    studyItem(state, HERO, MANUAL, deps);
    const request = buildRequestOf(sheet(state), library)!;
    expect(buildCharacterDefinition(request, library, policy).abilityScores.con).toBe(sheet(state).abilityScores.con);
    const stored = sheet(state).character!.choices!;
    const unstudied = stored.filter((row) => row.kind !== STUDIED_ITEM_KIND);
    expect(withStoredStudies(unstudied, stored)).toEqual(expect.arrayContaining(stored));
    const forged = {
      level: 1,
      kind: STUDIED_ITEM_KIND,
      id: MANUAL,
      payload: { ability: "str", amount: 2, maximum: 30 }
    };
    expect(withStoredStudies([...unstudied, forged], [])).toEqual(unstudied);
  });

  it("waits for the encounter to end and refuses a book that isn't studied", () => {
    const state = table();
    state.combat.active = true;
    state.combat.initiative = [{ actorId: HERO } as GameState["combat"]["initiative"][number]];
    expect(() => studyItem(state, HERO, MANUAL, deps)).toThrow(/End the encounter/);
    state.combat.active = false;
    actor(state).inventory = [...actor(state).inventory, { ...manual(), id: "bag-of-holding", name: "Bag of Holding" }];
    expect(() => studyItem(state, HERO, "bag-of-holding", deps)).toThrow(/isn't a book a reader studies/);
  });
});

describe("the study command", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("is the GM's, and a GM's rebuild keeps the study", async () => {
    const state = table();
    const constitution = sheet(state).abilityScores.con;
    const { server, gmToken, post, close } = await bootServer(state);
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    const path = GAME_PATHS.characterStudyItem.replace("{actorId}", HERO);
    expect((await post(path, player, { commandId: randomUUID(), actorId: HERO, itemId: MANUAL })).status).toBe(403);
    const answered = await post(path, gmToken, { commandId: randomUUID(), actorId: HERO, itemId: MANUAL });
    expect(answered.status).toBe(200);
    expect((await answered.json()).data).toMatchObject({
      ability: "Constitution",
      before: constitution,
      after: constitution + 2
    });
    const live = server.store.snapshot;
    const studied = live.definitions.find((entry) => entry.id === `import-${HERO}`)!.definition;
    const { name: _name, keepsRecordedScores: _kept, ...build } = buildRequestOf(studied, library)!;
    const rebuild = await post(GAME_PATHS.characterRebuild.replace("{actorId}", HERO), gmToken, {
      commandId: randomUUID(),
      ...build,
      choices: build.choices.filter((row) => row.kind !== STUDIED_ITEM_KIND)
    });
    expect(rebuild.status).toBe(200);
    expect(
      server.store.snapshot.definitions.find((entry) => entry.id === `import-${HERO}`)!.definition.abilityScores.con
    ).toBe(constitution + 2);
  });
});
