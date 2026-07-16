import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectMapImage, MapAssetStore } from "../src/map-assets.js";

function png(width: number, height: number, animated = false) {
  const buffer = Buffer.alloc(animated ? 40 : 24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write("IHDR", 12, "ascii"); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  if (animated) buffer.write("acTL", 28, "ascii");
  return buffer;
}

function jpeg(width: number, height: number) {
  const buffer = Buffer.alloc(23);
  buffer.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08], 0);
  buffer.writeUInt16BE(height, 13); buffer.writeUInt16BE(width, 15); buffer.set([0x01, 0x01, 0x11, 0x00, 0xff, 0xd9], 17);
  return buffer;
}

function webp(width: number, height: number) {
  const buffer = Buffer.alloc(30); buffer.write("RIFF", 0, "ascii"); buffer.writeUInt32LE(22, 4); buffer.write("WEBPVP8X", 8, "ascii");
  const write24 = (value: number, offset: number) => { buffer[offset] = value & 0xff; buffer[offset + 1] = (value >> 8) & 0xff; buffer[offset + 2] = (value >> 16) & 0xff; };
  write24(width - 1, 24); write24(height - 1, 27); return buffer;
}

describe("map image inspection", () => {
  it("detects dimensions from file contents rather than extensions", () => {
    expect(inspectMapImage(png(1920, 1080))).toMatchObject({ format: "png", width: 1920, height: 1080, animated: false });
    expect(inspectMapImage(jpeg(800, 600))).toMatchObject({ format: "jpeg", width: 800, height: 600 });
    expect(inspectMapImage(webp(1200, 900))).toMatchObject({ format: "webp", width: 1200, height: 900 });
  });

  it("rejects unsupported, animated, oversized, and pixel-bomb inputs", () => {
    expect(() => inspectMapImage(Buffer.from("not an image"))).toThrow("Unsupported");
    expect(() => inspectMapImage(png(100, 100, true))).toThrow("Animated");
    expect(() => inspectMapImage(png(4000, 4000), { maxDimensionPx: 2000 })).toThrow("dimensions");
    expect(() => inspectMapImage(png(1000, 1000), { maxPixels: 500_000 })).toThrow("pixel safety");
    expect(() => inspectMapImage(png(10, 10), { maxBytes: 10 })).toThrow("upload limit");
  });
});

describe("MapAssetStore", () => {
  it("stores content-addressed originals atomically, sanitizes names, and deduplicates concurrent imports", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-map-assets-"));
    try {
      const store = new MapAssetStore(directory, {}, () => Date.parse("2026-07-16T01:00:00.000Z")); await store.initialize();
      const input = png(2048, 1024);
      const [first, second] = await Promise.all([store.import(input, "../../campaign\u0000/map.png"), store.import(input, "different-name.png")]);
      expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
      expect(first.metadata.id).toBe(second.metadata.id);
      expect(first.metadata.originalName).toBe("map.png");
      expect(first.metadata).not.toHaveProperty("path");
      expect(await store.readOriginal(first.metadata.id)).toEqual(input);
      expect((await readdir(join(directory, "originals")))[0]).toBe(`${first.metadata.id}.png`);
      expect(await readdir(join(directory, "temporary"))).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("recovers metadata and verifies original checksums after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-map-assets-restart-"));
    try {
      const first = new MapAssetStore(directory); await first.initialize();
      const imported = await first.import(jpeg(640, 480), "battle.final.really.png");
      expect(imported.metadata.format).toBe("jpeg");
      expect(imported.metadata.extension).toBe("jpg");

      const reopened = new MapAssetStore(directory); await reopened.initialize();
      expect(await reopened.get(imported.metadata.id)).toEqual(imported.metadata);
      expect(await reopened.list()).toEqual([imported.metadata]);
      expect(await reopened.readOriginal(imported.metadata.id)).toEqual(jpeg(640, 480));
      expect(await reopened.get("../../auth.json")).toBeNull();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
