import { describe, expect, it } from "vitest";
import { castAction } from "../src/item-actions.js";
import { ALLY, build, clericInput, druidInput, fight, FOE, FOE2, view, wizardInput } from "./spell-casters.js";

// What each cast does, per SRD 5.2.1: damage dealt when a spell appears, saves made on later turns,
// a damage type the caster picks, a flame hurled on later turns, a save that ignores cover, and the range and number of
// a spell's targets.

const cleric = build(
  clericInput(["bless", "healing-word", "guiding-bolt", "shield-of-faith", "spiritual-weapon", "spirit-guardians"])
);
const wizard = build(
  wizardInput([
    "chromatic-orb",
    "haste",
    "web",
    "hypnotic-pattern",
    "magic-missile",
    "shield",
    "fireball",
    "misty-step",
    "hold-person"
  ])
);
const druid = build(druidInput(["entangle", "moonbeam", "heat-metal"]));

describe("damage when the spell appears", () => {
  it("makes Spiritual Weapon's attack on the cast, with the caster's modifier, and again on later turns", () => {
    const { resolve, action } = fight(cleric, { distance: 30 });
    const resolution = resolve("spell-spiritual-weapon", {}, [15, 5]);
    expect(resolution.attack?.outcome).toBe("hit");
    // 1d8 (5) + Wisdom 4.
    expect(resolution.damageTotal).toBe(9);
    expect(action("spell-spiritual-weapon-then-attack")).toMatchObject({
      activation: "bonus-action",
      attack: { reachFeet: 65 },
      damage: [{ formula: "1d8 + 4", type: "force" }]
    });
  });

  it("burns whoever holds the metal when Heat Metal is cast, with no save to avoid it", () => {
    const { resolve, state } = fight(druid);
    const resolution = resolve("spell-heat-metal", {}, [4, 4]);
    expect(resolution.damage).toEqual([{ formula: "2d8", type: "fire", total: 8 }]);
    expect(resolution.save).toBeNull();
    // The only save is the one to keep hold of the object, after the damage.
    expect(state.combat.pendingSaves).toEqual([
      expect.objectContaining({ ability: "con", proposedDamage: 0, actionName: "Heat Metal: keep hold" })
    ]);
  });
});

describe("a save made later, not on the cast", () => {
  it("prompts no save when Spirit Guardians is cast, and leaves the area the server runs around the caster", () => {
    const { resolve, state } = fight(cleric);
    resolve("spell-spirit-guardians", { targetIds: [] });
    expect(state.combat.pendingSaves).toEqual([]);
    expect(state.combat.spellZones).toEqual([
      expect.objectContaining({ spellId: "spirit-guardians", laterActionId: "spell-spirit-guardians-then-save" })
    ]);
  });

  it("resolves the later save against a creature: Wisdom, 3d8 Radiant, half on a success", () => {
    const { resolve, state } = fight(cleric);
    resolve("spell-spirit-guardians", { targetIds: [] });
    resolve("spell-spirit-guardians-then-save", {}, [3, 3, 3]);
    expect(state.combat.pendingSaves).toEqual([
      expect.objectContaining({ ability: "wis", targetActorId: FOE, proposedDamage: 9, halfOnSuccess: true })
    ]);
  });

  it("keeps the caster's Concentration on Spirit Guardians through its later save", () => {
    const { resolve, state, hero } = fight(cleric);
    resolve("spell-spirit-guardians", { targetIds: [] });
    const concentrating = () => hero.effects.filter((effect) => effect.tags.includes("concentrating"));
    const [cast] = concentrating();
    const later = resolve("spell-spirit-guardians-then-save", {}, [3, 3, 3]);
    expect(concentrating()).toEqual([cast]);
    expect(later.tableNarration?.some((line) => /Concentrating on Spirit Guardians ended/.test(line.text))).not.toBe(
      true
    );
    expect(state.combat.pendingSaves).toHaveLength(1);
  });

  it("prompts nobody for a save when Haste lands on an ally", () => {
    const { resolve, state } = fight(wizard, { ally: true });
    resolve("spell-haste", { targetIds: [ALLY] });
    expect(state.combat.pendingSaves).toEqual([]);
  });
});

describe("a failed save's conditions", () => {
  it("leaves Hypnotic Pattern's target Charmed and Incapacitated", () => {
    const { resolve, state } = fight(wizard);
    resolve("spell-hypnotic-pattern", {});
    expect(state.combat.pendingSaves[0]!.conditionIds).toEqual(["charmed", "incapacitated"]);
  });
});

describe("a damage type the caster picks", () => {
  it("deals Chromatic Orb's damage as the type picked, and refuses one the spell doesn't offer", () => {
    const { resolve, hero } = fight(wizard);
    // Its material is "a diamond worth 50+ GP", which the caster must carry.
    hero.inventory.push({ id: "diamond", name: "Diamond", quantity: 1, equipped: false, attuned: false });
    expect(resolve("spell-chromatic-orb", { damageType: "fire" }, [15, 3, 3, 3]).damage[0]).toMatchObject({
      type: "fire",
      total: 9
    });
    const again = fight(wizard);
    expect(() => again.resolve("spell-chromatic-orb", { damageType: "radiant" }, [15])).toThrowError(
      /can't deal radiant damage/
    );
  });
});

describe("Produce Flame", () => {
  it("is cast with no attack; the hurl is a Magic action out to 60 feet, scaling with the caster's level", () => {
    expect(druid.actions.find((action) => action.id === "spell-produce-flame")).toMatchObject({
      activation: "bonus-action",
      damage: []
    });
    expect(druid.actions.find((action) => action.id === "spell-produce-flame")?.attack).toBeUndefined();
    const { resolve, action, state } = fight(druid, { distance: 50 });
    resolve("spell-produce-flame", { targetIds: [] });
    state.combat.turn = { ...state.combat.turn, actionUsed: false };
    expect(action("spell-produce-flame-then-hurl")).toMatchObject({
      activation: "action",
      attack: { rangeFeet: 60 },
      damage: [{ formula: "2d8", type: "fire" }]
    });
    expect(resolve("spell-produce-flame-then-hurl", {}, [15, 3, 3]).attack?.outcome).toBe("hit");
  });
});

describe("Sacred Flame", () => {
  it("gives the target no cover bonus on its save", () => {
    const { resolve, state } = fight(cleric);
    resolve("spell-sacred-flame", { cover: "half" });
    expect(state.combat.pendingSaves[0]!.saveBonus).toBe(0);
  });
});

describe("a spell that takes a minute or more to cast", () => {
  const caster = build(wizardInput(["alarm", "magic-missile"]));

  it("takes the Magic action, and in a fight the action on each turn of its minute", () => {
    const { resolve, action, hero } = fight(caster);
    expect(action("spell-alarm").activation).toBe("action");
    expect(
      resolve("spell-alarm", { targetIds: [] })
        .tableNarration?.map((line) => line.text)
        .join(" ")
    ).toMatch(/begins casting Alarm\. It takes the action on each of .+'s next 9 turns, with Concentration held\./);
    expect(hero.effects.some((effect) => effect.longCast?.actionId === "spell-alarm")).toBe(true);
  });

  it("can't be cast while the caster is Incapacitated", () => {
    const { resolve, hero } = fight(caster);
    hero.conditions = [{ id: "unconscious" }];
    expect(() => resolve("spell-alarm", { targetIds: [] })).toThrowError(/can't take actions/);
  });
});

describe("a healing spell with an area", () => {
  it("is cast at the creatures the caster picks, not every creature under a template", () => {
    const massCure = castAction(
      { id: "ring" },
      { spellId: "mass-cure-wounds", consumesSpellSlot: false },
      "Ring",
      cleric,
      view.spellRecord("mass-cure-wounds")
    );
    expect(massCure.healing).toBeDefined();
    expect(massCure.area).toBeUndefined();
    const fireball = castAction(
      { id: "ring" },
      { spellId: "fireball", consumesSpellSlot: false },
      "Ring",
      cleric,
      view.spellRecord("fireball")
    );
    expect(fireball.area).toMatchObject({ shape: "sphere", sizeFeet: 20 });
  });
});

describe("a save or healing spell's targets", () => {
  it("are no more than the spell targets at the slot it is cast with", () => {
    const { resolve } = fight(wizard);
    expect(() => resolve("spell-hold-person", { targetIds: [FOE, FOE2] })).toThrowError(
      /Hold Person targets one creature; 2 were chosen/
    );
    const upcast = fight(wizard);
    expect(() => upcast.resolve("spell-hold-person", { targetIds: [FOE, FOE2], slotLevel: 3 })).not.toThrow();
  });

  it("are within the spell's range, a Touch spell's within 5 feet", () => {
    const far = fight(cleric, { distance: 65 });
    expect(() => far.resolve("spell-healing-word", { targetIds: [FOE] })).toThrowError(
      /65 ft away, beyond Healing Word's 60 ft range/
    );
    const near = fight(cleric, { distance: 10 });
    expect(() => near.resolve("spell-cure-wounds", { targetIds: [FOE] })).toThrowError(/beyond Cure Wounds's touch/);
    const touching = fight(cleric, { distance: 5 });
    expect(() => touching.resolve("spell-cure-wounds", { targetIds: [FOE] })).not.toThrow();
  });
});
