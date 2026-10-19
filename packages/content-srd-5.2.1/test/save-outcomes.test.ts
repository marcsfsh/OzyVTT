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
      // A hit rider's save (a Cunning Strike's Trip, Giant Slayer's) does nothing on a success by its own shape, and so
      // does the save a melee hit on an aura's bearer costs its attacker (Holy Aura's Blinded); a rest trigger's (an
      // otyugh's poison after a Long Rest) ends its effect on a success.
      for (const [key, child] of Object.entries(record))
        if (key !== "ridesHit" && key !== "onHit" && key !== "struck" && key !== "atRest")
          walk(child, `${path}.${key}`);
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
    // "one creature ... that is Charmed or Grappled by the aboleth" names who it targets and says nothing of a failure.
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
    // A reviewed override: "no benefit from Half Cover or Three-Quarters Cover for this save".
    expect(spellSave("sacred-flame")).toEqual({
      ability: "dex",
      successDamage: "none",
      failureConditions: [],
      ignoresCover: true
    });
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

  it("keeps 'the X or Y condition' as the caster's pick, the first standing until one is picked", () => {
    expect(spellSave("blindnessdeafness")).toEqual({
      ability: "con",
      successDamage: "none",
      failureConditions: ["blinded"],
      conditionChoices: ["blinded", "deafened"],
      repeatSave: true
    });
    // Only Blindness/Deafness prints a choice of conditions for a failed save.
    const choosing = loadSpells().filter((spell) => spell.save?.conditionChoices !== undefined);
    expect(choosing.map((spell) => spell.id)).toEqual(["blindnessdeafness"]);
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
    // A creature with Truesight sees through the pattern and succeeds outright.
    expect(spellSave("hypnotic-pattern")).toEqual({
      ability: "wis",
      successDamage: "none",
      failureConditions: ["charmed", "incapacitated"],
      endsOnDamage: true,
      speedZero: true,
      autoSuccess: { truesight: true }
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
    // No end printed in the hit's sentence: it lasts until a save after a Long Rest ends it.
    expect(monsterAction("otyugh", "bite").onHit).toEqual([
      {
        conditions: [{ id: "poisoned" }],
        name: "Poisoned",
        atRest: { at: "long-rest", save: { ability: "con", dc: 15 }, maximumLoss: "1d10" }
      }
    ]);
  });

  it("reads damage a failure brings at the start of each turn, and leaves it out of the GM's reminder", () => {
    expect(monsterAction("behir", "swallow")).toMatchObject({
      save: {
        failureConditions: ["blinded", "restrained"],
        ongoingDamage: { damage: [{ formula: "6d6", type: "acid" }], at: "source-turn-start" },
        failureEffect: { name: "Swallowed", tags: ["swallowed"] }
      },
      swallow: { capacity: 1, regurgitate: { damage: 30, dc: 14, withinFeet: 10 } }
    });
    // The engine runs the swallowed creature's conditions and cover, so no reminder is left.
    expect(monsterAction("behir", "swallow")).not.toHaveProperty("reminder");
    expect(monsterAction("remorhaz", "swallow").save?.ongoingDamage?.damage).toEqual([
      { formula: "3d6", type: "acid" },
      { formula: "3d6", type: "fire" }
    ]);
    // The no-healing rides the poison's own effect and the engine repeats the save, so nothing is left to remind.
    expect(monsterAction("pit-fiend", "bite")).toMatchObject({
      save: {
        failureConditions: ["poisoned"],
        repeatSave: true,
        ongoingDamage: { damage: [{ formula: "6d6", type: "poison" }], at: "bearer-turn-start" },
        failureEffect: { name: "Poisoned", tags: ["no-healing"] }
      }
    });
    expect(monsterAction("pit-fiend", "bite").reminder).toBeUndefined();
    // A reminder that was only the damage goes.
    expect(monsterAction("vrock", "spores").save?.ongoingDamage?.at).toBe("bearer-turn-start");
    expect(monsterAction("vrock", "spores").reminder).toBeUndefined();
    // Losing hit points is not damage: an infernal wound is the failure's own effect, and its loss has no type.
    expect(monsterAction("horned-devil", "infernal-tail").save).toMatchObject({
      failureEffect: { name: "Infernal Wound", duration: { type: "rounds", rounds: 10 }, endsOnSpellHealing: true },
      ongoingDamage: { damage: [{ formula: "3d6" }], at: "bearer-turn-start", hitPointLoss: true }
    });
  });
});

describe("a failure's push", () => {
  it("is read off the spell and the stat block, 'up to' kept", () => {
    const spells = loadSpells();
    expect(spells.find((spell) => spell.id === "thunderwave")?.save?.failurePush).toEqual({ feet: 10 });
    const dragon = loadMonsterDefinitions().find((entry) => entry.source.externalId === "adult-bronze-dragon")!;
    expect(dragon.actions.find((action) => action.id === "repulsion-breath")?.save?.failurePush).toEqual({
      feet: 60,
      upTo: true
    });
    // A hit's push is the attack's own.
    const giant = loadMonsterDefinitions().find((entry) => entry.source.externalId === "fire-giant")!;
    expect(giant.actions.find((action) => action.id === "hammer-throw")?.onHitPush).toEqual({ feet: 15, upTo: true });
  });
});

describe("what a stat block's failure does beyond its first conditions", () => {
  it("reads a second failure, after one repeat at the end of the target's next turn", () => {
    expect(monsterAction("adult-brass-dragon", "sleep-breath").save).toMatchObject({
      failureConditions: ["incapacitated"],
      failureDuration: { type: "until-bearer-turn-end" },
      repeatOnce: true,
      secondFailure: { conditions: ["unconscious"], duration: { type: "rounds", rounds: 100 }, endsOnDamage: true }
    });
    expect(monsterAction("silver-dragon-wyrmling", "paralyzing-breath").save?.secondFailure).toEqual({
      conditions: ["paralyzed"],
      duration: { type: "rounds", rounds: 10 },
      repeatSave: true
    });
    expect(monsterAction("basilisk", "petrifying-gaze-recharge-4-6").save).toMatchObject({
      failureConditions: ["restrained"],
      repeatOnce: true,
      secondFailure: { conditions: ["petrified"] }
    });
    expect(monsterAction("cockatrice", "petrifying-bite").save?.secondFailure).toEqual({
      conditions: ["petrified"],
      duration: { type: "minutes", minutes: 1440 }
    });
  });

  it("reads immunity after a success, a repeat on damage, an Exhaustion level and a kill", () => {
    expect(monsterAction("cloaker", "moan").save?.immuneOnSuccess).toBe(true);
    expect(monsterAction("harpy", "luring-song").save).toMatchObject({
      immuneOnSuccess: true,
      repeatOnDamage: { notFromSource: true }
    });
    expect(monsterAction("aboleth", "dominate-mind").save).toMatchObject({
      repeatOnDamage: {},
      endsWhenSourceDies: true
    });
    expect(monsterAction("sphinx-of-valor", "weight-of-years").save?.failureExhaustion).toBe(1);
    expect(monsterAction("will-o-wisp", "consume-life").save?.failureKills).toEqual({ sourceRegains: "3d6" });
  });

  it("reads a failure that restricts with no condition as one effect", () => {
    expect(monsterAction("young-copper-dragon", "slowing-breath").save).toMatchObject({
      failureEffect: { name: "Slowing Breath", tags: ["no-reactions", "speed-halved", "action-or-bonus"] },
      failureDuration: { type: "until-bearer-turn-end" }
    });
    const weakening = monsterAction("ancient-gold-dragon", "weakening-breath");
    expect(weakening.save).toMatchObject({
      sparesAffected: true,
      repeatSave: true,
      failureDuration: { type: "rounds", rounds: 10 },
      failureEffect: { name: "Weakening Breath" }
    });
    // "Subtracts 5 (1d10) from its damage rolls."
    expect(weakening.save?.failureEffect?.modifiers).toHaveLength(4);
    expect(weakening.save?.failureEffect?.modifiers).toContainEqual({
      type: "damage-bonus",
      amount: 0,
      dice: "-1d10",
      when: [{ type: "on-damage-roll" }]
    });
    expect(weakening).not.toHaveProperty("reminder");
  });

  it("keeps the words a source tag stood beside", () => {
    expect(monsterAction("rakshasa", "cursed-touch").description).toMatch(
      /While cursed, the target gains no benefit from finishing a Short or Long Rest\.$/
    );
    expect(monsterAction("behir", "swallow").description).toMatch(/Restrained conditions, has Total Cover against/);
  });
});
