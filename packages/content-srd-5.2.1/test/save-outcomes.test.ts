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
      failureConditions: ["paralyzed"]
    });
    // A reviewed override: the condition is named in the sentence after the save.
    expect(spellSave("banishment")).toMatchObject({ failureConditions: ["incapacitated"] });
  });
});
