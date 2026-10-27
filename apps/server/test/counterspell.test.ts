import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition, storedDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { nextInitiativeTurn, startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { answerReaction } from "../src/reactions.js";
import { build, HERO, wizardInput } from "./spell-casters.js";
import { catalogRow } from "./equipment-table.js";

// SRD 5.2.1 Counterspell: "You attempt to interrupt a creature in the process of casting a spell. The creature makes a
// Constitution saving throw. On a failed save, the spell dissipates with no effect, and the action, Bonus Action, or
// Reaction used to cast it is wasted. If that spell was cast with a spell slot, the slot isn't expended."

const library = new ContentLibrary();
const catalog = equipmentCatalogOf(library.forAudience("gm"));
const MAGE = "10000000-0000-4000-8000-000000000002";
const wizard = build(wizardInput(["counterspell", "shield", "magic-missile", "fireball", "alarm"]));
const GM = { role: "gm" } as const;

/** The wizard (whose turn comes first unless `mageFirst`) against a Mage stat block. Dice come from `faces`. */
function duel(faces: number[], options: Readonly<{ mageFirst?: boolean; monster?: string }> = {}) {
  const monster = options.monster ?? "mage";
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: MAGE, name: "Mage", kind: "monster", hp: { current: 81, maximum: 81 }, definitionId: monster }]
  });
  importActorDefinition(state, wizard, HERO, "public", catalog);
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: HERO, score: options.mageFirst ? 5 : 20 },
        { actorId: MAGE, score: options.mageFirst ? 20 : 5 }
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
    now: () => "2026-10-16T00:00:00.000Z",
    catalog,
    resolveDefinition
  };
  const cast = (actorId: string, actionId: string, input: Partial<ResolveInput> = {}) => {
    const actor = state.actors.find((candidate) => candidate.id === actorId)!;
    const definition = resolveDefinition(actor.definitionId!)!;
    const action = effectiveActions(definition, actor, catalog).find((candidate) => candidate.id === actionId)!;
    return resolveDefinitionAction(
      state,
      action,
      {
        actorId,
        targetIds: [actorId === HERO ? MAGE : HERO],
        commandId: `50000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
        ...input
      },
      { ...deps, definition }
    );
  };
  const answer = (use: boolean, slotLevel?: number) => {
    const prompt = state.combat.pendingReactions[0]!;
    return answerReaction(
      state,
      `50000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
      prompt.id,
      use,
      undefined,
      GM,
      deps,
      slotLevel !== undefined ? { slotLevel } : {}
    );
  };
  const hero = state.actors.find((actor) => actor.id === HERO)!;
  const mage = state.actors.find((actor) => actor.id === MAGE)!;
  return { state, cast, answer, hero, mage };
}

const slotsOf = (actor: GameState["actors"][number], level: number) =>
  actor.spellSlots?.find((slot) => slot.level === level)?.remaining;

describe("a cast a Counterspell may stop", () => {
  it("waits for the mage's answer when the wizard casts Magic Missile, and spends nothing but the action", () => {
    const { state, cast, hero } = duel([]);
    const before = slotsOf(hero, 1);
    const resolution = cast(HERO, "spell-magic-missile");
    expect(resolution).toMatchObject({ waitingOnReaction: true, damageTotal: 0 });
    expect(resolution.reactionPrompts).toEqual([
      expect.objectContaining({ actorName: "Mage", actionName: "Counterspell" })
    ]);
    expect(state.combat.pendingReactions[0]).toMatchObject({ kind: "casts-spell", actorId: MAGE, sourceActorId: HERO });
    expect(state.combat.turn.actionUsed).toBe(true);
    expect(slotsOf(hero, 1)).toBe(before);
  });

  it("dissipates on the caster's failed Constitution save: no damage, and its slot isn't expended", () => {
    const { state, cast, answer, hero, mage } = duel([1]);
    const before = slotsOf(hero, 1);
    cast(HERO, "spell-magic-missile");
    const outcome = answer(true);
    expect(outcome).toMatchObject({ used: true, countered: true, appliedDamage: 0 });
    expect(outcome.events[0]?.text).toMatch(/^Ansel's spell dissipates \(Constitution save \d+ against DC 14\)/);
    expect(mage.hp.current).toBe(81);
    expect(slotsOf(hero, 1)).toBe(before);
    expect(state.combat.pendingReactions).toEqual([]);
    // The mage's Reaction and a use of Protective Magic are spent.
    expect(state.combat.reactionsUsed).toContain(MAGE);
    expect(mage.actionUses["protective-magic"]).toBe(1);
  });

  it("goes ahead when the caster's save succeeds, spending its slot and dealing its damage", () => {
    const { cast, answer, hero, mage } = duel([20, 2, 2, 2]);
    const before = slotsOf(hero, 1)!;
    cast(HERO, "spell-magic-missile");
    const outcome = answer(true);
    expect(outcome).toMatchObject({ used: true, countered: false });
    expect(outcome.resolution?.actionName).toBe("Magic Missile");
    expect(slotsOf(hero, 1)).toBe(before - 1);
    // Three darts of 1d4 + 1, each a 2: 9 Force damage.
    expect(mage.hp.current).toBe(72);
  });

  it("goes ahead when the reactor lets it go", () => {
    const { cast, answer, hero, state } = duel([2, 2, 2]);
    const before = slotsOf(hero, 1)!;
    cast(HERO, "spell-magic-missile");
    const outcome = answer(false);
    expect(outcome).toMatchObject({ used: false });
    expect(slotsOf(hero, 1)).toBe(before - 1);
    expect(state.combat.reactionsUsed).not.toContain(MAGE);
  });

  it("is offered to a character with Counterspell, a slot and its Reaction, who picks the slot", () => {
    const { state, cast, answer, hero } = duel([1], { mageFirst: true });
    const fireball = effectiveActions(library.monsterForInstance("mage")!, state.actors[0], catalog).find(
      (action) => action.spellId === "fireball"
    )!;
    cast(MAGE, fireball.id);
    expect(state.combat.pendingReactions[0]).toMatchObject({ kind: "casts-spell", actorId: HERO, slotLevels: [3] });
    expect(state.combat.pendingSaves).toEqual([]);
    answer(true, 3);
    expect(slotsOf(hero, 3)).toBe(1);
    // The Fireball dissipated: nobody owes its save.
    expect(state.combat.pendingSaves).toEqual([]);
  });

  it("meets Magic Resistance with Advantage on the caster's save", () => {
    // The archmage rolls 1 and 20 and keeps the 20, so its Lightning Bolt goes ahead.
    const { state, cast, answer } = duel([1, 20], { mageFirst: true, monster: "archmage" });
    cast(MAGE, "spellcasting-lightning-bolt");
    const outcome = answer(true, 3);
    expect(outcome).toMatchObject({ used: true, countered: false });
    expect(state.rolls.find((roll) => roll.label === "Constitution save against Counterspell")).toMatchObject({
      dice: [expect.objectContaining({ face: 20 })]
    });
  });

  it("isn't offered once the reactor's Reaction is spent", () => {
    const { state, cast } = duel([]);
    state.combat = { ...state.combat, reactionsUsed: [MAGE] };
    const resolution = cast(HERO, "spell-magic-missile");
    expect(resolution.waitingOnReaction).toBeUndefined();
    expect(state.combat.pendingReactions).toEqual([]);
  });
});

describe("a reaction spell's slot", () => {
  it("spends the slot the answer picks for Shield", () => {
    const { state, cast, answer, hero } = duel([8], { mageFirst: true });
    // The mage's Arcane Burst (+6) rolls 8 + 6 = 14, which hits the wizard's AC 12 and misses once Shield adds 5.
    cast(MAGE, "arcane-burst");
    const prompt = state.combat.pendingReactions[0]!;
    expect(prompt).toMatchObject({ kind: "attack-would-hit", actorId: HERO, slotLevels: [1, 2, 3] });
    const level2 = slotsOf(hero, 2)!;
    answer(true, 2);
    expect(slotsOf(hero, 2)).toBe(level2 - 1);
    expect(hero.hp.current).toBe(hero.hp.maximum);
  });
});

describe("what a Counterspell sees cast", () => {
  it("sees a spell read from a Spell Scroll, which crumbles whether or not it goes ahead", () => {
    const { state, cast, answer, hero } = duel([1]);
    hero.inventory = [...hero.inventory, catalogRow("spell-scroll", { equipped: false, spellId: "magic-missile" })];
    const resolution = cast(HERO, "item-spell-scroll-read");
    expect(resolution.waitingOnReaction).toBe(true);
    expect(state.combat.pendingReactions[0]).toMatchObject({ kind: "casts-spell", actorId: MAGE });
    expect(hero.inventory.some((row) => row.id === "spell-scroll")).toBe(false);
    expect(answer(true)).toMatchObject({ countered: true });
  });

  it("doesn't see a spell cast from a wand, which needs no components", () => {
    const { state, cast, hero } = duel([2, 2, 2]);
    hero.inventory = [...hero.inventory, catalogRow("wand-of-magic-missiles", { attuned: true })];
    const wand = effectiveActions(wizard, hero, catalog).find(
      (action) => action.spellId === "magic-missile" && action.id.startsWith("item-wand")
    )!;
    const resolution = cast(HERO, wand.id);
    expect(resolution.waitingOnReaction).toBeUndefined();
    expect(state.combat.pendingReactions).toEqual([]);
  });

  it("sees a spell cast to be held with the Ready action, and holds it once it goes ahead", () => {
    const { cast, answer, hero } = duel([]);
    const before = slotsOf(hero, 1)!;
    const resolution = cast(HERO, "spell-magic-missile", { ready: true, targetIds: [] });
    expect(resolution.waitingOnReaction).toBe(true);
    expect(slotsOf(hero, 1)).toBe(before);
    answer(false);
    expect(hero.effects.map((effect) => effect.name)).toContain("Readied: Magic Missile");
    expect(slotsOf(hero, 1)).toBe(before - 1);
  });

  it("doesn't see a readied spell's release, which was cast already", () => {
    const { state, cast, answer } = duel([2, 2, 2]);
    cast(HERO, "spell-magic-missile", { ready: true, targetIds: [] });
    answer(false);
    nextInitiativeTurn(state);
    const release = cast(HERO, "spell-magic-missile");
    expect(release.waitingOnReaction).toBeUndefined();
    expect(state.combat.pendingReactions).toEqual([]);
  });

  it("sees a long casting as it begins, and not again as it ends", () => {
    const { state, cast, answer, hero } = duel([20]);
    const first = cast(HERO, "spell-alarm", { targetIds: [] });
    expect(first.waitingOnReaction).toBe(true);
    expect(hero.effects.some((effect) => effect.longCast)).toBe(false);
    answer(true);
    const casting = hero.effects.find((effect) => effect.longCast);
    expect(casting?.longCast).toMatchObject({ actionId: "spell-alarm", turnsLeft: 9, slotLevel: 1 });
    expect(state.combat.pendingReactions).toEqual([]);
    casting!.longCast = { ...casting!.longCast!, turnsLeft: 1 };
    nextInitiativeTurn(state);
    nextInitiativeTurn(state);
    state.combat = { ...state.combat, reactionsUsed: [] };
    const last = cast(HERO, "spell-alarm", { targetIds: [] });
    expect(last.waitingOnReaction).toBeUndefined();
    expect(hero.effects.some((effect) => effect.longCast)).toBe(false);
  });

  it("stops a long casting on its first turn, with no slot spent", () => {
    const { cast, answer, hero } = duel([1]);
    const before = slotsOf(hero, 1)!;
    cast(HERO, "spell-alarm", { targetIds: [] });
    expect(answer(true)).toMatchObject({ countered: true });
    expect(hero.effects.some((effect) => effect.longCast)).toBe(false);
    expect(slotsOf(hero, 1)).toBe(before);
  });
});
