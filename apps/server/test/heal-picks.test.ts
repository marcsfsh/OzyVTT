import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { RulesBlockedError } from "../src/game-store.js";
import { withChosenCost } from "../src/use-cost.js";
import { ALLY, build, catalog, clericInput, fight, FOE2, HERO } from "./spell-casters.js";

// SRD 5.2.1 Preserve Life (Life Domain): "Choose Bloodied creatures within 30 feet of yourself (which can include
// you), and divide those Hit Points among them. This feature can restore a creature to no more than half its Hit Point
// maximum." Restoring Touch (Paladin 14): "When you use Lay On Hands on a creature, you can also remove one or more of
// the following conditions ... For each condition, you must expend 5 Hit Points from the healing pool."

/** A seeded stand-in for the dice (mulberry32), so the generated Paladin is the same every run. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  return null;
};

describe("Preserve Life", () => {
  const cleric = build(clericInput(["bless", "cure-wounds"]));
  function table() {
    const setup = fight(cleric, { ally: true });
    const actor = (id: string) => setup.state.actors.find((candidate) => candidate.id === id)!;
    actor(ALLY).hp = { ...actor(ALLY).hp, current: 40, maximum: 200 };
    actor(HERO).hp = { ...actor(HERO).hp, current: 5 };
    setup.state.combat = { ...setup.state.combat, ruleExceptions: { targeting: "strict" } };
    let command = 0;
    const preserve = (input: Partial<ResolveInput>) =>
      resolveDefinitionAction(
        setup.state,
        setup.action("preserve-life"),
        { actorId: HERO, targetIds: [ALLY, HERO], commandId: `preserve-${(command += 1)}`, ...input },
        {
          random: () => 3,
          newRollId: () => `40000000-0000-4000-8000-${String((command += 1)).padStart(12, "0")}`,
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-19T00:00:00.000Z",
          definition: cleric,
          catalog,
          distanceFeet: () => 10
        }
      );
    return { ...setup, actor, preserve };
  }

  it("divides a Life Cleric 5's 25 Hit Points as the Cleric chooses", () => {
    const { actor, preserve } = table();
    const before = actor(HERO).hp.current;
    preserve({ healingShares: { [ALLY]: 15, [HERO]: 10 } });
    expect(actor(ALLY).hp.current).toBe(55);
    expect(actor(HERO).hp.current).toBe(before + 10);
  });

  it("refuses a creature that isn't Bloodied, a division past the pool, and a share past half the maximum", () => {
    expect(refusal(() => table().preserve({ targetIds: [ALLY, FOE2] }))).toMatch(
      /targets a Bloodied creature, and Orc isn't/
    );
    expect(refusal(() => table().preserve({ healingShares: { [ALLY]: 20, [HERO]: 10 } }))).toMatch(
      /The shares add up to 30, and Channel Divinity: Preserve Life has 25 Hit Points to divide/
    );
    const capped = table();
    capped.actor(ALLY).hp = { ...capped.actor(ALLY).hp, current: 95 };
    expect(refusal(() => capped.preserve({ healingShares: { [ALLY]: 10 } }))).toMatch(
      /Bran can regain at most 5 Hit Points/
    );
  });
});

describe("Restoring Touch", () => {
  const library = new ContentLibrary().forAudience("gm");
  const policy = BuilderPolicySchema.parse({});
  const PALADIN = "60000000-0000-4000-8000-000000000011";
  const BRYN = "60000000-0000-4000-8000-000000000012";
  const paladin = buildCharacterDefinition(
    generateCharacterRequest({ classId: "paladin", level: 14 }, library, policy, seeded(5)).request,
    library,
    policy
  );

  function table(): GameState {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: BRYN,
          name: "Bryn",
          kind: "player-character",
          visibility: "public",
          hp: { current: 10, maximum: 40 },
          conditions: [{ id: "blinded" }, { id: "stunned" }, { id: "incapacitated" }]
        }
      ]
    });
    importActorDefinition(state, paladin, PALADIN, "public", equipmentCatalogOf(library));
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000011",
        entries: [
          { actorId: PALADIN, score: 20 },
          { actorId: BRYN, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    return state;
  }
  const touch = (state: GameState, spend: number, conditionIds: string[], apart: number) => {
    const action = paladin.actions.find((entry) => entry.id === "lay-on-hands-restoring-touch")!;
    return resolveDefinitionAction(
      state,
      withChosenCost(action, spend, conditionIds),
      { actorId: PALADIN, targetIds: [BRYN], commandId: "50000000-0000-4000-8000-000000000011", conditionIds },
      {
        random: () => 1,
        newRollId: () => crypto.randomUUID(),
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-19T00:00:00.000Z",
        definition: paladin,
        catalog: equipmentCatalogOf(library),
        distanceFeet: () => apart
      }
    );
  };

  it("heals 10 and ends Blinded and Stunned in one Bonus Action, spending 20 points", () => {
    const state = table();
    touch(state, 10, ["blinded", "stunned"], 5);
    const bryn = state.actors.find((actor) => actor.id === BRYN)!;
    expect(bryn.hp.current).toBe(20);
    expect(bryn.conditions.map((condition) => condition.id)).not.toContain("blinded");
    expect(bryn.conditions.map((condition) => condition.id)).not.toContain("stunned");
    expect(state.actors.find((actor) => actor.id === PALADIN)!.actionUses["lay-on-hands"]).toBe(20);
    expect(state.combat.turn.bonusActionUsed).toBe(true);
  });

  it("ends a condition with no healing for 5 points, and refuses a creature 30 feet away", () => {
    const state = table();
    touch(state, 0, ["blinded"], 5);
    expect(state.actors.find((actor) => actor.id === BRYN)!.hp.current).toBe(10);
    expect(state.actors.find((actor) => actor.id === PALADIN)!.actionUses["lay-on-hands"]).toBe(5);
    expect(() => touch(table(), 10, ["blinded"], 30)).toThrow(RulesBlockedError);
    expect(refusal(() => touch(table(), 0, ["charmed"], 5))).toMatch(/Bryn isn't Charmed/);
  });
});
