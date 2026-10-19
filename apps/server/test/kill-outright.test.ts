import { describe, expect, it } from "vitest";
import { GameStateSchema, isDead, type GameState } from "@vtt/domain";
import { ActorSchema, type ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { keepDeathRecords } from "../src/death.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { riseAtTurnStart } from "../src/risen.js";
import { answerSave } from "../src/saving-throws.js";
import { FOE, HERO } from "./spell-casters.js";
import { actorOf, answer, cast, caster } from "./spell-lifetimes-kit.js";

// SRD 5.2.1, the rules that kill outright. Disintegrate: "If this damage reduces it to 0 Hit Points, it ... [is]
// disintegrated into gray dust. The target can be revived only by a True Resurrection or a Wish spell." Power Word
// Kill: "If the target has 100 Hit Points or fewer, it dies. Otherwise, it takes 12d12 Psychic damage." Death Ward:
// "an effect that would kill it instantly without dealing damage ... is negated against the target, and the spell
// ends." Divine Word's table by Hit Points, a solar's Slaying Bow, a sea hag's Death Glare, a gibbering mouther's Bite
// and a mummy's Rotting Fist ("dies ... if reduced to 0 Hit Points by this attack"), and Finger of Death's Zombie.

const MONSTERS = loadMonsterDefinitions();
const monster = (slug: string) => MONSTERS.find((entry) => entry.source.externalId === slug)!;
const VICTIM = "10000000-0000-4000-8000-0000000000b1";

/** A second character in the Wizard's fight, at `current` of 120 Hit Points. */
function victim(state: GameState, current: number): GameState["actors"][number] {
  state.actors.push(
    ActorSchema.parse({
      id: VICTIM,
      name: "Wren",
      kind: "player-character",
      visibility: "public",
      hp: { current, maximum: 120 }
    })
  );
  state.combat.initiative.push({ actorId: VICTIM, score: 1, tieBreaker: 0 });
  return actorOf(state, VICTIM);
}

const deathWard = (state: GameState, actorId: string) =>
  addEffect(
    state,
    actorId,
    makeEffect({ id: `${actorId}:ward`, name: "Death Ward", tags: ["death-ward"], duration: { type: "manual" } })
  );

describe("Disintegrate", () => {
  it("kills a character it drops to 0 with no death saves, and leaves nothing to revive", () => {
    const table = caster();
    const wren = victim(table.state, 12);
    cast(table, "disintegrate", { targetIds: [VICTIM] });
    answer(table.state, VICTIM, 1);
    expect(wren.hp.current).toBe(0);
    expect(wren.deathSaves).toMatchObject({ failures: 3 });
    expect(isDead(wren)).toBe(true);
    expect(wren.death).toMatchObject({ cause: "Disintegrate", bodyGone: true });
  });

  it("leaves a warded creature at 1 Hit Point", () => {
    const table = caster();
    const wren = victim(table.state, 12);
    deathWard(table.state, VICTIM);
    cast(table, "disintegrate", { targetIds: [VICTIM] });
    answer(table.state, VICTIM, 1);
    expect(wren.hp.current).toBe(1);
    expect(wren.effects).toEqual([]);
  });
});

describe("Power Word Kill", () => {
  it("kills a creature with 100 Hit Points or fewer and deals it no damage", () => {
    const table = caster();
    actorOf(table.state, FOE).hp.current = 90;
    const result = cast(table, "power-word-kill", { targetIds: [FOE] });
    expect(isDead(actorOf(table.state, FOE))).toBe(true);
    expect(result.damageTargets).toBeUndefined();
    expect(result.tableNarration?.map((line) => line.text)).toContain("Goblin dies (Power Word Kill).");
  });

  it("deals 12d12 Psychic damage to a creature with more", () => {
    const table = caster();
    actorOf(table.state, FOE).hp.current = 150;
    const result = cast(table, "power-word-kill", { targetIds: [FOE] });
    expect(isDead(actorOf(table.state, FOE))).toBe(false);
    expect(result.damageTargets).toMatchObject([{ targetId: FOE, total: 36, parts: [{ type: "psychic" }] }]);
  });

  it("is negated by Death Ward, which ends", () => {
    const table = caster();
    const wren = victim(table.state, 80);
    deathWard(table.state, VICTIM);
    const result = cast(table, "power-word-kill", { targetIds: [VICTIM] });
    expect(wren.hp.current).toBe(80);
    expect(wren.effects).toEqual([]);
    expect(result.damageTargets).toBeUndefined();
    expect(result.tableNarration?.map((line) => line.text)).toContain(
      "Death Ward turns Power Word Kill aside from Wren."
    );
  });
});

describe("Divine Word", () => {
  const ids = ["10000000-0000-4000-8000-0000000000c1", "10000000-0000-4000-8000-0000000000c2"];
  const at = (state: GameState, id: string, name: string, current: number, slug?: string) => {
    if (slug) {
      importActorDefinition(state, monster(slug), id, "public");
      const created = actorOf(state, id);
      created.name = name;
      created.hp = { ...created.hp, current, maximum: Math.max(current, created.hp.maximum) };
    } else
      state.actors.push(
        ActorSchema.parse({
          id,
          name,
          kind: "npc",
          visibility: "public",
          hp: { current, maximum: 60 }
        })
      );
    state.combat.initiative.push({ actorId: id, score: 1, tieBreaker: 0 });
  };

  it("does what the table says to each creature that fails, by its Hit Points", () => {
    const table = caster();
    const bands = [
      ["10000000-0000-4000-8000-0000000000d1", 15],
      ["10000000-0000-4000-8000-0000000000d2", 25],
      ["10000000-0000-4000-8000-0000000000d3", 35],
      ["10000000-0000-4000-8000-0000000000d4", 45]
    ] as const;
    for (const [id, hp] of bands) at(table.state, id, `Cultist ${hp}`, hp);
    cast(table, "divine-word", { targetIds: bands.map(([id]) => id) });
    for (const [id] of bands) answer(table.state, id, 1);
    expect(isDead(actorOf(table.state, bands[0][0]))).toBe(true);
    expect(actorOf(table.state, bands[1][0]).effects).toMatchObject([
      { linkedConditionIds: ["blinded", "deafened", "stunned"], duration: { type: "minutes", remaining: 60 } }
    ]);
    expect(actorOf(table.state, bands[2][0]).effects).toMatchObject([
      { linkedConditionIds: ["blinded", "deafened"], duration: { type: "rounds", remaining: 100 } }
    ]);
    expect(actorOf(table.state, bands[3][0]).effects).toMatchObject([
      { linkedConditionIds: ["deafened"], duration: { type: "rounds", remaining: 10 } }
    ]);
  });

  it("sends a Fiend that fails home for 24 hours whatever its Hit Points, and leaves a sturdy Humanoid alone", () => {
    const table = caster();
    at(table.state, ids[0]!, "Imp", 60, "imp");
    at(table.state, ids[1]!, "Veteran", 60);
    cast(table, "divine-word", { targetIds: ids });
    for (const id of ids) answer(table.state, id, 1);
    expect(actorOf(table.state, ids[0]!).effects).toMatchObject([
      { name: "Sent home (Divine Word)", tags: ["off-plane"], duration: { type: "minutes", remaining: 1440 } }
    ]);
    expect(actorOf(table.state, ids[1]!).effects).toEqual([]);
    expect(actorOf(table.state, ids[1]!).hp.current).toBe(60);
  });
});

describe("Finger of Death", () => {
  it("raises a Humanoid it kills as a Zombie on the caster's side at the start of the caster's next turn", () => {
    const table = caster();
    const bandit = "10000000-0000-4000-8000-0000000000e1";
    importActorDefinition(table.state, monster("bandit"), bandit, "public");
    table.state.definitions.push({ id: "zombie", definition: monster("zombie") });
    table.state.combat.initiative.push({ actorId: bandit, score: 5, tieBreaker: 0 });
    table.state.combat.tokens.push({
      actorId: bandit,
      position: { x: 225, y: 125 },
      sizePx: 50,
      gridSizePx: null,
      gridRotationRadians: null,
      sizeCells: 1
    });
    cast(table, "finger-of-death", { targetIds: [bandit] });
    const events = answer(table.state, bandit, 1).events.map((event) => event.text);
    expect(isDead(actorOf(table.state, bandit))).toBe(true);
    expect(events).toContain("Bandit will rise as a zombie at the start of Ansel's next turn.");
    const resolveDefinition = (id: string) => table.state.definitions.find((entry) => entry.id === id)?.definition;
    const risen = riseAtTurnStart(table.state, HERO, { resolveDefinition, newId: () => crypto.randomUUID() });
    expect(risen.map((event) => event.text)).toContain("Bandit rises as Zombie, which follows Ansel's orders.");
    const zombie = table.state.actors.find((actor) => actor.name === "Zombie")!;
    expect(table.state.combat.initiative.map((entry) => entry.actorId)).not.toContain(bandit);
    const order = table.state.combat.initiative.map((entry) => entry.actorId);
    expect(order.indexOf(zombie.id)).toBe(order.indexOf(HERO) + 1);
    expect(table.state.combat.tokens.find((token) => token.actorId === zombie.id)?.position).toEqual({
      x: 225,
      y: 125
    });
    // A friendly copy of the stat block puts it on the party's side.
    expect(resolveDefinition(zombie.definitionId!)?.token.disposition).toBe("friendly");
  });

  it("leaves a creature of another type dead where it fell", () => {
    const table = caster();
    actorOf(table.state, FOE).hp.current = 10;
    cast(table, "finger-of-death", { targetIds: [FOE] });
    answer(table.state, FOE, 1);
    expect(isDead(actorOf(table.state, FOE))).toBe(true);
    expect(actorOf(table.state, FOE).effects).toEqual([]);
  });
});

/** A monster `slug` on its turn against a character at `current` of `maximum` Hit Points. */
function arena(slug: string, current: number, maximum = 300) {
  const definition = monster(slug);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: MONSTER,
        name: definition.name,
        kind: "monster",
        visibility: "public",
        hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum },
        armorClass: 15,
        definitionId: "monster-def"
      },
      {
        id: PC,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current, maximum },
        armorClass: 12
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000b01",
      entries: [
        { actorId: MONSTER, score: 20 },
        { actorId: PC, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { state, definition, hero: actorOf(state, PC), creature: actorOf(state, MONSTER) };
}
const MONSTER = "10000000-0000-4000-8000-0000000000f1";
const PC = "10000000-0000-4000-8000-0000000000f2";
const resolveIn = (state: GameState) => (id: string) =>
  state.definitions.find((entry) => entry.id === id)?.definition ?? monster(id);

/** The monster's action at the hero, then the hero's save with its d20 on `face`. */
function useAndFail(built: ReturnType<typeof arena>, actionId: string, face = 1) {
  const action = built.definition.actions.find((entry) => entry.id === actionId)!;
  resolveDefinitionAction(
    built.state,
    action,
    { actorId: MONSTER, targetIds: [PC], commandId: crypto.randomUUID() },
    {
      random: () => 3,
      newRollId: () => crypto.randomUUID(),
      gmSessionId: "30000000-0000-4000-8000-0000000000b0",
      now: () => "2026-10-19T00:00:00.000Z",
      definition: built.definition as ActorDefinition,
      resolveDefinition: resolveIn(built.state)
    }
  );
  const pending = built.state.combat.pendingSaves.find((entry) => entry.targetActorId === PC)!;
  return answerSave(
    built.state,
    crypto.randomUUID(),
    pending.id,
    "roll",
    undefined,
    true,
    { role: "gm" },
    {
      random: () => face,
      newRollId: () => crypto.randomUUID(),
      sessionId: "30000000-0000-4000-8000-0000000000b0",
      role: "gm",
      now: () => "2026-10-19T00:00:00.000Z",
      resolveDefinition: resolveIn(built.state)
    }
  );
}

describe("a solar's Slaying Bow", () => {
  it("kills a creature with 100 Hit Points or fewer that fails, with no death saves", () => {
    const built = arena("solar", 90);
    useAndFail(built, "slaying-bow");
    expect(built.hero.hp.current).toBe(0);
    expect(built.hero.deathSaves).toMatchObject({ failures: 3 });
    expect(built.hero.death?.cause).toBe("Slaying Bow");
  });

  it("deals 4d8 + 6 Piercing and 8d8 Radiant to a creature with more", () => {
    const built = arena("solar", 150);
    useAndFail(built, "slaying-bow");
    expect(built.hero.hp.current).toBe(150 - 18 - 24);
  });
});

describe("a sea hag's Death Glare", () => {
  const frightened = (built: ReturnType<typeof arena>) => built.hero.conditions.push({ id: "frightened" });

  it("drops a Frightened creature with 20 Hit Points or fewer that fails to 0, dying", () => {
    const built = arena("sea-hag", 15);
    frightened(built);
    useAndFail(built, "death-glare");
    expect(built.hero.hp.current).toBe(0);
    expect(built.hero.deathSaves).toEqual({ successes: 0, failures: 0, stable: false });
  });

  it("deals 3d8 Psychic damage to one with more", () => {
    const built = arena("sea-hag", 40);
    frightened(built);
    useAndFail(built, "death-glare");
    expect(built.hero.hp.current).toBe(31);
  });
});

/** Damage from the monster's action landing on the hero, as the GM's Apply lands it. */
function land(built: ReturnType<typeof arena>, actionId: string, parts: Array<{ amount: number; type: string }>) {
  const action = built.definition.actions.find((entry) => entry.id === actionId)!;
  return applyDamageDetailed(
    built.state,
    PC,
    {
      amount: 0,
      parts,
      sourceActorId: MONSTER,
      sourceName: built.definition.name,
      ...(action.drain ? { drain: action.drain } : {})
    },
    { role: "gm" },
    { resolveDefinition: resolveIn(built.state), newId: () => crypto.randomUUID(), rollDie: () => 3 }
  );
}

describe("a hit that kills at 0", () => {
  it("kills a character a gibbering mouther's Bite drops to 0, its body absorbed", () => {
    const built = arena("gibbering-mouther", 5);
    const outcome = land(built, "bite", [{ amount: 7, type: "piercing" }]);
    expect(outcome.application.instantDeath).toBe(true);
    expect(isDead(built.hero)).toBe(true);
    expect(built.hero.death).toMatchObject({ cause: "Bite", bodyGone: true });
    expect(outcome.events.map((event) => event.text)).toContain("Hero dies (Bite).");
  });

  it("turns to dust a character a mummy's Rotting Fist drops to 0, and only drops one already dying", () => {
    const built = arena("mummy", 8);
    land(built, "rotting-fist", [{ amount: 10, type: "bludgeoning" }]);
    expect(isDead(built.hero)).toBe(true);
    expect(built.hero.death).toMatchObject({ cause: "Rotting Fist", bodyGone: true });
  });

  it("leaves a character with the hit points to spare standing", () => {
    const built = arena("mummy", 30);
    land(built, "rotting-fist", [{ amount: 10, type: "bludgeoning" }]);
    expect(built.hero.hp.current).toBe(20);
    expect(built.hero.death).toBeUndefined();
  });
});

describe("a wraith's Create Specter", () => {
  /** The wraith on its turn beside a dead bandit that died in round `diedIn`; it is round `now`. */
  function wraithAndCorpse(diedIn: number, now: number) {
    const built = arena("wraith", 40);
    const corpse = "10000000-0000-4000-8000-0000000000f3";
    importActorDefinition(built.state, monster("bandit"), corpse, "public");
    built.state.combat.initiative.push({ actorId: corpse, score: 5, tieBreaker: 0 });
    const bandit = actorOf(built.state, corpse);
    built.state.combat.round = diedIn;
    bandit.hp = { ...bandit.hp, current: 0 };
    keepDeathRecords(built.state, structuredClone({ ...built.state, actors: [] }));
    built.state.combat.round = now;
    const raise = () =>
      resolveDefinitionAction(
        built.state,
        built.definition.actions.find((entry) => entry.id === "create-specter")!,
        { actorId: MONSTER, targetIds: [corpse], commandId: crypto.randomUUID() },
        {
          random: () => 3,
          newRollId: () => crypto.randomUUID(),
          gmSessionId: "30000000-0000-4000-8000-0000000000b0",
          now: () => "2026-10-19T00:00:00.000Z",
          definition: built.definition as ActorDefinition,
          resolveDefinition: resolveIn(built.state)
        }
      );
    return { ...built, corpse, raise };
  }

  it("raises a Humanoid dead within the minute as a Specter on the wraith's side, acting after it", () => {
    const built = wraithAndCorpse(1, 4);
    const result = built.raise();
    const specter = built.state.actors.find((actor) => actor.name === "Specter")!;
    expect(result.tableNarration?.map((line) => line.text)).toContain(
      "Bandit's spirit rises as Specter, under Wraith's control."
    );
    const order = built.state.combat.initiative.map((entry) => entry.actorId);
    expect(order).toEqual([MONSTER, specter.id, PC]);
    expect(specter.definitionId).toBe("specter");
  });

  it("is refused for a corpse dead longer than a minute, and past seven specters", () => {
    expect(() => wraithAndCorpse(1, 13).raise()).toThrowError(
      /Bandit died 12 rounds ago, and Create Specter raises a corpse dead no longer than 1 minute/
    );
    const crowded = wraithAndCorpse(1, 2);
    for (let index = 0; index < 7; index += 1)
      crowded.state.actors.push(
        ActorSchema.parse({
          id: `10000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
          name: `Specter ${index + 1}`,
          kind: "monster",
          hp: { current: 22, maximum: 22 },
          definitionId: "specter",
          effects: [
            makeEffect({
              id: `raised-${index}`,
              name: "Under Wraith's control",
              tags: ["raised"],
              sourceActorId: MONSTER,
              duration: { type: "manual" }
            })
          ]
        })
      );
    expect(() => crowded.raise()).toThrowError(/Wraith already controls 7 raised by Create Specter/);
  });
});

describe("massive damage", () => {
  it("kills a character outright when what carries over past 0 reaches its Hit Point maximum", () => {
    const built = arena("mummy", 5, 20);
    const outcome = applyDamageDetailed(
      built.state,
      PC,
      { amount: 25, parts: [{ amount: 25, type: "slashing" }] },
      { role: "gm" },
      { resolveDefinition: resolveIn(built.state) }
    );
    expect(outcome.application.instantDeath).toBe(true);
    expect(built.hero.deathSaves).toMatchObject({ failures: 3 });
  });
});
