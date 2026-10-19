import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { altitudeOf, setAltitude } from "./altitude.js";
import { makeEffect } from "./effects.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { nearestOpenSpace } from "./off-plane.js";
import { sizeRank } from "./resolution/context.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  type RuleId,
  type RulesOverride
} from "./rules-families.js";
import { travelBudgetFeet } from "./speed.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";

/**
 * Mounted combat (SRD 5.2.1 Mounted Combat): "During your move, you can mount a creature that is within 5 feet of you
 * or dismount. Doing so costs an amount of movement equal to half your Speed." The mount must be at least one size
 * larger. A rider carries an effect tagged `riding` whose source is its mount; the two share a space, the mount's moves
 * carry the rider, and the rider moves only by its mount until it dismounts.
 */

export const RIDING_TAG = "riding";

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

/** The creature a rider sits on, if any. */
export function mountOf(state: GameState, riderId: string): Actor | undefined {
  const rider = state.actors.find((actor) => actor.id === riderId);
  const mountId = rider?.effects.find((effect) => effect.tags.includes(RIDING_TAG))?.sourceActorId;
  return mountId ? state.actors.find((actor) => actor.id === mountId) : undefined;
}

/** The creatures riding a mount. */
export function ridersOf(state: GameState, mountId: string): string[] {
  return state.actors
    .filter((actor) =>
      actor.effects.some((effect) => effect.tags.includes(RIDING_TAG) && effect.sourceActorId === mountId)
    )
    .map((actor) => actor.id);
}

/** Whether two creatures share a space as rider and mount. */
export const ridesWith = (state: GameState, a: string, b: string): boolean =>
  mountOf(state, a)?.id === b || mountOf(state, b)?.id === a;

type MountInput = Readonly<{
  riderId: string;
  /** The creature to climb onto; null dismounts. */
  mountId: string | null;
  override: RulesOverride | null;
  distanceFeet: (a: string, b: string) => number | null;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  newId: () => string;
}>;

/** What a mount or dismount let through: rules notes, and the GM's override reason when one waived a rule. */
export type MountOutcome = { warnings: string[]; overridden: string | null };

function police(
  state: GameState,
  override: RulesOverride | null,
  rule: RuleId,
  message: string,
  outcome: MountOutcome
) {
  if (effectiveModeFor(state.combat, rule) === "freeform") return;
  if (overrideWaives(override, rule)) {
    outcome.overridden = overrideReason(override);
    return;
  }
  if (effectiveModeFor(state.combat, rule) === "strict" && !overrideCovers(state.combat.turn, rule))
    throw new RulesBlockedError(rule, message);
  outcome.warnings.push(message);
}

/** Half the rider's Speed, spent from its turn's movement when it is its turn in a fight. */
function spendHalfSpeed(state: GameState, rider: Actor, input: MountInput, notes: MountOutcome): void {
  if (!state.combat.active || state.combat.turnActorId !== rider.id) return;
  const definition = rider.definitionId ? input.resolveDefinition(rider.definitionId) : undefined;
  const budget = travelBudgetFeet(rider, deriveEquipment(rider, definition, input.catalog), definition, "walk");
  if (budget === null) return;
  const half = Math.floor(budget / 2);
  const used = state.combat.turn.movementUsedFeet;
  if (used + half > budget + 1e-6)
    police(
      state,
      input.override,
      "movement.exceeds-speed",
      `${rider.name} has ${Math.max(0, budget - used)} ft of movement left, and mounting or dismounting costs ${half} ft.`,
      notes
    );
  state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: used + half } };
}

/** Climbs onto a mount or gets off one. */
export function mountOrDismount(state: GameState, input: MountInput, geometry: TokenMapGeometry): MountOutcome {
  const notes: MountOutcome = { warnings: [], overridden: null };
  const rider = state.actors.find((actor) => actor.id === input.riderId);
  const riderToken = state.combat.tokens.find((token) => token.actorId === input.riderId);
  if (!rider || !riderToken?.position) throw new CommandRejectedError("Place the rider on the map first.");
  const current = mountOf(state, rider.id);
  if (input.mountId === null) {
    if (!current) throw new CommandRejectedError(`${rider.name} isn't riding anything.`);
    spendHalfSpeed(state, rider, input, notes);
    rider.effects = rider.effects.filter((effect) => !effect.tags.includes(RIDING_TAG));
    const landing = nearestOpenSpace(state, rider.id, riderToken.position, geometry);
    moveEncounterToken(state, rider.id, landing, geometry);
    setAltitude(state, rider.id, 0, undefined);
    return notes;
  }
  const mount = state.actors.find((actor) => actor.id === input.mountId);
  const mountToken = state.combat.tokens.find((token) => token.actorId === input.mountId);
  if (!mount || !mountToken?.position || mount.id === rider.id)
    throw new CommandRejectedError("That mount isn't on the map.");
  if (current) throw new CommandRejectedError(`${rider.name} is already riding ${current.name}.`);
  if (mountOf(state, mount.id)) throw new CommandRejectedError(`${mount.name} is riding another creature.`);
  if (sizeRank(mount.size) <= sizeRank(rider.size))
    police(
      state,
      input.override,
      "movement.mount",
      `${mount.name} must be at least one size larger than ${rider.name}.`,
      notes
    );
  const apart = input.distanceFeet(rider.id, mount.id);
  if (apart !== null && apart > 5 + DISTANCE_TOLERANCE_FEET)
    police(
      state,
      input.override,
      "movement.mount",
      `${mount.name} is ${Math.round(apart)} ft away; a mount must be within 5 ft.`,
      notes
    );
  spendHalfSpeed(state, rider, input, notes);
  rider.effects = [
    ...rider.effects,
    makeEffect({
      id: input.newId(),
      name: `Riding ${mount.name}`,
      tags: [RIDING_TAG],
      duration: { type: "manual" },
      sourceActorId: mount.id,
      sourceName: mount.name
    })
  ];
  moveEncounterToken(state, rider.id, mountToken.position, geometry);
  setAltitude(state, rider.id, altitudeOf(mountToken), mountToken.airborne);
  return notes;
}

/** A mount's move carries its riders to where it ended, at its height. */
export function carryRiders(state: GameState, mountId: string, geometry: TokenMapGeometry): string[] {
  const mountToken = state.combat.tokens.find((token) => token.actorId === mountId);
  const riders = ridersOf(state, mountId);
  for (const riderId of riders) {
    if (!mountToken?.position) continue;
    moveEncounterToken(state, riderId, mountToken.position as Point, geometry);
    setAltitude(state, riderId, altitudeOf(mountToken), mountToken.airborne);
  }
  return riders;
}
