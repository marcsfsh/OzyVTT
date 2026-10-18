import { randomInt, randomUUID } from "node:crypto";
import type { SoundBoard, SoundBoardView, SoundScreen, ViewerSoundProjection } from "@vtt/domain";
import type { AudioAssetMetadata, AudioAssetStore } from "./audio-assets.js";
import type { PublicSoundAsset, SoundCatalogEntry, SoundCatalogStore } from "./sound-catalog.js";
import {
  advanceMusic,
  applyScenePreset,
  nextSoundEvent,
  projectViewerSound,
  removeSoundEverywhere,
  soundsInUse,
  trackBoundary,
  viewerSoundAssets,
  viewerSoundAt,
  type SoundDeps
} from "./sound-board.js";
import type { SoundStore } from "./sound-store.js";

/**
 * The sound board on the server (ADR-0024): the GM's library of uploaded files, the board's store, and the clock
 * that moves the playlist on. Every change goes through `run`, which commits it and tells the table screens and
 * the GM's devices.
 */

type SoundServiceOptions = Readonly<{
  store: SoundStore;
  assets: AudioAssetStore;
  catalog: SoundCatalogStore;
  /** The connected table screens and whether each may play sound. */
  screens: () => readonly SoundScreen[];
  /** Called after every committed change: the table screens and the GM's board follow it. */
  changed: (board: SoundBoard) => void;
  now?: () => number;
}>;

/** A hand-over the timer fired a moment early for; nothing is committed and the timer is set again. */
class NotDueYet extends Error {}

export function publicSound(metadata: AudioAssetMetadata, entry: SoundCatalogEntry): PublicSoundAsset {
  return {
    id: metadata.id,
    name: entry.name,
    originalName: metadata.originalName,
    format: metadata.format,
    codec: metadata.codec,
    mediaType: metadata.mediaType,
    durationMs: metadata.durationMs,
    byteLength: metadata.byteLength,
    importedAt: metadata.importedAt,
    updatedAt: entry.updatedAt
  };
}

export class SoundService {
  /** Each library sound's length, read once from its stored record, so commands can look it up synchronously. */
  private readonly durations = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: SoundServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async initialize() {
    for (const metadata of await this.options.assets.list())
      if (this.options.catalog.get(metadata.id)) this.durations.set(metadata.id, metadata.durationMs);
    // A file that went missing while the server was down must not stay on the board.
    const board = this.options.store.board;
    const missing = [...soundsInUse(board), ...(board.music.current ? [board.music.current.assetId] : [])].filter(
      (assetId) => !this.durations.has(assetId)
    );
    if (missing.length)
      await this.run(`library-check:${this.options.store.revision}`, (draft) => {
        for (const assetId of missing) removeSoundEverywhere(draft, assetId);
      });
    this.schedule();
  }

  /** A library sound's length, or null when the library has no such sound. */
  durationOf = (assetId: string) => this.durations.get(assetId) ?? null;

  /** Commits one change to the board, once per `commandId`. */
  async run(commandId: string, change: (board: SoundBoard, deps: SoundDeps) => void) {
    const deps: SoundDeps = { now: this.now(), newId: randomUUID, pick: (size) => randomInt(0, size) };
    const result = await this.options.store.execute(commandId, (board) => change(board, deps));
    if (!result.duplicate) {
      this.options.changed(result.board);
      this.schedule();
    }
    return { soundRevision: result.revision, duplicate: result.duplicate };
  }

  view(): SoundBoardView {
    return {
      revision: this.options.store.revision,
      serverTime: this.now(),
      board: this.options.store.board,
      screens: [...this.options.screens()]
    };
  }

  /** What the table screen plays at `now`. */
  viewerSound(now = this.now()): ViewerSoundProjection {
    return viewerSoundAt(projectViewerSound(this.options.store.board, now), now);
  }

  /** Whether a table screen may fetch this file now: only while it is playing. */
  isOnAir(assetId: string) {
    const now = this.now();
    return viewerSoundAssets(projectViewerSound(this.options.store.board, now), now).has(assetId);
  }

  /** A scene went live: its sound starts, unless it has none or the GM turned that off. Best-effort: a sound
   *  failure must not undo the committed scene switch. */
  sceneWentLive = async (sceneId: string, sourceRevision: number) => {
    const preset = this.options.store.board.presets.find((candidate) => candidate.sceneId === sceneId);
    if (!preset?.autoplay) return;
    try {
      await this.run(`scene-live:${sceneId}:${sourceRevision}`, (board, deps) => {
        applyScenePreset(board, sceneId, deps);
      });
    } catch (error) {
      console.error("The scene's sound could not start:", (error as Error).message);
    }
  };

  // ---------- The library ----------

  async upload(bytes: Uint8Array, filename: string, name: string) {
    const imported = await this.options.assets.import(bytes, filename);
    const entry = this.options.catalog.register(imported.metadata.id, name);
    this.durations.set(imported.metadata.id, imported.metadata.durationMs);
    return { sound: publicSound(imported.metadata, entry), duplicate: imported.duplicate };
  }

  async list() {
    const sounds = await Promise.all(
      this.options.catalog.list().map(async (entry) => {
        const metadata = await this.options.assets.get(entry.assetId);
        return metadata ? publicSound(metadata, entry) : null;
      })
    );
    return sounds.filter((sound) => sound !== null);
  }

  async rename(assetId: string, name: string) {
    const entry = this.options.catalog.rename(assetId, name);
    const metadata = await this.options.assets.get(assetId);
    return metadata ? publicSound(metadata, entry) : null;
  }

  /** Deletes a sound: off the board and its scenes first (stopping it if it plays), then the file. */
  async remove(assetId: string) {
    if (!this.options.catalog.get(assetId)) return false;
    await this.run(`delete:${assetId}:${randomUUID()}`, (board) => removeSoundEverywhere(board, assetId));
    this.durations.delete(assetId);
    this.options.catalog.remove(assetId);
    await this.options.assets.remove(assetId);
    return true;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Sets the one timer for the next thing the board does on its own: the next music hand-over. */
  private schedule() {
    this.dispose();
    const due = nextSoundEvent(this.options.store.board);
    if (due === null) return;
    this.timer = setTimeout(() => void this.advance(), Math.max(0, due - this.now()));
    this.timer.unref?.();
  }

  private async advance() {
    const current = this.options.store.board.music.current;
    if (!current) return;
    if (trackBoundary(current) > this.now()) return this.schedule();
    try {
      // Keyed on the play, so two firings for one track hand over once.
      await this.run(`advance:${current.playId}`, (board, deps) => {
        if (!advanceMusic(board, deps)) throw new NotDueYet();
      });
    } catch (error) {
      if (!(error instanceof NotDueYet))
        console.error("The sound board could not move to the next track:", (error as Error).message);
      this.schedule();
    }
  }
}
