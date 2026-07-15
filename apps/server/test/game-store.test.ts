import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GameStore, RevisionConflictError } from "../src/game-store.js";

const actor = { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16b", name: "Test Character", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null };

describe("GameStore", () => {
it("serializes commands, persists an event receipt, and ignores a retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtt-game-store-"));
  try {
    await writeFile(join(directory, "game-state.json"), JSON.stringify({ schemaVersion: 1, actors: [actor] }));
    const store = new GameStore(join(directory, "game-state.json")); await store.initialize();
    const first = await store.execute({ id: "claim-1", type: "character.claim", actorId: actor.id, expectedRevision: 0 }, (state) => { state.actors[0].ownerSessionId = "e0bcfbbc-0211-462a-a8f9-b570545981f4"; });
    const retry = await store.execute({ id: "claim-1", type: "character.claim", actorId: actor.id, expectedRevision: 0 }, () => { throw new Error("A duplicate must not run the mutation."); });
    expect(first.state.revision).toBe(1); expect(retry.duplicate).toBe(true); expect(retry.state.revision).toBe(1);
    const events = JSON.parse(await readFile(join(directory, "events.json"), "utf8")); expect(events.events).toHaveLength(1); expect(events.events[0].commandId).toBe("claim-1");
    await expect(store.execute({ id: "claim-2", type: "character.claim", expectedRevision: 0 }, () => {})).rejects.toBeInstanceOf(RevisionConflictError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
});
