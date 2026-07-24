import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderAppMap } from "../src/app-map.js";

// Writes the generated app map next to the repo's other top-level docs. The freshness test
// (test/app-map.test.ts) fails whenever the state/command/HTTP surface changes without re-running
// this. Invoke via `npm run map` from the repo root.
const target = fileURLToPath(new URL("../../../docs/app-map.md", import.meta.url));
writeFileSync(target, renderAppMap());
console.log(`Wrote ${target}`);
