import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActorAction } from "@vtt/schemas";
import {
  areaOfProse,
  drainOfProse,
  leapOfProse,
  moveOfProse,
  multiattackOfProse,
  teleportOfProse,
  withProseFacts
} from "../src/action-prose.js";
import { loadSpells } from "../src/index.js";

const action = (fields: Partial<ActorAction>): ActorAction =>
  ({ id: "x", name: "X", activation: "action", description: "", damage: [], ...fields }) as ActorAction;

describe("reading an action's prose facts", () => {
  it("reads what damage drains: the Hit Point maximum, that type alone, and the healing the dealer regains", () => {
    expect(
      drainOfProse(
        "If the target is a creature, its Hit Point maximum decreases by an amount equal to the damage taken."
      )
    ).toEqual({ reducesMaximum: true });
    expect(
      drainOfProse(
        "The target's Hit Point maximum decreases by an amount equal to the Necrotic damage taken, and the vampire regains Hit Points equal to that amount."
      )
    ).toEqual({ damageType: "necrotic", reducesMaximum: true, heals: "all" });
    // A fixed amount stays the GM's.
    expect(
      drainOfProse("Subsequent Failures: The Poisoned target's Hit Point maximum decreases by 5 (1d10).")
    ).toBeNull();
    expect(
      withProseFacts(
        action({
          description: "its Hit Point maximum decreases by an amount equal to the damage taken.",
          damage: [{ formula: "4d8", type: "necrotic" }]
        })
      ).drain
    ).toEqual({ reducesMaximum: true });
  });

  it("reads the SRD area phrasings, and nothing else", () => {
    expect(areaOfProse("each creature in a 60-foot Cone")).toEqual({ shape: "cone", sizeFeet: 60, widthFeet: null });
    expect(areaOfProse("a 60-foot-long, 5-foot-wide Line")).toEqual({ shape: "line", sizeFeet: 60, widthFeet: 5 });
    expect(areaOfProse("a 20-foot-radius Sphere")).toEqual({ shape: "sphere", sizeFeet: 20, widthFeet: null });
    expect(areaOfProse("a 15-foot Emanation")).toEqual({ shape: "emanation", sizeFeet: 15, widthFeet: null });
    expect(areaOfProse("a 10-foot Cube")).toEqual({ shape: "cube", sizeFeet: 10, widthFeet: null });
    // A Cylinder keeps its radius and its height, however it is printed, and a square on the ground is a Cube.
    expect(areaOfProse("in a 5-foot-radius, 40-foot-high Cylinder")).toEqual({
      shape: "cylinder",
      sizeFeet: 5,
      widthFeet: null,
      heightFeet: 40
    });
    expect(areaOfProse("in a 40-foot-tall, 20-foot-radius Cylinder")).toEqual({
      shape: "cylinder",
      sizeFeet: 20,
      widthFeet: null,
      heightFeet: 40
    });
    expect(areaOfProse("in a 50-foot-radius, 100 foot high Cylinder")).toEqual({
      shape: "cylinder",
      sizeFeet: 50,
      widthFeet: null,
      heightFeet: 100
    });
    // A Line printed before its size, in words.
    expect(areaOfProse("A Line of strong wind 60 feet long and 10 feet wide blasts from you")).toEqual({
      shape: "line",
      sizeFeet: 60,
      widthFeet: 10
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
    expect(barbed).not.toHaveProperty("alternativesAfter");
    expect(
      multiattackOfProse(
        "The golem makes two Slam attacks, or it makes three Slam attacks if it used Hasten this turn.",
        sheet("Slam", "Hasten")
      )
    ).toMatchObject({ alternatives: [[{ actionId: "slam", count: 3 }]], alternativesAfter: "hasten" });
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
    expect(areaOf("flame-strike")).toEqual({ shape: "cylinder", sizeFeet: 10, widthFeet: null, heightFeet: 40 });
    expect(areaOf("gust-of-wind")).toEqual({ shape: "line", sizeFeet: 60, widthFeet: 10 });
    expect(areaOf("entangle")).toEqual({ shape: "cube", sizeFeet: 20, widthFeet: null });
    expect(
      loadSpells()
        .filter((spell) => areaOfProse(spell.description) !== null && spell.area === null)
        .map((spell) => spell.id)
    ).toEqual([]);
  });
});

describe("reading the moves an action makes its creature take", () => {
  it("reads a move's share of Speed, its way of moving, and whether it provokes, goes straight or comes first", () => {
    expect(
      moveOfProse("Legendary Action. The dragon moves up to half its Speed, and it makes one Rend attack.")
    ).toEqual({ speed: "half", provokes: true, first: true });
    expect(
      moveOfProse(
        "If the roc has a creature Grappled, the roc flies up to half its Fly Speed without provoking Opportunity Attacks and drops that creature."
      )
    ).toEqual({ speed: "half", mode: "fly", provokes: false });
    expect(moveOfProse("The sahuagin swims up to its Swim Speed straight toward an enemy it can see.")).toEqual({
      speed: "full",
      mode: "swim",
      provokes: true,
      straight: true
    });
    expect(
      moveOfProse("The xorn moves up to its Speed or Burrow Speed straight toward an enemy it can sense.")
    ).toEqual({ speed: "full", provokes: true, straight: true });
    // The kraken's move follows its save.
    expect(
      moveOfProse(
        "Constitution Saving Throw: DC 23, each creature in a 15-foot Emanation. The kraken then moves up to its Speed."
      )
    ).toEqual({ speed: "full", provokes: true });
    expect(moveOfProse("The target moves up to its Speed away from you.")).toBeNull();
  });

  it("reads a teleport's range and a jump's distance and cost", () => {
    expect(teleportOfProse("The dog teleports up to 40 feet to an unoccupied space it can see.")).toEqual({ feet: 40 });
    expect(
      teleportOfProse(
        "The balor teleports itself or a willing demon within 10 feet of itself up to 60 feet to an unoccupied space the balor can see."
      )
    ).toEqual({ feet: 60 });
    expect(
      teleportOfProse(
        "If within 5 feet of a Large or bigger tree, the dryad teleports to an unoccupied space within 5 feet of a second Large or bigger tree that is within 60 feet of the previous tree."
      )
    ).toEqual({ feet: 65 });
    expect(leapOfProse("The bulette jumps up to 30 feet by spending 10 feet of movement.")).toEqual({
      feet: 30,
      costFeet: 10
    });
  });

  it("fills them on the action as it enters the system", () => {
    const filled = withProseFacts(
      action({ description: "The dog teleports up to 40 feet to an unoccupied space it can see." })
    );
    expect(filled.teleport).toEqual({ feet: 40 });
  });
});
