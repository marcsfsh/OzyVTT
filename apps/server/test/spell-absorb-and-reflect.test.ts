import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition, storedDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { convertResource } from "../src/conversions.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { pushTokenAway } from "../src/forced-movement.js";
import { answerReaction } from "../src/reactions.js";
import { answerSave } from "../src/saving-throws.js";
import { build, HERO, wizardInput } from "./spell-casters.js";
import { cell, GEOMETRY, GOBLIN, HERO as BORIN, visionGame } from "./vision-fixtures.js";

// SRD 5.2.1 items that take a spell as it is cast or turn it back once saved against: a Rod of Absorption ("absorb a
// spell that is targeting only you and not with an area of effect ... stored in the rod"), a Staff of the Magi's Spell
// Absorption ("gaining a number of charges equal to the absorbed spell's level"), an Ioun Stone of Absorption ("cancel
// a spell of level 4 or lower cast by a creature you can see ... Once the stone has canceled 20 levels of spells, it
// burns out"), a Ring of Spell Turning ("deflect that spell back at the spell's caster; the caster must make a saving
// throw against the spell using its own spell save DC") and Dwarven Plate ("reduce the distance you are moved by up to
// 10 feet").

const library = new ContentLibrary();
const catalog = equipmentCatalogOf(library.forAudience("gm"));
const KNIGHT = "10000000-0000-4000-8000-000000000002";
const wizard = build(wizardInput(["hold-person", "magic-missile", "fireball", "shield"]));
const GM = { role: "gm" } as const;

const row = (id: string, over: Partial<InventoryItem> = {}): InventoryItem =>
  InventoryItemSchema.parse({
    id,
    name: library.forAudience("gm").equipmentRecord(id)!.name,
    equipped: true,
    attuned: true,
    ...over
  });

/** The wizard on turn against a knight carrying `items`. Dice come from `faces`. */
function duel(items: readonly InventoryItem[], faces: number[] = []) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: KNIGHT,
        name: "Knight",
        kind: "monster",
        hp: { current: 52, maximum: 52 },
        definitionId: "knight",
        inventory: items
      }
    ]
  });
  importActorDefinition(state, wizard, HERO, "public", catalog);
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: KNIGHT, score: 5 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  const resolveDefinition = (id: string): ActorDefinition | undefined =>
    storedDefinition(state, id) ?? library.monsterForInstance(id);
  let next = 0;
  const deps = {
    random: (sides: number) => Math.min(faces.shift() ?? 1, sides),
    newRollId: () => `40000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-26T00:00:00.000Z",
    catalog,
    resolveDefinition
  };
  const command = () => `50000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`;
  const cast = (actionId: string, input: Partial<ResolveInput> = {}) => {
    const actor = state.actors.find((candidate) => candidate.id === HERO)!;
    const action = effectiveActions(wizard, actor, catalog).find((candidate) => candidate.id === actionId)!;
    return resolveDefinitionAction(
      state,
      action,
      { actorId: HERO, targetIds: [KNIGHT], commandId: command(), ...input },
      { ...deps, definition: wizard }
    );
  };
  const answer = (use: boolean) =>
    answerReaction(state, command(), state.combat.pendingReactions[0]!.id, use, undefined, GM, deps, {});
  /** The knight's save, rolled by the server and, first, answered with `answerId` on a look. */
  const save = (answerId?: string) => {
    const pending = state.combat.pendingSaves.find((entry) => entry.targetActorId === KNIGHT)!;
    const saveDeps = { ...deps, sessionId: deps.gmSessionId, role: "gm" as const };
    answerSave(state, command(), pending.id, "roll", undefined, false, GM, saveDeps);
    if (answerId)
      answerSave(state, command(), pending.id, "roll", undefined, false, GM, saveDeps, false, undefined, undefined, {
        answer: { id: answerId }
      });
    return answerSave(state, command(), pending.id, "roll", undefined, true, GM, saveDeps);
  };
  const actor = (id: string) => state.actors.find((candidate) => candidate.id === id)!;
  return { state, cast, answer, save, actor, deps };
}

const slots = (state: GameState, level: number) =>
  state.actors.find((actor) => actor.id === HERO)!.spellSlots!.find((slot) => slot.level === level)!.remaining;

describe("a Rod of Absorption", () => {
  it("absorbs a spell aimed at its holder alone: no effect, the slot spent, and its levels stored", () => {
    const { state, cast, answer, actor } = duel([row("rod-of-absorption")]);
    // A rod holding 5 levels.
    actor(KNIGHT).actionUses = { "rod-of-absorption-stored": 45 };
    const before = slots(state, 2);
    cast("spell-hold-person");
    expect(state.combat.pendingReactions[0]).toMatchObject({ kind: "casts-spell", actorId: KNIGHT });
    expect(state.combat.pendingReactions[0]!.actionName).toBe("Absorb Spell");
    const outcome = answer(true);
    expect(outcome).toMatchObject({ used: true, countered: true });
    expect(state.combat.pendingSaves).toEqual([]);
    expect(slots(state, 2)).toBe(before - 1);
    expect(actor(KNIGHT).actionUses).toMatchObject({
      "rod-of-absorption-absorbed": 2,
      "rod-of-absorption-stored": 43
    });
    expect(state.combat.reactionsUsed).toContain(KNIGHT);
  });

  it("leaves a spell with an area alone", () => {
    const { state, cast } = duel([row("rod-of-absorption")]);
    cast("spell-fireball");
    expect(state.combat.pendingReactions).toEqual([]);
  });

  it("can't absorb past 50 levels in its existence", () => {
    const { state, cast, actor } = duel([row("rod-of-absorption")]);
    actor(KNIGHT).actionUses = { "rod-of-absorption-absorbed": 49 };
    cast("spell-hold-person");
    expect(state.combat.pendingReactions).toEqual([]);
  });

  it("turns stored levels into a spent spell slot for a spellcaster holding it", () => {
    const { state, actor, deps } = duel([]);
    const hero = actor(HERO);
    hero.inventory.push(row("rod-of-absorption"));
    hero.actionUses = { ...hero.actionUses, "rod-of-absorption-stored": 47 };
    hero.spellSlots = hero.spellSlots!.map((slot) => (slot.level === 2 ? { ...slot, remaining: 0 } : slot));
    convertResource(state, HERO, { conversionId: "rod-of-absorption", level: 2 }, deps);
    expect(slots(state, 2)).toBe(1);
    expect(hero.actionUses["rod-of-absorption-stored"]).toBe(49);
    expect(() => convertResource(state, HERO, { conversionId: "rod-of-absorption", level: 2 }, deps)).toThrow();
  });
});

describe("a Staff of the Magi's Spell Absorption", () => {
  it("cancels a spell aimed at its holder alone and gains charges equal to its level", () => {
    const { state, cast, answer, actor } = duel([row("staff-of-the-magi")]);
    actor(KNIGHT).actionUses = { "staff-of-the-magi-charges": 10 };
    cast("spell-hold-person");
    expect(state.combat.pendingReactions[0]!.actionName).toBe("Spell Absorption");
    answer(true);
    expect(actor(KNIGHT).actionUses["staff-of-the-magi-charges"]).toBe(8);
  });
});

describe("an Ioun Stone of Absorption", () => {
  it("cancels a spell it sees cast, area or not, counting its levels toward the 20 it can cancel", () => {
    const { state, cast, answer, actor } = duel([row("ioun-stone", { variantId: "absorption" })]);
    cast("spell-fireball");
    expect(state.combat.pendingReactions[0]!.actionName).toBe("Absorb a Spell (Absorption)");
    answer(true);
    expect(actor(KNIGHT).actionUses["ioun-stone-absorbed"]).toBe(3);
    expect(actor(KNIGHT).hp.current).toBe(52);
  });

  it("burns out once the levels it has left can't take the spell", () => {
    const { state, cast, actor } = duel([row("ioun-stone", { variantId: "absorption" })]);
    actor(KNIGHT).actionUses = { "ioun-stone-absorbed": 18 };
    cast("spell-fireball");
    expect(state.combat.pendingReactions).toEqual([]);
  });
});

describe("a Ring of Spell Turning", () => {
  it("turns a spell aimed at its wearer alone back on its caster, who saves against its own DC", () => {
    const { state, cast, save, actor } = duel([row("ring-of-spell-turning")], [20]);
    cast("spell-hold-person");
    const dc = state.combat.pendingSaves[0]!.dc;
    save("item-ring-of-spell-turning-deflect");
    expect(actor(KNIGHT).conditions.some((condition) => condition.id === "paralyzed")).toBe(false);
    expect(state.combat.pendingSaves).toEqual([
      expect.objectContaining({ targetActorId: HERO, sourceActorId: KNIGHT, ability: "wis", dc })
    ]);
    expect(state.combat.reactionsUsed).toContain(KNIGHT);
  });

  it("isn't offered on a failed save", () => {
    const { cast, save } = duel([row("ring-of-spell-turning")], [1, 1]);
    cast("spell-hold-person");
    expect(() => save("item-ring-of-spell-turning-deflect")).toThrow(/succeeds/);
  });
});

describe("a Staff of Charming's Reflect Enchantment", () => {
  it("answers a successful save against an Enchantment spell aimed at its holder alone, for a Reaction and a charge", () => {
    const staff = effectiveActions(
      undefined,
      { ...duel([]).actor(KNIGHT), inventory: [row("staff-of-charming")] },
      catalog
    );
    expect(staff.find((action) => action.id === "item-staff-of-charming-reflect-enchantment")).toMatchObject({
      activation: "reaction",
      uses: { pool: "staff-of-charming-charges" },
      answer: {
        when: "success",
        versus: { spellSchools: ["enchantment"], singleTarget: true },
        effect: { kind: "reflect", dc: "bearer" }
      }
    });
  });
});

describe("Dwarven Plate", () => {
  it("takes up to 10 feet off a push for its wearer's Reaction, once a round", () => {
    const plate = row("dwarven-plate", { attuned: false });
    const state = visionGame({ positions: { [BORIN]: cell(5, 5) }, actors: { [BORIN]: { inventory: [plate] } } });
    const start = state.combat.tokens.find((token) => token.actorId === BORIN)!.position!;
    expect(pushTokenAway(state, { actorId: BORIN, awayFromActorId: GOBLIN, distanceFeet: 10 }, GEOMETRY)).toEqual({
      value: 0,
      unit: "ft"
    });
    expect(state.combat.tokens.find((token) => token.actorId === BORIN)!.position).toEqual(start);
    expect(state.combat.reactionsUsed).toContain(BORIN);
    expect(pushTokenAway(state, { actorId: BORIN, awayFromActorId: GOBLIN, distanceFeet: 10 }, GEOMETRY)?.value).toBe(
      10
    );
  });
});
