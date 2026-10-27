// Guards the removal of the table-wide auto/manual roll-mode setting. The per-roll `rollMode` field must
// survive, and old saves carrying the setting must load.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_COMMANDS } from "@vtt/api-contract";
import { openApiDocument } from "../src/api-routes.js";
import { GameStateSchema } from "@vtt/domain";
import { gameCommands } from "../src/commands/index.js";

const HERO = "40000000-0000-4000-8000-000000000001";
const MAP = "50000000-0000-5000-8000-000000000001";
const SCENE = "60000000-0000-4000-8000-000000000001";

const source = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the retired table-wide roll mode", () => {
  it("lets a save written before the removal load, dropping the stored field", () => {
    // A save carrying the removed setting on the live combat and on a parked scene. Neither object is
    // strict, so Zod strips the unknown key and the campaign loads.
    const stored = {
      schemaVersion: 1,
      revision: 12,
      actors: [
        {
          id: HERO,
          name: "Old Save Hero",
          kind: "player-character",
          visibility: "public",
          hp: { current: 10, maximum: 10 }
        }
      ],
      combat: {
        active: true,
        round: 3,
        turnActorId: HERO,
        mapAssetId: MAP,
        rollMode: "manual",
        rulesMode: "assisted",
        initiative: [{ actorId: HERO, score: 18 }],
        tokens: [{ actorId: HERO, position: { x: 50, y: 50 }, sizePx: 40, gridSizePx: 50 }],
        encounters: [
          { id: SCENE, name: "Parked Ambush", mapAssetId: MAP, combat: { rollMode: "auto", rulesMode: "freeform" } }
        ]
      }
    };

    const parsed = GameStateSchema.parse(stored);

    expect(parsed).not.toHaveProperty("combat.rollMode");
    expect(parsed.combat.encounters[0]?.combat).not.toHaveProperty("rollMode");
    // Only that key is stripped; the neighbouring policy survives.
    expect(parsed.combat.rulesMode).toBe("assisted");
    expect(parsed.combat.encounters[0]?.combat.rulesMode).toBe("freeform");
    expect(parsed.revision).toBe(12);
  });

  it("is gone from the command catalog, the command table, and the schemas", () => {
    expect(Object.keys(GAME_COMMANDS)).not.toContain("encounter.set-roll-mode");
    // The socket handlers and typed routes are registered from the table, so it is the one place left.
    expect(gameCommands.map((command) => command.type)).not.toContain("encounter.set-roll-mode");
    expect(source("../../../packages/domain/src/commands.ts")).not.toContain("SetRollModeSchema");
  });

  it("is gone from the OpenAPI document", () => {
    const document = JSON.stringify(openApiDocument);
    expect(Object.keys(openApiDocument.paths)).not.toContain("/api/v1/game/encounter/roll-mode");
    expect(openApiDocument.components?.schemas ?? {}).not.toHaveProperty("RollModeRequest");
    expect(document).not.toContain("setRollMode");
    expect(document).not.toContain('["auto","manual"]');
  });

  it("keeps the advantage/disadvantage `rollMode` request fields it is not about", () => {
    // The identically named per-roll field must survive; a purge that removed it too would pass
    // every assertion above.
    const schemas = (openApiDocument.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, { enum?: readonly string[] }> }
    >;
    for (const request of [
      "RollOwnInitiativeRequest",
      "ResolveActionRequest",
      "AnswerSaveRequest",
      "RollDeathSaveRequest",
      "AnswerReactionRequest"
    ]) {
      expect(schemas[request]?.properties?.rollMode?.enum, `${request} lost its advantage/disadvantage choice`).toEqual(
        ["advantage", "disadvantage", "normal"]
      );
    }
  });
});
