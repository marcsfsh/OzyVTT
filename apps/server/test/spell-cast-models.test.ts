import { describe, expect, it } from "vitest";
import { ALLY, build, clericInput, druidInput, fight, FOE, wizardInput } from "./spell-casters.js";

// What each cast does, per SRD 5.2.1: damage dealt when a spell appears, saves made later rather than on the cast,
// a damage type the caster picks, a flame hurled on later turns, and a save that ignores cover.

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
    "misty-step"
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
    expect(state.combat.pendingSaves).toEqual([]);
  });
});

describe("a save made later, not on the cast", () => {
  it("prompts no save when Spirit Guardians is cast, and reminds the GM how the later save is made", () => {
    const { resolve, state } = fight(cleric);
    const resolution = resolve("spell-spirit-guardians", { targetIds: [] });
    expect(state.combat.pendingSaves).toEqual([]);
    expect(resolution.warnings?.join(" ")).toMatch(/ends its turn there.*Spirit Guardians: save/);
  });

  it("resolves the later save against a creature: Wisdom, 3d8 Radiant, half on a success", () => {
    const { resolve, state } = fight(cleric);
    resolve("spell-spirit-guardians-then-save", {}, [3, 3, 3]);
    expect(state.combat.pendingSaves).toEqual([
      expect.objectContaining({ ability: "wis", targetActorId: FOE, proposedDamage: 9, halfOnSuccess: true })
    ]);
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
    const { resolve } = fight(wizard);
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
    expect(druid.actions.some((action) => action.id === "spell-produce-flame")).toBe(false);
    const { resolve, action } = fight(druid, { distance: 50 });
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

  it("takes the Magic action, with a reminder of the turns and Concentration it needs", () => {
    const { resolve, action } = fight(caster);
    expect(action("spell-alarm").activation).toBe("action");
    expect(resolve("spell-alarm", { targetIds: [] }).warnings?.join(" ")).toMatch(
      /Alarm takes 1 minute to cast: the Magic action on each of the caster's turns/
    );
  });

  it("can't be cast while the caster is Incapacitated", () => {
    const { resolve, hero } = fight(caster);
    hero.conditions = [{ id: "unconscious" }];
    expect(() => resolve("spell-alarm", { targetIds: [] })).toThrowError(/can't take actions/);
  });
});
