import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { setCondition } from "../src/actor-conditions.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { RulesBlockedError } from "../src/game-store.js";
import {
  catalogRow,
  fight as gearFight,
  IDS,
  resolveAt,
  tableOf,
  wizardInput as gearWizard,
  write
} from "./equipment-table.js";
import { build, catalog, clericInput, fight, FOE, FOE2, HERO } from "./spell-casters.js";

// SRD 5.2.1 Spells, "Targets": "a creature you can see" is checked whether or not the map's vision is on (Blinded,
// Invisible, the senses by distance), and "If you cast a spell on someone or something that can't be affected by the
// spell, nothing happens to that target, but if you used a spell slot to cast the spell, the slot is still expended."

const library = new ContentLibrary();
const monster = (slug: string) => library.monsterForInstance(slug);
const GM = { role: "gm" } as const;
const cleric = build(clericInput(["hold-person", "bless"]));

/** The Cleric in a fight with a Wolf (a Beast) and a Bandit (a Humanoid), every pair `apart` feet apart. */
function table(apart = 30) {
  const setup = fight(cleric);
  const wolf = setup.state.actors.find((actor) => actor.id === FOE)!;
  const bandit = setup.state.actors.find((actor) => actor.id === FOE2)!;
  Object.assign(wolf, { name: "Wolf", definitionId: "wolf" });
  Object.assign(bandit, { name: "Bandit", definitionId: "bandit" });
  setup.state.combat = { ...setup.state.combat, ruleExceptions: { targeting: "strict" } };
  let command = 0;
  const cast = (actionId: string, input: Partial<ResolveInput>) =>
    resolveDefinitionAction(
      setup.state,
      setup.action(actionId),
      { actorId: HERO, targetIds: [FOE2], commandId: `cmd-${(command += 1)}`, ...input },
      {
        random: () => 3,
        newRollId: () => `40000000-0000-4000-8000-${String((command += 1)).padStart(12, "0")}`,
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-19T00:00:00.000Z",
        definition: cleric,
        catalog,
        resolveDefinition: monster,
        distanceFeet: () => apart
      }
    );
  return { ...setup, cast };
}

const slotsOf = (state: GameState, level: number) =>
  state.actors.find((actor) => actor.id === HERO)!.spellSlots?.find((slot) => slot.level === level)?.remaining;

/** A live sense on the caster, as True Seeing or a feature would give it. */
function sense(state: GameState, name: "blindsight" | "see-invisibility", feet: number) {
  addEffect(
    state,
    HERO,
    makeEffect({
      id: `sense-${name}-${feet}`,
      name: "Keen senses",
      duration: { type: "manual" },
      modifiers: [{ type: "sense", sense: name, feet }]
    })
  );
}

describe("a creature the caster can see, with the map's vision off", () => {
  it("refuses a Blinded Cleric's Hold Person, unless its Blindsight reaches the target", () => {
    const { state, cast } = table(10);
    setCondition(state, HERO, "blinded", true, undefined, GM);
    expect(() => cast("spell-hold-person", {})).toThrowError(
      /Mira can't see Bandit, and Hold Person needs a target Mira can see/
    );
    sense(state, "blindsight", 10);
    expect(cast("spell-hold-person", {}).save?.targets).toEqual([expect.objectContaining({ targetName: "Bandit" })]);
  });

  it("refuses Hold Person at an Invisible Bandit, unless See Invisibility reaches it", () => {
    const { state, cast } = table(30);
    setCondition(state, FOE2, "invisible", true, undefined, GM);
    expect(() => cast("spell-hold-person", {})).toThrow(RulesBlockedError);
    sense(state, "see-invisibility", 20);
    expect(() => cast("spell-hold-person", {})).toThrow(/needs a target Mira can see/);
    sense(state, "see-invisibility", 60);
    expect(cast("spell-hold-person", {}).save?.targets).toHaveLength(1);
  });

  it("refuses a thrown flask at an Invisible creature the thrower can't see", () => {
    const gear = tableOf({ [IDS.wizard]: gearWizard() });
    write(gear, IDS.wizard, catalogRow("holy-water", { equipped: false }));
    gearFight(gear, IDS.wizard);
    gear.state.combat = { ...gear.state.combat, ruleExceptions: { targeting: "strict" } };
    setCondition(gear.state, IDS.foe, "invisible", true, undefined, GM);
    expect(() => resolveAt(gear, IDS.wizard, "item-holy-water-throw", [3, 3])).toThrow(
      /Throw Holy Water targets a creature \w+ can see/
    );
  });
});

describe("a target of a type the spell can't affect", () => {
  it("spends Hold Person's slot on a Wolf, which makes no save, and names no type to the caster", () => {
    const { state, cast } = table();
    const before = slotsOf(state, 2)!;
    const resolution = cast("spell-hold-person", { targetIds: [FOE] });
    expect(slotsOf(state, 2)).toBe(before - 1);
    expect(resolution.save?.targets ?? []).toEqual([]);
    expect(state.combat.pendingSaves).toEqual([]);
    expect(resolution.warnings).toContain("Hold Person has no effect on Wolf.");
    expect(resolution.warnings?.join(" ")).not.toMatch(/Beast|Humanoid/);
    // The GM's line names the type, and only the GM reads it.
    expect(resolution.tableNarration).toContainEqual(
      expect.objectContaining({
        text: "Wolf is a Beast, and Hold Person affects only Humanoids, so nothing happens to it.",
        gmOnly: true
      })
    );
  });

  it("takes the Humanoid of two upcast targets and leaves the Beast untouched", () => {
    const { state, cast } = table();
    const resolution = cast("spell-hold-person", { targetIds: [FOE, FOE2], slotLevel: 3 });
    expect(resolution.save?.targets.map((target) => target.targetName)).toEqual(["Bandit"]);
    expect(state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([FOE2]);
  });
});

describe("Holy Water", () => {
  function holyWater(definitionId: string) {
    const gear = tableOf({ [IDS.wizard]: gearWizard() });
    write(gear, IDS.wizard, catalogRow("holy-water", { quantity: 2, equipped: false }));
    const foe = gear.actor(IDS.foe);
    foe.definitionId = definitionId;
    gear.state.definitions.push({ id: definitionId, definition: monster(definitionId)! } as never);
    gearFight(gear, IDS.wizard);
    return gear;
  }
  const flasks = (gear: ReturnType<typeof holyWater>) =>
    gear.actor(IDS.wizard).inventory.find((row) => row.id === "holy-water")?.quantity;

  it("is thrown at a Humanoid, used up, and deals nothing", () => {
    const gear = holyWater("bandit");
    const thrown = resolveAt(gear, IDS.wizard, "item-holy-water-throw", [3, 3]);
    expect(flasks(gear)).toBe(1);
    expect(gear.state.combat.pendingSaves).toEqual([]);
    expect(thrown.warnings).toContain("Throw Holy Water has no effect on Foe.");
  });

  it("asks a Zombie for the Dexterity save against 2d8 Radiant", () => {
    const gear = holyWater("zombie");
    resolveAt(gear, IDS.wizard, "item-holy-water-throw", [4, 5]);
    expect(flasks(gear)).toBe(1);
    expect(gear.state.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: IDS.foe, ability: "dex", proposedDamage: 9 })
    ]);
  });
});
