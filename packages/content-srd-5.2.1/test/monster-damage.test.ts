import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "../src/index.js";

// Every SRD monster's damage checked against its own printed stat block. The checks read the text with their own
// patterns, apart from the build's, so a reader bug in the build can't agree with itself.

const monsters = loadMonsterDefinitions();
const normal = (formula: string) => formula.replace(/\s+/g, "").replace(/−/g, "-").toLowerCase();

/** The printed average beside a formula: dice average, rounded down, plus the modifier. */
function averageOf(formula: string): number {
  const match = /^(\d+)d(\d+)(?:([+-])(\d+))?$/.exec(normal(formula));
  if (!match) return Number(formula);
  const [, count, sides, sign, bonus] = match;
  const modifier = bonus ? (sign === "-" ? -1 : 1) * Number(bonus) : 0;
  return Math.floor((Number(count) * (Number(sides) + 1)) / 2 + modifier);
}

type Printed = { average: number; formula: string; type: string };

/** The unconditional damage of the first sentence after the attack roll: no "or" alternative, no "if" clause. */
function printedHit(description: string): Printed[] {
  const body = description.replace(/^.*?Attack Roll:[^.]*?(?:ft|feet)\.(?:\s*or range [^.]*?(?:ft|feet)\.)?\s*/s, "");
  const first = body.split(/(?<=\.)\s/)[0] ?? "";
  const unconditional = first
    .replace(/[,\u2014]?\s*or \d+(?: \([^)]*\))? [A-Za-z]+ damage (?:if|when) [^\u2014.,]*[\u2014,]?/g, " ")
    .replace(/,?\s*plus \d+(?: \([^)]*\))? [A-Za-z]+ damage (?:if|when) [^.]*/g, "");
  return [...unconditional.matchAll(/(\d+)(?: \((\d+d\d+(?:\s*[+\-−]\s*\d+)?)\))? ([A-Za-z]+) damage/g)].map(
    ([, average, dice, type]) => ({ average: Number(average), formula: dice ?? average, type: type.toLowerCase() })
  );
}

describe("SRD monster attack damage matches the stat block", () => {
  // Rows that print their own attack roll; a legendary action that makes another's attack is checked against it below.
  const attacks = monsters.flatMap((monster) =>
    monster.actions
      .filter((action) => action.attack !== undefined && /Attack Roll:/.test(action.description))
      .map((action) => ({ key: `${monster.source.externalId}/${action.id}`, action }))
  );

  it("gives a legendary action that makes another action's attack that attack's roll and damage", () => {
    const wrong = monsters.flatMap((monster) =>
      monster.actions
        .filter((action) => action.legendary && action.attack && !/Attack Roll:/.test(action.description))
        .flatMap((action) => {
          // A choice printed inside its entry ("Necrotic Strike: Rotting Fist") is named for its attack.
          const named = action.partOf
            ? action.name.slice(action.name.indexOf(": ") + 2)
            : /makes one ([A-Z][A-Za-z' ]*?) attack/.exec(action.description)?.[1];
          const source = monster.actions.find((candidate) => candidate.name.replace(/\s*\(.*\)$/, "") === named);
          return source &&
            JSON.stringify(source.attack) === JSON.stringify(action.attack) &&
            JSON.stringify(source.damage) === JSON.stringify(action.damage)
            ? []
            : [`${monster.source.externalId}/${action.id}`];
        })
    );
    expect(wrong).toEqual([]);
  });

  it("covers every attack in the bundle", () => {
    expect(attacks.length).toBeGreaterThanOrEqual(420);
  });

  it("rolls exactly the printed unconditional damage of every attack, fixed amounts included", () => {
    const wrong = attacks.flatMap(({ key, action }) => {
      const printed = printedHit(action.description);
      const got = action.damage.map((part) => `${normal(part.formula)} ${part.type}`);
      const want = printed.map((part) => `${normal(part.formula)} ${part.type}`);
      return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${key}: ${got.join(", ")} vs ${want.join(", ")}`];
    });
    expect(wrong).toEqual([]);
  });

  it("prints an average that matches each of those formulas", () => {
    const wrong = attacks.flatMap(({ key, action }) =>
      printedHit(action.description)
        .filter((part) => averageOf(part.formula) !== part.average)
        .map((part) => `${key}: ${part.average} (${part.formula})`)
    );
    expect(wrong).toEqual([]);
  });

  it("keeps the conditional damage the engine can apply, and the SRD's examples read right", () => {
    const action = (monster: string, id: string) =>
      monsters.find((entry) => entry.source.externalId === monster)!.actions.find((entry) => entry.id === id)!;
    expect(action("giant-spider", "bite").damage).toEqual([
      { formula: "1d8 + 3", type: "piercing" },
      { formula: "2d6", type: "poison" }
    ]);
    expect(action("cat", "scratch").damage).toEqual([{ formula: "1", type: "slashing" }]);
    expect(action("baboon", "bite").damage).toEqual([{ formula: "1d4 - 1", type: "piercing" }]);
    expect(action("swarm-of-rats", "bites").conditionalDamage).toEqual([
      { when: "self-bloodied", mode: "instead", damage: [{ formula: "1d4", type: "piercing" }] }
    ]);
    expect(action("goblin-warrior", "scimitar").conditionalDamage).toEqual([
      { when: "advantage", mode: "plus", damage: [{ formula: "1d4", type: "slashing" }] }
    ]);
    expect(action("boar", "gore").conditionalDamage).toEqual([
      {
        when: "charge",
        mode: "plus",
        feet: 20,
        maxTargetSize: "medium",
        damage: [{ formula: "1d6", type: "piercing" }],
        conditions: ["prone"]
      }
    ]);
  });
});

describe("SRD monster save damage is what the failure deals at once", () => {
  it("deals damage on later turns as the failure's ongoing damage instead of at once", () => {
    const action = (monster: string, id: string) =>
      monsters.find((entry) => entry.source.externalId === monster)!.actions.find((entry) => entry.id === id)!;
    const engulf = action("gelatinous-cube", "engulf");
    expect(engulf.damage).toEqual([{ formula: "3d6", type: "acid" }]);
    expect(engulf.save?.ongoingDamage).toEqual({ damage: [{ formula: "3d6", type: "acid" }], at: "source-turn-start" });
    // The engine deals it, so the GM's reminder keeps only the rest.
    expect(engulf.reminder).not.toMatch(/Acid damage/);
    // Swallowed: nothing at once, the acid comes at the start of the swallower's turns.
    for (const monster of ["behir", "purple-worm", "remorhaz", "tarrasque"]) {
      expect(action(monster, "swallow").damage).toEqual([]);
      expect(action(monster, "swallow").save?.ongoingDamage?.at).toBe("source-turn-start");
    }
    expect(action("kraken", "swallow").damage).toEqual([{ formula: "3d8 + 10", type: "piercing" }]);
    // A failure that depends on the target's hit points: Unconscious at 20 or fewer, else the Psychic damage.
    const nightmare = action("incubus", "nightmare-recharge-6");
    expect(nightmare.damage).toEqual([{ formula: "4d8", type: "psychic" }]);
    expect(nightmare.save?.failureByHitPoints).toMatchObject([{ atOrBelow: 20, conditions: ["unconscious"] }]);
    expect(nightmare).not.toHaveProperty("reminder");
    // One that kills or drops the target by its hit points does it, and deals its damage to a target above them.
    expect(action("solar", "slaying-bow")).toMatchObject({
      damage: [
        { formula: "4d8 + 6", type: "piercing" },
        { formula: "8d8", type: "radiant" }
      ],
      save: { failureByHitPoints: [{ atOrBelow: 100, dies: true }] }
    });
    expect(action("sea-hag", "death-glare")).toMatchObject({
      damage: [{ formula: "3d8", type: "psychic" }],
      save: { failureByHitPoints: [{ atOrBelow: 20, dropsToZero: true }] }
    });
    expect(action("sea-hag", "death-glare").reminder).toBeUndefined();
    // Each roar is its own step, the third with its thunder.
    expect(action("sphinx-of-valor", "roar").save).toBeUndefined();
    expect(action("sphinx-of-valor", "roar-first-roar").save).toMatchObject({
      ability: "wis",
      failureConditions: ["frightened"]
    });
    expect(action("sphinx-of-valor", "roar-third-roar").damage).toEqual([{ formula: "8d10", type: "thunder" }]);
    // The Otyugh's save comes after a Long Rest.
    expect(action("otyugh", "bite").save).toBeUndefined();
  });

  it("deals at once only what the first sentence of every failure prints", () => {
    const wrong = monsters.flatMap((monster) =>
      monster.actions
        .filter(
          (action) => action.save !== undefined && action.attack === undefined && /Failure:/.test(action.description)
        )
        .flatMap((action) => {
          const failure = /Failure:\s*(.+?)(?:\s*Success:|$)/s.exec(action.description)![1];
          const first = failure.split(/(?<=\.)\s/)[0] ?? "";
          // A step of a printed sequence (a sphinx's roars) carries its own failure, printed further on.
          if (/^If the (?:target|creature) has \d+ Hit Points/.test(first) || action.useNumber !== undefined) return [];
          // A type each use picks (a half-dragon's breath, of its Draconic Origin's type) is printed with no type.
          if (action.damageTypes !== undefined) return [];
          const want = [...first.matchAll(/\d+ \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) ([A-Za-z]+) damage/g)].map(
            ([, dice, type]) => `${normal(dice)} ${type.toLowerCase()}`
          );
          const got = action.damage.map((part) => `${normal(part.formula)} ${part.type}`);
          return JSON.stringify(got) === JSON.stringify(want)
            ? []
            : [`${monster.source.externalId}/${action.id}: ${got.join(", ")} vs ${want.join(", ")}`];
        })
    );
    expect(wrong).toEqual([]);
  });
});
