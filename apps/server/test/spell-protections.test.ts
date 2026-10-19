import { describe, expect, it } from "vitest";
import { armorClassInPlay, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorAction, type Modifier } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { checkRollMode } from "../src/ability-checks.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { upcastAction } from "../src/item-actions.js";
import { answerSave, saveRollSources } from "../src/saving-throws.js";
import { addEffect, endEffect, ESCAPE_ATHLETICS_TAG, makeEffect } from "../src/effects.js";
import {
  build,
  castOf,
  catalog,
  druidInput,
  fight,
  FOE,
  HERO,
  heroTurnAgain,
  view,
  wizardInput
} from "./spell-casters.js";

// SRD 5.2.1 spells whose lasting part the server now applies: Stoneskin's Resistance, Blur's and Foresight's roll
// modes, Divine Favor's Radiant, Barkskin's AC 17, Death Ward's 1 Hit Point, Befuddlement's bar on spells, Vitriolic
// Sphere's later Acid, Ensnaring Strike's vines, the Invisible condition of Invisibility and Greater Invisibility,
// Enhance Ability's Advantage and Protection from Energy's Resistance.

const wizard = build(wizardInput(["blur"]));
const druid = build(druidInput(["barkskin"]));

const actor = (state: GameState, id: string) => state.actors.find((candidate) => candidate.id === id)!;
let ids = 0;
const nextId = () => `50000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;
/** The wizard uses `action` on `targetIds`, its dice `faces` then 3s. */
function use(
  state: GameState,
  action: ActorAction,
  targetIds: string[],
  faces: number[] = [],
  extra: Partial<ResolveInput> = {}
) {
  return resolveDefinitionAction(
    state,
    action,
    { actorId: HERO, targetIds, commandId: nextId(), ...extra },
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

describe("Greater Invisibility and Invisibility", () => {
  const conditionIds = (state: GameState, id: string) => actor(state, id).conditions.map((condition) => condition.id);

  it("Greater Invisibility gives its target the Invisible condition, which ends with the spell", () => {
    const { state } = fight(wizard);
    use(state, castOf("greater-invisibility"), [FOE]);
    expect(conditionIds(state, FOE)).toEqual(["invisible"]);
    const spell = actor(state, FOE).effects[0]!;
    expect(spell).toMatchObject({ name: "Greater Invisibility", duration: { type: "rounds", remaining: 10 } });
    endEffect(state, FOE, spell.id);
    expect(conditionIds(state, FOE)).toEqual([]);
  });

  it("Invisibility ends once its bearer makes an attack roll, and outlasts the cast that gave it", () => {
    const { state, resolve } = fight(build(wizardInput([])));
    use(state, castOf("invisibility"), [HERO]);
    expect(conditionIds(state, HERO)).toEqual(["invisible"]);
    heroTurnAgain(state);
    const bolt = resolve("spell-fire-bolt", {}, [15, 4]);
    expect(conditionIds(state, HERO)).toEqual([]);
    expect(actor(state, HERO).effects).toEqual([]);
    expect(bolt.effectsEnded).toContainEqual(expect.objectContaining({ actorId: HERO, name: "Invisibility" }));
  });

  it("leaves another creature's Invisibility alone when the caster attacks", () => {
    const { state, resolve } = fight(build(wizardInput([])));
    use(state, castOf("invisibility"), [FOE]);
    heroTurnAgain(state);
    resolve("spell-fire-bolt", { targetIds: [FOE] }, [15, 4]);
    expect(conditionIds(state, FOE)).toEqual(["invisible"]);
  });
});

describe("Enhance Ability", () => {
  it("gives Advantage on checks with the ability the caster picks for each target, and refuses Constitution", () => {
    const { state } = fight(wizard);
    use(state, castOf("enhance-ability"), [FOE], [], { targetOptions: { [FOE]: "str" } });
    const goblin = actor(state, FOE);
    expect(goblin.effects[0]).toMatchObject({ name: "Enhance Ability (Strength)" });
    const derivation = deriveEquipment(goblin, undefined, catalog);
    expect(checkRollMode(derivation, { ability: "str" }).mode).toBe("advantage");
    expect(checkRollMode(derivation, { ability: "dex" }).mode).toBe("normal");
    const refused = fight(wizard);
    expect(() => use(refused.state, castOf("enhance-ability"), [FOE], [], { optionId: "con" })).toThrowError(
      "Enhance Ability doesn't offer that choice."
    );
  });
});

describe("Protection from Energy", () => {
  it("gives Resistance to the one damage type the caster picks", () => {
    const { state } = fight(wizard);
    use(state, castOf("protection-from-energy"), [FOE], [], { damageType: "fire" });
    expect(actor(state, FOE).effects[0]).toMatchObject({ name: "Protection from Energy (Fire)" });
    const hit = (type: "fire" | "cold") =>
      applyDamageDetailed(
        state,
        FOE,
        { amount: 10, parts: [{ amount: 10, type }] },
        { role: "gm" },
        { resolveDefinition: () => undefined, catalog }
      ).application.totalApplied;
    expect(hit("fire")).toBe(5);
    expect(hit("cold")).toBe(10);
  });
});

describe("Riders on attacks against a creature that read the attack's kind", () => {
  const OPPORTUNITY_DISADVANTAGE: Modifier = {
    type: "roll-mode",
    roll: "incoming-attack",
    mode: "disadvantage",
    when: [{ type: "on-attack-roll" }, { type: "attack-kind-is", kinds: ["opportunity"] }]
  };

  it("give an Opportunity Attack Disadvantage, and leave an ordinary attack alone (Escape the Horde)", () => {
    const fighter = fight(build(wizardInput([])));
    addEffect(
      fighter.state,
      FOE,
      makeEffect({
        id: "escape-the-horde",
        name: "Escape the Horde",
        tags: ["escape-the-horde"],
        sourceActorId: FOE,
        sourceName: "Goblin",
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "manual" },
        modifiers: [OPPORTUNITY_DISADVANTAGE]
      })
    );
    const dagger = fighter.action("item-dagger");
    const swing = (attackKinds: ResolveInput["attackKinds"]) =>
      resolveDefinitionAction(
        fighter.state,
        dagger,
        {
          actorId: HERO,
          targetIds: [FOE],
          commandId: nextId(),
          commit: false,
          ...(attackKinds ? { attackKinds } : {})
        },
        {
          random: () => 10,
          newRollId: nextId,
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-17T00:00:00.000Z",
          definition: fighter.definition,
          catalog
        }
      );
    expect(swing(["reaction", "opportunity"]).rollMode).toMatchObject({ mode: "disadvantage" });
    expect(swing(undefined).rollMode?.mode ?? "normal").toBe("normal");
  });

  it("give a spell attack Disadvantage against a creature holding a Spellguard Shield", () => {
    const { state, resolve } = fight(build(wizardInput([])));
    const shield = view.equipmentRecord("spellguard-shield")!;
    actor(state, FOE).inventory = [
      InventoryItemSchema.parse({
        id: "spellguard-shield",
        name: shield.name,
        quantity: 1,
        category: shield.category,
        equipped: true,
        attuned: true,
        ...(shield.armor ? { armor: shield.armor } : {})
      })
    ];
    expect(resolve("spell-fire-bolt", { commit: false }, [15, 4, 4]).rollMode).toMatchObject({
      mode: "disadvantage",
      disadvantage: [expect.stringContaining("Spellguard Shield")]
    });
  });
});
