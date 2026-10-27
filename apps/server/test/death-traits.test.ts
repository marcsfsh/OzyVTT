import { describe, expect, it } from "vitest";
import { GameStateSchema, isDead, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { EffectNarration } from "../src/effects.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed, healActor } from "../src/hit-points.js";
import { endOfTurn } from "../src/turn-boundaries.js";

// SRD 5.2.1 monsters that cheat death or come apart. Misty Escape: "If the vampire drops to 0 Hit Points outside its
// resting place, the vampire uses Shape-Shift to become mist." Multiple Heads: "Whenever the hydra takes 25 damage or
// more on a single turn, one of its heads dies ... At the end of each of its turns ... the hydra grows two heads for each
// of its heads that died since its last turn, unless it has taken Fire damage since its last turn. The hydra regains 20
// Hit Points when it grows new heads." Loathsome Limbs: "If the troll ends any turn Bloodied and took 15+ Slashing
// damage during that turn, one of the troll's limbs is severed ... and becomes a Troll Limb." Diabolical Restoration:
// "its body disappears in sulfurous smoke, and it gains a new body".

const MONSTERS = loadMonsterDefinitions();
const monster = (slug: string) => MONSTERS.find((entry) => entry.source.externalId === slug)!;
const CREATURE = "10000000-0000-4000-8000-000000000a01";
const HERO = "10000000-0000-4000-8000-000000000a02";

/** The monster `slug` in a fight with a hero, the monster's turn first. */
function fight(slug: string) {
  const definition = monster(slug);
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: CREATURE,
        name: definition.name,
        kind: "monster",
        visibility: "public",
        hp: { current: definition.hitPoints.maximum, maximum: definition.hitPoints.maximum },
        definitionId: slug
      },
      { id: HERO, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 40, maximum: 40 } }
    ]
  }) as GameState;
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000a01",
      entries: [
        { actorId: CREATURE, score: 20 },
        { actorId: HERO, score: 10 }
      ]
    },
    () => 1,
    { width: 900, height: 600, calibration: null }
  );
  const creature = state.actors.find((actor) => actor.id === CREATURE)!;
  return { state, creature, definition };
}

const resolveDefinition = (id: string) => monster(id);
const deps = { resolveDefinition, newId: () => crypto.randomUUID(), now: () => "2026-10-19T00:00:00.000Z" };
const hit = (state: GameState, amount: number, type: string) =>
  applyDamageDetailed(state, CREATURE, { amount: 0, parts: [{ amount, type }] }, { role: "gm" }, deps);
const turnEnds = (state: GameState, actorId: string) => {
  const events: EffectNarration[] = [];
  endOfTurn(state, actorId, events, { ...deps, rollDie: () => 3 });
  return events.map((event) => event.text);
};

describe("a vampire's Misty Escape", () => {
  it("leaves it alive as mist at 0 Hit Points, which healing ends", () => {
    const { state, creature } = fight("vampire");
    const outcome = hit(state, creature.hp.maximum, "slashing");
    expect(creature.hp.current).toBe(0);
    expect(isDead(creature)).toBe(false);
    expect(creature.effects.map((effect) => effect.name)).toEqual(["Mist at 0 HP (Misty Escape)"]);
    expect(outcome.events.map((event) => event.text).join(" ")).toMatch(/escapes as mist/);
    healActor(state, CREATURE, 5, { role: "gm" });
    expect(creature.effects).toEqual([]);
  });
});

describe("a Restoration trait", () => {
  it("tells the GM a pit fiend may come back, and its body is gone", () => {
    const { state, creature } = fight("pit-fiend");
    const outcome = hit(state, creature.hp.maximum, "radiant");
    expect(isDead(creature)).toBe(true);
    expect(outcome.events.find((event) => /may come back/.test(event.text))).toMatchObject({ gmOnly: true });
    expect(creature.death).toMatchObject({ cause: "Diabolical Restoration", bodyGone: true });
  });
});

describe("a hydra's Multiple Heads", () => {
  it("loses a head to 25 damage in a turn, bites once per head, and grows two back with 20 Hit Points", () => {
    const { state, creature, definition } = fight("hydra");
    hit(state, 15, "slashing");
    expect(creature.actionUses["multiple-heads:heads"]).toBeUndefined();
    const lost = hit(state, 12, "slashing");
    expect(lost.events.map((event) => event.text)).toContain(
      "One of Hydra's heads dies (Multiple Heads): 4 heads left."
    );
    // A second 25 in the same turn kills no second head.
    hit(state, 30, "slashing");
    expect(creature.actionUses["multiple-heads:heads"]).toBe(4);
    const multiattack = effectiveActions(definition, creature, undefined).find((action) => action.id === "multiattack");
    expect(multiattack?.multiattack).toEqual([{ actionId: "bite", count: 4 }]);
    const before = creature.hp.current;
    expect(turnEnds(state, CREATURE)).toContain(
      "Hydra grows 2 heads (6 now) and regains 20 hit points (Multiple Heads)."
    );
    expect(creature.hp.current).toBe(before + 20);
  });

  it("grows none after Fire damage, and dies with its last head", () => {
    const { state, creature } = fight("hydra");
    hit(state, 26, "fire");
    expect(turnEnds(state, CREATURE).join(" ")).toMatch(/grows no heads this turn: it took fire damage/);
    expect(creature.actionUses["multiple-heads:heads"]).toBe(4);
    creature.actionUses = { ...creature.actionUses, "multiple-heads:heads": 1 };
    state.combat = { ...state.combat, turn: { ...state.combat.turn, turnUses: {} } };
    hit(state, 25, "slashing");
    expect(isDead(creature)).toBe(true);
  });
});

describe("a troll's Loathsome Limbs", () => {
  it("severs a limb from a Bloodied troll that took 15 Slashing this turn, which joins the encounter after it", () => {
    const { state, creature } = fight("troll");
    creature.hp = { ...creature.hp, current: 50 };
    hit(state, 18, "slashing");
    const lines = turnEnds(state, CREATURE);
    expect(lines.join(" ")).toMatch(
      /One of Troll's limbs is severed and becomes Troll Limb, which acts right after Troll/
    );
    const order = state.combat.initiative.map(
      (entry) => state.actors.find((actor) => actor.id === entry.actorId)!.name
    );
    expect(order).toEqual(["Troll", "Troll Limb", "Hero"]);
    expect(creature.conditions).toEqual([{ id: "exhaustion", level: 1 }]);
    // "It grows replacement limbs the next time it regains Hit Points."
    healActor(state, CREATURE, 15, { role: "gm" });
    expect(creature.conditions).toEqual([]);
  });

  it("keeps its limbs when the Slashing was under 15 or it isn't Bloodied", () => {
    const { state, creature } = fight("troll");
    creature.hp = { ...creature.hp, current: 50 };
    hit(state, 10, "slashing");
    expect(turnEnds(state, CREATURE).join(" ")).not.toMatch(/severed/);
    const fresh = fight("troll");
    hit(fresh.state, 20, "slashing");
    expect(turnEnds(fresh.state, CREATURE).join(" ")).not.toMatch(/severed/);
  });
});
