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

  it("merges `choices` - SEVERAL picks on one record - from a class module", () => {
    // The overlay's own docblock has always said "`choice` / `choices` and `options` are here", and
    // for the whole of Stage 4 the type said otherwise: both `Pick<>`s listed `choice` alone, so
    // `choices` was a hard compile error (TS2561) from every class module. Four lanes reported it
    // independently. The multi-pick vocabulary itself shipped in `15b5337` and was reachable only
    // from `feats.v1.json`, which is hand-authored - so Magic Initiate got its level-1 spell and
    // Wizard's Spell Mastery ("a level 1 AND a level 2 spell") could not be said at all.
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

  it("`clears` supersedes a value the record already carries, and clearing an absent key is a no-op", () => {
    // THE INVERSE OF THE TEST ABOVE, and the whole point of the verb (ruled 2026-08-10, decision-log;
    // the alternatives are costed in `docs/product/plan-content-program.md` §4). The collision
    // message's own advice - "remove it from one of the two homes" - becomes something the class
    // module can SAY, instead of requiring a hand edit to a 10,000-line bundle to satisfy it.
    //
    // `modifiers` is cleared too and the record does not carry one: MITIGATION 1, idempotence. A
    // `clears` that has already done its work must stay legal, or the module becomes a build error
    // the moment it succeeds and the next author deletes the line that explains the deletion. It is
    // authored beside its `clears` like any other superseded key - mitigation 2 is per KEY - which
    // is the shape the SECOND build of a hand-authored record takes anyway: run 1 writes the new
    // value into the bundle, run 2 clears what run 1 wrote and authors the identical thing.
    const features = [{ id: "rage", name: "Rage", description: "x", tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, {
      barbarian: { rage: { clears: ["tags", "modifiers"], tags: ["raging"], modifiers: [{ type: "speed", amount: 10 }] } }
    });
    expect(misses).toEqual([]);
    expect(features[0].tags).toEqual(["raging"]);
    expect(features[0].modifiers).toEqual([{ type: "speed", amount: 10 }]);
  });

  it("REFUSES a `clears` with no rider beside it, and deletes nothing", () => {
    // MITIGATION 2: the verb can never be a silent delete-only tool. On a hand-authored record the
    // ETL writes the merged record back over its own input, so a delete is one-way - a module that
    // removed a rider and put nothing in its place would be an irreversible edit with no replacement
    // to review it against. Nothing is deleted on this path either: an invalid entry contributes
    // NOTHING rather than half of itself.
    const features = [{ id: "rage", name: "Rage", description: "x", tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, { barbarian: { rage: { clears: ["tags"] } } });
    expect(misses).toEqual(["barbarian.rage.clears [tags] (deletes without replacing - author the superseding rider in the same entry)"]);
    expect(features[0].tags).toEqual(["already-here"]);
  });

  it("REFUSES a `clears` whose key is unreplaced even when the entry authors a DIFFERENT rider", () => {
    // The hole the per-entry form of mitigation 2 left open, and the reason it is now per KEY.
    // Asking only "does this entry author something" is satisfied by any unrelated rider, so
    // `{ clears: ["choice"], tags: [...] }` passed while deleting a whole `choice` and replacing
    // nothing - on a hand-authored record, an irreversible edit to committed JSON, which is the one
    // outcome the verb was fenced against. Only `choice` is named; `tags` is legitimately authored.
    const features = [{ id: "rage", name: "Rage", description: "x", choice: { id: "c", options: [{ id: "o", name: "O" }] }, tags: ["already-here"] }] as Array<{ id: string } & Record<string, unknown>>;
    const misses = applyMechanics("barbarian", features, {
      barbarian: { rage: { clears: ["choice", "tags"], tags: ["raging"] } }
    });
    expect(misses).toEqual(["barbarian.rage.clears [choice] (deletes without replacing - author the superseding rider in the same entry)"]);
    // Nothing is deleted on the refusal path - the entry contributes NOTHING, not half of itself.
    expect(features[0].choice).toEqual({ id: "c", options: [{ id: "o", name: "O" }] });
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

/**
 * `clears` THROUGH THE BUILD - the far end the unit tests above cannot reach.
 *
 * The unit tests prove `applyMechanics` deletes and merges. They cannot prove the thing that makes
 * the verb hazardous enough to need a ruling: on a HAND_AUTHORED class the ETL reads
 * `bundles/classes.v1.json`, merges the overlay into the records it read, and writes them back over
 * that same file - so a `clears` is a ONE-WAY edit to committed JSON, and the SECOND build reads what
 * the first one wrote. Only running it twice can show that the superseded key is gone from the file
 * and that the module which removed it is still legal on the next run.
 *
 * The three statements below ARE the ETL's hand-authored branch (`build-class-bundle.ts:841-846` and
 * `:973`); the script is top-level code that reads sources and rewrites bundles on import, so a test
 * cannot call it. It is replicated rather than imported, and the replica is PINNED to the loop it
 * stands for - see the first assertion - so it cannot drift into passing about nothing. It runs over
 * a COPY in a temp directory: the committed bundle is never touched.
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
    // THE PIN. If the hand-authored branch stops doing exactly what `buildOnce` does, this fails here
    // rather than leaving the rest of the test green about a loop that no longer exists.
    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("applyMechanics(record.id, record.features, CLASS_MECHANICS)");
    expect(script).toContain("ClassReferenceSchema.parse(record)");
    expect(script).toContain('writeFileSync(join(bundles, "classes.v1.json")');
    expect(script).toContain("JSON.stringify(allClasses, null, 1)");

    // THE CARRIER IS CHOSEN BY PROPERTY, NOT BY NAME: the first hand-authored feature that still
    // ships a `choice`. The program's one measured case is `wizard.spell-mastery` ("choose a level 1
    // AND a level 2 spell", shipped as one pick of two capped at level 2) and C4 supersedes it FOR
    // REAL through this verb - at which point that feature stops carrying a `choice` and a test that
    // named it would go red for the best possible reason. The rule keeps working; the property is
    // what is being tested.
    const shipped = JSON.parse(readFileSync(bundlePath, "utf8")) as RecordShape[];
    const carrier = shipped
      .filter((record) => HAND_AUTHORED.has(record.id))
      .flatMap((record) => record.features.map((feature) => ({ recordId: record.id, feature })))
      .find(({ feature }) => feature.choice !== undefined && feature.choices === undefined);
    expect(carrier, "no hand-authored feature ships a `choice` for `clears` to supersede").toBeDefined();
    const { recordId, feature: before } = carrier!;
    expect(featurePicks(before)).toHaveLength(1);

    // The replacement is DERIVED from the record's own pick, so it is schema-valid for whichever
    // feature the rule above landed on, and it is the shape of the measured case: one pick becomes
    // two. `choice` and `choices` cannot coexist on a record (`oneChoiceForm`), which is the second
    // mechanism - beside the collision guard - that made this unauthorable before `clears`.
    const replacement: ChoiceInput[] = [{ ...before.choice!, choose: 1 }, { ...before.choice!, choose: 1 }];
    const overlay: MechanicsOverlay = { [recordId]: { [before.id]: { clears: ["choice"], choices: replacement } } };

    const directory = await mkdtemp(join(tmpdir(), "vtt-overlay-clears-"));
    try {
      const path = join(directory, "classes.v1.json");
      copyFileSync(bundlePath, path);

      expect(buildOnce(path, overlay)).toEqual([]);
      const afterFirst = readFileSync(path, "utf8");

      // MITIGATION 1, where it actually matters: run 2 reads the file run 1 wrote, finds no `choice`
      // left to clear, and neither errors nor changes a byte. The module stays truthful.
      expect(buildOnce(path, overlay)).toEqual([]);
      expect(readFileSync(path, "utf8")).toBe(afterFirst);

      // THE FAR END. Not "the value survived the merge" - the twice-built bundle, parsed with the
      // schema `loadClasses()` itself uses (`src/index.ts:152-154`), offers TWO picks through
      // `featurePicks`, the one accessor `character-build.ts` reads a feature's picks through.
      const built = z.array(ClassReferenceSchema).parse(JSON.parse(afterFirst));
      const after = built.find((record) => record.id === recordId)!.features.find((entry) => entry.id === before.id)!;
      const picks = featurePicks(after);
      expect(picks).toHaveLength(2);
      expect(picks.map((pick) => pick.choose)).toEqual([1, 1]);

      // And the superseded key is GONE FROM THE FILE, not merely absent from a parse - the one-way
      // edit the ruling's third mitigation (review the bundle's `git diff`) exists for.
      const raw = (JSON.parse(afterFirst) as RecordShape[])
        .find((record) => record.id === recordId)!.features.find((entry) => entry.id === before.id)!;
      expect(Object.keys(raw)).not.toContain("choice");
      expect(Object.keys(raw)).toContain("choices");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
