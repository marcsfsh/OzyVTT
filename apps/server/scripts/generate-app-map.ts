import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderActorDefinitionJsonSchema } from "@vtt/schemas/json-schema";
import { renderAppMap } from "../src/app-map.js";

// Writes the generated references; a test fails when either is stale. Run via `npm run map`.
const targets = [
  ["../../../docs/app-map.md", renderAppMap()],
  ["../../../packages/schemas/json/actor-definition.v1.schema.json", renderActorDefinitionJsonSchema()]
] as const;
for (const [relative, text] of targets) {
  const target = fileURLToPath(new URL(relative, import.meta.url));
  writeFileSync(target, text);
  console.log(`Wrote ${target}`);
}
