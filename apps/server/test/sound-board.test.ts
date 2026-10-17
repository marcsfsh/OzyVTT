import { SOUND_CROSSFADE_MS, type SoundBoard } from "@vtt/domain";
import { describe, expect, it } from "vitest";
import {
  advanceMusic,
  applyScenePreset,
  arrangeBoard,
  createSoundBoard,
  nextSoundEvent,
  nextTrack,
  playEffect,
  playMusic,
  projectViewerSound,
  removeSoundEverywhere,
  saveScenePreset,
  setLayerPlaying,
  setPaused,
  setPresetAutoplay,
  stopAll,
  viewerSoundAssets,
  viewerSoundAt,
  type SoundDeps
} from "../src/sound-board.js";

const TAVERN = "11111111-1111-5111-8111-111111111111";
const BATTLE = "22222222-2222-5222-8222-222222222222";
const DIRGE = "33333333-3333-5333-8333-333333333333";
const RAIN = "44444444-4444-5444-8444-444444444444";
const FIRE = "55555555-5555-5555-8555-555555555555";
const THUNDER = "66666666-6666-5666-8666-666666666666";
const SCENE = "77777777-7777-4777-8777-777777777777";
const LIBRARY: Readonly<Record<string, number>> = {
  [TAVERN]: 180_000,
  [BATTLE]: 120_000,
  [DIRGE]: 60_000,
  [RAIN]: 30_000,
  [FIRE]: 45_000,
  [THUNDER]: 4_000
};
const durationOf = (assetId: string) => LIBRARY[assetId] ?? null;

/** A clock and id source the test drives; `picks` answers the shuffles in order (each taken modulo the range). */
function deps(now: number, picks: number[] = []): SoundDeps {
  let id = 0;
  return {
    now,
    newId: () => `00000000-0000-4000-8000-${String(now).padStart(8, "0")}${String(++id).padStart(4, "0")}`,
    pick: (size) => (picks.length ? picks.shift()! % size : 0)
  };
}

function board(): SoundBoard {
  const fresh = createSoundBoard();
  arrangeBoard(
    fresh,
    {
      music: {
        tracks: [
          { assetId: TAVERN, volume: 0.5 },
          { assetId: BATTLE, volume: 0.9 },
          { assetId: DIRGE, volume: 0.4 }
        ],
        shuffle: false
      },
      ambient: [
        { assetId: RAIN, volume: 0.6 },
        { assetId: FIRE, volume: 0.3 }
      ],
      effects: [{ assetId: THUNDER, volume: 1 }]
    },
    durationOf,
    deps(0)
  );
  return fresh;
}

describe("the sound board's arrangement", () => {
  it("takes each new sound's length from the library and refuses one that isn't there, or a repeat", () => {
    const fresh = board();
    expect(fresh.music.tracks.map((track) => track.durationMs)).toEqual([180_000, 120_000, 60_000]);
    const unknown = "99999999-9999-5999-8999-999999999999";
    expect(() => arrangeBoard(fresh, { effects: [{ assetId: unknown, volume: 1 }] }, durationOf, deps(0))).toThrow(
      "no longer in the library"
    );
    expect(() =>
      arrangeBoard(
        fresh,
        {
          ambient: [
            { assetId: RAIN, volume: 1 },
            { assetId: RAIN, volume: 0.5 }
          ]
        },
        durationOf,
        deps(0)
      )
    ).toThrow("only once");
  });

  it("keeps what plays playing at its new level, and stops what comes off the board", () => {
    const fresh = board();
    playMusic(fresh, BATTLE, deps(1_000));
    setLayerPlaying(fresh, RAIN, true, deps(1_000));
    arrangeBoard(
      fresh,
      {
        music: {
          tracks: [
            { assetId: BATTLE, volume: 0.2 },
            { assetId: TAVERN, volume: 0.5 }
          ],
          shuffle: false
        },
        ambient: [{ assetId: RAIN, volume: 0.1 }]
      },
      durationOf,
      deps(2_000)
    );
    expect(fresh.music.current).toMatchObject({ assetId: BATTLE, volume: 0.2, startedAt: 1_000 });
    expect(fresh.ambient).toEqual([
      expect.objectContaining({ assetId: RAIN, volume: 0.1, playing: expect.objectContaining({ startedAt: 1_000 }) })
    ]);
    arrangeBoard(
      fresh,
      { music: { tracks: [{ assetId: TAVERN, volume: 0.5 }], shuffle: false } },
      durationOf,
      deps(3_000)
    );
    expect(fresh.music.current).toBeNull();
  });
});

describe("the playlist", () => {
  it("plays in order, handing over a crossfade before each track ends, and goes round again", () => {
    const fresh = board();
    playMusic(fresh, undefined, deps(10_000));
    expect(fresh.music.current).toMatchObject({ assetId: TAVERN, startedAt: 10_000, volume: 0.5 });
    const handOver = 10_000 + 180_000 - SOUND_CROSSFADE_MS;
    expect(nextSoundEvent(fresh)).toBe(handOver);
    expect(advanceMusic(fresh, deps(handOver - 1))).toBe(false);
    // The timer fired late, but the next track starts at the hand-over itself, so every screen agrees.
    expect(advanceMusic(fresh, deps(handOver + 250))).toBe(true);
    expect(fresh.music.current).toMatchObject({ assetId: BATTLE, startedAt: handOver, volume: 0.9 });
    nextTrack(fresh, deps(handOver + 1_000));
    expect(fresh.music.current?.assetId).toBe(DIRGE);
    nextTrack(fresh, deps(handOver + 2_000));
    expect(fresh.music.current?.assetId).toBe(TAVERN);
  });

  it("shuffles each pass on the server, never opening a pass with the track that just played", () => {
    const fresh = board();
    arrangeBoard(
      fresh,
      { music: { tracks: fresh.music.tracks.map(({ assetId, volume }) => ({ assetId, volume })), shuffle: true } },
      durationOf,
      deps(0)
    );
    // Picks: the first track (index 1 of three), then the order of the other two.
    playMusic(fresh, undefined, deps(0, [1, 0]));
    expect(fresh.music.current?.assetId).toBe(BATTLE);
    expect(fresh.music.upNext).toHaveLength(2);
    const played = [BATTLE];
    for (let step = 1; step <= 2; step++) {
      nextTrack(fresh, deps(step * 1_000));
      played.push(fresh.music.current!.assetId);
    }
    expect(new Set(played).size).toBe(3);
    // A new pass: shuffled again, and not starting with the last track.
    const last = fresh.music.current!.assetId;
    nextTrack(fresh, deps(10_000, [1]));
    expect(fresh.music.current!.assetId).not.toBe(last);
  });

  it("pauses everything in place and resumes from the same spot", () => {
    const fresh = board();
    playMusic(fresh, undefined, deps(0));
    setLayerPlaying(fresh, RAIN, true, deps(5_000));
    setPaused(fresh, true, deps(20_000));
    expect(nextSoundEvent(fresh)).toBeNull();
    const paused = viewerSoundAt(projectViewerSound(fresh, 50_000), 50_000);
    expect(paused).toMatchObject({ paused: true, music: { positionMs: 20_000 }, ambient: [{ positionMs: 15_000 }] });
    // Playing anything lifts the pause, moving every running sound on by the time it was held.
    playEffect(fresh, THUNDER, deps(80_000));
    expect(fresh.pausedAt).toBeNull();
    expect(fresh.music.current?.startedAt).toBe(60_000);
    const resumed = viewerSoundAt(projectViewerSound(fresh, 81_000), 81_000);
    expect(resumed).toMatchObject({ paused: false, music: { positionMs: 21_000 }, ambient: [{ positionMs: 16_000 }] });
  });
});

describe("what the table screen receives", () => {
  it("is only what is playing, with positions inside each loop, and an effect only until it ends", () => {
    const fresh = board();
    playMusic(fresh, undefined, deps(0));
    setLayerPlaying(fresh, RAIN, true, deps(0));
    setLayerPlaying(fresh, FIRE, true, deps(10_000));
    playEffect(fresh, THUNDER, deps(70_000));
    const state = projectViewerSound(fresh, 71_000);
    const sound = viewerSoundAt(state, 71_000);
    expect(Object.keys(sound).sort()).toEqual(["ambient", "crossfadeMs", "effects", "masterVolume", "music", "paused"]);
    expect(sound.music).toEqual({
      playId: fresh.music.current!.playId,
      assetId: TAVERN,
      positionMs: 71_000,
      volume: 0.5
    });
    expect(sound.ambient.map((layer) => [layer.assetId, layer.positionMs])).toEqual([
      [RAIN, 71_000 % 30_000],
      [FIRE, 61_000 % 45_000]
    ]);
    expect(sound.effects).toEqual([expect.objectContaining({ assetId: THUNDER, positionMs: 1_000, volume: 1 })]);
    // The playlist's other tracks, the effect pads and the scene sounds never reach it.
    expect(JSON.stringify(state)).not.toContain(BATTLE);
    expect(viewerSoundAt(state, 75_000).effects).toEqual([]);
    // The file stays fetchable a little after the effect ends, for a screen that heard of it late.
    expect(viewerSoundAssets(state, 75_000)).toEqual(new Set([TAVERN, RAIN, FIRE, THUNDER]));
    expect(viewerSoundAssets(state, 90_000).has(THUNDER)).toBe(false);
    stopAll(fresh);
    expect(viewerSoundAssets(projectViewerSound(fresh, 90_000), 90_000).size).toBe(0);
  });
});

describe("a scene's sound", () => {
  it("saves the playlist and the layers that are on, and plays them when asked", () => {
    const fresh = board();
    expect(() => saveScenePreset(createSoundBoard(), SCENE)).toThrow("Add music or turn on an ambient layer");
    setLayerPlaying(fresh, FIRE, true, deps(0));
    saveScenePreset(fresh, SCENE);
    expect(fresh.presets).toEqual([
      expect.objectContaining({ sceneId: SCENE, autoplay: true, ambient: [expect.objectContaining({ assetId: FIRE })] })
    ]);
    setPresetAutoplay(fresh, SCENE, false);
    expect(fresh.presets[0]!.autoplay).toBe(false);

    stopAll(fresh);
    setLayerPlaying(fresh, RAIN, true, deps(5_000));
    expect(applyScenePreset(fresh, SCENE, deps(9_000))).toBe(true);
    expect(fresh.music.current).toMatchObject({ assetId: TAVERN, startedAt: 9_000 });
    expect(fresh.ambient.find((layer) => layer.assetId === FIRE)?.playing).toMatchObject({ startedAt: 9_000 });
    expect(fresh.ambient.find((layer) => layer.assetId === RAIN)?.playing).toBeNull();
    expect(applyScenePreset(fresh, "88888888-8888-4888-8888-888888888888", deps(9_000))).toBe(false);
  });

  it("loses a deleted sound everywhere it was used", () => {
    const fresh = board();
    setLayerPlaying(fresh, FIRE, true, deps(0));
    saveScenePreset(fresh, SCENE);
    playMusic(fresh, TAVERN, deps(0));
    removeSoundEverywhere(fresh, TAVERN);
    removeSoundEverywhere(fresh, FIRE);
    expect(fresh.music.current).toBeNull();
    expect(JSON.stringify(fresh)).not.toContain(TAVERN);
    expect(JSON.stringify(fresh)).not.toContain(FIRE);
  });
});
