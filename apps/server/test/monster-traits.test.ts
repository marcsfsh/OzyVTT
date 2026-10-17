import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import type { EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { testCatalog } from "./catalog-records.js";

// What a stat block's traits do in play (SRD 5.2.1 monsters): the ones the engine can see run themselves.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  ally: "10000000-0000-4000-8000-000000000003",
  foe2: "10000000-0000-4000-8000-000000000004",
  session: "30000000-0000-4000-8000-000000000001",
  gm: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;

const HOLD_PERSON: ActorAction = {
  id: "spell-hold-person",
  name: "Hold Person",
  activation: "action",
  description: "Wisdom Saving Throw.",
  spellId: "hold-person",
  save: {
    ability: "wis",
    dc: 15,
    successDamage: "none",
    failureConditions: ["paralyzed"],
    repeatSave: true
  },
  damage: []
};
const FIRE_BOLT: ActorAction = {
  id: "spell-fire-bolt",
  name: "Fire Bolt",
  activation: "action",
  description: "Ranged spell attack.",
  spellId: "fire-bolt",
  attack: { bonus: 7, rangeFeet: 120 },
  damage: [{ formula: "1d10", type: "fire" }]
};
const SHOVE_SAVE: ActorAction = {
  id: "stomp",
  name: "Stomp",
  activation: "action",
  description: "Constitution Saving Throw.",
  save: { ability: "con", dc: 12, successDamage: "none", failureConditions: ["prone"] },
  damage: []
};

const hero = {
  schemaId: "vtt.actor-character",
  name: "Hero",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  hitPoints: { maximum: 30 },
  armorClass: 12,
  extensions: {},
  token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
  actions: [HOLD_PERSON, FIRE_BOLT, SHOVE_SAVE]
} as unknown as ActorDefinition;
const monsters = new Map(loadMonsterDefinitions().map((entry) => [entry.source.externalId!, entry]));
const monster = (slug: string) => monsters.get(slug)!;
const resolveDefinition = (id: string) => (id === "hero" ? hero : monster(id));
const catalog = testCatalog({ spells: loadSpells() as unknown as object[] });

let sequence = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
const NOW = () => "2026-10-17T00:00:00.000Z";

/** The hero (a PC), a foe from the SRD bundle, and an ally PC; initiative hero, foe, ally, and a second foe last. */
function game(foe: string, options: Readonly<{ foeHp?: number; foe2?: string }> = {}): GameState {
  const definition = monster(foe);
  const hp = options.foeHp ?? definition.hitPoints.maximum;
  const second = options.foe2 ? monster(options.foe2) : undefined;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: 30, maximum: 30 },
        ownerSessionId: IDS.session,
        definitionId: "hero",
        speedFeet: 30,
        armorClass: 12
      },
      {
        id: IDS.foe,
        name: definition.name,
        kind: "monster",
        hp: { current: hp, maximum: definition.hitPoints.maximum },
        definitionId: foe,
        speedFeet: definition.speedFeet,
        armorClass: definition.armorClass
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "player-character",
        hp: { current: 25, maximum: 25 },
        definitionId: "hero",
        speedFeet: 30,
        armorClass: 12
      },
      ...(second
        ? [
            {
              id: IDS.foe2,
              name: `${second.name} 2`,
              kind: "monster",
              hp: { current: second.hitPoints.maximum, maximum: second.hitPoints.maximum },
              definitionId: options.foe2,
              speedFeet: second.speedFeet,
              armorClass: second.armorClass
            }
          ]
        : [])
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 15 },
        { actorId: IDS.ally, score: 10 },
        ...(second ? [{ actorId: IDS.foe2, score: 5 }] : [])
      ]
    },
    () => 10,
    { width: 900, height: 600, calibration: null }
  );
  return state;
}

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;

/** Creature-to-creature distance from positions in feet, measured as the grid does (diagonals count 5). */
const distanceBy =
  (positions: Readonly<Record<string, readonly [number, number]>>) =>
  (a: string, b: string): number | null => {
    const from = positions[a];
    const to = positions[b];
    return from && to ? Math.max(Math.abs(from[0] - to[0]), Math.abs(from[1] - to[1])) : null;
  };

function resolveDeps(faces: number[], actorDefinition: ActorDefinition): ResolveDependencies {
  return {
    random: () => faces.shift() ?? 10,
    newRollId: nextId,
    gmSessionId: IDS.gm,
    now: NOW,
    definition: actorDefinition,
    resolveDefinition,
    catalog
  };
}
function saveDeps(faces: number[]): SaveAnswerDependencies {
  return {
    random: () => faces.shift() ?? 10,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition,
    catalog
  };
}

/** The hero uses one of its actions on the foe, on its own turn. */
function heroUses(state: GameState, action: ActorAction, faces: number[] = []) {
  return resolveDefinitionAction(
    state,
    action,
    { actorId: IDS.hero, targetIds: [IDS.foe], commandId: nextId() },
    resolveDeps(faces, hero)
  );
}
const pendingOn = (state: GameState, id: string) =>
  state.combat.pendingSaves.filter((save) => save.targetActorId === id);

describe("Magic Resistance and Greater Magic Resistance", () => {
  it("gives Advantage on a save against a spell, and says why", () => {
    const state = game("glabrezu");
    heroUses(state, HOLD_PERSON);
    const [pending] = pendingOn(state, IDS.foe);
    expect(pending?.magical).toBe(true);
    // Two d20s for Advantage: the 18 counts.
    const { outcome } = answerSave(state, nextId(), pending!.id, "roll", undefined, false, GM, saveDeps([3, 18]));
    expect(outcome.natural).toBe(18);
    expect(outcome.rollMode?.mode).toBe("advantage");
    expect(outcome.rollMode?.advantage).toContain("Magic Resistance");
  });

  it("gives nothing against a save that isn't magical", () => {
    const state = game("glabrezu");
    heroUses(state, SHOVE_SAVE);
    const [pending] = pendingOn(state, IDS.foe);
    expect(pending?.magical).toBeUndefined();
    const { outcome } = answerSave(state, nextId(), pending!.id, "roll", undefined, false, GM, saveDeps([3, 18]));
    expect(outcome.natural).toBe(3);
    expect(outcome.rollMode).toBeUndefined();
  });

  it("helps the save a spell's effect has its target repeat", () => {
    const state = game("glabrezu");
    heroUses(state, HOLD_PERSON);
    const [pending] = pendingOn(state, IDS.foe);
    answerSave(state, nextId(), pending!.id, "manual", 1, true, GM, saveDeps([]));
    expect(actor(state, IDS.foe).effects[0]?.magical).toBe(true);
    // The hero's turn ends, then the glabrezu's: its repeated save opens, still against magic.
    const events: EffectNarration[] = [];
    const turnDeps = { resolveDefinition, rollDie: () => 1, newId: nextId, now: NOW };
    nextInitiativeTurn(state, events, turnDeps);
    nextInitiativeTurn(state, events, turnDeps);
    const [repeat] = pendingOn(state, IDS.foe);
    expect(repeat?.repeatOf).toBeDefined();
    expect(repeat?.magical).toBe(true);
    const { outcome } = answerSave(state, nextId(), repeat!.id, "roll", undefined, false, GM, saveDeps([2, 16]));
    expect(outcome.rollMode?.advantage).toContain("Magic Resistance");
  });

  it("lets a rakshasa succeed on a save against a spell without a roll", () => {
    const state = game("rakshasa");
    heroUses(state, HOLD_PERSON);
    const [pending] = pendingOn(state, IDS.foe);
    const answered = answerSave(state, nextId(), pending!.id, "roll", undefined, true, GM, saveDeps([]));
    expect(answered.outcome).toMatchObject({ success: true, autoSucceeded: "Greater Magic Resistance" });
    expect(answered.outcome.natural).toBeUndefined();
    expect(actor(state, IDS.foe).conditions).toEqual([]);
    expect(answered.events.map((event) => event.text)).toContain(
      "Rakshasa automatically succeeds on the WIS save (Greater Magic Resistance)."
    );
  });

  it("makes a spell's attack roll miss a rakshasa, even a 20", () => {
    const state = game("rakshasa");
    const resolution = heroUses(state, FIRE_BOLT, [20]);
    expect(resolution.attack?.outcome).toBe("miss");
    expect(resolution.damageTotal).toBe(0);
  });
});

describe("Pack Tactics", () => {
  const bite = monster("wolf").actions.find((action) => action.id === "bite")!;
  /** The wolf bites the hero on its turn, with the tokens where `positions` puts them. */
  function wolfBites(state: GameState, positions: Readonly<Record<string, readonly [number, number]>>) {
    state.combat = { ...state.combat, turnActorId: IDS.foe };
    return resolveDefinitionAction(
      state,
      bite,
      { actorId: IDS.foe, targetIds: [IDS.hero], commandId: nextId(), commit: false },
      { ...resolveDeps([4, 17], monster("wolf")), distanceFeet: distanceBy(positions) }
    );
  }

  it("gives Advantage when an able ally of the attacker is within 5 feet of the target", () => {
    const state = game("wolf", { foe2: "wolf" });
    const preview = wolfBites(state, { [IDS.hero]: [0, 0], [IDS.foe]: [5, 0], [IDS.foe2]: [0, 5] });
    expect(preview.rollMode?.mode).toBe("advantage");
    expect(preview.rollMode?.advantage).toContain("Pack Tactics (Wolf 2 within 5 ft)");
    expect(preview.attack?.naturalRoll).toBe(17);
  });

  it("gives nothing when the ally is farther off, Incapacitated, or not an ally", () => {
    const far = game("wolf", { foe2: "wolf" });
    expect(wolfBites(far, { [IDS.hero]: [0, 0], [IDS.foe]: [5, 0], [IDS.foe2]: [0, 10] }).rollMode).toBeUndefined();

    const stunned = game("wolf", { foe2: "wolf" });
    actor(stunned, IDS.foe2).conditions = [{ id: "stunned" }];
    expect(wolfBites(stunned, { [IDS.hero]: [0, 0], [IDS.foe]: [5, 0], [IDS.foe2]: [0, 5] }).rollMode).toBeUndefined();

    // The hero's own ally beside it is no ally of the wolf's.
    const alone = game("wolf");
    expect(wolfBites(alone, { [IDS.hero]: [0, 0], [IDS.foe]: [5, 0], [IDS.ally]: [0, 5] }).rollMode).toBeUndefined();
  });
});
