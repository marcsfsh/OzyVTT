import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition, CastShaping } from "@vtt/schemas";
import { actionAvailability, resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition, storedDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { addEffect, CANT_SPEAK_TAG, makeEffect } from "../src/effects.js";
import { effectiveActions } from "../src/effective-actions.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { openRepeatSaves } from "../src/save-stages.js";
import { answerSave, saveRollSources, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { asiRows } from "./asi-rows.js";
import { ALLY, build, fight, FOE, FOE2, HERO, wizardInput, type Fight } from "./spell-casters.js";

// SRD 5.2.1 Metamagic: "You use the chosen options to temporarily modify spells you cast. To use an option, you must
// spend the number of Sorcery Points that it costs. You can use only one Metamagic option on a spell when you cast it
// unless otherwise noted in one of those options." Each option's own text is pinned below, with Sculpt Spells.

const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);
const POLICY = BuilderPolicySchema.parse({});

type Row = CharacterCreateRequestInput["choices"][number];

/** A Human Acolyte Draconic Sorcerer: CHA 15 + 2, raised by every ASI, so +5 from level 8. Its Metamagic picks go in
 *  twos at levels 2, 10 and 17. */
function sorcerer(level: number, picks: readonly string[]): ActorDefinition {
  const metamagic = picks.map(
    (id, index) =>
      ({
        level: index < 2 ? 2 : index < 4 ? 10 : 17,
        classId: "sorcerer",
        kind: "metamagic",
        id,
        payload: { featureId: "metamagic" }
      }) as Row
  );
  const input = {
    name: "Ilde",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "sorcerer",
    level,
    subclassId: "draconic-sorcery",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [
      { ability: "cha", amount: 2 },
      { ability: "wis", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "sorcerer", kind: "skill", id: "arcana" },
      { level: 1, classId: "sorcerer", kind: "skill", id: "deception" },
      { level: 1, kind: "skill", id: "perception", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
      { level: 3, classId: "sorcerer", kind: "subclass", id: "draconic-sorcery" },
      { level: 1, kind: "equipment", id: "sorcerer-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" },
      ...["fire-bolt", "shocking-grasp"].map((id) => ({ level: 1, classId: "sorcerer", kind: "cantrip", id })),
      ...[
        "fireball",
        "hold-person",
        "fly",
        "mage-armor",
        "scorching-ray",
        "magic-missile",
        ...(level >= 9 ? ["cloudkill"] : [])
      ].map((id) => ({
        level: 1,
        classId: "sorcerer",
        kind: "spell",
        id
      })),
      ...metamagic,
      ...asiRows(
        "sorcerer",
        [4, 8, 12, 16].filter((at) => at <= level),
        ["cha", "con"],
        { cha: 17, con: 13 }
      ),
      ...(level >= 6
        ? [
            {
              level: 6,
              classId: "sorcerer",
              kind: "damage-type",
              id: "fire",
              payload: { featureId: "elemental-affinity" }
            }
          ]
        : []),
      ...(level >= 19
        ? [
            { level: 19, classId: "sorcerer", kind: "feat", id: "boon-of-fate", payload: { featureId: "epic-boon" } },
            { level: 19, kind: "ability-score", id: "con", payload: { featureId: "boon-of-fate" } }
          ]
        : [])
    ]
  } as CharacterCreateRequestInput;
  return buildCharacterDefinition(input, view, POLICY);
}

type Option =
  | "careful-spell"
  | "distant-spell"
  | "empowered-spell"
  | "extended-spell"
  | "heightened-spell"
  | "quickened-spell"
  | "seeking-spell"
  | "subtle-spell"
  | "transmuted-spell"
  | "twinned-spell";
/** A Sorcerer 10 that knows the four options named, CHA +5, 10 Sorcery Points. */
const sorcerer10 = (picks: readonly Option[]) => fight(sorcerer(10, picks), { ally: true });

const points = (table: Fight) => table.hero.actionUses["sorcery-points"] ?? 0;
const cast = (
  table: Fight,
  actionId: string,
  shaping: readonly CastShaping[],
  input: Partial<ResolveInput> = {},
  faces: number[] = []
) => table.resolve(actionId, { ...(shaping.length > 0 ? { shaping } : {}), ...input }, faces);
const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal, got none");
};
const savesOf = (state: GameState) => state.combat.pendingSaves;
const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;

/** Answers the save `targetId` owes, its d20s showing `faces`. */
function answer(state: GameState, targetId: string, faces: number[]) {
  const pending = savesOf(state).find((entry) => entry.targetActorId === targetId)!;
  const deps: SaveAnswerDependencies = {
    random: () => faces.shift() ?? 10,
    newRollId: () => crypto.randomUUID(),
    sessionId: "30000000-0000-4000-8000-00000000000a",
    role: "gm",
    now: () => "2026-10-19T00:00:00.000Z",
    resolveDefinition: (id) => storedDefinition(state, id),
    catalog
  };
  return answerSave(state, crypto.randomUUID(), pending.id, "roll", undefined, true, { role: "gm" }, deps);
}

describe("Metamagic: the picks, the price and one option a spell", () => {
  it("refuses an option the Sorcerer doesn't know, and one the spell can't take", () => {
    const table = sorcerer10(["careful-spell", "distant-spell", "quickened-spell", "subtle-spell"]);
    expect(refusal(() => cast(table, "spell-fireball", [{ id: "heightened-spell", creatureIds: [FOE] }]))).toMatch(
      /Ilde doesn't know the Metamagic option Heightened Spell/
    );
    expect(refusal(() => cast(table, "spell-fire-bolt", [{ id: "careful-spell", creatureIds: [FOE] }]))).toMatch(
      /Careful Spell shapes a spell that makes creatures save, and Fire Bolt doesn't/
    );
    expect(points(table)).toBe(0);
  });

  it("allows one counted option on a spell, and leaves Empowered Spell to the damage roll", () => {
    const table = sorcerer10(["careful-spell", "distant-spell", "empowered-spell", "subtle-spell"]);
    expect(
      refusal(() =>
        cast(table, "spell-fireball", [{ id: "careful-spell", creatureIds: [ALLY] }, { id: "subtle-spell" }])
      )
    ).toMatch(/can use one Metamagic option on a spell\./);
    // "When you roll damage for a spell": Empowered Spell answers the damage once it is seen.
    expect(
      refusal(() =>
        cast(table, "spell-fireball", [{ id: "careful-spell", creatureIds: [ALLY] }, { id: "empowered-spell" }])
      )
    ).toMatch(/Empowered Spell is used once the damage is rolled/);
    cast(table, "spell-fireball", [{ id: "careful-spell", creatureIds: [ALLY] }], { targetIds: [FOE, ALLY] });
    expect(points(table)).toBe(1);
  });

  it("keeps an option's own row off the turn: it is chosen with a cast", () => {
    const table = sorcerer10(["careful-spell", "distant-spell", "quickened-spell", "subtle-spell"]);
    expect(refusal(() => table.resolve("careful-spell", { targetIds: [] }))).toMatch(
      /Careful Spell shapes a spell: choose it on the spell's cast/
    );
  });

  it("refuses a cast whose Metamagic costs more Sorcery Points than are left", () => {
    const table = sorcerer10(["careful-spell", "heightened-spell", "quickened-spell", "subtle-spell"]);
    table.hero.actionUses = { ...table.hero.actionUses, "sorcery-points": 9 };
    expect(refusal(() => cast(table, "spell-hold-person", [{ id: "heightened-spell", creatureIds: [FOE] }]))).toMatch(
      /Ilde has 1 Sorcery Point left, and this cast's Metamagic costs 2/
    );
  });

  it("offers the cast each option the Sorcerer knows, with its cost and why a spell can't take it", () => {
    const table = sorcerer10(["careful-spell", "transmuted-spell", "quickened-spell", "twinned-spell"]);
    const rows = actionAvailability(
      table.state,
      table.hero,
      effectiveActions(table.definition, table.hero, catalog).filter((action) =>
        ["spell-fireball", "spell-hold-person"].includes(action.id)
      ),
      table.definition,
      false,
      undefined,
      catalog
    );
    const fireball = rows.find((row) => row.id === "spell-fireball")!.shaping!;
    expect(fireball).toMatchObject({ limit: 1, points: 10 });
    expect(fireball.options.map((option) => [option.id, option.cost, option.available])).toEqual([
      ["careful-spell", 1, true],
      ["quickened-spell", 2, true],
      ["transmuted-spell", 1, true],
      ["twinned-spell", 1, false]
    ]);
    expect(fireball.options.find((option) => option.id === "careful-spell")!.creatures).toEqual({ count: 5 });
    expect(fireball.options.find((option) => option.id === "transmuted-spell")!.damageTypes).toEqual([
      "acid",
      "cold",
      "lightning",
      "poison",
      "thunder"
    ]);
    const holdPerson = rows.find((row) => row.id === "spell-hold-person")!.shaping!;
    expect(holdPerson.options.find((option) => option.id === "twinned-spell")!.available).toBe(true);
    expect(holdPerson.options.find((option) => option.id === "transmuted-spell")!.reason).toMatch(
      /Transmuted Spell changes Acid, Cold, Fire, Lightning, Poison or Thunder damage, and Hold Person deals none/
    );
  });
});

describe("Careful Spell: chosen creatures automatically succeed and take no damage", () => {
  it("leaves the protected ally out of Fireball's saves, at a cost of 1 Sorcery Point", () => {
    const table = sorcerer10(["careful-spell", "distant-spell", "quickened-spell", "subtle-spell"]);
    const result = cast(table, "spell-fireball", [{ id: "careful-spell", creatureIds: [ALLY] }], {
      targetIds: [FOE, FOE2, ALLY]
    });
    expect(
      savesOf(table.state)
        .map((save) => save.targetActorId)
        .sort()
    ).toEqual([FOE, FOE2].sort());
    expect(result.tableNarration?.map((line) => line.text)).toContain(
      "Bran succeeds on the DEX save against Fireball without a roll (Careful Spell) and takes no damage."
    );
    expect(actorOf(table.state, ALLY).hp.current).toBe(200);
    expect(points(table)).toBe(1);
  });

  it("protects no more creatures than the Charisma modifier", () => {
    const table = sorcerer10(["careful-spell", "distant-spell", "quickened-spell", "subtle-spell"]);
    const many = Array.from({ length: 6 }, (_, index) => `10000000-0000-4000-8000-00000000010${index}`);
    expect(refusal(() => cast(table, "spell-fireball", [{ id: "careful-spell", creatureIds: many }]))).toMatch(
      /Careful Spell protects up to 5 creatures; 6 were chosen/
    );
  });
});

describe("Distant Spell: range doubled, Touch becomes 30 feet", () => {
  const far = (distance: number) =>
    fight(sorcerer(10, ["distant-spell", "careful-spell", "quickened-spell", "subtle-spell"]), { distance });

  it("doubles Fire Bolt's 120 feet", () => {
    expect(refusal(() => cast(far(200), "spell-fire-bolt", []))).toMatch(/beyond the 120 ft maximum range/);
    const table = far(200);
    const result = cast(table, "spell-fire-bolt", [{ id: "distant-spell" }], {}, [15, 5, 5]);
    expect(result.attack?.outcome).toBe("hit");
    expect(points(table)).toBe(1);
  });

  it("gives Shocking Grasp a range of 30 feet, and Hold Person 120", () => {
    expect(refusal(() => cast(far(25), "spell-shocking-grasp", []))).toMatch(/beyond Ilde's 5 ft reach/);
    expect(cast(far(25), "spell-shocking-grasp", [{ id: "distant-spell" }], {}, [15, 4]).attack?.outcome).toBe("hit");
    expect(refusal(() => cast(far(100), "spell-hold-person", []))).toMatch(/beyond Hold Person's 60 ft range/);
    cast(far(100), "spell-hold-person", [{ id: "distant-spell" }]);
  });
});

describe("Empowered Spell: reroll damage dice up to the Charisma modifier once they are seen", () => {
  const look = (table: Fight, faces: number[], answer?: Readonly<{ dice: number[] }>) =>
    cast(
      table,
      "spell-fireball",
      [],
      {
        targetIds: [FOE],
        commit: false,
        damageLook: true,
        ...(answer ? { damageAnswer: { id: "empowered-spell" as const, dice: answer.dice } } : {})
      },
      faces
    );
  const facesOf = (result: ReturnType<typeof look>) => (result.heldDamage?.dice ?? []).map((die) => die.face);

  it("rerolls the dice the Sorcerer picks for 1 Sorcery Point, and the confirm deals them", () => {
    const table = sorcerer10(["careful-spell", "empowered-spell", "quickened-spell", "subtle-spell"]);
    const first = look(table, [1, 1, 1, 1, 1, 2, 6, 6]);
    expect(facesOf(first)).toEqual([1, 1, 1, 1, 1, 2, 6, 6]);
    expect(first.heldDamage?.answers.find((offer) => offer.id === "empowered-spell")).toEqual({
      id: "empowered-spell",
      name: "Empowered Spell",
      dice: 5,
      ownOnly: true,
      cost: "1 Sorcery Point"
    });
    expect(points(table)).toBe(0);
    // Charisma +5: the five 1s are rerolled, and come up 6. Elemental Affinity adds 5 Fire.
    const answered = look(table, [6, 6, 6, 6, 6], { dice: [0, 1, 2, 3, 4] });
    expect(facesOf(answered)).toEqual([6, 6, 6, 6, 6, 2, 6, 6]);
    expect(answered.damageTotal).toBe(5 * 6 + 2 + 6 + 6 + 5);
    expect(points(table)).toBe(1);
    expect(answered.heldDamage?.answers.some((offer) => offer.id === "empowered-spell")).toBe(false);
    cast(table, "spell-fireball", [], { targetIds: [FOE] }, [1, 1, 1, 1, 1, 1, 1, 1]);
    expect(savesOf(table.state)[0]!.proposedDamage).toBe(5 * 6 + 2 + 6 + 6 + 5);
  });

  it("rerolls no more dice than the Charisma modifier, and once a roll", () => {
    const table = sorcerer10(["careful-spell", "empowered-spell", "quickened-spell", "subtle-spell"]);
    look(table, [1, 1, 1, 1, 1, 1, 1, 1]);
    expect(refusal(() => look(table, [], { dice: [0, 1, 2, 3, 4, 5] }))).toMatch(
      /Empowered Spell rerolls up to 5 dice/
    );
    look(table, [4], { dice: [0] });
    expect(refusal(() => look(table, [], { dice: [1] }))).toMatch(/Empowered Spell has already rerolled this damage/);
    expect(points(table)).toBe(1);
  });

  it("leaves dice nobody looked at as they fell", () => {
    const table = sorcerer10(["careful-spell", "empowered-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-fireball", [], { targetIds: [FOE] }, [1, 1, 1, 1, 1, 2, 6, 6]);
    expect(savesOf(table.state)[0]!.proposedDamage).toBe(5 + 2 + 12 + 5);
    expect(points(table)).toBe(0);
  });

  it("offers a look on the cast while a Sorcery Point is left", () => {
    const table = sorcerer10(["careful-spell", "empowered-spell", "quickened-spell", "subtle-spell"]);
    const offered = () =>
      actionAvailability(
        table.state,
        table.hero,
        effectiveActions(table.definition, table.hero, catalog).filter((action) => action.id === "spell-fireball"),
        table.definition,
        false,
        undefined,
        catalog
      )[0]!.damageLook;
    expect(offered()).toBe(true);
    table.hero.actionUses = { ...table.hero.actionUses, "sorcery-points": 10 };
    expect(offered()).toBeUndefined();
  });
});

describe("Extended Spell: duration doubled, Advantage on Concentration saves for it", () => {
  it("doubles Hold Person's minute and gives its Concentration Advantage", () => {
    const table = sorcerer10(["extended-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-hold-person", [{ id: "extended-spell" }], { targetIds: [FOE] });
    const concentration = table.hero.effects.find((effect) => effect.concentration)!;
    expect(concentration.name).toBe("Concentrating on Hold Person (Extended Spell)");
    expect(concentration.duration).toEqual({ type: "rounds", remaining: 20 });
    const derivation = deriveEquipment(table.hero, table.definition, catalog);
    expect(saveRollSources(table.hero, "con", derivation, true).advantage.map((claim) => claim.label)).toContain(
      "Concentrating on Hold Person (Extended Spell)"
    );
    expect(savesOf(table.state)[0]!.onFailEffect?.duration).toEqual({ type: "rounds", rounds: 20 });
    expect(points(table)).toBe(1);
  });

  it("makes Mage Armor last 16 hours, and refuses an instantaneous spell", () => {
    const table = sorcerer10(["extended-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-mage-armor", [{ id: "extended-spell" }], { targetIds: [HERO] });
    expect(table.hero.effects.find((effect) => effect.name === "Mage Armor")?.duration).toEqual({
      type: "minutes",
      remaining: 16 * 60
    });
    const another = sorcerer10(["extended-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    expect(refusal(() => cast(another, "spell-fire-bolt", [{ id: "extended-spell" }]))).toMatch(
      /Extended Spell doubles a duration of 1 minute or longer up to 24 hours/
    );
  });
});

describe("Heightened Spell: one target has Disadvantage on saves against the spell", () => {
  it("gives Hold Person's target Disadvantage on the first save and every repeat", () => {
    const table = sorcerer10(["heightened-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-hold-person", [{ id: "heightened-spell", creatureIds: [FOE] }], { targetIds: [FOE] });
    expect(points(table)).toBe(2);
    // An 18 and a 3: with Disadvantage the 3 counts, and the Goblin is Paralyzed.
    const first = answer(table.state, FOE, [18, 3]);
    expect(first.outcome.success).toBe(false);
    expect(first.outcome.rollMode?.disadvantage).toContain("Heightened Spell");
    const held = actorOf(table.state, FOE).effects.find((effect) => effect.repeatSave)!;
    expect(held.repeatSave).toMatchObject({ disadvantageFrom: "Heightened Spell" });
    // The Goblin's turn ends: it repeats the save.
    openRepeatSaves(table.state, FOE, "turn-end", {
      newId: () => crypto.randomUUID(),
      now: () => "2026-10-19T00:00:00.000Z"
    });
    const repeat = answer(table.state, FOE, [19, 2]);
    expect(repeat.outcome.rollMode?.disadvantage).toContain("Heightened Spell");
    expect(repeat.outcome.success).toBe(false);
  });

  it("names a target of the spell", () => {
    const table = sorcerer10(["heightened-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    expect(
      refusal(() =>
        cast(table, "spell-hold-person", [{ id: "heightened-spell", creatureIds: [FOE2] }], { targetIds: [FOE] })
      )
    ).toMatch(/Orc isn't one of Hold Person's targets/);
  });
});

describe("Quickened Spell: an action's casting time becomes a Bonus Action", () => {
  it("casts Fireball as a Bonus Action for 2 points, then refuses another level 1+ spell that turn", () => {
    const table = sorcerer10(["quickened-spell", "careful-spell", "distant-spell", "subtle-spell"]);
    cast(table, "spell-fireball", [{ id: "quickened-spell" }], { targetIds: [FOE] });
    expect(table.state.combat.turn).toMatchObject({ actionUsed: false, bonusActionUsed: true });
    expect(points(table)).toBe(2);
    expect(refusal(() => cast(table, "spell-bless-free", [], { targetIds: [HERO] }))).toMatch(
      /Ilde used Quickened Spell this turn, so no other level 1\+ spell can be cast until the turn ends/
    );
    // A cantrip with the action is still there.
    cast(table, "spell-fire-bolt", [], { targetIds: [FOE] }, [15, 5, 5]);
  });

  it("refuses to quicken a spell after a level 1+ spell this turn", () => {
    const table = sorcerer10(["quickened-spell", "careful-spell", "distant-spell", "subtle-spell"]);
    cast(table, "spell-bless-free", [], { targetIds: [HERO] });
    expect(refusal(() => cast(table, "spell-fireball", [{ id: "quickened-spell" }], { targetIds: [FOE] }))).toMatch(
      /Ilde already cast a level 1\+ spell this turn, so Quickened Spell can't shape another/
    );
  });

  it("keeps a quickened Scorching Ray's rays on its Bonus Action and its one slot", () => {
    const table = sorcerer10(["quickened-spell", "careful-spell", "distant-spell", "subtle-spell"]);
    const slots = () => table.hero.spellSlots?.find((slot) => slot.level === 2)?.remaining;
    const before = slots()!;
    cast(table, "spell-scorching-ray", [{ id: "quickened-spell" }], { targetIds: [FOE] }, [15, 3, 3]);
    cast(table, "spell-scorching-ray", [], { targetIds: [FOE] }, [15, 3, 3]);
    cast(table, "spell-scorching-ray", [], { targetIds: [FOE] }, [15, 3, 3]);
    expect(slots()).toBe(before - 1);
    expect(points(table)).toBe(2);
    expect(table.state.combat.turn.actionUsed).toBe(false);
  });
});

describe("Seeking Spell: reroll a missed spell attack's d20", () => {
  it("rerolls a missed Fire Bolt for 1 point, and the new roll counts", () => {
    const table = sorcerer10(["seeking-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    const holdKey = `attack:${HERO}`;
    // +9 to hit against AC 12: a 2 misses.
    const missed = cast(table, "spell-fire-bolt", [], { commit: false, holdKey }, [2]);
    expect(missed.attack?.outcome).toBe("miss");
    expect(missed.attack?.answers?.map((offer) => offer.id)).toContain("seeking-spell");
    const again = cast(table, "spell-fire-bolt", [], { commit: false, holdKey, answer: { id: "seeking-spell" } }, [14]);
    expect(again.attack).toMatchObject({ naturalRoll: 14, outcome: "hit" });
    expect(points(table)).toBe(1);
  });
});

describe("Subtle Spell: no Verbal, Somatic or non-costly Material components", () => {
  it("lets a gagged Sorcerer cast Hold Person", () => {
    const table = sorcerer10(["subtle-spell", "careful-spell", "quickened-spell", "distant-spell"]);
    addEffect(
      table.state,
      HERO,
      makeEffect({ id: "gag", name: "Gagged", tags: [CANT_SPEAK_TAG], duration: { type: "manual" } })
    );
    expect(refusal(() => cast(table, "spell-hold-person", [], { targetIds: [FOE] }))).toMatch(
      /Ilde can't speak while Gagged lasts, and Hold Person has a Verbal component/
    );
    cast(table, "spell-hold-person", [{ id: "subtle-spell" }], { targetIds: [FOE] });
    expect(points(table)).toBe(1);
  });

  it("leaves a watching Mage nothing to Counterspell", () => {
    const definition = sorcerer(10, ["subtle-spell", "careful-spell", "quickened-spell", "distant-spell"]);
    const duel = (shaping: readonly CastShaping[]) => {
      const MAGE = FOE;
      const state = GameStateSchema.parse({
        schemaVersion: 1,
        actors: [{ id: MAGE, name: "Mage", kind: "monster", hp: { current: 81, maximum: 81 }, definitionId: "mage" }]
      });
      importActorDefinition(state, definition, HERO, "public", catalog);
      startEncounter(
        state,
        {
          mapAssetId: "20000000-0000-5000-8000-000000000001",
          entries: [
            { actorId: HERO, score: 20 },
            { actorId: MAGE, score: 5 }
          ]
        },
        () => 1,
        { width: 900, height: 600, calibration: null }
      );
      const hero = state.actors.find((actor) => actor.id === HERO)!;
      const library = new ContentLibrary();
      return resolveDefinitionAction(
        state,
        effectiveActions(definition, hero, catalog).find((action) => action.id === "spell-hold-person")!,
        {
          actorId: HERO,
          targetIds: [MAGE],
          commandId: crypto.randomUUID(),
          ...(shaping.length > 0 ? { shaping } : {})
        },
        {
          random: () => 10,
          newRollId: () => crypto.randomUUID(),
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-19T00:00:00.000Z",
          definition,
          catalog,
          resolveDefinition: (id) => storedDefinition(state, id) ?? library.monsterForInstance(id)
        }
      );
    };
    expect(duel([]).waitingOnReaction).toBe(true);
    expect(duel([{ id: "subtle-spell" }]).waitingOnReaction).toBeUndefined();
  });
});

describe("Transmuted Spell: change Acid, Cold, Fire, Lightning, Poison or Thunder damage to another of them", () => {
  it("turns Fireball's fire to thunder", () => {
    const table = sorcerer10(["transmuted-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-fireball", [{ id: "transmuted-spell", damageType: "thunder" }], { targetIds: [FOE] });
    expect(savesOf(table.state)[0]!.proposedDamageParts?.map((part) => part.type)).toEqual(["thunder"]);
    expect(points(table)).toBe(1);
  });

  it("refuses the type it already deals and a type off the list", () => {
    const table = sorcerer10(["transmuted-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    for (const damageType of ["fire", "radiant"] as const)
      expect(
        refusal(() => cast(table, "spell-fireball", [{ id: "transmuted-spell", damageType }], { targetIds: [FOE] }))
      ).toMatch(
        /Choose the type Transmuted Spell changes Fireball's damage to: acid, cold, lightning, poison, thunder/
      );
  });
});

describe("a spell whose area acts later keeps its shaping there", () => {
  it("leaves Cloudkill's area dealing the transmuted type", () => {
    const table = sorcerer10(["transmuted-spell", "heightened-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-cloudkill", [{ id: "transmuted-spell", damageType: "acid" }], { targetIds: [FOE] });
    expect(table.state.combat.spellZones[0]).toMatchObject({ spellId: "cloudkill", damageType: "acid" });
    expect(savesOf(table.state)[0]!.proposedDamageParts?.map((part) => part.type)).toEqual(["acid"]);
  });

  it("marks Heightened Spell's target on the area, for the saves it asks later", () => {
    const table = sorcerer10(["transmuted-spell", "heightened-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-cloudkill", [{ id: "heightened-spell", creatureIds: [FOE] }], { targetIds: [FOE, FOE2] });
    expect(table.state.combat.spellZones[0]).toMatchObject({ heightened: FOE });
    expect(savesOf(table.state).find((save) => save.targetActorId === FOE)?.disadvantageFrom).toBe("Heightened Spell");
    expect(savesOf(table.state).find((save) => save.targetActorId === FOE2)?.disadvantageFrom).toBeUndefined();
  });
});

describe("a readied spell keeps the shaping it was readied with", () => {
  it("releases a readied Fireball transmuted, its point spent once when it was readied", () => {
    const table = sorcerer10(["transmuted-spell", "heightened-spell", "quickened-spell", "subtle-spell"]);
    cast(table, "spell-fireball", [{ id: "transmuted-spell", damageType: "thunder" }], { ready: true });
    expect(points(table)).toBe(1);
    nextInitiativeTurn(table.state);
    const released = cast(table, "spell-fireball", [], { targetIds: [FOE] });
    expect(released.damage.map((part) => part.type)).toEqual(["thunder"]);
    expect(table.state.combat.reactionsUsed).toContain(HERO);
    expect(points(table)).toBe(1);
  });
});

describe("Twinned Spell: the spell's effective level rises by 1", () => {
  it("lets Hold Person from a level 2 slot take two creatures, spending the level 2 slot", () => {
    const table = sorcerer10(["twinned-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    expect(refusal(() => cast(table, "spell-hold-person", [], { targetIds: [FOE, FOE2], slotLevel: 2 }))).toMatch(
      /Hold Person targets one creature; 2 were chosen/
    );
    const before = table.hero.spellSlots!.find((slot) => slot.level === 2)!.remaining;
    cast(table, "spell-hold-person", [{ id: "twinned-spell" }], { targetIds: [FOE, FOE2], slotLevel: 2 });
    expect(
      savesOf(table.state)
        .map((save) => save.targetActorId)
        .sort()
    ).toEqual([FOE, FOE2].sort());
    expect(table.hero.spellSlots!.find((slot) => slot.level === 2)!.remaining).toBe(before - 1);
    expect(table.hero.effects.find((effect) => effect.concentration)?.spell).toEqual({ id: "hold-person", level: 3 });
    expect(points(table)).toBe(1);
  });

  it("refuses a spell that targets no more creatures at a higher level", () => {
    const table = sorcerer10(["twinned-spell", "careful-spell", "quickened-spell", "subtle-spell"]);
    expect(refusal(() => cast(table, "spell-fireball", [{ id: "twinned-spell" }], { targetIds: [FOE] }))).toMatch(
      /Twinned Spell raises a spell that targets another creature at a higher level, and Fireball doesn't/
    );
  });
});

describe("Sorcery Incarnate and Arcane Apotheosis, while Innate Sorcery is active", () => {
  const innate = (table: Fight) => table.resolve("innate-sorcery", { targetIds: [] });

  it("lets a Sorcerer 7 use two options on one spell", () => {
    const table = fight(sorcerer(7, ["careful-spell", "heightened-spell"]), { ally: true });
    const both: CastShaping[] = [
      { id: "careful-spell", creatureIds: [ALLY] },
      { id: "heightened-spell", creatureIds: [FOE] }
    ];
    expect(refusal(() => cast(table, "spell-fireball", both, { targetIds: [FOE, ALLY] }))).toMatch(/one Metamagic/);
    innate(table);
    table.state.combat = { ...table.state.combat, turn: { ...table.state.combat.turn, bonusActionUsed: false } };
    cast(table, "spell-fireball", both, { targetIds: [FOE, ALLY] });
    expect(points(table)).toBe(3);
  });

  it("makes a Sorcerer 20's first option each turn free", () => {
    const picks: Option[] = [
      "careful-spell",
      "heightened-spell",
      "quickened-spell",
      "subtle-spell",
      "distant-spell",
      "twinned-spell"
    ];
    const table = fight(sorcerer(20, picks), { ally: true });
    innate(table);
    cast(table, "spell-hold-person", [{ id: "heightened-spell", creatureIds: [FOE] }], { targetIds: [FOE] });
    expect(points(table)).toBe(0);
    expect(table.state.combat.turn.metamagic?.freeUsed).toBe(true);
  });
});

describe("Sculpt Spells (Evoker 6): 1 + the spell's level creatures succeed and take no damage", () => {
  const evoker = () => {
    const input = wizardInput(["fireball", "hold-person", "magic-missile", "shield", "sleep", "misty-step"]);
    return fight(build({ ...input, level: 6 }), { ally: true });
  };

  it("shields up to four creatures from a level 3 Fireball, at no cost", () => {
    const table = evoker();
    cast(table, "spell-fireball", [{ id: "sculpt-spells", creatureIds: [ALLY, FOE2] }], {
      targetIds: [FOE, FOE2, ALLY]
    });
    expect(savesOf(table.state).map((save) => save.targetActorId)).toEqual([FOE]);
    expect(table.hero.actionUses["sorcery-points"]).toBeUndefined();
    const five = Array.from({ length: 5 }, (_, index) => `10000000-0000-4000-8000-00000000020${index}`);
    expect(refusal(() => cast(evoker(), "spell-fireball", [{ id: "sculpt-spells", creatureIds: five }]))).toMatch(
      /Sculpt Spells protects up to 4 creatures; 5 were chosen/
    );
  });

  it("shapes only an Evocation spell", () => {
    const table = evoker();
    expect(
      refusal(() =>
        cast(table, "spell-hold-person", [{ id: "sculpt-spells", creatureIds: [ALLY] }], { targetIds: [FOE] })
      )
    ).toMatch(/Sculpt Spells shapes an Evocation spell, and Hold Person isn't one/);
  });
});
