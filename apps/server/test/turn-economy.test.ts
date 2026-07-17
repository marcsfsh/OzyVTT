import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { nextInitiativeTurn, previousInitiativeTurn, startEncounter } from "../src/encounter.js";
import { projectPlayerCombat } from "../src/projections.js";
import { endTurn, setReactionUsed, setTurnSlot } from "../src/turn-economy.js";

const IDS = {
  pc: "10000000-0000-4000-8000-000000000001",
  monster: "10000000-0000-4000-8000-000000000002",
  hidden: "10000000-0000-4000-8000-000000000003",
  session: "30000000-0000-4000-8000-000000000001",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const OWNER = { role: "player", sessionId: IDS.session } as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

function combatState() {
  const game = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.pc, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, ownerSessionId: IDS.session },
    { id: IDS.monster, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 } },
    { id: IDS.hidden, name: "Lurker", kind: "monster", visibility: "gm-only", hp: { current: 10, maximum: 10 } }
  ] });
  startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.pc, score: 20 }, { actorId: IDS.monster, score: 10 }, { actorId: IDS.hidden, score: 5 }] }, () => 1, GEOMETRY);
  return game; // turn order: pc -> monster -> hidden
}

describe("turn economy", () => {
  it("tracks action/bonus for the current turn and resets on any turn change", () => {
    const game = combatState();
    setTurnSlot(game, "action", true, GM);
    setTurnSlot(game, "bonus-action", true, GM);
    expect(game.combat.turn).toEqual({ actionUsed: true, bonusActionUsed: true });
    nextInitiativeTurn(game);
    expect(game.combat.turn).toEqual({ actionUsed: false, bonusActionUsed: false });
    setTurnSlot(game, "action", true, GM);
    previousInitiativeTurn(game);
    expect(game.combat.turn).toEqual({ actionUsed: false, bonusActionUsed: false });
  });

  it("spends reactions off-turn and refreshes them when the owner's turn starts", () => {
    const game = combatState();
    setReactionUsed(game, IDS.monster, true, GM); // goblin reacts during the pc's turn
    setReactionUsed(game, IDS.pc, true, GM);
    expect(game.combat.reactionsUsed).toEqual([IDS.monster, IDS.pc]);
    nextInitiativeTurn(game); // monster's turn starts -> its reaction refreshes, pc's stays spent
    expect(game.combat.reactionsUsed).toEqual([IDS.pc]);
    nextInitiativeTurn(game); // hidden
    nextInitiativeTurn(game); // pc's turn starts -> refreshed
    expect(game.combat.reactionsUsed).toEqual([]);
  });

  it("gates players to their own turn and their own reaction", () => {
    const game = combatState(); // pc's turn
    setTurnSlot(game, "action", true, OWNER);
    expect(game.combat.turn.actionUsed).toBe(true);
    setReactionUsed(game, IDS.pc, true, OWNER);
    expect(() => setReactionUsed(game, IDS.monster, true, OWNER)).toThrow(/own character/);
    endTurn(game, OWNER); // player End Turn advances to the goblin
    expect(game.combat.turnActorId).toBe(IDS.monster);
    expect(() => setTurnSlot(game, "action", true, OWNER)).toThrow(/isn't your character's turn/);
    expect(() => endTurn(game, OWNER)).toThrow(/isn't your character's turn/);
  });

  it("keeps a hidden combatant's economy opaque to players", () => {
    const game = combatState();
    nextInitiativeTurn(game);
    nextInitiativeTurn(game); // hidden lurker's turn
    setTurnSlot(game, "action", true, GM);
    setReactionUsed(game, IDS.hidden, true, GM);
    setReactionUsed(game, IDS.monster, true, GM);
    const view = projectPlayerCombat(game);
    expect(view.hiddenTurn).toBe(true);
    expect(view.turn).toEqual({ actionUsed: false, bonusActionUsed: false });
    expect(view.reactionsUsed).toEqual([IDS.monster]);
    expect(JSON.stringify(view)).not.toContain(IDS.hidden);
  });
});
