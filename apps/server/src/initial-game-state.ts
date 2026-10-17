import { GameStateSchema, type GameState } from "@vtt/domain";
import { ContentLibrary } from "./content-library.js";
import { addSampleParty, SAMPLE_ACTOR_IDS } from "./sample-party.js";

/** The sample party's actor ids, kept under the name the tests and older tables know them by. */
export const PLACEHOLDER_ACTOR_IDS = SAMPLE_ACTOR_IDS;

/**
 * A fresh table: the default settings and the sample party (`sample-party.ts`), built from the bundled SRD content
 * alone. Each sample's sheet is keyed `import-<actorId>` like any character built here, since editing and removal
 * gate on that prefix.
 */
export function createInitialGameState(): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  addSampleParty(state, new ContentLibrary().forAudience("gm"));
  return GameStateSchema.parse(state);
}
