import type { EncounterToken, EncounterTokenPosition, GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { gridToImage, imageToGrid, type SquareGridCalibration } from "./grid-calibration.js";

export type TokenMapGeometry = Readonly<{
  width: number;
  height: number;
  calibration: SquareGridCalibration | null;
}>;

function positiveDimension(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) throw new CommandRejectedError(`${label} must be a positive finite number.`);
  return value;
}

const rounded = (value: number) => Math.round(value * 1_000) / 1_000;

export function encounterTokenAppearance(geometry: TokenMapGeometry) {
  const width = positiveDimension(geometry.width, "Map width");
  const height = positiveDimension(geometry.height, "Map height");
  const shortestSide = Math.min(width, height);
  if (geometry.calibration) {
    const gridSizePx = geometry.calibration.cellSizePx;
    return { sizePx: rounded(Math.min(shortestSide, gridSizePx * 0.82)), gridSizePx, gridRotationRadians: geometry.calibration.rotationRadians };
  }
  return { sizePx: rounded(Math.min(shortestSide, Math.max(12, Math.min(72, shortestSide / 18)))), gridSizePx: null, gridRotationRadians: null };
}

export function createEncounterTokens(actorIds: readonly string[], geometry: TokenMapGeometry): EncounterToken[] {
  const appearance = encounterTokenAppearance(geometry);
  return actorIds.map((actorId) => ({ actorId, position: null, ...appearance }));
}

/** Adds tokens when upgrading a persisted active encounter created before tokens existed. */
export function ensureEncounterTokens(state: GameState, geometry: TokenMapGeometry) {
  if (!state.combat.active) return false;
  const existing = new Set(state.combat.tokens.map((token) => token.actorId));
  const missing = state.combat.initiative.map((entry) => entry.actorId).filter((actorId) => !existing.has(actorId));
  if (!missing.length) return false;
  state.combat = { ...state.combat, tokens: [...state.combat.tokens, ...createEncounterTokens(missing, geometry)] };
  return true;
}

function bounded(point: EncounterTokenPosition, radius: number, geometry: TokenMapGeometry) {
  const minimumX = Math.min(radius, geometry.width / 2);
  const maximumX = Math.max(minimumX, geometry.width - minimumX);
  const minimumY = Math.min(radius, geometry.height / 2);
  const maximumY = Math.max(minimumY, geometry.height - minimumY);
  return {
    x: Math.min(maximumX, Math.max(minimumX, point.x)),
    y: Math.min(maximumY, Math.max(minimumY, point.y))
  };
}

function fits(point: EncounterTokenPosition, radius: number, geometry: TokenMapGeometry) {
  return point.x >= radius && point.y >= radius && point.x <= geometry.width - radius && point.y <= geometry.height - radius;
}

function snappedPosition(point: EncounterTokenPosition, radius: number, geometry: TokenMapGeometry) {
  const requested = bounded(point, radius, geometry);
  if (!geometry.calibration) return { x: rounded(requested.x), y: rounded(requested.y) };

  const grid = imageToGrid(geometry.calibration, requested);
  const baseColumn = Math.floor(grid.column);
  const baseRow = Math.floor(grid.row);
  const candidates: EncounterTokenPosition[] = [];
  for (let columnOffset = -4; columnOffset <= 4; columnOffset++) {
    for (let rowOffset = -4; rowOffset <= 4; rowOffset++) {
      const candidate = gridToImage(geometry.calibration, { column: baseColumn + columnOffset + 0.5, row: baseRow + rowOffset + 0.5 });
      if (fits(candidate, radius, geometry)) candidates.push(candidate);
    }
  }
  candidates.sort((left, right) => Math.hypot(left.x - requested.x, left.y - requested.y) - Math.hypot(right.x - requested.x, right.y - requested.y));
  const nearest = candidates[0];
  return nearest ? { x: rounded(nearest.x), y: rounded(nearest.y) } : { x: rounded(requested.x), y: rounded(requested.y) };
}

export function moveEncounterToken(state: GameState, actorId: string, position: EncounterTokenPosition | null, geometry: TokenMapGeometry) {
  if (!state.combat.active) throw new CommandRejectedError("Start an encounter before moving tokens.");
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
  if (!token) throw new CommandRejectedError("That combatant does not have a token in this encounter.");
  if (position && (!Number.isFinite(position.x) || !Number.isFinite(position.y))) throw new CommandRejectedError("Token position must contain finite coordinates.");
  const nextPosition = position === null ? null : snappedPosition(position, token.sizePx / 2, geometry);
  state.combat = {
    ...state.combat,
    tokens: state.combat.tokens.map((candidate) => candidate.actorId === actorId ? { ...candidate, position: nextPosition } : candidate)
  };
}
