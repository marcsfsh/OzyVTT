import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { activateNewScene, HISTORY_REVIEW_REFUSAL, SCENE_ROOM_REFUSAL } from "../../../server/src/scenes.js";
import { launchRefusalOf } from "./launch-refusal";

/**
 * A MIRROR TEST (the `node` project): the Replays tab decides which way out to offer a GM whose
 * launch was refused by reading the SERVER'S OWN sentence, so this drives the server's real
 * `activateNewScene` into both refusals and asserts the classifier still recognises them.
 *
 * Why this exists rather than "just trust the regex". `4i`'s reported symptom was a dead end: the
 * launch refused with "Remove a prepared scene first" on a screen with no scene list. The fix is a
 * routed Alert, and that route is only correct while the classifier matches - a reword on the server
 * would silently turn the door back into a toast, i.e. reintroduce exactly the reported bug with no
 * test failing. Matching the CONSTANTS alone would not catch it either: the constant could be
 * reworded and the regex updated while the code path throws something else entirely. So the probe
 * runs the real function, catches the real error, and classifies the real message.
 */

const SCENE = (n: number) => `40000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const MAP = "20000000-0000-5000-8000-000000000001";
const EMPTY_COMBAT = GameStateSchema.parse({ schemaVersion: 1 }).combat;

/** A go-live onto a brand-new scene, exactly as `launchReplay` performs it. */
const goLive = (state: ReturnType<typeof GameStateSchema.parse>, sceneId: string) =>
  activateNewScene(state, { sceneId, name: "Replay", mapAssetId: MAP, combat: EMPTY_COMBAT }, SCENE(99));

const refusalFrom = (run: () => unknown): string => {
  try { run(); } catch (cause) { return (cause as Error).message; }
  throw new Error("Expected the go-live to be refused, and it was not.");
};

describe("launch refusal - the client's routes match the server's refusals", () => {
  it("routes a full scene list to the scene gallery", () => {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    state.combat = { ...state.combat, scenes: Array.from({ length: 20 }, (_, index) => ({ id: SCENE(index), name: `Scene ${index}`, mapAssetId: MAP, combat: EMPTY_COMBAT })) };
    const message = refusalFrom(() => goLive(state, SCENE(50)));
    expect(message).toBe(SCENE_ROOM_REFUSAL);
    expect(launchRefusalOf(message)).toBe("scene-room");
  });

  it("names the rewind rather than the scene gallery when the GM is mid-review", () => {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    state.combat = { ...state.combat, historyCursor: 2 };
    const message = refusalFrom(() => goLive(state, SCENE(50)));
    expect(message).toBe(HISTORY_REVIEW_REFUSAL);
    expect(launchRefusalOf(message)).toBe("history-review");
  });

  it("leaves every other failure on the transient toast it always had", () => {
    expect(launchRefusalOf(undefined)).toBe("other");
    expect(launchRefusalOf("That recording could not be read.")).toBe("other");
    expect(launchRefusalOf("The table's sheet library is full - delete some imported stat blocks before launching a replay.")).toBe("other");
  });
});
