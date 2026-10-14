import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CLASS_MECHANICS, HAND_AUTHORED, LIVE_CLASS_RESOURCES, SUBCLASS_MECHANICS, applyMechanics } from "../scripts/class-mechanics/index.js";
import type { FeatureMechanics, MechanicsOverlay } from "../scripts/class-mechanics/index.js";
import { ClassReferenceSchema, featurePicks } from "../src/character-content.js";
import { loadClasses, loadSubclasses } from "../src/index.js";

// `applyMechanics` is tested directly because the ETL is a top-level script, and its failure cases must fail the build.
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
    // `classes.v1.json` is both the ETL's input and output for hand-authored classes, so an overwrite
    // would silently rewrite committed data.
    const features = [{ id: "rage", name: "Rage", description: "x", tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, { barbarian: { rage: { tags: ["raging"] } } });
    expect(misses).toEqual(["barbarian.rage.tags (already authored on the record - remove it from one of the two homes)"]);
    expect(features[0].tags).toEqual(["already-here"]);
  });

  it("`clears` supersedes a value the record already carries, and clearing an absent key is a no-op", () => {
    // A `clears` that has already done its work (key absent) must stay legal, so the second build passes.
    const features = [{ id: "rage", name: "Rage", description: "x", tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, {
      barbarian: { rage: { clears: ["tags", "modifiers"], tags: ["raging"], modifiers: [{ type: "speed", amount: 10 }] } }
    });
    expect(misses).toEqual([]);
    expect(features[0].tags).toEqual(["raging"]);
    expect(features[0].modifiers).toEqual([{ type: "speed", amount: 10 }]);
  });

  it("REFUSES a `clears` with no rider beside it, and deletes nothing", () => {
    // `clears` may never delete without a replacement: on a hand-authored record the delete is irreversible.
    // An invalid entry contributes nothing.
    const features = [{ id: "rage", name: "Rage", description: "x", tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, { barbarian: { rage: { clears: ["tags"] } } });
    expect(misses).toEqual(["barbarian.rage.clears [tags] (deletes without replacing - author the superseding rider in the same entry)"]);
    expect(features[0].tags).toEqual(["already-here"]);
  });

  it("REFUSES a `clears` whose key is unreplaced even when the entry authors a DIFFERENT rider", () => {
    // The replacement check is per key: an unrelated rider in the same entry does not satisfy it.
    const features = [{ id: "rage", name: "Rage", description: "x", choice: { id: "c", options: [{ id: "o", name: "O" }] }, tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, {
      barbarian: { rage: { clears: ["choice", "tags"], tags: ["raging"] } }
    });
    expect(misses).toEqual(["barbarian.rage.clears [choice] (deletes without replacing - author the superseding rider in the same entry)"]);
    expect(features[0].choice).toEqual({ id: "c", options: [{ id: "o", name: "O" }] });
    expect(features[0].tags).toEqual(["already-here"]);
  });

  it("treats an empty rider list as absent, so a bundle's `[]` is not a collision", () => {
    const features = [{ id: "rage", name: "Rage", description: "x", modifiers: [] }] as Array<{ id: string } & Record<string, unknown>>;
    expect(applyMechanics("barbarian", features, { barbarian: { rage: { modifiers: [{ type: "speed", amount: 10 }] } } })).toEqual([]);
    expect(features[0].modifiers).toEqual([{ type: "speed", amount: 10 }]);
  });

  it("reaches a HAND_AUTHORED class - the three the overlay used to skip entirely", () => {
    expect(Object.keys(CLASS_MECHANICS)).toContain("cleric");
    const cleric = loadClasses().find((record) => record.id === "cleric")!;
    const thaumaturge = cleric.features.find((entry) => entry.id === "divine-order")!.choice!.options!
      .find((option) => option.id === "thaumaturge")!;
    expect(thaumaturge.extraPicks).toEqual([{ offer: "class-cantrips", amount: 1 }]);
  });

  it("reaches a GENERATED subclass, which had no authoring surface at all", () => {
    expect(Object.keys(SUBCLASS_MECHANICS)).toContain("draconic-sorcery");
    const draconic = loadSubclasses().find((record) => record.id === "draconic-sorcery")!;
    // `allowShield: true` is authored: the printed feature restricts only "wearing armor", not a Shield.
    expect(draconic.features.find((entry) => entry.id === "draconic-resilience")!.modifiers)
      .toEqual([{ type: "unarmored-defense", ability: "cha", allowShield: true, when: [] }]);
  });

  it("composes the same three exports the ETL consumed before the per-class split", () => {
    expect(CLASS_MECHANICS.barbarian?.rage?.uses).toEqual({ scaling: { type: "class-resource", id: "rage" }, per: "long-rest" });
    // Every live column must be printed on its class's own table.
    expect(LIVE_CLASS_RESOURCES.barbarian).toEqual(["rage"]);
    for (const [classId, resources] of Object.entries(LIVE_CLASS_RESOURCES)) {
      const printed = new Set(loadClasses().find((entry) => entry.id === classId)!.levelTable
        .flatMap((row) => row.classResources.map((resource) => resource.id)));
      expect(resources.length).toBeGreaterThan(0);
      expect(resources.filter((id) => !printed.has(id))).toEqual([]);
    }
    // Classes contributing nothing are omitted rather than mapped to `{}`.
    expect(Object.entries(CLASS_MECHANICS).filter(([, features]) => Object.keys(features).length === 0)).toEqual([]);
    expect(Object.entries(SUBCLASS_MECHANICS).filter(([, features]) => Object.keys(features).length === 0)).toEqual([]);
  });
});

/**
 * `clears` through the build. For hand-authored classes the ETL reads `bundles/classes.v1.json`,
 * merges the overlay and writes the result back over the same file, so only two runs show the
 * superseded key is gone and the module is still legal afterwards. The ETL is a top-level script, so
 * its hand-authored branch is replicated here (and pinned to the script text) and run on a temp copy.
 */
describe("`clears` through the class-bundle build", () => {
  const bundlePath = fileURLToPath(new URL("../bundles/classes.v1.json", import.meta.url));
  const scriptPath = fileURLToPath(new URL("../scripts/build-class-bundle.ts", import.meta.url));

  type ChoiceInput = NonNullable<FeatureMechanics["choice"]>;
  type FeatureShape = { id: string; choice?: ChoiceInput; choices?: ChoiceInput[] };
  type RecordShape = { id: string; features: FeatureShape[] };

  /** One run of the ETL's hand-authored branch over `path`, returning the misses that fail the build. */
  const buildOnce = (path: string, overlay: MechanicsOverlay): string[] => {
    const all = JSON.parse(readFileSync(path, "utf8")) as RecordShape[];
    const misses: string[] = [];
    for (const record of all.filter((entry) => HAND_AUTHORED.has(entry.id))) {
      misses.push(...applyMechanics(record.id, record.features, overlay));
      ClassReferenceSchema.parse(record);
    }
    writeFileSync(path, `${JSON.stringify(all, null, 1)}\n`);
    return misses;
  };

  it("removes the superseded key from the written bundle, lands the replacement, and is clean on the second run", async () => {
    // Pins the replica to the script's hand-authored branch.
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("applyMechanics(record.id, record.features, CLASS_MECHANICS)");
    expect(script).toContain("ClassReferenceSchema.parse(record)");
    expect(script).toContain('writeFileSync(join(bundles, "classes.v1.json")');
    expect(script).toContain("JSON.stringify(allClasses, null, 1)");

    // The carrier is chosen by property (first hand-authored feature still shipping a single `choice`)
    // so the test survives that feature being superseded for real.
    const shipped = JSON.parse(readFileSync(bundlePath, "utf8")) as RecordShape[];
    const carrier = shipped
      .filter((record) => HAND_AUTHORED.has(record.id))
      .flatMap((record) => record.features.map((feature) => ({ recordId: record.id, feature })))
      .find(({ feature }) => feature.choice !== undefined && feature.choices === undefined);
    expect(carrier, "no hand-authored feature ships a `choice` for `clears` to supersede").toBeDefined();
    const { recordId, feature: before } = carrier!;
    expect(featurePicks(before)).toHaveLength(1);

    // `choice` and `choices` cannot coexist on a record (`oneChoiceForm`).
    const replacement: ChoiceInput[] = [{ ...before.choice!, choose: 1 }, { ...before.choice!, choose: 1 }];
    const overlay: MechanicsOverlay = { [recordId]: { [before.id]: { clears: ["choice"], choices: replacement } } };

    const directory = await mkdtemp(join(tmpdir(), "vtt-overlay-clears-"));
    try {
      const path = join(directory, "classes.v1.json");
      copyFileSync(bundlePath, path);

      expect(buildOnce(path, overlay)).toEqual([]);
      const afterFirst = readFileSync(path, "utf8");

      // Run 2 reads run 1's output, finds nothing to clear, and changes no byte.
      expect(buildOnce(path, overlay)).toEqual([]);
      expect(readFileSync(path, "utf8")).toBe(afterFirst);

      // Parsed with the same schema `loadClasses()` uses, read through `featurePicks`.
      const built = z.array(ClassReferenceSchema).parse(JSON.parse(afterFirst));
      const after = built.find((record) => record.id === recordId)!.features.find((entry) => entry.id === before.id)!;
      const picks = featurePicks(after);
      expect(picks).toHaveLength(2);
      expect(picks.map((pick) => pick.choose)).toEqual([1, 1]);

      // The superseded key is gone from the file itself, not just from a parse.
      const raw = (JSON.parse(afterFirst) as RecordShape[])
        .find((record) => record.id === recordId)!.features.find((entry) => entry.id === before.id)!;
      expect(Object.keys(raw)).not.toContain("choice");
      expect(Object.keys(raw)).toContain("choices");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
