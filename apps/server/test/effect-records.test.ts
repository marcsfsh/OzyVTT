import { describe, expect, it } from "vitest";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { answerSave, anySaveRollSources } from "../src/saving-throws.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { effectiveActions } from "../src/effective-actions.js";
import { spellCastMechanics } from "../src/item-actions.js";
import {
  actionOf,
  actorOf,
  BRAN,
  catalog,
  checkWith,
  giveEffect,
  GREATSWORD,
  IMP,
  resolve,
  resolveDefinitionOf,
  table,
  view,
  WREN,
  wrenSheet,
  ZOMBIE,
  type Table
} from "./effect-vocabulary-kit.js";

// The SRD 5.2.1 spells, features and feats the effect vocabulary and its choices now carry, each cast or read as a
// sheet would: the pick kept on the effect, and what it does where its roll or event happens.

const NUMBERS = { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 3 } as const;
const POUCH = { id: "component-pouch", name: "Component Pouch", quantity: 1, equipped: true, attuned: false };

/** A spell's cast action as a sheet mints it, with no slot to spend. */
function spellAction(spellId: string): ActorAction {
  const spell = view.spellRecord(spellId)!;
  return {
    id: `spell-${spellId}`,
    name: spell.name,
    activation: "action",
    description: spell.description,
    ...spellCastMechanics(spell, NUMBERS),
    spellId
  } as ActorAction;
}

/** Wren with a component pouch, rules noted rather than refused, so a spell's hands and materials don't stop a cast. */
function caster(definition: ActorDefinition = wrenSheet()): Table {
  const built = table(definition, { wren: { inventory: [POUCH, GREATSWORD], armorClass: 14 } });
  built.state.combat.rulesMode = "assisted";
  return built;
}

/** The fight ends, so a spell with a long casting time completes at once. */
function outsideFight(built: Table): Table {
  built.state.combat = { ...built.state.combat, active: false };
  return built;
}

/** Answers each of `targetId`'s pending saves with `face`. */
function answer(built: Table, targetId: string, face: number) {
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
        random: () => face,
        newRollId: () => crypto.randomUUID(),
        sessionId: "30000000-0000-4000-8000-00000000000a",
        role: "gm",
        now: () => "2026-10-19T00:00:00.000Z",
        resolveDefinition: resolveDefinitionOf(built),
        catalog
      }
    );
}

const effectNamed = (built: Table, actorId: string, name: string) =>
  actorOf(built.state, actorId).effects.find((effect) => effect.name.startsWith(name));

const damageDeps = (built: Table, rollDie: () => number = () => 1) => ({
  resolveDefinition: resolveDefinitionOf(built),
  catalog,
  rollDie
});

describe("spells that ask for a choice at the cast", () => {
  it("adds Guidance's 1d4 to checks with the skill picked", () => {
    const built = caster();
    resolve(built, spellAction("guidance"), { targetIds: [WREN], optionId: "athletics" });
    expect(effectNamed(built, WREN, "Guidance")?.name).toBe("Guidance (Athletics)");
    // 10 + Strength 4 + Proficiency 3 + the d4's 3.
    expect(checkWith(built, { ability: "str", skill: "athletics" }, [10], [3]).roll.total).toBe(20);
    expect(checkWith(built, { ability: "int", skill: "arcana" }, [10], [3]).roll.total).toBe(13);
  });

  it("takes Resistance's 1d4 off damage of the type picked, once a turn", () => {
    const built = caster();
    resolve(built, spellAction("resistance"), { targetIds: [WREN], optionId: "fire" });
    const fire = { amount: 10, parts: [{ amount: 10, type: "fire" }] };
    const deps = damageDeps(built, () => 4);
    expect(applyDamageDetailed(built.state, WREN, fire, { role: "gm" }, deps).application.totalApplied).toBe(6);
    expect(applyDamageDetailed(built.state, WREN, fire, { role: "gm" }, deps).application.totalApplied).toBe(10);
  });

  it("gives Fire Shield's chill shield Resistance to Fire and Cold back at a melee attacker", () => {
    const built = caster();
    resolve(built, spellAction("fire-shield"), { targetIds: [], optionId: "chill" });
    expect(effectNamed(built, WREN, "Fire Shield")?.meleeHitDamage).toEqual({ formula: "2d8", type: "cold" });
    const fire = { amount: 10, parts: [{ amount: 10, type: "fire" }] };
    expect(
      applyDamageDetailed(built.state, WREN, fire, { role: "gm" }, damageDeps(built)).application.totalApplied
    ).toBe(5);
    // The Zombie's Slam hits (a 19), and the shield answers with 2d8 Cold (4 + 4).
    const zombieBefore = actorOf(built.state, ZOMBIE).hp.current;
    resolve(built, actionOf(built, "slam", ZOMBIE), { targetIds: [WREN] }, [19, 2, 4, 4], ZOMBIE);
    expect(actorOf(built.state, ZOMBIE).hp.current).toBe(zombieBefore - 8);
  });

  it("curses with the curse picked: Disadvantage on attacks against the caster, or Necrotic on the caster's hits", () => {
    const against = caster();
    resolve(against, spellAction("bestow-curse"), { targetIds: [ZOMBIE], optionId: "against-you" });
    answer(against, ZOMBIE, 1);
    expect(effectNamed(against, ZOMBIE, "Bestow Curse")?.name).toBe("Bestow Curse (Attacks against you)");
    const slam = actionOf(against, "slam", ZOMBIE);
    expect(resolve(against, slam, { targetIds: [WREN] }, [10, 10, 1], ZOMBIE).rollMode?.mode).toBe("disadvantage");
    expect(resolve(against, slam, { targetIds: [BRAN] }, [10, 1], ZOMBIE).rollMode?.mode ?? "normal").toBe("normal");

    const necrotic = caster();
    resolve(necrotic, spellAction("bestow-curse"), { targetIds: [ZOMBIE], optionId: "necrotic" });
    answer(necrotic, ZOMBIE, 1);
    const hit = resolve(necrotic, actionOf(necrotic, "item-greatsword"), { commit: true }, [17, 3, 3, 5]);
    expect(hit.damage.some((part) => part.type === "necrotic")).toBe(true);
  });

  it("calms each creature as picked for it, holding off a Frightened it had", () => {
    const built = caster();
    actorOf(built.state, BRAN).conditions = [{ id: "frightened" }];
    resolve(built, spellAction("calm-emotions"), { targetIds: [BRAN], targetOptions: { [BRAN]: "calm" } });
    answer(built, BRAN, 1);
    const bran = actorOf(built.state, BRAN);
    expect(bran.conditions).toEqual([]);
    expect(effectNamed(built, BRAN, "Calm Emotions")?.suppressedConditions).toEqual([
      { id: "frightened", standalone: true }
    ]);
  });

  it("makes a Groveling target Prone, unable to act or move on its next turn (Command)", () => {
    const built = caster();
    resolve(built, spellAction("command"), { targetIds: [ZOMBIE], optionId: "grovel" });
    answer(built, ZOMBIE, 1);
    const zombie = actorOf(built.state, ZOMBIE);
    expect(zombie.conditions.map((entry) => entry.id)).toContain("prone");
    expect(effectNamed(built, ZOMBIE, "Command")).toMatchObject({ tags: expect.arrayContaining(["no-actions"]) });
  });

  it("puts an Eyebite target to sleep, waking on damage", () => {
    const built = caster();
    resolve(built, spellAction("eyebite"), { targetIds: [ZOMBIE], optionId: "asleep" });
    answer(built, ZOMBIE, 1);
    expect(actorOf(built.state, ZOMBIE).conditions.map((entry) => entry.id)).toContain("unconscious");
    applyDamageDetailed(
      built.state,
      ZOMBIE,
      { amount: 1, parts: [{ amount: 1, type: "fire" }] },
      { role: "gm" },
      {
        resolveDefinition: resolveDefinitionOf(built),
        catalog
      }
    );
    expect(effectNamed(built, ZOMBIE, "Eyebite")).toBeUndefined();
  });
});

describe("what a failed or a successful save leaves", () => {
  it("makes Irresistible Dance's target dance in place, ended by its own action and a save at the spell's DC", () => {
    const built = caster();
    resolve(built, spellAction("irresistible-dance"), { targetIds: [ZOMBIE] });
    answer(built, ZOMBIE, 1);
    const dance = effectNamed(built, ZOMBIE, "Irresistible Dance")!;
    expect(dance).toMatchObject({ speedZero: true, endAction: { kind: "save", ability: "wis", dc: 15 } });
    const end = builtinActionFor(undefined, "end-effect", actorOf(built.state, ZOMBIE));
    expect(end?.name).toBe("Collect itself (Irresistible Dance)");
  });

  it("leaves Ray of Enfeeblement's Disadvantage on the next attack after a success, and -1d8 damage after a failure", () => {
    const saved = caster();
    resolve(saved, spellAction("ray-of-enfeeblement"), { targetIds: [ZOMBIE] });
    answer(saved, ZOMBIE, 20);
    expect(effectNamed(saved, ZOMBIE, "Ray of Enfeeblement")?.tags).toContain("until-own-attack");

    const failed = caster();
    resolve(failed, spellAction("ray-of-enfeeblement"), { targetIds: [ZOMBIE] });
    answer(failed, ZOMBIE, 1);
    const ray = effectNamed(failed, ZOMBIE, "Ray of Enfeeblement")!;
    expect(ray.repeatSave).toMatchObject({ ability: "con" });
    expect(ray.modifiers).toContainEqual(expect.objectContaining({ type: "damage-bonus", dice: "-1d8" }));
  });

  it("outlines Mind Spike's target to its caster", () => {
    const built = caster();
    resolve(built, spellAction("mind-spike"), { targetIds: [ZOMBIE] }, [3, 3, 3]);
    answer(built, ZOMBIE, 1);
    expect(effectNamed(built, ZOMBIE, "Mind Spike")).toMatchObject({
      tags: ["outlined-to-source"],
      sourceActorId: WREN
    });
  });
});

describe("spells that grant what the vocabulary now says", () => {
  it("raises each feaster's Hit Point maximum by its own 2d10, with its immunities", () => {
    const built = outsideFight(caster());
    actorOf(built.state, BRAN).conditions = [{ id: "poisoned" }];
    resolve(
      built,
      spellAction("heroes-feast"),
      { targetIds: [WREN, BRAN], override: { reason: "Bowl" } },
      [6, 4, 2, 1]
    );
    expect(actorOf(built.state, WREN).hp).toMatchObject({ maximum: 50, current: 50 });
    expect(actorOf(built.state, BRAN).hp).toMatchObject({ maximum: 23, current: 23 });
    expect(actorOf(built.state, BRAN).conditions).toEqual([]);
    expect(effectNamed(built, BRAN, "Heroes' Feast")?.duration).toEqual({ type: "minutes", remaining: 1440 });
  });

  it("gives Mind Blank's Immunity to Psychic damage and Charmed", () => {
    const built = caster();
    resolve(built, spellAction("mind-blank"), { targetIds: [BRAN] });
    expect(effectNamed(built, BRAN, "Mind Blank")?.conditionImmunities).toEqual(["charmed"]);
    const psychic = { amount: 9, parts: [{ amount: 9, type: "psychic" }] };
    expect(
      applyDamageDetailed(built.state, BRAN, psychic, { role: "gm" }, damageDeps(built)).application.totalApplied
    ).toBe(0);
  });

  it("guards against the otherworldly: Disadvantage on a Fiend's attack, and no Frightened from it", () => {
    const built = caster();
    resolve(built, spellAction("protection-from-evil-and-good"), { targetIds: [WREN] });
    const sting = actionOf(built, "sting", IMP);
    expect(resolve(built, sting, { targetIds: [WREN] }, [10, 1], IMP).rollMode?.mode).toBe("disadvantage");
    giveEffect(built, WREN, [], { name: "Fear", linkedConditionIds: ["frightened"], sourceActorId: IMP });
    expect(actorOf(built.state, WREN).conditions.map((entry) => entry.id)).not.toContain("frightened");
  });

  it("gives Glibness a d20 of at least 15 on Charisma checks", () => {
    const built = caster();
    resolve(built, spellAction("glibness"), { targetIds: [] });
    // 15 for the 3, Charisma -1.
    expect(checkWith(built, { ability: "cha", skill: "persuasion" }, [3]).roll.total).toBe(14);
  });

  it("restores a hit point at the start of each turn under Regenerate, and offers Expeditious Retreat's Dash", () => {
    const healed = outsideFight(caster());
    resolve(healed, spellAction("regenerate"), { targetIds: [BRAN] }, [1, 1, 1, 1]);
    expect(effectNamed(healed, BRAN, "Regenerate")?.hitPointsEachTurn).toBe(1);
    const built = caster();
    resolve(built, spellAction("expeditious-retreat"), { targetIds: [] });
    expect(effectNamed(built, WREN, "Dashing")?.movementGrantFeet).toBe(30);
    expect(builtinActionFor(built.definition, "dash-bonus", actorOf(built.state, WREN))?.name).toBe(
      "Expeditious Retreat: Dash"
    );
  });

  it("binds Magic Weapon to the weapon picked, +1 from a level 2 slot", () => {
    const built = caster();
    resolve(built, spellAction("magic-weapon"), { targetIds: [], itemId: "greatsword" });
    expect(actionOf(built, "item-greatsword").attack?.bonus).toBe(8);
  });

  it("gives the creature Dragon's Breath touched the exhale, at the damage type picked", () => {
    const built = caster();
    resolve(built, spellAction("dragons-breath"), { targetIds: [BRAN], damageType: "cold" });
    const exhale = effectiveActions(undefined, actorOf(built.state, BRAN), catalog).find((action) =>
      action.id.endsWith("then-exhale")
    );
    expect(exhale?.damage).toEqual([{ formula: "3d6", type: "cold" }]);
  });

  it("gives Thaumaturgy's Booming Voice Advantage on Intimidation", () => {
    const built = caster();
    resolve(built, spellAction("thaumaturgy"), { targetIds: [], optionId: "booming-voice" });
    expect(checkWith(built, { ability: "cha", skill: "intimidation" }, [3, 18]).plan.rollMode.mode).toBe("advantage");
  });

  it("leaves a shrinking -4 on D20 Tests after Raise Dead", () => {
    const built = outsideFight(caster());
    resolve(built, spellAction("raise-dead"), { targetIds: [WREN], override: { reason: "Diamond" } });
    expect(effectNamed(built, WREN, "Raise Dead")).toMatchObject({ shrinksEachLongRest: true });
    expect(checkWith(built, { ability: "str", skill: "athletics" }, [10]).roll.total).toBe(13);
  });
});

/** Wren with one more feature on her sheet. */
const withFeature = (
  id: string,
  kind: "class" | "subclass" | "option",
  sourceId: string,
  over: Partial<ActorDefinition> = {}
) => {
  const sheet = wrenSheet(over);
  return {
    ...sheet,
    character: { ...sheet.character!, features: [...(sheet.character!.features ?? []), { id, kind, sourceId }] }
  } as ActorDefinition;
};

describe("class features, feats and their riders", () => {
  it("floors a Strength check's total at the Strength score (Indomitable Might)", () => {
    const built = table(withFeature("indomitable-might", "class", "barbarian"));
    // 2 + 4 + 3 = 9, which counts as 18.
    expect(checkWith(built, { ability: "str", skill: "athletics" }, [2]).roll.total).toBe(18);
  });

  it("adds the Wisdom modifier to Arcana for a Thaumaturge", () => {
    const built = table(withFeature("thaumaturge", "option", "divine-order"));
    // 10 + Intelligence 0 + Proficiency 3 + Wisdom 3.
    expect(checkWith(built, { ability: "int", skill: "arcana" }, [10]).roll.total).toBe(16);
  });

  it("takes every Advantage off attacks against an Elusive Rogue who isn't Incapacitated", () => {
    const built = table(withFeature("elusive", "class", "rogue"), { wren: { armorClass: 14 } });
    giveEffect(built, WREN, [
      { type: "roll-mode", roll: "incoming-attack", mode: "advantage", when: [{ type: "on-attack-roll" }] }
    ]);
    const slam = actionOf(built, "slam", ZOMBIE);
    expect(resolve(built, slam, { targetIds: [WREN] }, [10, 10, 1], ZOMBIE).rollMode?.mode ?? "normal").toBe("normal");
  });

  it("gives Advantage against the creature a Ranger's Hunter's Mark marks (Precise Hunter)", () => {
    const built = table(withFeature("precise-hunter", "class", "ranger"));
    giveEffect(built, ZOMBIE, [], { name: "Hunter's Mark", tags: ["hunters-mark"], sourceActorId: WREN });
    expect(resolve(built, actionOf(built, "item-greatsword"), {}, [10, 10]).rollMode?.mode).toBe("advantage");
  });

  it("deals Colossus Slayer's 1d8 once a turn to a wounded creature", () => {
    const built = table(withFeature("colossus-slayer", "option", "hunters-prey"));
    actorOf(built.state, ZOMBIE).hp = { ...actorOf(built.state, ZOMBIE).hp, current: 10 };
    const swing = actionOf(built, "item-greatsword");
    const first = resolve(built, swing, { commit: true }, [17, 3, 3, 5]);
    expect(first.damage.length).toBe(2);
    built.state.combat.turn.actionUsed = false;
    const again = resolve(built, swing, { commit: true }, [17, 3, 3, 5]);
    expect(again.damage.length).toBe(1);
  });

  it("gives a Fighter Advantage on the next attack against a creature it missed (Studied Attacks)", () => {
    const built = table(withFeature("studied-attacks", "class", "fighter"));
    const swing = actionOf(built, "item-greatsword");
    resolve(built, swing, { commit: true }, [1]);
    expect(effectNamed(built, ZOMBIE, "Studied by Wren")).toBeDefined();
    expect(resolve(built, swing, { commit: true }, [10, 10, 3, 3]).rollMode?.mode).toBe("advantage");
    expect(effectNamed(built, ZOMBIE, "Studied by Wren")).toBeUndefined();
  });

  it("rolls a Survivor's death saves with Advantage", () => {
    const built = table(withFeature("survivor", "subclass", "champion"));
    const derivation = deriveEquipment(built.wren, built.definition, catalog);
    expect(anySaveRollSources(derivation).advantage.length).toBe(1);
  });

  it("lets a Monk 6's Unarmed Strike deal Force (Empowered Strikes)", () => {
    const strike: ActorAction = {
      id: "unarmed-strike",
      name: "Unarmed Strike",
      activation: "action",
      description: "Strike.",
      attack: { bonus: 6, reachFeet: 5 },
      damage: [{ formula: "1d8 + 3", type: "bludgeoning" }]
    };
    const built = table(withFeature("empowered-strikes", "class", "monk", { actions: [strike] }));
    expect(actionOf(built, "unarmed-strike").damageTypes).toEqual(["bludgeoning", "force"]);
  });

  it("gives a Fiend Warlock Temporary Hit Points when it drops an enemy (Dark One's Blessing)", () => {
    const built = table(
      withFeature("dark-ones-blessing", "subclass", "fiend-patron", {
        abilityScores: { str: 18, dex: 12, con: 14, int: 10, wis: 16, cha: 16 },
        character: { classes: [{ id: "warlock", name: "Warlock", level: 5 }], feats: [], features: [] }
      } as Partial<ActorDefinition>)
    );
    applyDamageDetailed(
      built.state,
      ZOMBIE,
      { amount: 30, parts: [{ amount: 30, type: "radiant" }], sourceActorId: WREN },
      { role: "gm" },
      damageDeps(built)
    );
    // Charisma +3 and Warlock level 5.
    expect(actorOf(built.state, WREN).hp.temporary).toBe(8);
  });
});
