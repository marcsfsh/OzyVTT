/**
 * The table-wide auto/manual roll mode is GONE (approved breaking API change, 2026-08-03).
 *
 * `combat.rollMode` and `encounter.set-roll-mode` were retired from the UI in 2026-07-24 and left
 * inert for API stability; the per-browser dice-input preference replaced them everywhere. Inert
 * surface is worse than no surface - it is a command an integration can still call and a field a
 * projection still ships - so both were deleted outright. These assertions keep them deleted.
 *
 * Two things this file is deliberately careful about:
 *
 * 1. **`rollMode` survives** as the advantage/disadvantage choice on `initiative:roll-self`,
 *    `action:resolve`, `save:answer`, `death-save:roll` and `reaction:answer`. A bare `rollMode`
 *    grep would "prove" the removal by deleting a live feature, so every assertion here targets the
 *    setting - the `auto`/`manual` enum, the `encounter.set-roll-mode` type, `RollModeRequest` - and
 *    the last test asserts the surviving fields are still present.
 * 2. **Old saves must still load.** The blob on a GM's disk carries `rollMode`; nothing migrates it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_COMMAND_SCOPES, openApiDocument } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";

const HERO = "40000000-0000-4000-8000-000000000001";
const MAP = "50000000-0000-5000-8000-000000000001";
const SCENE = "60000000-0000-4000-8000-000000000001";

const source = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the retired table-wide roll mode", () => {
  it("lets a save written before the removal load, dropping the stored field", () => {
    // Exactly the shape a pre-removal server persisted: the setting on the live combat AND on a
    // parked scene's frozen copy (both came from the same `sceneCombatShape`). Neither object is
    // strict, so Zod strips the unknown key rather than rejecting the whole campaign.
    const stored = {
      schemaVersion: 1,
      revision: 12,
      actors: [{ id: HERO, name: "Old Save Hero", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 } }],
      combat: {
        active: true, round: 3, turnActorId: HERO, mapAssetId: MAP, rollMode: "manual", rulesMode: "assisted",
        initiative: [{ actorId: HERO, score: 18 }],
        tokens: [{ actorId: HERO, position: { x: 50, y: 50 }, sizePx: 40, gridSizePx: 50 }],
        scenes: [{ id: SCENE, name: "Parked Ambush", mapAssetId: MAP, combat: { rollMode: "auto", rulesMode: "freeform" } }]
      }
    };

    const parsed = GameStateSchema.parse(stored);

    expect(parsed).not.toHaveProperty("combat.rollMode");
    expect(parsed.combat.scenes[0]?.combat).not.toHaveProperty("rollMode");
    // The removal strips one key and touches nothing else - the neighbouring policy survives intact.
    expect(parsed.combat.rulesMode).toBe("assisted");
    expect(parsed.combat.scenes[0]?.combat.rulesMode).toBe("freeform");
    expect(parsed.revision).toBe(12);
  });

  it("is gone from the command catalog, the handler, and the registry", () => {
    expect(Object.keys(GAME_COMMAND_SCOPES)).not.toContain("encounter.set-roll-mode");
    // The registry row and its handler live in one file; the catalog above cannot see a leftover
    // that never re-entered `GAME_COMMAND_SCOPES`, which is the shape socket-only debt takes here.
    const operations = source("../src/game-operations.ts");
    expect(operations).not.toContain("encounterSetRollMode");
    expect(operations).not.toContain("SetRollModeSchema");
    expect(source("../src/game-commands.ts")).not.toContain("SetRollModeSchema");
    expect(source("../src/server.ts")).not.toContain("encounter:set-roll-mode");
  });

  it("is gone from the OpenAPI document", () => {
    const document = JSON.stringify(openApiDocument);
    expect(Object.keys(openApiDocument.paths)).not.toContain("/api/v1/game/encounter/roll-mode");
    expect(openApiDocument.components?.schemas ?? {}).not.toHaveProperty("RollModeRequest");
    expect(document).not.toContain("setRollMode");
    // The setting's own vocabulary: nothing in the published contract offers auto-or-manual any more.
    expect(document).not.toContain('["auto","manual"]');
  });

  it("keeps the advantage/disadvantage `rollMode` request fields it is not about", () => {
    // The removal targets a table-wide SETTING. The identically named per-roll field is a live
    // feature on five commands; a purge that took it too would pass every assertion above.
    const schemas = (openApiDocument.components?.schemas ?? {}) as Record<string, { properties?: Record<string, { enum?: readonly string[] }> }>;
    for (const request of ["InitiativeRollSelfRequest", "ActionResolveRequest", "SaveAnswerRequest", "DeathSaveRollRequest", "ReactionAnswerRequest"]) {
      expect(schemas[request]?.properties?.rollMode?.enum, `${request} lost its advantage/disadvantage choice`).toEqual(["advantage", "disadvantage", "normal"]);
    }
  });
});
