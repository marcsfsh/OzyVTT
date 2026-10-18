import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AudioAssetStore, inspectAudio } from "../src/audio-assets.js";
import { adts, flac, m4a, mp3, ogg, wav, webm } from "./audio-fixtures.js";
import { png } from "./image-fixtures.js";

/** The first part of a file, cut mid-frame: a cut exactly on a frame boundary looks like a shorter whole file. */
const cut = (file: Buffer, keep: number) => file.subarray(0, Math.floor(file.length * keep) - 7);

describe("sound file inspection", () => {
  it("reads each container's format and length from its bytes", () => {
    expect(inspectAudio(wav(2.5))).toMatchObject({
      format: "wav",
      codec: "pcm",
      mediaType: "audio/wav",
      durationMs: 2500
    });
    // 100 frames of 1152 samples at 44.1 kHz.
    expect(inspectAudio(mp3(100))).toMatchObject({ format: "mp3", mediaType: "audio/mpeg", durationMs: 2612 });
    expect(inspectAudio(adts(100))).toMatchObject({ format: "aac", mediaType: "audio/aac", durationMs: 2322 });
    expect(inspectAudio(ogg("vorbis", 3))).toMatchObject({ format: "ogg", codec: "vorbis", durationMs: 3000 });
    // Opus counts its pre-skip out of the last granule.
    expect(inspectAudio(ogg("opus", 4))).toMatchObject({ format: "ogg", codec: "opus", durationMs: 4000 });
    expect(inspectAudio(flac(20))).toMatchObject({ format: "flac", mediaType: "audio/flac", durationMs: 1858 });
    expect(inspectAudio(m4a(12.5))).toMatchObject({
      format: "m4a",
      codec: "aac",
      mediaType: "audio/mp4",
      durationMs: 12500
    });
    expect(inspectAudio(webm(7))).toMatchObject({
      format: "webm",
      codec: "opus",
      mediaType: "audio/webm",
      durationMs: 7000
    });
    expect(inspectAudio(webm(7, { codec: "A_VORBIS" }))).toMatchObject({ codec: "vorbis" });
  });

  it("goes by the bytes, not the name: tags around MP3 frames and lengths left out of the header", () => {
    expect(inspectAudio(mp3(50, { tagged: true, trailer: true }))).toMatchObject({ format: "mp3", durationMs: 1306 });
    // A FLAC written to a pipe can't state its sample count; its last frame says where it ends.
    expect(inspectAudio(flac(20, { stated: false }))).toMatchObject({ durationMs: 1858 });
    // A browser recording states no duration; its last block's time stands in for it.
    expect(inspectAudio(webm(5, { stated: false }))).toMatchObject({ durationMs: 5000 });
  });

  it("refuses a file cut short, as a half-finished download is", () => {
    const files = [wav(1), mp3(40), adts(40), ogg("vorbis", 2), flac(10), m4a(3), webm(3)];
    for (const file of files) {
      expect(() => inspectAudio(cut(file, 0.6)), `${file.subarray(0, 4).toString("latin1")} cut`).toThrow("incomplete");
      expect(() => inspectAudio(file.subarray(0, file.length - 3))).toThrow("incomplete");
    }
    // An Ogg stream that never reaches its end-of-stream page, though every page is whole.
    expect(() => inspectAudio(ogg("opus", 2, { ended: false }))).toThrow("incomplete");
    // An M4A whose index never arrived.
    expect(() => inspectAudio(m4a(3, { index: false }))).toThrow("incomplete");
  });

  it("refuses what isn't a sound the table can play, saying what it is", () => {
    expect(() => inspectAudio(png(10, 10))).toThrow("This file is an image, and only sound files can be uploaded here");
    expect(() => inspectAudio(Buffer.from("%PDF-1.7 not a song"))).toThrow("a PDF document");
    expect(() => inspectAudio(Buffer.from("just some text, renamed to .mp3"))).toThrow(
      "not a sound file browsers can play"
    );
    expect(() => inspectAudio(m4a(3, { handler: "vide" }))).toThrow("holds video");
    expect(() => inspectAudio(webm(3, { trackType: 1, codec: "V_VP8" }))).toThrow("holds video");
    expect(() => inspectAudio(m4a(3, { codec: "alac" }))).toThrow("Apple Lossless");
    expect(() => inspectAudio(webm(3, { codec: "A_AAC" }))).toThrow("sound format browsers don't play");
    const adpcm = wav(1);
    adpcm.writeUInt16LE(0x11, 20);
    expect(() => inspectAudio(adpcm)).toThrow("compression browsers can't play");
    expect(() => inspectAudio(Buffer.alloc(0))).toThrow("empty");
    expect(() => inspectAudio(wav(1), 1_000)).toThrow("larger than");
  });

  // Real encoder output, when the machine has ffmpeg: the synthetic files above can't catch an encoder's quirks.
  const hasFfmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!hasFfmpeg)("agrees with ffmpeg's own files, whole and cut short", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-ffmpeg-"));
    try {
      const encodings: ReadonlyArray<readonly [string, readonly string[], string]> = [
        ["tone.mp3", ["-c:a", "libmp3lame", "-b:a", "64k"], "mp3"],
        ["tone.ogg", ["-c:a", "libvorbis"], "ogg"],
        ["tone.opus", ["-c:a", "libopus"], "ogg"],
        ["tone.m4a", ["-c:a", "aac"], "m4a"],
        ["tone.aac", ["-c:a", "aac", "-f", "adts"], "aac"],
        ["tone.webm", ["-c:a", "libopus"], "webm"],
        ["tone.flac", ["-c:a", "flac"], "flac"],
        ["tone.wav", ["-c:a", "pcm_s16le"], "wav"]
      ];
      for (const [name, codec, format] of encodings) {
        const path = join(directory, name);
        execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", ...codec, path]);
        const bytes = await readFile(path);
        const found = inspectAudio(bytes);
        expect(found.format, name).toBe(format);
        // Encoders pad the last frame, so a stated length may run a frame long.
        expect(Math.abs(found.durationMs - 2000), name).toBeLessThan(120);
        expect(() => inspectAudio(cut(bytes, 0.7)), `${name} cut`).toThrow("incomplete");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("the sound file store", () => {
  it("stores a file once by its bytes, reads it back checked, and deletes it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vtt-audio-store-"));
    try {
      const store = new AudioAssetStore(directory, undefined, () => Date.parse("2026-10-01T00:00:00Z"));
      await store.initialize();
      const first = await store.import(mp3(30), "C:\\Music\\tavern.mp3");
      expect(first.duplicate).toBe(false);
      expect(first.metadata).toMatchObject({ originalName: "tavern.mp3", format: "mp3", durationMs: 784 });
      const again = await store.import(mp3(30), "copy.mp3");
      expect(again).toEqual({ metadata: first.metadata, duplicate: true });
      expect((await store.readOriginal(first.metadata.id))?.buffer.equals(mp3(30))).toBe(true);
      expect(await store.list()).toHaveLength(1);
      await expect(store.import(cut(mp3(30), 0.5), "half.mp3")).rejects.toThrow("incomplete");
      expect(await readdir(join(directory, "temporary"))).toEqual([]);
      expect(await store.remove(first.metadata.id)).toBe(true);
      expect(await store.get(first.metadata.id)).toBeNull();
      expect(await store.remove(first.metadata.id)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
