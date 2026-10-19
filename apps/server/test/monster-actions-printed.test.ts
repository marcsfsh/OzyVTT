import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { addEffect, CONCENTRATING_TAG, makeEffect } from "../src/effects.js";
import { activeMoveGrant, activeTeleportGrant } from "../src/granted-moves.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { answerSave } from "../src/saving-throws.js";
import { RulesBlockedError } from "../src/game-store.js";

// Stat block actions that give, protect, kill or knock out as their SRD 5.2.1 text says: a frost giant's War Cry, a
// unicorn's Shimmering Shield, a will-o'-wisp's Consume Life, an incubus's Nightmare and an invisible stalker's Vortex.

const MONSTERS = loadMonsterDefinitions();
const IDS = {
  monster: "10000000-0000-4000-8000-000000000701",
  hero: "10000000-0000-4000-8000-000000000702",
  ally: "10000000-0000-4000-8000-000000000703",
  map: "20000000-0000-5000-8000-000000000701",
  gm: "30000000-0000-4000-8000-00000000070a"
};
const GM = { role: "gm" } as const;

const heroDefinition = {
  name: "Hero",
  armorClass: 12,
  proficiencyBonus: 2,
  abilityScores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 120 },
  actions: [],
  extensions: {}
} as unknown as ActorDefinition;

/** The monster `slug` on its turn, then the hero, then the hero's ally. */
function table(slug: string, heroHp = 120) {
  const definition = MONSTERS.find((monster) => monster.source.externalId === slug)!;
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    definitions: [{ id: "monster-def", definition }],
    actors: [
      {
        id: IDS.monster,
        name: definition.name,
        kind: "monster",
        hp: { current: 60, maximum: 100 },
        armorClass: 15,
        speedFeet: 30,
        definitionId: "monster-def"
      },
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        hp: { current: heroHp, maximum: 120 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: "hero-def"
      },
      {
        id: IDS.ally,
        name: "Ally",
        kind: "monster",
        hp: { current: 50, maximum: 50 },
        armorClass: 12,
        speedFeet: 30,
        definitionId: "hero-def"
      }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.monster, score: 20 },
        { actorId: IDS.hero, score: 15 },
        { actorId: IDS.ally, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  return { state, definition };
}
type Table = ReturnType<typeof table>;

let command = 0;
const nextId = () => `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`;
const NOW = () => "2026-10-19T00:00:00.000Z";
const resolveDefinition = (built: Table) => (id: string) =>
  id === "hero-def" ? heroDefinition : built.state.definitions.find((entry) => entry.id === id)?.definition;
const actor = (built: Table, id: string) => built.state.actors.find((candidate) => candidate.id === id)!;

/** The monster uses `actionId` on `targetId` (or on `targetIds`, its move first, or the rest owed after it). */
function use(
  built: Table,
  actionId: string,
  targetId: string,
  faces: number[] = [],
  input: Readonly<{ targetIds?: string[]; moveFirst?: true; owedPaid?: true }> = {}
) {
  const action = built.definition.actions.find((entry) => entry.id === actionId);
  if (!action) throw new Error(`${built.definition.name} has no ${actionId}`);
  const { targetIds = [targetId], ...rest } = input;
  return resolveDefinitionAction(
    built.state,
    action,
    { actorId: IDS.monster, targetIds, commandId: nextId(), ...rest },
    {
      random: () => faces.shift() ?? 3,
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      definition: built.definition,
      resolveDefinition: resolveDefinition(built)
    }
  );
}
/** The hero's open save, answered with a typed total. */
function answer(built: Table, total: number, faces: number[] = []) {
  const pending = built.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.hero);
  if (!pending) throw new Error("The hero owes no save.");
  return answerSave(built.state, nextId(), pending.id, "manual", total, true, GM, {
    random: () => faces.shift() ?? 3,
    newRollId: nextId,
    sessionId: IDS.gm,
    role: "gm",
    now: NOW,
    resolveDefinition: resolveDefinition(built)
  });
}
/** A legendary action comes right after another creature's turn ends. */
const legendaryWindow = (built: Table) => {
  built.state.combat = {
    ...built.state.combat,
    turnActorId: IDS.ally,
    turn: { ...built.state.combat.turn, afterActorId: IDS.hero }
  };
};

describe("actions that strengthen a creature", () => {
  it("gives a frost giant's War Cry target Temporary Hit Points and Advantage on attacks until the giant's next turn", () => {
    const built = table("frost-giant");
    use(built, "war-cry-recharge-5-6", IDS.ally, [5, 5]);
    const ally = actor(built, IDS.ally);
    // 2d10 + 5 with two 5s.
    expect(ally.hp.temporary).toBe(15);
    expect(ally.effects).toMatchObject([
      {
        name: "War Cry",
        duration: { type: "until-source-next-turn" },
        modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage" }]
      }
    ]);
    expect(actor(built, IDS.monster).actionUses).toEqual({ "war-cry-recharge-5-6": 1 });
  });

  it("gives a unicorn's Shimmering Shield target Temporary Hit Points and +2 AC until the end of its next turn", () => {
    const built = table("unicorn");
    legendaryWindow(built);
    use(built, "shimmering-shield", IDS.ally, [4, 4, 4]);
    const ally = actor(built, IDS.ally);
    expect(ally.hp.temporary).toBe(12);
    expect(ally.effects).toMatchObject([
      { name: "Shimmering Shield", duration: { type: "until-source-turn-end" }, armorClassBonus: 2 }
    ]);
  });
});

describe("a will-o'-wisp's Consume Life", () => {
  it("targets only a creature at 0 Hit Points, and ends the wisp's Vanish", () => {
    const built = table("will-o-wisp");
    expect(() => use(built, "consume-life", IDS.hero)).toThrow(RulesBlockedError);
    use(built, "vanish", IDS.monster);
    expect(actor(built, IDS.monster).conditions.map((condition) => condition.id)).toEqual(["invisible"]);
    actor(built, IDS.hero).hp = { ...actor(built, IDS.hero).hp, current: 0 };
    built.state.combat = {
      ...built.state.combat,
      turn: { ...built.state.combat.turn, bonusActionUsed: false }
    };
    use(built, "consume-life", IDS.hero);
    expect(built.state.combat.pendingSaves).toMatchObject([{ targetActorId: IDS.hero, ability: "con", dc: 10 }]);
    expect(actor(built, IDS.monster).conditions).toEqual([]);
  });
});

describe("an incubus's Nightmare", () => {
  it("knocks a target at 20 Hit Points or fewer Unconscious for an hour, until damage wakes it", () => {
    const built = table("incubus", 20);
    use(built, "nightmare-recharge-6", IDS.hero);
    answer(built, 5);
    const hero = actor(built, IDS.hero);
    expect(hero.hp.current).toBe(20);
    expect(hero.conditions.map((condition) => condition.id)).toContain("unconscious");
    expect(hero.effects).toMatchObject([
      { duration: { type: "minutes", remaining: 60 }, endsOnDamage: true, endedBy: { name: "Wake", by: "others" } }
    ]);
    applyDamageDetailed(built.state, IDS.hero, { amount: 1, parts: [{ amount: 1, type: "fire" }] }, GM, {
      resolveDefinition: resolveDefinition(built),
      newId: nextId,
      now: NOW,
      rollDie: () => 3
    });
    expect(actor(built, IDS.hero).conditions.map((condition) => condition.id)).not.toContain("unconscious");
  });

  it("deals 4d8 Psychic damage to a target with more Hit Points", () => {
    const built = table("incubus", 100);
    use(built, "nightmare-recharge-6", IDS.hero, [4, 4, 4, 4]);
    answer(built, 5);
    const hero = actor(built, IDS.hero);
    expect(hero.hp.current).toBe(84);
    expect(hero.conditions).toEqual([]);
  });
});

describe("an invisible stalker's Vortex", () => {
  it("keeps the grappled target from casting spells with a Verbal component", () => {
    const built = table("invisible-stalker");
    use(built, "vortex", IDS.hero);
    answer(built, 5);
    const hero = actor(built, IDS.hero);
    expect(hero.conditions.map((condition) => condition.id)).toEqual(["grappled"]);
    expect(hero.effects.flatMap((effect) => effect.tags)).toContain("cant-speak");
  });
});

describe("a clay golem's Multiattack", () => {
  const slams = (built: Table, count: number) => {
    for (let swing = 0; swing < count; swing++) use(built, "slam", IDS.hero, [15, 3, 3]);
  };

  it("makes two Slams, and three on a turn it used Hasten", () => {
    const calm = table("clay-golem");
    use(calm, "multiattack", IDS.hero);
    slams(calm, 2);
    expect(() => use(calm, "slam", IDS.hero, [15, 3, 3])).toThrow(RulesBlockedError);

    const hasty = table("clay-golem");
    use(hasty, "hasten-recharge-5-6", IDS.monster);
    use(hasty, "multiattack", IDS.hero);
    slams(hasty, 3);
    expect(() => use(hasty, "slam", IDS.hero, [15, 3, 3])).toThrow(RulesBlockedError);
  });

  it("opens the three Slams when the first Slam starts the Multiattack after Hasten", () => {
    const built = table("clay-golem");
    use(built, "hasten-recharge-5-6", IDS.monster);
    slams(built, 3);
    expect(built.state.combat.turn.actionInstance?.components).toEqual({ slam: 0 });
  });
});

describe("actions that make one attack, or one of two", () => {
  it("offers a mummy lord's Necrotic Strike as either attack, each spending the legendary use", () => {
    const built = table("mummy-lord");
    legendaryWindow(built);
    const strike = use(built, "necrotic-strike-rotting-fist", IDS.hero, [15, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(strike.attack?.outcome).toBe("hit");
    expect(built.state.combat.legendaryUsed[IDS.monster]).toBe(1);
    expect(
      built.definition.actions.find((action) => action.id === "necrotic-strike-channel-negative-energy")
    ).toMatchObject({
      partOf: "necrotic-strike",
      attack: { bonus: 9, rangeFeet: 60 }
    });
  });

  it("offers a gnoll's Rampage only right after it damages a creature that was already Bloodied", () => {
    const built = table("gnoll-warrior", 100);
    expect(() => use(built, "rampage-1-day", IDS.hero, [], { moveFirst: true })).toThrow(RulesBlockedError);
    // Damage on a creature above half its Hit Points doesn't open it; on one at half or fewer, it does.
    const damage = (amount: number) =>
      applyDamageDetailed(
        built.state,
        IDS.hero,
        { amount, parts: [{ amount, type: "slashing" }], sourceActorId: IDS.monster },
        GM,
        { resolveDefinition: resolveDefinition(built), newId: nextId, now: NOW, rollDie: () => 3 }
      );
    damage(45);
    expect(() => use(built, "rampage-1-day", IDS.hero, [], { moveFirst: true })).toThrow(RulesBlockedError);
    damage(5);
    use(built, "rampage-1-day", IDS.hero, [], { moveFirst: true });
    expect(activeMoveGrant(built.state, actor(built, IDS.monster))).toMatchObject({ owedActionId: "rampage-1-day" });
    const rend = use(built, "rampage-1-day", IDS.hero, [15, 3, 3], { owedPaid: true });
    expect(rend.attack?.outcome).toBe("hit");
  });
});

describe("legendary actions that strike an area", () => {
  it("shakes the ground after a tarrasque's move: Concentration ends, and Medium or smaller creatures fall Prone", () => {
    const built = table("tarrasque");
    actor(built, IDS.ally).size = "huge";
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({
        id: "focus",
        name: "Concentrating",
        tags: [CONCENTRATING_TAG],
        sourceActorId: IDS.hero,
        duration: { type: "manual" },
        concentration: true
      })
    );
    legendaryWindow(built);
    use(built, "world-shaking-movement", IDS.hero, [], { targetIds: [], moveFirst: true });
    expect(activeMoveGrant(built.state, actor(built, IDS.monster))).toMatchObject({ feet: expect.any(Number) });
    use(built, "world-shaking-movement", IDS.hero, [], { targetIds: [IDS.hero, IDS.ally], owedPaid: true });
    expect(actor(built, IDS.hero).conditions.map((condition) => condition.id)).toEqual(["prone"]);
    expect(actor(built, IDS.hero).effects).toEqual([]);
    expect(actor(built, IDS.ally).conditions).toEqual([]);
  });

  it("burns those beside the space a lich leaves with Necrotic damage, and gives it the teleport", () => {
    const built = table("lich");
    legendaryWindow(built);
    const left = use(built, "deathly-teleport", IDS.hero, [5, 5], { targetIds: [IDS.hero, IDS.ally] });
    expect(left.damageTargets?.map((target) => [target.targetId, target.total])).toEqual([
      [IDS.hero, 10],
      [IDS.ally, 10]
    ]);
    expect(activeTeleportGrant(built.state, actor(built, IDS.monster))).toMatchObject({ feet: 60 });
  });
});
