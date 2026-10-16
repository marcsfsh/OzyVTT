import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorAction } from "@vtt/schemas";
import { areaOfProse, withProseFacts } from "../src/action-prose.js";
import { loadSpells } from "../src/index.js";

const action = (fields: Partial<ActorAction>): ActorAction =>
  ({ id: "x", name: "X", activation: "action", description: "", damage: [], ...fields }) as ActorAction;

describe("reading an action's prose facts", () => {
  it("reads the SRD area phrasings, and nothing else", () => {
    expect(areaOfProse("each creature in a 60-foot Cone")).toEqual({ shape: "cone", sizeFeet: 60, widthFeet: null });
    expect(areaOfProse("a 60-foot-long, 5-foot-wide Line")).toEqual({ shape: "line", sizeFeet: 60, widthFeet: 5 });
    expect(areaOfProse("a 20-foot-radius Sphere")).toEqual({ shape: "sphere", sizeFeet: 20, widthFeet: null });
    expect(areaOfProse("a 15-foot Emanation")).toEqual({ shape: "emanation", sizeFeet: 15, widthFeet: null });
    expect(areaOfProse("a 10-foot Cube")).toEqual({ shape: "cube", sizeFeet: 10, widthFeet: null });
    expect(areaOfProse("Melee Attack Roll: +9, reach 10 ft.")).toBeNull();
  });

  it("keeps an authored area over the prose's", () => {
    const authored = { shape: "line", sizeFeet: 30, widthFeet: 5 } as const;
    expect(withProseFacts(action({ description: "a 15-foot Cone or a 30-foot Line", area: authored })).area).toEqual(
      authored
    );
  });

  it("reads a Parry's AC bonus, melee only when the trigger says so, and keeps an authored reaction", () => {
    const parry = withProseFacts(
      action({
        activation: "reaction",
        description:
          "Trigger: The knight is hit by a melee attack roll while holding a weapon. Response: The knight adds 2 to its AC against that attack, possibly causing it to miss."
      })
    );
    expect(parry.reaction).toEqual({ trigger: "hit-by-attack", response: "ac-bonus", amount: 2, melee: true });
    const sand = withProseFacts(
      action({
        activation: "reaction",
        description:
          "Trigger: The mummy is hit by an attack roll. Response: The mummy adds 2 to its AC against the attack."
      })
    );
    expect(sand.reaction).toEqual({ trigger: "hit-by-attack", response: "ac-bonus", amount: 2 });
    // Only a reaction reads it, and an authored one wins.
    expect(
      withProseFacts(action({ description: "It adds 2 to its AC against that attack." })).reaction
    ).toBeUndefined();
    const authored = { trigger: "hit-by-attack", response: "half-damage" } as const;
    expect(
      withProseFacts(
        action({ activation: "reaction", description: "adds 3 to its AC against that attack", reaction: authored })
      ).reaction
    ).toEqual(authored);
  });

  it("marks a Multiattack nothing structured names, and only that one", () => {
    expect(withProseFacts(action({ name: "Multiattack" })).untrackedMultiattack).toBe(true);
    const tracked = withProseFacts(
      action({ name: "Multiattack", untrackedMultiattack: true, multiattack: [{ actionId: "bite", count: 2 }] })
    );
    expect(tracked.untrackedMultiattack).toBeUndefined();
    expect(withProseFacts(action({ name: "Bite" })).untrackedMultiattack).toBeUndefined();
  });
});

/** Every action-shaped object in a bundle, wherever the bundle nests it. */
function bundledActions(): Array<{ bundle: string; action: ActorAction }> {
  const directory = join(import.meta.dirname, "..", "bundles");
  const found: Array<{ bundle: string; action: ActorAction }> = [];
  const walk = (bundle: string, node: unknown) => {
    if (Array.isArray(node)) for (const child of node) walk(bundle, child);
    else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (
        typeof record.activation === "string" &&
        typeof record.description === "string" &&
        Array.isArray(record.damage)
      )
        found.push({ bundle, action: record as unknown as ActorAction });
      for (const child of Object.values(record)) walk(bundle, child);
    }
  };
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".json")))
    walk(file, JSON.parse(readFileSync(join(directory, file), "utf8")));
  return found;
}

describe("the bundles carry what their prose says, so play never reads it", () => {
  it("gives every action whose text names an area that area", () => {
    const missing = bundledActions()
      .filter(({ action }) => areaOfProse(action.description) !== null && action.area === undefined)
      .map(({ bundle, action }) => `${bundle}: ${action.id}`);
    expect(missing).toEqual([]);
  });

  it("marks every Multiattack the build could not structure", () => {
    const unmarked = bundledActions()
      .filter(({ action }) => /multiattack/i.test(action.name) && !action.multiattack && !action.untrackedMultiattack)
      .map(({ bundle, action }) => `${bundle}: ${action.id}`);
    expect(unmarked).toEqual([]);
  });

  it("gives every spell whose text names an area that area", () => {
    const lightningBolt = loadSpells().find((spell) => spell.id === "lightning-bolt")!;
    expect(lightningBolt.area).toEqual({ shape: "line", sizeFeet: 100, widthFeet: 5 });
    expect(
      loadSpells()
        .filter((spell) => areaOfProse(spell.description) !== null && spell.area === null)
        .map((spell) => spell.id)
    ).toEqual([]);
  });
});
