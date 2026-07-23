import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_COMMAND_SCOPES, openApiDocument } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { renderAppMap } from "../src/app-map.js";

describe("generated app map", () => {
  it("matches the committed docs/app-map.md exactly (regenerate with `npm run map`)", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../docs/app-map.md", import.meta.url)), "utf8");
    expect(committed).toBe(renderAppMap());
  });

  it("covers every GameState field, command type, and HTTP path", () => {
    const rendered = renderAppMap();
    for (const field of Object.keys(GameStateSchema.shape)) expect(rendered, `missing state field ${field}`).toContain(`\`${field}\``);
    for (const type of Object.keys(GAME_COMMAND_SCOPES)) expect(rendered, `missing command ${type}`).toContain(`\`${type}\``);
    for (const path of Object.keys(openApiDocument.paths)) expect(rendered, `missing path ${path}`).toContain(` ${path}\``);
  });
});
