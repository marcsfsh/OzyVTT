import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const fixtureMetadata = { purpose: "Representative actors, encounters, import files, and golden outcomes for cross-workspace tests." } as const;

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The replay-encounter party (Torva, Pip, Sable — level-7 SRD-derived example imports), enriched
 * with the ADR-0020 structured mechanics their prose promises: Extra Attack counts, Rage/Frenzy/
 * Reckless grants, Savage Attacks critical dice, and the once-per-turn Sneak Attack pool. These are
 * the golden inputs for the combat-rules regression suite derived from the two encounter archives.
 */
export type ActorFixtureName = "monster" | "player-character" | "torva-grimtusk" | "pip-underbough" | "sable-vex";

/** Raw parsed JSON — callers validate with ActorDefinitionSchema so fixture drift fails loudly in tests. */
export function loadActorFixture(name: ActorFixtureName): unknown {
  return JSON.parse(readFileSync(join(packageRoot, "actors", `${name}.v1.json`), "utf8"));
}
