import { describe, expect, it } from "vitest";
import type { GmView, PlayerView } from "@vtt/domain";
import { idleStatus, tableStatus } from "./status";

// The header's status line says the same thing on every device: the round and who acts, or what the scene waits for.

const LYRA = "10000000-0000-4000-8000-0000000000a1";
const gm = (combat: Record<string, unknown>, lyra: Record<string, unknown> = {}) =>
  ({
    actors: [{ id: LYRA, name: "Lyra", hp: { current: 37, maximum: 44 }, deathSaves: null, ...lyra }],
    combat: { active: true, round: 2, turnActorId: LYRA, mapAssetId: "m", ...combat }
  }) as unknown as GmView;

describe("the table's status line", () => {
  it("names who acts, and says a dying character is dying", () => {
    expect(tableStatus({ role: "gm", state: gm({}) })).toBe("Round 2 · Lyra is acting");
    const dying = gm({}, { hp: { current: 0, maximum: 44 }, deathSaves: { successes: 0, failures: 1, stable: false } });
    expect(tableStatus({ role: "gm", state: dying })).toBe("Round 2 · Lyra is dying");
  });

  it("tells a player it is their turn, and keeps a hidden turn hidden", () => {
    const view = (combat: Record<string, unknown>) =>
      ({
        actors: [{ id: LYRA, name: "Lyra", claimStatus: "mine", hp: { kind: "exact", current: 37, maximum: 44 } }],
        combat: { active: true, round: 3, turnActorId: LYRA, mapAssetId: "m", hiddenTurn: false, ...combat }
      }) as unknown as PlayerView;
    expect(tableStatus({ role: "player", state: view({}) })).toBe("Round 3 · your turn");
    expect(tableStatus({ role: "player", state: view({ hiddenTurn: true, turnActorId: null }) })).toBe(
      "Round 3 · a hidden turn"
    );
  });

  it("says what a scene waits for between fights", () => {
    expect(tableStatus({ role: "gm", state: gm({ active: false }) })).toBe("Scene is live · no fight yet");
    expect(tableStatus({ role: "gm", state: gm({ active: false, mapAssetId: null }) })).toBe("No fight running yet");
  });
});

describe("the strip before a fight", () => {
  const token = (actorId: string, placed = true) => ({ actorId, position: placed ? { x: 1, y: 1 } : null });
  const idle = (tokens: unknown[], mapAssetId: string | null = "m") =>
    ({
      actors: [
        { id: "a", name: "Lyra", kind: "player-character" },
        { id: "b", name: "Borin", kind: "player-character" },
        { id: "g", name: "Goblin", kind: "monster" }
      ],
      combat: { active: false, round: 0, turnActorId: null, mapAssetId, tokens }
    }) as unknown as GmView;

  it("counts the party and the monsters with a token on the map, leaving out the tray", () => {
    expect(idleStatus({ role: "gm", state: idle([token("a"), token("b"), token("g"), token("x")]) })).toEqual({
      lead: "No fight running.",
      detail: "2 of the party and 1 monster are on the map."
    });
    expect(idleStatus({ role: "gm", state: idle([token("a"), token("g", false)]) }).detail).toBe(
      "1 of the party is on the map."
    );
    expect(idleStatus({ role: "gm", state: idle([]) }).detail).toBe("Nobody is on the map yet.");
  });

  it("says no scene is live when there is no map", () => {
    expect(idleStatus({ role: "gm", state: idle([], null) }).detail).toBe("No scene is live.");
  });
});
