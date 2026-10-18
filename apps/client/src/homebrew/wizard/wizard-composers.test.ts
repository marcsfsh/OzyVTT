/** The answers a wizard keeps outside a plain column: a spell's healing, area and upcasting in its text and rows, a
    monster's numbers in the SRD's arithmetic and its actions in the SRD's words, an item's kind. Each is checked
    against the reader the engine uses, so what the wizard writes is what the table reads. */

import { describe, expect, it } from "vitest";
import { areaOfProse, multiattackOfProse } from "@vtt/content-srd-5.2.1/action-prose";
import { healingOfText } from "@vtt/content-srd-5.2.1/spell-effect";
import { blankDraft } from "../defaults";
import type { Draft } from "../schema";
import { itemKindOf, typeLineOf, withBonus, withItemKind } from "./equipment";
import { actionsOf, editAction, newAction, usageOf, withName, withUsage } from "./monster-actions";
import {
  proficientSaves,
  skillTiers,
  statblockOf,
  summaryLineOf,
  withChallenge,
  withHitDice,
  withSaves,
  withScore,
  withSize,
  withSkills
} from "./monster-build";
import {
  healingOf,
  rangeKindOf,
  scalingOf,
  spellTextFor,
  textNamesArea,
  withHealing,
  withRange,
  withScaling
} from "./spell-text";
import { answer, wizardEquipment, wizardMonster, wizardSpell } from "./wizard-records";

const spell = (patch: Draft = {}): Draft => ({ ...blankDraft("spell"), name: "Probe", ...patch });

describe("the spell wizard writes where the engine reads", () => {
  it("keeps a range in the SRD's shape, and reads its kind back", () => {
    const far = withRange(spell(), "feet", 120);
    expect(far.range).toEqual({ distance: 120, unit: "feet", text: "120 feet" });
    expect(rangeKindOf(far)).toBe("feet");
    const touch = withRange(far, "touch", null);
    expect(touch.range).toEqual({ distance: null, unit: null, text: "Touch" });
    expect(rangeKindOf(touch)).toBe("touch");
  });

  it("puts healing in the text as the sentence the engine reads, and takes it out again", () => {
    const base = withRange(spell({ description: "A warm light spreads." }), "touch", null);
    const healed = withHealing(base, { formula: "2d8", addsModifier: true });
    expect(healingOfText(healed.description as string)).toEqual({ formula: "2d8", addsModifier: true });
    expect(healed.description).toBe(
      "A warm light spreads. A creature you touch regains a number of Hit Points equal to 2d8 plus your spellcasting ability modifier."
    );
    const flat = withHealing(healed, { formula: "10", addsModifier: false });
    expect(healingOf(flat)).toEqual({ formula: "10", addsModifier: false });
    expect(withHealing(flat, null).description).toBe("A warm light spreads.");
  });

  it("writes upcast rows and the At Higher Levels text from one answer, in SRD 5.2.1 words", () => {
    const fireball = withScaling(spell({ level: 3, damage: { roll: "8d6", types: ["fire"] } }), {
      perSlot: "1d6",
      targetsPerSlot: null,
      cantripTiers: false
    });
    const rows = fireball.castingOptions as Array<{ type: string; damageRoll: string | null }>;
    expect(rows.map((row) => [row.type, row.damageRoll])).toEqual([
      ["slot_level_4", "9d6"],
      ["slot_level_5", "10d6"],
      ["slot_level_6", "11d6"],
      ["slot_level_7", "12d6"],
      ["slot_level_8", "13d6"],
      ["slot_level_9", "14d6"]
    ]);
    expect(fireball.higherLevel).toBe("The damage increases by 1d6 for each spell slot level above 3.");
    expect(scalingOf(fireball).perSlot).toBe("1d6");

    // A new level carries the rows and the text along, since the wizard wrote both.
    const lower = answer("spell", fireball, "level", 2);
    expect((lower.castingOptions as Array<{ type: string }>)[0].type).toBe("slot_level_3");
    expect(lower.higherLevel).toBe("The damage increases by 1d6 for each spell slot level above 2.");

    // Text the GM wrote stays as written.
    const written = { ...fireball, higherLevel: "It burns hotter." };
    expect(answer("spell", written, "level", 4).higherLevel).toBe("It burns hotter.");
  });

  it("grows a damage cantrip at levels 5, 11 and 17", () => {
    const bolt = withScaling(spell({ level: 0, damage: { roll: "1d10", types: ["fire"] } }), {
      perSlot: null,
      targetsPerSlot: null,
      cantripTiers: true
    });
    expect((bolt.castingOptions as Array<{ type: string; damageRoll: string }>).map((row) => row.damageRoll)).toEqual([
      "2d10",
      "3d10",
      "4d10"
    ]);
    expect(bolt.higherLevel).toBe(
      "The damage increases by 1d10 when you reach levels 5 (2d10), 11 (3d10), and 17 (4d10)."
    );
  });

  it("writes text that names the area the map draws", () => {
    const record = wizardSpell();
    expect(textNamesArea(record)).toBe(true);
    expect(areaOfProse(record.description as string)).toMatchObject({ shape: "sphere", sizeFeet: 20 });
    expect(spellTextFor(record)).toContain("Dexterity saving throw");
  });
});

describe("the monster wizard keeps the SRD's arithmetic", () => {
  const monster = (): Draft => ({ ...blankDraft("monster"), name: "Ash Hound" });

  it("sets the Proficiency Bonus and XP from the challenge rating", () => {
    const draft = withChallenge(monster(), 5);
    expect(draft.proficiencyBonus).toBe(3);
    expect(statblockOf(draft)).toMatchObject({ challengeRating: 5, experiencePoints: 1800 });
  });

  it("works Hit Points out from Hit Point Dice, the size's die and Constitution", () => {
    const draft = withHitDice(withScore(monster(), "con", 14), 7);
    expect(draft.hitPoints).toEqual({ maximum: 45, formula: "7d8 + 14" });
    // A new size keeps the dice and rolls its own die.
    const large = withSize(draft, "large");
    expect(large.hitPoints).toEqual({ maximum: 52, formula: "7d10 + 14" });
    expect(large.token).toMatchObject({ footprint: { width: 2, height: 2 } });
  });

  it("prints saves and skills as totals, and keeps them proficient when a score or the CR moves", () => {
    let draft = withSaves(withScore(monster(), "dex", 14), new Set(["dex"]));
    expect(statblockOf(draft).savingThrows).toMatchObject({ dex: 4, str: 0 });
    draft = withSkills(draft, new Map([["perception", "expertise"]]));
    expect(statblockOf(draft)).toMatchObject({ skills: { perception: 4 }, passivePerception: 14 });

    draft = withChallenge(withScore(draft, "dex", 18), 9);
    expect(proficientSaves(draft)).toEqual(new Set(["dex"]));
    expect(skillTiers(draft).get("perception")).toBe("expertise");
    expect(statblockOf(draft).savingThrows).toMatchObject({ dex: 8 });
    expect(statblockOf(draft).skills).toEqual({ perception: 8 });
  });

  it("writes the bestiary line until the GM writes one", () => {
    const draft = answer("monster", answer("monster", monster(), "type", "fey"), "alignment", "chaotic neutral");
    expect(draft.summary).toBe(summaryLineOf(draft));
    expect(draft.summary).toBe("Medium fey, chaotic neutral · CR 1");
    const written = withChallenge({ ...draft, summary: "A hound of the ash wastes." }, 3);
    expect(written.summary).toBe("A hound of the ash wastes.");
  });

  it("writes actions in the SRD's words, which the engine reads back", () => {
    const record = wizardMonster();
    const [multiattack, bite, breath] = actionsOf(record);
    expect(bite.description).toBe("Melee Attack Roll: +5, reach 5 ft. 7 (1d8 + 3) Piercing damage.");
    expect(breath.name).toBe("Ash Breath (Recharge 5-6)");
    expect(breath.uses).toEqual({ limit: 1, per: "recharge", recharge: 5 });
    expect(usageOf(breath)).toBe("recharge-5");
    expect(breath.description).toBe(
      "Dexterity Saving Throw: DC 12, each creature in a 15-foot Cone. Failure: 14 (4d6) Fire damage. Success: Half damage."
    );
    expect(areaOfProse(breath.description as string)).toMatchObject({ shape: "cone", sizeFeet: 15 });
    expect(multiattack.description).toBe("The ash hound makes two Bite attacks.");
    const plan = multiattackOfProse(multiattack.description as string, (name) =>
      name === "Bite" ? String(bite.id) : undefined
    );
    expect(plan?.plan).toEqual(multiattack.multiattack);
  });

  it("follows a new name in the texts it wrote, and leaves the GM's own text alone", () => {
    const record = wizardMonster();
    const renamed = withName(record, "Cinder Hound");
    expect(actionsOf(renamed)[0].description).toBe("The cinder hound makes two Bite attacks.");

    const bite = actionsOf(record)[1];
    const own = editAction(bite, { ...bite, description: "It bites hard." }, [], "ash hound");
    expect(own.description).toBe("It bites hard.");
    const harder = editAction(own, { ...own, damage: [{ formula: "2d6", type: "piercing" }] }, [], "ash hound");
    expect(harder.description).toBe("It bites hard.");
    // Until then, a new answer rewrites the text.
    const generated = editAction(bite, { ...bite, damage: [{ formula: "2d6", type: "piercing" }] }, [], "ash hound");
    expect(generated.description).toBe("Melee Attack Roll: +5, reach 5 ft. 7 (2d6) Piercing damage.");
  });

  it("names a limited action as the SRD does", () => {
    const action = { ...newAction("other", "action"), name: "Misty Step" };
    expect(withUsage(action, "3-day")).toMatchObject({
      name: "Misty Step (3/Day)",
      uses: { limit: 3, per: "long-rest" }
    });
    expect(withUsage(withUsage(action, "3-day"), "always").name).toBe("Misty Step");
  });
});

describe("the item wizard branches on what the item is", () => {
  it("keeps only the block of the kind chosen", () => {
    const weapon = wizardEquipment();
    expect(itemKindOf(weapon)).toBe("weapon");
    const armor = withItemKind(weapon, "armor");
    expect(armor.weapon).toBeUndefined();
    expect(armor).toMatchObject({ category: "armor", slot: "armor", armor: { addDexModifier: true } });
    const shield = withItemKind(armor, "shield");
    expect(shield).toMatchObject({ category: "shield", armor: { acBase: 2, addDexModifier: false } });
    expect(itemKindOf(shield)).toBe("shield");
    expect(withItemKind(shield, "consumable")).toMatchObject({ consumedOnUse: true, category: "consumable" });
  });

  it("writes a +1 as the rows the rider form writes, and starts the text with the SRD's first line", () => {
    const blade = wizardEquipment();
    const rows = (blade.modifiers as Array<{ type: string; amount: number }>).map(({ type, amount }) => [type, amount]);
    expect(rows).toEqual([
      ["attack-bonus", 1],
      ["damage-bonus", 1]
    ]);
    expect(withBonus(blade, ["attack-bonus", "damage-bonus"], 0).modifiers).toEqual([]);
    expect(typeLineOf(blade)).toBe("Weapon, Rare (Requires Attunement).");
    expect(blade.description).toMatch(/^Weapon, Rare \(Requires Attunement\)\. /);
  });
});
