import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorAction } from "@vtt/schemas";
import { areaOfProse, multiattackOfProse, withProseFacts } from "../src/action-prose.js";
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
    // On the map, a Cylinder is the circle of its radius and a square on the ground is a Cube.
    expect(areaOfProse("in a 5-foot-radius, 40-foot-high Cylinder")).toEqual({
      shape: "sphere",
      sizeFeet: 5,
      widthFeet: null
    });
    expect(areaOfProse("in a 40-foot-tall, 20-foot-radius Cylinder")).toEqual({
      shape: "sphere",
      sizeFeet: 20,
      widthFeet: null
    });
    expect(areaOfProse("fill a 20-foot square on ground")).toEqual({ shape: "cube", sizeFeet: 20, widthFeet: null });
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

describe("reading a Multiattack", () => {
  /** A stat block's other actions by their printed names. */
  const sheet = (...names: string[]) => {
    const ids = new Map(names.map((name) => [name.toLowerCase(), name.toLowerCase().replace(/ /g, "-")]));
    return (name: string) => ids.get(name.toLowerCase());
  };

  it("reads every listed attack, not only the first group", () => {
    expect(
      multiattackOfProse(
        "The devil makes two Claw attacks and one Infernal Sting attack.",
        sheet("Claw", "Infernal Sting")
      )?.plan
    ).toEqual([
      { actionId: "claw", count: 2 },
      { actionId: "infernal-sting", count: 1 }
    ]);
    expect(
      multiattackOfProse(
        "The pit fiend makes one Bite attack, two Devilish Claw attacks, and one Fiery Mace attack.",
        sheet("Bite", "Devilish Claw", "Fiery Mace")
      )?.plan
    ).toEqual([
      { actionId: "bite", count: 1 },
      { actionId: "devilish-claw", count: 2 },
      { actionId: "fiery-mace", count: 1 }
    ]);
  });

  it("reads the actions it uses, and the places any of several actions can fill", () => {
    expect(
      multiattackOfProse("The behir makes one Bite attack and uses Constrict.", sheet("Bite", "Constrict"))?.plan
    ).toEqual([
      { actionId: "bite", count: 1 },
      { actionId: "constrict", count: 1 }
    ]);
    expect(
      multiattackOfProse(
        "The kraken makes two Tentacle attacks and uses Fling, Lightning Strike, or Swallow.",
        sheet("Tentacle", "Fling", "Lightning Strike", "Swallow")
      )?.plan
    ).toEqual([
      { actionId: "tentacle", count: 2 },
      { actionId: "fling", count: 1, or: ["lightning-strike", "swallow"] }
    ]);
    expect(
      multiattackOfProse(
        "The goblin makes two attacks, using Scimitar or Shortbow in any combination.",
        sheet("Scimitar", "Shortbow")
      )?.plan
    ).toEqual([{ actionId: "scimitar", count: 2, or: ["shortbow"] }]);
    expect(
      multiattackOfProse("The rust monster makes one Bite attack and uses Antennae twice.", sheet("Bite", "Antennae"))
        ?.plan
    ).toEqual([
      { actionId: "bite", count: 1 },
      { actionId: "antennae", count: 2 }
    ]);
  });

  it("reads the plan it can be instead, and its replacements", () => {
    const barbed = multiattackOfProse(
      "The devil makes one Claws attack and one Tail attack, or it makes two Hurl Flame attacks.",
      sheet("Claws", "Tail", "Hurl Flame")
    );
    expect(barbed?.alternatives).toEqual([[{ actionId: "hurl-flame", count: 2 }]]);
    expect(
      multiattackOfProse(
        "The lion makes two Rend attacks. It can replace one attack with a use of Roar.",
        sheet("Rend", "Roar")
      )?.replacements
    ).toEqual([{ actionIds: ["roar"], attacks: 1 }]);
    expect(
      multiattackOfProse(
        "The dragon makes three Rend attacks. It can replace one attack with a use of (A) Sleep Breath or (B) Spellcasting to cast Scorching Ray.",
        sheet("Rend", "Sleep Breath", "Spellcasting")
      )?.replacements
    ).toEqual([{ actionIds: ["sleep-breath", "spellcasting"], attacks: 1 }]);
    expect(
      multiattackOfProse(
        "The chimera makes one Ram attack, one Bite attack, and one Claw attack. It can replace the Claw attack with a use of Fire Breath if available.",
        sheet("Ram", "Bite", "Claw", "Fire Breath")
      )?.replacements
    ).toEqual([{ actionIds: ["fire-breath"], attacks: 1, of: "claw" }]);
  });

  it("leaves prose a plan it can't say for sure, or one naming an action the stat block lacks", () => {
    expect(multiattackOfProse("The hydra makes as many Bite attacks as it has heads.", sheet("Bite"))).toBeNull();
    expect(multiattackOfProse("The ogre makes two Club attacks.", sheet("Greatclub"))).toBeNull();
  });
});

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
    const areaOf = (id: string) => loadSpells().find((spell) => spell.id === id)!.area;
    expect(areaOf("flame-strike")).toEqual({ shape: "sphere", sizeFeet: 10, widthFeet: null });
    expect(areaOf("entangle")).toEqual({ shape: "cube", sizeFeet: 20, widthFeet: null });
    expect(
      loadSpells()
        .filter((spell) => areaOfProse(spell.description) !== null && spell.area === null)
        .map((spell) => spell.id)
    ).toEqual([]);
  });
});
