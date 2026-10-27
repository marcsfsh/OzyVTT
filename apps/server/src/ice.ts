import { isDead, type CombatState, type GameState } from "@vtt/domain";
import { pointInRects } from "@vtt/rules-5e";
import { altitudeOf } from "./altitude.js";
import { footprintCellCenters } from "./area-targeting.js";
import type { EffectNarration } from "./effects.js";
import { gridToImage, type SquareGridCalibration } from "./grid-calibration.js";
import { createPendingSaves } from "./saving-throws.js";
import { movesFreelyOn } from "./spell-zones.js";
import type { ActorDefinition } from "@vtt/schemas";

/**
 * SRD 5.2.1 Gameplay Toolbox, Slippery Ice: "Slippery ice is Difficult Terrain. A creature that moves onto slippery ice
 * for the first time on a turn or starts its turn there must succeed on a DC 10 Dexterity saving throw or have the Prone
 * condition." The GM paints it (`terrain.ts`); the movement rules charge it as Difficult Terrain, a move that comes onto
 * it stops there while the save is answered (`zone-stops.ts`), and a turn that starts on it asks the save.
 */

type Point = Readonly<{ x: number; y: number }>;

const ICE_DC = 10;
const ICE_NAME = "Slippery ice";
/** The turn mark of a creature that has met the ice this turn. */
const iceMark = (actorId: string) => `${actorId}:slippery-ice`;

export type IceDeps = Readonly<{
  newId: () => string;
  now: () => string;
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
}>;

/** SRD Ice Walk: "The dragon can move across and climb icy surfaces without needing to make an ability check." */
const walksOnIce = (state: GameState, actorId: string, deps: Pick<IceDeps, "resolveDefinition">) => {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  return actor !== undefined && deps.resolveDefinition !== undefined
    ? movesFreelyOn(actor, "ice", { resolveDefinition: deps.resolveDefinition })
    : false;
};

/** Whether a creature of this size at this point and height stands on painted ice: any square of its space. */
export function onIce(
  terrain: Pick<CombatState["terrain"], "ice">,
  calibration: SquareGridCalibration | null | undefined,
  position: Point,
  sizeCells: number,
  altitudeFeet = 0
): boolean {
  if (altitudeFeet > 0 || terrain.ice.length === 0) return false;
  const points = calibration
    ? footprintCellCenters(calibration, position, sizeCells).map((center) => gridToImage(calibration, center))
    : [position];
  return points.some((point) => pointInRects(point, terrain.ice));
}

/** Whether the creature has met the ice this turn, so it asks no second save; outside a fight every time counts. */
const metThisTurn = (state: GameState, actorId: string) =>
  state.combat.active && (state.combat.turn.turnUses[iceMark(actorId)] ?? 0) > 0;

function markMet(state: GameState, actorId: string): void {
  if (!state.combat.active) return;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [iceMark(actorId)]: 1 } }
  };
}

/** The ice asks its save of the creature: Prone on a failure. Returns the save's id and the line for the table. */
export function slipOnIce(
  state: GameState,
  actorId: string,
  deps: IceDeps
): Readonly<{ saveIds: string[]; events: EffectNarration[] }> {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (
    !actor ||
    isDead(actor) ||
    actor.conditions.some((condition) => condition.id === "prone") ||
    walksOnIce(state, actorId, deps)
  )
    return { saveIds: [], events: [] };
  markMet(state, actorId);
  const before = new Set(state.combat.pendingSaves.map((save) => save.id));
  createPendingSaves(state, {
    sourceActorId: null,
    sourceName: ICE_NAME,
    actionName: ICE_NAME,
    ability: "dex",
    dc: ICE_DC,
    targetIds: [actorId],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: ["prone"],
    replaceExisting: false,
    newSaveId: deps.newId,
    createdAt: Date.parse(deps.now())
  });
  const saveIds = state.combat.pendingSaves.filter((save) => !before.has(save.id)).map((save) => save.id);
  return {
    saveIds,
    events: [
      {
        kind: "effect",
        text: `${actor.name} is on slippery ice and makes a DC ${ICE_DC} DEX save or falls Prone.`,
        actorId
      }
    ]
  };
}

/**
 * Where a creature's way first comes onto the ice from off it: the index of that point of the path, or null. A creature
 * that has met the ice this turn, or one already on it as it sets off, asks nothing more.
 */
export function iceEntry(
  state: GameState,
  moverId: string,
  path: readonly Point[],
  calibration: SquareGridCalibration | null | undefined
): number | null {
  if (path.length < 2 || metThisTurn(state, moverId)) return null;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === moverId && candidate.position !== null);
  if (!token) return null;
  const on = (point: Point) => onIce(state.combat.terrain, calibration, point, token.sizeCells, altitudeOf(token));
  if (on(path[0]!)) return null;
  const index = path.findIndex((point, at) => at > 0 && on(point));
  return index > 0 ? index : null;
}

/** As a creature's turn starts on the ice, it makes the save. */
export function iceAtTurnStart(
  state: GameState,
  actorId: string,
  calibration: SquareGridCalibration | null | undefined,
  deps: IceDeps
): EffectNarration[] {
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  if (!token?.position) return [];
  if (!onIce(state.combat.terrain, calibration, token.position, token.sizeCells, altitudeOf(token))) return [];
  return slipOnIce(state, actorId, deps).events;
}
