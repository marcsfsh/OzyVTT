import { describe, expect, it } from "vitest";
import { CLASS_MECHANICS } from "../scripts/class-mechanics/index.js";
import {
  loadClasses,
  loadSubclasses,
  type ClassReference,
  type FeatureRecord,
  type SubclassReference
} from "../src/index.js";

/**
 * A `classResources` id is a printed table column. It is bound to a live pool
 * (`actor.actionUses[uses.pool ?? action.id]`) only by matching id, so every id must either match a
 * pool on its class or subclasses, or carry `display: true`. An unbound column would render a number
 * nothing can spend, with no error anywhere.
 */

const classes = loadClasses();
const subclasses = loadSubclasses();

/** A feature and every inline option under it - both carry the identical `uses` vocabulary. */
function riderNodes(
  feature: FeatureRecord
): Array<{ id: string; uses?: FeatureRecord["uses"]; actions: FeatureRecord["actions"] }> {
  const options = (feature.choice?.options ?? []).map((option) => ({
    id: option.id,
    uses: option.uses,
    actions: option.actions
  }));
  return [{ id: feature.id, uses: feature.uses, actions: feature.actions }, ...options];
}

/**
 * Every live `actionUses` key a class can produce. Subclasses count because they share the class's
 * counters (Preserve Life spends `channel-divinity`).
 */
function poolKeysOf(entry: ClassReference, ownSubclasses: readonly SubclassReference[]): Set<string> {
  const keys = new Set<string>();
  const collect = (features: readonly FeatureRecord[]) => {
    for (const feature of features) {
      for (const node of riderNodes(feature)) {
        // Mirrors the builder's key: explicit pool, else the action the uses ride, else the synthesised action.
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
      const keys = poolKeysOf(
        entry,
        subclasses.filter((subclass) => subclass.classId === entry.id)
      );
      for (const row of entry.levelTable) {
        for (const resource of row.classResources) {
          if (resource.display === true || keys.has(resource.id)) continue;
          unbound.push(`${entry.id}.${resource.id} (level ${row.level})`);
        }
      }
    }
    expect(unbound).toEqual([]);
  });

  it("counts the classes that HAVE a live pool, so the check cannot pass by there being none", () => {
    // Guards against the check above passing vacuously.
    const keysFor = (id: string) =>
      [
        ...poolKeysOf(
          classes.find((entry) => entry.id === id)!,
          subclasses.filter((s) => s.classId === id)
        )
      ].sort();
    expect(keysFor("fighter")).toEqual(["action-surge", "indomitable", "second-wind"]);
    expect(keysFor("cleric")).toEqual(["blessed-strikes", "channel-divinity", "divine-intervention"]);
    expect(keysFor("wizard")).toEqual(["arcane-recovery", "overchannel", "signature-spells"]);
    const clericColumns = new Set(
      classes
        .find((entry) => entry.id === "cleric")!
        .levelTable.flatMap((row) => row.classResources.map((resource) => resource.id))
    );
    expect(clericColumns.has("channel-divinity")).toBe(true);
  });

  it("marks a display-only column as display-only rather than leaving it to be inferred", () => {
    // Fighter has real pools and also prints a display-only Weapon Mastery count.
    const fighter = classes.find((entry) => entry.id === "fighter")!;
    const mastery = fighter.levelTable
      .flatMap((row) => row.classResources)
      .filter((resource) => resource.id === "weapon-mastery");
    expect(mastery.length).toBeGreaterThan(0);
    expect(mastery.every((resource) => resource.display === true)).toBe(true);
    const secondWind = fighter.levelTable
      .flatMap((row) => row.classResources)
      .filter((resource) => resource.id === "second-wind");
    expect(secondWind.length).toBeGreaterThan(0);
    expect(secondWind.some((resource) => resource.display === true)).toBe(false);
  });
});

// The class mechanics overlay merges authored riders over the ETL's generated prose.
describe("the mechanics overlay merges over generated prose", () => {
  const barbarian = classes.find((entry) => entry.id === "barbarian")!;
  const rage = barbarian.features.find((feature) => feature.id === "rage")!;

  it("keeps the ETL's prose AND carries the authored riders on the same record", () => {
    expect(rage.description).toContain("primal power called Rage");
    expect(rage.description.length).toBeGreaterThan(500);
    expect(rage.level).toBe(1);
    expect(rage.uses).toEqual({ scaling: { type: "class-resource", id: "rage" }, per: "long-rest" });
    expect(rage.actions.map((action) => action.id)).toEqual(["rage"]);
    expect(rage.actions[0].grants?.tags).toEqual(["raging"]);
    expect(rage.actions[0].grants?.modifiers.map((modifier) => modifier.type)).toEqual([
      "damage-resistance",
      "damage-bonus",
      "roll-mode",
      "roll-mode"
    ]);
    // Rage Damage reads the printed column when the character is built.
    expect(rage.actions[0].grantScaling).toEqual({ resource: "rage-damage" });
  });

  it("scales its uses off the printed Rages column, which stopped being display-only", () => {
    const rages = (level: number) =>
      barbarian.levelTable[level - 1].classResources.find((resource) => resource.id === "rage")!;
    expect(rages(1).amount).toBe(2);
    expect(rages(3).amount).toBe(3);
    expect(rages(1).display).toBeUndefined();
    // Rage Damage stays display-only: the effect vocabulary cannot express it yet.
    expect(barbarian.levelTable[0].classResources.find((resource) => resource.id === "rage-damage")!.display).toBe(
      true
    );
  });

  it("leaves every class NOBODY authored untouched, so the overlay is opt-in per feature", () => {
    // A class may carry riders only if its overlay module authored some or it is hand-authored in
    // `sources/authored/classes.json`, riders included.
    const handAuthored = ["cleric", "fighter", "wizard"];
    const permitted = new Set([...Object.keys(CLASS_MECHANICS), ...handAuthored]);
    const withMechanics = classes
      .filter((entry) => entry.features.some((feature) => feature.actions.length > 0 || feature.uses !== undefined))
      .map((entry) => entry.id)
      .sort();
    expect(withMechanics.filter((id) => !permitted.has(id))).toEqual([]);
    expect(withMechanics).toEqual(expect.arrayContaining(["barbarian", "cleric", "fighter", "wizard"]));
  });
});
