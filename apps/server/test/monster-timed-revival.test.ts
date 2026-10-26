import { describe, expect, it } from "vitest";
import { isDead } from "@vtt/domain";
import { makeEffect } from "../src/effects.js";
import { carriedObjectEffects } from "../src/carried-objects.js";
import { damageObject } from "../src/objects.js";
import { applyRest, passTime } from "../src/rests.js";
import { RulesBlockedError } from "../src/game-store.js";
import { actor, answer, damage, definitionOf, IDS, NOW, nextId, table, use, type Table } from "./monster-table.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";

// SRD 5.2.1 creatures that come back on the game clock: a guardian naga returns in 1d6 days unless Dispel Evil and Good
// is cast on its remains, a lemure in 1d10 days unless its killer bore Bless or Holy Water touches its remains, a mummy
// lord in 24 hours while its heart is whole, a lich in 1d10 days while it has its spirit jar, and a spirit naga in 1d6
// days. A shadow's victim rises as a Shadow 1d4 hours later, and a troll's limb that lives a day may become a Troll.

const clock = (built: Table, faces: number[] = []) => ({
  // The bundled stat blocks a rise or a spawn brings, beside the table's own.
  resolveDefinition: (id: string) => built.resolveDefinition(id) ?? definitionOf(id),
  random: () => faces.shift() ?? 1
});
const slay = (built: Table, id = IDS.monster, sourceActorId: string = IDS.hero) =>
  damage(built, id, 500, "slashing", { sourceActorId });
const gmLines = (events: ReadonlyArray<{ text: string; gmOnly?: true }>) =>
  events.filter((event) => event.gmOnly).map((event) => event.text);

describe("a restoration on the game clock", () => {
  it("brings a guardian naga back with all its Hit Points once its days have passed", () => {
    const built = table("guardian-naga");
    const { events } = slay(built);
    expect(isDead(actor(built, IDS.monster))).toBe(true);
    // The test's dice show 2: two days.
    expect(gmLines(events)).toContain(
      "Guardian Naga returns to life in 2 days of game time (Celestial Restoration), unless Dispel Evil and Good is cast on its remains."
    );
    passTime(built.state, 47, 0, clock(built));
    expect(isDead(actor(built, IDS.monster))).toBe(true);
    const back = passTime(built.state, 1, 0, clock(built));
    expect(actor(built, IDS.monster).hp.current).toBe(actor(built, IDS.monster).hp.maximum);
    expect(actor(built, IDS.monster).death).toBeUndefined();
    expect(gmLines(back)).toContain(
      "Guardian Naga returns to life with all its Hit Points (Celestial Restoration). Place it where its stat block says."
    );
  });

  it("leaves a lemure dead when its killer bore Bless", () => {
    const built = table("lemure");
    actor(built, IDS.hero).effects.push(
      makeEffect({
        id: "bless",
        name: "Bless",
        duration: { type: "rounds", remaining: 10 },
        spell: { id: "bless", level: 1 }
      })
    );
    slay(built);
    expect(actor(built, IDS.monster).death?.returns).toBeUndefined();
    passTime(built.state, 24 * 30, 0, clock(built));
    expect(isDead(actor(built, IDS.monster))).toBe(true);
  });

  it("leaves a mummy lord dead when its heart is destroyed, which only Fire harms", () => {
    const built = table("mummy-lord");
    actor(built, IDS.monster).effects.push(
      ...carriedObjectEffects(IDS.monster, "Mummy Lord", definitionOf("mummy-lord"))
    );
    slay(built);
    const ref = { actorId: IDS.monster, effectId: `${IDS.monster}:carried:heart` };
    expect(damageObject(built.state, ref, [{ amount: 50, type: "slashing" }]).hitPointsLeft).toBe(10);
    const burned = damageObject(built.state, ref, [{ amount: 12, type: "fire" }]);
    expect(burned.destroyed).toBe(true);
    expect(burned.events.map((event) => event.text)).toContain("Mummy Lord's Heart is destroyed.");
    const later = passTime(built.state, 24, 0, clock(built));
    expect(isDead(actor(built, IDS.monster))).toBe(true);
    expect(gmLines(later)).toContain("Mummy Lord doesn't return (Undead Restoration): its heart is gone.");
  });

  it("brings a mummy lord back in 24 hours while its heart is whole", () => {
    const built = table("mummy-lord");
    actor(built, IDS.monster).effects.push(
      ...carriedObjectEffects(IDS.monster, "Mummy Lord", definitionOf("mummy-lord"))
    );
    slay(built);
    passTime(built.state, 24, 0, clock(built));
    expect(isDead(actor(built, IDS.monster))).toBe(false);
  });

  it("brings a lich back only while it has a spirit jar", () => {
    const jarless = table("lich");
    slay(jarless);
    passTime(jarless.state, 24 * 10, 0, clock(jarless));
    expect(isDead(actor(jarless, IDS.monster))).toBe(true);
    const kept = table("lich");
    actor(kept, IDS.monster).effects.push(...carriedObjectEffects(IDS.monster, "Lich", definitionOf("lich")));
    slay(kept);
    passTime(kept.state, 24 * 10, 0, clock(kept));
    expect(isDead(actor(kept, IDS.monster))).toBe(false);
  });

  it("brings a spirit naga back in its 1d6 days", () => {
    const built = table("spirit-naga");
    slay(built);
    passTime(built.state, 48, 0, clock(built));
    expect(isDead(actor(built, IDS.monster))).toBe(false);
  });

  it("stops a guardian naga's return when Dispel Evil and Good is cast on its remains", () => {
    const built = table("guardian-naga");
    slay(built);
    built.state.combat = { ...built.state.combat, turnActorId: IDS.ally };
    const cast = {
      id: "spellcasting-dispel-evil-and-good",
      name: "Dispel Evil and Good",
      activation: "action" as const,
      description: "The caster casts Dispel Evil and Good.",
      damage: [],
      spellId: "dispel-evil-and-good"
    };
    const { events } = { events: [] };
    void events;
    resolveDefinitionAction(
      built.state,
      cast,
      { actorId: IDS.ally, targetIds: [], commandId: nextId() },
      {
        random: () => 3,
        newRollId: nextId,
        gmSessionId: IDS.gm,
        now: NOW,
        resolveDefinition: built.resolveDefinition,
        distanceFeet: () => 5
      }
    );
    expect(actor(built, IDS.monster).death?.returns).toBeUndefined();
    passTime(built.state, 24 * 7, 0, clock(built));
    expect(isDead(actor(built, IDS.monster))).toBe(true);
  });
});

describe("a shadow's Draining Swipe", () => {
  it("raises a Shadow from a Humanoid it slew, 1d4 hours later and on no one's side", () => {
    const built = table("shadow");
    built.resolveDefinition("hero-def")!.abilityScores.str = 1;
    (built.resolveDefinition("hero-def") as { type?: string }).type = "humanoid";
    use(built, "draining-swipe", [IDS.hero], [19, 3, 4]);
    const hero = actor(built, IDS.hero);
    expect(isDead(hero) || hero.death !== undefined).toBe(true);
    expect(hero.death?.rises?.monsterId).toBe("shadow");
    const before = built.state.actors.length;
    passTime(built.state, 4, 0, clock(built));
    expect(built.state.actors.length).toBe(before + 1);
    const shadow = built.state.actors.at(-1)!;
    expect(shadow.control).toBeUndefined();
  });
});

describe("a troll limb's Troll Spawn", () => {
  function limb(face: number) {
    const built = table("troll-limb");
    const events = passTime(built.state, 1, 0, clock(built, [face]));
    return { built, events, later: () => passTime(built.state, 24, 0, clock(built, [face])) };
  }

  it("becomes a Troll on a 12 once it has lived 24 hours", () => {
    const { built, later } = limb(12);
    const before = built.state.actors.length;
    later();
    expect(built.state.actors.length).toBe(before + 1);
    expect(built.state.actors.at(-1)!.name).toMatch(/Troll/);
    expect(isDead(actor(built, IDS.monster))).toBe(true);
  });

  it("withers away on anything else", () => {
    const { built, later } = limb(5);
    const before = built.state.actors.length;
    const events = later();
    expect(built.state.actors.length).toBe(before);
    expect(isDead(actor(built, IDS.monster))).toBe(true);
    expect(events.map((event) => event.text)).toContain("Troll Limb withers away.");
  });
});

describe("carried objects", () => {
  it("refuse a night hag's Nightmare Haunting once its soul bag is destroyed", () => {
    const built = table("night-hag");
    actor(built, IDS.monster).effects.push(
      ...carriedObjectEffects(IDS.monster, "Night Hag", definitionOf("night-hag"))
    );
    const ref = { actorId: IDS.monster, effectId: `${IDS.monster}:carried:soul-bag` };
    // Resistance to all damage: 50 Slashing is 25, and the bag has 20.
    expect(damageObject(built.state, ref, [{ amount: 30, type: "slashing" }]).hitPointsLeft).toBe(5);
    damageObject(built.state, ref, [{ amount: 30, type: "fire" }]);
    expect(() => use(built, "nightmare-haunting", [IDS.hero])).toThrow(RulesBlockedError);
  });

  it("hold an erinyes's target with its magic rope's own Hit Points, which a rest restores", () => {
    const built = table("erinyes");
    actor(built, IDS.monster).effects.push(...carriedObjectEffects(IDS.monster, "Erinyes", definitionOf("erinyes")));
    use(built, "entangling-rope", [IDS.hero]);
    const pending = built.state.combat.pendingSaves.find((save) => save.targetActorId === IDS.hero)!;
    expect(pending.onFailEffect?.heldBy?.name).toBe("Magic Rope");
    answer(built, IDS.hero, 1);
    const hold = actor(built, IDS.hero).effects.find((effect) => effect.heldBy?.name === "Magic Rope")!;
    damageObject(built.state, { actorId: IDS.hero, effectId: hold.id }, [{ amount: 30, type: "slashing" }]);
    const rope = () =>
      actor(built, IDS.monster).effects.find((effect) => effect.id === `${IDS.monster}:carried:magic-rope`)!;
    expect(rope().heldBy?.hitPoints.current).toBe(60);
    // Destroyed, it frees its target and can't be thrown until a rest restores it.
    damageObject(built.state, { actorId: IDS.monster, effectId: rope().id }, [{ amount: 60, type: "slashing" }]);
    expect(actor(built, IDS.hero).effects.some((effect) => effect.heldBy?.name === "Magic Rope")).toBe(false);
    built.state.combat = { ...built.state.combat, turn: { ...built.state.combat.turn, actionUsed: false } };
    expect(() => use(built, "entangling-rope", [IDS.hero])).toThrow(RulesBlockedError);
    built.state.combat = { ...built.state.combat, active: false };
    applyRest(built.state, IDS.monster, "short", built.resolveDefinition);
    expect(rope().heldBy?.hitPoints.current).toBe(90);
  });
});
