import { describe, expect, it } from "vitest";
import { CLASS_MECHANICS } from "../scripts/class-mechanics/index.js";
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
 * The ETL-generated classes started out entirely the second kind, because Stage 4 has not authored
 * their mechanics yet - and Barbarian's Rage is the first to cross over. Naming a column in
 * `LIVE_CLASS_RESOURCES` (`scripts/class-mechanics/index.ts`) drops its `display: true`, at which point
 * this test stops accepting the annotation and starts requiring the pool it was standing in for.
 * That is the whole ratchet: every column Stage 4 wires up tightens the check by one.
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

/**
 * **The mechanics overlay reached the bundle** - the Stage 4 mechanism, proved on one feature.
 *
 * `classes.v1.json` is GENERATED, and the SRD markdown it is generated from contains no riders. The
 * overlay in `scripts/class-mechanics/` is where a human authors them and the ETL merges the two,
 * so that prose stays derived and mechanics stay authored. Barbarian's Rage is the worked example;
 * these assertions are what make it a mechanism rather than a plan.
 */
describe("the mechanics overlay merges over generated prose", () => {
  const barbarian = classes.find((entry) => entry.id === "barbarian")!;
  const rage = barbarian.features.find((feature) => feature.id === "rage")!;

  it("keeps the ETL's prose AND carries the authored riders on the same record", () => {
    // One record, both halves. If the overlay had replaced the feature rather than merged into it,
    // the description would be the short authored one instead of the SRD's own paragraph.
    expect(rage.description).toContain("primal power called Rage");
    expect(rage.description.length).toBeGreaterThan(500);
    expect(rage.level).toBe(1);
    // ...and the mechanics the markdown could never have said.
    expect(rage.uses).toEqual({ scaling: { type: "class-resource", id: "rage" }, per: "long-rest" });
    expect(rage.actions.map((action) => action.id)).toEqual(["rage"]);
    expect(rage.actions[0].grants?.tags).toEqual(["raging"]);
    expect(rage.actions[0].grants?.modifiers.map((modifier) => modifier.type))
      .toEqual(["damage-resistance", "roll-mode", "roll-mode"]);
  });

  it("scales its uses off the printed Rages column, which stopped being display-only", () => {
    // The two halves of piece 4 meeting: a `class-resource` scaling reads the column, and the column
    // drops `display: true` because a live pool now answers to it.
    const rages = (level: number) => barbarian.levelTable[level - 1].classResources.find((resource) => resource.id === "rage")!;
    expect(rages(1).amount).toBe(2);
    expect(rages(3).amount).toBe(3);
    expect(rages(1).display).toBeUndefined();
    // Its NEIGHBOUR on the same table is still ink: Rage Damage scales off a column the effect
    // vocabulary cannot express yet, so it is left prose rather than authored wrong.
    expect(barbarian.levelTable[0].classResources.find((resource) => resource.id === "rage-damage")!.display).toBe(true);
  });

  it("leaves every class NOBODY authored untouched, so the overlay is opt-in per feature", () => {
    // A merge that leaked would show up as riders on classes nobody authored any for.
    //
    // NOT a snapshot of which classes have mechanics: Stage 4 authors all twelve in four parallel
    // lanes, so a fixed list would be a merge conflict per lane and would go stale the day it was
    // written. The leak check is the same either way - a class may carry riders only if SOMEONE put
    // them there, which means its overlay module authored something, or it is one of the three whose
    // riders live in `classes.v1.json` itself.
    const HAND_AUTHORED = ["cleric", "fighter", "wizard"];
    const permitted = new Set([...Object.keys(CLASS_MECHANICS), ...HAND_AUTHORED]);
    const withMechanics = classes
      .filter((entry) => entry.features.some((feature) => feature.actions.length > 0 || feature.uses !== undefined))
      .map((entry) => entry.id)
      .sort();
    expect(withMechanics.filter((id) => !permitted.has(id))).toEqual([]);
    // ...and not vacuous: the classes proved end to end elsewhere in this file really are in there.
    expect(withMechanics).toEqual(expect.arrayContaining(["barbarian", "cleric", "fighter", "wizard"]));
  });
});
