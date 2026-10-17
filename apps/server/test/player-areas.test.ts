import { randomUUID } from "node:crypto";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { GAME_PATHS } from "@vtt/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";

// A player aims an area for their own character. The server checks the caster is theirs, decides who is under it,
// and the reply names only the creatures that player may see: a GM-only creature or one wholly under the fog is caught
// all the same, but never named to them.

const CASTER = "10000000-0000-4000-8000-0000000000b1";
const ALLY = "10000000-0000-4000-8000-0000000000b2";
const SEEN = "10000000-0000-4000-8000-0000000000b3";
const FOGGED = "10000000-0000-4000-8000-0000000000b4";
const HIDDEN = "10000000-0000-4000-8000-0000000000b5";

const BURST = {
  id: "flame-burst",
  name: "Flame Burst",
  activation: "action" as const,
  description: "Each creature in a 10-foot-radius Sphere makes a Dexterity saving throw.",
  save: { ability: "dex" as const, dc: 14, successDamage: "half" as const, failureConditions: [] },
  damage: [{ formula: "2d6", type: "fire" }],
  area: { shape: "sphere" as const, sizeFeet: 10, widthFeet: null }
};

function caster(): ActorDefinition {
  const base = loadActorFixture("player-character") as ActorDefinition;
  return { ...base, name: "Lyra", actions: [...base.actions, BURST] };
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

/** A fight on a 50px, 5-foot grid: Lyra at the left; three goblins clustered at the right, the far one under fog. */
async function fight() {
  const booted = await bootServer(
    GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: CASTER,
          name: "Lyra",
          kind: "player-character",
          hp: { current: 20, maximum: 20 },
          definitionId: "lyra-def"
        },
        { id: ALLY, name: "Borin", kind: "player-character", hp: { current: 30, maximum: 30 } },
        { id: SEEN, name: "Goblin Scout", kind: "monster", hp: { current: 7, maximum: 7 } },
        { id: FOGGED, name: "Goblin Lurker", kind: "monster", hp: { current: 7, maximum: 7 } },
        { id: HIDDEN, name: "Hidden Hag", kind: "monster", visibility: "gm-only", hp: { current: 30, maximum: 30 } }
      ],
      definitions: [{ id: "lyra-def", definition: caster() }]
    })
  );
  closers.push(booted.close);
  const { server, gmToken, post } = booted;
  const imported = await server.mapAssets.import(png(800, 400), "crypt.png");
  server.mapCatalog.register(imported.metadata.id, "Sunken crypt", "battlemap");
  server.mapCatalog.saveCalibration(imported.metadata.id, {
    calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
    verifiedAt: null,
    verificationPoint: null,
    verificationErrorPx: null
  });
  const playerToken = server.auth.issuePlayerSession();
  expect((await post(GAME_PATHS.claims, playerToken, { commandId: randomUUID(), actorId: CASTER })).status).toBe(200);
  expect(
    (
      await post(GAME_PATHS.encounterStart, gmToken, {
        commandId: randomUUID(),
        mapAssetId: imported.metadata.id,
        entries: [
          { actorId: CASTER, score: 20 },
          { actorId: ALLY, score: 15 },
          { actorId: SEEN, score: 10 },
          { actorId: FOGGED, score: 9 },
          { actorId: HIDDEN, score: 8 }
        ]
      })
    ).status
  ).toBe(200);
  const place = async (actorId: string, x: number, y: number) =>
    expect(
      (
        await post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), gmToken, {
          commandId: randomUUID(),
          position: { x, y }
        })
      ).status
    ).toBe(200);
  await place(CASTER, 75, 75);
  await place(ALLY, 75, 175);
  await place(SEEN, 525, 75);
  await place(HIDDEN, 575, 75);
  await place(FOGGED, 575, 125);
  // Fog on, with everything but the lurker's cell revealed.
  expect((await post(GAME_PATHS.fogEnabled, gmToken, { commandId: randomUUID(), enabled: true })).status).toBe(200);
  for (const rect of [
    { x: 0, y: 0, width: 800, height: 100 },
    { x: 0, y: 100, width: 550, height: 300 },
    { x: 600, y: 100, width: 200, height: 300 },
    { x: 550, y: 150, width: 50, height: 250 }
  ])
    expect((await post(GAME_PATHS.fogPaint, gmToken, { commandId: randomUUID(), op: "reveal", rect })).status).toBe(
      200
    );
  const aim = (token: string, actorId: string, origin: { x: number; y: number }, target: { x: number; y: number }) =>
    post(GAME_PATHS.actionResolve, token, {
      commandId: randomUUID(),
      actorId,
      actionId: BURST.id,
      template: { shape: "circle", origin, target }
    });
  return { ...booted, playerToken, aim };
}

describe("a player's area spell", () => {
  it("catches everyone under it but names only the creatures the player may see", async () => {
    const { server, playerToken, aim } = await fight();
    // A 10-foot sphere centred on the goblins' corner catches all three.
    const cast = await aim(playerToken, CASTER, { x: 550, y: 100 }, { x: 650, y: 100 });
    expect(cast.status).toBe(200);
    const body = await cast.json();
    const reply = JSON.stringify(body);
    expect(body.data.resolution.save.targets.map((target: { targetId: string }) => target.targetId)).toEqual([SEEN]);
    for (const hidden of [FOGGED, HIDDEN, "Goblin Lurker", "Hidden Hag"]) expect(reply).not.toContain(hidden);
    // The server caught all three: each owes a saving throw to the GM.
    expect(
      server.store.snapshot.combat.pendingSaves.map((save) => save.targetActorId).sort((a, b) => a.localeCompare(b))
    ).toEqual([SEEN, FOGGED, HIDDEN].sort((a, b) => a.localeCompare(b)));
  });

  it("refuses an area holding only creatures the player can't see the same way as an empty one", async () => {
    const { playerToken, aim } = await fight();
    // A 5-foot sphere at the lurker and the hag catches only hidden creatures.
    const hiddenOnly = await aim(playerToken, CASTER, { x: 575, y: 100 }, { x: 600, y: 100 });
    const empty = await aim(playerToken, CASTER, { x: 375, y: 325 }, { x: 400, y: 325 });
    expect(hiddenOnly.status).toBe(409);
    expect(empty.status).toBe(409);
    const [hiddenBody, emptyBody] = [await hiddenOnly.json(), await empty.json()];
    expect(hiddenBody.error.message).toBe("No creatures you can see are inside that area.");
    expect(hiddenBody.error.message).toBe(emptyBody.error.message);
    expect(JSON.stringify(hiddenBody)).not.toContain("Goblin Lurker");
  });

  it("leaves out a creature the walls hide from the caster as it does one under the fog", async () => {
    const { server, gmToken, playerToken, post, aim } = await fight();
    // Fog off and vision on: a wall down x = 550 below the first row hides the lurker from Lyra.
    expect((await post(GAME_PATHS.fogEnabled, gmToken, { commandId: randomUUID(), enabled: false })).status).toBe(200);
    expect((await post(GAME_PATHS.visionEnabled, gmToken, { commandId: randomUUID(), enabled: true })).status).toBe(
      200
    );
    const walled = await post(GAME_PATHS.walls, gmToken, {
      commandId: randomUUID(),
      kind: "wall",
      points: [
        { x: 550, y: 100 },
        { x: 550, y: 400 }
      ]
    });
    expect(walled.status).toBe(200);
    const cast = await aim(playerToken, CASTER, { x: 550, y: 100 }, { x: 650, y: 100 });
    expect(cast.status).toBe(200);
    const body = await cast.json();
    expect(body.data.resolution.save.targets.map((target: { targetId: string }) => target.targetId)).toEqual([SEEN]);
    for (const hidden of [FOGGED, "Goblin Lurker"]) expect(JSON.stringify(body)).not.toContain(hidden);
    expect(server.store.snapshot.combat.pendingSaves.map((save) => save.targetActorId)).toContain(FOGGED);
  });

  it("is refused for a character the player doesn't own", async () => {
    const { playerToken, aim } = await fight();
    const foreign = await aim(playerToken, ALLY, { x: 550, y: 100 }, { x: 650, y: 100 });
    expect(foreign.status).toBe(403);
  });

  it("gives the GM the whole catch", async () => {
    const { gmToken, aim } = await fight();
    const cast = await aim(gmToken, CASTER, { x: 550, y: 100 }, { x: 650, y: 100 });
    expect(cast.status).toBe(200);
    const targets = (await cast.json()).data.resolution.save.targets.map(
      (target: { targetId: string }) => target.targetId
    );
    expect(new Set(targets)).toEqual(new Set([SEEN, FOGGED, HIDDEN]));
  });
});
