import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { fillStoredProseFacts, importActorDefinition } from "../src/actor-roster.js";
import { HomebrewStore } from "../src/homebrew-store.js";
import { createInitialGameState } from "../src/initial-game-state.js";

/** A stat block whose actions predate the fields: a breath weapon named in prose and a Multiattack with no parts. */
function oldStatBlock(): ActorDefinition {
  const base = loadMonsterDefinitions()[0]!;
  return {
    ...base,
    name: "Old Drake",
    actions: [
      { id: "multiattack", name: "Multiattack", activation: "action", description: "Two Rends.", damage: [] },
      {
        id: "breath",
        name: "Fire Breath",
        activation: "action",
        description: "Each creature in a 30-foot Cone makes a DC 13 Dexterity saving throw.",
        damage: [{ formula: "4d6", type: "fire" }]
      }
    ]
  } as ActorDefinition;
}

const CONE = { shape: "cone", sizeFeet: 30, widthFeet: null };

describe("prose facts are filled where an action enters the campaign", () => {
  it("fills an imported stat block's area and untracked Multiattack", () => {
    const state = createInitialGameState();
    importActorDefinition(state, oldStatBlock(), "70000000-0000-4000-8000-000000000001", "public");
    const stored = state.definitions.at(-1)!.definition;
    expect(stored.actions.find((action) => action.id === "breath")!.area).toEqual(CONE);
    expect(stored.actions.find((action) => action.id === "multiattack")!.untrackedMultiattack).toBe(true);
  });

  it("fills a definition stored before the fields existed, once", () => {
    const state = createInitialGameState();
    state.definitions = [...state.definitions, { id: "import-old", definition: oldStatBlock() }];
    expect(fillStoredProseFacts(state)).toBe(true);
    expect(state.definitions.at(-1)!.definition.actions.find((action) => action.id === "breath")!.area).toEqual(CONE);
    expect(fillStoredProseFacts(state)).toBe(false);
  });
});

describe("prose facts on homebrew, filled as the catalog is built", () => {
  let directory: string;
  let store: HomebrewStore;
  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const open = async () => {
    directory = await mkdtemp(join(tmpdir(), "vtt-prose-facts-"));
    store = new HomebrewStore(join(directory, "vtt.sqlite"));
    await store.initialize();
  };

  it("gives a homebrew creature's actions their area and Multiattack mark", async () => {
    await open();
    const { source: _source, ...body } = oldStatBlock();
    const row = store.create({ type: "monster", body });
    const actions = store.monsterForInstance(row.id)!.actions;
    expect(actions.find((action) => action.id === "breath")!.area).toEqual(CONE);
    expect(actions.find((action) => action.id === "multiattack")!.untrackedMultiattack).toBe(true);
  });

  it("gives a homebrew spell the area its text names", async () => {
    await open();
    const { id: _id, ...fireball } = loadSpells().find((spell) => spell.id === "fireball")!;
    const row = store.create({ type: "spell", body: { ...fireball, name: "Cinder Burst", area: null } });
    store.setState(row.id, "published", undefined);
    expect(store.publishedFor("gm").spells.find((spell) => spell.id === row.id)!.area).toEqual({
      shape: "sphere",
      sizeFeet: 20,
      widthFeet: null
    });
  });
});
