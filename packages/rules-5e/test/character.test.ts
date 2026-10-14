import { describe, expect, it } from "vitest";
import {
  abilityModifier,
  armorClassFromEquipment,
  characterLevel,
  proficiencyBonusForLevel,
  saveBonus,
  skillBonus,
  spellAttackBonus,
  spellSaveDc,
  weaponAbilityModifierFrom
} from "../src/character.js";

describe("weaponAbilityModifierFrom - the ONE rule the server and the sheet both roll off", () => {
  // A duellist who makes the two axes visible: Dexterity is the better score, so a Finesse weapon
  // must take it and a Strength weapon must not.
  const str = abilityModifier(12); // +1
  const dex = abilityModifier(18); // +4

  it("takes the better score for Finesse, and Strength for a plain melee weapon", () => {
    expect(weaponAbilityModifierFrom(["finesse"], null, str, dex)).toBe(4);        // Rapier
    expect(weaponAbilityModifierFrom(["finesse", "light"], null, str, dex)).toBe(4); // Shortsword
    expect(weaponAbilityModifierFrom(["heavy", "two-handed"], null, str, dex)).toBe(1); // Greatsword
    // Finesse is the better of the two, not "Dexterity" - a STR 18 / DEX 12 brute keeps Strength.
    expect(weaponAbilityModifierFrom(["finesse"], null, 4, 1)).toBe(4);
  });

  it("rolls a THROWN weapon off Strength even though it has a range", () => {
    // The half the sheet used to get wrong in the other direction: `rangeFeet != null` is not the
    // same question as "is this a ranged weapon". Throwing a Javelin is a Strength attack.
    expect(weaponAbilityModifierFrom(["thrown"], 30, str, dex)).toBe(1);            // Javelin
    expect(weaponAbilityModifierFrom(["light", "thrown"], 20, str, dex)).toBe(1);   // Handaxe
    expect(weaponAbilityModifierFrom([], 80, str, dex)).toBe(4);                    // Shortbow
    // Both properties at once resolves through Finesse, which is why a Dagger agrees either way.
    expect(weaponAbilityModifierFrom(["finesse", "light", "thrown"], 20, str, dex)).toBe(4);
  });

  it("treats a missing range and a missing property list as melee with no properties", () => {
    expect(weaponAbilityModifierFrom([], undefined, str, dex)).toBe(1);
    expect(weaponAbilityModifierFrom([], null, str, dex)).toBe(1);
  });
});

describe("abilityModifier", () => {
  it("applies floor((score - 10) / 2) across the range", () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(15)).toBe(2);
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(30)).toBe(10);
  });
});

describe("characterLevel", () => {
  it("sums class levels for multiclass and floors at 1", () => {
    expect(characterLevel([7])).toBe(7);
    expect(characterLevel([5, 2])).toBe(7);
    expect(characterLevel([])).toBe(1);
  });
});

describe("proficiencyBonusForLevel", () => {
  it("steps +2/+3/+4/+5/+6 at the SRD breakpoints", () => {
    expect(proficiencyBonusForLevel(1)).toBe(2);
    expect(proficiencyBonusForLevel(4)).toBe(2);
    expect(proficiencyBonusForLevel(5)).toBe(3);
    expect(proficiencyBonusForLevel(8)).toBe(3);
    expect(proficiencyBonusForLevel(9)).toBe(4);
    expect(proficiencyBonusForLevel(13)).toBe(5);
    expect(proficiencyBonusForLevel(17)).toBe(6);
    expect(proficiencyBonusForLevel(20)).toBe(6);
  });

  it("clamps out-of-range levels to a legal bonus", () => {
    expect(proficiencyBonusForLevel(0)).toBe(2);
    expect(proficiencyBonusForLevel(25)).toBe(6);
  });
});

describe("saveBonus", () => {
  it("adds the proficiency bonus only when proficient", () => {
    // CON 14 (+2), PB +3
    expect(saveBonus(14, 3, false)).toBe(2);
    expect(saveBonus(14, 3, true)).toBe(5);
  });
});

describe("skillBonus", () => {
  it("scales the proficiency bonus by tier", () => {
    // DEX 16 (+3), PB +3
    expect(skillBonus(16, 3, "none")).toBe(3);
    expect(skillBonus(16, 3, "proficient")).toBe(6);
    expect(skillBonus(16, 3, "expertise")).toBe(9);
  });
});

describe("spellSaveDc / spellAttackBonus", () => {
  it("derives from 8 + PB + mod and PB + mod", () => {
    // CHA 18 (+4), PB +3
    expect(spellSaveDc(18, 3)).toBe(15);
    expect(spellAttackBonus(18, 3)).toBe(7);
  });
});

describe("armorClassFromEquipment", () => {
  const armor = (acBase: number, addDexModifier: boolean, dexModifierCap: number | null) => ({ acBase, addDexModifier, dexModifierCap });
  const item = (over: Partial<{ equipped: boolean; category: string; armor: { acBase: number; addDexModifier: boolean; dexModifierCap: number | null } }>) => ({ equipped: true, ...over });

  it("returns null when nothing armor-like is equipped (keep the stored/base AC)", () => {
    expect(armorClassFromEquipment(3, [])).toBeNull();
    expect(armorClassFromEquipment(3, [item({ category: "weapon" })])).toBeNull();
    // an UN-equipped suit of armor does not count
    expect(armorClassFromEquipment(3, [item({ equipped: false, category: "armor", armor: armor(14, true, 2) })])).toBeNull();
  });
  it("light armor adds full Dex", () => {
    // leather 11 + Dex +4 (uncapped)
    expect(armorClassFromEquipment(4, [item({ category: "armor", armor: armor(11, true, null) })])).toBe(15);
  });
  it("medium armor caps Dex at the armor's cap", () => {
    // half plate 15 + min(Dex +4, cap 2) = 17
    expect(armorClassFromEquipment(4, [item({ category: "armor", armor: armor(15, true, 2) })])).toBe(17);
  });
  it("heavy armor ignores Dex", () => {
    // plate 18, Dex +4 ignored (and negative Dex is not subtracted either)
    expect(armorClassFromEquipment(4, [item({ category: "armor", armor: armor(18, false, null) })])).toBe(18);
    expect(armorClassFromEquipment(-1, [item({ category: "armor", armor: armor(18, false, null) })])).toBe(18);
  });
  it("adds a shield's base on top of armor, and to unarmored 10 + Dex", () => {
    const shield = item({ category: "shield", armor: armor(2, false, null) });
    // chain mail 16 + shield 2
    expect(armorClassFromEquipment(1, [item({ category: "armor", armor: armor(16, false, null) }), shield])).toBe(18);
    // unarmored with only a shield: 10 + Dex +3 + shield 2
    expect(armorClassFromEquipment(3, [shield])).toBe(15);
  });

  /**
   * U28. A shield alone used to answer a flat 10 + Dex + shield, which is how a Barbarian who picked
   * one up came out BELOW their bare-handed AC. `allowShield` is the whole Barbarian/Monk difference
   * and these four numbers are the same four the table reads.
   */
  describe("Unarmored Defense", () => {
    const shield = item({ category: "shield", armor: armor(2, false, null) });
    const barbarian = { bonus: 3, allowShield: true } as const; // Con +3, "you can use a Shield"
    const monk = { bonus: 3, allowShield: false } as const; // Wis +3, "or wielding a Shield"

    it("keeps the bonus under a shield when the feature allows one", () => {
      // 10 + Dex +2 + Con +3 + shield 2 - the +2 lands ON TOP OF Constitution, not instead of it
      expect(armorClassFromEquipment(2, [shield], barbarian)).toBe(17);
    });
    it("loses the bonus under a shield when the feature does not", () => {
      expect(armorClassFromEquipment(2, [shield], monk)).toBe(14); // 10 + Dex +2 + shield 2
    });
    it("is replaced by body armor either way", () => {
      // Both printings begin "while you aren't wearing armor": chain mail 16 + shield 2, no bonus.
      const mail = item({ category: "armor", armor: armor(16, false, null) });
      expect(armorClassFromEquipment(2, [mail, shield], barbarian)).toBe(18);
      expect(armorClassFromEquipment(2, [mail, shield], monk)).toBe(18);
    });
    it("still returns null bare-handed, so the caller keeps the AC it already computed", () => {
      expect(armorClassFromEquipment(2, [], barbarian)).toBeNull();
    });
    it("changes nothing for a caller that passes none (every monster and import)", () => {
      expect(armorClassFromEquipment(2, [shield])).toBe(14);
      expect(armorClassFromEquipment(2, [shield], null)).toBe(14);
    });
  });
});
