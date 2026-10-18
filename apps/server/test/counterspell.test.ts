import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { importActorDefinition, storedDefinition } from "../src/actor-roster.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { answerReaction } from "../src/reactions.js";
import { build, HERO, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 Counterspell: "You attempt to interrupt a creature in the process of casting a spell. The creature makes a
// Constitution saving throw. On a failed save, the spell dissipates with no effect, and the action, Bonus Action, or
// Reaction used to cast it is wasted. If that spell was cast with a spell slot, the slot isn't expended."

const library = new ContentLibrary();
const catalog = equipmentCatalogOf(library.forAudience("gm"));
const MAGE = "10000000-0000-4000-8000-000000000002";
const wizard = build(wizardInput(["counterspell", "shield", "magic-missile", "fireball"]));
const GM = { role: "gm" } as const;

/** The wizard (whose turn comes first unless `mageFirst`) against a Mage stat block. Dice come from `faces`. */
function duel(faces: number[], options: Readonly<{ mageFirst?: boolean }> = {}) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: MAGE, name: "Mage", kind: "monster", hp: { current: 81, maximum: 81 }, definitionId: "mage" }]
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
