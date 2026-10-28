import { z } from "zod";

/**
 * Music and ambient sound for the table screen (ADR-0024). The board is the GM's: what is in the playlist,
 * the ambient layers and the effect pads, and what is playing from when. The server keeps it and decides what
 * plays next; the table screen receives only what is playing (`ViewerSound`), and players receive nothing.
 */

/** How long one music track fades into the next. */
export const SOUND_CROSSFADE_MS = 2_000;
export const MAX_SOUND_TRACKS = 100;
export const MAX_SOUND_LAYERS = 12;
export const MAX_SOUND_EFFECTS = 24;

/** A level from silent (0) to full (1). The table screen maps it onto loudness; the board stores it as set. */
export const SoundVolumeSchema = z.number().min(0).max(1);
const AssetIdSchema = z.uuid();
const MillisecondsSchema = z.number().int().min(0);
const DurationSchema = z.number().int().min(1);

/** A sound on the board: which file, how loud, and how long the file runs (read from the file at upload). */
export const SoundSlotSchema = z.strictObject({
  assetId: AssetIdSchema,
  volume: SoundVolumeSchema,
  durationMs: DurationSchema
});
export type SoundSlot = z.infer<typeof SoundSlotSchema>;

/** One start of one sound. A new `playId` each start, so the table screen restarts a track played twice. */
export const SoundPlaybackSchema = z.strictObject({ playId: z.uuid(), startedAt: MillisecondsSchema });
export type SoundPlayback = z.infer<typeof SoundPlaybackSchema>;

export const SoundLayerSchema = SoundSlotSchema.extend({ playing: SoundPlaybackSchema.nullable() });
export type SoundLayer = z.infer<typeof SoundLayerSchema>;

/** The track playing now, with its own copy of the volume and length so a playlist edit can't strand it. */
export const SoundCurrentTrackSchema = SoundPlaybackSchema.extend({
  assetId: AssetIdSchema,
  volume: SoundVolumeSchema,
  durationMs: DurationSchema
});
export type SoundCurrentTrack = z.infer<typeof SoundCurrentTrackSchema>;

/** A one-shot effect that was fired, kept until it has finished sounding. */
export const SoundFiredSchema = SoundCurrentTrackSchema;
export type SoundFired = z.infer<typeof SoundFiredSchema>;

/** What a scene starts when it goes live, unless the GM turned that off. */
export const SoundPresetSchema = z.strictObject({
  encounterId: z.uuid(),
  autoplay: z.boolean(),
  music: z.strictObject({ tracks: z.array(SoundSlotSchema).max(MAX_SOUND_TRACKS), shuffle: z.boolean() }).nullable(),
  ambient: z.array(SoundSlotSchema).max(MAX_SOUND_LAYERS)
});
export type SoundPreset = z.infer<typeof SoundPresetSchema>;

export const SoundBoardSchema = z.strictObject({
  masterVolume: SoundVolumeSchema.default(0.8),
  /** When the whole board was paused; every position is frozen there until it resumes. */
  pausedAt: MillisecondsSchema.nullable().default(null),
  music: z
    .strictObject({
      tracks: z.array(SoundSlotSchema).max(MAX_SOUND_TRACKS).default([]),
      shuffle: z.boolean().default(false),
      current: SoundCurrentTrackSchema.nullable().default(null),
      /** What is left of this pass through a shuffled playlist. */
      upNext: z.array(AssetIdSchema).max(MAX_SOUND_TRACKS).default([])
    })
    .prefault({}),
  ambient: z.array(SoundLayerSchema).max(MAX_SOUND_LAYERS).default([]),
  effects: z.array(SoundSlotSchema).max(MAX_SOUND_EFFECTS).default([]),
  fired: z.array(SoundFiredSchema).max(MAX_SOUND_EFFECTS).default([]),
  presets: z.array(SoundPresetSchema).max(20).default([])
});
export type SoundBoard = z.infer<typeof SoundBoardSchema>;

/** Whether a table screen may play sound: `blocked` waits for someone to tap it, and a preview never plays. */
export const ScreenSoundSchema = z.enum(["on", "blocked", "muted", "unknown"]);
export type ScreenSound = z.infer<typeof ScreenSoundSchema>;

/** One connected table screen, as the GM's sound controls show it. */
export const SoundScreenSchema = z.strictObject({
  connectionId: z.string(),
  name: z.string(),
  sound: ScreenSoundSchema,
  /** Sounds this screen's browser could not play. */
  unplayable: z.array(AssetIdSchema).max(20)
});
export type SoundScreen = z.infer<typeof SoundScreenSchema>;

/** The GM's view of the board: its state, the board's revision, the server's clock and the table screens. */
export const SoundBoardViewSchema = z.strictObject({
  revision: z.number().int().min(0),
  serverTime: MillisecondsSchema,
  board: SoundBoardSchema,
  screens: z.array(SoundScreenSchema)
});
export type SoundBoardView = z.infer<typeof SoundBoardViewSchema>;
/** What `sound:board` answers. */
export type SoundBoardResult = { ok: boolean; message?: string; view?: SoundBoardView };
/** What a sound command answers: the board's own revision after it (the game revision is untouched). */
export type SoundCommandResult = {
  ok: boolean;
  message?: string;
  code?: string;
  soundRevision?: number;
  duplicate?: boolean;
};

/** One sound the table screen is to play, at `positionMs` into the file when the projection was made. */
export type ViewerSoundItem = Readonly<{ playId: string; assetId: string; positionMs: number; volume: number }>;

/** What the table screen receives about sound: only what is playing. No names, no playlist, no library. */
export type ViewerSoundProjection = Readonly<{
  masterVolume: number;
  paused: boolean;
  crossfadeMs: number;
  music: ViewerSoundItem | null;
  /** Looping layers; a layer's position is within the loop. */
  ambient: readonly ViewerSoundItem[];
  /** One-shots still sounding. */
  effects: readonly ViewerSoundItem[];
}>;
