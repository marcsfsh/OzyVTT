import { describe, expect, it } from "vitest";
import type { ActorAction } from "@vtt/schemas";
import { answerSave } from "../src/saving-throws.js";
import { builtinActionFor, builtinActionsFor } from "../src/builtin-actions.js";
import { effectiveActions } from "../src/effective-actions.js";
import { endEffect } from "../src/effects.js";
import { setInventoryItem } from "../src/inventory.js";
import {
  actionOf,
  actorOf,
  BRAN,
  catalog,
  giveEffect,
  IMP,
  resolve,
  resolveDefinitionOf,
  table,
  WREN,
  wrenSheet,
  ZOMBIE,
  type Table
} from "./effect-vocabulary-kit.js";

// Choices made at the cast or use and kept on the effect (an option, one for each target, the weapon it binds to),
// what an effect adds besides (conditions it holds off, an action that ends it, Bonus Action Dashes, a spell's action
// on another creature), and the ways out of an effect another creature takes (Shake Awake).

const grantBase = {
  tags: [],
  duration: { type: "manual" },
  modifiers: [],
  onEnd: [],
  voidWhileIncapacitated: false,
  concentration: false
} as const;

/** A self grant with two options: warm (Resistance to Cold) or chill (Resistance to Fire), as Fire Shield. */
const SHIELD: ActorAction = {
  id: "shield-test",
  name: "Test Shield",
  activation: "action",
  description: "Test.",
  damage: [],
  grants: {
    ...grantBase,
    name: "Test Shield",
    target: "self",
    options: [
      {
        id: "warm",
        name: "Warm Shield",
        tags: [],
        modifiers: [{ type: "damage-resistance", damageTypes: ["cold"] }]
      },
      {
        id: "chill",
        name: "Chill Shield",
        tags: [],
        modifiers: [{ type: "damage-resistance", damageTypes: ["fire"] }]
      }
    ]
  }
} as unknown as ActorAction;

/** A grant on every target with a pick for each (Enhance Ability's ability per target). */
const PER_TARGET: ActorAction = {
  id: "per-target-test",
  name: "Test Boon",
  activation: "action",
  description: "Test.",
  damage: [],
  grants: {
    ...grantBase,
    name: "Test Boon",
    target: "targets",
    optionsPerTarget: true,
    options: [
      { id: "fast", name: "Fast", tags: ["fast"], modifiers: [{ type: "speed", amount: 10 }] },
      { id: "tough", name: "Tough", tags: ["tough"], modifiers: [{ type: "armor-class", amount: 1 }] }
    ]
  }
} as unknown as ActorAction;

/** A save whose failure the caster picks for each target (Eyebite's Asleep or Sickened). */
const GAZE: ActorAction = {
  id: "gaze-test",
  name: "Test Gaze",
  activation: "action",
  description: "Test.",
  damage: [],
  save: {
    ability: "wis",
    dc: 30,
    successDamage: "none",
    failureConditions: [],
    failureEffect: {
      name: "Test Gaze",
      tags: [],
      modifiers: [],
      optionsPerTarget: true,
      options: [
        {
          id: "asleep",
          name: "Asleep",
          tags: ["wakeable"],
          modifiers: [],
          conditions: ["unconscious"],
          endsOnDamage: true
        },
        {
          id: "sickened",
          name: "Sickened",
          tags: [],
          modifiers: [{ type: "roll-mode", roll: "attack", mode: "disadvantage" }]
        }
      ]
    }
  }
} as unknown as ActorAction;

/** Fails each pending save of `targetId` with a 1. */
function failSaves(built: Table, targetId: string) {
  for (const pending of built.state.combat.pendingSaves.filter((entry) => entry.targetActorId === targetId))
    answerSave(
      built.state,
      crypto.randomUUID(),
      pending.id,
      "roll",
      undefined,
      true,
      { role: "gm" },
      {
        random: () => 1,
        newRollId: () => crypto.randomUUID(),
        sessionId: "30000000-0000-4000-8000-00000000000a",
        role: "gm",
        now: () => "2026-10-19T00:00:00.000Z",
        resolveDefinition: resolveDefinitionOf(built),
        catalog
      }
    );
}

describe("options picked as an effect is granted", () => {
  it("keeps the pick on the effect, in its name and with what it adds", () => {
    const built = table();
    resolve(built, SHIELD, { targetIds: [], optionId: "chill" });
    const effect = actorOf(built.state, WREN).effects.find((entry) => entry.optionId === "chill")!;
    expect(effect.name).toBe("Test Shield (Chill Shield)");
    expect(effect.modifiers).toContainEqual({ type: "damage-resistance", damageTypes: ["fire"] });
  });

  it("takes the first option with a note when none is picked, and refuses one the action doesn't offer", () => {
    const built = table();
    const result = resolve(built, SHIELD, { targetIds: [] });
    expect(actorOf(built.state, WREN).effects.some((entry) => entry.optionId === "warm")).toBe(true);
    expect((result.warnings ?? []).join(" ")).toContain("nothing was picked, so it is Warm Shield");
    expect(() => resolve(table(), SHIELD, { targetIds: [], optionId: "lukewarm" })).toThrow(
      "Test Shield doesn't offer that choice."
    );
  });

  it("gives each target its own pick", () => {
    const built = table();
    resolve(built, PER_TARGET, { targetIds: [WREN, BRAN], targetOptions: { [WREN]: "tough", [BRAN]: "fast" } });
    expect(actorOf(built.state, WREN).effects.find((entry) => entry.name.startsWith("Test Boon"))?.optionId).toBe(
      "tough"
    );
    const bran = actorOf(built.state, BRAN).effects.find((entry) => entry.name.startsWith("Test Boon"))!;
    expect(bran.optionId).toBe("fast");
    expect(bran.tags).toContain("fast");
    expect(() => resolve(table(), PER_TARGET, { targetIds: [WREN], targetOptions: { [BRAN]: "fast" } })).toThrow(
      "Each choice must be for one of the action's targets."
    );
  });

  it("gives each target of a save the failure picked for it", () => {
    const built = table();
    resolve(built, GAZE, { targetIds: [ZOMBIE, IMP], targetOptions: { [ZOMBIE]: "asleep", [IMP]: "sickened" } });
    const pending = built.state.combat.pendingSaves;
    expect(pending.find((entry) => entry.targetActorId === ZOMBIE)?.onFailEffect?.optionId).toBe("asleep");
    expect(pending.find((entry) => entry.targetActorId === IMP)?.onFailEffect?.name).toBe("Test Gaze (Sickened)");
    failSaves(built, ZOMBIE);
    const zombie = actorOf(built.state, ZOMBIE);
    expect(zombie.conditions.map((entry) => entry.id)).toContain("unconscious");
    const asleep = zombie.effects.find((entry) => entry.optionId === "asleep")!;
    expect(asleep.endsOnDamage).toBe(true);
    expect(asleep.tags).toContain("wakeable");
  });
});

describe("conditions an effect holds off", () => {
  /** Calm Emotions' first choice: immune to Charmed and Frightened, and one it has is held off. */
  const CALM: ActorAction = {
    id: "calm-test",
    name: "Test Calm",
    activation: "action",
    description: "Test.",
    damage: [],
    grants: {
      ...grantBase,
      name: "Test Calm",
      target: "target",
      conditionImmunities: ["charmed", "frightened"],
      suppressesConditions: ["charmed", "frightened"]
    }
  } as unknown as ActorAction;

  it("holds a condition off while it lasts and gives it back after", () => {
    const built = table();
    const wren = actorOf(built.state, WREN);
    wren.conditions = [{ id: "frightened" }];
    resolve(built, CALM, { targetIds: [WREN] });
    expect(wren.conditions).toEqual([]);
    const calm = wren.effects.find((entry) => entry.name === "Test Calm")!;
    expect(calm.suppressedConditions).toEqual([{ id: "frightened", standalone: true }]);
    const events = endEffect(built.state, WREN, calm.id);
    expect(wren.conditions.map((entry) => entry.id)).toEqual(["frightened"]);
    expect(events.map((event) => event.text)).toContain("Wren is Frightened again (Test Calm ended).");
  });

  it("doesn't give back one whose own effect ended meanwhile", () => {
    const built = table();
    giveEffect(built, WREN, [], { name: "Fear", linkedConditionIds: ["frightened"] });
    const wren = actorOf(built.state, WREN);
    resolve(built, CALM, { targetIds: [WREN] });
    const fear = wren.effects.find((entry) => entry.name === "Fear")!;
    endEffect(built.state, WREN, fear.id);
    endEffect(built.state, WREN, wren.effects.find((entry) => entry.name === "Test Calm")!.id);
    expect(wren.conditions.map((entry) => entry.id)).not.toContain("frightened");
  });
});

describe("a grant bound to one weapon", () => {
  /** Magic Weapon: a nonmagical weapon, +1 to its attack and damage rolls, +2 from a level 3 slot. */
  const MAGIC_WEAPON: ActorAction = {
    id: "magic-weapon-test",
    name: "Test Magic Weapon",
    activation: "bonus-action",
    description: "Test.",
    damage: [],
    grants: {
      ...grantBase,
      name: "Test Magic Weapon",
      target: "self",
      bindsWeapon: {
        nonmagical: true,
        bonusBySlot: [
          { level: 1, bonus: 1 },
          { level: 3, bonus: 2 }
        ]
      }
    }
  } as unknown as ActorAction;
  /** Shillelagh on a Club: the spellcasting ability, a d8 that grows with level, and Force on a hit. */
  const SHILLELAGH: ActorAction = {
    id: "shillelagh-test",
    name: "Test Shillelagh",
    activation: "bonus-action",
    description: "Test.",
    damage: [],
    grants: {
      ...grantBase,
      name: "Test Shillelagh",
      target: "self",
      bindsWeapon: {
        weaponIds: ["club", "quarterstaff"],
        ability: "wis",
        dice: [
          { level: 1, formula: "1d8" },
          { level: 5, formula: "1d10" }
        ],
        damageTypes: ["force"]
      }
    }
  } as unknown as ActorAction;
  const CLUB = {
    id: "club",
    name: "Club",
    quantity: 1,
    equipped: true,
    attuned: false,
    category: "weapon",
    weapon: {
      category: "simple",
      damageDice: "1d4",
      damageType: "bludgeoning",
      rangeFeet: null,
      longRangeFeet: null,
      melee: true,
      properties: ["light"]
    }
  };

  it("adds its bonus to that weapon's row alone, and ends once the row is gone", () => {
    const built = table();
    resolve(built, MAGIC_WEAPON, { targetIds: [], itemId: "greatsword" });
    const effect = actorOf(built.state, WREN).effects.find((entry) => entry.name === "Test Magic Weapon")!;
    expect(effect.itemId).toBe("greatsword");
    const swing = actionOf(built, "item-greatsword");
    // Str +4, proficiency +3, the spell's +1.
    expect(swing.attack?.bonus).toBe(8);
    expect(swing.damage[0]?.formula).toBe("2d6 + 5");
    setInventoryItem(built.state, WREN, { ...actorOf(built.state, WREN).inventory[0]!, quantity: 0 }, (id) =>
      built.definitions.get(id)
    );
    expect(actorOf(built.state, WREN).effects.some((entry) => entry.name === "Test Magic Weapon")).toBe(false);
  });

  it("swings with the lent ability and die, and offers its damage type", () => {
    const built = table(wrenSheet({ abilityScores: { str: 8, dex: 12, con: 14, int: 10, wis: 16, cha: 8 } }), {
      wren: { inventory: [CLUB] }
    });
    resolve(built, SHILLELAGH, { targetIds: [], itemId: "club" });
    const swing = actionOf(built, "item-club");
    // Wisdom +3 in place of Strength -1, the level 5 die.
    expect(swing.damage[0]?.formula).toBe("1d10 + 3");
    expect(swing.attack?.bonus).toBe(6);
    expect(swing.damageTypes).toEqual(["bludgeoning", "force"]);
  });

  it("refuses a weapon it can't be cast on", () => {
    expect(() => resolve(table(), SHILLELAGH, { targetIds: [], itemId: "greatsword" })).toThrow(
      "Test Shillelagh can't be cast on Greatsword: it works only on club or quarterstaff."
    );
  });
});

describe("actions an effect offers", () => {
  it("offers a Dash as a Bonus Action while it lasts", () => {
    const built = table();
    giveEffect(built, WREN, [], { name: "Expeditious Retreat", bonusActions: ["dash"] });
    const dash = builtinActionFor(built.definition, "dash-bonus", actorOf(built.state, WREN));
    expect(dash?.name).toBe("Expeditious Retreat: Dash");
    expect(builtinActionFor(built.definition, "dash-bonus")).toBeUndefined();
  });

  it("ends an effect on a check made with its action", () => {
    const built = table();
    giveEffect(built, WREN, [], {
      name: "Maze",
      tags: ["maze"],
      endAction: {
        activation: "action",
        kind: "check",
        ability: "int",
        skill: "investigation",
        dc: 5,
        label: "Find the way out"
      }
    });
    const wren = actorOf(built.state, WREN);
    const end = builtinActionsFor(built.definition, wren).find((action) => action.id === "end-effect")!;
    expect(end.name).toBe("Find the way out (Maze)");
    expect(end.description).toBe("End Maze with a DC 5 Intelligence (Investigation) check. A success ends it.");
    resolve(built, end, { targetIds: [], builtin: true }, [10]);
    expect(wren.effects.some((entry) => entry.name === "Maze")).toBe(false);
  });

  it("owes a save on the effect for its action, a success ending it", () => {
    const built = table();
    const dance = giveEffect(built, WREN, [], {
      name: "Irresistible Dance",
      endAction: { activation: "action", kind: "save", ability: "wis", dc: 15, label: "Collect itself" }
    });
    const end = builtinActionFor(built.definition, "end-effect", actorOf(built.state, WREN))!;
    resolve(built, end, { targetIds: [], builtin: true });
    const pending = built.state.combat.pendingSaves.find((entry) => entry.targetActorId === WREN)!;
    expect(pending).toMatchObject({ ability: "wis", dc: 15, repeatOf: { actorId: WREN, effectId: dance.id } });
  });

  it("shakes a creature out of a magical sleep within 5 feet", () => {
    const built = table();
    giveEffect(built, ZOMBIE, [], { name: "Asleep", tags: ["wakeable"], linkedConditionIds: ["unconscious"] });
    const shake = builtinActionFor(built.definition, "shake-awake")!;
    expect(() => resolve(built, shake, { targetIds: [ZOMBIE], builtin: true }, [], WREN, 10)).toThrow(
      "Zombie is more than 5 feet away."
    );
    resolve(built, shake, { targetIds: [ZOMBIE], builtin: true });
    expect(actorOf(built.state, ZOMBIE).effects.some((entry) => entry.name === "Asleep")).toBe(false);
    expect(() => resolve(built, shake, { targetIds: [IMP], builtin: true })).toThrow(
      "Imp isn't in a sleep a shake can end."
    );
  });

  it("gives the touched creature the spell's action at the cast's numbers and damage type", () => {
    const pouch = { id: "component-pouch", name: "Component Pouch", quantity: 1, equipped: true, attuned: false };
    const built = table(wrenSheet(), { wren: { inventory: [pouch] } });
    const breath: ActorAction = {
      id: "spell-dragons-breath",
      name: "Dragon's Breath",
      activation: "bonus-action",
      description: "Test.",
      damage: [],
      spellId: "dragons-breath",
      damageTypes: ["acid", "cold", "fire", "lightning", "poison"],
      grants: { ...grantBase, name: "Dragon's Breath", target: "target", grantsLaterAction: "exhale" }
    } as unknown as ActorAction;
    resolve(built, breath, { targetIds: [BRAN], damageType: "fire" });
    const bran = actorOf(built.state, BRAN);
    expect(bran.effects[0]?.grantedSpellAction).toMatchObject({
      spellId: "dragons-breath",
      level: 2,
      damageType: "fire"
    });
    const exhale = effectiveActions(undefined, bran, catalog).find(
      (action) => action.id === "spell-dragons-breath-then-exhale"
    )!;
    expect(exhale.damage).toEqual([{ formula: "3d6", type: "fire" }]);
    expect(exhale.damageTypes).toBeUndefined();
    expect(exhale.save?.dc).toBe(bran.effects[0]!.grantedSpellAction!.saveDc);
  });
});

describe("invisibility read against one creature", () => {
  it("drops Invisible when its bearer attacks, leaving the spell (Mislead)", () => {
    const built = table();
    giveEffect(built, WREN, [], {
      name: "Mislead",
      tags: ["invisible-until-it-acts"],
      linkedConditionIds: ["invisible"]
    });
    resolve(built, actionOf(built, "item-greatsword"), {}, [15, 3, 3]);
    const wren = actorOf(built.state, WREN);
    expect(wren.conditions.some((entry) => entry.id === "invisible")).toBe(false);
    expect(wren.effects.some((entry) => entry.name === "Mislead")).toBe(true);
  });

  it("gives an Invisible creature nothing against the caster it is outlined to (Mind Spike)", () => {
    const built = table();
    actorOf(built.state, ZOMBIE).conditions = [{ id: "invisible" }];
    giveEffect(built, ZOMBIE, [], { name: "Mind Spike", tags: ["outlined-to-source"], sourceActorId: WREN });
    const result = resolve(built, actionOf(built, "item-greatsword"), {}, [15, 3, 3]);
    expect(result.rollMode?.mode ?? "normal").toBe("normal");
    // Without the outline, Invisible gives the attack Disadvantage.
    const plain = table();
    actorOf(plain.state, ZOMBIE).conditions = [{ id: "invisible" }];
    expect(resolve(plain, actionOf(plain, "item-greatsword"), {}, [15, 3, 3]).rollMode?.mode).toBe("disadvantage");
  });
});
