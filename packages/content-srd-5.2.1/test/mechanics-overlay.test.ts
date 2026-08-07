import { describe, expect, it } from "vitest";
import { CLASS_MECHANICS, LIVE_CLASS_RESOURCES, SUBCLASS_MECHANICS, applyMechanics } from "../scripts/class-mechanics/index.js";
import { loadClasses, loadSubclasses } from "../src/index.js";

/**
 * THE MECHANICS OVERLAY, held to what it claims: it reaches every one of the twelve classes, it
 * reaches an inline option, and it fails loudly rather than dropping a rider.
 *
 * `applyMechanics` is exercised directly because the ETL is a script, not a module the test suite
 * can call - and because the interesting cases (a key matching nothing, a rider that would overwrite
 * hand-authored content) must FAIL the build, which a test cannot observe by rebuilding.
 */
describe("the mechanics overlay", () => {
  const feature = () => [{ id: "rage", name: "Rage", description: "x" }] as Array<{ id: string } & Record<string, unknown>>;

  it("merges a rider into a feature", () => {
    const features = feature();
    const misses = applyMechanics("barbarian", features, { barbarian: { rage: { tags: ["raging"] } } });
    expect(misses).toEqual([]);
    expect(features[0].tags).toEqual(["raging"]);
  });

  it("reports a feature id that matches nothing, instead of dropping the rider", () => {
    const features = feature();
    expect(applyMechanics("barbarian", features, { barbarian: { raeg: { tags: ["typo"] } } })).toEqual(["barbarian.raeg"]);
  });

  it("merges into an inline OPTION, and reports an option id that matches nothing", () => {
    // The one shape the overlay could not express before, and the reason Thaumaturge's extra cantrip
    // had to be hand-edited into `classes.v1.json`.
    const features = [{
      id: "divine-order", name: "Divine Order", description: "x",
      choice: { kind: "divine-order", choose: 1, options: [{ id: "thaumaturge", name: "T", description: "y" }] }
    }] as Array<{ id: string } & Record<string, unknown>>;
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
    // The hazard the hand-authored three introduce: `classes.v1.json` is both this script's input and
    // its output, so an overlay that overwrote a rider would rewrite the file it was reading and the
    // change would be unreviewable. Two homes, one value, and the build says so.
    const features = [{ id: "rage", name: "Rage", description: "x", tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, { barbarian: { rage: { tags: ["raging"] } } });
    expect(misses).toEqual(["barbarian.rage.tags (already authored on the record - remove it from one of the two homes)"]);
    expect(features[0].tags).toEqual(["already-here"]);
  });

  it("treats an empty rider list as absent, so a bundle's `[]` is not a collision", () => {
    const features = [{ id: "rage", name: "Rage", description: "x", modifiers: [] }] as Array<{ id: string } & Record<string, unknown>>;
    expect(applyMechanics("barbarian", features, { barbarian: { rage: { modifiers: [{ type: "speed", amount: 10 }] } } })).toEqual([]);
    expect(features[0].modifiers).toEqual([{ type: "speed", amount: 10 }]);
  });

  it("reaches a HAND_AUTHORED class - the three the overlay used to skip entirely", () => {
    // `applyMechanics` ran only inside the generation loop, so Cleric, Fighter and Wizard could not
    // use it at all and Thaumaturge was hand-edited into the bundle instead. This is the read-side
    // half: the overlay names a hand-authored class, and the bundle carries what it authors.
    expect(Object.keys(CLASS_MECHANICS)).toContain("cleric");
    const cleric = loadClasses().find((record) => record.id === "cleric")!;
    const thaumaturge = cleric.features.find((entry) => entry.id === "divine-order")!.choice!.options!
      .find((option) => option.id === "thaumaturge")!;
    expect(thaumaturge.extraPicks).toEqual([{ offer: "class-cantrips", amount: 1 }]);
  });

  it("reaches a GENERATED subclass, which had no authoring surface at all", () => {
    expect(Object.keys(SUBCLASS_MECHANICS)).toContain("draconic-sorcery");
    const draconic = loadSubclasses().find((record) => record.id === "draconic-sorcery")!;
    expect(draconic.features.find((entry) => entry.id === "draconic-resilience")!.modifiers)
      .toEqual([{ type: "unarmored-defense", ability: "cha", allowShield: false, when: [] }]);
  });

  it("composes the same three exports the ETL consumed before the per-class split", () => {
    // The split is a refactor: the ETL's inputs must be the same objects, shaped the same way.
    expect(CLASS_MECHANICS.barbarian?.rage?.uses).toEqual({ scaling: { type: "class-resource", id: "rage" }, per: "long-rest" });
    // NOT a snapshot of the whole map: Stage 4 wires a printed column live in four parallel lanes,
    // so an equality against every class would be a merge conflict per lane and would say nothing
    // about the shape. Pin the entry the split was verified against, and hold every entry - whoever
    // authored it - to the invariant that makes the export meaningful: a non-empty list of ids that
    // really are printed columns on that class's own table (`class-resource-pools.test.ts` then
    // proves a live pool answers to each).
    expect(LIVE_CLASS_RESOURCES.barbarian).toEqual(["rage"]);
    for (const [classId, resources] of Object.entries(LIVE_CLASS_RESOURCES)) {
      const printed = new Set(loadClasses().find((entry) => entry.id === classId)!.levelTable
        .flatMap((row) => row.classResources.map((resource) => resource.id)));
      expect(resources.length).toBeGreaterThan(0);
      expect(resources.filter((id) => !printed.has(id))).toEqual([]);
    }
    // A class contributing nothing is OMITTED rather than mapped to `{}`, so `applyMechanics` still
    // short-circuits on it exactly as it did when the overlay was one literal. Stated as the
    // PROPERTY rather than by naming a class that happens to be empty today: Stage 4 authors all
    // twelve in parallel, and "Monk contributes nothing" stopped being true the hour its lane began.
    expect(Object.entries(CLASS_MECHANICS).filter(([, features]) => Object.keys(features).length === 0)).toEqual([]);
    expect(Object.entries(SUBCLASS_MECHANICS).filter(([, features]) => Object.keys(features).length === 0)).toEqual([]);
  });
});
