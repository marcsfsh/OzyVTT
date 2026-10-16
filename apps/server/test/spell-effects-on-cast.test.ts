import { describe, expect, it } from "vitest";
import { armorClassInPlay, type GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { answerSave, createPendingSaves } from "../src/saving-throws.js";
import { currentSpeedFeet } from "../src/speed.js";
import {
  ALLY,
  build,
  catalog,
  clericInput,
  druidInput,
  fight,
  FOE,
  FOE2,
  HERO,
  heroTurnAgain,
  view,
  warlockInput,
  wizardInput,
  WIZARD_SPELLS
} from "./spell-casters.js";

// SRD 5.2.1 spells whose cast leaves an effect: Bless and Bane's d4 on attack rolls and saving throws, Shield of
// Faith's AC, Guiding Bolt's light, Hunter's Mark and Hex's extra damage, Faerie Fire's outline, Mage Armor and Haste.

const cleric = build(clericInput(["bless", "bane", "shield-of-faith", "guiding-bolt"]));
const wizard = build(wizardInput([...WIZARD_SPELLS.slice(0, 7), "mage-armor", "haste"]));

const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;
const definitions = (state: GameState) => (definitionId: string) =>
  state.definitions.find((entry) => entry.id === definitionId)?.definition;

/** A monster's plain melee attack, for a creature the hero's spell touched. */
const CLAW: ActorAction = {
  id: "claw",
  name: "Claw",
  activation: "action",
  description: "Claw.",
  attack: { bonus: 4, reachFeet: 5 },
  damage: [{ formula: "1d6", type: "slashing" }]
};

let commands = 0;
function strike(state: GameState, attackerId: string, targetId: string, faces: number[]) {
  return resolveDefinitionAction(
    state,
    CLAW,
    { actorId: attackerId, targetIds: [targetId], commandId: `strike-${(commands += 1)}`, commit: true },
    {
      random: () => faces.shift() ?? 1,
      newRollId: () => crypto.randomUUID(),
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-16T00:00:00.000Z",
      catalog,
      resolveDefinition: definitions(state)
    }
  );
}

/** A DC 15 save the creature owes, answered with the dice given. */
function save(state: GameState, targetId: string, ability: "dex" | "cha", faces: number[]) {
  createPendingSaves(state, {
    sourceActorId: FOE2,
    sourceName: "Orc",
    actionName: "Test",
    ability,
    dc: 15,
    targetIds: [targetId],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    newSaveId: () => crypto.randomUUID(),
    createdAt: 0
  });
  const pending = state.combat.pendingSaves.find((entry) => entry.targetActorId === targetId)!;
  return answerSuccessOrFailure(state, pending.id, faces);
}

function answerSuccessOrFailure(state: GameState, saveId: string, faces: number[]) {
  return answerSave(
    state,
    `answer-${(commands += 1)}`,
    saveId,
    "roll",
    undefined,
    true,
    { role: "gm" },
    {
      random: () => faces.shift() ?? 1,
      newRollId: () => crypto.randomUUID(),
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-16T00:00:00.000Z",
      resolveDefinition: definitions(state),
      catalog
    }
  ).outcome;
}

describe("Bless", () => {
  it("blesses each creature it targets, and adds 1d4 to the blessed caster's next attack roll", () => {
    const { state, resolve, action } = fight(wizard, { ally: true });
    const cast = resolve("spell-bless", { targetIds: [HERO, ALLY] });
    expect(cast.effectsApplied?.map((entry) => [entry.targetId, entry.name])).toEqual([
      [HERO, "Bless"],
      [ALLY, "Bless"]
    ]);
    expect(actorOf(state, ALLY).effects[0]).toMatchObject({ sourceActorId: HERO, duration: { remaining: 10 } });
    heroTurnAgain(state);
    const bolt = resolve("spell-fire-bolt", {}, [10, 2, 5]).attack!;
    expect(bolt.bonusDice).toEqual([{ label: "Bless", dice: "1d4", total: 2 }]);
    expect(bolt.total).toBe(10 + action("spell-fire-bolt").attack!.bonus + 2);
    expect(state.rolls.some((roll) => roll.label === "Fire Bolt: Bless" && roll.total === 2)).toBe(true);
  });

  it("leaves the d4 to roll on Confirm in a preview, and to the player in a typed total", () => {
    const { state, resolve, action } = fight(wizard);
    resolve("spell-bless", { targetIds: [HERO] });
    heroTurnAgain(state);
    const preview = resolve("spell-fire-bolt", { commit: false }, [10]).attack!;
    expect(preview.bonusDice).toEqual([{ label: "Bless", dice: "1d4", total: null }]);
    expect(preview.total).toBe(10 + action("spell-fire-bolt").attack!.bonus);
    const typed = resolve("spell-fire-bolt", { commit: false, attackTotal: 18 });
    expect(typed.attack!.total).toBe(18);
    expect(typed.warnings?.join(" ")).toMatch(/Bless \(1d4\): count it in the typed total/);
  });

  it("adds 1d4 to the blessed creature's saving throws", () => {
    const { state, resolve } = fight(wizard);
    resolve("spell-bless", { targetIds: [HERO] });
    // Dexterity 14, not proficient: +2, and the d4.
    expect(save(state, HERO, "dex", [10, 3]).total).toBe(15);
    expect(state.rolls.at(-1)?.formula).toBe("1d20 + 2 + 1d4");
  });

  it("counts once on a creature blessed twice", () => {
    const { state, resolve, hero } = fight(wizard);
    resolve("spell-bless", { targetIds: [HERO] });
    hero.effects = [...hero.effects, { ...hero.effects[0]!, id: "other-cast", sourceActorId: FOE2 }];
    heroTurnAgain(state);
    expect(resolve("spell-fire-bolt", {}, [10, 2, 5]).attack!.bonusDice).toHaveLength(1);
  });

  it("needs a creature to bless", () => {
    const { resolve } = fight(wizard);
    expect(() => resolve("spell-bless", { targetIds: [] })).toThrowError(/Choose the creatures/);
  });

  it("lands from a sheet built before spells carried their effects", () => {
    const older = structuredClone(cleric);
    older.actions = older.actions.map((entry) => {
      if (entry.id !== "spell-bless") return entry;
      const { grants: _grants, ...rest } = entry;
      return rest;
    });
    const { state, resolve } = fight(older);
    resolve("spell-bless", { targetIds: [FOE2] });
    expect(actorOf(state, FOE2).effects.map((effect) => effect.name)).toEqual(["Bless"]);
  });
});

describe("Bane", () => {
  it("takes 1d4 off the attack rolls and saves of each creature that fails its save", () => {
    const { state, resolve } = fight(cleric);
    resolve("spell-bane", { targetIds: [FOE, FOE2] });
    const [first, second] = state.combat.pendingSaves;
    expect(first!.onFailEffect).toMatchObject({ name: "Bane", duration: { type: "rounds", rounds: 10 } });
    expect(answerSuccessOrFailure(state, first!.id, [2]).success).toBe(false);
    expect(answerSuccessOrFailure(state, second!.id, [19]).success).toBe(true);
    expect(actorOf(state, FOE).effects.map((effect) => effect.name)).toEqual(["Bane"]);
    expect(actorOf(state, FOE2).effects).toEqual([]);
    nextInitiativeTurn(state);
    const claw = strike(state, FOE, HERO, [12, 3, 4]).attack!;
    expect(claw.bonusDice).toEqual([{ label: "Bane", dice: "-1d4", total: -3 }]);
    expect(claw.total).toBe(12 + 4 - 3);
    expect(save(state, FOE, "cha", [12, 1]).total).toBe(11);
  });
});

describe("Shield of Faith", () => {
  it("adds 2 to the creature's AC, once however many casters give it", () => {
    const { state, resolve } = fight(cleric, { ally: true });
    resolve("spell-shield-of-faith", { targetIds: [ALLY] });
    const ally = actorOf(state, ALLY);
    expect(armorClassInPlay(ally)).toBe(14);
    ally.effects = [...ally.effects, { ...ally.effects[0]!, id: "second-caster", sourceActorId: FOE2 }];
    expect(armorClassInPlay(ally)).toBe(14);
  });
});

describe("Guiding Bolt", () => {
  it("lights up the creature it hits: the next attack roll against it, anyone's, has Advantage and spends it", () => {
    const { state, resolve } = fight(cleric);
    resolve("spell-guiding-bolt", {}, [15, 3, 3, 3, 3]);
    expect(actorOf(state, FOE).effects.map((effect) => effect.name)).toEqual(["Guiding Bolt's light"]);
    nextInitiativeTurn(state);
    nextInitiativeTurn(state);
    const claw = strike(state, FOE2, FOE, [5, 16, 4]);
    expect(claw.rollMode?.advantage).toContain("Target: Guiding Bolt's light");
    expect(claw.effectsEnded).toEqual([expect.objectContaining({ actorId: FOE, name: "Guiding Bolt's light" })]);
    expect(actorOf(state, FOE).effects).toEqual([]);
  });

  it("lights nothing on a miss", () => {
    const { state, resolve } = fight(cleric);
    resolve("spell-guiding-bolt", {}, [1]);
    expect(actorOf(state, FOE).effects).toEqual([]);
  });
});

describe("Hex and Hunter's Mark", () => {
  it("deal the caster's extra 1d6 when its attack hits the marked creature, and only then", () => {
    const warlock = build(warlockInput(["hex", "hellish-rebuke"]));
    const { state, resolve } = fight(warlock);
    resolve("spell-hex", { targetIds: [FOE] });
    expect(actorOf(state, FOE).effects[0]).toMatchObject({ name: "Hex", sourceActorId: HERO });
    const marked = resolve("spell-eldritch-blast", {}, [15, 5, 4]);
    expect(marked.damage).toContainEqual(expect.objectContaining({ type: "necrotic", total: 4 }));
    const unmarked = resolve("spell-eldritch-blast", { targetIds: [FOE2] }, [15, 5, 4]);
    expect(unmarked.damage.some((part) => part.type === "necrotic")).toBe(false);
    // The marked creature's own hits deal no extra damage.
    nextInitiativeTurn(state);
    expect(strike(state, FOE, HERO, [18, 4, 6]).damage.map((part) => part.type)).toEqual(["slashing"]);
  });

  it("read Hunter's Mark's Force damage from the spell", () => {
    expect(view.spellRecord("hunters-mark")!.effect!.grant).toMatchObject({
      target: "target",
      modifiers: [
        {
          type: "extra-damage",
          formula: "1d6",
          damageType: "force",
          when: [{ type: "on-hit" }, { type: "by-effect-source" }]
        }
      ]
    });
  });
});

describe("Faerie Fire", () => {
  it("outlines a creature that fails: attacks against it have Advantage, and it can't benefit from Invisible", () => {
    const druid = build(druidInput(["faerie-fire"]));
    const { state, resolve } = fight(druid);
    resolve("spell-faerie-fire", { targetIds: [FOE] });
    answerSuccessOrFailure(state, state.combat.pendingSaves[0]!.id, [2]);
    const foe = actorOf(state, FOE);
    expect(foe.effects.map((effect) => effect.tags)).toEqual([["outlined"]]);
    foe.conditions = [{ id: "invisible" }];
    nextInitiativeTurn(state);
    nextInitiativeTurn(state);
    const claw = strike(state, FOE2, FOE, [5, 16, 4]);
    expect(claw.rollMode).toMatchObject({ mode: "advantage", disadvantage: [] });
  });
});

describe("Mage Armor", () => {
  it("makes an unarmored creature's base AC 13 plus its Dexterity modifier", () => {
    const { state, resolve, hero } = fight(wizard);
    expect(hero.armorClass).toBe(12);
    resolve("spell-mage-armor", { targetIds: [HERO] });
    expect(armorClassInPlay(actorOf(state, HERO))).toBe(15);
  });

  it("does nothing for a creature wearing armor", () => {
    const { state, resolve, hero } = fight(wizard);
    hero.inventory = [
      ...hero.inventory,
      {
        id: "chain-mail",
        name: "Chain Mail",
        quantity: 1,
        equipped: true,
        attuned: false,
        category: "armor",
        armor: {
          acBase: 16,
          addDexModifier: false,
          dexModifierCap: null,
          stealthDisadvantage: true,
          strengthRequired: 13
        }
      }
    ];
    const cast = resolve("spell-mage-armor", { targetIds: [HERO] });
    expect(cast.warnings?.join(" ")).toMatch(/Ansel is wearing armor, so Mage Armor does nothing/);
    expect(actorOf(state, HERO).effects).toEqual([]);
  });
});

describe("Haste", () => {
  it("gives +2 AC, doubled Speed and Advantage on Dexterity saves", () => {
    const { state, resolve, definition } = fight(wizard);
    resolve("spell-haste", { targetIds: [HERO] });
    const hero = actorOf(state, HERO);
    expect(armorClassInPlay(hero)).toBe(14);
    expect(currentSpeedFeet(hero, deriveEquipment(hero, definition, catalog))).toBe(60);
    const dex = save(state, HERO, "dex", [4, 15]);
    expect(dex.rollMode?.advantage).toContain("Haste");
    expect(dex.total).toBe(17);
  });
});
