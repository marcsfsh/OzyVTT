import type { ImagePoint } from "./grid-calibration.js";

export type ViewerCamera = Readonly<{
  center: ImagePoint;
  zoom: number;
}>;

export type ViewerMeasurement = Readonly<{
  id: string;
  points: readonly ImagePoint[];
  distanceLabel: string;
}>;

export type ViewerPing = Readonly<{
  id: string;
  point: ImagePoint;
  label?: string;
  createdAt: number;
  expiresAt: number;
}>;

export type ViewerInitiativeEntry = Readonly<{
  actorId: string;
  name: string;
  initiative: number;
  active: boolean;
}>;

export type ViewerInitiative = Readonly<{
  visible: boolean;
  round: number;
  hiddenTurn: boolean;
  entries: readonly ViewerInitiativeEntry[];
}>;

export type ViewerPresentationState = Readonly<{
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  activeMap: Readonly<{ assetId: string; altText: string }> | null;
  camera: ViewerCamera | null;
  measurement: ViewerMeasurement | null;
  pings: readonly ViewerPing[];
  initiative: ViewerInitiative;
  acceptedCommandIds: readonly string[];
}>;

export type ViewerPresentationProjection = Readonly<{
  schemaVersion: 1;
  revision: number;
  enabled: boolean;
  activeMap: ViewerPresentationState["activeMap"];
  camera: ViewerCamera | null;
  measurement: ViewerMeasurement | null;
  pings: readonly ViewerPing[];
  initiative: ViewerInitiative;
}>;

type ViewerCommandPayload =
  | Readonly<{ type: "viewer.enabled.set"; enabled: boolean }>
  | Readonly<{ type: "viewer.presentation.begin"; assetId: string; altText: string; camera: ViewerCamera }>
  | Readonly<{ type: "viewer.map.set"; assetId: string; altText: string; camera: ViewerCamera }>
  | Readonly<{ type: "viewer.camera.set"; camera: ViewerCamera }>
  | Readonly<{ type: "viewer.measurement.set"; measurement: ViewerMeasurement }>
  | Readonly<{ type: "viewer.measurement.clear" }>
  | Readonly<{ type: "viewer.ping"; id: string; point: ImagePoint; label?: string; durationMs?: number }>
  | Readonly<{ type: "viewer.initiative.set"; initiative: ViewerInitiative }>;

export type ViewerCommand = Readonly<{
  id: string;
  expectedRevision?: number;
  role: "gm" | "player" | "viewer" | "integration";
  payload: ViewerCommandPayload;
}>;

export class ViewerAuthorizationError extends Error {}
export class ViewerRevisionConflictError extends Error {}

const MAX_COMMAND_RECEIPTS = 500;
const DEFAULT_PING_DURATION_MS = 2_500;
const MAX_PING_DURATION_MS = 30_000;

function safeText(value: string, label: string, maximum: number, allowEmpty = false) {
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(`${label} must contain ${allowEmpty ? "0" : "1"} to ${maximum} printable characters.`);
  return text;
}

function point(value: ImagePoint, label: string) {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error(`${label} must contain finite coordinates.`);
  return { x: value.x, y: value.y };
}

function camera(value: ViewerCamera) {
  if (!Number.isFinite(value.zoom) || value.zoom < 0.01 || value.zoom > 64) throw new Error("Viewer camera zoom must be between 0.01 and 64.");
  return { center: point(value.center, "Viewer camera center"), zoom: value.zoom };
}

function measurement(value: ViewerMeasurement): ViewerMeasurement {
  if (value.points.length < 2 || value.points.length > 1_000) throw new Error("Viewer measurement requires 2 to 1,000 points.");
  return {
    id: safeText(value.id, "Measurement ID", 128),
    points: value.points.map((item, index) => point(item, `Measurement point ${index + 1}`)),
    distanceLabel: safeText(value.distanceLabel, "Measurement distance label", 64)
  };
}

function initiative(value: ViewerInitiative): ViewerInitiative {
  if (!Number.isInteger(value.round) || value.round < 0) throw new Error("Initiative round must be a non-negative integer.");
  if (value.entries.length > 200) throw new Error("Viewer initiative cannot exceed 200 entries.");
  const actorIds = new Set<string>();
  let activeEntries = 0;
  const entries = value.entries.map((entry) => {
    const actorId = safeText(entry.actorId, "Initiative actor ID", 128);
    if (actorIds.has(actorId)) throw new Error("Viewer initiative actor IDs must be unique.");
    actorIds.add(actorId);
    if (!Number.isFinite(entry.initiative)) throw new Error("Initiative value must be finite.");
    if (entry.active) activeEntries++;
    return { actorId, name: safeText(entry.name, "Initiative name", 100), initiative: entry.initiative, active: entry.active };
  });
  if (activeEntries > 1) throw new Error("Viewer initiative can have at most one active entry.");
  const hiddenTurn = value.hiddenTurn ?? false;
  if (hiddenTurn && activeEntries > 0) throw new Error("Viewer initiative cannot expose a public active entry during a hidden turn.");
  return { visible: value.visible, round: value.round, hiddenTurn, entries };
}

export function createViewerPresentationState(): ViewerPresentationState {
  return {
    schemaVersion: 1,
    revision: 0,
    enabled: false,
    activeMap: null,
    camera: null,
    measurement: null,
    pings: [],
    initiative: { visible: false, round: 0, hiddenTurn: false, entries: [] },
    acceptedCommandIds: []
  };
}

export function applyViewerCommand(state: ViewerPresentationState, command: ViewerCommand, now = Date.now()) {
  if (command.role !== "gm") throw new ViewerAuthorizationError("Only the GM can control viewer presentation state.");
  const commandId = safeText(command.id, "Viewer command ID", 128);
  if (state.acceptedCommandIds.includes(commandId)) return { state, duplicate: true } as const;
  if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) throw new ViewerRevisionConflictError("Viewer presentation revision is outdated.");
  if (!Number.isFinite(now) || now < 0) throw new Error("Viewer command time must be a non-negative finite number.");

  let next: ViewerPresentationState = state;
  const payload = command.payload;
  if (payload.type === "viewer.enabled.set") next = { ...state, enabled: payload.enabled };
  else if (payload.type === "viewer.presentation.begin") next = {
    ...state,
    enabled: true,
    activeMap: { assetId: safeText(payload.assetId, "Map asset ID", 128), altText: safeText(payload.altText, "Map alternative text", 300, true) },
    camera: camera(payload.camera),
    measurement: null,
    pings: []
  };
  else if (payload.type === "viewer.map.set") next = {
    ...state,
    activeMap: { assetId: safeText(payload.assetId, "Map asset ID", 128), altText: safeText(payload.altText, "Map alternative text", 300, true) },
    camera: camera(payload.camera),
    measurement: null,
    pings: []
  };
  else if (payload.type === "viewer.camera.set") {
    if (!state.activeMap) throw new Error("Select a viewer map before moving its camera.");
    next = { ...state, camera: camera(payload.camera) };
  } else if (payload.type === "viewer.measurement.set") {
    if (!state.activeMap) throw new Error("Select a viewer map before showing a measurement.");
    next = { ...state, measurement: measurement(payload.measurement) };
  } else if (payload.type === "viewer.measurement.clear") next = { ...state, measurement: null };
  else if (payload.type === "viewer.ping") {
    if (!state.activeMap) throw new Error("Select a viewer map before showing a ping.");
    const durationMs = payload.durationMs ?? DEFAULT_PING_DURATION_MS;
    if (!Number.isInteger(durationMs) || durationMs < 250 || durationMs > MAX_PING_DURATION_MS) throw new Error(`Viewer ping duration must be an integer from 250 to ${MAX_PING_DURATION_MS} milliseconds.`);
    const ping: ViewerPing = {
      id: safeText(payload.id, "Ping ID", 128),
      point: point(payload.point, "Ping point"),
      ...(payload.label === undefined ? {} : { label: safeText(payload.label, "Ping label", 80) }),
      createdAt: now,
      expiresAt: now + durationMs
    };
    next = { ...state, pings: [...state.pings.filter((item) => item.id !== ping.id && item.expiresAt > now), ping].slice(-20) };
  } else if (payload.type === "viewer.initiative.set") next = { ...state, initiative: initiative(payload.initiative) };

  next = {
    ...next,
    revision: state.revision + 1,
    acceptedCommandIds: [...state.acceptedCommandIds, commandId].slice(-MAX_COMMAND_RECEIPTS)
  };
  return { state: next, duplicate: false } as const;
}

export function projectViewerPresentation(state: ViewerPresentationState, now = Date.now()): ViewerPresentationProjection {
  if (!Number.isFinite(now) || now < 0) throw new Error("Viewer projection time must be a non-negative finite number.");
  if (!state.enabled) return {
    schemaVersion: 1,
    revision: state.revision,
    enabled: false,
    activeMap: null,
    camera: null,
    measurement: null,
    pings: [],
    initiative: { visible: false, round: 0, hiddenTurn: false, entries: [] }
  };
  return {
    schemaVersion: 1,
    revision: state.revision,
    enabled: true,
    activeMap: state.activeMap,
    camera: state.camera,
    measurement: state.measurement,
    pings: state.pings.filter((ping) => ping.expiresAt > now),
    initiative: state.initiative.visible ? state.initiative : { visible: false, round: state.initiative.round, hiddenTurn: false, entries: [] }
  };
}
