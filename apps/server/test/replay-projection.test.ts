import { describe, expect, it } from "vitest";
import { GameStateSchema, type CombatLogEntry, type GameState, type RollRecord } from "@vtt/domain";
import { projectPlayerReplay } from "../src/replay-projection.js";
import { startEncounter } from "../src/encounter.js";
import type { EncounterArchiveDocument } from "../src/encounter-archive.js";

/**
 * VIEWER SAFETY: the player's replay (D26).
 *
 * A replay must show a player exactly what they could have seen AT EACH MOMENT of that fight - and
 * nothing the GM was still holding back then, nothing another player rolled privately, and no
 * session id ever. The last one is asserted at the STRING level over the serialized document,
 * because a key-by-key assertion only proves the keys someone thought to name.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  ambusher: "10000000-0000-4000-8000-000000000002",
  heroSession: "30000000-0000-4000-8000-0000000000aa",
  otherSession: "30000000-0000-4000-8000-0000000000bb",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/** One boundary state: the ambusher is hidden until `revealed`. */
function turnState(revealed: boolean, current: "hero" | "ambusher"): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Borin", kind: "player-character", visibility: "public", hp: { current: 21, maximum: 30 }, ownerSessionId: IDS.heroSession, notes: "GM notes about Borin" },
    { id: IDS.ambusher, name: "Shadow Stalker", kind: "monster", visibility: revealed ? "public" : "gm-only", hp: { current: 18, maximum: 40 }, notes: "Lairs in the rafters" }
  ] });
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 18 }, { actorId: IDS.ambusher, score: 12 }] }, () => 1, GEOMETRY);
  state.combat = { ...state.combat, turnActorId: current === "hero" ? IDS.hero : IDS.ambusher };
  return state;
}

const roll = (id: string, visibility: RollRecord["visibility"], sessionId: string): RollRecord => ({
  id, commandId: `c-${id}`, initiatorSessionId: sessionId, initiatorRole: "player", initiatorLabel: "Borin",
  label: "Attack", actorId: IDS.hero, purpose: "attack", visibility,
  formula: "1d20+5", normalizedFormula: "1d20+5", dice: [], modifiers: [], total: 17, createdAt: "2026-07-01T20:00:00.000Z"
});

const logRow = (id: number, revision: number, over: Partial<CombatLogEntry> = {}): CombatLogEntry => ({
  id, at: "2026-07-01T20:00:00.000Z", kind: "action", text: "Something happened.", gmOnly: false, revision, ...over
});

function document(): EncounterArchiveDocument {
  const hidden = turnState(false, "ambusher");
  const revealed = turnState(true, "ambusher");
  return {
    archiveSchemaVersion: 3, startedAt: "2026-07-01T20:00:00.000Z", endedAt: "2026-07-01T21:00:00.000Z",
    turnCount: 2,
    turns: [
      { index: 0, kind: "turn", label: "Shadow Stalker's turn", revision: 10, at: "2026-07-01T20:00:00.000Z", state: hidden },
      { index: 1, kind: "turn", label: "Shadow Stalker's turn", revision: 20, at: "2026-07-01T20:05:00.000Z", state: revealed }
    ],
    log: [
      logRow(1, 10, { text: "The rafters creak.", gmOnly: false }),
      logRow(2, 11, { text: "Shadow Stalker readies an ambush.", gmOnly: true }),
      // A self-only roll is stored gm_only = 0 - it IS visible, to its roller. The replay reader is
      // any player, so it must not survive a gmOnly-only filter.
      logRow(3, 12, { kind: "roll", text: "Borin rolls in secret.", gmOnly: false, roll: { ...roll("r-self", "self-only", IDS.otherSession), initiatorSessionId: undefined } as never }),
      logRow(4, 21, { kind: "roll", text: "Borin attacks.", gmOnly: false, roll: { ...roll("r-public", "public", IDS.heroSession), initiatorSessionId: undefined } as never })
    ],
    journal: [{ seq: 1, commandId: "c-1", type: "actor.set-visibility", actorId: IDS.ambusher, principal: `gm:${IDS.otherSession}`, payload: { secret: "the ambusher's plan" }, revision: 15, at: "2026-07-01T20:03:00.000Z" }],
    finalState: revealed, postEncounterState: revealed,
    rolls: [roll("r-self", "self-only", IDS.otherSession), roll("r-public", "public", IDS.heroSession), roll("r-gm", "gm-only", IDS.otherSession)],
    definitions: [],
    attribution: null
  } as unknown as EncounterArchiveDocument;
}

describe("the player's replay is a projection, not a filtered archive", () => {
  it("hides a combatant until the turn it was revealed, and never uses the GM's turn label", () => {
    const replay = projectPlayerReplay(3, document());
    const [before, after] = replay.turns;

    expect(before.actors.map((actor) => actor.name)).toEqual(["Borin"]);
    expect(before.combat.initiative.map((entry) => entry.name)).toEqual(["Borin"]);
    // The GM's own label names the hidden creature; the player's label never does.
    expect(before.label).toBe("A hidden combatant's turn");
    expect(JSON.stringify(before)).not.toContain("Shadow Stalker");

    // From the reveal on, the same creature is simply there.
    expect(after.actors.map((actor) => actor.name).sort()).toEqual(["Borin", "Shadow Stalker"]);
    expect(after.label).toBe("Shadow Stalker's turn");
  });

  it("bands a monster's hit points and keeps a party member's exact, exactly as live play does", () => {
    const replay = projectPlayerReplay(3, document());
    const revealed = replay.turns[1];
    expect(revealed.actors.find((actor) => actor.name === "Borin")!.hp).toMatchObject({ kind: "exact", current: 21, maximum: 30 });
    expect(revealed.actors.find((actor) => actor.name === "Shadow Stalker")!.hp).toMatchObject({ kind: "band" });
  });

  it("drops every roll that is not public - from the document AND from each turn's log slice", () => {
    const replay = projectPlayerReplay(3, document());
    expect(replay.rolls.map((entry) => entry.id)).toEqual(["r-public"]);
    const logIds = replay.turns.flatMap((turn) => turn.log.map((entry) => entry.id));
    // Row 2 is gmOnly, row 3 is another player's self-only roll: neither survives.
    expect(logIds).toEqual([1, 4]);
    expect(JSON.stringify(replay)).not.toContain("readies an ambush");
    expect(JSON.stringify(replay)).not.toContain("in secret");
  });

  it("slices the log by turn boundary, so each moment carries its own commentary", () => {
    const replay = projectPlayerReplay(3, document());
    expect(replay.turns[0].log.map((entry) => entry.id)).toEqual([1]);
    expect(replay.turns[1].log.map((entry) => entry.id)).toEqual([4]);
  });

  it("never carries a session id, the journal, the raw states, the notes, or the stat blocks", () => {
    const serialized = JSON.stringify(projectPlayerReplay(3, document()));
    // The string-level assertion is the point: a key-by-key check only proves the keys someone named.
    expect(serialized).not.toContain(IDS.heroSession);
    expect(serialized).not.toContain(IDS.otherSession);
    expect(serialized).not.toContain("initiatorSessionId");
    expect(serialized).not.toContain("initiator_session_id");
    expect(serialized).not.toContain("ownerSessionId");
    expect(serialized).not.toContain("journal");
    expect(serialized).not.toContain("finalState");
    expect(serialized).not.toContain("postEncounterState");
    expect(serialized).not.toContain("definitions");
    expect(serialized).not.toContain("GM notes");
    expect(serialized).not.toContain("Lairs in the rafters");
  });

  it("reads an old or empty recording defensively rather than throwing", () => {
    const bare = { archiveSchemaVersion: 1, endedAt: "2026-07-01T21:00:00.000Z", turns: [], log: [] } as unknown as EncounterArchiveDocument;
    const replay = projectPlayerReplay(1, bare);
    expect(replay).toMatchObject({ id: 1, turnCount: 0, turns: [], rolls: [], startedAt: null, attribution: null });
  });
});
