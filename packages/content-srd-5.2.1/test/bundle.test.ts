import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { parseDiceFormula } from "@vtt/rules-5e";
import {
  loadArmor, loadAttribution, loadConditions, loadDamageTypes, loadMonsterDefinitions,
  loadRules, loadSkills, loadSpells, loadWeaponProperties, loadWeapons
} from "../src/index.js";

describe("SRD 5.2.1 monster bundle", () => {
  const monsters = loadMonsterDefinitions();

  it("contains the full srd-2024 bestiary (330 statblocks, cross-validated against the SRD text)", () => {
    expect(monsters.length).toBe(330);
    const ids = monsters.map((monster) => monster.source.externalId);
    expect(new Set(ids).size).toBe(monsters.length);
    // giant-fly is open5e over-inclusion: the SRD 5.2.1 has no such statblock.
    expect(ids).not.toContain("giant-fly");
  });

  it("every definition passes the canonical schema", () => {
    for (const monster of monsters) {
      const parsed = ActorDefinitionSchema.safeParse(monster);
      expect(parsed.success, `${monster.name}: ${JSON.stringify(!parsed.success && parsed.error.issues[0])}`).toBe(true);
    }
  });

  it("every damage and hit-point formula parses with the authoritative dice grammar", () => {
    for (const monster of monsters) {
      if (monster.hitPoints.formula) expect(() => parseDiceFormula(monster.hitPoints.formula!), `${monster.name} hp`).not.toThrow();
      for (const action of monster.actions) for (const part of action.damage) {
        expect(() => parseDiceFormula(part.formula), `${monster.name}/${action.id}`).not.toThrow();
      }
    }
  });

  it("adapts the aboleth stat block faithfully", () => {
    const aboleth = monsters.find((monster) => monster.source.externalId === "aboleth");
    expect(aboleth).toBeDefined();
    expect(aboleth!.armorClass).toBe(17);
    expect(aboleth!.hitPoints).toEqual({ maximum: 150, formula: "20d10 + 40" });
    expect(aboleth!.abilityScores.str).toBe(21);
    expect(aboleth!.size).toBe("large");
    expect(aboleth!.token).toEqual({ disposition: "hostile", footprint: { width: 2, height: 2 } });
    expect(aboleth!.proficiencyBonus).toBe(4);
    const tentacle = aboleth!.actions.find((action) => action.id === "tentacle");
    expect(tentacle?.attack).toEqual({ bonus: 9, reachFeet: 15 });
    expect(tentacle?.damage[0]).toEqual({ formula: "2d6 + 5", type: "bludgeoning" });
    const consume = aboleth!.actions.find((action) => action.id === "consume-memories");
    expect(consume?.save).toEqual({ ability: "int", dc: 16 });
  });

  it("carries structured rules mechanics for the giant crocodile (ADR-0020 golden check)", () => {
    const crocodile = monsters.find((monster) => monster.source.externalId === "giant-crocodile")!;
    expect(crocodile.actions.find((action) => action.id === "multiattack")!.multiattack).toEqual([{ actionId: "bite", count: 1 }, { actionId: "tail", count: 1 }]);
    // Bite: Grappled AND Restrained ride one source-linked rider with the printed escape DC and size cap.
    expect(crocodile.actions.find((action) => action.id === "bite")!.onHit).toEqual([{ conditions: [{ id: "grappled" }, { id: "restrained" }], escapeDc: 15, maxTargetSize: "large" }]);
    const tail = crocodile.actions.find((action) => action.id === "tail")!;
    expect(tail.onHit).toEqual([{ conditions: [{ id: "prone" }], maxTargetSize: "large" }]);
    expect(tail.targetRules).toEqual(["not-grappled-by-source"]);
  });

  it("carries structured limited-use pools (recharge and rest scopes)", () => {
    const byId = (id: string) => monsters.find((monster) => monster.source.externalId === id)!;
    expect(byId("white-dragon-wyrmling").actions.find((action) => action.id === "cold-breath")!.uses).toEqual({ limit: 1, per: "recharge", recharge: 5 });
    // Upstream marks these RECHARGE (rest) but the SRD prints a die range; the param carries it.
    expect(byId("basilisk").actions.find((action) => action.id === "petrifying-gaze-recharge-4-6")!.uses).toEqual({ limit: 1, per: "recharge", recharge: 4 });
    const medusaGaze = byId("medusa").actions.find((action) => action.id === "petrifying-gaze-recharge-5-6")!;
    expect(medusaGaze.uses).toEqual({ limit: 1, per: "recharge", recharge: 5 });
    expect(medusaGaze.name).toBe("Petrifying Gaze (Recharge 5-6)");
    // The one true rest-recharge, and a per-day pool mapped to the long-rest scope.
    expect(byId("cloaker").actions.find((action) => action.uses?.per === "short-rest")!.name).toBe("Phantasms (Recharge after a Short or Long Rest)");
    expect(byId("aboleth").actions.find((action) => action.id === "dominate-mind")!.uses).toEqual({ limit: 2, per: "long-rest" });
    // Coverage floor + no double-printed recharge notes on names.
    const withUses = monsters.flatMap((monster) => monster.actions).filter((action) => action.uses);
    expect(withUses.filter((action) => action.uses!.per === "recharge").length).toBeGreaterThanOrEqual(80);
    for (const action of withUses) expect((action.name.match(/\(Recharge /g) ?? []).length, action.name).toBeLessThanOrEqual(1);
  });

  it("splits typed defense lists from the display strings (adult red dragon golden check)", () => {
    const dragon = monsters.find((monster) => monster.source.externalId === "adult-red-dragon")!;
    expect(dragon.damageImmunities).toEqual(["fire"]);
    // Coverage floor: enrichment must not silently regress on a rebuild.
    expect(monsters.filter((monster) => monster.actions.some((action) => action.multiattack)).length).toBeGreaterThanOrEqual(120);
    expect(monsters.filter((monster) => monster.actions.some((action) => action.onHit)).length).toBeGreaterThanOrEqual(40);
    expect(monsters.filter((monster) => (monster.damageResistances?.length ?? 0) + (monster.damageImmunities?.length ?? 0) + (monster.damageVulnerabilities?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(140);
  });

  it("parses save-for-damage from the 'Failure:' clause so failed saves apply damage", () => {
    const byId = (id: string) => monsters.find((monster) => monster.source.externalId === id)!;
    // Fire Breath: "Failure: 45 (10d8) Fire damage. Success: Half damage." → structured 10d8 fire.
    expect(byId("adult-brass-dragon").actions.find((action) => action.id === "fire-breath")!.damage).toEqual([{ formula: "10d8", type: "fire" }]);
    expect(byId("adult-red-dragon").actions.find((action) => action.id === "fire-breath")!.damage).toEqual([{ formula: "17d6", type: "fire" }]);
    // A condition-only breath (no dice in its Failure clause) stays prose-only.
    expect(byId("adult-brass-dragon").actions.find((action) => action.id === "sleep-breath")!.damage).toEqual([]);
    // Coverage floor: most save-for-damage actions are now structured (was 12 before the fix).
    const saveActions = monsters.flatMap((monster) => monster.actions).filter((action) => action.save);
    expect(saveActions.filter((action) => action.damage.length > 0).length).toBeGreaterThanOrEqual(100);
  });

  it("recovers structured attacks from statblock prose when upstream has no attack row", () => {
    const byId = (id: string) => monsters.find((monster) => monster.source.externalId === id)!;
    // rat: flat "1 Piercing damage" - attack is structured, damage stays prose-only.
    const ratBite = byId("rat").actions.find((action) => action.id === "bite");
    expect(ratBite?.attack).toEqual({ bonus: 2, reachFeet: 5 });
    expect(ratBite?.damage).toEqual([]);
    // ankheg: dice primary plus acid rider, parenthetical advantage clause skipped.
    const ankhegBite = byId("ankheg").actions.find((action) => action.id === "bite");
    expect(ankhegBite?.attack).toEqual({ bonus: 5, reachFeet: 5 });
    expect(ankhegBite?.damage).toEqual([
      { formula: "2d6 + 3", type: "slashing" },
      { formula: "1d6", type: "acid" }
    ]);
    // djinni storm bolt: ranged, "feet" wording.
    const stormBolt = byId("djinni").actions.find((action) => action.id === "storm-bolt");
    expect(stormBolt?.attack).toEqual({ bonus: 9, rangeFeet: 120 });
    expect(stormBolt?.damage).toEqual([{ formula: "3d8", type: "thunder" }]);
  });

  it("carries the SRD-printed saving throws where upstream stores modifiers", () => {
    const savesOf = (id: string) => (monsters.find((monster) => monster.source.externalId === id)!.extensions["open5e.srd-2024"] as { savingThrows: Record<string, number | null> }).savingThrows;
    expect(savesOf("mastiff").wis).toBe(3);
    expect(savesOf("swarm-of-rats").dex).toBe(2);
    expect(savesOf("octopus").con).toBeNull();
  });

  it("carries the SRD-printed tiny sizes that upstream flattens to small", () => {
    const sizeOf = (id: string) => monsters.find((monster) => monster.source.externalId === id)?.size;
    expect(sizeOf("rat")).toBe("tiny");
    expect(sizeOf("imp")).toBe("tiny");
    expect(sizeOf("sprite")).toBe("tiny");
    expect(sizeOf("will-o-wisp")).toBe("tiny");
    expect(monsters.filter((monster) => monster.size === "tiny").length).toBe(25);
    // octopus ability-score correction (upstream stored modifiers)
    const octopus = monsters.find((monster) => monster.source.externalId === "octopus");
    expect(octopus?.abilityScores.con).toBe(11);
    expect(octopus?.abilityScores.cha).toBe(4);
  });

  it("keeps monsters hostile and within token footprint bounds", () => {
    for (const monster of monsters) {
      expect(monster.token.disposition).toBe("hostile");
      expect(monster.token.footprint.width).toBeGreaterThanOrEqual(1);
      expect(monster.token.footprint.width).toBeLessThanOrEqual(4);
    }
  });
});

describe("SRD 5.2.1 reference bundles", () => {
  it("carries the fifteen standard conditions", () => {
    expect(loadConditions().map((condition) => condition.id)).toEqual([
      "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated",
      "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
    ]);
  });

  it("carries all 339 spells with faithful structured fields (fireball spot-check)", () => {
    const spells = loadSpells();
    expect(spells.length).toBe(339);
    const fireball = spells.find((spell) => spell.id === "fireball");
    expect(fireball).toMatchObject({
      name: "Fireball", level: 3, school: "evocation", concentration: false, ritual: false,
      attackRoll: false, save: "dex", damage: { roll: "8d6", types: ["fire"] },
      shape: { type: "sphere", size: 20, unit: "feet" }, classes: ["sorcerer", "wizard"]
    });
    expect(fireball!.castingOptions.length).toBeGreaterThanOrEqual(6);
    expect(fireball!.castingOptions[0].damageRoll).toBe("9d6");
    for (const spell of spells) if (spell.damage.roll) expect(() => parseDiceFormula(spell.damage.roll!), spell.id).not.toThrow();
  });

  it("carries the weapon and armor tables (battleaxe and breastplate spot-checks)", () => {
    const weapons = loadWeapons();
    expect(weapons.length).toBe(38);
    expect(weapons.find((weapon) => weapon.id === "battleaxe")).toMatchObject({ category: "martial", damage: { dice: "1d8", type: "slashing" } });
    expect(loadWeaponProperties().length).toBe(17);
    const armor = loadArmor();
    expect(armor.length).toBe(13);
    expect(armor.find((piece) => piece.id === "breastplate")).toMatchObject({ acBase: 14, addDexModifier: true, dexModifierCap: 2 });
  });

  it("carries skills, damage types, and the rules glossary", () => {
    expect(loadSkills().length).toBe(18);
    expect(loadDamageTypes().length).toBe(13);
    const rules = loadRules();
    expect(rules.length).toBe(56);
    expect(rules.some((rule) => rule.ruleset === "Combat")).toBe(true);
    expect(rules.some((rule) => rule.name === "Saving Throws")).toBe(true);
  });
});

describe("attribution", () => {
  it("carries the exact CC BY 4.0 statement the SRD requires", () => {
    const attribution = loadAttribution();
    expect(attribution.license).toBe("CC-BY-4.0");
    expect(attribution.attribution).toContain("This work includes material from the System Reference Document 5.2.1");
    expect(attribution.attribution).toContain("https://creativecommons.org/licenses/by/4.0/legalcode");
  });
});
