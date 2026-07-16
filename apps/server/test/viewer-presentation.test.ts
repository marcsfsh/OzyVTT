import { describe, expect, it } from "vitest";
import {
  ViewerAuthorizationError,
  ViewerRevisionConflictError,
  applyViewerCommand,
  createViewerPresentationState,
  projectViewerPresentation
} from "../src/viewer-presentation.js";

const command = (id: string, payload: Parameters<typeof applyViewerCommand>[1]["payload"], expectedRevision?: number) => ({ id, role: "gm" as const, payload, ...(expectedRevision === undefined ? {} : { expectedRevision }) });

describe("viewer presentation state", () => {
  it("lets the GM select a map, synchronize camera, measure, ping, and show initiative", () => {
    let state = createViewerPresentationState();
    state = applyViewerCommand(state, command("enable", { type: "viewer.enabled.set", enabled: true }, 0)).state;
    state = applyViewerCommand(state, command("map", { type: "viewer.map.set", assetId: "map-1", altText: "The ruined keep", camera: { center: { x: 500, y: 300 }, zoom: 1 } }, 1)).state;
    state = applyViewerCommand(state, command("camera", { type: "viewer.camera.set", camera: { center: { x: 550, y: 325 }, zoom: 1.5 } })).state;
    state = applyViewerCommand(state, command("measure", { type: "viewer.measurement.set", measurement: { id: "ruler-1", points: [{ x: 10, y: 20 }, { x: 110, y: 20 }], distanceLabel: "30 ft" } })).state;
    state = applyViewerCommand(state, command("ping", { type: "viewer.ping", id: "ping-1", point: { x: 80, y: 90 }, label: "Look here", durationMs: 1_000 }), 1_000).state;
    state = applyViewerCommand(state, command("initiative", { type: "viewer.initiative.set", initiative: { visible: true, round: 2, entries: [
      { actorId: "fighter", name: "Fighter", initiative: 18, active: true },
      { actorId: "goblin", name: "Goblin", initiative: 12, active: false }
    ] } })).state;

    const projection = projectViewerPresentation(state, 1_500);
    expect(projection).toMatchObject({ enabled: true, activeMap: { assetId: "map-1" }, camera: { zoom: 1.5 }, measurement: { distanceLabel: "30 ft" } });
    expect(projection.pings).toHaveLength(1);
    expect(projection.initiative.entries).toHaveLength(2);
    expect(projection).not.toHaveProperty("acceptedCommandIds");
  });

  it("expires pings in projections and hides all presentation content while disabled", () => {
    let state = createViewerPresentationState();
    state = applyViewerCommand(state, command("enable", { type: "viewer.enabled.set", enabled: true })).state;
    state = applyViewerCommand(state, command("map", { type: "viewer.map.set", assetId: "map-1", altText: "", camera: { center: { x: 0, y: 0 }, zoom: 1 } })).state;
    state = applyViewerCommand(state, command("ping", { type: "viewer.ping", id: "ping", point: { x: 1, y: 2 }, durationMs: 250 }), 10_000).state;
    expect(projectViewerPresentation(state, 10_249).pings).toHaveLength(1);
    expect(projectViewerPresentation(state, 10_250).pings).toHaveLength(0);
    state = applyViewerCommand(state, command("disable", { type: "viewer.enabled.set", enabled: false })).state;
    expect(projectViewerPresentation(state, 10_100)).toEqual({ schemaVersion: 1, revision: 4, enabled: false, activeMap: null, camera: null, measurement: null, pings: [], initiative: { visible: false, round: 0, entries: [] } });
  });

  it("is idempotent, detects revision conflicts, and rejects non-GM control", () => {
    const initial = createViewerPresentationState();
    const first = applyViewerCommand(initial, command("same", { type: "viewer.enabled.set", enabled: true }, 0));
    const duplicate = applyViewerCommand(first.state, command("same", { type: "viewer.enabled.set", enabled: false }, 0));
    expect(duplicate).toEqual({ state: first.state, duplicate: true });
    expect(() => applyViewerCommand(first.state, command("stale", { type: "viewer.enabled.set", enabled: false }, 0))).toThrow(ViewerRevisionConflictError);
    expect(() => applyViewerCommand(initial, { id: "player", role: "player", payload: { type: "viewer.enabled.set", enabled: true } })).toThrow(ViewerAuthorizationError);
  });

  it("clears map-specific effects on map changes and validates public display data", () => {
    let state = createViewerPresentationState();
    state = applyViewerCommand(state, command("map-1", { type: "viewer.map.set", assetId: "one", altText: "First", camera: { center: { x: 0, y: 0 }, zoom: 1 } })).state;
    state = applyViewerCommand(state, command("measurement", { type: "viewer.measurement.set", measurement: { id: "m", points: [{ x: 0, y: 0 }, { x: 2, y: 2 }], distanceLabel: "10 ft" } })).state;
    state = applyViewerCommand(state, command("ping", { type: "viewer.ping", id: "p", point: { x: 1, y: 1 } }), 0).state;
    state = applyViewerCommand(state, command("map-2", { type: "viewer.map.set", assetId: "two", altText: "Second", camera: { center: { x: 5, y: 5 }, zoom: 2 } })).state;
    expect(state.measurement).toBeNull();
    expect(state.pings).toEqual([]);
    expect(() => applyViewerCommand(state, command("bad-zoom", { type: "viewer.camera.set", camera: { center: { x: 0, y: 0 }, zoom: 0 } }))).toThrow("zoom");
    expect(() => applyViewerCommand(state, command("bad-initiative", { type: "viewer.initiative.set", initiative: { visible: true, round: 1, entries: [
      { actorId: "same", name: "One", initiative: 10, active: true },
      { actorId: "same", name: "Two", initiative: 9, active: true }
    ] } }))).toThrow();
  });
});
