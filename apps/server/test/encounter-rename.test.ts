import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { renameEncounterCommand, renameEncounterKeys, renameEncounterScope } from "../src/encounter-rename.js";
import { SoundStore } from "../src/sound-store.js";

// The saved-data half of ADR-0041, which the game, sound board, Codex and credential migrations share.
describe("renaming saved scene names for the encounter", () => {
  it("renames every scene-named key at any depth, and `scenes` only as the combat's list", () => {
    expect(
      renameEncounterKeys({
        combat: { scenes: [{ id: "a", fightEndedAt: 3, combat: { round: 1 } }], activeSceneId: "a" },
        actors: [{ replaySceneId: "a" }],
        presets: [{ sceneId: "a" }],
        sections: [
          { type: "encounters", sceneIds: ["a"] },
          { type: "scenes", scenes: [{ id: "s" }] }
        ],
        archive: { sceneName: "Warren" }
      })
    ).toEqual({
      combat: { encounters: [{ id: "a", endedAt: 3, combat: { round: 1 } }], activeEncounterId: "a" },
      actors: [{ replayEncounterId: "a" }],
      presets: [{ encounterId: "a" }],
      sections: [
        { type: "encounters", encounterIds: ["a"] },
        { type: "scenes", scenes: [{ id: "s" }] }
      ],
      archive: { encounterName: "Warren" }
    });
  });

  it("renames the scene commands and scopes, and nothing else", () => {
    expect(renameEncounterCommand("scene.activate")).toBe("encounter.activate");
    expect(renameEncounterCommand("scene:set-combatants")).toBe("encounter:set-combatants");
    expect(renameEncounterCommand("encounter.start")).toBe("encounter.start");
    expect(renameEncounterCommand("scene.unknown")).toBe("scene.unknown");
    expect(renameEncounterCommand("sound.set-scene-preset")).toBe("sound.set-encounter-preset");
    expect(renameEncounterScope("scene:write")).toBe("encounter:write");
    expect(renameEncounterScope("scene:read")).toBe("encounter:read");
    expect(renameEncounterScope("game:read")).toBe("game:read");
  });
});

describe("the sound board saved before scenes became encounters", () => {
  it("keys each encounter's sound by `encounterId`", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-sound-rename-"));
    const path = join(directory, "vtt.sqlite");
    try {
      const store = new SoundStore(path);
      await store.initialize();
      store.close();
      const encounterId = "30000000-0000-4000-8000-000000000001";
      // Back to how an older build left it: migration 2 not applied, and the preset under its scene name.
      const raw = new DatabaseSync(path);
      raw.prepare("UPDATE sound_board_state SET state_json = ? WHERE id = 1").run(
        JSON.stringify({
          board: { presets: [{ sceneId: encounterId, autoplay: false, music: null, ambient: [] }] },
          acceptedCommandIds: []
        })
      );
      raw.prepare("DELETE FROM migrations WHERE store = 'sound-board' AND version = 2").run();
      raw.close();
      const reopened = new SoundStore(path);
      await reopened.initialize();
      expect(reopened.board.presets).toEqual([{ encounterId, autoplay: false, music: null, ambient: [] }]);
      reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
