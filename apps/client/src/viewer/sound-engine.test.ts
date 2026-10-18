import type { ViewerSoundProjection } from "@vtt/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableSoundEngine, type SoundEngineHooks } from "./sound-engine";

/**
 * The engine against a stand-in for Web Audio and the media element: jsdom plays nothing, so these tests prove the
 * engine's decisions (when to start, where to seek, how to fade), and the browser check proves real sound.
 */

class FakeParam {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
  }
}
class FakeGain {
  readonly gain = new FakeParam();
  connect(target: unknown) {
    return target;
  }
  disconnect() {}
}
class FakeContext extends EventTarget {
  currentTime = 0;
  readonly destination = {};
  constructor(public state: "running" | "suspended") {
    super();
  }
  createGain() {
    return new FakeGain();
  }
  createMediaElementSource(element: HTMLAudioElement) {
    return { connect: (gain: FakeGain) => (gains.set(element, gain), gain) };
  }
  resume() {
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

type FakeElement = Omit<HTMLAudioElement, "duration" | "paused"> & { plays: number; paused: boolean; duration: number };
const gains = new Map<HTMLAudioElement, FakeGain>();

function fakeElement(): FakeElement {
  const element = document.createElement("audio") as FakeElement;
  let currentTime = 0;
  let duration = Number.NaN;
  element.plays = 0;
  Object.defineProperties(element, {
    currentTime: { get: () => currentTime, set: (value: number) => (currentTime = value) },
    duration: { get: () => duration, set: (value: number) => (duration = value) },
    paused: { value: true, writable: true },
    play: {
      value: () => {
        element.plays++;
        element.paused = false;
        return Promise.resolve();
      }
    },
    pause: { value: () => (element.paused = true) }
  });
  return element;
}

let now = 0;
let host: HTMLElement;
let statuses: string[];
let unplayable: (readonly string[])[];

function engine(state: "running" | "suspended") {
  const hooks: SoundEngineHooks = {
    host,
    createElement: fakeElement,
    createContext: () => new FakeContext(state) as unknown as AudioContext,
    now: () => now,
    src: (assetId) => `/api/v1/sound-assets/${assetId}/content`,
    onStatus: (status) => statuses.push(status),
    onUnplayable: (assetIds) => unplayable.push(assetIds)
  };
  return new TableSoundEngine(hooks);
}

const silence: ViewerSoundProjection = {
  masterVolume: 1,
  paused: false,
  crossfadeMs: 2_000,
  music: null,
  ambient: [],
  effects: []
};
const item = (playId: string, assetId: string, positionMs: number, volume = 1) => ({
  playId,
  assetId,
  positionMs,
  volume
});

/** The element playing `playId`, after its file's length is known. */
function loaded(playId: string, seconds: number) {
  const element = host.querySelector<FakeElement>(`audio[data-play-id="${playId}"]`)!;
  element.duration = seconds;
  element.dispatchEvent(new Event("loadedmetadata"));
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  now = 0;
  host = document.createElement("div");
  statuses = [];
  unplayable = [];
  gains.clear();
});
afterEach(() => vi.useRealTimers());

describe("the table screen's sound engine", () => {
  it("waits for a tap while the browser holds sound back, then joins the track where the table is", () => {
    const sound = engine("suspended");
    expect(sound.currentStatus).toBe("blocked");
    sound.apply({ ...silence, music: item("p1", "tavern", 5_000, 0.5) }, 0);
    now = 1_000;
    const element = loaded("p1", 60);
    expect(element.plays).toBe(0);
    // Ready at the right spot: five seconds in when sent, a second ago.
    expect(element.currentTime).toBe(6);
    now = 3_000;
    sound.unlock();
    expect(element.plays).toBe(1);
    expect(element.currentTime).toBe(8);
    expect(statuses).toEqual(["on"]);
    // Half a slider's travel is a quarter of the loudness.
    expect(gains.get(element)!.gain.value).toBe(0.25);
  });

  it("plays at once where the browser allows it, and loops a layer from inside its loop", () => {
    const sound = engine("running");
    expect(sound.currentStatus).toBe("on");
    sound.apply({ ...silence, ambient: [item("rain", "rain-file", 25_000)] }, 0);
    const element = loaded("rain", 10);
    expect(element.loop).toBe(true);
    expect(element.currentTime).toBe(5);
    expect(element.plays).toBe(1);
    expect(element.getAttribute("src")).toBe("/api/v1/sound-assets/rain-file/content");
  });

  it("crossfades one track into the next, and lets a stopped layer fade out", () => {
    const sound = engine("running");
    sound.apply({ ...silence, music: item("a", "tavern", 0), ambient: [item("fire", "fire-file", 0)] }, 0);
    const first = loaded("a", 120);
    loaded("fire", 30);
    now = 100_000;
    sound.apply({ ...silence, music: item("b", "battle", 0) }, now);
    const second = loaded("b", 90);
    expect(second.plays).toBe(1);
    expect(gains.get(first)!.gain.value).toBe(0);
    // The old track sounds through the crossfade, then goes.
    vi.advanceTimersByTime(1_000);
    expect(host.contains(first)).toBe(true);
    vi.advanceTimersByTime(1_100);
    expect(host.contains(first)).toBe(false);
    expect(host.querySelector('audio[data-play-id="fire"]')).toBeNull();
  });

  it("holds everything where it is while paused and picks up from there", () => {
    const sound = engine("running");
    sound.apply({ ...silence, music: item("a", "tavern", 0) }, 0);
    const element = loaded("a", 120);
    now = 10_000;
    sound.apply({ ...silence, paused: true, music: item("a", "tavern", 10_000) }, now);
    vi.advanceTimersByTime(300);
    expect(element.paused).toBe(true);
    now = 50_000;
    element.currentTime = 10;
    sound.apply({ ...silence, music: item("a", "tavern", 10_000) }, now);
    expect(element.paused).toBe(false);
    expect(element.currentTime).toBe(10);
  });

  it("moves a sound only when it has drifted well away from the table's clock", () => {
    const sound = engine("running");
    sound.apply({ ...silence, music: item("a", "tavern", 0) }, 0);
    const element = loaded("a", 120);
    now = 20_000;
    element.currentTime = 19.4;
    sound.apply({ ...silence, music: item("a", "tavern", 20_000) }, now);
    expect(element.currentTime).toBe(19.4);
    element.currentTime = 15;
    sound.apply({ ...silence, music: item("a", "tavern", 20_000) }, now);
    expect(element.currentTime).toBe(20);
  });

  it("plays an effect from its start when heard a moment late, and skips one already over", () => {
    const sound = engine("running");
    sound.apply({ ...silence, effects: [item("t1", "thunder", 150)] }, 0);
    const thunder = loaded("t1", 3);
    expect(thunder.currentTime).toBe(0);
    sound.apply({ ...silence, effects: [item("t1", "thunder", 150), item("d1", "door", 900)] }, 0);
    loaded("d1", 0.8);
    expect(host.querySelector('audio[data-play-id="d1"]')).toBeNull();
  });

  it("tells the GM which sounds this browser can't play", () => {
    const sound = engine("running");
    sound.apply({ ...silence, ambient: [item("x", "odd-file", 0)] }, 0);
    host.querySelector('audio[data-play-id="x"]')!.dispatchEvent(new Event("error"));
    expect(unplayable).toEqual([["odd-file"]]);
    expect(host.querySelector("audio")).toBeNull();
    sound.dispose();
  });
});
