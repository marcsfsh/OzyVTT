import { describe, expect, it } from "vitest";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { setAltitude } from "../src/altitude.js";
import { passGameTime } from "../src/game-time.js";
import { ALLY, catalog, FOE, HERO } from "./spell-casters.js";
import { actorOf, answer, cast, caster, laterAction, nextCommand, resolveAs, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 spells whose caster acts again while they last: Phantasmal Force's 2d8 on each of its caster's turns,
// Geas's 5d10 the GM deals once a day, Detect Thoughts' probe and the Arcana check that pushes it out, Levitate's
// raising and lowering, Ensnaring Strike's vines torn away by another creature, Bestow Curse's forced Dodge and
// Prismatic Spray's Violet ray.

const concentrating = (table: ReturnType<typeof caster>) =>
  actorOf(table.state, HERO).effects.some((effect) => effect.concentration);
const turnDeps = (table: ReturnType<typeof caster>) => ({
  resolveDefinition: (definitionId: string) =>
    table.state.definitions.find((entry) => entry.id === definitionId)?.definition,
  rollDie: () => 3,
  random: () => 3,
  newId: nextCommand,
  now: () => "2026-10-18T00:00:00.000Z",
  catalog
});
/** Moves the fight on until it is `actorId`'s turn. */
function toTurnOf(table: ReturnType<typeof caster>, actorId: string) {
  for (let guard = 0; guard < 8; guard += 1) {
    nextInitiativeTurn(table.state, [], turnDeps(table));
    if (table.state.combat.turnActorId === actorId) return;
  }
  throw new Error(`${actorId} never came up.`);
}

describe("Phantasmal Force's harm", () => {
  it("deals 2d8 Psychic to the creature under it once on each of its caster's turns", () => {
    const table = caster();
    cast(table, "phantasmal-force");
    answer(table.state, FOE, 1);
    const harm = laterAction("phantasmal-force", "harm");
    expect(resolveAs(table, harm, {}, [4, 5]).damage).toEqual([{ formula: "2d8", type: "psychic", total: 9 }]);
    // Once a turn, and only on the caster's own.
    expect(() => resolveAs(table, harm)).toThrow();
    toTurnOf(table, FOE);
    expect(() => resolveAs(table, harm)).toThrow(/own turn/);
    toTurnOf(table, HERO);
    expect(resolveAs(table, harm, {}, [1, 1]).damage?.[0]?.total).toBe(2);
    // Another creature isn't under the phantasm.
    expect(() => resolveAs(table, harm, { targetIds: [ALLY] })).toThrow(/isn't under/);
  });
});

describe("Geas's defiance", () => {
  it("is the GM's to deal, 5d10 Psychic once a day of game time", () => {
    // Its casting time is a minute: cast outside the fight, which then starts.
    const table = caster({ combat: false });
    cast(table, "geas");
    answer(table.state, FOE, 1);
    startEncounter(
      table.state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000009",
        entries: [
          { actorId: HERO, score: 20 },
          { actorId: FOE, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toContain("charmed");
    const defiance = laterAction("geas", "defiance");
    const asPlayer = () =>
      resolveDefinitionAction(
        table.state,
        defiance,
        { actorId: HERO, targetIds: [FOE], commandId: nextCommand() },
        {
          random: () => 3,
          newRollId: () => crypto.randomUUID(),
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          initiatorRole: "player",
          now: () => "2026-10-18T00:00:00.000Z",
          definition: wizard,
          catalog
        }
      );
    expect(asPlayer).toThrow(/The GM takes/);
    expect(resolveAs(table, defiance).damage).toEqual([{ formula: "5d10", type: "psychic", total: 15 }]);
    expect(() => resolveAs(table, defiance)).toThrow();
    passGameTime(table.state, 24 * 60, turnDeps(table));
    expect(resolveAs(table, defiance).damage?.[0]?.total).toBe(15);
  });
});

describe("Detect Thoughts", () => {
  it("opens no save as it is cast; the probe on a later turn does, and a success ends the spell", () => {
    const table = caster();
    cast(table, "detect-thoughts");
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(concentrating(table)).toBe(true);
    const probe = laterAction("detect-thoughts", "probe");
    expect(() => resolveAs(table, probe)).toThrow();
    toTurnOf(table, HERO);
    resolveAs(table, probe);
    answer(table.state, FOE, 20);
    expect(concentrating(table)).toBe(false);
  });

  it("lets a probed creature end the spell with an Intelligence (Arcana) check against the spell save DC", () => {
    const table = caster();
    cast(table, "detect-thoughts");
    toTurnOf(table, HERO);
    resolveAs(table, laterAction("detect-thoughts", "probe"));
    answer(table.state, FOE, 1);
    const probed = actorOf(table.state, FOE).effects.find((effect) => effect.name === "Detect Thoughts")!;
    expect(probed.endedBy).toMatchObject({ by: "bearer", check: { ability: "int", skill: "arcana", dc: 15 } });
    toTurnOf(table, FOE);
    resolveAs(table, builtinAction("end-an-effect")!, { targetIds: [FOE], builtin: true }, [20], FOE);
    expect(actorOf(table.state, FOE).effects.some((effect) => effect.name === "Detect Thoughts")).toBe(false);
    expect(concentrating(table)).toBe(false);
  });
});

describe("Ensnaring Strike's vines", () => {
  it("can be torn away by a creature within reach of the target with a Strength (Athletics) check", () => {
    const table = caster();
    cast(table, "ensnaring-strike");
    answer(table.state, FOE, 1);
    const vines = actorOf(table.state, FOE).effects[0]!;
    expect(vines.endedBy).toMatchObject({ by: "either", check: { ability: "str", skill: "athletics", dc: 15 } });
    toTurnOf(table, ALLY);
    resolveAs(table, builtinAction("end-an-effect")!, { targetIds: [FOE], builtin: true }, [20], ALLY);
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).not.toContain("restrained");
  });
});

describe("Bestow Curse's forced Dodge", () => {
  it("asks a Wisdom save at the start of each of the target's turns; a failure leaves it only the Dodge action", () => {
    const table = caster();
    cast(table, "bestow-curse", { optionId: "dodge" });
    answer(table.state, FOE, 1);
    toTurnOf(table, FOE);
    const save = table.state.combat.pendingSaves.find((pending) => pending.targetActorId === FOE)!;
    expect(save).toMatchObject({ ability: "wis", dc: 15 });
    answer(table.state, FOE, 1);
    const attack = laterAction("phantasmal-force", "harm");
    expect(() =>
      resolveAs(table, { ...attack, id: "swing", activation: "action" }, { targetIds: [HERO] }, [], FOE)
    ).toThrow(/Dodge/);
    resolveAs(table, builtinAction("dodge")!, { targetIds: [], builtin: true }, [], FOE);
    // The curse stays; a success on its next turn leaves the turn free.
    toTurnOf(table, FOE);
    answer(table.state, FOE, 20);
    expect(actorOf(table.state, FOE).effects.some((effect) => effect.name.startsWith("Bestow Curse"))).toBe(true);
    expect(actorOf(table.state, FOE).effects.some((effect) => effect.tags.includes("dodge-only"))).toBe(false);
  });
});

describe("Prismatic Spray's Violet ray", () => {
  /** Faces for the 12d6, then the target's d8 ray. */
  const violet = [...Array(12).fill(3), 7];

  it("Blinds, and at the caster's next turn a success ends it", () => {
    const table = caster();
    cast(table, "prismatic-spray", { targetIds: [FOE] }, [...violet]);
    answer(table.state, FOE, 1);
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toContain("blinded");
    toTurnOf(table, HERO);
    answer(table.state, FOE, 20);
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).not.toContain("blinded");
    expect(actorOf(table.state, FOE).effects).toEqual([]);
  });

  it("sends a creature that fails the Wisdom save to another plane", () => {
    const table = caster();
    cast(table, "prismatic-spray", { targetIds: [FOE] }, [...violet]);
    answer(table.state, FOE, 1);
    toTurnOf(table, HERO);
    answer(table.state, FOE, 1);
    const target = actorOf(table.state, FOE);
    expect(target.conditions.map((condition) => condition.id)).not.toContain("blinded");
    expect(target.effects.some((effect) => effect.tags.includes("off-plane"))).toBe(true);
  });
});

describe("Levitate's altitude", () => {
  const heightOf = (table: ReturnType<typeof caster>, id: string) =>
    table.state.combat.tokens.find((token) => token.actorId === id)?.altitudeFeet ?? 0;
  const placed = () => {
    const table = caster();
    table.state.combat.tokens.forEach((token, index) => {
      token.position = { x: 125 + index * 100, y: 125 };
    });
    return table;
  };

  it("raises or lowers the creature it holds 20 feet with a Magic action, once on each of the caster's turns", () => {
    const table = placed();
    cast(table, "levitate");
    answer(table.state, FOE, 1);
    setAltitude(table.state, FOE, 20, "levitate");
    toTurnOf(table, HERO);
    resolveAs(table, laterAction("levitate", "raise"), { targetIds: [] });
    expect(heightOf(table, FOE)).toBe(40);
    expect(table.state.combat.turn.actionUsed).toBe(true);
    expect(() => resolveAs(table, laterAction("levitate", "lower"), { targetIds: [] })).toThrow();
    toTurnOf(table, HERO);
    resolveAs(table, laterAction("levitate", "lower"), { targetIds: [] });
    expect(heightOf(table, FOE)).toBe(20);
    expect(table.state.combat.tokens.find((token) => token.actorId === FOE)?.airborne).toBe("levitate");
  });

  it("moves a caster levitating itself as part of its move, with no action", () => {
    const table = placed();
    cast(table, "levitate", { targetIds: [HERO] });
    setAltitude(table.state, HERO, 20, "levitate");
    toTurnOf(table, HERO);
    resolveAs(table, laterAction("levitate", "lower"), { targetIds: [] });
    expect(heightOf(table, HERO)).toBe(0);
    expect(table.state.combat.turn.actionUsed).toBe(false);
  });
});

