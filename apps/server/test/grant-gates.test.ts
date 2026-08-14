import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { FeatureGrantsSchema, grantedSpellGateMessage } from "@vtt/content-srd-5.2.1";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary, type ContentView } from "../src/content-library.js";
import { deriveEquipment, equipmentCatalogOf, type EquipmentCatalog, type EquipmentRecordLike, type FeatureRecordLike } from "../src/equipment-derivation.js";
import { applyDamageDetailed, damageAdjustmentDetail } from "../src/hit-points.js";
import { setCondition } from "../src/actor-conditions.js";
import { validateForPublish, type HomebrewValidationContext } from "../src/homebrew-validate.js";
import { EMPTY_AUTHORED_INDEX } from "../src/homebrew-store.js";

/**
 * W3 - A GRANTED RESISTANCE, IMMUNITY OR PROFICIENCY CAN CARRY A CONDITION.
 *
 * `FeatureGrantsSchema` was eleven id lists with NO gate while every sibling in
 * `FeatureModifierSchema` spread `when` + `scope`, so a grant the SRD prints under a condition could
 * only be authored UNCONDITIONALLY. That is an over-grant, and the content lanes correctly refused
 * to author one - `Belt of Dwarvenkind`'s "If you aren't a dwarf or duergar" Poison Resistance and
 * `Helm of Brilliance`'s "As long as the helm has at least one ruby" Fire Resistance are both
 * absences, while `Boots of the Winterlands`' identical-looking but UNGATED resistance ships
 * (`packages/content-srd-5.2.1/scripts/item-mechanics/worn-wondrous.ts`, limit W3).
 *
 * EVERY TEST HERE ENDS AT A NUMBER THE TABLE READS - a halved damage total, a full one, a refused
 * condition - never at a derived struct. "The gate survived into `derivation.damageResistances`"
 * would pass with the damage maths never consulting it, which is the whole class of bug this closes.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  kin: "10000000-0000-4000-8000-000000000003",
  foe: "10000000-0000-4000-8000-000000000002"
} as const;

const item = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse({ id: "x", name: "X", ...over });

/** Two heroes with IDENTICAL numbers; only `race.id` differs, which is the only thing the gate reads. */
function definitionOf(speciesId: string): ActorDefinition {
  return {
    name: speciesId === "dwarf" ? "Durn" : "Aeliel", armorClass: 12, proficiencyBonus: 2,
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 40 }, actions: [], extensions: {},
    character: { classes: [{ id: "fighter", name: "Fighter", level: 5 }], feats: [], race: { id: speciesId, name: speciesId } },
    proficiencies: { saves: [], skills: [], weapons: [], armor: [], tools: [] }
  } as unknown as ActorDefinition;
}

function catalogOf(records: readonly EquipmentRecordLike[], features: readonly FeatureRecordLike[] = []): EquipmentCatalog {
  return {
    equipmentRecord: (id) => records.find((record) => record.id === id),
    featRecord: () => undefined,
    featureRecord: (ref) => features.find((record) => record.id === ref.id)
  };
}

function stateWith(inventory: InventoryItem[], extra: Record<string, unknown> = {}): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Durn", kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12, definitionId: "def-dwarf", inventory, ...extra },
    { id: IDS.kin, name: "Aeliel", kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12, definitionId: "def-elf", inventory: [...inventory] },
    { id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }
  ] });
}

/** The whole damage path a `actor.apply-damage` command runs (`game-operations.ts:1053`), verbatim. */
const hit = (state: GameState, actorId: string, amount: number, type: string, definition: ActorDefinition, catalog: EquipmentCatalog) =>
  applyDamageDetailed(state, actorId, { parts: [{ amount, type }], amount }, { role: "gm" }, { resolveDefinition: () => definition, catalog });

// -------------------------------------------------------------------------------------------------
// THE FAR END: one hit, two totals, differing only by the gate.
// -------------------------------------------------------------------------------------------------

/**
 * The authored record, PARSED THROUGH THE REAL SCHEMA rather than hand-shaped.
 *
 * `equipment-derivation.ts` reads grants through a structural `RiderBlockLike` view, so a test that
 * hand-writes the block proves the derivation reads a shape - not that the shape a GM can author is
 * that shape. Parsing it here means the authoring schema and the collector are held to one object.
 */
const FORGE_HELM_GRANTS = FeatureGrantsSchema.parse({
  damageResistances: ["fire"],
  weapons: ["martial-weapons"],
  when: [{ type: "while-character-is", speciesIds: ["dwarf"] }]
});

const FORGE_HELM: EquipmentRecordLike = {
  id: "helm-of-the-forge", name: "Helm of the Forge", category: "wondrous", slot: "head", isMagic: true,
  grants: FORGE_HELM_GRANTS
};

describe("W3 far end: a gated grant on an item halves one hit and not the other", () => {
  it("halves fire for the species the gate names, and lands in full on the one it does not", () => {
    const catalog = catalogOf([FORGE_HELM]);
    const worn = [item({ id: "helm-of-the-forge", name: "Helm of the Forge", equipped: true, category: "wondrous" })];

    const gateHolds = stateWith(worn);
    const resisted = hit(gateHolds, IDS.hero, 20, "fire", definitionOf("dwarf"), catalog);
    expect(resisted.application.totalApplied).toBe(10);
    expect(gateHolds.actors[0].hp.current).toBe(30);

    // THE SAME HELM, THE SAME HIT, THE SAME 20 FIRE. The only difference on the two sheets is the
    // species the gate names, and it is worth twice the damage.
    const gateFails = stateWith(worn);
    const full = hit(gateFails, IDS.kin, 20, "fire", definitionOf("elf"), catalog);
    expect(full.application.totalApplied).toBe(20);
    expect(gateFails.actors[1].hp.current).toBe(20);
    expect(full.application.parts[0].adjustment).toBeNull();
  });

  it("names the helm on the line the table reads, so the smaller number explains itself", () => {
    const state = stateWith([item({ id: "helm-of-the-forge", name: "Helm of the Forge", equipped: true, category: "wondrous" })]);
    const outcome = hit(state, IDS.hero, 20, "fire", definitionOf("dwarf"), catalogOf([FORGE_HELM]));
    expect(outcome.application.parts[0]).toMatchObject({ adjustment: "resistance", adjustmentSource: "Helm of the Forge" });
    expect(damageAdjustmentDetail(outcome.application)).toBe(" (20 fire → 10, resistance: Helm of the Forge)");
  });

  it("grants NOTHING when the gate fails - the block is one condition, not one per list", () => {
    const catalog = catalogOf([FORGE_HELM]);
    const worn = [item({ id: "helm-of-the-forge", name: "Helm of the Forge", equipped: true, category: "wondrous" })];
    const dwarf = deriveEquipment(stateWith(worn).actors[0], definitionOf("dwarf"), catalog);
    expect(dwarf.damageResistances.map((entry) => entry.id)).toEqual(["fire"]);
    expect(dwarf.weaponProficiencies.map((entry) => entry.id)).toEqual(["martial-weapons"]);

    const elf = deriveEquipment(stateWith(worn).actors[1], definitionOf("elf"), catalog);
    expect(elf.damageResistances).toEqual([]);
    expect(elf.weaponProficiencies, "a failed gate must withhold the training too, not only the resistance").toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// BACKWARD COMPATIBILITY: a record with no `when` behaves EXACTLY as it did before the field existed.
// -------------------------------------------------------------------------------------------------

describe("an ungated grant is untouched", () => {
  const BOOTS: EquipmentRecordLike = {
    id: "boots-of-the-winterlands", name: "Boots of the Winterlands", category: "feet", slot: "feet", isMagic: true,
    grants: FeatureGrantsSchema.parse({ damageResistances: ["cold"] })
  };

  it("still halves for a bearer no gate would have named", () => {
    const state = stateWith([item({ id: "boots-of-the-winterlands", name: "Boots of the Winterlands", equipped: true, category: "feet" })]);
    // The elf fails the helm's gate above; the boots have no gate, so the same sheet resists.
    const outcome = hit(state, IDS.kin, 20, "cold", definitionOf("elf"), catalogOf([BOOTS]));
    expect(outcome.application.totalApplied).toBe(10);
  });

  it("parses to an object with no `when` key at all, so no stored record changes shape", () => {
    expect("when" in FeatureGrantsSchema.parse({ damageResistances: ["cold"] })).toBe(false);
    expect(FeatureGrantsSchema.parse({}).when).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// AUTHORING: a gate the derivation cannot answer is REFUSED, never silently ignored.
// -------------------------------------------------------------------------------------------------

describe("the gate vocabulary is narrowed to what a derivation can answer", () => {
  it("takes every static and dynamic gate", () => {
    for (const trigger of [
      { type: "attuned" }, { type: "while-armored" }, { type: "while-unarmored" }, { type: "while-shield" },
      { type: "while-character-is", speciesIds: ["dwarf"] }, { type: "while-proficient-with", kind: "armor", ids: ["heavy-armor"] },
      { type: "while-effect-tag", tags: ["raging"] }, { type: "while-hp-at-or-below", percent: 50 },
      { type: "while-condition", conditionIds: ["poisoned"], present: false }
    ]) {
      expect(() => FeatureGrantsSchema.parse({ damageResistances: ["fire"], when: [trigger] }), JSON.stringify(trigger)).not.toThrow();
    }
  });

  it("refuses a MOMENT by name, because the grant is collected before any roll starts", () => {
    const refused = FeatureGrantsSchema.safeParse({ damageResistances: ["fire"], when: [{ type: "on-attack-roll" }] });
    expect(refused.success).toBe(false);
    expect(refused.error!.issues.map((issue) => issue.message).join(" ")).toContain(
      "A grant is a standing fact, so it cannot wait for a roll: \"on-attack-roll\" is only knowable during one"
    );
  });

  it("refuses a FILTER too, and says where the mechanic belongs instead", () => {
    const refused = FeatureGrantsSchema.safeParse({ damageResistances: ["fire"], when: [{ type: "damage-type-is", damageTypes: ["fire"] }] });
    expect(refused.success).toBe(false);
    expect(refused.error!.issues.map((issue) => issue.message).join(" ")).toContain("move the mechanic to a modifier, where a moment IS read");
  });

  it("keeps the shared trigger rules: no empty identity, no duplicate trigger", () => {
    expect(FeatureGrantsSchema.safeParse({ when: [{ type: "while-character-is" }] }).success).toBe(false);
    expect(FeatureGrantsSchema.safeParse({ when: [{ type: "while-armored" }, { type: "while-armored" }] }).success).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// A REFUSAL, not a number: a gated condition immunity.
// -------------------------------------------------------------------------------------------------

describe("a gated condition immunity refuses the condition only while the gate holds", () => {
  const WARD: EquipmentRecordLike = {
    id: "bloodied-ward", name: "Bloodied Ward", category: "neck", slot: "neck", isMagic: true,
    grants: FeatureGrantsSchema.parse({
      conditionImmunities: ["frightened"],
      when: [{ type: "while-hp-at-or-below", percent: 50 }]
    })
  };
  const worn = () => [item({ id: "bloodied-ward", name: "Bloodied Ward", equipped: true, category: "neck" })];

  it("applies Frightened at full health and refuses it once the gate opens", () => {
    const catalog = catalogOf([WARD]);
    const definition = definitionOf("dwarf");

    const healthy = stateWith(worn());
    setCondition(healthy, IDS.hero, "frightened", true, undefined, { role: "gm" }, { resolveDefinition: () => definition, catalog });
    expect(healthy.actors[0].conditions.map((condition) => condition.id), "at full HP the ward's gate fails and the condition lands").toEqual(["frightened"]);

    const bloodied = stateWith(worn(), { hp: { current: 12, maximum: 40 } });
    const events = setCondition(bloodied, IDS.hero, "frightened", true, undefined, { role: "gm" }, { resolveDefinition: () => definition, catalog });
    expect(events[0].text).toMatch(/immune to Frightened - not applied/);
    expect(bloodied.actors[0].conditions).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------------
// THE BUILDER HALF: a gated grant is never baked, and it still reaches the damage line.
// -------------------------------------------------------------------------------------------------

/**
 * The REAL SRD Dwarf, with `dwarf-resilience`'s printed Poison Resistance put under a gate.
 *
 * Overriding one record on a delegating view rather than inventing a homebrew species keeps every
 * other id in the build request valid, so the only variable between the two builds below is the
 * `when` list. `dwarf-resilience` really is authored as `grants: { damageResistances: ["poison"] }`
 * in `bundles/species.v1.json`, which is why it is the honest record to gate.
 */
function viewWithGatedDwarf(gate: readonly unknown[] | null): ContentView {
  const base = new ContentLibrary().forAudience("gm");
  const gateTrait = <T extends { id: string; grants?: unknown }>(trait: T): T =>
    trait.id !== "dwarf-resilience" || gate === null ? trait : { ...trait, grants: { ...(trait.grants as object), when: gate } };
  return {
    ...base,
    speciesRecord: (id) => {
      const record = base.speciesRecord(id);
      if (!record || id !== "dwarf") return record;
      return { ...record, traits: record.traits.map(gateTrait) };
    },
    featureRecord: (ref) => {
      const record = base.featureRecord(ref);
      return record && ref.id === "dwarf-resilience" ? gateTrait(record as { id: string; grants?: unknown }) as typeof record : record;
    }
  };
}

const dwarfInput = (): CharacterCreateRequestInput => ({
  name: "Durn", speciesId: "dwarf", backgroundId: "soldier", classId: "fighter", level: 1,
  abilityMethod: "standard-array", baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, kind: "language", id: "goblin" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
} as unknown as CharacterCreateRequestInput);

describe("the builder bakes an ungated grant and refuses to bake a gated one", () => {
  const policy = BuilderPolicySchema.parse({});
  const NOT_POISONED = [{ type: "while-condition", conditionIds: ["poisoned"], present: false }] as const;

  it("bakes Dwarven Resilience when it has no gate - the shipped behaviour, unchanged", () => {
    const built = buildCharacterDefinition(dwarfInput(), viewWithGatedDwarf(null), policy);
    expect(built.damageResistances).toContain("poison");
  });

  it("leaves the SAME grant out of the definition once it carries a gate", () => {
    const built = buildCharacterDefinition(dwarfInput(), viewWithGatedDwarf(NOT_POISONED), policy);
    expect(built.damageResistances ?? [], "baking a gated grant IS the over-grant - it would read as 'always'").not.toContain("poison");
    // Not dropped, though: the sheet still records the trait, which is what the derivation looks up.
    expect(built.character!.features!.some((ref) => ref.id === "dwarf-resilience")).toBe(true);
  });

  it("still halves poison at the damage line while the gate holds, and not once it fails", () => {
    const view = viewWithGatedDwarf(NOT_POISONED);
    const built = buildCharacterDefinition(dwarfInput(), view, policy);
    const catalog = equipmentCatalogOf(view);
    const state = stateWith([]);

    const clean = hit(state, IDS.hero, 20, "poison", built, catalog);
    expect(clean.application.totalApplied, "the gate holds: the trait reaches the damage maths from the derivation, not the definition").toBe(10);
    expect(clean.application.parts[0]).toMatchObject({ adjustment: "resistance", adjustmentSource: "Dwarven Resilience" });

    // Flip the ONE fact the gate reads, through the real `condition.set` path. Nothing else moves.
    const poisoned = stateWith([]);
    setCondition(poisoned, IDS.hero, "poisoned", true, undefined, { role: "gm" }, { resolveDefinition: () => built, catalog });
    expect(poisoned.actors[0].conditions.map((condition) => condition.id)).toEqual(["poisoned"]);
    const full = hit(poisoned, IDS.hero, 20, "poison", built, catalog);
    expect(full.application.totalApplied).toBe(20);
  });

  it("counts the resistance ONCE - the builder's half and the derivation's half never overlap", () => {
    const view = viewWithGatedDwarf(NOT_POISONED);
    const built = buildCharacterDefinition(dwarfInput(), view, policy);
    const derivation = deriveEquipment(stateWith([]).actors[0], built, equipmentCatalogOf(view));
    expect(derivation.damageResistances.map((entry) => entry.id)).toEqual(["poison"]);
    expect(built.damageResistances ?? []).not.toContain("poison");
  });

  it("takes nothing from an UNGATED feature here - that half is already inside the definition", () => {
    const view = viewWithGatedDwarf(null);
    const built = buildCharacterDefinition(dwarfInput(), view, policy);
    const derivation = deriveEquipment(stateWith([]).actors[0], built, equipmentCatalogOf(view));
    expect(derivation.damageResistances, "collecting it again would halve twice and name the trait beside an innate defence").toEqual([]);
    expect(built.damageResistances).toContain("poison");
  });
});

// -------------------------------------------------------------------------------------------------
// THE ELEVENTH LIST. The gate covers ten of them; `spells` is refused beside it rather than dropped.
// -------------------------------------------------------------------------------------------------

/**
 * `FeatureGrantsSchema` has ELEVEN lists and the gated path folds TEN. The eleventh is `spells`, and
 * before this it was not withheld by the gate - it was DELETED by it, silently, at authoring time.
 *
 * The measurement that decided the shape of the fix is the first test below: gating the SHIPPED
 * `high-elf-cantrip` does not make Prestidigitation conditional, it makes `definition.spellcasting`
 * `undefined` outright. That is because a granted spell is not recomputed the way the other ten
 * lists are - `character-build.ts` bakes it into four things at build time (the spell row, the
 * prepared/cantrip cap it is excused from, a cantrip's linked action, and for a character with no
 * class spell list the ENTIRE caster block that exists only because something granted a spell), and
 * `actor.preparedSpellIds` is then written state seeded at claim and at every long rest.
 * `deriveEquipment` has no seam that writes any of that, so "a spell you have only while raging" has
 * nowhere coherent to live today.
 *
 * So the pair is REFUSED at the authoring door, by name, naming the spells that would have been
 * lost - not carried, and above all not dropped. A grant that is authored, parsed, stored and read
 * by NOTHING is the silence W1 and W3 both exist to end.
 */
describe("the eleventh list: `spells` beside a `when` is refused, never silently dropped", () => {
  const GATED_FIREBALL = { spells: [{ id: "fireball", level: 3 }], damageResistances: ["fire"], when: [{ type: "while-character-is", speciesIds: ["dwarf"] }] };

  it("refuses the pair at the schema and NAMES the spell that would have gone nowhere", () => {
    const refused = FeatureGrantsSchema.safeParse(GATED_FIREBALL);
    expect(refused.success, "before this, the block parsed happily and the spell reached nothing at all").toBe(false);
    expect(refused.error!.issues.map((issue) => issue.message).join(" ")).toBe(grantedSpellGateMessage(["fireball"]));
    // Machine-addressable, so the editor points at the `spells` box rather than at the record.
    expect(refused.error!.issues.map((issue) => issue.path.join("."))).toEqual(["spells"]);
  });

  it("names EVERY spell in the block, so a GM fixing it knows what to move", () => {
    const refused = FeatureGrantsSchema.safeParse({ ...GATED_FIREBALL, spells: [{ id: "fireball" }, { id: "haste" }] });
    expect(refused.error!.issues[0].message).toContain('"fireball", "haste" would reach nothing at all');
  });

  it("reaches a GM through the real publish door, on the record they are editing", () => {
    const species = (grants: unknown) => ({
      id: "hb-flamekin-a1b2c3", name: "Flamekin", source: "homebrew", speedFeet: 30,
      traits: [{ id: "flamekin-ember", name: "Ember", description: "A spark you carry.", grants }]
    });
    // The SAME record without the gate publishes cleanly, so the refusal below is the only thing
    // wrong with it - `valid: false` here cannot be some other mistake in the fixture.
    const { when: _gate, ...ungated } = GATED_FIREBALL;
    expect(validateForPublish("species", species(ungated), publishContext())).toEqual({ valid: true, issues: [] });

    const validity = validateForPublish("species", species(GATED_FIREBALL), publishContext());
    expect(validity.valid).toBe(false);
    expect(validity.issues).toHaveLength(1);
    expect(validity.issues[0].message).toBe(grantedSpellGateMessage(["fireball"]));
    // Machine-addressable all the way down the record, so the editor opens the right trait and
    // points at the right box rather than printing prose at the top of the form.
    expect(validity.issues[0].path.join(".")).toBe("traits.0.grants.spells");
  });

  it("takes the SAME block once the gate comes off - the refusal is the pair, not the spell", () => {
    const { when: _gate, ...ungated } = GATED_FIREBALL;
    expect(FeatureGrantsSchema.safeParse(ungated).success).toBe(true);
    // And the gate alone is still fine on the other ten, which is what W3 shipped.
    expect(FeatureGrantsSchema.safeParse({ ...GATED_FIREBALL, spells: [] }).success).toBe(true);
  });
});

/**
 * THE UNGATED PATH, UNCHANGED - proven on a shipped record rather than a fixture.
 *
 * `high-elf-cantrip` really is authored as `grants: { spells: [{ id: "prestidigitation", ... }] }` in
 * `bundles/species.v1.json`, and it is one of 41 shipped blocks that grant a spell with no gate. The
 * refusal above must not touch any of them.
 */
function elfViewGating(gate: readonly unknown[] | null): ContentView {
  const base = new ContentLibrary().forAudience("gm");
  const gateTrait = <T extends { id: string; grants?: unknown }>(trait: T): T =>
    trait.id !== "high-elf-cantrip" || gate === null ? trait : { ...trait, grants: { ...(trait.grants as object), when: gate } };
  return {
    ...base,
    speciesRecord: (id) => {
      const record = base.speciesRecord(id);
      if (!record || id !== "elf") return record;
      return { ...record, lineages: record.lineages.map((lineage) => ({ ...lineage, traits: lineage.traits.map(gateTrait) })) };
    },
    featureRecord: (ref) => {
      const record = base.featureRecord(ref);
      return record && ref.id === "high-elf-cantrip" ? gateTrait(record as { id: string; grants?: unknown }) as typeof record : record;
    }
  };
}

const highElfInput = (): CharacterCreateRequestInput => ({
  name: "Aeliel", speciesId: "elf", backgroundId: "soldier", classId: "fighter", level: 1,
  abilityMethod: "standard-array", baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, classId: "fighter", kind: "skill", id: "athletics" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 1, kind: "lineage", id: "high-elf" },
    { level: 1, kind: "skill", id: "insight", payload: { featureId: "elf-keen-senses" } },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, kind: "language", id: "goblin" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
} as unknown as CharacterCreateRequestInput);

describe("an ungated granted spell still arrives, on the shipped record that grants one", () => {
  const policy = BuilderPolicySchema.parse({});

  it("puts Prestidigitation on a Fighter's sheet, always prepared, with a caster block to cast it from", () => {
    const built = buildCharacterDefinition(highElfInput(), elfViewGating(null), policy);
    expect(built.spellcasting!.spells).toEqual([
      { id: "prestidigitation", name: "Prestidigitation", level: 0, prepared: true, alwaysPrepared: true }
    ]);
    // A Fighter has no spell list at all, so this whole block exists ONLY because a trait granted a
    // spell - and `ability: "int"` is the grant's own, which is what makes the DC the elf's.
    expect(built.spellcasting!.ability).toBe("int");
  });

  it("is what gating it USED to destroy - the measurement that made the refusal the right answer", () => {
    // The gate is applied BELOW the schema on purpose: this is what the old silent path did, and it
    // is the reason the pair is refused above rather than carried. `spellcasting` does not become
    // conditional - it ceases to exist, and Prestidigitation is on no sheet anywhere.
    const built = buildCharacterDefinition(highElfInput(), elfViewGating([{ type: "while-effect-tag", tags: ["raging"] }]), policy);
    expect(built.spellcasting, "a gated spell had nowhere to live: the caster block went with it").toBeUndefined();
    expect(JSON.stringify(built)).not.toContain("prestidigitation");
  });
});

/** The publish gate's context, with an empty homebrew slice - tier 1 is the record's own schema. */
function publishContext(): HomebrewValidationContext {
  return { catalog: new ContentLibrary().forAudience("gm"), spellLists: [], authored: EMPTY_AUTHORED_INDEX };
}
