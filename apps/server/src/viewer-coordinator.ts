import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { ViewerConnectionMetadataSchema } from "@vtt/api-contract/schemas";
import type { ScreenSound, SoundScreen, ViewerSoundProjection } from "@vtt/domain";
import { ViewerAccessDeniedError, type ViewerAccessMetadata, type ViewerAccessStore } from "./viewer-access.js";
import type {
  ViewerCamera,
  ViewerCommand,
  ViewerEncounterScene,
  ViewerInitiative,
  ViewerPresentationProjection
} from "./viewer-presentation.js";
import { ROLL_CARD_MS, type ViewerRollCard } from "./viewer-roll.js";
import type { ViewerPresentationStore } from "./viewer-presentation-store.js";

/** What a table screen receives: the stored presentation, plus what the sound board is playing (ADR-0024). */
export type ViewerFeedProjection = ViewerPresentationProjection &
  Readonly<{ sound: ViewerSoundProjection; latestRoll: ViewerRollCard | null }>;
type PresentationListener = (projection: ViewerFeedProjection) => void;
type SoundReport = Readonly<{ sound: Exclude<ScreenSound, "unknown">; unplayable: readonly string[] }>;

const SILENT: ViewerSoundProjection = {
  masterVolume: 0,
  paused: false,
  crossfadeMs: 0,
  music: null,
  ambient: [],
  effects: []
};
type CloseListener = () => void;

type ViewerSubscriber = {
  connectionId: string;
  viewer: ViewerAccessMetadata;
  token: string;
  connectedAt: string;
  listener: PresentationListener;
  close: CloseListener;
};

type GmSubscriber = {
  connectionId: string;
  token: string;
  listener: PresentationListener;
  close: CloseListener;
};

/** A table screen connected right now, under the viewer credential it paired with, and whether it can play sound. */
export type ViewerConnectionMetadata = Readonly<z.infer<typeof ViewerConnectionMetadataSchema>>;

export class ViewerCoordinator {
  private readonly subscribers = new Map<string, ViewerSubscriber>();
  private readonly gmSubscribers = new Map<string, GmSubscriber>();
  private readonly pingTimers = new Set<ReturnType<typeof setTimeout>>();
  /** What each paired screen last said about its sound, by viewer credential. Lost on restart; screens re-report
   *  when they reconnect. */
  private readonly soundReports = new Map<string, SoundReport>();
  private soundSource: (now: number) => ViewerSoundProjection = () => SILENT;
  private rollSource: (since: number | undefined, now: number) => ViewerRollCard | null = () => null;
  /** The card last sent, so a state change that leaves it as it was sends nothing. */
  private sentRoll = "null";
  private rollTimer: ReturnType<typeof setTimeout> | null = null;
  private screensChanged: () => void = () => {};

  constructor(
    private readonly access: ViewerAccessStore,
    private readonly presentation: ViewerPresentationStore,
    private readonly authorizeGm: (token: string | undefined) => boolean,
    private readonly now: () => number = Date.now
  ) {}

  connectViewer(token: string, listener: PresentationListener, close: CloseListener = () => {}) {
    const viewer = this.access.verify(token);
    const connectionId = randomUUID();
    const subscriber: ViewerSubscriber = {
      connectionId,
      viewer,
      token,
      connectedAt: new Date(this.now()).toISOString(),
      listener,
      close
    };
    this.subscribers.set(connectionId, subscriber);
    listener(this.project());
    this.screensChanged();
    return {
      connectionId,
      viewer: structuredClone(viewer),
      disconnect: () => {
        if (this.subscribers.delete(connectionId)) this.screensChanged();
      }
    };
  }

  /** The presentation a screen is sent: the stored one with the sound board's current output. */
  project(now = this.now()): ViewerFeedProjection {
    const presentation = this.presentation.project(now);
    const latestRoll = presentation.enabled ? this.rollSource(this.presentation.snapshot.rollsSince, now) : null;
    return { ...presentation, sound: this.soundSource(now), latestRoll };
  }

  /** Where the latest-roll card comes from: the game's rolls, read as the table screen's audience (ADR-0040). */
  attachRolls(source: (since: number | undefined, now: number) => ViewerRollCard | null) {
    this.rollSource = source;
  }

  /** After the game changed: send the screens a new card, or none, when the card changed; and come back when the
   *  shown one expires, so it doesn't linger until the next change. */
  refreshRoll() {
    const card = this.presentation.snapshot.enabled
      ? this.rollSource(this.presentation.snapshot.rollsSince, this.now())
      : null;
    if (JSON.stringify(card) !== this.sentRoll) this.broadcast();
    if (this.rollTimer !== null) clearTimeout(this.rollTimer);
    this.rollTimer = null;
    if (card === null) return;
    const left = Date.parse(card.at) + ROLL_CARD_MS - this.now();
    this.rollTimer = setTimeout(() => this.refreshRoll(), Math.max(0, left) + 50);
    this.rollTimer.unref?.();
  }

  /** Where the sound comes from, and who to tell when the screens' sound states change (the GM's board). */
  attachSound(source: (now: number) => ViewerSoundProjection, screensChanged: () => void) {
    this.soundSource = source;
    this.screensChanged = screensChanged;
  }

  /** A screen says whether its browser lets it play sound yet, and which sounds it could not play. */
  reportSound(token: string, report: SoundReport) {
    const viewer = this.access.verify(token);
    const previous = this.soundReports.get(viewer.id);
    this.soundReports.set(viewer.id, report);
    if (JSON.stringify(previous) !== JSON.stringify(report)) this.screensChanged();
  }

  /** The connected screens with their sound state, for the GM. */
  soundScreens(): readonly SoundScreen[] {
    return [...this.subscribers.values()].map(({ connectionId, viewer }) => {
      const report = this.soundReports.get(viewer.id);
      return {
        connectionId,
        name: viewer.name,
        sound: report?.sound ?? "unknown",
        unplayable: [...(report?.unplayable ?? [])]
      };
    });
  }

  /** Subscribes the GM's own session to the live presentation the paired screen shows, for an in-tab preview. */
  connectGm(token: string, listener: PresentationListener, close: CloseListener = () => {}) {
    if (!this.authorizeGm(token)) throw new ViewerAccessDeniedError("A valid GM session is required.");
    const connectionId = randomUUID();
    this.gmSubscribers.set(connectionId, { connectionId, token, listener, close });
    listener(this.project());
    return { connectionId, disconnect: () => this.gmSubscribers.delete(connectionId) };
  }

  async executeGm(token: string | undefined, command: Omit<ViewerCommand, "role">) {
    if (!this.authorizeGm(token)) throw new ViewerAccessDeniedError("A valid GM session is required.");
    const result = await this.presentation.execute({ ...command, role: "gm" }, this.now());
    if (!result.duplicate) {
      this.broadcast();
      // Re-broadcast at the soonest ping expiry; otherwise an expired ping lingers until the next state change.
      if (command.payload.type === "viewer.ping") this.schedulePingExpiry();
    }
    return result;
  }

  private schedulePingExpiry() {
    // One pending timer, re-armed from the callback so staggered pings each expire on time.
    for (const timer of this.pingTimers) clearTimeout(timer);
    this.pingTimers.clear();
    const now = this.now();
    const soonest = this.presentation.snapshot.pings
      .map((ping) => ping.expiresAt)
      .filter((expiry) => expiry > now)
      .sort((a, b) => a - b)[0];
    if (soonest === undefined) return;
    const timer = setTimeout(
      () => {
        this.pingTimers.delete(timer);
        this.broadcast();
        this.schedulePingExpiry();
      },
      Math.max(0, soonest - now)
    );
    timer.unref?.();
    this.pingTimers.add(timer);
  }

  dispose() {
    for (const timer of this.pingTimers) clearTimeout(timer);
    this.pingTimers.clear();
    if (this.rollTimer !== null) clearTimeout(this.rollTimer);
    this.rollTimer = null;
  }

  async synchronizeEncounter(
    sourceRevision: number,
    projection: Readonly<{ initiative: ViewerInitiative; encounter: ViewerEncounterScene }>
  ) {
    const current = this.presentation.snapshot;
    if (
      JSON.stringify(current.initiative) === JSON.stringify(projection.initiative) &&
      JSON.stringify(current.encounter) === JSON.stringify(projection.encounter)
    )
      return false;
    const result = await this.presentation.execute(
      {
        id: `encounter-scene:${sourceRevision}:${current.revision}`,
        role: "gm",
        payload: { type: "viewer.encounter.set", ...projection }
      },
      this.now()
    );
    if (!result.duplicate) this.broadcast();
    return !result.duplicate;
  }

  /** Presents a scene's map on the shared screen when the scene goes live (enables presentation and
   *  switches map in one server-internal action), so the screen follows the live scene. Skips when that map is
   *  already presented, to avoid resetting the camera, and while the GM has the screen paused. */
  async presentMap(sourceRevision: number, map: Readonly<{ assetId: string; altText: string; camera: ViewerCamera }>) {
    const current = this.presentation.snapshot;
    if (current.pausedByGm === true) return false;
    // The encounter sync can switch the screen to the new map first, under a placeholder name; the map's own name
    // still has to reach it.
    if (current.enabled && current.activeMap?.assetId === map.assetId && current.activeMap.altText === map.altText)
      return false;
    const result = await this.presentation.execute(
      {
        id: `scene-present:${sourceRevision}:${current.revision}`,
        role: "gm",
        payload: { type: "viewer.presentation.begin", assetId: map.assetId, altText: map.altText, camera: map.camera }
      },
      this.now()
    );
    if (!result.duplicate) this.broadcast();
    return !result.duplicate;
  }

  disconnectViewerAccess(viewerId: string) {
    for (const [connectionId, subscriber] of this.subscribers) {
      if (subscriber.viewer.id !== viewerId) continue;
      this.subscribers.delete(connectionId);
      subscriber.close();
    }
    this.soundReports.delete(viewerId);
    this.screensChanged();
  }

  activeViewers(): readonly ViewerConnectionMetadata[] {
    return [...this.subscribers.values()].map(({ connectionId, viewer, connectedAt }) => ({
      connectionId,
      viewerId: viewer.id,
      name: viewer.name,
      connectedAt,
      sound: this.soundReports.get(viewer.id)?.sound ?? "unknown"
    }));
  }

  broadcast() {
    const projection = this.project();
    this.sentRoll = JSON.stringify(projection.latestRoll);
    for (const [connectionId, subscriber] of this.subscribers) {
      try {
        this.access.verify(subscriber.token);
        subscriber.listener(projection);
      } catch {
        this.subscribers.delete(connectionId);
        subscriber.close();
        this.screensChanged();
      }
    }
    for (const [connectionId, subscriber] of this.gmSubscribers) {
      if (!this.authorizeGm(subscriber.token)) {
        this.gmSubscribers.delete(connectionId);
        subscriber.close();
        continue;
      }
      subscriber.listener(projection);
    }
  }
}
