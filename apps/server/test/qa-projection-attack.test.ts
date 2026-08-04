import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameStateSchema, type CombatLogEntry, type GameState, type RollRecord } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { CombatLogStore } from "../src/combat-log.js";
import { projectPlayerReplay } from "../src/replay-projection.js";
import { startEncounter } from "../src/encounter.js";
import type { EncounterArchiveDocument } from "../src/encounter-archive.js";

/**
 * QA — ADVERSARIAL PROJECTION ATTACK (director's own pass, 2026-08-04).
 *
 * The implementers wrote the happy-path safety tests. These are the attacks: the cases someone hunting
 * a leak would try. Each asserts the CORRECT (safe) behaviour; a failure here is a real leak. They stay
 * in the suite as permanent armour whether or not they ever caught anything.
 */

const A_SESSION = "30000000-0000-4000-8000-0000000000a1";
const B_SESSION = "30000000-0000-4000-8000-0000000000b2";
const A_ACTOR = "10000000-0000-4000-8000-000000000001";
const B_ACTOR = "10000000-0000-4000-8000-000000000002";
const MAP = "20000000-0000-5000-8000-000000000001";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function store() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-qa-feed-"));
  const log = new CombatLogStore(join(directory, "vtt.sqlite"));
  await log.initialize();
  cleanups.push(async () => { log.close(); await rm(directory, { recursive: true, force: true }); });
  return log;
}

function roll(sessionId: string, actorId: string, visibility: RollRecord["visibility"]): RollRecord {
  return {
    id: randomUUID(), commandId: randomUUID(), initiatorSessionId: sessionId, initiatorRole: "player",
    initiatorLabel: "Someone", label: "secret", actorId, purpose: "attack", visibility,
    formula: "1d20", normalizedFormula: "1d20", dice: [{ group: 0, sides: 20, face: 9, kept: true, sign: 1 }],
    modifiers: [], total: 9, createdAt: new Date().toISOString()
  };
}

describe("QA attack — the one feed never hands a player another's die", () => {
  it("player A's read excludes player B's self-only roll, though both are gm_only=0", async () => {
    const log = await store();
    log.append({ kind: "roll", text: "A rolls in the open.", gmOnly: false, revision: 1, roll: roll(A_SESSION, A_ACTOR, "public") });
    log.append({ kind: "roll", text: "B rolls in secret.", gmOnly: false, revision: 2, roll: roll(B_SESSION, B_ACTOR, "self-only") });

    const forA = log.list(false, 250, A_SESSION);
    const forB = log.list(false, 250, B_SESSION);
    // A sees the public line and NOT B's secret; B sees both. The SQL prefilter passes both self-only
    // rows (gm_only=0) — the session check inside projectFeedRow is the thing that must hold.
    expect(forA.map((entry) => entry.text)).toEqual(["A rolls in the open."]);
    expect(forB.map((entry) => entry.text).sort()).toEqual(["A rolls in the open.", "B rolls in secret."]);
  });

  it("never serializes any roller's session id to a player, even on a public row", async () => {
    const log = await store();
    log.append({ kind: "roll", text: "A rolls.", gmOnly: false, revision: 1, roll: roll(A_SESSION, A_ACTOR, "public") });
    log.append({ kind: "roll", text: "B secret.", gmOnly: false, revision: 2, roll: roll(B_SESSION, B_ACTOR, "self-only") });
    const serialized = JSON.stringify(log.list(false, 250, A_SESSION));
    expect(serialized).not.toContain(A_SESSION);
    expect(serialized).not.toContain(B_SESSION);
    expect(serialized).not.toContain("initiatorSessionId");
  });

  it("keeps a blind roll (hidden from its own roller) out of every player read", async () => {
    const log = await store();
    // A blind roll is stored gm_only=1 by the writer; a player — even the roller — must never see it.
    log.append({ kind: "roll", text: "Blind roll.", gmOnly: true, revision: 1, roll: roll(A_SESSION, A_ACTOR, "blind") });
    expect(log.list(false, 250, A_SESSION)).toEqual([]);
    expect(log.list(false, 250, B_SESSION)).toEqual([]);
  });

  it("keeps a gm-only narration line out of a player read regardless of session", async () => {
    const log = await store();
    log.append({ kind: "action", text: "The lich's phylactery is behind the arras.", gmOnly: true, revision: 1 });
    expect(log.list(false, 250, A_SESSION)).toEqual([]);
    expect(log.list(true, 250)).toHaveLength(1); // the GM read still sees it
  });
});

/** One boundary state of a fight: the ambusher is hidden until `revealed`. */
function turnState(revealed: boolean): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: A_ACTOR, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 21, maximum: 30 }, ownerSessionId: A_SESSION, notes: "GM notes about Borin" },
    { id: B_ACTOR, name: "Shadow Stalker", kind: "monster", visibility: revealed ? "public" : "gm-only", hp: { current: 18, maximum: 40 }, notes: "Lairs in the rafters" }
  ] });
  startEncounter(state, { mapAssetId: MAP, entries: [{ actorId: A_ACTOR, score: 18 }, { actorId: B_ACTOR, score: 12 }] }, () => 1, { width: 900, height: 600, calibration: null });
  return state;
}

describe("QA attack — a player replay reveals nothing the player could not have seen", () => {
  function archive(): EncounterArchiveDocument {
    return {
      version: 3, commandId: randomUUID(), startedAt: "2026-07-01T20:00:00.000Z", endedAt: "2026-07-01T21:00:00.000Z",
      turnCount: 2, mapAssetId: MAP,
      turns: [
        { revision: 5, at: "2026-07-01T20:10:00.000Z", state: turnState(false) },
        { revision: 9, at: "2026-07-01T20:20:00.000Z", state: turnState(true) }
      ],
      log: [
        { id: 1, at: "2026-07-01T20:10:00.000Z", kind: "action", text: "Borin rolls in secret.", gmOnly: false, revision: 5,
          roll: { ...roll(B_SESSION, A_ACTOR, "self-only"), initiatorSessionId: undefined } as unknown as RollRecord } as CombatLogEntry,
        { id: 2, at: "2026-07-01T20:11:00.000Z", kind: "action", text: "The Shadow Stalker sharpens its claws in the dark.", gmOnly: true, revision: 5 },
        { id: 3, at: "2026-07-01T20:20:00.000Z", kind: "action", text: "Borin swings.", gmOnly: false, revision: 9 }
      ],
      journal: [{ commandId: "j-1", payload: { secret: "the whole plan" } }],
      finalState: turnState(true), postEncounterState: turnState(true),
      rolls: [roll(A_SESSION, A_ACTOR, "public"), roll(B_SESSION, B_ACTOR, "self-only")],
      definitions: {}
    } as unknown as EncounterArchiveDocument;
  }

  it("at the first turn the hidden monster is absent, and the GM-only line and journal never appear", () => {
    const serialized = JSON.stringify(projectPlayerReplay(3, archive()));
    // Nothing the GM was still holding at turn 1.
    expect(serialized).not.toContain("sharpens its claws"); // gm-only narration
    expect(serialized).not.toContain("the whole plan"); // journal payload
    expect(serialized).not.toContain("Lairs in the rafters"); // hidden actor's notes
    expect(serialized).not.toContain("GM notes about Borin"); // any actor notes
  });

  it("never carries a session id or the raw archive internals in any form", () => {
    const serialized = JSON.stringify(projectPlayerReplay(3, archive()));
    for (const forbidden of [A_SESSION, B_SESSION, "initiatorSessionId", "ownerSessionId", "journal", "finalState", "postEncounterState", "definitions"]) {
      expect(serialized, `player replay leaked ${forbidden}`).not.toContain(forbidden);
    }
  });
});
