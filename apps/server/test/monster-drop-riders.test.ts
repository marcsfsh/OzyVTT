import { describe, expect, it } from "vitest";
import { isDead } from "@vtt/domain";
import { passGameTime } from "../src/game-time.js";
import { actor, conditionsOf, damage, IDS, table } from "./monster-table.js";

// What a stat-block hit does as its damage drops the target to 0 Hit Points (SRD 5.2.1): a phase spider's Bite and a
// vampire familiar's Umbral Dagger leave the target Stable, Poisoned for 1 hour and Paralyzed while Poisoned.

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
    passGameTime(built.state, 60, { resolveDefinition: built.resolveDefinition });
    expect(conditionsOf(built, IDS.hero)).not.toContain("paralyzed");
    expect(conditionsOf(built, IDS.hero)).not.toContain("poisoned");
    passGameTime(built.state, 180, { resolveDefinition: built.resolveDefinition });
    expect(actor(built, IDS.hero).hp.current).toBe(1);
  });
});
