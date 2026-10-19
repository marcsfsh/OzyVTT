import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { setCondition } from "../src/actor-conditions.js";
import { addEffect, endEffect, makeEffect } from "../src/effects.js";
import { openRepeatSaves } from "../src/save-stages.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { RulesBlockedError } from "../src/game-store.js";
import { projectPlayerView } from "../src/projections.js";
import { testCatalog } from "./catalog-records.js";

// SRD Concentration: casting a Concentration spell starts it (and ends any other the caster holds); what its failed
// saves impose ends with it; damage asks for a Constitution save; Incapacitation, 0 HP and death break it.

const IDS = {
  wizard: "10000000-0000-4000-8000-000000000001",
  captain: "10000000-0000-4000-8000-000000000002",
  ally: "10000000-0000-4000-8000-000000000003",
  gm: "30000000-0000-4000-8000-00000000000a",
  session: "30000000-0000-4000-8000-000000000001",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;

const definition = {
  name: "Anyone",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  hitPoints: { maximum: 30 },
  armorClass: 12,
  extensions: {},
  actions: []
} as unknown as ActorDefinition;
const monster = (slug: string) => loadMonsterDefinitions().find((entry) => entry.source.externalId === slug)!;
const resolveDefinition = (id: string) => (id === "plain" ? definition : monster(id));
const spells = loadSpells();
const catalog = testCatalog({ spells: spells as unknown as object[] });

/** A spell action as the builder mints it: the spell's save at the caster's DC, keyed by `spellId`. */
function spellAction(spellId: string, dc = 15): ActorAction {
  const spell = spells.find((entry) => entry.id === spellId)!;
  return {
    id: `spell-${spellId}`,
    name: spell.name,
    activation: "action",
    description: "",
    damage: [],
    ...(spell.save ? { save: { ...spell.save, dc, spellcasting: true } } : {}),
    spellId
  } as ActorAction;
}

let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-16T00:00:00.000Z";

function game(captainDefinition = "plain"): GameState {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.wizard,
        name: "Wizard",
        kind: "player-character",
        hp: { current: 20, maximum: 20 },
        definitionId: "plain",
        ownerSessionId: IDS.session
      },
      {
        id: IDS.captain,
        name: "Captain",
        kind: "monster",
        hp: { current: 40, maximum: 40 },
        definitionId: captainDefinition
      },
      { id: IDS.ally, name: "Ally", kind: "player-character", hp: { current: 20, maximum: 20 }, definitionId: "plain" }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.wizard, score: 20 },
        { actorId: IDS.captain, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
const conditionIds = (state: GameState, id: string) => actor(state, id).conditions.map((condition) => condition.id);
const deps = (actorDefinition = definition): ResolveDependencies => ({
  random: () => 10,
  newRollId: nextId,
  gmSessionId: IDS.gm,
  now: NOW,
  definition: actorDefinition,
  resolveDefinition,
  catalog
});
const saveDeps: SaveAnswerDependencies = {
  random: () => 10,
  newRollId: nextId,
  sessionId: IDS.gm,
  role: "gm",
  now: NOW,
  resolveDefinition,
  catalog
};
const fresh = (state: GameState, actorId: string) => {
  state.combat = {
    ...state.combat,
    turnActorId: actorId,
    turn: { ...state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
  };
};
function cast(state: GameState, spellId: string, targetIds: string[]) {
  fresh(state, IDS.wizard);
  return resolveDefinitionAction(
    state,
    spellAction(spellId),
    { actorId: IDS.wizard, targetIds, commandId: nextId() },
    deps()
  );
}
function answer(state: GameState, targetId: string, total: number) {
  const pending = state.combat.pendingSaves.find((save) => save.targetActorId === targetId)!;
  return answerSave(state, nextId(), pending.id, "manual", total, true, GM, saveDeps);
}

describe("casting a Concentration spell starts Concentration", () => {
  it("Hold Person: the caster concentrates, the failed target is Paralyzed by it, and damage asks for the save", () => {
    const state = game();
    const resolution = cast(state, "hold-person", [IDS.captain]);
    expect(resolution.effectsApplied).toContainEqual(
      expect.objectContaining({ targetId: IDS.wizard, name: "Concentrating on Hold Person" })
    );
    expect(actor(state, IDS.wizard).effects).toMatchObject([
      {
        name: "Concentrating on Hold Person",
        concentration: true,
        sourceActorId: IDS.wizard,
        duration: { type: "rounds", remaining: 10 }
      }
    ]);
    answer(state, IDS.captain, 3);
    expect(conditionIds(state, IDS.captain)).toEqual(["paralyzed"]);
    expect(actor(state, IDS.captain).effects[0]).toMatchObject({
      name: "Paralyzed by Wizard (Hold Person)",
      concentration: true,
      sourceActorId: IDS.wizard,
      repeatSave: { ability: "wis", dc: 15 }
    });
    // 20 damage: a DC 10 Constitution save; failing it ends the Hold.
    applyDamageDetailed(state, IDS.wizard, { amount: 12 }, GM, { resolveDefinition, newId: nextId, now: NOW });
    const check = state.combat.pendingSaves.find((save) => save.targetActorId === IDS.wizard)!;
    expect(check).toMatchObject({ ability: "con", dc: 10 });
    expect(check.endsEffects).toHaveLength(2);
    answer(state, IDS.wizard, 4);
    expect(conditionIds(state, IDS.captain)).toEqual([]);
    expect(actor(state, IDS.wizard).effects).toEqual([]);
  });

  it("casting a second Concentration spell ends the first, and its conditions with it", () => {
    const state = game();
    cast(state, "hold-person", [IDS.captain]);
    answer(state, IDS.captain, 3);
    const second = cast(state, "hypnotic-pattern", [IDS.ally]);
    expect(conditionIds(state, IDS.captain)).toEqual([]);
    expect(second.tableNarration?.some((line) => /Concentrating on Hold Person ended/.test(line.text))).toBe(true);
    expect(actor(state, IDS.wizard).effects.map((effect) => effect.name)).toEqual([
      "Concentrating on Hypnotic Pattern"
    ]);
  });

  it("the caster dropping to 0 HP, or being Stunned, frees the target", () => {
    const state = game();
    cast(state, "hold-person", [IDS.captain]);
    answer(state, IDS.captain, 3);
    setCondition(state, IDS.wizard, "stunned", true, undefined, GM);
    expect(conditionIds(state, IDS.captain)).toEqual([]);

    const again = game();
    cast(again, "hold-person", [IDS.captain]);
    answer(again, IDS.captain, 3);
    applyDamageDetailed(again, IDS.wizard, { amount: 50 }, GM, { resolveDefinition });
    expect(conditionIds(again, IDS.captain)).toEqual([]);
  });

  it("a GM setting the caster to 0 HP, or Exhaustion 6, ends its Concentration", async () => {
    const { setCurrentHp } = await import("../src/hit-points.js");
    const state = game();
    cast(state, "hold-person", [IDS.captain]);
    answer(state, IDS.captain, 3);
    setCurrentHp(state, IDS.wizard, 0, GM);
    expect(conditionIds(state, IDS.captain)).toEqual([]);

    const again = game();
    cast(again, "hold-person", [IDS.captain]);
    answer(again, IDS.captain, 3);
    setCondition(again, IDS.wizard, "exhaustion", true, 6, GM);
    expect(conditionIds(again, IDS.captain)).toEqual([]);
  });

  it("ending the caster's Concentration by hand ends what the cast imposed", () => {
    const state = game();
    cast(state, "hold-person", [IDS.captain]);
    answer(state, IDS.captain, 3);
    endEffect(state, IDS.wizard, actor(state, IDS.wizard).effects[0].id);
    expect(conditionIds(state, IDS.captain)).toEqual([]);
  });

  it("a save answered after the Concentration broke imposes nothing", () => {
    const state = game();
    cast(state, "hold-person", [IDS.captain]);
    endEffect(state, IDS.wizard, actor(state, IDS.wizard).effects[0].id);
    const { events } = answer(state, IDS.captain, 3);
    expect(conditionIds(state, IDS.captain)).toEqual([]);
    expect(events.some((event) => /no longer concentrating/.test(event.text))).toBe(true);
  });

  it("damage outside a fight still asks for the Constitution save, and it can be answered", () => {
    const state = game();
    cast(state, "hold-person", [IDS.captain]);
    answer(state, IDS.captain, 3);
    state.combat = { ...state.combat, active: false };
    applyDamageDetailed(state, IDS.wizard, { amount: 4 }, GM, { resolveDefinition, newId: nextId, now: NOW });
    expect(state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.wizard, ability: "con", dc: 10 }]);
    answer(state, IDS.wizard, 15);
    expect(state.combat.pendingSaves).toEqual([]);
    expect(conditionIds(state, IDS.captain)).toEqual(["paralyzed"]);
  });
});

describe("what players see of a Concentration", () => {
  it("the caster's player sees both effects as theirs to end, with no cast id; another player sees neither as theirs", () => {
    const state = game();
    cast(state, "hold-person", [IDS.captain]);
    answer(state, IDS.captain, 3);
    const mine = projectPlayerView(state, IDS.session, () => null);
    const effectsOf = (view: typeof mine, id: string) => view.actors.find((entry) => entry.id === id)!.effects;
    expect(effectsOf(mine, IDS.wizard)).toMatchObject([{ name: "Concentrating on Hold Person", yours: true }]);
    expect(effectsOf(mine, IDS.captain)).toMatchObject([{ name: "Paralyzed by Wizard (Hold Person)", yours: true }]);
    expect(JSON.stringify(mine)).not.toContain('"castId"');
    const theirs = projectPlayerView(state, "30000000-0000-4000-8000-000000000002", () => null);
    expect(effectsOf(theirs, IDS.captain)[0]).not.toHaveProperty("yours");
  });
});

describe("a hidden source stays hidden", () => {
  it("masks a hidden caster's name in the repeated save a player owes", () => {
    const state = game();
    actor(state, IDS.captain).visibility = "gm-only";
    addEffect(
      state,
      IDS.wizard,
      makeEffect({
        id: "held",
        name: "Paralyzed by Captain (Hold Person)",
        sourceActorId: IDS.captain,
        sourceName: "Captain",
        duration: { type: "manual" },
        linkedConditionIds: ["paralyzed"],
        repeatSave: { ability: "wis", dc: 15 }
      })
    );
    openRepeatSaves(state, IDS.wizard, "turn-end", { newId: nextId, now: NOW });
    const view = projectPlayerView(state, IDS.session, () => null);
    expect(view.combat.pendingSaves).toMatchObject([
      { actionName: "Paralyzed by A hidden threat (Hold Person) - repeat save", sourceName: "A hidden threat" }
    ]);
    expect(JSON.stringify(view)).not.toContain("Captain");
  });
});

describe("source-linked save conditions", () => {
  it("a creature Charmed by a failed save can't attack its charmer", () => {
    const state = game("pirate-captain");
    fresh(state, IDS.captain);
    const charm = monster("pirate-captain").actions.find((action) => action.id === "captain-s-charm")!;
    resolveDefinitionAction(
      state,
      charm,
      { actorId: IDS.captain, targetIds: [IDS.wizard], commandId: nextId() },
      deps(monster("pirate-captain"))
    );
    answer(state, IDS.wizard, 1);
    expect(conditionIds(state, IDS.wizard)).toEqual(["charmed"]);
    fresh(state, IDS.wizard);
    expect(() =>
      resolveDefinitionAction(
        state,
        {
          id: "dagger",
          name: "Dagger",
          activation: "action",
          description: "",
          attack: { bonus: 4, reachFeet: 5 },
          damage: [{ formula: "1d4", type: "piercing" }]
        },
        { actorId: IDS.wizard, targetIds: [IDS.captain], commandId: nextId() },
        deps()
      )
    ).toThrow(RulesBlockedError);
  });
});
