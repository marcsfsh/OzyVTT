import { describe, expect, it } from "vitest";
import { armorClassInPlay, type GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { upcastAction } from "../src/item-actions.js";
import { answerSave, saveRollSources } from "../src/saving-throws.js";
import { ESCAPE_ATHLETICS_TAG } from "../src/effects.js";
import { build, castOf, catalog, druidInput, fight, FOE, HERO, view, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 spells whose lasting part the server now applies: Stoneskin's Resistance, Blur's and Foresight's roll
// modes, Divine Favor's Radiant, Barkskin's AC 17, Death Ward's 1 Hit Point, Befuddlement's bar on spells, Vitriolic
// Sphere's later Acid, and Ensnaring Strike's vines.

const wizard = build(wizardInput(["blur"]));
const druid = build(druidInput(["barkskin"]));

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
let ids = 0;
const nextId = () => `50000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;
/** The wizard uses `action` on `targetIds`, its dice `faces` then 3s. */
function use(state: GameState, action: ActorAction, targetIds: string[], faces: number[] = []) {
  return resolveDefinitionAction(
    state,
    action,
    { actorId: HERO, targetIds, commandId: nextId() },
    {
      random: () => faces.shift() ?? 3,
      newRollId: nextId,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-17T00:00:00.000Z",
      definition: wizard,
      catalog,
      resolveDefinition: () => undefined
    }
  );
}
const turnDeps = {
  resolveDefinition: () => undefined,
  rollDie: () => 3,
  newId: nextId,
  now: () => "2026-10-17T00:00:00.000Z",
  catalog
};
const answer = (state: GameState, targetId: string, total: number) =>
  answerSave(
    state,
    nextId(),
    state.combat.pendingSaves.find((save) => save.targetActorId === targetId)!.id,
    "manual",
    total,
    true,
    { role: "gm" },
    {
      random: () => 10,
      newRollId: nextId,
      sessionId: "30000000-0000-4000-8000-00000000000a",
      role: "gm",
      now: () => "2026-10-17T00:00:00.000Z",
      resolveDefinition: () => undefined,
      catalog
    }
  );

describe("Stoneskin", () => {
  it("gives Resistance to Bludgeoning, Piercing and Slashing damage", () => {
    const { state } = fight(wizard);
    use(state, castOf("stoneskin"), [FOE]);
    const goblin = actor(state, FOE);
    const { application } = applyDamageDetailed(
      state,
      FOE,
      {
        amount: 20,
        parts: [
          { amount: 10, type: "slashing" },
          { amount: 10, type: "fire" }
        ]
      },
      { role: "gm" },
      { resolveDefinition: () => undefined, catalog }
    );
    expect(application.totalApplied).toBe(15);
    expect(goblin.effects[0]).toMatchObject({ name: "Stoneskin" });
  });
});

describe("Blur and Foresight", () => {
  it("Blur gives attack rolls against the caster Disadvantage", () => {
    const { state, resolve } = fight(wizard);
    resolve("spell-blur", { targetIds: [] });
    const derivation = deriveEquipment(actor(state, HERO), wizard, catalog);
    expect(
      derivation.carriers.flatMap((carrier) => carrier.modifiers).filter((modifier) => modifier.type === "roll-mode")
    ).toContainEqual(expect.objectContaining({ roll: "incoming-attack", mode: "disadvantage" }));
  });

  it("Foresight gives Advantage on the target's saves, checks and attack rolls", () => {
    const { state } = fight(wizard);
    use(state, castOf("foresight"), [HERO]);
    const hero = actor(state, HERO);
    const derivation = deriveEquipment(hero, wizard, catalog);
    expect(saveRollSources(hero, "dex", derivation).advantage).toEqual([
      expect.objectContaining({ label: expect.stringContaining("Foresight") })
    ]);
  });
});

describe("Divine Favor", () => {
  it("adds 1d4 Radiant to the caster's weapon hits, and not to a spell's", () => {
    const fighter = fight(wizard);
    // Divine Favor is a Bonus Action, so the dagger's action is still there.
    use(fighter.state, { ...castOf("divine-favor"), activation: "bonus-action" }, []);
    const dagger = fighter.action("item-dagger");
    const hit = resolveDefinitionAction(
      fighter.state,
      dagger,
      { actorId: HERO, targetIds: [FOE], commandId: nextId() },
      {
        random: (() => {
          const faces = [18, 2, 4];
          return () => faces.shift() ?? 3;
        })(),
        newRollId: nextId,
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-17T00:00:00.000Z",
        definition: wizard,
        catalog
      }
    );
    expect(hit.damage).toContainEqual(expect.objectContaining({ formula: "1d4", type: "radiant", total: 4 }));
    fighter.state.combat = { ...fighter.state.combat, turn: { ...fighter.state.combat.turn, actionUsed: false } };
    const bolt = fighter.resolve("spell-fire-bolt", {}, [18, 5, 5]);
    expect(bolt.damage.map((part) => part.type)).toEqual(["fire"]);
  });
});

describe("Barkskin", () => {
  it("raises an AC under 17 to 17, and leaves a higher one alone", () => {
    const { state, resolve } = fight(druid);
    resolve("spell-barkskin", { targetIds: [FOE] });
    expect(armorClassInPlay(actor(state, FOE))).toBe(17);
    const armored = fight(druid);
    actor(armored.state, FOE).armorClass = 18;
    armored.resolve("spell-barkskin", { targetIds: [FOE] });
    expect(armorClassInPlay(actor(armored.state, FOE))).toBe(18);
  });
});

describe("Death Ward", () => {
  it("leaves the target at 1 Hit Point the first time it would drop to 0, and ends", () => {
    const { state } = fight(wizard);
    use(state, castOf("death-ward"), [FOE]);
    const hit = () =>
      applyDamageDetailed(state, FOE, { amount: 500, parts: [{ amount: 500, type: "fire" }] }, { role: "gm" });
    const first = hit();
    expect(actor(state, FOE).hp.current).toBe(1);
    expect(actor(state, FOE).effects).toEqual([]);
    expect(first.events.map((event) => event.text)).toContain("Goblin drops to 1 Hit Point instead (Death Ward).");
    hit();
    expect(actor(state, FOE).hp.current).toBe(0);
  });
});

describe("Befuddlement", () => {
  it("bars a target that fails from casting spells and from the Magic action", () => {
    const { state } = fight(wizard);
    use(state, castOf("befuddlement"), [FOE]);
    answer(state, FOE, 1);
    const befuddled = actor(state, FOE).effects[0]!;
    expect(befuddled).toMatchObject({ name: "Befuddlement", tags: ["no-spells"] });
    const caster = fight(wizard);
    actor(caster.state, HERO).effects = [{ ...befuddled, id: "befuddled" }];
    expect(() => caster.resolve("spell-fire-bolt", {})).toThrowError(
      /Ansel can't cast spells or take the Magic action while Befuddlement lasts/
    );
  });
});

describe("Vitriolic Sphere", () => {
  it("deals another 5d4 Acid at the end of the next turn of a creature that fails", () => {
    const { state } = fight(wizard);
    use(state, castOf("vitriolic-sphere"), [FOE]);
    answer(state, FOE, 1);
    const afterSave = actor(state, FOE).hp.current;
    expect(actor(state, FOE).effects[0]).toMatchObject({ name: "Vitriolic Sphere" });
    // The hero's turn ends, the goblin's starts and ends: 5d4 at 3 each.
    nextInitiativeTurn(state, [], turnDeps);
    nextInitiativeTurn(state, [], turnDeps);
    expect(actor(state, FOE).hp.current).toBe(afterSave - 15);
  });
});

describe("Ensnaring Strike", () => {
  // The spell's own id, so its restraint is the one escaped with Athletics.
  const ensnare = { ...castOf("ensnaring-strike"), spellId: "ensnaring-strike" };

  it("restrains a target that fails, deals 1d6 Piercing at the start of its turns, and is escaped with Athletics", () => {
    const { state } = fight(wizard);
    use(state, ensnare, [FOE]);
    answer(state, FOE, 1);
    const vines = actor(state, FOE).effects[0]!;
    expect(vines).toMatchObject({
      linkedConditionIds: ["restrained"],
      escapeDc: 15,
      tags: expect.arrayContaining([ESCAPE_ATHLETICS_TAG]),
      ongoingDamage: { damage: [{ formula: "1d6", type: "piercing" }], at: "bearer-turn-start" }
    });
    const before = actor(state, FOE).hp.current;
    nextInitiativeTurn(state, [], turnDeps);
    expect(actor(state, FOE).hp.current).toBe(before - 3);
  });

  it("gives a Large or larger creature Advantage on the save, and adds 1d6 a slot level up", () => {
    const { state } = fight(wizard);
    actor(state, FOE).size = "large";
    use(state, ensnare, [FOE]);
    const pending = state.combat.pendingSaves[0]!;
    expect(pending.advantageAtSize).toBe("large");
    expect(upcastAction(ensnare, view.spellRecord("ensnaring-strike")!, 3).save?.ongoingDamage?.damage).toEqual([
      { formula: "3d6", type: "piercing" }
    ]);
  });
});
