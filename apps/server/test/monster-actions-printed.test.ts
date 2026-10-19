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
import { CommandRejectedError, RulesBlockedError } from "../src/game-store.js";
import { setInventoryItem } from "../src/inventory.js";

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
  actions: [
    {
      id: "dagger",
      name: "Dagger",
      activation: "action",
      description: "A stab.",
      attack: { bonus: 6, reachFeet: 5 },
      damage: [{ formula: "1d4", type: "piercing" }]
    }
  ],
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

describe("what a damage type does to a stat block", () => {
  const strike = (built: Table, amount: number, type: string) =>
    applyDamageDetailed(built.state, IDS.monster, { amount, parts: [{ amount, type }] }, GM, {
      resolveDefinition: resolveDefinition(built),
      newId: nextId,
      now: NOW,
      rollDie: () => 3
    });

  it("heals a clay golem by the Acid damage dealt, which its Immunity takes", () => {
    const built = table("clay-golem");
    strike(built, 10, "acid");
    expect(actor(built, IDS.monster).hp.current).toBe(70);
  });

  it("heals a flesh golem by Lightning, and gives it Disadvantage after Fire until the end of its next turn", () => {
    const built = table("flesh-golem");
    strike(built, 8, "lightning");
    expect(actor(built, IDS.monster).hp.current).toBe(68);
    strike(built, 5, "fire");
    expect(actor(built, IDS.monster).effects).toMatchObject([
      {
        name: "Aversion to Fire",
        duration: { type: "until-bearer-turn-end" },
        modifiers: [
          { type: "roll-mode", roll: "attack", mode: "disadvantage" },
          { type: "roll-mode", roll: "check", mode: "disadvantage" }
        ]
      }
    ]);
  });

  it("slows a water elemental by 20 feet after Cold damage", () => {
    const built = table("water-elemental");
    strike(built, 5, "cold");
    expect(actor(built, IDS.monster).effects).toMatchObject([
      { name: "Freeze", modifiers: [{ type: "speed", amount: -20 }] }
    ]);
  });
});

describe("a steam mephit's Blurred Form", () => {
  const stab = (built: Table) =>
    resolveDefinitionAction(
      built.state,
      heroDefinition.actions[0]!,
      { actorId: IDS.hero, targetIds: [IDS.monster], commandId: nextId() },
      {
        random: (sides) => Math.min(sides, 10),
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        definition: heroDefinition,
        resolveDefinition: resolveDefinition(built)
      }
    );

  it("gives attacks against it Disadvantage unless it is Incapacitated", () => {
    const built = table("steam-mephit");
    built.state.combat = { ...built.state.combat, turnActorId: IDS.hero };
    expect(stab(built).rollMode?.disadvantage).toContain("Blurred Form");
    actor(built, IDS.monster).conditions = [{ id: "incapacitated" }];
    built.state.combat = {
      ...built.state.combat,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    expect(stab(built).rollMode?.disadvantage ?? []).not.toContain("Blurred Form");
  });
});

describe("a will-o'-wisp's Ephemeral", () => {
  it("refuses anything given to the wisp to wear or carry", () => {
    const built = table("will-o-wisp");
    expect(() =>
      setInventoryItem(
        built.state,
        IDS.monster,
        { id: "rope", name: "Rope", quantity: 1, equipped: false, attuned: false } as never,
        resolveDefinition(built)
      )
    ).toThrow(CommandRejectedError);
  });
});

describe("a creature attached to another", () => {
  const fresh = (built: Table) => {
    built.state.combat = {
      ...built.state.combat,
      turnActorId: IDS.monster,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
  };

  it("keeps a stirge from using its Proboscis again while it is attached", () => {
    const built = table("stirge");
    use(built, "proboscis", IDS.hero, [15, 3, 3]);
    expect(actor(built, IDS.hero).effects[0]?.tags).toContain("source-no-repeat");
    fresh(built);
    expect(() => use(built, "proboscis", IDS.ally, [15, 3, 3])).toThrow(/can't use Proboscis while it is attached/);
  });

  it("lets a cloaker Attach only to the creature it holds", () => {
    const built = table("cloaker");
    use(built, "attach", IDS.hero, [15, 3, 3, 3]);
    fresh(built);
    expect(() => use(built, "attach", IDS.ally, [15, 3, 3, 3])).toThrow(/can use Attach only on Hero/);
  });

  it("lets a darkmantle attack only the creature it holds, with Advantage", () => {
    const built = table("darkmantle");
    use(built, "crush", IDS.hero, [15, 3]);
    fresh(built);
    expect(() => use(built, "crush", IDS.ally, [15, 3])).toThrow(/can attack only Hero/);
    const again = use(built, "crush", IDS.hero, [15, 3, 3]);
    expect(again.rollMode?.advantage).toContain("Darkmantle attached to Hero");
  });
});

describe("a swarm", () => {
  it("regains no Hit Points from healing", () => {
    const built = table("swarm-of-rats");
    const heal = {
      id: "cure",
      name: "Cure",
      activation: "action",
      description: "A heal.",
      damage: [],
      healing: { formula: "2d8" }
    } as never;
    const before = actor(built, IDS.monster).hp.current;
    built.state.combat = { ...built.state.combat, turnActorId: IDS.hero };
    const healed = resolveDefinitionAction(
      built.state,
      heal,
      { actorId: IDS.hero, targetIds: [IDS.monster], commandId: nextId() },
      {
        random: () => 4,
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        definition: heroDefinition,
        resolveDefinition: resolveDefinition(built)
      }
    );
    expect(actor(built, IDS.monster).hp.current).toBe(before);
    expect(healed.tableNarration?.map((line) => line.text)).toContain(
      "Swarm of Rats is a swarm and can't regain Hit Points or gain Temporary Hit Points."
    );
  });
});

describe("a sphinx of valor's Roar", () => {
  const roar = (built: Table, step: string) => use(built, `roar-${step}-roar`, IDS.hero);
  const fresh = (built: Table) => {
    built.state.combat = {
      ...built.state.combat,
      turnActorId: IDS.monster,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
  };

  it("roars in its printed order, each roar its own magical save", () => {
    const built = table("sphinx-of-valor");
    expect(() => roar(built, "second")).toThrow(/comes as use 2 of 3, and Sphinx of Valor has spent 0/);
    roar(built, "first");
    expect(built.state.combat.pendingSaves).toMatchObject([{ ability: "wis", dc: 20, magical: true }]);
    answer(built, 5);
    expect(actor(built, IDS.hero).conditions.map((condition) => condition.id)).toEqual(["frightened"]);
    fresh(built);
    expect(() => roar(built, "third")).toThrow(RulesBlockedError);
    roar(built, "second");
    answer(built, 5);
    expect(actor(built, IDS.hero).conditions.map((condition) => condition.id)).toContain("paralyzed");
  });

  it("takes the next roar in its Multiattack's place for Roar", () => {
    const built = table("sphinx-of-valor");
    use(built, "multiattack", IDS.hero);
    use(built, "claw", IDS.hero, [15, 3, 3, 3, 3]);
    use(built, "claw", IDS.hero, [15, 3, 3, 3, 3]);
    roar(built, "first");
    expect(actor(built, IDS.monster).actionUses).toEqual({ roar: 1 });
  });
});

describe("a water elemental's Whelm", () => {
  it("holds one Large creature or two smaller ones, and a Huge one takes the damage alone", () => {
    const built = table("water-elemental");
    actor(built, IDS.hero).size = "large";
    actor(built, IDS.ally).size = "huge";
    use(built, "whelm", IDS.hero, [], { targetIds: [IDS.hero, IDS.ally] });
    answer(built, 5);
    const ally = built.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.ally)!;
    answerSave(built.state, nextId(), ally.id, "manual", 5, true, GM, {
      random: () => 3,
      newRollId: nextId,
      sessionId: IDS.gm,
      role: "gm",
      now: NOW,
      resolveDefinition: resolveDefinition(built)
    });
    expect(actor(built, IDS.hero).conditions.map((condition) => condition.id)).toEqual(["grappled", "restrained"]);
    expect(actor(built, IDS.ally).conditions).toEqual([]);
    expect(actor(built, IDS.ally).hp.current).toBeLessThan(50);
    // The Large creature fills its hold.
    actor(built, IDS.ally).size = "medium";
    actor(built, IDS.monster).actionUses = {};
    built.state.combat = {
      ...built.state.combat,
      turnActorId: IDS.monster,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    expect(() => use(built, "whelm", IDS.ally)).toThrow(
      /can hold only 2 creatures with Whelm \(Recharge 4-6\) at a time/
    );
  });
});

describe("leaving the plane and coming back", () => {
  const fresh = (built: Table) => {
    built.state.combat = {
      ...built.state.combat,
      turnActorId: IDS.monster,
      turn: { ...built.state.combat.turn, actionUsed: false, bonusActionUsed: false, actionInstance: null }
    };
  };

  it("sends a phase spider to the Ethereal Plane, and back with the next Ethereal Jaunt", () => {
    const built = table("phase-spider");
    use(built, "ethereal-jaunt", IDS.monster);
    expect(actor(built, IDS.monster).effects).toMatchObject([{ name: "Ethereal", tags: ["off-plane"] }]);
    fresh(built);
    use(built, "ethereal-jaunt", IDS.monster);
    expect(actor(built, IDS.monster).effects).toEqual([]);
  });

  it("takes a nightmare and the creatures beside it to the Ethereal Plane together", () => {
    const built = table("nightmare");
    use(built, "ethereal-stride", IDS.monster, [], { targetIds: [IDS.monster, IDS.hero] });
    for (const id of [IDS.monster, IDS.hero])
      expect(actor(built, id).effects.map((effect) => effect.tags)).toEqual([["off-plane"]]);
  });
});

describe("a balor's Teleport", () => {
  it("teleports the balor, or a demon within 10 feet of it instead", () => {
    const built = table("balor");
    expect(() => use(built, "teleport", IDS.ally)).toThrow(/targets a demon, and Ally isn't one/);
    const vrock = MONSTERS.find((monster) => monster.source.externalId === "vrock")!;
    built.state.definitions.push({ id: "vrock-def", definition: vrock });
    actor(built, IDS.ally).definitionId = "vrock-def";
    use(built, "teleport", IDS.ally);
    expect(activeTeleportGrant(built.state, actor(built, IDS.ally))).toMatchObject({ feet: 60 });
    expect(activeTeleportGrant(built.state, actor(built, IDS.monster))).toBeNull();
  });
});
