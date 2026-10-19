import { describe, expect, it } from "vitest";
import type { GameState, VisionArea } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { checkPlan } from "../src/ability-checks.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { tokensInTemplate } from "../src/area-targeting.js";
import { builtinAction } from "../src/builtin-actions.js";
import { mapCover } from "../src/cover.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { RulesBlockedError } from "../src/game-store.js";
import { mapDistance } from "../src/movement-narration.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { traitsAtTurnStart } from "../src/trait-turns.js";
import { checkSightFor, frightenedApplies, hidingPlace, lightSensitivities, sightRules } from "../src/vision/rules.js";
import { cell, DIVIDER, GEOMETRY, GOBLIN, HERO, ORC, visionGame, wall } from "./vision-fixtures.js";

// The rules that read sight (SRD 5.2.1): Cover from walls and creatures, areas that stop at walls, Hide's hiding
// place, Search finding a hidden creature, Frightened's line of sight, Dodge against a seen attacker, Blinded's failed
// checks, the light a creature stands in, gaze traits, and Blindsight and Truesight with the scene's vision off.

const monsters = loadMonsterDefinitions();
const monster = (id: string) => monsters.find((definition) => definition.source.externalId === id)!;
const resolveDefinition = (id: string): ActorDefinition | undefined => monster(id);
const content = { definition: resolveDefinition };

let count = 0;
const commandId = () => `60000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
const newId = () => `90000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;

const distanceFeet = (state: GameState) => (a: string, b: string) => {
  const at = (id: string) => state.combat.tokens.find((token) => token.actorId === id)?.position;
  const [from, to] = [at(a), at(b)];
  return from && to ? (mapDistance(GEOMETRY, from, to)?.value ?? null) : null;
};

function deps(state: GameState, faces: number[], definition?: ActorDefinition): ResolveDependencies {
  let rolls = 0;
  return {
    random: (sides) => Math.min(sides, faces.shift() ?? 1),
    newRollId: () => `40000000-0000-4000-8000-${String(++rolls).padStart(12, "0")}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-19T00:00:00.000Z",
    definition,
    distanceFeet: distanceFeet(state),
    resolveDefinition
  };
}

/** The monster at `id` swings its first attack at the hero. */
function swing(state: GameState, id: string, monsterId: string, actionId?: string) {
  state.combat.turnActorId = id;
  const definition = monster(monsterId);
  const attack = definition.actions.find((action) =>
    actionId ? action.id === actionId : action.attack !== undefined
  )!;
  return resolveDefinitionAction(
    state,
    attack,
    { actorId: id, targetIds: [HERO], commandId: commandId(), rollMode: null, override: null },
    deps(state, [10, 10, 3, 3], definition)
  );
}

const calibrationOf = () => GEOMETRY.calibration as Extract<typeof GEOMETRY.calibration, { kind: "square" }>;

const fog = (x: number, y: number, width: number, height: number): VisionArea => ({
  id: "80000000-0000-4000-8000-000000000001",
  kind: "heavily-obscured",
  shape: { type: "rect", x, y, width, height }
});

describe("cover from the map", () => {
  it("gives Total Cover behind a wall, and none with the scene's vision off", () => {
    expect(mapCover(visionGame({ walls: [DIVIDER()] }), HERO, GOBLIN)).toBe("total");
    expect(mapCover(visionGame({ enabled: false, walls: [DIVIDER()] }), HERO, GOBLIN)).toBeNull();
    expect(mapCover(visionGame(), HERO, GOBLIN)).toBeNull();
  });

  it("gives Half Cover behind a low stretch of wall that hides half the target", () => {
    // A wall in front of the goblin's upper half: its two top corners are hidden from the hero, its bottom two aren't.
    const low = wall({ x: 380, y: 200 }, { x: 380, y: 275 });
    expect(mapCover(visionGame({ walls: [low] }), HERO, GOBLIN)).toBe("half");
  });

  it("gives Half Cover behind another creature", () => {
    const state = visionGame({ positions: { [ORC]: cell(5, 5) } });
    expect(mapCover(state, HERO, GOBLIN)).toBe("half");
  });

  it("raises the target's Armor Class on the attack roll", () => {
    // The goblin shoots at the hero 35 feet off, with the orc out of the way and then in it.
    const clear = visionGame({ positions: { [ORC]: cell(5, 8) } });
    expect(swing(clear, GOBLIN, "goblin-warrior", "shortbow").attack?.coverBonus).toBeUndefined();
    const behind = visionGame({ positions: { [ORC]: cell(5, 5) } });
    expect(swing(behind, GOBLIN, "goblin-warrior", "shortbow").attack?.coverBonus).toBe(2);
  });
});

describe("areas of effect and walls", () => {
  const calibration = calibrationOf();
  // A 25-foot Sphere centred in front of the divider: the hero is 15 feet away on its side, the goblin 20 on the other.
  const sphere = { origin: cell(4, 5), target: cell(9, 5) };

  it("doesn't reach a creature every straight line to which a wall blocks", () => {
    const caught = tokensInTemplate(visionGame({ walls: [DIVIDER()] }), calibration, sphere, "circle", null);
    expect(caught).toContain(HERO);
    expect(caught).not.toContain(GOBLIN);
  });

  it("reaches through an open door, and everywhere with the scene's vision off", () => {
    const open = [
      wall({ x: 250, y: 0 }, { x: 250, y: 250 }),
      wall({ x: 250, y: 250 }, { x: 250, y: 300 }, "door", true),
      wall({ x: 250, y: 300 }, { x: 250, y: 600 })
    ];
    expect(tokensInTemplate(visionGame({ walls: open }), calibration, sphere, "circle", null)).toContain(GOBLIN);
    const off = visionGame({ enabled: false, walls: [DIVIDER()] });
    expect(tokensInTemplate(off, calibration, sphere, "circle", null)).toContain(GOBLIN);
  });
});

describe("Hide's hiding place", () => {
  it("needs Heavily Obscured or Three-Quarters Cover from each enemy", () => {
    // The goblin is Blinded, so it doesn't see the hero; the hero still stands in the open.
    const open = visionGame();
    expect(hidingPlace(open, content, HERO, [GOBLIN], false)).toBe(false);
    expect(hidingPlace(visionGame({ walls: [DIVIDER()] }), content, HERO, [GOBLIN], false)).toBe(true);
    expect(hidingPlace(visionGame({ areas: [fog(0, 200, 150, 150)] }), content, HERO, [GOBLIN], false)).toBe(true);
    expect(hidingPlace(visionGame({ ambient: "dark" }), content, HERO, [GOBLIN], false)).toBe(true);
  });

  it("lets a Naturally Stealthy hider use a creature a size larger as its cover", () => {
    const state = visionGame({
      positions: { [ORC]: cell(4, 5) },
      actors: { [HERO]: { size: "small" }, [ORC]: { size: "medium" } }
    });
    expect(hidingPlace(state, content, HERO, [GOBLIN], false)).toBe(false);
    expect(hidingPlace(state, content, HERO, [GOBLIN], true)).toBe(true);
  });

  it("refuses the Hide action out in the open, naming the rule", () => {
    const state = visionGame({ actors: { [GOBLIN]: { conditions: [{ id: "blinded" }] } } });
    expect(() =>
      resolveDefinitionAction(
        state,
        builtinAction("hide")!,
        { actorId: HERO, targetIds: [], commandId: commandId(), builtin: true, rollMode: null, override: null },
        deps(state, [17])
      )
    ).toThrowError(/isn't Heavily Obscured or behind Three-Quarters Cover/);
  });
});

describe("Search", () => {
  const hiddenGoblin = (state: GameState) => {
    addEffect(
      state,
      GOBLIN,
      makeEffect({
        id: "effect-hidden",
        name: "Hidden",
        duration: { type: "manual" },
        tags: ["hidden"],
        sourceActionId: "hide",
        linkedConditionIds: ["invisible"],
        findDc: 12
      })
    );
    return state;
  };
  const search = (state: GameState, face: number) =>
    resolveDefinitionAction(
      state,
      builtinAction("search")!,
      {
        actorId: HERO,
        targetIds: [],
        commandId: commandId(),
        builtin: true,
        rollMode: null,
        override: null,
        skill: "perception"
      },
      deps(state, [face])
    );
  const goblinHidden = (state: GameState) =>
    state.actors.find((actor) => actor.id === GOBLIN)!.effects.some((effect) => effect.tags.includes("hidden"));

  it("finds a hidden creature in view whose Hide total the Perception check meets", () => {
    const state = hiddenGoblin(visionGame());
    search(state, 15);
    expect(goblinHidden(state)).toBe(false);
    expect(state.actors.find((actor) => actor.id === GOBLIN)!.conditions).toEqual([]);
  });

  it("misses one below the total, behind a wall or in magical Darkness", () => {
    const low = hiddenGoblin(visionGame());
    search(low, 5);
    expect(goblinHidden(low)).toBe(true);
    const walled = hiddenGoblin(visionGame({ walls: [DIVIDER()] }));
    search(walled, 20);
    expect(goblinHidden(walled)).toBe(true);
    const darkness: VisionArea = { ...fog(350, 200, 150, 150), kind: "magical-darkness" };
    const dark = hiddenGoblin(visionGame({ areas: [darkness] }));
    search(dark, 20);
    expect(goblinHidden(dark)).toBe(true);
  });
});

describe("Frightened and line of sight", () => {
  const frightenedBy = (sourceId: string) => ({
    conditions: [{ id: "frightened" }],
    effects: [
      makeEffect({
        id: "effect-fear",
        name: "Fear",
        duration: { type: "manual" },
        sourceActorId: sourceId,
        linkedConditionIds: ["frightened"]
      })
    ]
  });

  it("applies while the source of fear is within line of sight", () => {
    const state = visionGame({ actors: { [HERO]: frightenedBy(GOBLIN) } });
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    expect(frightenedApplies(hero, sightRules(state, content))).toBe(true);
    // In the dark the hero can't see the goblin, but nothing blocks the line between them.
    const dark = visionGame({ ambient: "dark", actors: { [HERO]: frightenedBy(GOBLIN) } });
    expect(
      frightenedApplies(
        dark.actors.find((actor) => actor.id === HERO)!,
        sightRules(dark, content)
      )
    ).toBe(true);
  });

  it("stops behind a wall, and keeps on with the scene's vision off", () => {
    const walled = visionGame({ walls: [DIVIDER()], actors: { [HERO]: frightenedBy(GOBLIN) } });
    const hero = walled.actors.find((actor) => actor.id === HERO)!;
    expect(frightenedApplies(hero, sightRules(walled, content))).toBe(false);
    expect(checkSightFor(walled, hero, content).frightened).toBe(false);
    const off = visionGame({ enabled: false, walls: [DIVIDER()], actors: { [HERO]: frightenedBy(GOBLIN) } });
    expect(
      frightenedApplies(
        off.actors.find((actor) => actor.id === HERO)!,
        sightRules(off, content)
      )
    ).toBe(true);
  });

  it("drops the attack roll's Disadvantage once a wall hides the source", () => {
    const fear = frightenedBy(ORC);
    const state = visionGame({
      walls: [wall({ x: 50, y: 400 }, { x: 150, y: 400 })],
      positions: { [GOBLIN]: cell(2, 5), [ORC]: cell(1, 9) },
      actors: { [GOBLIN]: { definitionId: "goblin-warrior", ...fear } }
    });
    expect(swing(state, GOBLIN, "goblin-warrior").rollMode?.disadvantage ?? []).not.toContain("Attacker is Frightened");
    const seen = visionGame({
      positions: { [GOBLIN]: cell(2, 5), [ORC]: cell(1, 9) },
      actors: { [GOBLIN]: { definitionId: "goblin-warrior", ...fear } }
    });
    expect(swing(seen, GOBLIN, "goblin-warrior").rollMode?.disadvantage).toContain("Attacker is Frightened");
  });

  it("refuses a willing move closer to the source, naming it", () => {
    const state = visionGame({ actors: { [HERO]: frightenedBy(GOBLIN) } });
    const move = (to: { x: number; y: number }) =>
      applyMovementRules(state, {
        actorId: HERO,
        from: cell(1, 5),
        to,
        distance: (a, b) => mapDistance(GEOMETRY, a, b)?.value ?? null,
        calibration: calibrationOf(),
        override: null,
        resolveDefinition,
        newPromptId: () => "70000000-0000-4000-8000-000000000001",
        now: () => 0,
        commandId: commandId()
      });
    expect(() => move(cell(3, 5))).toThrowError(
      new RulesBlockedError(
        "movement.toward-fear",
        "Borin is Frightened and can't willingly move closer to Skulking Goblin."
      )
    );
    expect(move(cell(1, 7)).warning).toBeNull();
    expect(move(cell(0, 5)).warning).toBeNull();
  });
});

describe("Dodge against an attacker it can see", () => {
  const dodged = (state: GameState) => {
    const fresh = state.combat.turn;
    resolveDefinitionAction(
      state,
      builtinAction("dodge")!,
      { actorId: HERO, targetIds: [], commandId: commandId(), builtin: true, rollMode: null, override: null },
      deps(state, [])
    );
    // The goblin's turn comes next, with its own action to spend.
    state.combat.turn = fresh;
    return state;
  };

  it("gives the attacker Disadvantage when the dodger sees it, and none when it can't", () => {
    const lit = dodged(
      visionGame({ positions: { [GOBLIN]: cell(2, 5) }, actors: { [GOBLIN]: { definitionId: "goblin-warrior" } } })
    );
    expect(swing(lit, GOBLIN, "goblin-warrior").rollMode?.mode).toBe("disadvantage");
    // In the dark the goblin's Darkvision finds the hero, who sees nothing: no Dodge, and Advantage for the unseen.
    const dark = dodged(
      visionGame({
        ambient: "dark",
        positions: { [GOBLIN]: cell(2, 5) },
        actors: { [GOBLIN]: { definitionId: "goblin-warrior" } }
      })
    );
    expect(swing(dark, GOBLIN, "goblin-warrior").rollMode?.mode).toBe("advantage");
  });
});

describe("Blinded and Heavily Obscured on a check to find a creature", () => {
  const plan = (state: GameState) => {
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    const goblin = state.actors.find((actor) => actor.id === GOBLIN)!;
    return checkPlan(
      hero,
      undefined,
      deriveEquipment(hero, undefined, undefined),
      { ability: "wis", skill: "perception" },
      {
        finding: goblin,
        sight: checkSightFor(state, hero, content, goblin, distanceFeet(state))
      }
    );
  };

  it("fails whatever it rolls while the roller is Blinded", () => {
    expect(plan(visionGame({ actors: { [HERO]: { conditions: [{ id: "blinded" }] } } })).autoFails).toMatch(/Blinded/);
    expect(plan(visionGame()).autoFails).toBeUndefined();
  });

  it("fails into a Heavily Obscured space and has Disadvantage into a Lightly Obscured one", () => {
    expect(plan(visionGame({ areas: [fog(350, 200, 150, 150)] })).autoFails).toMatch(/Heavily Obscured/);
    const dim = plan(visionGame({ ambient: "dim" }));
    expect(dim.autoFails).toBeUndefined();
    expect(dim.rollMode.disadvantage).toContain("Skulking Goblin is Lightly Obscured");
  });
});

describe("the light a creature stands in", () => {
  it("gives Sunlight Sensitivity Disadvantage on attack rolls in sunlight only", () => {
    const kobold = { [GOBLIN]: { definitionId: "kobold-warrior" } };
    const sunny = visionGame({ sunlight: true, positions: { [GOBLIN]: cell(2, 5) }, actors: kobold });
    expect(swing(sunny, GOBLIN, "kobold-warrior").rollMode?.disadvantage).toContain(
      "Sunlight Sensitivity (attacker in the light)"
    );
    const torchlit = visionGame({ positions: { [GOBLIN]: cell(2, 5) }, actors: kobold });
    expect(swing(torchlit, GOBLIN, "kobold-warrior").rollMode?.disadvantage ?? []).toEqual([]);
  });

  it("reads a cloaker's Light Sensitivity in any Bright Light, and nothing with the scene's vision off", () => {
    const at = (state: GameState) =>
      lightSensitivities(
        state,
        state.actors.find((actor) => actor.id === GOBLIN)!,
        "attack",
        sightRules(state, content),
        content
      );
    const cloaker = { [GOBLIN]: { definitionId: "cloaker" } };
    expect(at(visionGame({ actors: cloaker }))).toEqual(["Light Sensitivity"]);
    expect(at(visionGame({ ambient: "dim", actors: cloaker }))).toEqual([]);
    expect(at(visionGame({ enabled: false, actors: cloaker }))).toEqual([]);
  });

  it("gives a shadow's Sunlight Weakness to its saving throws too", () => {
    const state = visionGame({ sunlight: true, actors: { [GOBLIN]: { definitionId: "shadow" } } });
    const shadow = state.actors.find((actor) => actor.id === GOBLIN)!;
    expect(lightSensitivities(state, shadow, "save", sightRules(state, content), content)).toEqual([
      "Sunlight Weakness"
    ]);
  });

  it("burns a vampire that starts its turn in sunlight", () => {
    const vampire = monster("vampire");
    const state = visionGame({
      sunlight: true,
      actors: { [GOBLIN]: { definitionId: "vampire", hp: { current: 195, maximum: 195 } } }
    });
    const events = traitsAtTurnStart(state, GOBLIN, {
      rollDie: () => 1,
      resolveDefinition,
      distanceFeet: distanceFeet(state)
    });
    expect(state.actors.find((actor) => actor.id === GOBLIN)!.hp.current).toBe(175);
    expect(events.map((event) => event.text).join(" ")).toContain("Radiant");
    expect(vampire.traitMechanics?.some((trait) => trait.kind === "light-sensitivity")).toBe(true);
    // Under a cloudy sky, no burn.
    const cloudy = visionGame({
      actors: { [GOBLIN]: { definitionId: "vampire", hp: { current: 195, maximum: 195 } } }
    });
    traitsAtTurnStart(cloudy, GOBLIN, { rollDie: () => 1, resolveDefinition, distanceFeet: distanceFeet(cloudy) });
    expect(cloudy.actors.find((actor) => actor.id === GOBLIN)!.hp.current).toBe(195);
  });
});

describe("a gaze that needs its bearer seen", () => {
  it("asks only a creature that can see the sea hag to save against its Vile Appearance", () => {
    const hag = { [GOBLIN]: { definitionId: "sea-hag", hp: { current: 52, maximum: 52 } } };
    const near = { [GOBLIN]: cell(4, 5) };
    const seen = visionGame({ positions: near, actors: hag });
    traitsAtTurnStart(seen, HERO, { rollDie: () => 1, resolveDefinition, distanceFeet: distanceFeet(seen), newId });
    expect(seen.combat.pendingSaves?.some((save) => save.targetActorId === HERO) ?? false).toBe(true);
    const walled = visionGame({ positions: near, walls: [wall({ x: 150, y: 0 }, { x: 150, y: 600 })], actors: hag });
    traitsAtTurnStart(walled, HERO, { rollDie: () => 1, resolveDefinition, distanceFeet: distanceFeet(walled), newId });
    expect(walled.combat.pendingSaves?.some((save) => save.targetActorId === HERO) ?? false).toBe(false);
  });
});

describe("special senses with the scene's vision off", () => {
  it("lets Blindsight and Truesight see an Invisible creature within their range", () => {
    const invisible = { conditions: [{ id: "invisible" }] };
    // The goblin, 35 feet off, is Invisible; the hero sees it only with a sense that reaches.
    const sees = (senses: string) => {
      const definition = { extensions: { "open5e.srd-2024": { senses: [senses] } } } as unknown as ActorDefinition;
      const state = visionGame({
        enabled: false,
        actors: { [HERO]: { definitionId: "sensing" }, [GOBLIN]: invisible }
      });
      const reading = { definition: (id: string) => (id === "sensing" ? definition : resolveDefinition(id)) };
      return sightRules(state, reading, distanceFeet(state)).canSee(HERO, GOBLIN);
    };
    expect(sees("blindsight 60 ft.")).toBe(true);
    expect(sees("truesight 120 ft.")).toBe(true);
    expect(sees("blindsight 30 ft.")).toBe(false);
    expect(sees("darkvision 60 ft.")).toBe(false);
  });

  it("takes away Invisible's Disadvantage on the attack roll of a creature whose Blindsight reaches the target", () => {
    const invisible = { [HERO]: { conditions: [{ id: "invisible" }] } };
    const near = { [GOBLIN]: cell(2, 5) };
    // A darkmantle has Blindsight 60 feet; a goblin has only Darkvision.
    const darkmantle = visionGame({
      enabled: false,
      positions: near,
      actors: { ...invisible, [GOBLIN]: { definitionId: "darkmantle" } }
    });
    expect(swing(darkmantle, GOBLIN, "darkmantle").rollMode?.disadvantage ?? []).not.toContain("Target is Invisible");
    const goblin = visionGame({
      enabled: false,
      positions: near,
      actors: { ...invisible, [GOBLIN]: { definitionId: "goblin-warrior" } }
    });
    expect(swing(goblin, GOBLIN, "goblin-warrior").rollMode?.disadvantage).toContain("Target is Invisible");
  });
});
