import type { ViewerSoundItem, ViewerSoundProjection } from "@vtt/domain";

/**
 * Plays the table's sound on the table screen (ADR-0024). The server says what plays and how far in it is; this
 * keeps the browser's audio in step with that: each sound is an <audio> element streaming its file, routed through
 * its own gain into one master gain so fades and volume changes are smooth. It never decides anything: what plays
 * next, and when, arrives in the next projection.
 *
 * Browsers hold sound back until a person interacts with the page. Until then the engine is `blocked`: it loads
 * and positions what should play, and starts it all on `unlock`, which a tap on the screen calls.
 */

export type SoundEngineStatus = "on" | "blocked";
type Kind = "music" | "ambient" | "effect";
type VoiceState = "loading" | "ready" | "playing" | "leaving";

type Voice = {
  readonly playId: string;
  readonly assetId: string;
  readonly kind: Kind;
  readonly element: HTMLAudioElement;
  readonly gain: GainNode | null;
  volume: number;
  /** Where the file should be, in ms, at local time `at`. */
  anchor: Readonly<{ positionMs: number; at: number }>;
  fadeInMs: number;
  state: VoiceState;
};

export type SoundEngineHooks = Readonly<{
  /** Where the hidden <audio> elements live. */
  host: HTMLElement;
  createElement: () => HTMLAudioElement;
  /** Null where the browser has no Web Audio; then volume is set on each element and nothing fades. */
  createContext: () => AudioContext | null;
  /** A monotonic clock in ms, the same one `apply`'s `receivedAt` was read from. */
  now: () => number;
  src: (assetId: string) => string;
  onStatus: (status: SoundEngineStatus) => void;
  onUnplayable: (assetIds: readonly string[]) => void;
}>;

/** A sound that was stopped fades out over this long rather than cutting off. */
const STOP_FADE_MS = 500;
const LEVEL_RAMP_MS = 150;
const PAUSE_FADE_MS = 200;
/** A sound this far from where the server says it should be is moved there; less is left alone, since a seek is
 *  audible and the browser's own clock wanders a little. */
const DRIFT_LIMIT_MS = 1_500;
/** An effect heard this late still plays from its start: its attack matters more than a few ms of timing. */
const EFFECT_GRACE_MS = 400;

/** Levels are stored as set; loudness follows roughly the square of a slider's travel. */
const loudness = (level: number) => Math.max(0, Math.min(1, level)) ** 2;

export class TableSoundEngine {
  private readonly voices = new Map<string, Voice>();
  private readonly context: AudioContext | null;
  private readonly master: GainNode | null = null;
  private masterVolume = 0;
  private paused = false;
  private crossfadeMs = 2_000;
  private status: SoundEngineStatus;
  private readonly unplayable = new Set<string>();
  /** Plays that already ran to their end here, so a projection sent a moment before the server moved on doesn't
   *  load them again. */
  private readonly finished = new Set<string>();
  private disposed = false;

  constructor(private readonly hooks: SoundEngineHooks) {
    this.context = hooks.createContext();
    if (this.context) {
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
      this.context.addEventListener("statechange", () => this.followContext());
    }
    // Without Web Audio the first refused `play()` is what says the browser is holding sound back.
    this.status = !this.context || this.context.state === "running" ? "on" : "blocked";
  }

  get currentStatus() {
    return this.status;
  }

  /** Follows a projection received at local time `receivedAt`. */
  apply(sound: ViewerSoundProjection, receivedAt: number) {
    if (this.disposed) return;
    this.crossfadeMs = sound.crossfadeMs || this.crossfadeMs;
    this.setMaster(sound.masterVolume);
    const wanted: Array<readonly [Kind, ViewerSoundItem]> = [
      ...(sound.music ? [["music", sound.music] as const] : []),
      ...sound.ambient.map((item) => ["ambient", item] as const),
      ...sound.effects.map((item) => ["effect", item] as const)
    ];
    const wantedIds = new Set(wanted.map(([, item]) => item.playId));
    const musicPlaying = [...this.voices.values()].some((voice) => voice.kind === "music" && voice.state !== "leaving");
    const musicChanges = sound.music !== null && !this.voices.has(sound.music.playId);
    for (const voice of [...this.voices.values()])
      if (!wantedIds.has(voice.playId) && voice.state !== "leaving")
        this.release(voice, voice.kind === "music" && musicChanges ? this.crossfadeMs : STOP_FADE_MS);
    const pauseChanged = sound.paused !== this.paused;
    this.paused = sound.paused;
    for (const [kind, item] of wanted) {
      const anchor = { positionMs: item.positionMs, at: receivedAt };
      const voice = this.voices.get(item.playId);
      if (!voice && this.finished.has(item.playId)) continue;
      if (!voice) {
        // A new track crossfades in over the old one; a first track or a new layer eases in; an effect hits at once.
        const fadeInMs = kind === "effect" ? 0 : kind === "music" && musicPlaying ? this.crossfadeMs : 800;
        this.create(kind, item, anchor, fadeInMs);
        continue;
      }
      voice.anchor = anchor;
      voice.volume = item.volume;
      if (pauseChanged) {
        if (this.paused) this.hold(voice);
        else this.start(voice);
      } else {
        this.correctDrift(voice);
        this.ramp(voice, LEVEL_RAMP_MS);
      }
    }
  }

  /** Lets sound play: called from a tap, so `play()` runs inside the gesture the browser was waiting for. */
  unlock() {
    if (this.disposed) return;
    const resumed = this.context?.resume();
    this.setStatus("on");
    for (const voice of this.voices.values()) if (voice.state === "ready") this.start(voice);
    void resumed?.then(
      () => this.followContext(),
      () => this.setStatus("blocked")
    );
  }

  dispose() {
    this.disposed = true;
    for (const voice of [...this.voices.values()]) this.discard(voice);
    void this.context?.close().catch(() => {});
  }

  private followContext() {
    if (!this.context || this.disposed) return;
    if (this.context.state === "running") {
      this.setStatus("on");
      for (const voice of this.voices.values()) if (voice.state === "ready") this.start(voice);
    } else this.setStatus("blocked");
  }

  private setStatus(status: SoundEngineStatus) {
    if (status === this.status) return;
    this.status = status;
    this.hooks.onStatus(status);
  }

  private setMaster(level: number) {
    this.masterVolume = level;
    if (this.master && this.context) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(loudness(level), now + LEVEL_RAMP_MS / 1_000);
    } else for (const voice of this.voices.values()) this.ramp(voice, 0);
  }

  private create(kind: Kind, item: ViewerSoundItem, anchor: Voice["anchor"], fadeInMs: number) {
    const element = this.hooks.createElement();
    element.preload = "auto";
    element.loop = kind === "ambient";
    // Read by the browser check and handy in devtools: which play of which file this element is.
    element.dataset.kind = kind;
    element.dataset.playId = item.playId;
    element.dataset.assetId = item.assetId;
    let gain: GainNode | null = null;
    if (this.context && this.master) {
      gain = this.context.createGain();
      gain.gain.value = 0;
      this.context.createMediaElementSource(element).connect(gain);
      gain.connect(this.master);
    } else element.volume = 0;
    const voice: Voice = {
      playId: item.playId,
      assetId: item.assetId,
      kind,
      element,
      gain,
      volume: item.volume,
      anchor,
      fadeInMs,
      state: "loading"
    };
    this.voices.set(item.playId, voice);
    element.addEventListener("loadedmetadata", () => {
      if (voice.state !== "loading") return;
      voice.state = "ready";
      this.start(voice);
    });
    element.addEventListener("error", () => this.failed(voice));
    element.addEventListener("ended", () => {
      if (voice.kind !== "ambient") this.finish(voice);
    });
    element.addEventListener("playing", () => {
      if (this.unplayable.delete(voice.assetId)) this.hooks.onUnplayable([...this.unplayable]);
    });
    this.hooks.host.append(element);
    element.src = this.hooks.src(item.assetId);
  }

  /** Where the file should be now, or null when a track or effect is already over. */
  private position(voice: Voice) {
    const elapsed = this.paused ? 0 : this.hooks.now() - voice.anchor.at;
    const position = voice.anchor.positionMs + Math.max(0, elapsed);
    const durationMs = Number.isFinite(voice.element.duration) ? voice.element.duration * 1_000 : null;
    if (voice.kind === "ambient") return durationMs ? position % durationMs : position;
    if (durationMs !== null && position >= durationMs - 50) return null;
    return voice.kind === "effect" && position < EFFECT_GRACE_MS ? 0 : position;
  }

  private start(voice: Voice) {
    if (voice.state === "loading" || voice.state === "leaving" || this.disposed) return;
    const position = this.position(voice);
    if (position === null) return this.finish(voice);
    if (this.paused || this.status === "blocked") {
      // Wait at the right spot, ready to go.
      voice.element.currentTime = position / 1_000;
      return;
    }
    voice.element.currentTime = position / 1_000;
    voice.state = "playing";
    this.ramp(voice, voice.fadeInMs);
    const played = voice.element.play() as Promise<void> | undefined;
    played?.catch((error: unknown) => {
      if (voice.state !== "playing") return;
      voice.state = "ready";
      if ((error as Error).name === "NotAllowedError") this.setStatus("blocked");
    });
  }

  private hold(voice: Voice) {
    if (voice.state !== "playing") return;
    voice.state = "ready";
    this.rampTo(voice, 0, PAUSE_FADE_MS);
    setTimeout(() => {
      if (voice.state === "ready") voice.element.pause();
    }, PAUSE_FADE_MS);
  }

  private correctDrift(voice: Voice) {
    if (voice.state !== "playing") return;
    const expected = this.position(voice);
    if (expected === null) return;
    const durationMs = Number.isFinite(voice.element.duration) ? voice.element.duration * 1_000 : null;
    let drift = Math.abs(expected - voice.element.currentTime * 1_000);
    if (voice.kind === "ambient" && durationMs) drift = Math.min(drift, durationMs - drift);
    if (drift > DRIFT_LIMIT_MS) voice.element.currentTime = expected / 1_000;
  }

  private release(voice: Voice, fadeMs: number) {
    const wasPlaying = voice.state === "playing";
    voice.state = "leaving";
    if (!wasPlaying) return this.discard(voice);
    this.rampTo(voice, 0, fadeMs);
    setTimeout(() => this.discard(voice), fadeMs + 50);
  }

  private ramp(voice: Voice, ms: number) {
    this.rampTo(voice, voice.state === "playing" ? loudness(voice.volume) : 0, ms);
  }

  private rampTo(voice: Voice, target: number, ms: number) {
    if (voice.gain && this.context) {
      const now = this.context.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      if (ms > 0) voice.gain.gain.linearRampToValueAtTime(target, now + ms / 1_000);
      else voice.gain.gain.setValueAtTime(target, now);
    } else voice.element.volume = target * loudness(this.masterVolume);
  }

  private failed(voice: Voice) {
    if (voice.state !== "leaving" && !this.disposed) {
      this.unplayable.add(voice.assetId);
      this.hooks.onUnplayable([...this.unplayable]);
    }
    this.discard(voice);
  }

  private finish(voice: Voice) {
    this.finished.add(voice.playId);
    // Only the latest few matter: a play the server has moved past is never sent again.
    if (this.finished.size > 64) this.finished.delete(this.finished.values().next().value!);
    this.discard(voice);
  }

  private discard(voice: Voice) {
    if (this.voices.get(voice.playId) !== voice) return;
    this.voices.delete(voice.playId);
    voice.state = "leaving";
    voice.element.pause();
    voice.element.removeAttribute("src");
    voice.gain?.disconnect();
    voice.element.remove();
  }
}
