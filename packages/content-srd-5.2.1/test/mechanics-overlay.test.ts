import { describe, expect, it } from "vitest";
import {
  CLASS_MECHANICS,
  LIVE_CLASS_RESOURCES,
  SUBCLASS_MECHANICS,
  applyMechanics
} from "../scripts/class-mechanics/index.js";
import { loadClasses, loadSubclasses } from "../src/index.js";

// `applyMechanics` is tested directly because the ETL is a top-level script, and its failure cases must fail the build.
describe("the mechanics overlay", () => {
  const feature = () =>
    [{ id: "rage", name: "Rage", description: "x" }] as Array<{ id: string } & Record<string, unknown>>;

  it("merges a rider into a feature", () => {
    const features = feature();
    const misses = applyMechanics("barbarian", features, { barbarian: { rage: { tags: ["raging"] } } });
    expect(misses).toEqual([]);
    expect(features[0].tags).toEqual(["raging"]);
  });

  it("reports a feature id that matches nothing, instead of dropping the rider", () => {
    const features = feature();
    expect(applyMechanics("barbarian", features, { barbarian: { raeg: { tags: ["typo"] } } })).toEqual([
      "barbarian.raeg"
    ]);
  });

  it("merges `choices` - SEVERAL picks on one record - from a class module", () => {
    const features = feature();
    const misses = applyMechanics("barbarian", features, {
      barbarian: {
        rage: {
          choices: [
            { kind: "spell", choose: 1, maxSpellLevel: 1 },
            { kind: "spell", choose: 1, maxSpellLevel: 2 }
          ]
        }
      }
    });
    expect(misses).toEqual([]);
    expect(features[0].choices).toEqual([
      { kind: "spell", choose: 1, maxSpellLevel: 1 },
      { kind: "spell", choose: 1, maxSpellLevel: 2 }
    ]);
  });

  it("merges into an inline OPTION, and reports an option id that matches nothing", () => {
    const features = [
      {
        id: "divine-order",
        name: "Divine Order",
        description: "x",
        choice: { kind: "divine-order", choose: 1, options: [{ id: "thaumaturge", name: "T", description: "y" }] }
      }
    ] as Array<{ id: string } & Record<string, unknown>>;
    const overlay = {
      cleric: {
        "divine-order": {
          options: {
            thaumaturge: { extraPicks: [{ offer: "class-cantrips", amount: 1 }] },
            protecter: { grants: { armor: ["heavy"] } }
          }
        }
      }
    };
    const misses = applyMechanics("cleric", features, overlay);
    expect(misses).toEqual(["cleric.divine-order.protecter"]);
    const options = (features[0].choice as { options: Array<Record<string, unknown>> }).options;
    expect(options[0].extraPicks).toEqual([{ offer: "class-cantrips", amount: 1 }]);
  });

  it("REFUSES to overwrite a value the record already carries", () => {
    // A rider authored both on the record and in the overlay would let one home silently win.
    const features = [{ id: "rage", name: "Rage", description: "x", tags: ["already-here"] }] as Array<
      { id: string } & Record<string, unknown>
    >;
    const misses = applyMechanics("barbarian", features, { barbarian: { rage: { tags: ["raging"] } } });
    expect(misses).toEqual([
      "barbarian.rage.tags (already authored on the record - remove it from one of the two homes)"
    ]);
    expect(features[0].tags).toEqual(["already-here"]);
  });

  it("treats an empty rider list as absent, so a bundle's `[]` is not a collision", () => {
    const features = [{ id: "rage", name: "Rage", description: "x", modifiers: [] }] as Array<
      { id: string } & Record<string, unknown>
    >;
    expect(
      applyMechanics("barbarian", features, { barbarian: { rage: { modifiers: [{ type: "speed", amount: 10 }] } } })
    ).toEqual([]);
    expect(features[0].modifiers).toEqual([{ type: "speed", amount: 10 }]);
  });

  it("reaches a hand-authored class", () => {
    expect(Object.keys(CLASS_MECHANICS)).toContain("cleric");
    const cleric = loadClasses().find((record) => record.id === "cleric")!;
    const thaumaturge = cleric.features
      .find((entry) => entry.id === "divine-order")!
      .choice!.options!.find((option) => option.id === "thaumaturge")!;
    expect(thaumaturge.extraPicks).toEqual([{ offer: "class-cantrips", amount: 1 }]);
  });

  it("adds Potent Spellcasting's Wisdom to the damage of each class's own damaging cantrips", () => {
    const optionOf = (classId: string, featureId: string) =>
      loadClasses()
        .find((record) => record.id === classId)!
        .features.find((entry) => entry.id === featureId)!
        .choice!.options!.find((option) => option.id === "potent-spellcasting")!;
    const gates = (classId: string, featureId: string) =>
      optionOf(classId, featureId).modifiers!.map((modifier) =>
        modifier.type === "extra-damage" ? modifier.when : []
      );
    expect(gates("cleric", "blessed-strikes")).toEqual([
      [{ type: "on-damage-roll" }, { type: "spell-id-is", spellIds: ["sacred-flame"] }]
    ]);
    expect(gates("druid", "elemental-fury")).toEqual([
      [{ type: "on-damage-roll" }, { type: "spell-id-is", spellIds: ["poison-spray", "produce-flame", "starry-wisp"] }]
    ]);
  });

  it("reaches a GENERATED subclass, which had no authoring surface at all", () => {
    expect(Object.keys(SUBCLASS_MECHANICS)).toContain("draconic-sorcery");
    const draconic = loadSubclasses().find((record) => record.id === "draconic-sorcery")!;
    // `allowShield: true` is authored: the printed feature restricts only "wearing armor", not a Shield.
    expect(draconic.features.find((entry) => entry.id === "draconic-resilience")!.modifiers).toEqual([
      { type: "unarmored-defense", ability: "cha", allowShield: true },
      { type: "hit-points-per-level", amount: 1 }
    ]);
  });

  it("composes the per-class modules into the three exports the ETL consumes", () => {
    expect(CLASS_MECHANICS.barbarian?.rage?.uses).toEqual({
      scaling: { type: "class-resource", id: "rage" },
      per: "long-rest"
    });
    // Every live column must be printed on its class's own table.
    expect(LIVE_CLASS_RESOURCES.barbarian).toEqual(["rage"]);
    for (const [classId, resources] of Object.entries(LIVE_CLASS_RESOURCES)) {
      const printed = new Set(
        loadClasses()
          .find((entry) => entry.id === classId)!
          .levelTable.flatMap((row) => row.classResources.map((resource) => resource.id))
      );
      expect(resources.length).toBeGreaterThan(0);
      expect(resources.filter((id) => !printed.has(id))).toEqual([]);
    }
    // Classes contributing nothing are omitted rather than mapped to `{}`.
    expect(Object.entries(CLASS_MECHANICS).filter(([, features]) => Object.keys(features).length === 0)).toEqual([]);
    expect(Object.entries(SUBCLASS_MECHANICS).filter(([, features]) => Object.keys(features).length === 0)).toEqual([]);
  });
});
