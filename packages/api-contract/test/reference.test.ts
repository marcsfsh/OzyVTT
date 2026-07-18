import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAME_COMMAND_SCOPES, GAME_PATHS, openApiDocument } from "../src/index.js";
import { renderApiReference } from "../src/reference.js";

describe("generated API reference", () => {
  it("matches the committed docs/api-reference.md exactly (regenerate with `npm run docs:generate -w @vtt/api-contract`)", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../docs/api-reference.md", import.meta.url)), "utf8");
    expect(committed).toBe(renderApiReference());
  });

  it("covers every documented path, every command type, and every scope", () => {
    const rendered = renderApiReference();
    for (const path of Object.keys(openApiDocument.paths)) expect(rendered, `missing path ${path}`).toContain(` ${path}\``);
    for (const type of Object.keys(GAME_COMMAND_SCOPES)) expect(rendered, `missing command ${type}`).toContain(`\`${type}\``);
    expect(rendered).toContain(GAME_PATHS.commands);
    expect(rendered).toContain("archiveSchemaVersion");
  });
});
