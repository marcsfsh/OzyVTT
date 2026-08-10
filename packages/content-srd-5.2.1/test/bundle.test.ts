import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { parseDiceFormula } from "@vtt/rules-5e";
import {
  applySpellListOverlay, ArmorReferenceSchema, ConditionReferenceSchema, EquipmentReferenceSchema,
  loadArmor, loadAttribution, loadConditions, loadDamageTypes, loadEquipment, loadMonsterDefinitions,
  loadRules, loadSkills, loadSpells, loadWeaponProperties, loadWeapons, resolveSpellLists,
  RuleReferenceSchema, SkillReferenceSchema, spellListMemberIds, SpellListReferenceSchema,
  SpellReferenceSchema, WeaponPropertyReferenceSchema, WeaponReferenceSchema,
  type EquipmentReference, type SpellReference, type WeaponReference
} from "../src/index.js";

/**
 * THE INFERENCE-BUDGET GUARD, and it is a TYPE assertion on purpose - it cannot be a runtime one.
 *
 * `EquipmentReferenceSchema` is the largest object in this package. Inlining one more property in it
 * once pushed `z.infer` past TypeScript's expansion budget, and the compiler responded by silently
 * truncating a DIFFERENT inferred type: the spell shape `packages/domain`'s `catalog-choice.ts`
 * reads went missing its attack-roll and range fields, with no error at the edit site. That is why
 * `EquipmentWeaponStatsSchema` is a NAMED schema (`schemas.ts`), and adding a key to it - as
 * `properties` did - is exactly the move that broke it.
 *
 * `Has` fails to compile when the key is missing, when its type has collapsed to `any` or `never`,
 * or when it no longer satisfies the expected shape - so the failure lands here at `npm run check`
 * (this package typechecks `test`) rather than as a mystery two packages away. Runtime
 * `toMatchObject` cannot catch it: the VALUE is always there; it is the TYPE that goes.
 *
 * Both collapse arms are load-bearing and neither is reachable through plain `extends`. A bare
 * `T[K] extends Expected` answers TRUE for `any` (a conditional on `any` returns both branches
 * unioned, and `true | never` is `true`) and TRUE for `never` (which extends everything), so the
 * two shapes a truncated inference actually takes were the two this guard used to wave through.
 *
 * SCOPE, because this guard is easy to over-read: it proves these types are intact IN THIS
 * PACKAGE'S program. Instantiation budgets are per-program, so it cannot reproduce exhaustion in a
 * larger one - and the historic truncation surfaced in `packages/domain`. The matching assertion
 * for that program lives beside the code that suffered it, in `packages/domain/test/catalog-choice.test.ts`.
 */
type Has<T, K extends keyof T, Expected> =
  0 extends (1 & T[K]) ? never
  : [T[K]] extends [never] ? never
  : T[K] extends Expected ? true : never;
const _inferenceBudget: [
  Has<SpellReference, "attackRoll", boolean>,
  Has<SpellReference, "range", { distance: number | null; unit: string | null; text: string | null }>,
  Has<WeaponReference, "mastery", string | undefined>,
  Has<WeaponReference, "properties", readonly string[] | undefined>,
  Has<NonNullable<EquipmentReference["weapon"]>, "properties", readonly string[] | undefined>,
  Has<NonNullable<EquipmentReference["weapon"]>, "damageDice", string>
] = [true, true, true, true, true, true];
void _inferenceBudget;

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

  /**
   * THE REBUILD GUARD for the weapon table's two JOINED-IN columns.
   *
   * Neither exists in the vendored open5e `Weapon` fixtures; both are joined from the markdown SRD's
   * Weapons table by `build-bundle.ts`. Both are `.optional()` on `WeaponReferenceSchema`, so a
   * bundle missing either validates clean and ships inert - which is exactly what `mastery` did. It
   * was hand-added on top of the ETL output, so every `build-bundle` run deleted all 38 in silence,
   * and the weapon assertion above spot-checked Battleaxe's category and damage and never noticed.
   *
   * So this pins every value BY NAME rather than spot-checking or counting. The 38 masteries are the
   * whole data basis for weapon mastery, and the 70 property assignments decide which ability a
   * weapon swings with and what its reach is - a silent re-transcription is a wrong number on a
   * character sheet, and it should be a red test here instead.
   */
  it("emits the SRD mastery and property columns for all 38 weapons, by name", () => {
    const weapons = loadWeapons();
    // The SRD 5.2.1 Weapons table, in the printed order of its four category bands.
    const table: Record<string, [string, string[]]> = {
      // Simple melee
      club: ["slow", ["light"]], dagger: ["nick", ["finesse", "light", "thrown"]], greatclub: ["push", ["two-handed"]],
      handaxe: ["vex", ["light", "thrown"]], javelin: ["slow", ["thrown"]], "light-hammer": ["nick", ["light", "thrown"]],
      mace: ["sap", []], quarterstaff: ["topple", ["versatile"]], sickle: ["nick", ["light"]], spear: ["sap", ["thrown", "versatile"]],
      // Simple ranged
      dart: ["vex", ["finesse", "thrown"]], "light-crossbow": ["slow", ["ammunition", "loading", "two-handed"]],
      shortbow: ["vex", ["ammunition", "two-handed"]], sling: ["slow", ["ammunition"]],
      // Martial melee
      battleaxe: ["topple", ["versatile"]], flail: ["sap", []], glaive: ["graze", ["heavy", "reach", "two-handed"]],
      greataxe: ["cleave", ["heavy", "two-handed"]], greatsword: ["graze", ["heavy", "two-handed"]],
      halberd: ["cleave", ["heavy", "reach", "two-handed"]], lance: ["topple", ["heavy", "reach", "two-handed"]],
      longsword: ["sap", ["versatile"]], maul: ["topple", ["heavy", "two-handed"]], morningstar: ["sap", []],
      pike: ["push", ["heavy", "reach", "two-handed"]], rapier: ["vex", ["finesse"]], scimitar: ["nick", ["finesse", "light"]],
      shortsword: ["vex", ["finesse", "light"]], trident: ["topple", ["thrown", "versatile"]], warhammer: ["push", ["versatile"]],
      "war-pick": ["sap", ["versatile"]], whip: ["slow", ["finesse", "reach"]],
      // Martial ranged
      blowgun: ["vex", ["ammunition", "loading"]], "hand-crossbow": ["vex", ["ammunition", "light", "loading"]],
      "heavy-crossbow": ["push", ["ammunition", "heavy", "loading", "two-handed"]],
      longbow: ["slow", ["ammunition", "heavy", "two-handed"]], musket: ["slow", ["ammunition", "loading", "two-handed"]],
      pistol: ["vex", ["ammunition", "loading"]]
    };
    expect(Object.keys(table).length).toBe(38);
    expect(weapons.map((weapon) => weapon.id).sort()).toEqual(Object.keys(table).sort());

    // BY NAME, both columns at once: the failure message says which weapon and what it lost.
    const actual = Object.fromEntries(weapons.map((weapon) => [weapon.id, [weapon.mastery, weapon.properties]]));
    expect(actual, "a build-bundle run changed or dropped the MASTERY / PROPERTIES columns").toEqual(table);
    // 70 assignments over 9 slugs - the count the join is measured by, restated so a wholesale drop
    // reads as a number rather than as a diff.
    expect(weapons.flatMap((weapon) => weapon.properties!).length).toBe(70);

    // Every slug used is one the weapon-property bundle actually publishes, bare of the fixture's
    // own `-wp`/`-mastery` suffix - so a typo cannot reach a reader that matches on the bare word.
    const bare = (kind: "property" | "mastery") =>
      new Set(loadWeaponProperties().filter((row) => row.kind === kind).map((row) => row.id.replace(/-(wp|mastery)$/, "")));
    expect(bare("property").size).toBe(9);
    expect(bare("mastery").size).toBe(8);
    for (const weapon of weapons) {
      expect(bare("mastery"), weapon.id).toContain(weapon.mastery);
      for (const property of weapon.properties!) expect(bare("property"), `${weapon.id}: ${property}`).toContain(property);
    }
    // A Mace really has no properties, and that is a different claim from "not recorded" - the
    // reason the column is an empty array here rather than an absent key.
    expect(weapons.find((weapon) => weapon.id === "mace")!.properties).toEqual([]);
  });

  it("folds the vendored gear bundle together with weapons and armor into one addable catalog", () => {
    const equipment = loadEquipment();
    // The gear bundle (ammunition/gear/tools/packs/focuses/consumables) plus every non-improvised
    // weapon and every armor piece, mapped into the unified shape.
    const nonImprovisedWeapons = loadWeapons().filter((weapon) => !weapon.improvised).length;
    expect(equipment.length).toBe(132 + nonImprovisedWeapons + loadArmor().length);
    expect(equipment.length).toBeGreaterThan(150);

    // Every category the framework promises is represented (the homebrew update extends these).
    const categories = new Set(equipment.map((item) => item.category));
    for (const category of ["weapon", "armor", "shield", "ammunition", "adventuring-gear", "tool", "equipment-pack", "focus", "consumable"]) {
      expect(categories, category).toContain(category);
    }

    // Ids are unique across the folded-in bundles so an add-from-catalog pick is unambiguous.
    const ids = equipment.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    // Sorted by name for a stable browse order.
    expect(equipment.map((item) => item.name)).toEqual([...equipment.map((item) => item.name)].sort((a, b) => a.localeCompare(b)));

    // A weapon mapped in from weapons.v1.json carries its structured weapon sub-object, no armor.
    const longsword = equipment.find((item) => item.id === "longsword");
    expect(longsword).toMatchObject({ category: "weapon", weapon: { category: "martial", damageDice: "1d8", damageType: "slashing" }, armor: null });
    // Both transcribed columns survive the fold. `properties` has to, or the catalog->inventory copy
    // in `character-build.ts` has nothing to copy and `weaponPropertiesOf` answers [] forever.
    expect(equipment.find((item) => item.id === "dagger")!.weapon).toMatchObject({ mastery: "nick", properties: ["finesse", "light", "thrown"] });
    // The shield row is classified from its low base AC; body armor keeps its own category.
    expect(equipment.find((item) => item.id === "shield")).toMatchObject({ category: "shield", armor: { acBase: 2 } });
    expect(equipment.find((item) => item.id === "plate-armor")).toMatchObject({ category: "armor", armor: { acBase: 18 } });
    // A hand-authored gear entry keeps its cost/weight and has neither sub-object.
    expect(equipment.find((item) => item.id === "potion-of-healing")).toMatchObject({ category: "consumable", costGp: 50, weightLb: 0.5, weapon: null, armor: null });
    expect(equipment.find((item) => item.id === "thieves-tools")).toMatchObject({ category: "tool", costGp: 25 });
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

/**
 * The homebrew seam on the reference records: one source discriminator, an open item category, and
 * the strictness that stays. These assertions exist because the failure they cover is SILENT - a
 * plain `z.object` strips an undeclared key with no error, so a schema that does not declare
 * `source` loses `source: "homebrew"` on the way in and nothing anywhere reports it.
 */
describe("homebrew source discriminator and open item categories", () => {
  const spellBody = {
    id: "hb-grave-touch", name: "Grave Touch", level: 1, school: "necromancy", castingTime: "1 action",
    reactionCondition: null, range: { distance: null, unit: null, text: "Touch" },
    components: { verbal: true, somatic: true, material: false, materialText: null, materialConsumed: false },
    duration: "Instantaneous", concentration: false, ritual: false, attackRoll: true,
    damage: { roll: "1d10", types: ["necrotic"] }, save: null, target: { type: "creature", count: 1 },
    shape: null, classes: ["hb-necromancer"], description: "A withering touch.", higherLevel: null, castingOptions: []
  };
  const gearBody = { id: "hb-grave-lantern", name: "Grave Lantern", category: "relic", costGp: 250, weightLb: 2, description: null };
  const records: ReadonlyArray<readonly [string, z.ZodTypeAny, Record<string, unknown>]> = [
    ["spell", SpellReferenceSchema, spellBody],
    ["equipment", EquipmentReferenceSchema, gearBody],
    ["weapon", WeaponReferenceSchema, { id: "hb-scythe", name: "Scythe", category: "martial", improvised: false, damage: { dice: "1d10", type: "slashing" }, rangeFeet: null, longRangeFeet: null }],
    ["armor", ArmorReferenceSchema, { id: "hb-bone-mail", name: "Bone Mail", acBase: 14, addDexModifier: true, dexModifierCap: 2, stealthDisadvantage: false, strengthRequired: null }],
    ["weapon property", WeaponPropertyReferenceSchema, { id: "hb-withering", name: "Withering", kind: "property", description: "x" }],
    ["condition", ConditionReferenceSchema, { id: "hb-marked", name: "Marked", description: "x" }],
    ["skill", SkillReferenceSchema, { id: "hb-lore", name: "Lore", description: "x" }],
    ["rule", RuleReferenceSchema, { id: "hb-grave-rules", name: "Grave Rules", ruleset: "Combat", order: 1, description: "x" }]
  ];

  it("round-trips `source: \"homebrew\"` on every reference record instead of stripping it", () => {
    for (const [label, schema, body] of records) {
      const parsed = schema.parse({ ...body, source: "homebrew" }) as { source?: string };
      expect(parsed.source, label).toBe("homebrew");
    }
  });

  it("strips an UNdeclared key from the very same schemas - which is what `source` used to be", () => {
    // The injection that proves the test above bites: same schema, same call, a key that is NOT
    // declared comes back gone, with no error raised. Declaring the field is the entire fix.
    for (const [label, schema, body] of records) {
      if (schema === EquipmentReferenceSchema) continue; // the one .strict() record - covered below
      const parsed = schema.parse({ ...body, contentSource: "homebrew" }) as Record<string, unknown>;
      expect(parsed.contentSource, label).toBeUndefined();
    }
  });

  it("defaults every committed bundle row to \"srd\", so no bundle needed rewriting", () => {
    expect(loadSpells().every((spell) => spell.source === "srd")).toBe(true);
    expect(loadWeapons().every((weapon) => weapon.source === "srd")).toBe(true);
    expect(loadArmor().every((piece) => piece.source === "srd")).toBe(true);
    expect(loadWeaponProperties().every((entry) => entry.source === "srd")).toBe(true);
    expect(loadConditions().every((entry) => entry.source === "srd")).toBe(true);
    expect(loadSkills().every((entry) => entry.source === "srd")).toBe(true);
    expect(loadRules().every((entry) => entry.source === "srd")).toBe(true);
    // The folded catalog carries each mapped-in row's own source through the fold.
    expect(loadEquipment().every((item) => item.source === "srd")).toBe(true);
  });

  it("accepts any homebrew category slug while keeping the slug shape", () => {
    expect(EquipmentReferenceSchema.parse(gearBody).category).toBe("relic");
    expect(EquipmentReferenceSchema.parse({ ...gearBody, category: "wondrous" }).category).toBe("wondrous");
    expect(() => EquipmentReferenceSchema.parse({ ...gearBody, category: "Relic Item" })).toThrow();
  });

  it("keeps .strict() on the equipment record, so a typo'd key is caught rather than lost", () => {
    // The opposite failure mode from the strip above, and the reason this ONE record stays strict:
    // a hand-authored homebrew item is the only place a mistyped key is likely, and it is the only
    // schema in the system that will tell you about it.
    expect(() => EquipmentReferenceSchema.parse({ ...gearBody, weight: 2 })).toThrow();
    expect(() => EquipmentReferenceSchema.parse({ ...gearBody, requiresAttunement: true })).toThrow();
    // ...and the OTHER half of that contract: declaring a field is what makes it real. `rarity` and
    // `isMagic` used to throw here for exactly the same reason `weight` still does. The magic-item
    // vocabulary is not a loosened schema; it is a longer list of declared keys.
    const magic = EquipmentReferenceSchema.parse({ ...gearBody, rarity: "rare", isMagic: true, slot: "wondrous" });
    expect(magic.rarity).toBe("rare");
    expect(magic.isMagic).toBe(true);
    expect(magic.slot).toBe("wondrous");
    // Every unauthored rider field materialises as its empty default, so a consumer never branches on undefined.
    expect({ cursed: magic.cursed, casts: magic.casts, grantsFeatIds: magic.grantsFeatIds, modifiers: magic.modifiers })
      .toEqual({ cursed: false, casts: [], grantsFeatIds: [], modifiers: [] });
    // A mundane row is untouched by any of it - `isMagic` stays false and the strictness is unchanged.
    expect(EquipmentReferenceSchema.parse(gearBody).isMagic).toBe(false);
  });
});

/**
 * The spell-list overlay: membership declared as a record and folded into `classes` at the merge
 * point, so `bundles/spells.v1.json` - a GENERATED, vendored CC-BY artifact - is never edited.
 */
describe("spell-list overlay", () => {
  const spells = loadSpells();
  const list = (id: string, patch: Partial<{ basedOn: string[]; add: string[]; remove: string[] }> = {}) =>
    SpellListReferenceSchema.parse({ id, name: id, source: "homebrew", ...patch });

  it("folds basedOn + add - remove into `classes`, which is all resolveCatalogChoice reads", () => {
    const necromancer = list("hb-necromancer", { basedOn: ["wizard"], add: ["cure-wounds"], remove: ["fireball"] });
    const overlaid = applySpellListOverlay(spells, [necromancer]);
    const onList = overlaid.filter((spell) => spell.classes.includes("hb-necromancer")).map((spell) => spell.id);

    const wizardList = spells.filter((spell) => spell.classes.includes("wizard")).map((spell) => spell.id);
    expect(wizardList.length).toBeGreaterThan(200);              // the SRD Wizard list, inherited whole
    expect(onList).toContain("magic-missile");                   // via basedOn
    expect(onList).toContain("cure-wounds");                     // an SRD CLERIC spell, added by id
    expect(onList).not.toContain("fireball");                    // removed after expansion
    expect(onList.length).toBe(wizardList.length + 1 - 1);
    // The overlay only ever APPENDS a tag: the SRD Wizard list is untouched by this list's `remove`.
    expect(overlaid.find((spell) => spell.id === "fireball")?.classes).toContain("wizard");
  });

  it("never mutates the loaded bundle (loaders cache their parsed array by identity)", () => {
    const fireballBefore = [...spells.find((spell) => spell.id === "fireball")!.classes];
    applySpellListOverlay(spells, [list("hb-necromancer", { basedOn: ["wizard"] })]);
    expect(loadSpells().find((spell) => spell.id === "fireball")!.classes).toEqual(fireballBefore);
    expect(loadSpells()).toBe(spells);
    // With no lists at all the merge point pays nothing and hands the same array straight back.
    expect(applySpellListOverlay(spells, [])).toBe(spells);
  });

  it("reports an empty list at PUBLISH time, before a player hits the hard build rejection", () => {
    // resolveCatalogChoice refuses to return an empty option list and the server turns that into a
    // rejected character.create - so a caster pointed at an empty list is an UNCREATABLE character,
    // not an empty picker. This is where that becomes detectable.
    const blank = list("hb-empty");
    const phantom = list("hb-phantom", { add: ["no-such-spell"], basedOn: ["no-such-list"] });
    const resolution = resolveSpellLists([blank, phantom, list("hb-real", { basedOn: ["cleric"] })], spells);
    expect([...resolution.emptyListIds].sort()).toEqual(["hb-empty", "hb-phantom"]);
    expect(resolution.unknownBasedOn).toEqual(["no-such-list"]);
    expect(spellListMemberIds("hb-empty", [blank], spells).size).toBe(0);
    // The same probe answers for a bare SRD tag, so a publish gate needs no special case.
    expect(spellListMemberIds("wizard", [], spells).size).toBeGreaterThan(200);
    expect(spellListMemberIds("not-a-list", [], spells).size).toBe(0);
  });

  it("counts a spell that tags the list itself, so a wholly-homebrew list needs no `add`", () => {
    const homebrewSpell = { id: "hb-grave-touch", classes: ["hb-necromancer"] };
    const members = spellListMemberIds("hb-necromancer", [list("hb-necromancer")], [...spells, homebrewSpell]);
    expect([...members]).toEqual(["hb-grave-touch"]);
  });

  it("terminates on a basedOn cycle and names it, rather than looping or throwing at read time", () => {
    const a = list("hb-a", { basedOn: ["hb-b"], add: ["fireball"] });
    const b = list("hb-b", { basedOn: ["hb-a"] });
    const downstream = list("hb-c", { basedOn: ["hb-a"] });          // points AT the loop, is not in it
    const resolution = resolveSpellLists([a, b, downstream], spells);
    expect([...resolution.cyclicListIds].sort()).toEqual(["hb-a", "hb-b"]);
    expect(resolution.cyclicListIds).not.toContain("hb-c");
    expect([...resolution.memberIds.get("hb-a")!]).toEqual(["fireball"]);   // basedOn dropped, `add` kept
  });

  it("flags a list id that shadows an existing spell tag instead of silently merging into it", () => {
    // An unnamespaced `wizard` list would extend the SRD Wizard list rather than create a new one.
    expect(resolveSpellLists([list("wizard", { add: ["cure-wounds"] })], spells).shadowedListIds).toEqual(["wizard"]);
    expect(resolveSpellLists([list("hb-wizard", { basedOn: ["wizard"] })], spells).shadowedListIds).toEqual([]);
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
