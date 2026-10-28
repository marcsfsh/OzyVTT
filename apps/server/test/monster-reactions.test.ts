import { describe, expect, it } from "vitest";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { landTeleport } from "../src/granted-moves.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { answerReaction } from "../src/reactions.js";
import { offerNearbyReactions } from "../src/triggered-reactions.js";
import {
  actor,
  answer,
  conditionsOf,
  damage,
  GM,
  heroDefinition,
  IDS,
  nextId,
  NOW,
  table,
  type Table
} from "./monster-table.js";

// Stat-block reactions set off by something other than a hit's damage (SRD 5.2.1): a chain devil's Unnerving Gaze at a
// creature that starts its turn near it, an octopus's Ink Cloud as a creature ends its turn near it or as it takes
// damage underwater, a nalfeshnee's Pursuit after a creature's move, a black pudding's and an ochre jelly's Split, a
// rust monster's Reflexive Antennae on a hit, and a mummy lord's Whirlwind of Sand.

/** Turns pass with every creature `feet` from every other. */
const advance = (built: Table, feet: number) => {
  const events: Parameters<typeof nextInitiativeTurn>[1] = [];
  nextInitiativeTurn(built.state, events, {
    resolveDefinition: built.resolveDefinition,
    rollDie: () => 1,
    newId: nextId,
    now: NOW,
    distanceFeet: () => feet
  });
  return events!;
};

const reactionDeps = (built: Table, faces: number[] = []) => ({
  resolveDefinition: built.resolveDefinition,
  random: () => faces.shift() ?? 3,
  newRollId: nextId,
  gmSessionId: IDS.gm,
  now: NOW
});

/** The monster's open prompt, answered. */
const respond = (built: Table, use: boolean, faces: number[] = []) =>
  answerReaction(
    built.state,
    nextId(),
    built.state.combat.pendingReactions.find((prompt) => prompt.actorId === IDS.monster)!.id,
    use,
    undefined,
    GM,
    reactionDeps(built, faces)
  );

const prompts = (built: Table) => built.state.combat.pendingReactions.filter((prompt) => prompt.kind === "triggered");

/** Puts a creature's token on the map. */
const place = (built: Table, actorId: string, x: number, y: number) => {
  built.state.combat = {
    ...built.state.combat,
    tokens: built.state.combat.tokens.map((token) =>
      token.actorId === actorId ? { ...token, position: { x, y }, sizePx: 50, sizeCells: 1 } : token
    )
  };
};

/** The hero attacks the monster with its dagger, on a turn of its own. */
const heroStabs = (built: Table, face: number) => {
  const faces = [face];
  built.state.combat = {
    ...built.state.combat,
    turnActorId: IDS.hero,
    turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
  };
  return resolveDefinitionAction(
    built.state,
    heroDefinition().actions[0]!,
    { actorId: IDS.hero, targetIds: [IDS.monster], commandId: nextId() },
    {
      random: () => faces.shift() ?? 1,
      newRollId: nextId,
      gmSessionId: IDS.gm,
      now: NOW,
      definition: heroDefinition(),
      resolveDefinition: built.resolveDefinition,
      distanceFeet: () => 5
    }
  );
};

describe("a chain devil's Unnerving Gaze", () => {
  it("is offered as a creature it sees starts its turn within 30 feet, and Frightens it until that turn ends", () => {
    const built = table("chain-devil");
    advance(built, 20);
    expect(prompts(built)).toMatchObject([{ actorId: IDS.monster, cause: "turn-start", targetActorId: IDS.hero }]);
    const used = respond(built, true);
    expect(used.resolution?.save).toMatchObject({ ability: "wis", dc: 15 });
    answer(built, IDS.hero, 5);
    expect(conditionsOf(built, IDS.hero)).toContain("frightened");
    // "Until the end of its turn": the hero's turn, which is running.
    advance(built, 20);
    expect(conditionsOf(built, IDS.hero)).not.toContain("frightened");
  });

  it("leaves a creature that saved immune, and reaches no farther than 30 feet", () => {
    const built = table("chain-devil");
    advance(built, 20);
    respond(built, true);
    answer(built, IDS.hero, 20);
    expect(conditionsOf(built, IDS.hero)).not.toContain("frightened");
    advance(built, 20);
    advance(built, 20);
    advance(built, 20);
    expect(prompts(built)).toEqual([]);
    const far = table("chain-devil");
    advance(far, 40);
    expect(prompts(far)).toEqual([]);
  });

  it("is never offered as the devil's own side starts a turn", () => {
    const built = table("chain-devil");
    advance(built, 20);
    respond(built, false);
    advance(built, 20);
    expect(built.state.combat.turnActorId).toBe(IDS.ally);
    expect(prompts(built)).toEqual([]);
  });
});

describe("an octopus's Ink Cloud", () => {
  it("is offered underwater as a creature ends its turn within 5 feet, and fills a Cube where the octopus is", () => {
    const built = table("octopus");
    built.state.combat = { ...built.state.combat, underwater: true };
    place(built, IDS.monster, 100, 100);
    advance(built, 5);
    advance(built, 5);
    expect(prompts(built)).toMatchObject([{ actorId: IDS.monster, cause: "turn-end" }]);
    respond(built, true);
    const ink = built.state.combat.vision.areas.find((area) => area.kind === "heavily-obscured");
    expect(ink?.shape).toEqual({ type: "circle", x: 100, y: 100, radiusFeet: 2.5 });
    expect(actor(built, IDS.monster).effects.some((effect) => effect.grantedMove?.mode === "swim")).toBe(true);
  });

  it("is never offered in an encounter above water", () => {
    const built = table("octopus");
    advance(built, 5);
    advance(built, 5);
    expect(prompts(built)).toEqual([]);
  });

  it("is a giant octopus's to use as it takes damage underwater", () => {
    const built = table("giant-octopus");
    damage(built, IDS.monster, 5, "piercing", { sourceActorId: IDS.hero });
    expect(prompts(built)).toEqual([]);
    built.state.combat = { ...built.state.combat, underwater: true };
    damage(built, IDS.monster, 5, "piercing", { sourceActorId: IDS.hero });
    expect(prompts(built)).toMatchObject([{ actorId: IDS.monster, cause: "damaged" }]);
  });
});

describe("a nalfeshnee's Pursuit", () => {
  it("is offered as a creature it sees ends a move within 120 feet, and teleports it near that creature", () => {
    const built = table("nalfeshnee");
    const deps = { resolveDefinition: built.resolveDefinition, newId: nextId, now: NOW };
    expect(offerNearbyReactions(built.state, IDS.hero, "ends-move-near", { ...deps, distanceFeet: () => 150 })).toEqual(
      []
    );
    offerNearbyReactions(built.state, IDS.hero, "ends-move-near", { ...deps, distanceFeet: () => 100 });
    expect(prompts(built)).toMatchObject([{ actorId: IDS.monster, cause: "move-end" }]);
    respond(built, true);
    const grant = actor(built, IDS.monster).effects.find((effect) => effect.grantedTeleport)?.grantedTeleport;
    expect(grant).toMatchObject({ feet: 120, near: { actorId: IDS.hero, feet: 10 } });
    // The teleport keeps to a space within 10 feet of the hero; one farther is a move of the GM's own.
    place(built, IDS.hero, 500, 100);
    const teleport = (x: number) =>
      applyMovementRules(built.state, {
        actorId: IDS.monster,
        from: { x: 100, y: 100 },
        to: { x, y: 100 },
        mode: "teleport",
        distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / 10,
        override: null,
        resolveDefinition: built.resolveDefinition,
        newPromptId: nextId,
        now: () => 0,
        commandId: nextId()
      });
    expect(teleport(200).granted).toBeUndefined();
    expect(teleport(420).granted).toBe("Teleport");
  });
});

describe("Split", () => {
  it("is offered as Slashing damage meets a Large black pudding, which becomes two Medium ones", () => {
    const built = table("black-pudding");
    damage(built, IDS.monster, 8, "slashing", { sourceActorId: IDS.hero });
    expect(prompts(built)).toMatchObject([{ actorId: IDS.monster, cause: "damaged" }]);
    respond(built, true);
    expect(built.state.actors.some((candidate) => candidate.id === IDS.monster)).toBe(false);
    const puddings = built.state.actors.filter((candidate) => candidate.name.startsWith("Black Pudding"));
    expect(puddings).toHaveLength(2);
    for (const pudding of puddings) {
      // The 8 Slashing left it 52 Hit Points: 26 each.
      expect(pudding).toMatchObject({ size: "medium", hp: { current: 26, maximum: 26 } });
      expect(built.state.combat.initiative.find((entry) => entry.actorId === pudding.id)?.score).toBe(20);
    }
  });

  it("is offered as an ochre jelly becomes Bloodied, and not to one below 10 Hit Points", () => {
    const built = table("ochre-jelly");
    damage(built, IDS.monster, 5, "fire", { sourceActorId: IDS.hero });
    expect(prompts(built)).toEqual([]);
    damage(built, IDS.monster, 10, "fire", { sourceActorId: IDS.hero });
    expect(prompts(built)).toHaveLength(1);
    const low = table("ochre-jelly");
    actor(low, IDS.monster).hp.current = 12;
    damage(low, IDS.monster, 4, "slashing", { sourceActorId: IDS.hero });
    expect(prompts(low)).toEqual([]);
  });
});

describe("a rust monster's Reflexive Antennae", () => {
  it("is offered on an attack roll that hits, and not on damage with no roll", () => {
    const built = table("rust-monster");
    damage(built, IDS.monster, 5, "fire", { sourceActorId: IDS.hero });
    expect(prompts(built)).toEqual([]);
    heroStabs(built, 1);
    expect(prompts(built)).toEqual([]);
    heroStabs(built, 19);
    expect(prompts(built)).toMatchObject([{ actorId: IDS.monster, cause: "hit", targetActorId: IDS.hero }]);
    // It uses Antennae, which finds no metal on the hero.
    expect(respond(built, true).resolution?.actionName).toBe("Antennae");
  });
});

describe("a mummy lord's Whirlwind of Sand", () => {
  it("is offered on a hit +2 AC can't turn, and teleports the mummy, Blinding the enemies where it lands", () => {
    const built = table("mummy-lord");
    heroStabs(built, 19);
    const prompt = built.state.combat.pendingReactions.find((entry) => entry.actorId === IDS.monster);
    expect(prompt).toMatchObject({ kind: "attack-would-hit", acBonus: 2 });
    expect(respond(built, true).resolution?.attack?.outcome).toBe("hit");
    const grant = actor(built, IDS.monster).effects.find((effect) => effect.grantedTeleport)?.grantedTeleport;
    expect(grant).toMatchObject({ feet: 60, landing: { conditions: ["blinded"], withinFeet: 5 } });
    landTeleport(built.state, actor(built, IDS.monster), grant!.landing!, "Whirlwind of Sand", {
      commandId: nextId(),
      distanceFeet: (_a, b) => (b === IDS.hero ? 5 : 30),
      sees: () => true,
      resolveDefinition: built.resolveDefinition
    });
    expect(conditionsOf(built, IDS.hero)).toContain("blinded");
    expect(conditionsOf(built, IDS.ally)).not.toContain("blinded");
  });
});
