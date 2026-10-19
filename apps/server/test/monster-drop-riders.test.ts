import { describe, expect, it } from "vitest";
import { isDead } from "@vtt/domain";
import { addEffect, makeEffect } from "../src/effects.js";
import { passGameTime } from "../src/game-time.js";
import { liveAbilityScores } from "../src/live-abilities.js";
import { ABILITY_DRAIN_TAG } from "../src/resolution/score-drain.js";
import { actor, conditionsOf, damage, IDS, table, use } from "./monster-table.js";

// What a stat-block hit does to its target beyond the damage (SRD 5.2.1): a phase spider's Bite and a vampire familiar's
// Umbral Dagger leave a target they drop to 0 Hit Points Stable, Poisoned for 1 hour and Paralyzed while Poisoned, and a
// shadow's Draining Swipe lowers Strength, killing at 0.

const drainOf = (built: ReturnType<typeof table>, actionId: string) =>
  built.definition.actions.find((action) => action.id === actionId)!.drain;

describe("damage that leaves its target Stable at 0 Hit Points", () => {
  it("leaves a hero a phase spider's Bite drops Stable, Poisoned and Paralyzed for an hour", () => {
    const built = table("phase-spider", { heroHp: 5 });
    const outcome = damage(built, IDS.hero, 12, "piercing", {
      sourceActorId: IDS.monster,
      sourceName: "Phase Spider",
      drain: drainOf(built, "bite")
    });
    const hero = actor(built, IDS.hero);
    expect(outcome.application.droppedToZero).toBe(true);
    expect(hero.hp.current).toBe(0);
    expect(hero.deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
    expect(isDead(hero)).toBe(false);
    expect(conditionsOf(built, IDS.hero).sort()).toEqual(["paralyzed", "poisoned", "prone", "unconscious"]);
    expect(hero.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          linkedConditionIds: ["poisoned", "paralyzed"],
          duration: { type: "minutes", remaining: 60 }
        })
      ])
    );
  });

  it("keeps a monster a vampire familiar's Umbral Dagger drops alive, Unconscious at 0 Hit Points", () => {
    const built = table("vampire-familiar", { allySlug: "goblin-warrior" });
    actor(built, IDS.ally).hp = { ...actor(built, IDS.ally).hp, current: 4 };
    damage(built, IDS.ally, 9, "necrotic", {
      sourceActorId: IDS.monster,
      sourceName: "Vampire Familiar",
      drain: drainOf(built, "umbral-dagger")
    });
    const goblin = actor(built, IDS.ally);
    expect(isDead(goblin)).toBe(false);
    expect(conditionsOf(built, IDS.ally)).toEqual(expect.arrayContaining(["poisoned", "paralyzed", "unconscious"]));
  });

  it("lets the poison wear off after an hour of game time, and the target wakes once its 1d4 hours pass", () => {
    const built = table("phase-spider", { heroHp: 5 });
    built.state.combat = { ...built.state.combat, active: false };
    damage(built, IDS.hero, 12, "piercing", {
      sourceActorId: IDS.monster,
      sourceName: "Phase Spider",
      drain: drainOf(built, "bite")
    });
    passGameTime(built.state, 60, { resolveDefinition: built.resolveDefinition, random: () => 2 });
    expect(conditionsOf(built, IDS.hero)).not.toContain("paralyzed");
    expect(conditionsOf(built, IDS.hero)).not.toContain("poisoned");
    passGameTime(built.state, 180, { resolveDefinition: built.resolveDefinition, random: () => 2 });
    expect(actor(built, IDS.hero).hp.current).toBe(1);
  });
});

describe("a shadow's Draining Swipe", () => {
  const strength = (built: ReturnType<typeof table>) =>
    liveAbilityScores(actor(built, IDS.hero), built.resolveDefinition("hero-def")!, undefined).str;

  it("lowers the target's Strength by 1d4 a hit, adding up, and the lower score is the one rules read", () => {
    const built = table("shadow");
    use(built, "draining-swipe", [IDS.hero], [15, 3, 3]);
    expect(strength(built)).toBe(11);
    built.state.combat = {
      ...built.state.combat,
      turn: { ...built.state.combat.turn, actionUsed: false, actionInstance: null }
    };
    use(built, "draining-swipe", [IDS.hero], [15, 3, 2]);
    expect(strength(built)).toBe(9);
    expect(actor(built, IDS.hero).effects).toMatchObject([
      { name: "Strength drained by 5", abilityReduction: { ability: "str", amount: 5 } }
    ]);
  });

  it("kills the target whose Strength it takes to 0", () => {
    const built = table("shadow");
    addEffect(
      built.state,
      IDS.hero,
      makeEffect({
        id: "drained",
        name: "Strength drained by 12",
        tags: [ABILITY_DRAIN_TAG],
        duration: { type: "manual" },
        abilityReduction: { ability: "str", amount: 12 }
      })
    );
    use(built, "draining-swipe", [IDS.hero], [15, 3, 3]);
    expect(isDead(actor(built, IDS.hero))).toBe(true);
  });
});
