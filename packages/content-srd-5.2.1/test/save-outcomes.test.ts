import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SaveConditionSchema } from "@vtt/schemas";
import { loadMonsterDefinitions, loadSpells } from "../src/index.js";

/**
 * What a save does is data, written once by the content build (`scripts/save-outcomes.ts` and the authored
 * mechanics), and the engine never reads it from prose. These checks read the committed bundles as raw JSON,
 * so a save that only has its fields because the schema defaulted them still fails.
 */

const bundlesDir = fileURLToPath(new URL("../bundles", import.meta.url));

type SaveBlock = Record<string, unknown>;
/** Every `save` object in a bundle, with the path it was found at. */
function saveBlocksIn(file: string): Array<{ path: string; save: SaveBlock }> {
  const found: Array<{ path: string; save: SaveBlock }> = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) node.forEach((child, index) => walk(child, `${path}[${index}]`));
    else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (record.save && typeof record.save === "object")
        found.push({ path: `${path}${record.id ? `(${String(record.id)})` : ""}`, save: record.save as SaveBlock });
      for (const [key, child] of Object.entries(record)) walk(child, `${path}.${key}`);
    }
  };
  walk(JSON.parse(readFileSync(join(bundlesDir, file), "utf8")), file);
  return found;
}

const monsterAction = (creature: string, actionId: string) => {
  const action = loadMonsterDefinitions()
    .find((monster) => monster.source.externalId === creature)
    ?.actions.find((entry) => entry.id === actionId);
  if (!action) throw new Error(`${creature}/${actionId} is not in the bundle`);
  return action;
};
const spellSave = (id: string) => loadSpells().find((spell) => spell.id === id)?.save;

describe("save outcomes in the shipped content", () => {
  it("writes both outcome fields on every save block in every bundle", () => {
    const blocks = readdirSync(bundlesDir)
      .filter((file) => file.endsWith(".v1.json"))
      .flatMap(saveBlocksIn);
    // Monsters, spells, magic items and class, subclass and species features all force saves.
    expect(blocks.length).toBeGreaterThan(300);
    const incomplete = blocks.filter(
      ({ save }) =>
        (save.successDamage !== "half" && save.successDamage !== "none") ||
        !(
          Array.isArray(save.failureConditions) &&
          save.failureConditions.every((id: unknown) => SaveConditionSchema.safeParse(id).success)
        )
    );
    expect(incomplete.map(({ path }) => path)).toEqual([]);
  });

  it("halves a breath weapon's damage on a success", () => {
    expect(monsterAction("adult-red-dragon", "fire-breath").save).toEqual({
      ability: "dex",
      dc: 21,
      successDamage: "half",
      failureConditions: []
    });
  });

  it("gives no damage on a success when the stat block prints no Success line", () => {
    // "Failure: 5 (1d6 + 2) Psychic damage." and nothing more: a success is unharmed.
    expect(monsterAction("satyr", "mockery").save).toMatchObject({ successDamage: "none", failureConditions: [] });
    // A "Failure or Success:" line applies either way; it is not the success line.
    expect(monsterAction("adult-black-dragon", "cloud-of-insects").save).toMatchObject({ successDamage: "none" });
  });

  it("names the condition a failure imposes, and not one the targeting line mentions", () => {
    expect(monsterAction("ghoul", "claw").save).toMatchObject({
      successDamage: "none",
      failureConditions: ["paralyzed"]
    });
    expect(monsterAction("giant-spider", "web").save).toMatchObject({ failureConditions: ["restrained"] });
    // "one creature ... that is Charmed or Grappled by the aboleth" is who it targets, not what a failure does.
    expect(monsterAction("aboleth", "consume-memories").save).toMatchObject({
      successDamage: "half",
      failureConditions: []
    });
    // "First Failure" is the failure the prompt applies; the second is the GM's.
    expect(monsterAction("basilisk", "petrifying-gaze-recharge-4-6").save).toMatchObject({
      failureConditions: ["restrained"]
    });
  });

  it("reads spells' running prose the same way", () => {
    expect(spellSave("fireball")).toEqual({ ability: "dex", successDamage: "half", failureConditions: [] });
    expect(spellSave("sacred-flame")).toEqual({ ability: "dex", successDamage: "none", failureConditions: [] });
    expect(spellSave("hold-person")).toEqual({
      ability: "wis",
      successDamage: "none",
      failureConditions: ["paralyzed"],
      // "At the end of each of its turns, the target repeats the save"; "for the duration" is the Concentration's.
      repeatSave: true
    });
    // A reviewed override: the condition is named in the sentence after the save.
    expect(spellSave("banishment")).toMatchObject({ failureConditions: ["incapacitated"] });
  });

  it("reads how long a failure's conditions last", () => {
    // "until the end of its next turn" is the target's own turn.
    expect(monsterAction("ghoul", "claw").save).toMatchObject({ failureDuration: { type: "until-bearer-turn-end" } });
    // "until the start of the otyugh's next turn" is the source's.
    expect(monsterAction("otyugh", "tentacle-slam").save).toMatchObject({
      failureDuration: { type: "until-source-next-turn" }
    });
    // "until the end of the mummy's next turn" ends on the source's turn.
    expect(monsterAction("mummy", "dreadful-glare").save).toMatchObject({
      failureDuration: { type: "until-source-turn-end" }
    });
    // "repeats the save at the end of each of its turns ... After 1 minute, it succeeds automatically".
    expect(monsterAction("doppelganger", "unsettling-visage").save).toMatchObject({
      failureDuration: { type: "rounds", rounds: 10 },
      repeatSave: true
    });
    expect(spellSave("color-spray")).toMatchObject({ failureDuration: { type: "until-source-turn-end" } });
    expect(spellSave("sunburst")).toMatchObject({ failureDuration: { type: "rounds", rounds: 10 }, repeatSave: true });
    // A save repeated three times, or once on the next turn, stays the GM's.
    expect(spellSave("flesh-to-stone")).not.toHaveProperty("repeatSave");
    expect(monsterAction("basilisk", "petrifying-gaze-recharge-4-6").save).not.toHaveProperty("repeatSave");
    // "Failure by 5 or More" is a further branch: the plain failure's own duration stands.
    expect(monsterAction("homunculus", "bite").save).toMatchObject({
      failureConditions: ["poisoned"],
      failureDuration: { type: "until-source-turn-end" }
    });
    expect(monsterAction("homunculus", "bite").save).not.toHaveProperty("endsOnDamage");
  });

  it("reads a grapple's escape DC, range and what lasts until it ends", () => {
    expect(monsterAction("constrictor-snake", "constrict").save).toMatchObject({
      failureConditions: ["grappled"],
      escapeDc: 12,
      rangeFeet: 5
    });
    expect(monsterAction("behir", "constrict").save).toMatchObject({
      failureConditions: ["grappled", "restrained"],
      escapeDc: 16
    });
    expect(monsterAction("shambling-mound", "engulf").save).toMatchObject({
      failureConditions: ["grappled", "blinded", "restrained"],
      escapeDc: 14
    });
    expect(monsterAction("water-elemental", "whelm").save).toMatchObject({
      failureConditions: ["grappled", "restrained"],
      escapeDc: 14
    });
  });

  it("reads 'while X, also Y', Speed 0 and ending on damage", () => {
    expect(spellSave("hypnotic-pattern")).toEqual({
      ability: "wis",
      successDamage: "none",
      failureConditions: ["charmed", "incapacitated"],
      endsOnDamage: true,
      speedZero: true
    });
    expect(monsterAction("chuul", "paralyzing-tentacles").save).toMatchObject({
      failureConditions: ["poisoned", "paralyzed"]
    });
    expect(spellSave("sleep")).toMatchObject({
      failureConditions: ["incapacitated"],
      failureDuration: { type: "until-bearer-turn-end" },
      endsOnDamage: true
    });
    // No save at the cast below 150 HP; the save comes at the end of each of its turns.
    expect(spellSave("power-word-stun")).toMatchObject({
      failureConditions: ["stunned"],
      repeatSave: true,
      failsAtHitPoints: 150
    });
  });

  it("reads on-hit grapples' companions and unconditional timed riders", () => {
    expect(monsterAction("purple-worm", "bite").onHit).toEqual([
      { conditions: [{ id: "grappled" }, { id: "restrained" }], escapeDc: 19, maxTargetSize: "large" }
    ]);
    expect(monsterAction("roper", "tentacle").onHit?.[0]?.conditions).toEqual([{ id: "grappled" }, { id: "poisoned" }]);
    expect(monsterAction("lich", "paralyzing-touch").onHit).toEqual([
      { conditions: [{ id: "paralyzed" }], duration: { type: "until-source-next-turn" } }
    ]);
    expect(monsterAction("cloud-giant", "thundercloud").onHit).toEqual([
      { conditions: [{ id: "incapacitated" }], duration: { type: "until-bearer-turn-end" } }
    ]);
    // A rider that waits on a charge stays prose.
    expect(monsterAction("elk", "ram").onHit).toBeUndefined();
  });

  it("reads damage a failure brings at the start of each turn, and leaves it out of the GM's reminder", () => {
    expect(monsterAction("behir", "swallow")).toMatchObject({
      save: {
        failureConditions: ["blinded", "restrained"],
        ongoingDamage: { damage: [{ formula: "6d6", type: "acid" }], at: "source-turn-start" }
      },
      reminder:
        "While swallowed, a creature has the Blinded and Restrained conditions, has Total Cover against attacks and other effects outside the behir."
    });
    expect(monsterAction("remorhaz", "swallow").save?.ongoingDamage?.damage).toEqual([
      { formula: "3d6", type: "acid" },
      { formula: "3d6", type: "fire" }
    ]);
    expect(monsterAction("pit-fiend", "bite")).toMatchObject({
      save: {
        failureConditions: ["poisoned"],
        repeatSave: true,
        ongoingDamage: { damage: [{ formula: "6d6", type: "poison" }], at: "bearer-turn-start" }
      },
      reminder:
        "While Poisoned, the target can't regain Hit Points, and it repeats the save at the end of each of its turns, ending the effect on itself on a success."
    });
    // A reminder that was only the damage goes.
    expect(monsterAction("vrock", "spores").save?.ongoingDamage?.at).toBe("bearer-turn-start");
    expect(monsterAction("vrock", "spores").reminder).toBeUndefined();
    // Losing hit points is not damage, and with no condition there is nothing for it to last with.
    expect(monsterAction("horned-devil", "infernal-tail").save).not.toHaveProperty("ongoingDamage");
  });
});
