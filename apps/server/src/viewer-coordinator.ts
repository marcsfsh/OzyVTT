import { randomUUID } from "node:crypto";
import { ViewerAccessDeniedError, type ViewerAccessMetadata, type ViewerAccessStore } from "./viewer-access.js";
import type { ViewerCommand, ViewerEncounterScene, ViewerInitiative, ViewerPresentationProjection } from "./viewer-presentation.js";
import type { ViewerPresentationStore } from "./viewer-presentation-store.js";

type PresentationListener = (projection: ViewerPresentationProjection) => void;
type CloseListener = () => void;

type ViewerSubscriber = {
  connectionId: string;
  viewer: ViewerAccessMetadata;
  token: string;
  connectedAt: string;
  listener: PresentationListener;
  close: CloseListener;
};

export type ViewerConnectionMetadata = Readonly<{
  connectionId: string;
  viewerId: string;
  name: string;
  connectedAt: string;
}>;

export class ViewerCoordinator {
  private readonly subscribers = new Map<string, ViewerSubscriber>();

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
    listener(this.presentation.project(this.now()));
    return {
      connectionId,
      viewer: structuredClone(viewer),
      disconnect: () => this.subscribers.delete(connectionId)
    };
  }

  async executeGm(token: string | undefined, command: Omit<ViewerCommand, "role">) {
    if (!this.authorizeGm(token)) throw new ViewerAccessDeniedError("A valid GM session is required.");
    const result = await this.presentation.execute({ ...command, role: "gm" }, this.now());
    if (!result.duplicate) this.broadcast();
    return result;
  }

  async synchronizeInitiative(sourceRevision: number, initiative: ViewerInitiative) {
    const current = this.presentation.snapshot;
    if (JSON.stringify(current.initiative) === JSON.stringify(initiative)) return false;
    const result = await this.presentation.execute({
      id: `encounter-initiative:${sourceRevision}:${current.revision}`,
      role: "gm",
      payload: { type: "viewer.initiative.set", initiative }
    }, this.now());
    if (!result.duplicate) this.broadcast();
    return !result.duplicate;
  }

  async synchronizeEncounter(sourceRevision: number, projection: Readonly<{ initiative: ViewerInitiative; encounter: ViewerEncounterScene }>) {
    const current = this.presentation.snapshot;
    if (JSON.stringify(current.initiative) === JSON.stringify(projection.initiative)
      && JSON.stringify(current.encounter) === JSON.stringify(projection.encounter)) return false;
    const result = await this.presentation.execute({
      id: `encounter-scene:${sourceRevision}:${current.revision}`,
      role: "gm",
      payload: { type: "viewer.encounter.set", ...projection }
    }, this.now());
    if (!result.duplicate) this.broadcast();
    return !result.duplicate;
  }

  disconnectViewerAccess(viewerId: string) {
    for (const [connectionId, subscriber] of this.subscribers) {
      if (subscriber.viewer.id !== viewerId) continue;
      this.subscribers.delete(connectionId);
      subscriber.close();
    }
  }

  activeViewers(): readonly ViewerConnectionMetadata[] {
    return [...this.subscribers.values()].map(({ connectionId, viewer, connectedAt }) => ({ connectionId, viewerId: viewer.id, name: viewer.name, connectedAt }));
  }

  broadcast() {
    const projection = this.presentation.project(this.now());
    for (const [connectionId, subscriber] of this.subscribers) {
      try {
        this.access.verify(subscriber.token);
        subscriber.listener(projection);
      } catch {
        this.subscribers.delete(connectionId);
        subscriber.close();
      }
    }
  }
}
