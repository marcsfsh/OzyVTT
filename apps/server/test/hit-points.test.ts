import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { applyDamage, healActor, healthBandOf, setCurrentHp, setTemporaryHp } from "../src/hit-points.js";
import { startEncounter } from "../src/encounter.js";
import { projectPlayerView, projectPublicInitiative } from "../src/projections.js";
import { projectViewerInitiative } from "../src/viewer-encounter.js";

const IDS = {
  pc: "10000000-0000-4000-8000-000000000001",
  monster: "10000000-0000-4000-8000-000000000002",
  session: "30000000-0000-4000-8000-000000000001",
  otherSession: "30000000-0000-4000-8000-000000000002",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GM = { role: "gm" } as const;
const OWNER = { role: "player", sessionId: IDS.session } as const;

function state() {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.pc, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20, temporary: 5 }, ownerSessionId: IDS.session },
    { id: IDS.monster, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 } }
  ] });
}

describe("hit point tracking", () => {
  it("routes damage through temporary hit points first and floors at zero", () => {
    const game = state();
    applyDamage(game, IDS.pc, 8, GM);
    expect(game.actors[0].hp).toMatchObject({ current: 17, temporary: 0 });
    applyDamage(game, IDS.pc, 40, GM);
    expect(game.actors[0].hp).toMatchObject({ current: 0, temporary: 0 });
  });

  it("caps healing at maximum without touching temporary hit points", () => {
    const game = state();
    applyDamage(game, IDS.monster, 9, GM);
    healActor(game, IDS.monster, 50, GM);
    expect(game.actors[1].hp).toMatchObject({ current: 10, temporary: 0 });
    setTemporaryHp(game, IDS.pc, 3, GM);
    healActor(game, IDS.pc, 5, GM);
    expect(game.actors[0].hp).toMatchObject({ current: 20, temporary: 3 });
  });

  it("replaces temporary hit points and clamps direct GM corrections", () => {
    const game = state();
    setTemporaryHp(game, IDS.pc, 12, GM);
    setTemporaryHp(game, IDS.pc, 4, GM);
    expect(game.actors[0].hp.temporary).toBe(4);
    setCurrentHp(game, IDS.pc, 999, GM);
    expect(game.actors[0].hp.current).toBe(20);
    setCurrentHp(game, IDS.pc, 0, GM);
    expect(game.actors[0].hp.current).toBe(0);
  });

  it("lets a player adjust only their own claimed character", () => {
    const game = state();
    applyDamage(game, IDS.pc, 2, OWNER);
    expect(game.actors[0].hp.current).toBe(20); // temp absorbed 2 of it
    expect(game.actors[0].hp.temporary).toBe(3);
    expect(() => applyDamage(game, IDS.monster, 2, OWNER)).toThrow(/own character/);
    expect(() => healActor(game, IDS.pc, 2, { role: "player", sessionId: IDS.otherSession })).toThrow(/own character/);
    expect(() => setCurrentHp(game, IDS.pc, 5, OWNER)).toThrow(/Only the GM/);
  });

  it("maps hit points to health bands at the 2024 bloodied threshold", () => {
    expect(healthBandOf({ current: 6, maximum: 10, temporary: 0 })).toBe("healthy");
    expect(healthBandOf({ current: 5, maximum: 10, temporary: 0 })).toBe("bloodied");
    expect(healthBandOf({ current: 0, maximum: 10, temporary: 9 })).toBe("down");
  });

  it("projects exact hp for player characters and only a band for monsters", () => {
    const game = state();
    applyDamage(game, IDS.monster, 5, GM);
    const view = projectPlayerView(game, IDS.session, () => null);
    const pc = view.actors.find((actor) => actor.id === IDS.pc)!;
    const monster = view.actors.find((actor) => actor.id === IDS.monster)!;
    expect(pc.hp).toEqual({ kind: "exact", current: 20, maximum: 20, temporary: 5 });
    expect(monster.hp).toEqual({ kind: "band", band: "bloodied" });
    expect(JSON.stringify(monster)).not.toContain("maximum");
  });

  it("adds health to public initiative but never leaks it to the viewer", () => {
    const game = state();
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.pc, score: 15 }, { actorId: IDS.monster, score: 10 }] }, () => 1, { width: 900, height: 600, calibration: null });
    applyDamage(game, IDS.monster, 10, GM);
    const initiative = projectPublicInitiative(game);
    expect(initiative.find((entry) => entry.actorId === IDS.monster)?.health).toBe("down");
    const viewer = projectViewerInitiative(game);
    // The shared screen now carries the coarse band + condition labels - and still no exact hp shape.
    for (const entry of viewer.entries) {
      expect(Object.keys(entry).sort()).toEqual(["active", "actorId", "conditions", "health", "initiative", "name"]);
      expect(["healthy", "bloodied", "down"]).toContain(entry.health);
    }
    expect(JSON.stringify(viewer)).not.toMatch(/"current"|"maximum"|"temporary"/);
  });
});
