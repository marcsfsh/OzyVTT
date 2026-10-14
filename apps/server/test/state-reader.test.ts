import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema } from "@vtt/domain";
import { describe, expect, it } from "vitest";
import { GameStore } from "../src/game-store.js";
import { createStateReader } from "../src/state-reader.js";

describe("createStateReader", () => {
  it("serves one frozen copy per revision and a fresh one after each commit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-state-reader-"));
    const store = new GameStore(join(directory, "vtt.sqlite"), GameStateSchema.parse({ schemaVersion: 1 }));
    try {
      await store.initialize();
      const reader = createStateReader(store);
      const first = reader.read();
      expect(reader.read()).toBe(first);
      expect(Object.isFrozen(first.combat)).toBe(true);
      expect(() => {
        (first.combat as { round: number }).round = 9;
      }).toThrow(TypeError);

      await store.execute({ id: "rename", type: "test.rename" }, (state) => {
        state.combat = { ...state.combat, round: 3 };
      });
      const next = reader.read();
      expect(next).not.toBe(first);
      expect(next.combat.round).toBe(3);
      reader.reset();
      expect(reader.read()).not.toBe(next);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
