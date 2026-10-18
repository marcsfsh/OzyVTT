import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { projectGmSession, projectPlayerSession } from "../src/codex-projections.js";
import { prepNotes } from "./codex-prep-notes.js";

// A session's `sceneIds` follow the marker pattern (JSON id array, no foreign key, dangling links
// shown as such) with one difference: they are always GM-only. Revealing a session publishes its
// recap; the staged fights stay spoilers.

const SCENE_A = "40000000-0000-4000-8000-000000000001";
const SCENE_B = "40000000-0000-4000-8000-000000000002";

let directory: string;
let store: CodexStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vtt-codex-scenes-"));
  store = new CodexStore(join(directory, "vtt.sqlite"));
  await store.initialize();
});
afterEach(async () => {
  store.close();
  await rm(directory, { recursive: true, force: true });
});

describe("session scene attachments", () => {
  it("round-trips, dedupes, and merges like every other session field", () => {
    const session = store.createSession({
      sessionNumber: 4,
      prep: prepNotes("Ambush at the bridge."),
      sceneIds: [SCENE_A, SCENE_B, SCENE_A]
    });
    expect(session.sceneIds).toEqual([SCENE_A, SCENE_B]);
    expect(store.getSession(session.id)!.sceneIds).toEqual([SCENE_A, SCENE_B]);

    // Omitted means unchanged: the console PATCHes a whole draft on every autosave.
    const edited = store.updateSession(session.id, { prep: prepNotes("Ambush at the ford.") }, session.rev);
    expect(edited.sceneIds).toEqual([SCENE_A, SCENE_B]);
    // Supplied means replaced, as with markers.
    const detached = store.updateSession(session.id, { sceneIds: [SCENE_B] }, edited.rev);
    expect(detached.sceneIds).toEqual([SCENE_B]);
    expect(store.updateSession(session.id, { sceneIds: [] }, detached.rev).sceneIds).toEqual([]);
  });

  it("caps at the table's own scene cap", () => {
    const many = Array.from(
      { length: 30 },
      (_, index) => `40000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`
    );
    expect(store.createSession({ sceneIds: many }).sceneIds).toHaveLength(20);
  });

  it("is GM-only in projections ALWAYS, even for a revealed session", () => {
    const session = store.createSession({
      sessionNumber: 5,
      recapBody: "They crossed the bridge.",
      sceneIds: [SCENE_A]
    });
    expect(projectGmSession(session).sceneIds).toEqual([SCENE_A]);

    const revealed = store.setSessionRevealed(session.id, true);
    const player = projectPlayerSession(revealed)!;
    expect(player).not.toBeNull();
    expect(player.recap).toBe("They crossed the bridge.");
    // The explicit negative: the projection is an allow-list, and this stays outside it forever.
    expect("sceneIds" in player).toBe(false);
    expect(JSON.stringify(player)).not.toContain(SCENE_A);
  });

  it("keeps scene ids out of both search indexes: they are ids, not text", () => {
    const session = store.createSession({
      sessionNumber: 6,
      prep: prepNotes("Prep"),
      recapBody: "Recap",
      sceneIds: [SCENE_A]
    });
    store.setSessionRevealed(session.id, true);
    expect(store.searchAll("gm", SCENE_A).hits).toHaveLength(0);
    expect(store.searchAll("player", SCENE_A).hits).toHaveLength(0);
  });
});
