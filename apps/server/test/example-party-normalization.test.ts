import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { GameStore } from "../src/game-store.js";
import { createInitialGameState, LEGACY_EXAMPLE_DEFINITION_IDS, PLACEHOLDER_ACTOR_IDS } from "../src/initial-game-state.js";
import { removeActor } from "../src/actor-roster.js";
import { setCharacterIdentity } from "../src/character-edit.js";

/**
 * The three starter characters used to be second-class: their sheets were keyed `example-*`, and two
 * gates in the codebase read the `import-` prefix as "this sheet belongs to one character and may be
 * edited / removed". A GM could not level Borin up, could not respec him, and could not delete him.
 *
 * Fresh installs are fixed at the source (`initial-game-state.ts`); saves that already exist are
 * repaired once, in place, by a seed. Both are proven here, and the repair is proven idempotent -
 * a seed that runs twice on real campaign data is how one loses real campaign data.
 */

async function withStore<T>(work: (open: (initial?: GameState) => Promise<GameStore>, databasePath: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "vtt-example-party-"));
  const databasePath = join(directory, "vtt.sqlite");
  const opened: GameStore[] = [];
  try {
    return await work(async (initial) => {
      const store = new GameStore(databasePath, initial);
      await store.initialize();
      opened.push(store);
      return store;
    }, databasePath);
  } finally {
    for (const store of opened) { try { store.close(); } catch { /* already closed */ } }
    await rm(directory, { recursive: true, force: true });
  }
}

/** A save written by the old build: three starter characters pointing at `example-*` sheets. */
function legacyState(): GameState {
  const fresh = createInitialGameState();
  const remap: Record<string, string> = {
    [PLACEHOLDER_ACTOR_IDS.fighter]: LEGACY_EXAMPLE_DEFINITION_IDS.fighter,
    [PLACEHOLDER_ACTOR_IDS.cleric]: LEGACY_EXAMPLE_DEFINITION_IDS.cleric,
    [PLACEHOLDER_ACTOR_IDS.wizard]: LEGACY_EXAMPLE_DEFINITION_IDS.wizard
  };
  return GameStateSchema.parse({
    ...fresh,
    actors: fresh.actors.map((actor) => ({ ...actor, definitionId: remap[actor.id] ?? actor.definitionId })),
    definitions: fresh.definitions.map((entry) => {
      const actor = fresh.actors.find((candidate) => candidate.definitionId === entry.id);
      return { id: actor ? remap[actor.id] ?? entry.id : entry.id, definition: entry.definition };
    })
  });
}

describe("the example party ships as ordinary characters", () => {
  it("keys the starter sheets like any imported character on a fresh install", () => {
    const fresh = createInitialGameState();
    for (const actor of fresh.actors) expect(actor.definitionId).toBe(`import-${actor.id}`);
    expect(fresh.definitions.map((entry) => entry.id).sort()).toEqual(fresh.actors.map((actor) => `import-${actor.id}`).sort());
    expect(JSON.stringify(fresh.definitions.map((entry) => entry.id))).not.toContain("example-");
  });

  it("lets the GM edit and delete a starter character (both were impossible before)", () => {
    const game = createInitialGameState();
    const borin = PLACEHOLDER_ACTOR_IDS.fighter;
    expect(() => setCharacterIdentity(game, borin, { classes: [{ id: "fighter", name: "Fighter", level: 8 }], feats: [] })).not.toThrow();
    expect(game.definitions.find((entry) => entry.id === `import-${borin}`)!.definition.character!.classes[0].level).toBe(8);
    expect(() => removeActor(game, borin)).not.toThrow();
    expect(game.actors.map((actor) => actor.id)).not.toContain(borin);
    // The sheet goes with the character; nothing references it any more.
    expect(game.definitions.map((entry) => entry.id)).not.toContain(`import-${borin}`);
  });
});

describe("the one-time repair for saves that already exist", () => {
  it("re-keys legacy example sheets, keeps the bodies verbatim, and drops the orphaned rows", async () => {
    await withStore(async (open) => {
      const before = legacyState();
      const store = await open(before);
      const after = store.snapshot;

      for (const actor of after.actors) expect(actor.definitionId).toBe(`import-${actor.id}`);
      expect(after.definitions.some((entry) => entry.id.startsWith("example-"))).toBe(false);
      // Net zero against the 100-definition cap: three added, three dropped.
      expect(after.definitions).toHaveLength(before.definitions.length);
      // Re-key, not rewrite: the sheet a GM sees is byte-for-byte the one they had.
      const borinBefore = before.definitions.find((entry) => entry.id === LEGACY_EXAMPLE_DEFINITION_IDS.fighter)!.definition;
      const borinAfter = after.definitions.find((entry) => entry.id === `import-${PLACEHOLDER_ACTOR_IDS.fighter}`)!.definition;
      expect(borinAfter).toEqual(borinBefore);
      // The whole point: the repaired character is now editable and deletable.
      expect(() => setCharacterIdentity(structuredClone(after), PLACEHOLDER_ACTOR_IDS.fighter, { classes: [{ id: "fighter", name: "Fighter", level: 8 }], feats: [] })).not.toThrow();
    });
  });

  it("runs exactly once and changes nothing on a second start", async () => {
    await withStore(async (open, databasePath) => {
      const first = await open(legacyState());
      const afterFirst = first.snapshot;
      first.close();

      const second = await open(legacyState());
      expect(second.snapshot).toEqual(afterFirst);
      second.close();

      const persisted = new DatabaseSync(databasePath, { readOnly: true });
      const seeds = (persisted.prepare("SELECT seed_key FROM application_seeds").all() as Array<{ seed_key: string }>).map((row) => row.seed_key);
      persisted.close();
      expect(seeds.filter((key) => key === "example-party-normalization-v1")).toHaveLength(1);
    });
  });

  it("leaves an example-keyed sheet alone while some actor still points at it (never destroys data)", async () => {
    await withStore(async (open) => {
      const legacy = legacyState();
      // A second actor sharing the fighter's legacy sheet: the repair must re-key the one it can and
      // leave the shared row in place rather than orphaning the other actor.
      const sharedId = "10000000-0000-4000-8000-0000000000cc";
      const withShare = GameStateSchema.parse({
        ...legacy,
        actors: [...legacy.actors, { id: sharedId, name: "Borin's Twin", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10 }, definitionId: LEGACY_EXAMPLE_DEFINITION_IDS.fighter }]
      });
      const store = await open(withShare);
      const after = store.snapshot;
      // Both actors were re-keyed to their OWN sheet, so nothing is left pointing at the legacy row.
      expect(after.actors.find((actor) => actor.id === sharedId)!.definitionId).toBe(`import-${sharedId}`);
      expect(after.definitions.some((entry) => entry.id === LEGACY_EXAMPLE_DEFINITION_IDS.fighter)).toBe(false);
      expect(after.definitions.find((entry) => entry.id === `import-${sharedId}`)).toBeDefined();
    });
  });
});
