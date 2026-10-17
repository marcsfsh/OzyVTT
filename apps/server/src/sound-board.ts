import {
  MAX_SOUND_EFFECTS,
  MAX_SOUND_LAYERS,
  SOUND_CROSSFADE_MS,
  SoundBoardSchema,
  type SoundBoard,
  type SoundCurrentTrack,
  type SoundSlot,
  type ViewerSoundProjection
} from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

/**
 * The sound board's rules, as pure functions over the board (ADR-0024). The server decides everything here:
 * which track comes next, when, and in what shuffled order; the table screen only plays what it is told.
 * Times are the server's clock in milliseconds.
 */

export type SoundDeps = Readonly<{
  now: number;
  newId: () => string;
  /** A uniform integer in [0, size). */
  pick: (size: number) => number;
}>;

/** A sound's level and, when it is new to the board, its length from the library (null: not in the library). */
export type SlotInput = Readonly<{ assetId: string; volume: number }>;
export type DurationOf = (assetId: string) => number | null;

export function createSoundBoard(): SoundBoard {
  return SoundBoardSchema.parse({});
}

const NOT_IN_LIBRARY = "That sound is no longer in the library.";

function shuffled<T>(items: readonly T[], pick: SoundDeps["pick"]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = pick(index + 1);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

/** The moment the current track hands over to the next: a crossfade before its end, or its end when it is too
 *  short to overlap. */
export function trackBoundary(track: SoundCurrentTrack) {
  const overlap = track.durationMs > SOUND_CROSSFADE_MS * 2 ? SOUND_CROSSFADE_MS : 0;
  return track.startedAt + track.durationMs - overlap;
}

/** The next moment the server must act on its own (the next music hand-over), or null while nothing is due. */
export function nextSoundEvent(board: SoundBoard): number | null {
  if (board.pausedAt !== null || !board.music.current) return null;
  return trackBoundary(board.music.current);
}

/** Lifts a pause: every running sound moves forward by the paused stretch, so it carries on where it stopped. */
function resume(board: SoundBoard, now: number) {
  if (board.pausedAt === null) return;
  const shift = Math.max(0, now - board.pausedAt);
  if (board.music.current) board.music.current.startedAt += shift;
  for (const layer of board.ambient) if (layer.playing) layer.playing.startedAt += shift;
  for (const fired of board.fired) fired.startedAt += shift;
  board.pausedAt = null;
}

/** Drops one-shots that have finished; a paused board's clock stands at the pause. */
function pruneFired(board: SoundBoard, now: number) {
  const at = board.pausedAt ?? now;
  board.fired = board.fired.filter((fired) => fired.startedAt + fired.durationMs > at);
}

function slotsFrom(
  inputs: readonly SlotInput[],
  existing: readonly SoundSlot[],
  durationOf: DurationOf,
  section: string
): SoundSlot[] {
  const seen = new Set<string>();
  return inputs.map((input) => {
    if (seen.has(input.assetId)) throw new CommandRejectedError(`A sound can be in the ${section} only once.`);
    seen.add(input.assetId);
    const durationMs = existing.find((slot) => slot.assetId === input.assetId)?.durationMs ?? durationOf(input.assetId);
    if (durationMs === null) throw new CommandRejectedError(NOT_IN_LIBRARY);
    return { assetId: input.assetId, volume: input.volume, durationMs };
  });
}

function startTrack(board: SoundBoard, slot: SoundSlot, startedAt: number, deps: SoundDeps) {
  board.music.current = {
    playId: deps.newId(),
    assetId: slot.assetId,
    startedAt,
    durationMs: slot.durationMs,
    volume: slot.volume
  };
}

/** The track after the current one: the next in the list, or the next of this shuffled pass (a new pass is
 *  shuffled when one runs out, never starting with the track that just played). */
function followingTrack(board: SoundBoard, deps: SoundDeps): SoundSlot | null {
  const { tracks, current } = board.music;
  if (tracks.length === 0) return null;
  if (!board.music.shuffle) {
    const index = current ? tracks.findIndex((track) => track.assetId === current.assetId) : -1;
    return tracks[(index + 1) % tracks.length]!;
  }
  let upNext = board.music.upNext.filter((assetId) => tracks.some((track) => track.assetId === assetId));
  if (upNext.length === 0) {
    const others = tracks.filter((track) => track.assetId !== current?.assetId || tracks.length === 1);
    upNext = shuffled(
      others.map((track) => track.assetId),
      deps.pick
    );
  }
  const [next, ...rest] = upNext;
  board.music.upNext = rest;
  return tracks.find((track) => track.assetId === next) ?? null;
}

/** Replaces any part of the board's arrangement: the master level, the playlist and its order, shuffle, the
 *  ambient layers and the effect pads. What keeps playing keeps playing at its new level; what is taken off the
 *  board stops. */
export function arrangeBoard(
  board: SoundBoard,
  input: Readonly<{
    masterVolume?: number;
    music?: Readonly<{ tracks: readonly SlotInput[]; shuffle: boolean }>;
    ambient?: readonly SlotInput[];
    effects?: readonly SlotInput[];
  }>,
  durationOf: DurationOf,
  deps: SoundDeps
) {
  if (input.masterVolume !== undefined) board.masterVolume = input.masterVolume;
  if (input.music) {
    const tracks = slotsFrom(input.music.tracks, board.music.tracks, durationOf, "playlist");
    const added = tracks.filter((track) => !board.music.tracks.some((old) => old.assetId === track.assetId));
    const turnedOn = input.music.shuffle && !board.music.shuffle;
    board.music.tracks = tracks;
    board.music.shuffle = input.music.shuffle;
    const current = board.music.current;
    const kept = current && tracks.find((track) => track.assetId === current.assetId);
    if (current && !kept) board.music.current = null;
    else if (current && kept) current.volume = kept.volume;
    if (!board.music.shuffle) board.music.upNext = [];
    else if (turnedOn)
      board.music.upNext = shuffled(
        tracks.filter((track) => track.assetId !== board.music.current?.assetId).map((track) => track.assetId),
        deps.pick
      );
    else {
      // New tracks join the rest of this pass at random places.
      const upNext = board.music.upNext.filter((assetId) => tracks.some((track) => track.assetId === assetId));
      for (const track of added) upNext.splice(deps.pick(upNext.length + 1), 0, track.assetId);
      board.music.upNext = upNext;
    }
  }
  if (input.ambient) {
    if (input.ambient.length > MAX_SOUND_LAYERS)
      throw new CommandRejectedError(`The board holds up to ${MAX_SOUND_LAYERS} ambient layers.`);
    board.ambient = slotsFrom(input.ambient, board.ambient, durationOf, "ambient layers").map((slot) => ({
      ...slot,
      playing: board.ambient.find((layer) => layer.assetId === slot.assetId)?.playing ?? null
    }));
  }
  if (input.effects) {
    if (input.effects.length > MAX_SOUND_EFFECTS)
      throw new CommandRejectedError(`The board holds up to ${MAX_SOUND_EFFECTS} effects.`);
    board.effects = slotsFrom(input.effects, board.effects, durationOf, "effects");
  }
  pruneFired(board, deps.now);
}

/** Starts the playlist: at the named track, or the first (a random one when shuffled). */
export function playMusic(board: SoundBoard, assetId: string | undefined, deps: SoundDeps) {
  const { tracks } = board.music;
  if (tracks.length === 0) throw new CommandRejectedError("Add a track to the playlist first.");
  resume(board, deps.now);
  const chosen = assetId
    ? tracks.find((track) => track.assetId === assetId)
    : board.music.shuffle
      ? tracks[deps.pick(tracks.length)]
      : tracks[0];
  if (!chosen) throw new CommandRejectedError("That sound is not in the playlist.");
  if (board.music.shuffle)
    board.music.upNext = shuffled(
      tracks.filter((track) => track.assetId !== chosen.assetId).map((track) => track.assetId),
      deps.pick
    );
  startTrack(board, chosen, deps.now, deps);
  pruneFired(board, deps.now);
}

/** Skips to the following track now (with the usual crossfade on the table screen). */
export function nextTrack(board: SoundBoard, deps: SoundDeps) {
  if (!board.music.current) return playMusic(board, undefined, deps);
  resume(board, deps.now);
  const next = followingTrack(board, deps);
  if (!next) throw new CommandRejectedError("Add a track to the playlist first.");
  startTrack(board, next, deps.now, deps);
  pruneFired(board, deps.now);
}

/** How late a hand-over may run and still date the next track from the boundary; later than this (the server was
 *  down) the next track starts now instead of racing through the tracks it missed. */
const HAND_OVER_SLACK_MS = 5_000;

/** The server's own hand-over when a track reaches its end. The next track starts at the boundary itself, not
 *  when the timer happened to fire, so every screen agrees on where it is. Returns false when nothing was due. */
export function advanceMusic(board: SoundBoard, deps: SoundDeps) {
  const current = board.music.current;
  if (!current || board.pausedAt !== null) return false;
  const boundary = trackBoundary(current);
  if (boundary > deps.now) return false;
  const next = followingTrack(board, deps);
  if (!next) {
    board.music.current = null;
    return true;
  }
  startTrack(board, next, deps.now - boundary <= HAND_OVER_SLACK_MS ? boundary : deps.now, deps);
  pruneFired(board, deps.now);
  return true;
}

export function stopMusic(board: SoundBoard) {
  board.music.current = null;
  board.music.upNext = [];
}

export function setLayerPlaying(board: SoundBoard, assetId: string, playing: boolean, deps: SoundDeps) {
  const layer = board.ambient.find((candidate) => candidate.assetId === assetId);
  if (!layer) throw new CommandRejectedError("That sound is not an ambient layer on the board.");
  if (!playing) {
    layer.playing = null;
    return;
  }
  resume(board, deps.now);
  layer.playing ??= { playId: deps.newId(), startedAt: deps.now };
}

export function playEffect(board: SoundBoard, assetId: string, deps: SoundDeps) {
  const pad = board.effects.find((candidate) => candidate.assetId === assetId);
  if (!pad) throw new CommandRejectedError("That sound is not an effect on the board.");
  resume(board, deps.now);
  pruneFired(board, deps.now);
  board.fired = [
    ...board.fired,
    { playId: deps.newId(), assetId, startedAt: deps.now, durationMs: pad.durationMs, volume: pad.volume }
  ].slice(-MAX_SOUND_EFFECTS);
}

export function setPaused(board: SoundBoard, paused: boolean, deps: SoundDeps) {
  if (!paused) return resume(board, deps.now);
  pruneFired(board, deps.now);
  const running = board.music.current !== null || board.ambient.some((layer) => layer.playing) || board.fired.length;
  if (board.pausedAt === null && running) board.pausedAt = deps.now;
}

export function stopAll(board: SoundBoard) {
  stopMusic(board);
  for (const layer of board.ambient) layer.playing = null;
  board.fired = [];
  board.pausedAt = null;
}

/** Saves what the board holds now as a scene's sound: the playlist, and the ambient layers that are on. */
export function saveScenePreset(board: SoundBoard, sceneId: string) {
  const music = board.music.tracks.length
    ? { tracks: board.music.tracks.map((track) => ({ ...track })), shuffle: board.music.shuffle }
    : null;
  const ambient = board.ambient
    .filter((layer) => layer.playing)
    .map(({ assetId, volume, durationMs }) => ({ assetId, volume, durationMs }));
  if (!music && ambient.length === 0)
    throw new CommandRejectedError("Add music or turn on an ambient layer first, then save it to the scene.");
  const autoplay = board.presets.find((preset) => preset.sceneId === sceneId)?.autoplay ?? true;
  board.presets = [
    ...board.presets.filter((preset) => preset.sceneId !== sceneId),
    { sceneId, autoplay, music, ambient }
  ];
}

export function setPresetAutoplay(board: SoundBoard, sceneId: string, autoplay: boolean) {
  const preset = board.presets.find((candidate) => candidate.sceneId === sceneId);
  if (!preset) throw new CommandRejectedError("That scene has no sound saved.");
  preset.autoplay = autoplay;
}

export function clearScenePreset(board: SoundBoard, sceneId: string) {
  board.presets = board.presets.filter((preset) => preset.sceneId !== sceneId);
}

/** Keeps only the presets of scenes that still exist. */
export function prunePresets(board: SoundBoard, sceneIds: ReadonlySet<string>) {
  board.presets = board.presets.filter((preset) => sceneIds.has(preset.sceneId));
}

/** Plays a scene's sound: its playlist from the top (or shuffled) and its ambient layers, and nothing else of the
 *  music or ambience. Effect pads are left as they are. Returns false when the scene has no sound saved. */
export function applyScenePreset(board: SoundBoard, sceneId: string, deps: SoundDeps) {
  const preset = board.presets.find((candidate) => candidate.sceneId === sceneId);
  if (!preset) return false;
  resume(board, deps.now);
  if (preset.music && preset.music.tracks.length) {
    board.music.tracks = preset.music.tracks.map((track) => ({ ...track }));
    board.music.shuffle = preset.music.shuffle;
    playMusic(board, undefined, deps);
  } else stopMusic(board);
  const wanted = new Map(preset.ambient.map((slot) => [slot.assetId, slot]));
  for (const layer of board.ambient) {
    const slot = wanted.get(layer.assetId);
    if (!slot) layer.playing = null;
    else {
      layer.volume = slot.volume;
      layer.playing ??= { playId: deps.newId(), startedAt: deps.now };
      wanted.delete(layer.assetId);
    }
  }
  for (const slot of wanted.values()) {
    if (board.ambient.length >= MAX_SOUND_LAYERS) break;
    board.ambient.push({ ...slot, playing: { playId: deps.newId(), startedAt: deps.now } });
  }
  return true;
}

/** Takes a deleted sound off the board, its presets and anything playing it. */
export function removeSoundEverywhere(board: SoundBoard, assetId: string) {
  const other = (slot: { assetId: string }) => slot.assetId !== assetId;
  board.music.tracks = board.music.tracks.filter(other);
  board.music.upNext = board.music.upNext.filter((id) => id !== assetId);
  if (board.music.current?.assetId === assetId) board.music.current = null;
  board.ambient = board.ambient.filter(other);
  board.effects = board.effects.filter(other);
  board.fired = board.fired.filter(other);
  board.presets = board.presets.map((preset) => ({
    ...preset,
    music: preset.music && { ...preset.music, tracks: preset.music.tracks.filter(other) },
    ambient: preset.ambient.filter(other)
  }));
}

/** Every sound the board refers to, for the library's "in use" mark. */
export function soundsInUse(board: SoundBoard): ReadonlySet<string> {
  return new Set([
    ...board.music.tracks.map((slot) => slot.assetId),
    ...board.ambient.map((slot) => slot.assetId),
    ...board.effects.map((slot) => slot.assetId),
    ...board.presets.flatMap((preset) => [
      ...(preset.music?.tracks ?? []).map((slot) => slot.assetId),
      ...preset.ambient.map((slot) => slot.assetId)
    ])
  ]);
}

// ---------- What the table screen receives ----------

type Playing = Readonly<{ playId: string; assetId: string; startedAt: number; durationMs: number; volume: number }>;

/** The board as the table screen's stored presentation holds it: only what is playing, with server times. */
export type ViewerSoundState = Readonly<{
  masterVolume: number;
  pausedAt: number | null;
  music: Playing | null;
  ambient: readonly Playing[];
  effects: readonly Playing[];
}>;

export const EMPTY_VIEWER_SOUND: ViewerSoundState = {
  masterVolume: 0.8,
  pausedAt: null,
  music: null,
  ambient: [],
  effects: []
};

/** An effect's file stays fetchable this long after it ends, so a screen that heard it late can still load it. */
const EFFECT_FETCH_GRACE_MS = 10_000;

export function projectViewerSound(board: SoundBoard, now: number): ViewerSoundState {
  const at = board.pausedAt ?? now;
  const playing = (item: Playing): Playing => ({
    playId: item.playId,
    assetId: item.assetId,
    startedAt: item.startedAt,
    durationMs: item.durationMs,
    volume: item.volume
  });
  return {
    masterVolume: board.masterVolume,
    pausedAt: board.pausedAt,
    music: board.music.current && playing(board.music.current),
    ambient: board.ambient.flatMap((layer) =>
      layer.playing
        ? [
            {
              playId: layer.playing.playId,
              assetId: layer.assetId,
              startedAt: layer.playing.startedAt,
              durationMs: layer.durationMs,
              volume: layer.volume
            }
          ]
        : []
    ),
    effects: board.fired.filter((fired) => fired.startedAt + fired.durationMs + EFFECT_FETCH_GRACE_MS > at).map(playing)
  };
}

/** Positions at `now`: what the table screen plays. A finished effect is no longer listed. */
export function viewerSoundAt(state: ViewerSoundState, now: number): ViewerSoundProjection {
  const at = state.pausedAt ?? now;
  const elapsed = (item: Playing) => Math.max(0, at - item.startedAt);
  const item = (entry: Playing, positionMs: number) => ({
    playId: entry.playId,
    assetId: entry.assetId,
    positionMs,
    volume: entry.volume
  });
  return {
    masterVolume: state.masterVolume,
    paused: state.pausedAt !== null,
    crossfadeMs: SOUND_CROSSFADE_MS,
    music: state.music && item(state.music, Math.min(elapsed(state.music), state.music.durationMs)),
    ambient: state.ambient.map((layer) => item(layer, elapsed(layer) % layer.durationMs)),
    effects: state.effects
      .filter((effect) => elapsed(effect) < effect.durationMs)
      .map((effect) => item(effect, elapsed(effect)))
  };
}

/** The files the table screen may fetch: exactly what its sound projection names, plus a just-finished effect. */
export function viewerSoundAssets(state: ViewerSoundState, now: number): ReadonlySet<string> {
  const at = state.pausedAt ?? now;
  return new Set([
    ...(state.music ? [state.music.assetId] : []),
    ...state.ambient.map((layer) => layer.assetId),
    ...state.effects
      .filter((effect) => effect.startedAt + effect.durationMs + EFFECT_FETCH_GRACE_MS > at)
      .map((effect) => effect.assetId)
  ]);
}
