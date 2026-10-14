import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAppMap } from "../src/app-map.js";

// Writes docs/app-map.md; test/app-map.test.ts fails when it is stale. Run via `npm run map`.
const target = fileURLToPath(new URL("../../../docs/app-map.md", import.meta.url));
writeFileSync(target, renderAppMap());
console.log(`Wrote ${target}`);
