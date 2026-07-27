import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { HomebrewUsagesSchema } from "@vtt/api-contract";
import { ActorDefinitionSchema, ActorSchema, type ActorDefinition } from "@vtt/schemas";
import { buildHomebrewUsageIndex, homebrewUsages } from "../src/homebrew-usages.js";

/**
 * The reference index behind the edit warning and the delete confirmation.
 *
 * The split it has to get right is decision 9's, and the two halves point opposite ways:
 * character content is INFORMATIONAL (a built character carries a flattened, self-contained
 * definition and does not consult the catalog again), while a MONSTER's actions are late-bound and
 * re-resolved per use, so an edit reaches every live token immediately.
 */

const ACTOR_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PENDING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const CHARACTER: ActorDefinition = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-character", schemaVersion: 1,
  source: { name: "Builder", version: "1" },
  name: "Sera", size: "medium",
  abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 },
  proficiencyBonus: 2, armorClass: 12, hitPoints: { maximum: 8 }, speedFeet: 30,
  token: { disposition: "friendly" },
  character: {
    classes: [{ id: "hb-blood-hunter-a1b2c3", name: "Blood Hunter", level: 3, subclass: { id: "hb-mutant-d4e5f6", name: "Mutant" } }],
    race: { id: "hb-gith-a1b2c3", name: "Gith" },
    background: { id: "hb-hermit-a1b2c3", name: "Hermit" },
    feats: [{ id: "hb-blood-maledict-a1b2c3", name: "Blood Maledict" }],
    // The provenance ledger: the ONLY place recording which option a character actually took,
    // because most riders are flattened into actions/traits/proficiencies at build time.
    choices: [{ level: 1, kind: "lineage", id: "yanki" }, { level: 4, kind: "feat", id: "hb-crimson-rite-a1b2c3" }]
  },
  spellcasting: { ability: "int", slots: [{ level: 1, max: 2 }], spells: [{ id: "hb-crimson-bolt-a1b2c3", name: "Crimson Bolt", level: 1, classId: "hb-blood-hunter-a1b2c3" }] },
  startingInventory: [{ id: "hb-hunters-blade-a1b2c3", name: "Hunter's Blade" }]
});

function stateWith(overrides: Partial<GameState> = {}): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      ActorSchema.parse({
        id: ACTOR_A, name: "Sera", kind: "player-character", hp: { current: 8, maximum: 8 },
        definitionId: `import-${ACTOR_A}`,
        inventory: [{ id: "hb-hunters-blade-a1b2c3", name: "Hunter's Blade" }],
        preparedSpellIds: ["hb-crimson-bolt-a1b2c3"]
      }),
      ActorSchema.parse({ id: ACTOR_B, name: "Bone Colossus", kind: "monster", hp: { current: 90, maximum: 90 }, definitionId: "hb-m-4f19c8b02de7" })
    ],
    definitions: [{ id: `import-${ACTOR_A}`, definition: CHARACTER }],
    ...overrides
  });
}

describe("homebrew usages", () => {
  it("finds a homebrew class, subclass, species, background and feat through a built character", () => {
    const state = stateWith();
    for (const [type, id] of [["class", "hb-blood-hunter-a1b2c3"], ["subclass", "hb-mutant-d4e5f6"], ["species", "hb-gith-a1b2c3"], ["background", "hb-hermit-a1b2c3"], ["feat", "hb-blood-maledict-a1b2c3"]] as const) {
      const usages = homebrewUsages(state, type, id);
      expect(usages.length, `${type} ${id}`).toBeGreaterThan(0);
      expect(usages[0].actorId).toBe(ACTOR_A);
      expect(usages[0].actorName).toBe("Sera");
    }
  });

  it("finds a feat taken through the choices ledger, which nothing else records", () => {
    // Crimson Rite is in `choices[]` only - it was never written to `character.feats`. Most riders
    // are flattened at build time and lose their source id, so this ledger is the only witness.
    const usages = homebrewUsages(stateWith(), "feat", "hb-crimson-rite-a1b2c3");
    expect(usages.map((usage) => usage.kind)).toContain("choice");
    expect(usages[0].detail).toContain("level 4");
  });

  it("finds live inventory, prepared spells and the starting loadout", () => {
    const state = stateWith();
    expect(homebrewUsages(state, "equipment", "hb-hunters-blade-a1b2c3").map((usage) => usage.kind).sort()).toEqual(["inventory", "starting-inventory"]);
    expect(homebrewUsages(state, "spell", "hb-crimson-bolt-a1b2c3").length).toBeGreaterThan(0);
  });

  it("reports a monster usage as a LIVE INSTANCE, because action edits reach it immediately", () => {
    // Not informational: the action list, attack resolution, recharge rolls and rest re-arming all
    // re-resolve the definition per use, so editing a published creature changes a fight in progress.
    const usages = homebrewUsages(stateWith(), "monster", "hb-m-4f19c8b02de7");
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({ actorId: ACTOR_B, actorName: "Bone Colossus", kind: "definition" });
    expect(usages[0].detail).toContain("immediately");
  });

  it("finds a reference inside a pending import, before the GM has approved it", () => {
    const state = stateWith({ pendingImports: [{ id: PENDING, name: "Sera II", submittedBy: "player", definition: CHARACTER }] });
    const usages = homebrewUsages(state, "class", "hb-blood-hunter-a1b2c3");
    expect(usages.map((usage) => usage.actorId)).toContain(PENDING);
  });

  it("reports nothing for an unreferenced record, and nothing for an empty table", () => {
    expect(homebrewUsages(stateWith(), "class", "hb-unused-a1b2c3")).toEqual([]);
    expect(homebrewUsages(GameStateSchema.parse({ schemaVersion: 1 }), "monster", "hb-m-4f19c8b02de7")).toEqual([]);
  });

  it("emits only usages the contract can carry - every actorId is a real uuid", () => {
    // `HomebrewUsageSchema.actorId` is a REQUIRED uuid, so a definition with no actor behind it is
    // skipped rather than sent as a malformed row that would fail the response schema.
    const orphaned = stateWith({ definitions: [{ id: "import-orphan", definition: CHARACTER }], actors: [] });
    expect(homebrewUsages(orphaned, "class", "hb-blood-hunter-a1b2c3")).toEqual([]);

    const index = buildHomebrewUsageIndex(stateWith());
    for (const type of ["class", "subclass", "species", "background", "feat", "spell", "equipment", "monster"] as const) {
      const usages = index.of(type, type === "monster" ? "hb-m-4f19c8b02de7" : "hb-blood-hunter-a1b2c3");
      expect(HomebrewUsagesSchema.safeParse({ id: "hb-blood-hunter-a1b2c3", usages, safeToDelete: true }).success, type).toBe(true);
    }
  });

  it("builds ONE index for the whole state, so a fifty-row library page is one pass", () => {
    // The list route asks for a usage count per row and `GameStore.snapshot` structured-clones the
    // campaign on every read; a per-id scan would clone it once per row.
    const index = buildHomebrewUsageIndex(stateWith());
    expect(index.of("class", "hb-blood-hunter-a1b2c3").length).toBeGreaterThan(0);
    expect(index.of("monster", "hb-m-4f19c8b02de7")).toHaveLength(1);
    expect(index.of("class", "wizard")).toEqual([]);
  });
});
