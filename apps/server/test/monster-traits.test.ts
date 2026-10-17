import { describe, expect, it } from "vitest";
import { GameStateSchema, isDead, type GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import type { EffectNarration } from "../src/effects.js";
import { nextInitiativeTurn, startEncounter, type TurnAdvanceDeps } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";
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

type Positions = Readonly<Record<string, readonly [number, number]>>;
/** Ends the current turn and starts the next, with dice from `faces` (then 1s) and the tokens where `positions` puts
 *  them. */
function advance(state: GameState, faces: number[] = [], positions?: Positions): EffectNarration[] {
  const events: EffectNarration[] = [];
  const deps: TurnAdvanceDeps = {
    resolveDefinition,
    catalog,
    rollDie: () => faces.shift() ?? 1,
    newId: nextId,
    now: NOW,
    ...(positions ? { distanceFeet: distanceBy(positions) } : {})
  };
  nextInitiativeTurn(state, events, deps);
  return events;
}
const texts = (events: readonly EffectNarration[]) => events.map((event) => event.text);
/** Damage from the hero, as the GM's apply would land it. */
function hurt(
  state: GameState,
  targetId: string,
  parts: Array<{ amount: number; type: string }>,
  faces: number[] = []
) {
  return applyDamageDetailed(
    state,
    targetId,
    { amount: parts.reduce((sum, part) => sum + part.amount, 0), parts, sourceActorId: IDS.hero, sourceName: "Hero" },
    GM,
    { resolveDefinition, catalog, newId: nextId, now: NOW, rollDie: () => faces.shift() ?? 1 }
  );
}

describe("Regeneration", () => {
  it("heals a troll at the start of each of its turns", () => {
    const state = game("troll", { foeHp: 64 });
    const events = advance(state);
    expect(actor(state, IDS.foe).hp.current).toBe(79);
    expect(texts(events)).toContain("Troll regains 15 hit points (Regeneration).");
  });

  it("doesn't work on the troll's next turn after it takes Fire damage, and comes back on the one after", () => {
    const state = game("troll", { foeHp: 64 });
    hurt(state, IDS.foe, [{ amount: 10, type: "fire" }]);
    expect(actor(state, IDS.foe).hp.current).toBe(54);
    const stopped = advance(state);
    expect(actor(state, IDS.foe).hp.current).toBe(54);
    expect(texts(stopped)).toContain("Troll's Regeneration doesn't work this turn (it took Acid or Fire damage).");
    // The ally's turn, the hero's, then the troll's again.
    advance(state);
    advance(state);
    advance(state);
    expect(state.combat.turnActorId).toBe(IDS.foe);
    expect(actor(state, IDS.foe).hp.current).toBe(69);
  });

  it("keeps a troll at 0 HP down rather than dead, and raises it when its turn starts", () => {
    const state = game("troll", { foeHp: 10 });
    const { events } = hurt(state, IDS.foe, [{ amount: 12, type: "slashing" }]);
    const troll = actor(state, IDS.foe);
    expect(troll.hp.current).toBe(0);
    expect(isDead(troll)).toBe(false);
    expect(troll.conditions.map((condition) => condition.id)).toContain("unconscious");
    expect(texts(events)).toContain(
      "Troll drops to 0 HP - it dies only if it starts its turn at 0 HP and doesn't regenerate."
    );
    advance(state);
    expect(actor(state, IDS.foe).hp.current).toBe(15);
    expect(actor(state, IDS.foe).conditions.map((condition) => condition.id)).not.toContain("unconscious");
  });

  it("lets a troll at 0 HP die when its turn starts after it took Acid", () => {
    const state = game("troll", { foeHp: 10 });
    hurt(state, IDS.foe, [{ amount: 12, type: "acid" }]);
    const events = advance(state);
    const troll = actor(state, IDS.foe);
    expect(troll.hp.current).toBe(0);
    expect(isDead(troll)).toBe(true);
    expect(texts(events)).toContain(
      "Troll dies - it started its turn at 0 HP and its Regeneration didn't work (it took Acid or Fire damage)."
    );
  });

  it("needs at least 1 Hit Point for an oni, which dies at 0 like any monster", () => {
    const hurtOni = game("oni", { foeHp: 50 });
    advance(hurtOni);
    expect(actor(hurtOni, IDS.foe).hp.current).toBe(60);

    const downed = game("oni", { foeHp: 5 });
    hurt(downed, IDS.foe, [{ amount: 9, type: "slashing" }]);
    expect(isDead(actor(downed, IDS.foe))).toBe(true);
    advance(downed);
    expect(actor(downed, IDS.foe).hp.current).toBe(0);
  });
});

describe("Undead Fortitude", () => {
  it("leaves a zombie at 1 HP on a Constitution save of DC 5 plus the damage taken", () => {
    const state = game("zombie", { foeHp: 3 });
    // DC 10; the zombie's Con save is +3, so a 7 makes it.
    const { events } = hurt(state, IDS.foe, [{ amount: 5, type: "slashing" }], [7]);
    expect(actor(state, IDS.foe).hp.current).toBe(1);
    expect(texts(events)).toContain(
      "Zombie's Undead Fortitude: CON save 10 (d20 7) vs DC 10 - it drops to 1 HP instead."
    );
  });

  it("lets it fall on a failed save", () => {
    const state = game("zombie", { foeHp: 3 });
    const { events } = hurt(state, IDS.foe, [{ amount: 5, type: "slashing" }], [6]);
    expect(actor(state, IDS.foe).hp.current).toBe(0);
    expect(isDead(actor(state, IDS.foe))).toBe(true);
    expect(texts(events)).toContain("Zombie's Undead Fortitude: CON save 9 (d20 6) vs DC 10 - it falls.");
  });

  it("gives no save against Radiant damage or a Critical Hit", () => {
    const radiant = game("zombie", { foeHp: 3 });
    const { events } = hurt(radiant, IDS.foe, [{ amount: 5, type: "radiant" }], [20]);
    expect(actor(radiant, IDS.foe).hp.current).toBe(0);
    expect(texts(events)).toContain("Zombie's Undead Fortitude doesn't hold against radiant damage.");

    const critical = game("zombie", { foeHp: 3 });
    applyDamageDetailed(
      critical,
      IDS.foe,
      { amount: 5, parts: [{ amount: 5, type: "slashing" }], critical: true },
      GM,
      { resolveDefinition, rollDie: () => 20 }
    );
    expect(actor(critical, IDS.foe).hp.current).toBe(0);
  });
});

describe("auras", () => {
  const near: Positions = { [IDS.hero]: [0, 0], [IDS.foe]: [5, 0], [IDS.ally]: [30, 0], [IDS.foe2]: [0, 5] };

  it("asks a creature that starts its turn in a ghast's Stench for the save, and Poisons it until its next turn", () => {
    const state = game("ghast");
    // Hero's turn ends; the ghast's, then the ally's, then the hero starts its turn beside the ghast.
    advance(state, [], near);
    advance(state, [], near);
    const events = advance(state, [], near);
    expect(state.combat.turnActorId).toBe(IDS.hero);
    expect(texts(events)).toContain("Hero starts its turn in Ghast's Stench: DC 10 CON save.");
    const [pending] = pendingOn(state, IDS.hero);
    expect(pending).toMatchObject({ ability: "con", dc: 10, conditionIds: ["poisoned"], immuneOnSuccess: true });
    answerSave(state, nextId(), pending!.id, "manual", 5, true, GM, saveDeps([]));
    expect(actor(state, IDS.hero).conditions.map((condition) => condition.id)).toEqual(["poisoned"]);
    expect(actor(state, IDS.hero).effects[0]?.duration).toEqual({ type: "until-bearer-next-turn" });
    // Through the ghast's turn the hero stays Poisoned; at the hero's next turn it ends, and the save asks again.
    advance(state, [], near);
    expect(actor(state, IDS.hero).conditions.map((condition) => condition.id)).toEqual(["poisoned"]);
    advance(state, [], near);
    advance(state, [], near);
    expect(state.combat.turnActorId).toBe(IDS.hero);
    expect(actor(state, IDS.hero).conditions).toEqual([]);
    expect(pendingOn(state, IDS.hero)).toHaveLength(1);
  });

  it("makes a creature that succeeds immune to that ghast's Stench for the fight", () => {
    const state = game("ghast");
    advance(state, [], near);
    advance(state, [], near);
    advance(state, [], near);
    const [pending] = pendingOn(state, IDS.hero);
    answerSave(state, nextId(), pending!.id, "manual", 15, true, GM, saveDeps([]));
    expect(actor(state, IDS.hero).effects.map((effect) => effect.name)).toEqual(["Immune to Ghast's Stench"]);
    for (let turn = 0; turn < 3; turn += 1) advance(state, [], near);
    expect(state.combat.turnActorId).toBe(IDS.hero);
    expect(pendingOn(state, IDS.hero)).toEqual([]);
  });

  it("reaches only a pit fiend's enemies with its Fear Aura, and nobody while it is Incapacitated", () => {
    const state = game("pit-fiend", { foe2: "imp" });
    const reach: Positions = { [IDS.hero]: [0, 0], [IDS.foe]: [20, 0], [IDS.ally]: [60, 0], [IDS.foe2]: [10, 0] };
    // The imp, an ally of the fiend, starts its turn in the aura and is left alone.
    advance(state, [], reach);
    advance(state, [], reach);
    advance(state, [], reach);
    expect(state.combat.turnActorId).toBe(IDS.foe2);
    expect(pendingOn(state, IDS.foe2)).toEqual([]);
    const events = advance(state, [], reach);
    expect(texts(events)).toContain("Hero starts its turn in Pit Fiend's Fear Aura: DC 21 WIS save.");

    const stunned = game("pit-fiend");
    actor(stunned, IDS.foe).conditions = [{ id: "stunned" }];
    for (let turn = 0; turn < 3; turn += 1) advance(stunned, [], reach);
    expect(pendingOn(stunned, IDS.hero)).toEqual([]);
  });

  it("burns everyone within 5 feet as a balor's turn ends, rolling the damage once", () => {
    const state = game("balor", { foe2: "imp" });
    state.combat = { ...state.combat, turnActorId: IDS.foe };
    const events = advance(state, [3, 4, 5], near);
    // 3d8 = 12 Fire to the hero beside it and to its own imp, none to the ally 30 feet off.
    expect(actor(state, IDS.hero).hp.current).toBe(18);
    expect(actor(state, IDS.ally).hp.current).toBe(25);
    expect(texts(events)).toContain("Hero takes 12 Fire damage from Balor's Fire Aura.");
    expect(texts(events)).toContain("Imp 2 takes 0 Fire damage from Balor's Fire Aura (12 fire → 0, immunity).");
  });

  it("burns only an azer's enemies, sets nobody burning, and is silent while it is Incapacitated", () => {
    const state = game("azer-sentinel", { foe2: "azer-sentinel" });
    state.combat = { ...state.combat, turnActorId: IDS.foe };
    advance(state, [6], near);
    expect(actor(state, IDS.hero).hp.current).toBe(24);
    expect(actor(state, IDS.foe2).hp.current).toBe(actor(state, IDS.foe2).hp.maximum);

    const stunned = game("azer-sentinel");
    stunned.combat = { ...stunned.combat, turnActorId: IDS.foe };
    actor(stunned, IDS.foe).conditions = [{ id: "stunned" }];
    advance(stunned, [6], near);
    expect(actor(stunned, IDS.hero).hp.current).toBe(30);
  });

  it("sets what a fire elemental's aura burns alight", () => {
    const state = game("fire-elemental");
    state.combat = { ...state.combat, turnActorId: IDS.foe };
    advance(state, [4], near);
    expect(actor(state, IDS.hero).hp.current).toBe(26);
    expect(actor(state, IDS.hero).effects.map((effect) => effect.name)).toEqual(["Burning"]);
  });

  it("tells the GM what a burning aura deals when the map can't measure", () => {
    const state = game("balor");
    state.combat = { ...state.combat, turnActorId: IDS.foe };
    const events = advance(state, [3, 4, 5]);
    expect(actor(state, IDS.hero).hp.current).toBe(30);
    expect(events).toContainEqual(
      expect.objectContaining({
        gmOnly: true,
        text: "Balor's Fire Aura: each creature within 5 feet takes 3d8 fire damage - the map can't measure, so apply it by hand."
      })
    );
  });

  it("pricks what a barbed devil grapples at the start of its turns", () => {
    const state = game("barbed-devil");
    actor(state, IDS.hero).effects = [
      {
        id: "grip",
        name: "Grappled by Barbed Devil",
        tags: ["grapple"],
        sourceActorId: IDS.foe,
        sourceName: "Barbed Devil",
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "manual" },
        endsWhenSourceDefeated: true,
        voidWhileIncapacitated: false,
        concentration: false,
        endsWithTag: null,
        modifiers: [],
        linkedConditionIds: ["grappled"],
        escapeDc: 15,
        onEnd: []
      }
    ];
    actor(state, IDS.hero).conditions = [{ id: "grappled" }];
    const events = advance(state, [7], near);
    expect(actor(state, IDS.hero).hp.current).toBe(23);
    expect(texts(events)).toContain("Hero takes 7 Piercing damage from Barbed Devil's Barbed Hide.");
    expect(actor(state, IDS.ally).hp.current).toBe(25);
  });
});

describe("Death Burst and Death Throes", () => {
  it("asks each creature within reach of a dying magmin for the save, with the damage rolled once", () => {
    const state = game("magmin", { foeHp: 4 });
    const positions: Positions = { [IDS.hero]: [0, 0], [IDS.foe]: [10, 0], [IDS.ally]: [25, 0] };
    const { events } = applyDamageDetailed(
      state,
      IDS.foe,
      { amount: 8, parts: [{ amount: 8, type: "slashing" }] },
      GM,
      { resolveDefinition, newId: nextId, now: NOW, rollDie: () => 4, distanceFeet: distanceBy(positions) }
    );
    expect(texts(events)).toContain("Magmin explodes (Death Burst): DC 11 DEX save for 1 creature within 10 feet.");
    expect(pendingOn(state, IDS.hero)).toEqual([
      expect.objectContaining({
        sourceActorId: IDS.foe,
        actionName: "Death Burst",
        ability: "dex",
        dc: 11,
        proposedDamage: 8,
        proposedDamageParts: [{ amount: 8, type: "fire" }],
        halfOnSuccess: true
      })
    ]);
    expect(pendingOn(state, IDS.ally)).toEqual([]);
  });

  it("rolls a balor's Fire and Force together", () => {
    const state = game("balor", { foeHp: 4 });
    applyDamageDetailed(state, IDS.foe, { amount: 8, parts: [{ amount: 8, type: "cold" }] }, GM, {
      resolveDefinition,
      newId: nextId,
      now: NOW,
      rollDie: () => 2,
      distanceFeet: distanceBy({ [IDS.hero]: [0, 0], [IDS.foe]: [25, 0] })
    });
    expect(pendingOn(state, IDS.hero)[0]?.proposedDamageParts).toEqual([
      { amount: 18, type: "fire" },
      { amount: 18, type: "force" }
    ]);
  });
});

describe("Berserk", () => {
  it("rolls a d6 when a golem starts its turn Bloodied, and a 6 sends it berserk until it isn't", () => {
    const calm = game("clay-golem", { foeHp: 50 });
    const stays = advance(calm, [5]);
    expect(actor(calm, IDS.foe).effects).toEqual([]);
    expect(stays).toContainEqual(expect.objectContaining({ gmOnly: true, text: expect.stringContaining("rolled 5") }));

    const state = game("clay-golem", { foeHp: 50 });
    const events = advance(state, [6]);
    expect(actor(state, IDS.foe).effects.map((effect) => effect.name)).toEqual(["Berserk"]);
    expect(texts(events)).toContain(
      "Clay Golem goes berserk (rolled 6) - it attacks the nearest creature it can see until it is no longer Bloodied."
    );
    actor(state, IDS.foe).hp.current = 100;
    for (let turn = 0; turn < 3; turn += 1) advance(state);
    expect(actor(state, IDS.foe).effects).toEqual([]);
  });
});

describe("Corrosive Form", () => {
  const SWORD: ActorAction = {
    id: "longsword",
    name: "Longsword",
    activation: "action",
    description: "Melee weapon attack.",
    attack: { bonus: 5, reachFeet: 5 },
    damage: [{ formula: "1d8 + 3", type: "slashing" }]
  };
  const BOW: ActorAction = {
    id: "longbow",
    name: "Longbow",
    activation: "action",
    description: "Ranged weapon attack.",
    attack: { bonus: 5, rangeFeet: 150 },
    damage: [{ formula: "1d8 + 3", type: "piercing" }]
  };

  it("burns the creature that hits a black pudding in melee, and not one that hits it from range", () => {
    const state = game("black-pudding");
    const resolution = heroUses(state, SWORD, [15, 4, 6]);
    expect(resolution.attack?.outcome).toBe("hit");
    // The sword's d8 rolled 4; the pudding's 1d8 Acid rolled 6.
    expect(actor(state, IDS.hero).hp.current).toBe(24);
    expect(resolution.tableNarration?.map((line) => line.text)).toContain(
      "Hero takes 6 damage from Black Pudding's Corrosive Form."
    );

    const ranged = game("black-pudding");
    heroUses(ranged, BOW, [15, 4, 6]);
    expect(actor(ranged, IDS.hero).hp.current).toBe(30);
  });
});
