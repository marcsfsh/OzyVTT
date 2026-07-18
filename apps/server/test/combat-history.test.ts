import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameStore, TimelineConfirmationRequired, CommandRejectedError } from "../src/game-store.js";
import { startEncounter, endEncounter } from "../src/encounter.js";
import { activateScene, createScene } from "../src/scenes.js";
import { removeActor } from "../src/actor-roster.js";
import { applyDamage } from "../src/hit-points.js";
import { planNextTurn, planPreviousTurn, timelineDirtied } from "../src/combat-history.js";

const PC = "10000000-0000-4000-8000-000000000001";
const MON = "10000000-0000-4000-8000-000000000002";
const MAP = "20000000-0000-5000-8000-000000000001";
const MAP2 = "20000000-0000-5000-8000-000000000002";
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const GM = { role: "gm" } as const;

function activeState(): GameState {
  const game = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: PC, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, ownerSessionId: null },
    { id: MON, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 } }
  ] });
  // Turn order: Alpha (20) then Goblin (10). Live from Alpha's turn, round 1.
  startEncounter(game, { mapAssetId: MAP, entries: [{ actorId: PC, score: 20 }, { actorId: MON, score: 10 }] }, () => 1, GEOMETRY);
  return game;
}

describe("turn time-travel timeline", () => {
  let directory: string;
  let store: GameStore;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "vtt-timeline-"));
    store = new GameStore(join(directory, "vtt.sqlite"), activeState(), { timelineDirtied });
    await store.initialize();
  });
  afterEach(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });

  const next = (confirmRewrite = false) => store.executeTimeline({ id: randomUUID(), type: "initiative.next" }, (state, timeline) => planNextTurn(state, timeline, confirmRewrite));
  const previous = (confirmDiscard = false) => store.executeTimeline({ id: randomUUID(), type: "initiative.previous" }, (state, timeline) => planPreviousTurn(state, timeline, confirmDiscard));

  it("captures a boundary and advances on a live Next", async () => {
    expect(store.snapshot.combat.turnActorId).toBe(PC);
    await next();
    expect(store.snapshot.combat.turnActorId).toBe(MON);
    expect(store.snapshot.combat.historyCursor).toBeNull();
    const history = store.listTurnSnapshots();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ index: 0, kind: "turn", label: "Round 1 — Alpha" });
  });

  it("rewinds the whole table to the end of the prior turn and resumes live without undoing anything", async () => {
    await next(); // capture Alpha's turn @0, now live on Goblin
    // Goblin takes damage during its (live) turn — this must survive a rewind-and-resume round trip.
    await store.execute({ id: randomUUID(), type: "actor.apply-damage", actorId: MON }, (state) => applyDamage(state, MON, 4, GM));
    expect(store.snapshot.actors.find((a) => a.id === MON)?.hp.current).toBe(6);

    await previous(); // park a return-point, restore Alpha's-turn snapshot (Goblin back to full)
    expect(store.snapshot.combat.turnActorId).toBe(PC);
    expect(store.snapshot.combat.historyCursor).toBe(0);
    expect(store.snapshot.actors.find((a) => a.id === MON)?.hp.current).toBe(10);
    const parked = store.listTurnSnapshots();
    expect(parked.map((entry) => entry.kind)).toEqual(["turn", "return"]);

    await next(); // reach the return-point → resume live exactly, nothing undone
    expect(store.snapshot.combat.turnActorId).toBe(MON);
    expect(store.snapshot.combat.historyCursor).toBeNull();
    expect(store.snapshot.actors.find((a) => a.id === MON)?.hp.current).toBe(6);
    expect(store.listTurnSnapshots().map((entry) => entry.kind)).toEqual(["turn"]); // return-point consumed
  });

  it("marks the timeline dirty only when a restorable change is made while rewound", async () => {
    await next();
    await previous(); // rewound at cursor 0
    expect(store.snapshot.combat.historyDirty).toBe(false);
    // A claim changes no restorable state (hp/conditions/combat are untouched) → stays clean.
    await store.execute({ id: randomUUID(), type: "character.claim", actorId: PC }, (state) => { const actor = state.actors.find((candidate) => candidate.id === PC); if (actor) actor.ownerSessionId = randomUUID(); });
    expect(store.snapshot.combat.historyDirty).toBe(false);
    // Damage changes actor hp → dirties.
    await store.execute({ id: randomUUID(), type: "actor.apply-damage", actorId: PC }, (state) => applyDamage(state, PC, 3, GM));
    expect(store.snapshot.combat.historyDirty).toBe(true);
  });

  it("requires confirmation to rewrite history, then truncates the undone future", async () => {
    await next(); // @0 captured, live on Goblin
    await next(); // @1 captured (Goblin's turn), wraps to Alpha round 2
    expect(store.listTurnSnapshots()).toHaveLength(2);
    await previous(); // return-point @2, rewound to @1 (Goblin's turn end)
    await previous(); // rewound to @0 (Alpha's turn end)
    expect(store.snapshot.combat.historyCursor).toBe(0);
    await store.execute({ id: randomUUID(), type: "actor.apply-damage", actorId: MON }, (state) => applyDamage(state, MON, 2, GM));
    expect(store.snapshot.combat.historyDirty).toBe(true);

    await expect(next(false)).rejects.toBeInstanceOf(TimelineConfirmationRequired);
    await expect(next(false)).rejects.toMatchObject({ confirm: "rewrite-history" });
    // The rejected attempts burned nothing — still rewound, still dirty.
    expect(store.snapshot.combat.historyCursor).toBe(0);
    expect(store.snapshot.combat.historyDirty).toBe(true);

    await next(true); // confirm the rewrite
    expect(store.snapshot.combat.historyCursor).toBeNull();
    expect(store.snapshot.combat.historyDirty).toBe(false);
    // Everything after the rewrite point is gone; a new boundary was captured at the freed index.
    const history = store.listTurnSnapshots();
    expect(history).toHaveLength(1);
    expect(history[0].index).toBe(0);
  });

  it("discards an in-place change on a confirmed Previous without moving the cursor", async () => {
    await next();
    await previous(); // rewound at 0
    await store.execute({ id: randomUUID(), type: "actor.apply-damage", actorId: PC }, (state) => applyDamage(state, PC, 5, GM));
    expect(store.snapshot.actors.find((a) => a.id === PC)?.hp.current).toBe(15);
    expect(store.snapshot.combat.historyDirty).toBe(true);

    await expect(previous(false)).rejects.toMatchObject({ confirm: "discard-changes" });
    await previous(true); // confirm discard → restore the viewed snapshot in place
    expect(store.snapshot.combat.historyCursor).toBe(0); // did NOT move further back
    expect(store.snapshot.combat.historyDirty).toBe(false);
    expect(store.snapshot.actors.find((a) => a.id === PC)?.hp.current).toBe(20); // change undone
  });

  it("rejects at the beginning of the recorded fight", async () => {
    await next(); // @0
    await previous(); // rewound at 0 (the only boundary)
    await expect(previous(false)).rejects.toBeInstanceOf(CommandRejectedError);
  });

  it("blocks lifecycle commands that would strand the timeline while rewound", async () => {
    await next();
    await previous(); // rewound
    expect(() => endEncounter(store.snapshot)).toThrow(/reviewing the combat history/i);
    expect(() => removeActor(store.snapshot, MON)).toThrow(/reviewing the combat history/i);
    const withScene = store.snapshot;
    createScene(withScene, { sceneId: MAP2, name: "Ambush", mapAssetId: MAP2, combatantIds: [PC] }, GEOMETRY);
    expect(() => activateScene(withScene, MAP2, randomUUID())).toThrow(/reviewing the combat history/i);
  });

  it("persists the timeline across a store restart", async () => {
    await next();
    await previous(); // rewound, return-point on disk
    const cursor = store.snapshot.combat.historyCursor;
    store.close();
    const reopened = new GameStore(join(directory, "vtt.sqlite"), undefined, { timelineDirtied });
    await reopened.initialize();
    try {
      expect(reopened.snapshot.combat.historyCursor).toBe(cursor);
      expect(reopened.listTurnSnapshots().map((entry) => entry.kind)).toEqual(["turn", "return"]);
    } finally { reopened.close(); store = new GameStore(join(directory, "vtt.sqlite")); await store.initialize(); }
  });
});
