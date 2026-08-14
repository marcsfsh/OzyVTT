/**
 * Regenerates `docs/product/vocabulary-parity-audit.md` from the parity guard's own census
 * (ruling 19: that document is generated, never hand-edited). Run via `npm run docs` at the root,
 * or `npm run docs:parity --workspace=@vtt/web`; `api-parity.mirror.test.ts` fails whenever the
 * committed file and this output disagree.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertCanonicaliserSound, EXEMPTIONS, probeAddress, renderParityAudit, walkBodySchemas
} from "../src/homebrew/api-parity-harness";

assertCanonicaliserSound();
const { addresses, stats } = walkBodySchemas();
const results = addresses.map(probeAddress);
const target = fileURLToPath(new URL("../../../docs/product/vocabulary-parity-audit.md", import.meta.url));
writeFileSync(target, renderParityAudit({ stats, results, exemptions: EXEMPTIONS }));
console.log(`wrote ${target}`);
