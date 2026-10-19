import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions, loadSpells } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { ContentLibrary } from "../src/content-library.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { previewDamage } from "../src/hit-points.js";
import { mapDistance } from "../src/movement-narration.js";
import { projectPlayerCombat } from "../src/projections.js";
import { carriedLightsOf, sensesOf } from "../src/vision/senses.js";
import { addActorFromDefinition } from "../src/actor-roster.js";
import {
  cell,
  FRIEND,
  GEOMETRY,
  GOBLIN,
  HERO,
  ORC,
  SESSION_A,
  SESSION_B,
  visionGame,
  wall
} from "./vision-fixtures.js";

// What features, feats, invocations and spells give a character for sight (SRD 5.2.1): Devil's Sight, Witch Sight and
// Boon of Truesight as senses, Stonecunning's Tremorsense, Holy Nimbus's sunlight and Sacred Weapon's light, Divine
// Sense and Detect Evil and Good shown to their player alone, and the Dim Light or Darkness that Boon of the Night
// Spirit and One with Shadows need.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const monsters = loadMonsterDefinitions();
const monster = (id: string) => monsters.find((definition) => definition.source.externalId === id);

let count = 0;
const commandId = () => `60000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;

/** A character sheet holding these features and feats. */
function sheet(
  features: ReadonlyArray<{ id: string; kind: string; sourceId: string }>,
  feats: readonly string[] = []
): ActorDefinition {
  return {
    character: { features, feats: feats.map((id) => ({ id, name: id })) },
    extensions: {}
  } as unknown as ActorDefinition;
}

const SHEET = "sheet";
const resolver = (definition: ActorDefinition) => (id: string) => (id === SHEET ? definition : monster(id));

function deps(state: GameState, definition: ActorDefinition, faces: number[] = []): ResolveDependencies {
  let rolls = 0;
  return {
    random: (sides) => Math.min(sides, faces.shift() ?? 1),
    newRollId: () => `40000000-0000-4000-8000-${String(++rolls).padStart(12, "0")}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-19T00:00:00.000Z",
    definition,
    catalog,
    distanceFeet: (a, b) => {
      const at = (id: string) => state.combat.tokens.find((token) => token.actorId === id)?.position;
      const [from, to] = [at(a), at(b)];
      return from && to ? (mapDistance(GEOMETRY, from, to)?.value ?? null) : null;
    },
    resolveDefinition: resolver(definition)
  };
}

const classFeature = (classId: string, featureId: string, kind = "class") =>
  library.featureRecord({ kind: kind as "class", sourceId: classId, id: featureId });
const actionOf = (actions: ReadonlyArray<{ id: string }> | undefined, id: string) =>
  (actions ?? []).find((action) => action.id === id) as ActorAction;

describe("senses from invocations and feats", () => {
  it("reads Devil's Sight, Witch Sight and Boon of Truesight", () => {
    const warlock = sheet(
      [
        { id: "devils-sight", kind: "option", sourceId: "eldritch-invocations" },
        { id: "witch-sight", kind: "option", sourceId: "eldritch-invocations" }
      ],
      ["boon-of-truesight"]
    );
    const state = visionGame({ actors: { [HERO]: { definitionId: SHEET } } });
    const senses = sensesOf(state, state.actors[0]!, { definition: resolver(warlock), catalog });
    expect(senses.devilsSight).toBe(120);
    // Witch Sight's 30 feet and the boon's 60: the best range wins.
    expect(senses.truesight).toBe(60);
  });

  it("gives Stonecunning's Bonus Action Tremorsense 60 feet for 10 minutes", () => {
    const stonecunning = actionOf(
      library.speciesRecord("dwarf")?.traits.find((trait) => trait.id === "dwarf-stonecunning")?.actions,
      "stonecunning"
    );
    expect(stonecunning.grants).toMatchObject({
      duration: { type: "rounds", rounds: 100 },
      modifiers: [{ type: "sense", sense: "tremorsense", feet: 60 }]
    });
  });
});

describe("light from Channel Divinity", () => {
  it("fills Holy Nimbus's aura with sunlight and lights Sacred Weapon", () => {
    const nimbus = actionOf(classFeature("oath-of-devotion", "holy-nimbus", "subclass")?.actions, "holy-nimbus");
    expect(nimbus.grants?.light).toEqual({ brightFeet: 30, dimFeet: 0, sunlight: true });
    const sacred = actionOf(classFeature("oath-of-devotion", "sacred-weapon", "subclass")?.actions, "sacred-weapon");
    expect(sacred.grants?.light).toEqual({ brightFeet: 20, dimFeet: 20 });
  });
});

describe("Divine Sense and Detect Evil and Good", () => {
  const divineSense = makeEffect({
    id: "effect-divine-sense",
    name: "Divine Sense",
    duration: { type: "rounds", remaining: 100 },
    tags: ["divine-sense"],
    detects: { creatureTypes: ["celestial", "fiend", "undead"], feet: 60 }
  });
  // The scene is dark and the paladin has no Darkvision, so neither the zombie nor the bandit is seen.
  const dark = (extra: Parameters<typeof visionGame>[0] = {}) => {
    const state = visionGame({
      ambient: "dark",
      positions: { [GOBLIN]: cell(9, 5), [ORC]: cell(1, 8), [FRIEND]: cell(1, 2) },
      ...extra,
      actors: {
        [GOBLIN]: { definitionId: "zombie" },
        [ORC]: { definitionId: "bandit" },
        ...extra.actors
      }
    });
    addEffect(state, HERO, structuredClone(divineSense));
    return state;
  };
  const content = { definition: (id: string) => monster(id), catalog };
  const sensed = (state: GameState, session?: string) => {
    const vision = projectPlayerCombat(state, session, 0, content).vision;
    return vision.enabled ? (vision.sensed ?? []) : [];
  };

  it("shows the paladin's player where an unseen Undead stands and its type, and nothing of a Humanoid", () => {
    const state = dark();
    expect(sensed(state, SESSION_A)).toEqual([{ ...cell(9, 5), creatureType: "undead" }]);
    expect(projectPlayerCombat(state, SESSION_A, 0, content).tokens.map((token) => token.actorId)).not.toContain(
      GOBLIN
    );
  });

  it("shows nothing to another player or the table, beyond 60 feet, of a GM-only creature, or while the paladin is Incapacitated", () => {
    expect(sensed(dark(), SESSION_B)).toEqual([]);
    expect(sensed(dark())).toEqual([]);
    expect(sensed(dark({ positions: { [GOBLIN]: cell(15, 5) } }), SESSION_A)).toEqual([]);
    expect(sensed(dark({ actors: { [HERO]: { conditions: [{ id: "stunned" }] } } }), SESSION_A)).toEqual([]);
    // A GM-only creature stays the GM's secret.
    const secret = { [GOBLIN]: { definitionId: "zombie", visibility: "gm-only" } };
    expect(sensed(dark({ actors: secret }), SESSION_A)).toEqual([]);
  });

  it("needs no marker for a creature the paladin already sees, and reaches through walls", () => {
    expect(sensed(dark({ ambient: "bright" }), SESSION_A)).toEqual([]);
    const walled = dark({ walls: [wall({ x: 300, y: 0 }, { x: 300, y: 600 })] });
    expect(sensed(walled, SESSION_A)).toHaveLength(1);
  });

  it("stops Detect Evil and Good at a wall", () => {
    const spell = loadSpells().find((entry) => entry.id === "detect-evil-and-good")!;
    const detects = spell.effect?.grant?.detects;
    expect(detects).toMatchObject({ feet: 30, blockedByWalls: true });
    const near = { positions: { [GOBLIN]: cell(5, 5) } };
    const withSpell = (state: GameState) => {
      state.actors[0]!.effects = [{ ...structuredClone(divineSense), detects: structuredClone(detects!) }];
      return state;
    };
    expect(sensed(withSpell(dark(near)), SESSION_A)).toHaveLength(1);
    const walled = withSpell(dark({ ...near, walls: [wall({ x: 175, y: 0 }, { x: 175, y: 600 })] }));
    expect(sensed(walled, SESSION_A)).toEqual([]);
  });

  it("is what the Paladin's Divine Sense grants", () => {
    const action = actionOf(classFeature("paladin", "channel-divinity")?.actions, "divine-sense");
    expect(action.grants?.detects).toEqual(divineSense.detects);
  });
});

describe("Boon of the Night Spirit", () => {
  const boon = sheet([], ["boon-of-the-night-spirit"]);
  const merge = actionOf(library.featRecord("boon-of-the-night-spirit")?.feature.actions, "merge-with-shadows");

  it("resists all damage but Psychic and Radiant in Dim Light or Darkness", () => {
    const fire = { amount: 10, parts: [{ amount: 10, type: "fire" }] };
    const radiant = { amount: 10, parts: [{ amount: 10, type: "radiant" }] };
    const at = (ambient: "bright" | "dim" | "dark", input: typeof fire) =>
      previewDamage(visionGame({ ambient, actors: { [HERO]: { definitionId: SHEET } } }), HERO, input, {
        resolveDefinition: resolver(boon),
        catalog
      }).totalApplied;
    expect(at("dark", fire)).toBe(5);
    expect(at("dim", fire)).toBe(5);
    expect(at("dark", radiant)).toBe(10);
    expect(at("bright", fire)).toBe(10);
  });

  it("merges with the shadows only out of Bright Light, and the next action ends it", () => {
    const use = (state: GameState) =>
      resolveDefinitionAction(
        state,
        merge,
        { actorId: HERO, targetIds: [], commandId: commandId(), rollMode: null, override: null },
        deps(state, boon)
      );
    const lit = visionGame({ actors: { [HERO]: { definitionId: SHEET } } });
    expect(() => use(lit)).toThrowError(/Bright Light/);
    const dark = visionGame({ ambient: "dark", actors: { [HERO]: { definitionId: SHEET } } });
    use(dark);
    const hero = () => dark.actors.find((actor) => actor.id === HERO)!;
    expect(hero().conditions.map((condition) => condition.id)).toContain("invisible");
    resolveDefinitionAction(
      dark,
      builtinAction("dodge")!,
      { actorId: HERO, targetIds: [], commandId: commandId(), builtin: true, rollMode: null, override: null },
      deps(dark, boon)
    );
    expect(hero().conditions.map((condition) => condition.id)).not.toContain("invisible");
  });
});

describe("One with Shadows", () => {
  it("casts its Invisibility without a slot only in Dim Light or Darkness", () => {
    const warlock = sheet([{ id: "one-with-shadows", kind: "option", sourceId: "eldritch-invocations" }]);
    const cast: ActorAction = {
      id: "spell-invisibility-free",
      name: "Invisibility (no slot)",
      activation: "action",
      description: "",
      damage: [],
      spellId: "invisibility"
    } as ActorAction;
    const state = visionGame({ actors: { [HERO]: { definitionId: SHEET } } });
    expect(() =>
      resolveDefinitionAction(
        state,
        cast,
        { actorId: HERO, targetIds: [HERO], commandId: commandId(), rollMode: null, override: null },
        deps(state, warlock)
      )
    ).toThrowError(/needs Dim Light or darkness/);
  });
});

describe("stat blocks and items", () => {
  it("brings an invisible stalker to the roster Invisible", () => {
    const state = visionGame();
    const id = "10000000-0000-4000-8000-0000000000aa";
    addActorFromDefinition(state, monster("invisible-stalker")!, id, "public");
    const stalker = state.actors.find((actor) => actor.id === id)!;
    expect(stalker.conditions.map((condition) => condition.id)).toEqual(["invisible"]);
  });

  it("gives a Belt of Dwarvenkind's wearer Darkvision 60 feet and lights a Sun Blade with sunlight", () => {
    const item = (catalogId: string, extra: Record<string, unknown> = {}) => ({
      id: catalogId,
      name: catalogId,
      quantity: 1,
      equipped: true,
      attuned: true,
      ...extra
    });
    const state = visionGame({
      actors: { [HERO]: { inventory: [item("belt-of-dwarvenkind"), item("sun-blade", { lit: true })] } }
    });
    const hero = state.actors[0]!;
    expect(sensesOf(state, hero, { catalog }).darkvision).toBe(60);
    expect(carriedLightsOf(state, hero, { catalog })).toEqual([
      expect.objectContaining({ brightFeet: 15, dimFeet: 15, sunlight: true })
    ]);
  });
});

describe("saves that need their source seen", () => {
  const ghost = monster("ghost")!;
  const visage = actionOf(ghost.actions, "horrific-visage");
  const saveOwed = (state: GameState) => state.combat.pendingSaves.map((save) => save.targetActorId);

  it("asks only the creatures that can see the ghost to save against its Horrific Visage", () => {
    const state = visionGame({
      positions: { [GOBLIN]: cell(3, 5), [FRIEND]: cell(1, 4) },
      actors: { [GOBLIN]: { definitionId: "ghost" }, [FRIEND]: { conditions: [{ id: "blinded" }] } }
    });
    state.combat.turnActorId = GOBLIN;
    const result = resolveDefinitionAction(
      state,
      visage,
      { actorId: GOBLIN, targetIds: [HERO, FRIEND], commandId: commandId(), rollMode: null, override: null },
      { ...deps(state, ghost), definition: ghost }
    );
    expect(saveOwed(state)).toEqual([HERO]);
    expect(result.warnings).toContain("Mirena can't see Skulking Goblin, so Horrific Visage doesn't affect it.");
  });

  it("leaves out a creature in the dark from a pattern it can't see", () => {
    const pattern = {
      id: "pattern",
      name: "Pattern",
      activation: "action",
      description: "Each creature in the area who can see the pattern makes a Wisdom saving throw.",
      damage: [],
      save: { ability: "wis", dc: 13, successDamage: "none", failureConditions: ["charmed"] },
      sight: { seenBy: "area" }
    } as ActorAction;
    const goblin = monster("goblin-warrior")!;
    const run = (options: Parameters<typeof visionGame>[0]) => {
      const state = visionGame({ positions: { [FRIEND]: cell(9, 5) }, ...options });
      state.combat.turnActorId = GOBLIN;
      resolveDefinitionAction(
        state,
        pattern,
        { actorId: GOBLIN, targetIds: [HERO, FRIEND], commandId: commandId(), rollMode: null, override: null },
        { ...deps(state, goblin), definition: goblin }
      );
      return saveOwed(state);
    };
    // A light over the friend shows it the pattern; the hero stands in the dark beyond it.
    const lit = {
      id: "50000000-0000-4000-8000-0000000000c1",
      position: cell(9, 5),
      actorId: null,
      brightFeet: 10,
      dimFeet: 0
    };
    expect(run({ ambient: "dark", lights: [lit] })).toEqual([FRIEND]);
    expect(run({ enabled: false, actors: { [HERO]: { conditions: [{ id: "blinded" }] } } })).toEqual([FRIEND]);
  });
});
