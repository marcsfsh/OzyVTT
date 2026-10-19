import type { GameState } from "@vtt/domain";
import { addAnnotation } from "../src/annotations.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { zonesAfterMove, type ZoneDeps } from "../src/spell-zones.js";
import { createEncounterTokens, type TokenMapGeometry } from "../src/token-placement.js";
import { catalog } from "./spell-casters.js";

/**
 * A measured map and the moves, areas and saves the spell-area tests share: 50px cells of 5 feet, so cell (c,r) has its
 * centre at (25 + 50c, 25 + 50r).
 */

export const GRID: TokenMapGeometry = {
  width: 3000,
  height: 3000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
/** The battle map the `fight` fixture starts its encounter on. */
export const MAP = "20000000-0000-5000-8000-000000000001";
export const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
export const GM = { role: "gm" } as const;
const GM_SESSION = "30000000-0000-4000-8000-00000000000a";
const NOW = "2026-10-17T00:00:00.000Z";

let ids = 0;
export const nextId = () => `50000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;

export const zoneDeps = (faces: number[] = []): ZoneDeps => ({
  geometry: GRID,
  resolveDefinition: () => undefined,
  catalog,
  rollDie: () => faces.shift() ?? 3,
  newId: nextId,
  now: () => NOW
});

export const turnDeps = (faces: number[] = []) => ({ ...zoneDeps(faces), geometry: GRID });

const saveDeps: SaveAnswerDependencies = {
  random: () => 10,
  newRollId: nextId,
  sessionId: GM_SESSION,
  role: "gm",
  now: () => NOW,
  resolveDefinition: () => undefined,
  catalog
};

/** Puts creatures' tokens on the grid, one cell each; outside a fight it sets them on the scene's map. */
export function place(state: GameState, positions: Readonly<Record<string, { x: number; y: number }>>): void {
  const missing = Object.keys(positions).filter((id) => !state.combat.tokens.some((token) => token.actorId === id));
  state.combat.mapAssetId ??= MAP;
  state.combat.tokens = [
    ...state.combat.tokens,
    ...createEncounterTokens(
      missing.map((actorId) => ({ actorId, sizeCells: 1 })),
      GRID
    )
  ].map((token) => ({ ...token, position: positions[token.actorId] ?? token.position, sizeCells: 1 }));
}

/** A token move along cells, as `token.move` reports the path. */
export function walk(
  state: GameState,
  actorId: string,
  cells: ReadonlyArray<readonly [number, number]>,
  faces: number[] = []
) {
  const path = cells.map(([column, row]) => cell(column, row));
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: path[path.length - 1]! } : token
  );
  return zonesAfterMove(state, { moverId: actorId, path }, zoneDeps(faces));
}

/** Draws the area a cast's template placed: a circle of `radius` cells around `center`, a line `radius` cells long down
 *  from it, or a square from `center` to `radius` cells past it on both axes. */
export function drawArea(
  state: GameState,
  id: string,
  center: readonly [number, number],
  radius: number,
  shape: "circle" | "line" | "square" = "circle"
) {
  const [column, row] = center;
  const target =
    shape === "line"
      ? cell(column, row + radius)
      : shape === "square"
        ? { x: 50 * (column + radius), y: 50 * (row + radius) }
        : cell(column + radius, row);
  addAnnotation(
    state,
    {
      id,
      kind: "shape",
      shape,
      origin: shape === "square" ? { x: 50 * column, y: 50 * row } : cell(column, row),
      target,
      visibility: "public",
      actor: { sessionId: GM_SESSION, role: "gm" },
      now: 0
    },
    GRID
  );
}

export const savesOf = (state: GameState, actorId: string) =>
  state.combat.pendingSaves.filter((save) => save.targetActorId === actorId);

/** Answers the creature's first owed save with this total. */
export const answer = (state: GameState, actorId: string, total: number) =>
  answerSave(state, nextId(), savesOf(state, actorId)[0]!.id, "manual", total, true, GM, saveDeps);

export const hpOf = (state: GameState, actorId: string) =>
  state.actors.find((actor) => actor.id === actorId)!.hp.current;
