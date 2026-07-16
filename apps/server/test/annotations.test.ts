import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { addAnnotation, moveAnnotation, nextAnnotationExpiry, removeAnnotation, setAnnotationVisibility } from "../src/annotations.js";
import { createEncounterTokens } from "../src/token-placement.js";

const ACTOR = "60000000-0000-4000-8000-000000000001";
const MAP = "70000000-0000-5000-8000-000000000001";
const GM = "80000000-0000-4000-8000-000000000001";
const PLAYER = "80000000-0000-4000-8000-000000000002";
const OTHER_PLAYER = "80000000-0000-4000-8000-000000000003";
const calibration = { kind: "square" as const, origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
const geometry = { width: 1000, height: 1000, calibration };
const gmActor = { sessionId: GM, role: "gm" as const };
const playerActor = { sessionId: PLAYER, role: "player" as const };

function activeState() {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: ACTOR, name: "Hero", kind: "player-character", hp: { current: 10, maximum: 10 } }],
    combat: {
      active: true, round: 1, turnActorId: ACTOR, mapAssetId: MAP,
      initiative: [{ actorId: ACTOR, score: 20 }],
      tokens: createEncounterTokens([ACTOR], geometry)
    }
  });
}

describe("authoritative annotation geometry", () => {
  it("rejects measuring or placing without an active encounter or completed calibration", () => {
    const inactive = GameStateSchema.parse({ schemaVersion: 1 });
    expect(() => addAnnotation(inactive, { id: "a0000000-0000-4000-8000-000000000001", kind: "measurement", origin: { x: 0, y: 0 }, target: { x: 50, y: 0 }, visibility: "public", actor: gmActor, now: 0 }, geometry))
      .toThrow("Start an encounter");
    const state = activeState();
    expect(() => addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "measurement", origin: { x: 0, y: 0 }, target: { x: 50, y: 0 }, visibility: "public", actor: gmActor, now: 0 }, { width: 1000, height: 1000, calibration: null }))
      .toThrow("Complete the grid wizard");
  });

  it("snaps a measurement to whole grid cells with no decimals and expires it in 5 seconds", () => {
    const state = activeState();
    const annotation = addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "measurement", origin: { x: 12, y: 8 }, target: { x: 232, y: 19 }, visibility: "public", actor: playerActor, now: 1000 }, geometry);
    // 220px across a 50px grid ≈ 4.4 cells, rounds to 4 cells × 5ft = 20ft.
    expect(annotation.geometry.sizeFeet).toBe(20);
    expect(Number.isInteger(annotation.geometry.sizeFeet)).toBe(true);
    expect(annotation.visibility).toBe("public");
    expect(annotation.expiresAt).toBe(6000);
    expect(nextAnnotationExpiry(state, 1000)).toBe(6000);
    expect(nextAnnotationExpiry(state, 6001)).toBeNull();
  });

  it("rejects a zero-distance measurement", () => {
    const state = activeState();
    expect(() => addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "measurement", origin: { x: 25, y: 25 }, target: { x: 26, y: 26 }, visibility: "public", actor: playerActor, now: 0 }, geometry))
      .toThrow("Drag to a different grid cell");
  });

  it("places a square shape as an axis-aligned box that snaps both sides equally", () => {
    const state = activeState();
    const annotation = addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "shape", shape: "square", origin: { x: 10, y: 10 }, target: { x: 240, y: 90 }, visibility: "public", actor: gmActor, now: 0 }, geometry);
    expect(annotation.geometry.sizeFeet).toBe(25); // max(|dx|,|dy|) in cells (4.6) rounds to 5 cells × 5ft
    expect(annotation.geometry.origin).toEqual({ x: 0, y: 0 });
    expect(annotation.geometry.target).toEqual({ x: 250, y: 250 });
    expect(annotation.expiresAt).toBeNull();
  });

  it("places a circle sized from the radial drag distance and defaults to a 5ft radius on a bare click", () => {
    const state = activeState();
    const clicked = addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "shape", shape: "circle", origin: { x: 100, y: 100 }, target: { x: 100, y: 100 }, visibility: "public", actor: gmActor, now: 0 }, geometry);
    expect(clicked.geometry.sizeFeet).toBe(5);
    const state2 = activeState();
    const dragged = addAnnotation(state2, { id: "a0000000-0000-4000-8000-000000000002", kind: "shape", shape: "circle", origin: { x: 100, y: 100 }, target: { x: 100, y: 205 }, visibility: "gm-only", actor: gmActor, now: 0 }, geometry);
    expect(dragged.geometry.sizeFeet).toBe(10); // 105px / 50px ≈ 2.1 rounds to 2 cells × 5ft
    expect(dragged.visibility).toBe("gm-only");
  });

  it("forces measurement visibility to public regardless of the requested value", () => {
    const state = activeState();
    const annotation = addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "measurement", origin: { x: 0, y: 0 }, target: { x: 100, y: 0 }, visibility: "gm-only", actor: gmActor, now: 0 }, geometry);
    expect(annotation.visibility).toBe("public");
  });

  it("lets the owner move/resize and delete their own shape, but not another player's", () => {
    const state = activeState();
    addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "shape", shape: "square", origin: { x: 0, y: 0 }, target: { x: 50, y: 50 }, visibility: "public", actor: playerActor, now: 0 }, geometry);
    expect(() => moveAnnotation(state, "a0000000-0000-4000-8000-000000000001", { x: 100, y: 100 }, { x: 150, y: 150 }, { sessionId: OTHER_PLAYER, role: "player" }, geometry))
      .toThrow("your own");
    moveAnnotation(state, "a0000000-0000-4000-8000-000000000001", { x: 100, y: 100 }, { x: 150, y: 150 }, playerActor, geometry);
    expect(state.combat.annotations[0].geometry.origin).toEqual({ x: 100, y: 100 });
    expect(() => removeAnnotation(state, "a0000000-0000-4000-8000-000000000001", { sessionId: OTHER_PLAYER, role: "player" })).toThrow("your own");
    removeAnnotation(state, "a0000000-0000-4000-8000-000000000001", playerActor);
    expect(state.combat.annotations).toHaveLength(0);
  });

  it("lets the GM move, delete, or change the visibility of anyone's shape", () => {
    const state = activeState();
    addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "shape", shape: "square", origin: { x: 0, y: 0 }, target: { x: 50, y: 50 }, visibility: "public", actor: playerActor, now: 0 }, geometry);
    setAnnotationVisibility(state, "a0000000-0000-4000-8000-000000000001", "owner-gm", gmActor);
    expect(state.combat.annotations[0].visibility).toBe("owner-gm");
    removeAnnotation(state, "a0000000-0000-4000-8000-000000000001", gmActor);
    expect(state.combat.annotations).toHaveLength(0);
  });

  it("rejects moving or changing visibility on a measurement, and rejects an unknown ID", () => {
    const state = activeState();
    addAnnotation(state, { id: "a0000000-0000-4000-8000-000000000001", kind: "measurement", origin: { x: 0, y: 0 }, target: { x: 100, y: 0 }, visibility: "public", actor: playerActor, now: 0 }, geometry);
    expect(() => moveAnnotation(state, "a0000000-0000-4000-8000-000000000001", { x: 0, y: 0 }, { x: 100, y: 100 }, playerActor, geometry)).toThrow("Only placed shapes");
    expect(() => setAnnotationVisibility(state, "a0000000-0000-4000-8000-000000000001", "gm-only", playerActor)).toThrow("always visible");
    expect(() => removeAnnotation(state, "does-not-exist", gmActor)).toThrow("no longer exists");
  });
});
