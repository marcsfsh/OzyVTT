import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { replaceableOffers } from "../src/choice-overrides.js";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { buildRequestOf } from "../src/ledger-rechoice.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";

// SRD 5.2.1 Circle of the Land Spells: "Whenever you finish a Long Rest, choose one type of land: arid, polar,
// temperate, or tropical. Consult the table below that corresponds to the chosen type; you have the spells listed for
// your Druid level and lower prepared." Nature's Ward: "Resistance to a damage type associated with your current land
// choice".

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const DRUID = "70000000-0000-4000-8000-000000000001";
const LAND = "feature:circle-of-the-land-spells";

type ClassPlan = ReadonlyArray<{ classId: string; level: number }>;
/** A Fighter 1 / Druid 3, whose Circle of the Land comes with the later class. */
const FIGHTER_DRUID: ClassPlan = [
  { classId: "fighter", level: 1 },
  { classId: "druid", level: 3 }
];

/** A seeded stand-in for the dice (mulberry32), so the generated Druid is the same every run. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

/** A Circle of the Land Druid at `level` with the given land, and the hit points the generator rolled. A `plan`
 *  multiclasses it, each class with its levels and the starting class first. */
function landDruid(level: number, land: string, plan?: ClassPlan): ActorDefinition {
  const { request } = generateCharacterRequest(
    plan ? { level, classes: plan } : { classId: "druid", level },
    library,
    policy,
    seeded(7)
  );
  const choices = request.choices.map((row) =>
    row.payload?.featureId === "circle-of-the-land-spells" ? { ...row, id: land } : row
  ) as CharacterChoice[];
  return buildCharacterDefinition({ ...request, choices }, library, policy);
}

const alwaysPrepared = (definition: ActorDefinition | undefined) =>
  (definition?.spellcasting?.spells ?? []).filter((spell) => spell.alwaysPrepared).map((spell) => spell.id);

function table(definition: ActorDefinition): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, DRUID, "public", catalog);
  return state;
}

describe("reading a built character's request back off its ledger", () => {
  it("rebuilds the very sheet it was made from, rolled hit points included", () => {
    const sheet = landDruid(10, "polar");
    const request = buildRequestOf(sheet, library);
    expect(request?.hp.mode).toBe("entries");
    expect(buildCharacterDefinition(request!, library, policy)).toEqual(sheet);
  });

  it("reads a multiclass sheet back with its class order and the later class's subclass", () => {
    const sheet = landDruid(4, "polar", FIGHTER_DRUID);
    const request = buildRequestOf(sheet, library);
    expect(request?.classLevels).toEqual(["fighter", "druid", "druid", "druid"]);
    expect(buildCharacterDefinition(request!, library, policy)).toEqual(sheet);
  });

  it("marks the land as a pick the build reads, and a damage type as one it doesn't", () => {
    const offers = replaceableOffers(landDruid(10, "polar"), library);
    expect(offers.find((offer) => offer.offer === LAND)).toMatchObject({
      per: "long-rest",
      rebuilds: true,
      optionNames: { arid: "Arid Land", polar: "Polar Land" }
    });
  });
});

describe("choosing a land on a Long Rest", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("swaps the land's prepared spells and Nature's Ward, keeping what was spent", async () => {
    const sheet = landDruid(10, "polar");
    expect(alwaysPrepared(sheet)).toEqual(expect.arrayContaining(["hold-person", "sleet-storm", "cone-of-cold"]));
    expect(sheet.damageResistances).toContain("cold");
    const { base, server, gmToken, post, close } = await bootServer(table(sheet));
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: DRUID })).status).toBe(200);
    const druid = () => server.store.snapshot.actors.find((actor) => actor.id === DRUID)!;
    const stored = () =>
      server.store.snapshot.definitions.find((entry) => entry.id === druid().definitionId)?.definition;
    const rechoose = (token: string, id: string) =>
      post(GAME_PATHS.actorRechoose.replace("{actorId}", DRUID), token, { commandId: randomUUID(), offer: LAND, id });
    const longRest = () =>
      post(GAME_PATHS.actorRest.replace("{actorId}", DRUID), gmToken, { commandId: randomUUID(), kind: "long" });

    // Before a Long Rest the player has nothing to choose.
    const early = await rechoose(player, "arid");
    expect(early.status).toBe(409);
    expect((await early.json()).error.message).toMatch(/after finishing a Long Rest/);

    // The rest opens the prepare step; a Wild Shape use spent after it stays spent through the change.
    expect((await longRest()).status).toBe(200);
    expect(druid().preparation).not.toBeNull();
    const spend = await post(GAME_PATHS.actorSpendUses.replace("{actorId}", DRUID), player, {
      commandId: randomUUID(),
      poolId: "wild-shape",
      amount: 1
    });
    expect(spend.status).toBe(200);

    expect((await rechoose(player, "arid")).status).toBe(200);
    // The sheet is the one the builder makes for an Arid Druid: its spells, and Nature's Ward's Fire Resistance.
    expect(stored()).toEqual(landDruid(10, "arid"));
    expect(alwaysPrepared(stored())).toEqual(expect.arrayContaining(["blur", "fireball", "blight", "wall-of-stone"]));
    expect(alwaysPrepared(stored())).not.toContain("cone-of-cold");
    expect(druid().preparedSpellIds).toEqual(expect.arrayContaining(["blur", "fireball", "wall-of-stone"]));
    expect(stored()?.damageResistances).toEqual(expect.arrayContaining(["fire"]));
    expect(stored()?.damageResistances).not.toContain("cold");
    expect(druid().actionUses).toEqual({ "wild-shape": 1 });
    const log = await (await fetch(base + GAME_PATHS.log, { headers: { authorization: `Bearer ${gmToken}` } })).json();
    expect((log.data.entries as ReadonlyArray<{ text: string }>).map((entry) => entry.text)).toContain(
      `${sheet.name} chose Arid Land for Circle of the Land Spells.`
    );
    // The player's sheet reads the pick, its options and the land in force.
    const sheetRead = await fetch(base + GAME_PATHS.actorAvailableActions.replace("{actorId}", DRUID), {
      headers: { authorization: `Bearer ${player}` }
    });
    expect((await sheetRead.json()).data.rechoices).toEqual([
      {
        offer: LAND,
        label: "Circle of the Land Spells",
        per: "long-rest",
        options: [
          { id: "arid", name: "Arid Land" },
          { id: "polar", name: "Polar Land" },
          { id: "temperate", name: "Temperate Land" },
          { id: "tropical", name: "Tropical Land" }
        ],
        chosen: "arid"
      }
    ]);

    // The land stands until it is chosen again: the next Long Rest keeps it.
    expect((await post(GAME_PATHS.timePass, gmToken, { commandId: randomUUID(), hours: 16 })).status).toBe(200);
    expect((await longRest()).status).toBe(200);
    expect(alwaysPrepared(stored())).toContain("wall-of-stone");
  });

  it("lets the GM choose any time, but not in an encounter", async () => {
    const { server, gmToken, post, close } = await bootServer(table(landDruid(5, "polar")));
    cleanups.push(close);
    const stored = () => server.store.snapshot.definitions[0]?.definition;
    const rechoose = (id: string) =>
      post(GAME_PATHS.actorRechoose.replace("{actorId}", DRUID), gmToken, { commandId: randomUUID(), offer: LAND, id });
    expect((await rechoose("arid")).status).toBe(200);
    expect(alwaysPrepared(stored())).toEqual(
      expect.arrayContaining(["blur", "burning-hands", "fire-bolt", "fireball"])
    );
    expect(alwaysPrepared(stored())).not.toContain("blight");

    const arena = await server.mapAssets.import(png(900, 600), "arena.png");
    server.mapCatalog.register(arena.metadata.id, "Arena", "battlemap");
    expect(
      (
        await post(GAME_PATHS.encounterStart, gmToken, {
          commandId: randomUUID(),
          mapAssetId: arena.metadata.id,
          entries: [{ actorId: DRUID, score: 12 }]
        })
      ).status
    ).toBe(200);
    const inFight = await rechoose("polar");
    expect(inFight.status).toBe(409);
    expect((await inFight.json()).error.message).toMatch(/end the encounter first/i);
  });

  it("swaps the land of a Druid who multiclassed into the circle", async () => {
    const { server, gmToken, post, close } = await bootServer(table(landDruid(4, "polar", FIGHTER_DRUID)));
    cleanups.push(close);
    const reply = await post(GAME_PATHS.actorRechoose.replace("{actorId}", DRUID), gmToken, {
      commandId: randomUUID(),
      offer: LAND,
      id: "arid"
    });
    expect(reply.status).toBe(200);
    const stored = server.store.snapshot.definitions[0]?.definition;
    expect(stored).toEqual(landDruid(4, "arid", FIGHTER_DRUID));
    expect(stored?.character?.classes.map((entry) => [entry.id, entry.level])).toEqual([
      ["fighter", 1],
      ["druid", 3]
    ]);
    expect(alwaysPrepared(stored)).toEqual(expect.arrayContaining(["blur", "burning-hands", "fire-bolt"]));
  });
});
