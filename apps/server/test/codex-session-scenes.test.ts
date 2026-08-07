import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexStore } from "../src/codex-store.js";
import { projectGmSession, projectPlayerSession } from "../src/codex-projections.js";

/**
 * D31 + director ruling R2 - SESSION PREP LISTS TONIGHT'S SCENES.
 *
 * The scene attachment is the marker precedent verbatim (a JSON id array, no foreign key, dangling
 * links rendered honestly), with ONE difference that is the whole ruling: `sceneIds` is GM-only
 * ALWAYS, not "GM-only until the session is revealed". Revealing a session publishes its RECAP; the
 * fights the GM has staged for the evening are spoilers even then.
 */

const SCENE_A = "40000000-0000-4000-8000-000000000001";
const SCENE_B = "40000000-0000-4000-8000-000000000002";

let directory: string;
let store: CodexStore;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vtt-codex-scenes-"));
  store = new CodexStore(join(directory, "vtt.sqlite"));
  await store.initialize();
});
afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

describe("session scene attachments", () => {
  it("round-trips, dedupes, and merges like every other session field", () => {
    const session = store.createSession({ sessionNumber: 4, prepBody: "Ambush at the bridge.", sceneIds: [SCENE_A, SCENE_B, SCENE_A] });
    expect(session.sceneIds).toEqual([SCENE_A, SCENE_B]);
    expect(store.getSession(session.id)!.sceneIds).toEqual([SCENE_A, SCENE_B]);

    // Omitted means UNCHANGED - the console PATCHes a whole draft on every autosave.
    const edited = store.updateSession(session.id, { prepBody: "Ambush at the ford." }, session.rev, "gm");
    expect(edited.sceneIds).toEqual([SCENE_A, SCENE_B]);
    // Supplied means REPLACED, the marker contract verbatim.
    const detached = store.updateSession(session.id, { sceneIds: [SCENE_B] }, edited.rev, "gm");
    expect(detached.sceneIds).toEqual([SCENE_B]);
    expect(store.updateSession(session.id, { sceneIds: [] }, detached.rev, "gm").sceneIds).toEqual([]);
  });

  it("caps at the table's own scene cap", () => {
    const many = Array.from({ length: 30 }, (_, index) => `40000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`);
    expect(store.createSession({ sceneIds: many }).sceneIds).toHaveLength(20);
  });

  it("is GM-only in projections ALWAYS - even for a revealed session (R2)", () => {
    const session = store.createSession({ sessionNumber: 5, recapBody: "They crossed the bridge.", sceneIds: [SCENE_A] });
    expect(projectGmSession(session).sceneIds).toEqual([SCENE_A]);

    const revealed = store.setSessionRevealed(session.id, true);
    const player = projectPlayerSession(revealed)!;
    expect(player).not.toBeNull();
    expect(player.recap).toBe("They crossed the bridge.");
    // The explicit negative: the projection is an allow-list, and this stays outside it forever.
    expect("sceneIds" in player).toBe(false);
    expect(JSON.stringify(player)).not.toContain(SCENE_A);
  });

  it("keeps scene ids out of both search indexes - they are ids, not text", () => {
    const session = store.createSession({ sessionNumber: 6, prepBody: "Prep", recapBody: "Recap", sceneIds: [SCENE_A] });
    store.setSessionRevealed(session.id, true);
    expect(store.searchAll("gm", SCENE_A).hits).toHaveLength(0);
    expect(store.searchAll("player", SCENE_A).hits).toHaveLength(0);
  });

  it("adds the column to a codex created before it existed, with no scenes attached", async () => {
    const older = await mkdtemp(join(tmpdir(), "vtt-codex-scenes-old-"));
    const path = join(older, "vtt.sqlite");
    const first = new CodexStore(path);
    await first.initialize();
    const before = first.createSession({ sessionNumber: 1, prepBody: "Written before scenes existed." });
    first.close();

    // Simulate the pre-migration database: drop the column AND forget the migration ran, which is
    // exactly the state an older campaign's codex is in when this build first opens it.
    const raw = new DatabaseSync(path);
    raw.exec("ALTER TABLE codex_sessions DROP COLUMN scene_ids_json;");
    raw.prepare("DELETE FROM codex_schema_migrations WHERE version = ?").run(25);
    raw.close();

    const reopened = new CodexStore(path);
    await reopened.initialize();
    expect(reopened.getSession(before.id)!.sceneIds).toEqual([]);
    // And the column is usable immediately afterwards.
    expect(reopened.updateSession(before.id, { sceneIds: [SCENE_A] }, undefined, "gm").sceneIds).toEqual([SCENE_A]);
    reopened.close();
    await rm(older, { recursive: true, force: true });
  });
});
