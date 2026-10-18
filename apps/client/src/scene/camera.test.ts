import { describe, expect, it } from "vitest";
import { cameraFocus } from "./cameraFollow";
import { fitZoom, framingCamera, imageAtFraction, onTheMap, readableZoom, viewSize } from "./useMapView";

// The battle map's camera: a view the stage's own shape, opened close enough to read. It follows the play.

const MAP = { width: 1000, height: 700 };
const PHONE_BOX = { width: 390, height: 300 };

describe("the map's view", () => {
  it("takes the stage's shape, so the map fills it with no bands", () => {
    const fit = fitZoom(MAP, PHONE_BOX);
    const shown = viewSize(MAP, PHONE_BOX, fit);
    expect(shown.width / shown.height).toBeCloseTo(PHONE_BOX.width / PHONE_BOX.height);
    // At the fit the whole map shows across, the narrow way.
    expect(shown.width).toBeCloseTo(MAP.width);
    // A point at a fraction of the box is that fraction of the view.
    const corner = imageAtFraction(MAP, PHONE_BOX, { x: 0, y: 0 }, { center: { x: 500, y: 350 }, zoom: fit });
    expect(corner.x).toBeCloseTo(0);
    expect(corner.y).toBeCloseTo(350 - shown.height / 2);
  });

  it("keeps its scale when the pane changes size, so the map shows more of itself", () => {
    const camera = { center: { x: 500, y: 350 }, zoom: 0.8 };
    expect(viewSize(MAP, { width: 390, height: 460 }, camera.zoom).width).toBe(
      viewSize(MAP, PHONE_BOX, camera.zoom).width
    );
  });

  it("opens close enough that a one-cell token is drawn at the readable size", () => {
    expect(50 * readableZoom(MAP, PHONE_BOX, 50, 32)).toBeCloseTo(32);
    // A map whose tokens already read at the fit opens at the fit.
    const big = { width: 2000, height: 1400 };
    expect(readableZoom(MAP, big, 50, 40)).toBe(fitZoom(MAP, big));
  });

  it("frames two creatures by moving as little as it can", () => {
    const current = { center: { x: 500, y: 350 }, zoom: 1 };
    // Both already in view: the camera stays.
    expect(
      framingCamera(
        MAP,
        PHONE_BOX,
        current,
        [
          { x: 480, y: 340 },
          { x: 540, y: 360 }
        ],
        50,
        1
      )
    ).toBe(current);
    // One out of view but both fit at this zoom: a pan only.
    const panned = framingCamera(
      MAP,
      PHONE_BOX,
      current,
      [
        { x: 480, y: 340 },
        { x: 680, y: 360 }
      ],
      50,
      1
    );
    expect(panned.zoom).toBe(1);
    expect(panned.center.x).toBeGreaterThan(500);
    // Too far apart for this zoom: it zooms out just enough to hold both.
    const wide = framingCamera(
      MAP,
      PHONE_BOX,
      current,
      [
        { x: 100, y: 340 },
        { x: 900, y: 360 }
      ],
      50,
      1
    );
    expect(wide.zoom).toBeLessThan(1);
    expect(viewSize(MAP, PHONE_BOX, wide.zoom).width).toBeCloseTo(900);
  });

  it("keeps an automatic move on the map", () => {
    const zoom = readableZoom(MAP, PHONE_BOX, 50, 32);
    const moved = onTheMap(MAP, PHONE_BOX, { center: { x: 10, y: 350 }, zoom });
    expect(moved.center.x).toBeCloseTo(viewSize(MAP, PHONE_BOX, zoom).width / 2);
  });
});

describe("what the camera follows", () => {
  const placed = (ids: readonly string[]) => (id: string) => ids.includes(id);
  const base = { role: "player" as const, ownActorId: "me", turnActorId: null, targeting: null, reaction: null };

  it("frames the attacker and the chosen targets while targeting", () => {
    expect(
      cameraFocus({
        ...base,
        turnActorId: "me",
        targeting: { attackerId: "me", selected: ["goblin"] },
        placed: placed(["me", "goblin"])
      })
    ).toEqual({ kind: "frame", actorIds: ["me", "goblin"] });
  });

  it("frames a player's reaction with the creature whose turn it is", () => {
    expect(
      cameraFocus({ ...base, turnActorId: "boss", reaction: { actorId: "me" }, placed: placed(["me", "boss"]) })
    ).toEqual({ kind: "frame", actorIds: ["me", "boss"] });
  });

  it("centres whoever is acting, but only when this viewer has that token", () => {
    expect(cameraFocus({ ...base, turnActorId: "boss", placed: placed(["me", "boss"]) })).toEqual({
      kind: "centre",
      actorIds: ["boss"]
    });
    // A creature hidden from this player never moves the camera: it stays on the player's own token.
    expect(cameraFocus({ ...base, turnActorId: "hidden", placed: placed(["me"]) })).toEqual({
      kind: "centre",
      actorIds: ["me"]
    });
    expect(cameraFocus({ ...base, role: "gm", ownActorId: null, placed: placed(["me"]) })).toBeNull();
  });
});
