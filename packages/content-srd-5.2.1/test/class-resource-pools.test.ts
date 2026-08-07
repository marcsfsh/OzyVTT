import { describe, expect, it } from "vitest";
import { loadClasses, loadSubclasses, type ClassReference, type FeatureRecord, type SubclassReference } from "../src/index.js";

/**
 * **`classResources` IS A PRINTED COLUMN, NOT A NAMESPACE - and every id in it says which.**
 *
 * The live pool the engine spends and re-arms is `actor.actionUses[uses.pool ?? action.id]`. A
 * `ClassLevelRow.classResources` id is a different thing: the header off the printed class table.
 * The two are bound BY CONVENTION - an id that matches a `uses.pool` on the same class names the
 * same resource, and `scaling: {type: "class-resource"}` reads its amount - and a convention with
 * no check is a coincidence that stops holding the first time someone renames a column.
 *
 * The failure this prevents is specifically a SILENT one. A `classResources` row that matches no
 * pool parses, ships, and renders as a number on a sheet that nothing can spend; a `resource-bonus`
 * rider aimed at it would parse and store and change nothing. Neither produces an error anywhere.
 *
 * So every id must be one of exactly two things, stated by the content itself:
 *   - it MATCHES a `uses.pool` (or a lone action id) somewhere on that class or its subclasses, or
 *   - it carries `display: true`, which says "ink only" out loud.
 *
 * Today the nine ETL-generated classes are entirely the second kind, because Stage 4 has not
 * authored their mechanics yet - and that is exactly the point of writing it down. When Rage becomes
 * a real pool, its `display: true` comes off in `scripts/build-class-bundle.ts` and this test starts
 * requiring the pool that the flag was standing in for.
 */

const classes = loadClasses();
const subclasses = loadSubclasses();

/** A feature and every inline option under it - both carry the identical `uses` vocabulary. */
function riderNodes(feature: FeatureRecord): Array<{ id: string; uses?: FeatureRecord["uses"]; actions: FeatureRecord["actions"] }> {
  const options = (feature.choice?.options ?? []).map((option) => ({ id: option.id, uses: option.uses, actions: option.actions }));
  return [{ id: feature.id, uses: feature.uses, actions: feature.actions }, ...options];
}

/**
 * Every live `actionUses` KEY a class can produce, including from its subclasses.
 *
 * Subclasses count because they share the class's counter by design: Life Domain's Preserve Life is
 * `pool: "channel-divinity"`, which is the Cleric's column. Excluding them would demand a
 * `display: true` on a column that is demonstrably spendable.
 */
function poolKeysOf(entry: ClassReference, ownSubclasses: readonly SubclassReference[]): Set<string> {
  const keys = new Set<string>();
  const collect = (features: readonly FeatureRecord[]) => {
    for (const feature of features) {
      for (const node of riderNodes(feature)) {
        // The builder's own key, restated: an explicit pool, else the action the uses ride, else the
        // synthesised action it mints for a feature with uses and no actions of its own.
        for (const action of node.actions) if (action.uses) keys.add(action.uses.pool ?? action.id);
        if (node.uses) keys.add(node.uses.pool ?? node.actions[0]?.id ?? node.id);
      }
    }
  };
  collect(entry.features);
  for (const subclass of ownSubclasses) collect(subclass.features);
  return keys;
}

describe("every printed class resource is either a real pool or marked display-only", () => {
  it("binds each classResources id to a live actionUses key, or says it is ink", () => {
    const unbound: string[] = [];
    for (const entry of classes) {
      const keys = poolKeysOf(entry, subclasses.filter((subclass) => subclass.classId === entry.id));
      for (const row of entry.levelTable) {
        for (const resource of row.classResources) {
          if (resource.display === true || keys.has(resource.id)) continue;
          unbound.push(`${entry.id}.${resource.id} (level ${row.level})`);
        }
      }
    }
    // Named, not counted: the message has to say which column to fix.
    expect(unbound).toEqual([]);
  });

  it("counts the classes that HAVE a live pool, so the check cannot pass by there being none", () => {
    // The completeness half. An all-`display: true` bundle would satisfy the assertion above
    // forever, including if `poolKeysOf` silently stopped finding anything - so pin the three
    // hand-authored classes whose mechanics are real today, and the keys they actually declare.
    const keysFor = (id: string) => [...poolKeysOf(classes.find((entry) => entry.id === id)!, subclasses.filter((s) => s.classId === id))].sort();
    expect(keysFor("fighter")).toEqual(["action-surge", "indomitable", "second-wind"]);
    expect(keysFor("cleric")).toEqual(["blessed-strikes", "channel-divinity", "divine-intervention"]);
    expect(keysFor("wizard")).toEqual(["arcane-recovery", "overchannel"]);
    // And those keys are bound to printed columns rather than floating free - the convention working.
    const clericColumns = new Set(classes.find((entry) => entry.id === "cleric")!.levelTable.flatMap((row) => row.classResources.map((resource) => resource.id)));
    expect(clericColumns.has("channel-divinity")).toBe(true);
  });

  it("marks a display-only column as display-only rather than leaving it to be inferred", () => {
    // Fighter's Weapon Mastery is the interesting one: a class with three REAL pools also prints a
    // column that is only a count of masteries, so "this class has mechanics" is not the test.
    const fighter = classes.find((entry) => entry.id === "fighter")!;
    const mastery = fighter.levelTable.flatMap((row) => row.classResources).filter((resource) => resource.id === "weapon-mastery");
    expect(mastery.length).toBeGreaterThan(0);
    expect(mastery.every((resource) => resource.display === true)).toBe(true);
    // ...while Second Wind, on the same table, is NOT marked - it is a pool the engine spends.
    const secondWind = fighter.levelTable.flatMap((row) => row.classResources).filter((resource) => resource.id === "second-wind");
    expect(secondWind.length).toBeGreaterThan(0);
    expect(secondWind.some((resource) => resource.display === true)).toBe(false);
  });
});
