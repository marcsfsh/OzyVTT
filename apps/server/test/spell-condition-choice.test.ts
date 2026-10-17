import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { actionAvailability } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { effectiveActions } from "../src/effective-actions.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";
import { build, catalog, fight, FOE, HERO, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 Blindness/Deafness: "One creature that you can see within range must succeed on a Constitution saving
// throw, or it has the Blinded or Deafened condition (your choice) for the duration."

const wizard = build(wizardInput(["blindnessdeafness"]));

describe("a failed save's condition the caster picks", () => {
  it("imposes Blinded unless the caster picks Deafened", () => {
    const blinded = fight(wizard);
    blinded.resolve("spell-blindnessdeafness", {});
    expect(blinded.state.combat.pendingSaves[0]!.conditionIds).toEqual(["blinded"]);
    const deafened = fight(wizard);
    deafened.resolve("spell-blindnessdeafness", { conditionId: "deafened" });
    expect(deafened.state.combat.pendingSaves[0]!.conditionIds).toEqual(["deafened"]);
  });

  it("offers the two conditions on the action's availability row", () => {
    const { state, hero } = fight(wizard);
    const actions = effectiveActions(wizard, hero, catalog);
    const row = actionAvailability(
      state,
      hero,
      actions.filter((action) => action.id === "spell-blindnessdeafness"),
      wizard,
      false,
      actions,
      catalog
    )[0];
    expect(row?.conditionChoices).toEqual(["blinded", "deafened"]);
  });
});

describe("a player's pick", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("reaches the save when the spell offers it, and the GM may impose any", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: FOE,
          name: "Goblin",
          kind: "monster",
          visibility: "public",
          hp: { current: 30, maximum: 30 },
          armorClass: 12
        }
      ]
    });
    importActorDefinition(state, wizard, HERO, "public", catalog);
    const booted = await bootServer(state);
    cleanups.push(booted.close);
    const { server, gmToken, post } = booted;
    const arena = await server.mapAssets.import(png(900, 600), "arena.png");
    server.mapCatalog.register(arena.metadata.id, "Arena", "battlemap");
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: HERO })).status).toBe(200);
    const start = await post(GAME_PATHS.encounterStart, gmToken, {
      commandId: randomUUID(),
      mapAssetId: arena.metadata.id,
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 }
      ]
    });
    expect(start.status).toBe(200);
    const cast = (conditionId: string) =>
      post(GAME_PATHS.actionResolve, player, {
        commandId: randomUUID(),
        actorId: HERO,
        actionId: "spell-blindnessdeafness",
        targetIds: [FOE],
        conditionId
      });
    expect((await cast("deafened")).status).toBe(200);
    expect(server.store.snapshot.combat.pendingSaves.map((save) => save.conditionIds)).toEqual([["deafened"]]);

    // A second slot this turn needs the GM's ruling, and the GM may impose any condition.
    const pickedOther = await post(GAME_PATHS.actionResolve, gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "spell-blindnessdeafness",
      targetIds: [FOE],
      conditionId: "paralyzed",
      override: { reason: "test" }
    });
    expect(pickedOther.status).toBe(200);
    expect(server.store.snapshot.combat.pendingSaves.map((save) => save.conditionIds).at(-1)).toEqual(["paralyzed"]);
  });

  it("drops a condition the spell doesn't offer from a player's cast", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: FOE,
          name: "Goblin",
          kind: "monster",
          visibility: "public",
          hp: { current: 30, maximum: 30 },
          armorClass: 12
        }
      ]
    });
    importActorDefinition(state, wizard, HERO, "public", catalog);
    const booted = await bootServer(state);
    cleanups.push(booted.close);
    const { server, gmToken, post } = booted;
    const arena = await server.mapAssets.import(png(900, 600), "arena.png");
    server.mapCatalog.register(arena.metadata.id, "Arena", "battlemap");
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: HERO })).status).toBe(200);
    await post(GAME_PATHS.encounterStart, gmToken, {
      commandId: randomUUID(),
      mapAssetId: arena.metadata.id,
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 }
      ]
    });
    const response = await post(GAME_PATHS.actionResolve, player, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "spell-blindnessdeafness",
      targetIds: [FOE],
      conditionId: "paralyzed"
    });
    expect(response.status).toBe(200);
    expect(server.store.snapshot.combat.pendingSaves.map((save) => save.conditionIds)).toEqual([["blinded"]]);
  });
});
