import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderApiReference } from "../src/reference.js";

// Writes the human-readable API reference next to the repo's other top-level docs. The freshness
// test (test/reference.test.ts) fails whenever the contract changes without re-running this.
const target = fileURLToPath(new URL("../../../docs/api-reference.md", import.meta.url));
writeFileSync(target, renderApiReference());
console.log(`Wrote ${target}`);
