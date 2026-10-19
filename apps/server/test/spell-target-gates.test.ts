import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { MASKED_TYPE_TAG, type ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { RulesBlockedError } from "../src/game-store.js";
import { castAreaOf } from "../src/item-actions.js";
import { liveAbilityScores } from "../src/live-abilities.js";
import { creatureTypeOf } from "../src/statblock-facts.js";
import { catalogRow } from "./equipment-table.js";
import { ALLY, build, castOf, catalog, clericInput, fight, FOE, FOE2, HERO, view } from "./spell-casters.js";

// SRD 5.2.1 spells whose targets the text limits: a Tiny Beast (Animal Messenger), an Intelligence of 3 or less
// (Awaken), the caster or a willing creature (Light, Continual Flame, Nondetection, Arcanist's Magic Aura), wards
// against Divination spells (Nondetection, an Amulet of Proof against Detection and Location), a save only an unwilling
// creature makes (Levitate, Seeming), a masked creature type (Arcanist's Magic Aura), and Truesight against a visual
// illusion (Hypnotic Pattern).

const library = new ContentLibrary();
const monster = (slug: string) => library.monsterForInstance(slug);

function spellAction(spellId: string): ActorAction {
  const spell = view.spellRecord(spellId)!;
  const cast = castOf(spellId);
  return { ...cast, id: `spell-${spellId}`, spellId, ...castAreaOf(spell, cast) };
}

let count = 0;
function cast(state: GameState, spellId: string, input: Partial<ResolveInput>, by = HERO, apart = 5) {
  return resolveDefinitionAction(
    state,
    spellAction(spellId),
    { actorId: by, targetIds: [FOE], commandId: `cmd-${spellId}-${(count += 1)}`, ...input },
    {
      random: () => 3,
      newRollId: () => `40000000-0000-4000-8000-${String((count += 1)).padStart(12, "0")}`,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      catalog,
      resolveDefinition: monster,
      distanceFeet: () => apart
    }
  );
}

const cleric = build(clericInput(["bless", "cure-wounds"]));
/** A fight with two foes of the given stat blocks and a party ally (a character with no sheet). */
function table(foe = "wolf", foe2 = "bandit", combat = true) {
  const setup = fight(cleric, { ally: true, combat });
  const actor = (id: string) => setup.state.actors.find((candidate) => candidate.id === id)!;
  Object.assign(actor(FOE), { name: monster(foe)!.name, definitionId: foe, size: monster(foe)!.size });
  Object.assign(actor(FOE2), { name: monster(foe2)!.name, definitionId: foe2, size: monster(foe2)!.size });
  Object.assign(actor(ALLY), { kind: "player-character" });
  setup.state.combat = { ...setup.state.combat, ruleExceptions: { targeting: "strict" } };
  return { ...setup, actor };
}

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof RulesBlockedError) return error.message;
    throw error;
  }
  return null;
};

describe("Animal Messenger", () => {
  it("targets a Tiny Beast only, which succeeds outright unless its Challenge Rating is 0", () => {
    const wolf = table("wolf", "cat");
    expect(refusal(() => cast(wolf.state, "animal-messenger", {}))).toMatch(
      /Wolf is too large for Animal Messenger, which targets a Tiny creature or smaller/
    );
    const snake = table("venomous-snake", "cat");
    cast(snake.state, "animal-messenger", {});
    expect(snake.state.combat.pendingSaves[0]).toMatchObject({ autoSucceeds: "Challenge Rating above 0" });
    const cat = table("wolf", "cat");
    cast(cat.state, "animal-messenger", { targetIds: [FOE2] });
    expect(cat.state.combat.pendingSaves[0]?.autoSucceeds).toBeUndefined();
  });
});

describe("Awaken", () => {
  // Its 8 hours are cast outside a fight, where the cast completes as the game clock moves.
  it("raises a wolf's Intelligence to 10 for good and charms it until the caster's side damages it", () => {
    const { state, actor } = table("wolf", "ape", false);
    cast(state, "awaken", {});
    const wolf = actor(FOE);
    expect(liveAbilityScores(wolf, monster("wolf")!, catalog).int).toBe(10);
    expect(wolf.effects.find((effect) => effect.name === "Awakened")?.duration).toEqual({ type: "manual" });
    const charmed = wolf.effects.find((effect) => effect.linkedConditionIds.includes("charmed"))!;
    expect(charmed).toMatchObject({ endsOnSourceSideDamage: true, duration: { type: "minutes", remaining: 43_200 } });
  });

  it("does nothing to an ape, whose Intelligence is 6, and tells only the GM why", () => {
    const { state, actor } = table("wolf", "ape", false);
    const resolution = cast(state, "awaken", { targetIds: [FOE2] });
    expect(actor(FOE2).effects).toEqual([]);
    expect(resolution.warnings).toContain("Awaken has no effect on Ape.");
    expect(resolution.tableNarration).toContainEqual(
      expect.objectContaining({
        text: "Ape's Intelligence is 6, and Awaken affects only a creature with 3 or less, so nothing happens to it.",
        gmOnly: true
      })
    );
  });
});

describe("a save only an unwilling creature makes", () => {
  it("lifts an ally with Levitate and gives an enemy its Constitution save", () => {
    const { state, actor } = table();
    cast(state, "levitate", { targetIds: [ALLY] });
    expect(actor(ALLY).effects.some((effect) => effect.tags.includes("levitating"))).toBe(true);
    expect(state.combat.pendingSaves).toEqual([]);
    const enemy = table();
    cast(enemy.state, "levitate", { targetIds: [FOE2] });
    expect(enemy.state.combat.pendingSaves).toEqual([expect.objectContaining({ targetActorId: FOE2, ability: "con" })]);
  });

  it("asks only the enemy among Seeming's targets for the Charisma save", () => {
    const { state } = table();
    cast(state, "seeming", { targetIds: [ALLY, FOE2] });
    expect(state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([FOE2]);
  });
});

describe("Light and Continual Flame", () => {
  it("light the caster's or a willing creature's object, never an enemy's", () => {
    for (const spellId of ["light", "continual-flame"]) {
      expect(refusal(() => cast(table().state, spellId, { targetIds: [FOE2] }))).toMatch(
        /targets Mira or a willing creature, and Bandit isn't willing/
      );
      expect(() => cast(table().state, spellId, { targetIds: [ALLY] })).not.toThrow();
      expect(() => cast(table().state, spellId, { targetIds: [HERO] })).not.toThrow();
    }
  });
});

describe("wards against Divination spells", () => {
  it("keeps Mind Spike off a creature under Nondetection, and lets Sacred Flame through", () => {
    const { state } = table();
    cast(state, "nondetection", { targetIds: [ALLY] });
    // The warded creature changes sides for the test, so the cleric's harm aims at it.
    const warded = table();
    addEffect(
      warded.state,
      FOE2,
      makeEffect({
        id: "nondetection",
        name: "Nondetection",
        duration: { type: "manual" },
        modifiers: [{ type: "spell-ward", schools: ["divination"] }]
      })
    );
    expect(refusal(() => cast(warded.state, "mind-spike", { targetIds: [FOE2] }))).toMatch(
      /A ward keeps Mind Spike from targeting Bandit/
    );
    expect(refusal(() => cast(warded.state, "sacred-flame", { targetIds: [FOE2] }))).toBeNull();
    expect(state.actors.find((actor) => actor.id === ALLY)!.effects).toContainEqual(
      expect.objectContaining({
        name: "Nondetection",
        modifiers: [{ type: "spell-ward", schools: ["divination"] }]
      })
    );
  });

  it("lets an amulet's wearer allow its own side's Divination spell and keeps an enemy's off", () => {
    const { state, actor } = table();
    const amulet = catalogRow("amulet-of-proof-against-detection-and-location", { attuned: true });
    actor(ALLY).inventory = [amulet];
    expect(refusal(() => cast(state, "mind-spike", { targetIds: [ALLY] }))).toBeNull();
    const enemy = table();
    enemy.actor(HERO).inventory = [...enemy.actor(HERO).inventory, amulet];
    // The bandit casts at the cleric, who wears the amulet.
    enemy.state.combat = { ...enemy.state.combat, turnActorId: FOE2 };
    expect(refusal(() => cast(enemy.state, "mind-spike", { targetIds: [HERO] }, FOE2))).toMatch(
      /A ward keeps Mind Spike from targeting Mira/
    );
  });
});

describe("Arcanist's Magic Aura's Mask", () => {
  it("makes spells read the creature type the caster picks, while Animal Handling reads the true one", () => {
    const { state, actor } = table();
    cast(state, "arcanists-magic-aura", { targetIds: [ALLY], optionId: "undead" });
    const masked = actor(ALLY);
    expect(masked.effects.some((effect) => effect.tags.includes(`${MASKED_TYPE_TAG}undead`))).toBe(true);
    expect(creatureTypeOf(masked, undefined)).toBe("undead");
    expect(creatureTypeOf(masked, undefined, "true")).toBe("humanoid");
    state.combat = { ...state.combat, turn: { ...state.combat.turn, actionUsed: false, actionInstance: null } };
    const held = cast(state, "hold-person", { targetIds: [ALLY] });
    expect(held.warnings).toContain("Hold Person has no effect on Bran.");
  });
});

describe("Truesight against a visual illusion", () => {
  it("succeeds on Hypnotic Pattern's save without a roll", () => {
    const { state } = table();
    addEffect(
      state,
      FOE2,
      makeEffect({
        id: "true-seeing",
        name: "True Seeing",
        duration: { type: "manual" },
        modifiers: [{ type: "sense", sense: "truesight", feet: 120 }]
      })
    );
    cast(state, "hypnotic-pattern", { targetIds: [FOE, FOE2], areaPlaced: true });
    const saves = state.combat.pendingSaves;
    expect(saves.find((save) => save.targetActorId === FOE2)).toMatchObject({ autoSucceeds: "Truesight" });
    expect(saves.find((save) => save.targetActorId === FOE)?.autoSucceeds).toBeUndefined();
  });
});
