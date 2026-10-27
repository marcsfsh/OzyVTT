import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { applyDamageDetailed } from "../src/hit-points.js";
import { stabilizeCreature, type StabilizeDeps } from "../src/stabilize.js";
import { bootServer } from "./boot-server.js";
import { catalog } from "./equipment-table.js";

// SRD 5.2.1 Stabilizing a Character: "You can take the Help action to try to stabilize a creature with 0 Hit Points,
// which requires a successful DC 10 Wisdom (Medicine) check." Healer's Kit: "stabilize an Unconscious creature that
// has 0 Hit Points without needing to make a Wisdom (Medicine) check." Spare the Dying: "The creature becomes Stable."

const torva = ActorDefinitionSchema.parse(loadActorFixture("torva-grimtusk"));
/** A cleric who knows Spare the Dying, Wisdom 16 and proficient in Medicine: +3 and Proficiency Bonus. */
const cleric = ActorDefinitionSchema.parse({
  ...JSON.parse(JSON.stringify(torva)),
  name: "Ilse",
  abilityScores: { ...torva.abilityScores, wis: 16 },
  proficiencies: { saves: [], skills: [{ id: "medicine", proficiency: "proficient" }] },
  spellcasting: { ability: "wis", spells: [{ id: "spare-the-dying", name: "Spare the Dying", level: 0 }] }
});
const MEDICINE = 3 + cleric.proficiencyBonus;

const HELPER = "10000000-0000-4000-8000-000000000001";
const DYING = "10000000-0000-4000-8000-000000000002";
const GOBLIN = "10000000-0000-4000-8000-000000000003";
const OWNER = "30000000-0000-4000-8000-00000000000b";
const dying = {
  hp: { current: 0, maximum: 30 },
  deathSaves: { successes: 1, failures: 2, stable: false },
  conditions: [{ id: "prone" }, { id: "unconscious" }]
};

function game(options: { helper?: Record<string, unknown>; target?: Record<string, unknown>; fight?: boolean } = {}) {
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: HELPER,
        name: "Ilse",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        definitionId: "import-ilse",
        ownerSessionId: OWNER,
        ...options.helper
      },
      { id: DYING, name: "Bryn", kind: "player-character", visibility: "public", ...dying, ...options.target },
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
    ],
    definitions: [{ id: "import-ilse", definition: cleric }]
  });
  if (options.fight)
    state.combat = {
      ...state.combat,
      active: true,
      round: 1,
      turnActorId: HELPER,
      initiative: [
        { actorId: HELPER, score: 15, tieBreaker: 0 },
        { actorId: GOBLIN, score: 12, tieBreaker: 0 },
        { actorId: DYING, score: 8, tieBreaker: 0 }
      ]
    };
  return state;
}

function deps(state: GameState, faces: number[] = [], distanceFeet?: number): StabilizeDeps {
  return {
    resolveDefinition: (definitionId) => state.definitions.find((entry) => entry.id === definitionId)?.definition,
    random: (sides) => {
      const face = faces.shift();
      // A creature made Stable rolls its 1d4 hours to 1 Hit Point; the tests here read none of it.
      if (face === undefined && sides === 4) return 1;
      if (face === undefined) throw new Error("die queue empty");
      return face;
    },
    newRollId: () => "20000000-0000-4000-8000-000000000001",
    now: () => "2026-10-16T12:00:00.000Z",
    sessionId: "30000000-0000-4000-8000-00000000000a",
    role: "gm",
    ...(distanceFeet === undefined ? {} : { distanceFeet: () => distanceFeet })
  };
}
const bryn = (state: GameState) => state.actors.find((actor) => actor.id === DYING)!;
const aid = (method: "medicine" | "healers-kit" | "spare-the-dying" | "gm", extra: Record<string, unknown> = {}) => ({
  targetId: DYING,
  method,
  ...(method === "gm" ? {} : { helperId: HELPER }),
  commandId: "40000000-0000-4000-8000-000000000001",
  ...extra
});

describe("first aid: a DC 10 Wisdom (Medicine) check", () => {
  it("stabilizes on a success, rolled on the server with the sheet's Medicine bonus", () => {
    const state = game();
    const outcome = stabilizeCreature(state, aid("medicine"), { role: "gm" }, deps(state, [10 - MEDICINE]));
    expect(outcome).toMatchObject({ stabilized: true, check: { natural: 10 - MEDICINE, total: 10, dc: 10 } });
    // Stable resets both counters and keeps the Unconscious.
    expect(bryn(state).deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
    expect(bryn(state).conditions.map((condition) => condition.id)).toContain("unconscious");
    const roll = state.rolls.at(-1)!;
    expect(roll).toMatchObject({ label: "Wisdom (Medicine)", purpose: "check", actorId: HELPER, total: 10 });
    expect(outcome.events.map((event) => event.text)).toEqual([
      "Ilse stabilized Bryn (Medicine 10 vs DC 10).",
      "Bryn regains 1 Hit Point in 1 hour of game time unless healed first."
    ]);
  });

  it("is made as every check is: Poisoned gives Disadvantage, and Exhaustion comes off once", () => {
    const poisoned = game({ helper: { conditions: [{ id: "poisoned" }] } });
    // Two d20s under Disadvantage: the lower one counts.
    const low = stabilizeCreature(poisoned, aid("medicine"), { role: "gm" }, deps(poisoned, [18, 9 - MEDICINE]));
    expect(low).toMatchObject({ stabilized: false, check: { natural: 9 - MEDICINE, total: 9 } });
    const tired = game({ helper: { conditions: [{ id: "exhaustion", level: 1 }] } });
    const outcome = stabilizeCreature(tired, aid("medicine"), { role: "gm" }, deps(tired, [12 - MEDICINE]));
    expect(outcome.check).toMatchObject({ natural: 12 - MEDICINE, total: 10 });
  });

  it("does nothing on a failure but say so", () => {
    const state = game();
    const outcome = stabilizeCreature(state, aid("medicine"), { role: "gm" }, deps(state, [9 - MEDICINE]));
    expect(outcome.stabilized).toBe(false);
    expect(bryn(state).deathSaves).toEqual({ successes: 1, failures: 2, stable: false });
    expect(outcome.events.at(-1)?.text).toBe("Ilse's first aid failed (Medicine 9 vs DC 10), and Bryn is still dying.");
  });

  it("wakes a creature knocked out, which a Healer's Kit can't", () => {
    const state = game({ target: { hp: { current: 30, maximum: 30 }, deathSaves: null, conditions: [] } });
    applyDamageDetailed(
      state,
      DYING,
      { amount: 30, nonlethal: true },
      { role: "gm" },
      {
        resolveDefinition: () => undefined,
        commandId: "50000000-0000-4000-8000-000000000001"
      }
    );
    expect(bryn(state).conditions.map((condition) => condition.id)).toContain("unconscious");
    expect(() => stabilizeCreature(state, aid("healers-kit"), { role: "gm" }, deps(state))).toThrow(
      /knocked out and isn't dying/
    );
    const outcome = stabilizeCreature(state, aid("medicine"), { role: "gm" }, deps(state, [15]));
    expect(outcome).toMatchObject({ woke: true, stabilized: false });
    expect(bryn(state).conditions.map((condition) => condition.id)).not.toContain("unconscious");
  });
});

describe("a Healer's Kit and Spare the Dying stabilize without a check", () => {
  it("spends one from the kit stack, and the last one takes the row", () => {
    const state = game({
      helper: { inventory: [{ id: "healers-kit", name: "Healer's Kit", quantity: 2, equipped: false }] }
    });
    expect(stabilizeCreature(state, aid("healers-kit"), { role: "gm" }, deps(state)).stabilized).toBe(true);
    expect(state.actors[0].inventory).toEqual([
      { id: "healers-kit", name: "Healer's Kit", quantity: 1, equipped: false, attuned: false }
    ]);
    const again = game({
      helper: { inventory: [{ id: "healers-kit", name: "Healer's Kit", quantity: 1, equipped: false }] }
    });
    stabilizeCreature(again, aid("healers-kit"), { role: "gm" }, deps(again));
    expect(again.actors[0].inventory).toEqual([]);
    const without = game();
    expect(() => stabilizeCreature(without, aid("healers-kit"), { role: "gm" }, deps(without))).toThrow(
      /has no Healer's Kit/
    );
  });

  it("spends a kit's ten uses before the kit is used up", () => {
    const state = game({
      helper: { inventory: [{ id: "healers-kit", name: "Healer's Kit", quantity: 2, equipped: false }] }
    });
    const first = stabilizeCreature(state, aid("healers-kit"), { role: "gm" }, { ...deps(state), catalog });
    expect(first.events[0]?.text).toBe("Ilse stabilized Bryn with a Healer's Kit (9 uses left in it).");
    expect(state.actors[0].actionUses["healers-kit-uses"]).toBe(1);
    for (let use = 2; use <= 10; use += 1) {
      bryn(state).deathSaves = { successes: 0, failures: 0, stable: false };
      stabilizeCreature(state, aid("healers-kit"), { role: "gm" }, { ...deps(state), catalog });
    }
    expect(state.actors[0].inventory.map((row) => [row.id, row.quantity])).toEqual([["healers-kit", 1]]);
    expect(state.actors[0].actionUses["healers-kit-uses"]).toBeUndefined();
  });

  it("finds a second carried kit by the record it copies, and uses that one", () => {
    const state = game({
      helper: {
        inventory: [
          { id: "rope-hempen", name: "Rope", quantity: 1, equipped: false },
          { id: "healers-kit-2", recordId: "healers-kit", name: "Healer's Kit", quantity: 3, equipped: false }
        ]
      }
    });
    expect(stabilizeCreature(state, aid("healers-kit"), { role: "gm" }, deps(state)).stabilized).toBe(true);
    expect(state.actors[0].inventory.map((row) => [row.id, row.quantity])).toEqual([
      ["rope-hempen", 1],
      ["healers-kit-2", 2]
    ]);
  });

  it("needs the cantrip known", () => {
    const state = game();
    expect(stabilizeCreature(state, aid("spare-the-dying"), { role: "gm" }, deps(state)).stabilized).toBe(true);
    const unknown = game({ helper: { definitionId: undefined } });
    expect(() => stabilizeCreature(unknown, aid("spare-the-dying"), { role: "gm" }, deps(unknown))).toThrow(
      /doesn't know Spare the Dying/
    );
  });
});

describe("who and what can be stabilized", () => {
  it("not the dead, not the stable, not someone with hit points", () => {
    const corpse = game({ target: { deathSaves: { successes: 0, failures: 3, stable: false } } });
    expect(() => stabilizeCreature(corpse, aid("gm"), { role: "gm" }, deps(corpse))).toThrow(/too late/);
    const stable = game({ target: { deathSaves: { successes: 0, failures: 0, stable: true } } });
    expect(() => stabilizeCreature(stable, aid("gm"), { role: "gm" }, deps(stable))).toThrow(/already stable/);
    const healthy = game({ target: { hp: { current: 5, maximum: 30 }, deathSaves: null, conditions: [] } });
    expect(() => stabilizeCreature(healthy, aid("gm"), { role: "gm" }, deps(healthy))).toThrow(/isn't dying/);
  });

  it("a player gives aid only with their own character, and only the GM rules it", () => {
    const state = game();
    const player = { role: "player" as const, sessionId: OWNER };
    expect(stabilizeCreature(state, aid("spare-the-dying"), player, deps(state)).stabilized).toBe(true);
    const other = game();
    expect(() =>
      stabilizeCreature(
        other,
        aid("spare-the-dying"),
        { role: "player", sessionId: "30000000-0000-4000-8000-00000000000c" },
        deps(other)
      )
    ).toThrow(/your own character/);
    expect(() => stabilizeCreature(other, aid("gm"), player, deps(other))).toThrow(/Only the GM/);
  });

  it("an Unconscious helper gives no aid", () => {
    const state = game({ helper: { conditions: [{ id: "unconscious" }] } });
    expect(() => stabilizeCreature(state, aid("spare-the-dying"), { role: "gm" }, deps(state))).toThrow(
      /Unconscious and can't give aid/
    );
  });
});

describe("in an encounter the aid is the helper's action", () => {
  it("spends the action on the helper's own turn, and a second aid that turn is refused", () => {
    const state = game({ fight: true });
    stabilizeCreature(state, aid("spare-the-dying"), { role: "gm" }, deps(state));
    expect(state.combat.turn.actionUsed).toBe(true);
    const next = game({ fight: true, target: { deathSaves: { successes: 0, failures: 1, stable: false } } });
    next.combat = { ...next.combat, turn: { ...next.combat.turn, actionUsed: true } };
    expect(() => stabilizeCreature(next, aid("spare-the-dying"), { role: "gm" }, deps(next))).toThrow(
      /already used an action/
    );
  });

  it("is refused off the helper's turn unless the GM overrides it", () => {
    const state = game({ fight: true });
    state.combat = { ...state.combat, turnActorId: GOBLIN };
    expect(() => stabilizeCreature(state, aid("spare-the-dying"), { role: "gm" }, deps(state))).toThrow(
      /Not your turn yet/
    );
    const outcome = stabilizeCreature(
      state,
      aid("spare-the-dying", { override: { reason: "Readied" } }),
      { role: "gm" },
      deps(state)
    );
    expect(outcome).toMatchObject({
      stabilized: true,
      overridden: { rule: "economy.not-your-turn", reason: "Readied" }
    });
  });

  it("first aid needs the helper beside the creature, and Spare the Dying its 15 feet", () => {
    const far = game({ fight: true });
    expect(() => stabilizeCreature(far, aid("medicine"), { role: "gm" }, deps(far, [15], 10))).toThrow(
      /needs Ilse alongside/
    );
    const spell = game({ fight: true });
    expect(() => stabilizeCreature(spell, aid("spare-the-dying"), { role: "gm" }, deps(spell, [], 20))).toThrow(
      /beyond Spare the Dying's 15 ft/
    );
    const near = game({ fight: true });
    expect(stabilizeCreature(near, aid("spare-the-dying"), { role: "gm" }, deps(near, [], 15)).stabilized).toBe(true);
  });
});

describe("over the API", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("a player stabilizes an ally with their own character, and the reply carries the outcome", async () => {
    const { server, gmToken, post, close } = await bootServer(game({ helper: { ownerSessionId: null } }));
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    expect((await post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: HELPER })).status).toBe(200);
    const path = GAME_PATHS.actorStabilize.replace("{actorId}", DYING);
    const ruled = await post(path, player, { commandId: randomUUID(), method: "gm" });
    expect(ruled.status).toBe(403);
    const missingHelper = await post(path, gmToken, { commandId: randomUUID(), method: "medicine" });
    expect(missingHelper.status).toBe(400);
    const cast = await post(path, player, { commandId: randomUUID(), method: "spare-the-dying", helperId: HELPER });
    expect(cast.status).toBe(200);
    expect((await cast.json()).data).toMatchObject({ stabilize: { stabilized: true, woke: false, check: null } });
    expect(server.store.snapshot.actors[1].deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
  });
});
