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
  /** Coarse band only - exact hit points never reach the shared screen. */
  health: "healthy" | "bloodied" | "down";
  /** Display labels ("Prone", "Exhaustion 3") for public combatants. */
  conditions: readonly string[];
  /** Content-bundle condition ids parallel to `conditions` so the initiative row picks the same glyphs as the table (labels are already public; ids add nothing hidden). */
  conditionIds?: readonly string[];
}>;

/** The fog mask exactly as the table renders it (geometry only; hidden tokens never reach the viewer anyway). */
export type ViewerFog = Readonly<{ enabled: boolean; shapes: readonly Readonly<{ kind: "rect"; id: string; op: "reveal" | "hide"; x: number; y: number; width: number; height: number }>[] }>;

export type ViewerInitiative = Readonly<{
  visible: boolean;
  round: number;
  hiddenTurn: boolean;
  entries: readonly ViewerInitiativeEntry[];
}>;

export type ViewerEncounterToken = Readonly<{
  actorId: string;
  name: string;
  kind: "player-character" | "monster" | "npc";
  position: ImagePoint;
  sizePx: number;
  active: boolean;
  health: "healthy" | "bloodied" | "down";
  conditions: readonly string[];
  /** Content-bundle condition ids parallel to `conditions` - the viewer picks glyphs by id (labels are already public; ids add nothing hidden). */
  conditionIds?: readonly string[];
  /** Present only when the GM shows a richer indicator to everyone (audience "all"); the viewer derives the fill fraction from `health` (band) - exact HP never reaches the shared screen. */
  healthDisplay?: Readonly<{ style: "bar" | "ring" | "aura" }>;
  tokenAssetId?: string;
}>;

/** Player-safe drawing shown on the shared screen - only `public` annotations are ever projected here. */
export type ViewerAnnotation = Readonly<{
  id: string;
  kind: "measurement" | "shape" | "ping";
  shape: "circle" | "cone" | "line" | "square" | null;
  origin: ImagePoint;
  target: ImagePoint;
  sizeFeet: number;
  color: string;
  label: string | null;
}>;

export type ViewerEncounterScene = Readonly<{
  mapAssetId: string | null;
  tokens: readonly ViewerEncounterToken[];
  annotations: readonly ViewerAnnotation[];
  /** Absent = no fog (older servers); the viewer renders the mask above everything. */
  fog?: ViewerFog;
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
  encounter: ViewerEncounterScene;
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
  encounter: ViewerEncounterScene;
}>;

type ViewerCommandPayload =
  | Readonly<{ type: "viewer.enabled.set"; enabled: boolean }>
  | Readonly<{ type: "viewer.presentation.begin"; assetId: string; altText: string; camera: ViewerCamera }>
  | Readonly<{ type: "viewer.map.set"; assetId: string; altText: string; camera: ViewerCamera }>
  | Readonly<{ type: "viewer.camera.set"; camera: ViewerCamera }>
  | Readonly<{ type: "viewer.measurement.set"; measurement: ViewerMeasurement }>
  | Readonly<{ type: "viewer.measurement.clear" }>
  | Readonly<{ type: "viewer.ping"; id: string; point: ImagePoint; label?: string; durationMs?: number }>
  | Readonly<{ type: "viewer.initiative.set"; initiative: ViewerInitiative }>
  | Readonly<{ type: "viewer.encounter.set"; initiative: ViewerInitiative; encounter: ViewerEncounterScene }>;

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
    return { actorId, name: safeText(entry.name, "Initiative name", 100), initiative: entry.initiative, active: entry.active, health: healthBand(entry.health), conditions: conditionList(entry.conditions), ...(entry.conditionIds ? { conditionIds: conditionIdList(entry.conditionIds) } : {}) };
  });
  if (activeEntries > 1) throw new Error("Viewer initiative can have at most one active entry.");
  const hiddenTurn = value.hiddenTurn ?? false;
  if (hiddenTurn && activeEntries > 0) throw new Error("Viewer initiative cannot expose a public active entry during a hidden turn.");
  return { visible: value.visible, round: value.round, hiddenTurn, entries };
}

/** Persisted viewer state is re-validated on load; unknown bands fall back to healthy and condition labels stay bounded. */
function healthBand(value: unknown): "healthy" | "bloodied" | "down" {
  return value === "bloodied" || value === "down" ? value : "healthy";
}
function conditionList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((label) => safeText(String(label), "Condition label", 60));
}

function conditionIdList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((id) => {
    const text = String(id);
    if (!/^[a-z0-9-]{1,60}$/.test(text)) throw new Error("Condition ids must be lowercase content-bundle slugs.");
    return text;
  });
}

/** The shared screen only ever receives the richer bar/ring style (band is a table-client fallback, never sent). */
function healthDisplayStyle(value: unknown): "bar" | "ring" | "aura" {
  if (value === "bar" || value === "ring" || value === "aura") return value;
  throw new Error("Viewer token health display style must be \"bar\" or \"ring\".");
}

function encounter(value: ViewerEncounterScene): ViewerEncounterScene {
  const mapAssetId = value.mapAssetId === null ? null : safeText(value.mapAssetId, "Encounter map asset ID", 128);
  if (value.tokens.length > 200) throw new Error("Viewer encounter cannot exceed 200 tokens.");
  const actorIds = new Set<string>();
  let activeTokens = 0;
  const tokens = value.tokens.map((token) => {
    const actorId = safeText(token.actorId, "Viewer token actor ID", 128);
    if (actorIds.has(actorId)) throw new Error("Viewer token actor IDs must be unique.");
    actorIds.add(actorId);
    if (token.active) activeTokens++;
    if (token.kind !== "player-character" && token.kind !== "monster" && token.kind !== "npc") throw new Error("Viewer token kind is invalid.");
    if (!Number.isFinite(token.sizePx) || token.sizePx <= 0 || token.sizePx > 4096) throw new Error("Viewer token size is invalid.");
    return { actorId, name: safeText(token.name, "Viewer token name", 120), kind: token.kind, position: point(token.position, "Viewer token position"), sizePx: token.sizePx, active: token.active, health: healthBand(token.health), conditions: conditionList(token.conditions), ...(token.conditionIds ? { conditionIds: conditionIdList(token.conditionIds) } : {}), ...(token.healthDisplay ? { healthDisplay: { style: healthDisplayStyle(token.healthDisplay.style) } } : {}) };
  });
  if (activeTokens > 1) throw new Error("Viewer encounter can have at most one active token.");
  if (mapAssetId === null && tokens.length) throw new Error("Viewer tokens require an active encounter map.");
  const rawAnnotations = value.annotations ?? [];
  if (rawAnnotations.length > 300) throw new Error("Viewer encounter cannot exceed 300 annotations.");
  const annotationIds = new Set<string>();
  const annotations = rawAnnotations.map((annotation) => {
    const id = safeText(annotation.id, "Viewer annotation ID", 128);
    if (annotationIds.has(id)) throw new Error("Viewer annotation IDs must be unique.");
    annotationIds.add(id);
    if (annotation.kind !== "measurement" && annotation.kind !== "shape" && annotation.kind !== "ping") throw new Error("Viewer annotation kind is invalid.");
    if (annotation.shape !== null && !(["circle", "cone", "line", "square"] as const).includes(annotation.shape)) throw new Error("Viewer annotation shape is invalid.");
    if (!Number.isFinite(annotation.sizeFeet) || annotation.sizeFeet < 0 || annotation.sizeFeet > 100_000) throw new Error("Viewer annotation size is invalid.");
    if (typeof annotation.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(annotation.color)) throw new Error("Viewer annotation color is invalid.");
    const label = annotation.label === null || annotation.label === undefined ? null : safeText(annotation.label, "Viewer annotation label", 60);
    return { id, kind: annotation.kind, shape: annotation.shape, origin: point(annotation.origin, "Viewer annotation origin"), target: point(annotation.target, "Viewer annotation target"), sizeFeet: annotation.sizeFeet, color: annotation.color, label };
  });
  if (mapAssetId === null && annotations.length) throw new Error("Viewer annotations require an active encounter map.");
  const fog = value.fog === undefined ? undefined : sanitizedFog(value.fog);
  return { mapAssetId, tokens, annotations, ...(fog ? { fog } : {}) };
}

function sanitizedFog(value: ViewerFog): ViewerFog {
  if (typeof value.enabled !== "boolean") throw new Error("Viewer fog enabled flag is invalid.");
  const rawShapes = value.shapes ?? [];
  if (rawShapes.length > 200) throw new Error("Viewer fog cannot exceed 200 shapes.");
  const shapes = rawShapes.map((shape) => {
    if (shape.kind !== "rect" || shape.op !== "reveal" && shape.op !== "hide") throw new Error("Viewer fog shape is invalid.");
    for (const bound of [shape.x, shape.y, shape.width, shape.height]) if (!Number.isFinite(bound) || bound < 0 || bound > 1_000_000) throw new Error("Viewer fog geometry is invalid.");
    return { kind: "rect" as const, id: safeText(shape.id, "Viewer fog shape ID", 128), op: shape.op, x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  });
  return { enabled: value.enabled, shapes };
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
    encounter: { mapAssetId: null, tokens: [], annotations: [] },
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
  else if (payload.type === "viewer.encounter.set") {
    const scene = encounter(payload.encounter);
    // Combat-first: while an encounter is live (it carries a map), the shared screen follows that map
    // automatically, so the image never lags behind the fight and the GM needn't re-present on every
    // scene switch. When combat ends (no map), the last-shown map stays until the GM changes it.
    const activeMap = scene.mapAssetId
      ? { assetId: scene.mapAssetId, altText: state.activeMap?.assetId === scene.mapAssetId ? state.activeMap.altText : "Battle map" }
      : state.activeMap;
    next = { ...state, initiative: initiative(payload.initiative), encounter: scene, activeMap };
  }

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
    initiative: { visible: false, round: 0, hiddenTurn: false, entries: [] },
    encounter: { mapAssetId: null, tokens: [], annotations: [] }
  };
  return {
    schemaVersion: 1,
    revision: state.revision,
    enabled: true,
    activeMap: state.activeMap,
    camera: state.camera,
    measurement: state.measurement,
    pings: state.pings.filter((ping) => ping.expiresAt > now),
    initiative: state.initiative.visible ? state.initiative : { visible: false, round: state.initiative.round, hiddenTurn: false, entries: [] },
    encounter: state.encounter
  };
}
