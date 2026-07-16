import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveSquareGridFromSegment } from "../src/grid-calibration.js";
import { MapCatalogStore } from "../src/map-catalog.js";

const id = "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa";

describe("MapCatalogStore", () => {
  it("persists safe map details, calibration, and scale through restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-map-catalog-"));
    const databasePath = join(directory, "vtt.sqlite");
    let store = new MapCatalogStore(databasePath, () => Date.parse("2026-07-16T02:00:00.000Z"));
    try {
      await store.initialize();
      expect(store.register(id, "Ruined Keep", "battlemap")).toMatchObject({ assetId: id, name: "Ruined Keep", kind: "battlemap", calibration: null });
      const grid = deriveSquareGridFromSegment({ mapWidthPx: 1000, mapHeightPx: 800, start: { x: 10, y: 20 }, end: { x: 210, y: 20 }, cellsBetween: 4, axis: "horizontal" });
      store.saveCalibration(id, { calibration: grid, verifiedAt: null, verificationPoint: null, verificationErrorPx: null });
      expect(store.get(id)).toMatchObject({ calibration: { verifiedAt: null, verificationPoint: null, verificationErrorPx: null } });
      store.saveCalibration(id, { calibration: grid, verifiedAt: "2026-07-16T02:01:00.000Z", verificationPoint: { x: 110, y: 120 }, verificationErrorPx: 0 });
      store.saveScale(id, { kind: "image-scale", distancePerPixel: 0.25, unit: "miles" });
      store.close();

      store = new MapCatalogStore(databasePath); await store.initialize();
      expect(store.get(id)).toMatchObject({ name: "Ruined Keep", calibration: { calibration: { cellSizePx: 50 } }, scale: { distancePerPixel: 0.25, unit: "miles" } });
      expect(store.list()).toHaveLength(1);
      expect(store.updateDetails(id, { name: "Keep at Dusk", kind: "regional" })).toMatchObject({ name: "Keep at Dusk", kind: "regional" });
    } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("deduplicates registration and rejects malformed or unsafe records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-map-catalog-safe-"));
    const store = new MapCatalogStore(join(directory, "vtt.sqlite"));
    try {
      await store.initialize();
      store.register(id, "Original", "world");
      expect(store.register(id, "Replacement", "battlemap").name).toBe("Original");
      expect(() => store.register("../../auth", "Unsafe", "world")).toThrow("malformed");
      expect(() => store.updateDetails(id, { name: " " })).toThrow("Map name");
      expect(() => store.saveScale(id, { kind: "image-scale", distancePerPixel: 0, unit: "mi" })).toThrow("positive finite");
      const grid = deriveSquareGridFromSegment({ mapWidthPx: 1000, mapHeightPx: 800, start: { x: 10, y: 20 }, end: { x: 210, y: 20 }, cellsBetween: 4, axis: "horizontal" });
      expect(() => store.saveCalibration(id, { calibration: grid, verifiedAt: null, verificationPoint: { x: 1, y: 1 }, verificationErrorPx: null })).toThrow("verification");
    } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
