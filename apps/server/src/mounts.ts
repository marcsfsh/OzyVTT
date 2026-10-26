import type { GameState } from "@vtt/domain";
import { traitOf } from "./statblock-traits.js";
import { catalogIdOf, type ActorDefinition } from "@vtt/schemas";
import { altitudeOf, setAltitude } from "./altitude.js";
import { applyCondition, makeEffect, type EffectNarration } from "./effects.js";
import { followInInitiative } from "./encounter.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { nearestOpenSpace } from "./off-plane.js";
import { createPendingSaves } from "./pending-saves.js";
import { sizeRank } from "./resolution/context.js";
import {
  effectiveModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  type RuleId,
  type RulesOverride
} from "./rules-families.js";
import { specialSpeedsOf, travelBudgetFeet } from "./speed.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
import { derivedUuid } from "./vision/cast-sight.js";

/**
 * Mounted combat (SRD 5.2.1 Mounted Combat): "During your move, you can mount a creature that is within 5 feet of you
 * or dismount. Doing so costs an amount of movement equal to half your Speed." The mount must be at least one size
 * larger. A rider carries an effect tagged `riding` whose source is its mount; the two share a space, the mount's moves
 * carry the rider, and the rider moves only by its mount until it dismounts. A controlled mount takes its rider's
 * Initiative, its turn right after the rider's, and only the Dash, Disengage and Dodge actions. A forced move of the
 * mount, or either of them knocked Prone, asks the rider a DC 10 Dexterity save to stay on (Advantage in a Military
 * Saddle); a failure drops it Prone within 5 feet of the mount. A flying or aquatic mount needs an Exotic Saddle.
 */

export const RIDING_TAG = "riding";
/** The rider controls its mount (SRD: "you can either control the mount or allow it to act independently"). */
export const CONTROLS_MOUNT_TAG = "controls-mount";

type Actor = GameState["actors"][number];
type Point = Readonly<{ x: number; y: number }>;

/** The actions a controlled mount can take on its turn (SRD: "Dash, Disengage, and Dodge"). */
export const CONTROLLED_MOUNT_ACTIONS: ReadonlySet<string> = new Set(["dash", "disengage", "dodge"]);

/** The DC of the save to stay mounted. */
const STAY_MOUNTED_DC = 10;

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

/** The rider controlling a mount, if one does. */
export function controllingRiderOf(state: GameState, mountId: string): Actor | undefined {
  return state.actors.find((actor) =>
    actor.effects.some(
      (effect) =>
        effect.tags.includes(RIDING_TAG) && effect.tags.includes(CONTROLS_MOUNT_TAG) && effect.sourceActorId === mountId
    )
  );
}

/** Whether two creatures share a space as rider and mount. */
export const ridesWith = (state: GameState, a: string, b: string): boolean =>
  mountOf(state, a)?.id === b || mountOf(state, b)?.id === a;

type MountInput = Readonly<{
  riderId: string;
  /** The creature to climb onto; null dismounts. */
  mountId: string | null;
  /** Absent: controlled. */
  control?: "controlled" | "independent";
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

/** The saddle a mount wears, by its catalog id ("saddle-military"), if any. */
function saddleOf(mount: Actor): string | null {
  const saddle = mount.inventory.find(
    (row) => row.equipped && row.quantity > 0 && catalogIdOf(row).startsWith("saddle-")
  );
  return saddle ? catalogIdOf(saddle) : null;
}

/** SRD Saddles: "An Exotic Saddle is required for riding an aquatic or a flying mount." A mount that flies, or swims
 *  and barely walks, is one. */
function needsExoticSaddle(mount: Actor, input: MountInput): boolean {
  const definition = mount.definitionId ? input.resolveDefinition(mount.definitionId) : undefined;
  const speeds = specialSpeedsOf(mount, definition);
  return speeds.fly !== undefined || (speeds.swim !== undefined && (mount.speedFeet ?? 0) <= 10);
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
    leaveMount(state, rider, current.id);
    const landing = nearestOpenSpace(state, rider.id, riderToken.position, geometry);
    moveEncounterToken(state, rider.id, landing, geometry);
    setAltitude(state, rider.id, 0, undefined);
    return notes;
  }
  const mount = state.actors.find((actor) => actor.id === input.mountId);
  const mountToken = state.combat.tokens.find((token) => token.actorId === input.mountId);
  const definition = mount?.definitionId ? input.resolveDefinition(mount.definitionId) : undefined;
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
  if (needsExoticSaddle(mount, input) && saddleOf(mount) !== "saddle-exotic")
    police(
      state,
      input.override,
      "movement.mount",
      `Riding ${mount.name}, a flying or aquatic mount, needs an Exotic Saddle on it.`,
      notes
    );
  const controlled = (input.control ?? "controlled") === "controlled";
  if (controlled && controllingRiderOf(state, mount.id))
    throw new CommandRejectedError(`Another rider already controls ${mount.name}.`);
  spendHalfSpeed(state, rider, input, notes);
  // "The nightmare can grant Resistance to Fire damage to a rider while it is on the nightmare."
  const confers = traitOf(definition, "confers-resistance");
  rider.effects = [
    ...rider.effects,
    makeEffect({
      id: input.newId(),
      name: `Riding ${mount.name}`,
      tags: controlled ? [RIDING_TAG, CONTROLS_MOUNT_TAG] : [RIDING_TAG],
      duration: { type: "manual" },
      sourceActorId: mount.id,
      sourceName: mount.name,
      ...(confers ? { modifiers: [{ type: "damage-resistance" as const, damageTypes: [confers.damageType] }] } : {})
    })
  ];
  moveEncounterToken(state, rider.id, mountToken.position, geometry);
  setAltitude(state, rider.id, altitudeOf(mountToken), mountToken.airborne);
  // "The Initiative of a controlled mount changes to match yours when you mount it."
  if (controlled && state.combat.active) followInInitiative(state, mount.id, rider.id);
  return notes;
}

/** A rider is off its mount: the riding ends, and a mount it controlled keeps the count it took and acts on its own. */
function leaveMount(state: GameState, rider: Actor, mountId: string): void {
  const controlled = rider.effects.some(
    (effect) =>
      effect.tags.includes(RIDING_TAG) && effect.tags.includes(CONTROLS_MOUNT_TAG) && effect.sourceActorId === mountId
  );
  rider.effects = rider.effects.filter((effect) => !effect.tags.includes(RIDING_TAG));
  if (controlled && state.combat.active) followInInitiative(state, mountId, null);
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

/** A rider that teleports, or whose mount teleports, is off it where it stands. */
export function parted(state: GameState, riderId: string): void {
  const rider = state.actors.find((actor) => actor.id === riderId);
  const mount = mountOf(state, riderId);
  if (rider && mount) leaveMount(state, rider, mount.id);
}

/**
 * SRD Mounted Combat: "If an effect is about to move your mount against its will while you're on it, you must succeed on
 * a DC 10 Dexterity saving throw or fall off the mount ... While mounted, you must make the same save if you're knocked
 * Prone or the mount is." Each rider of the mount (or the rider itself) owes the save; a Military Saddle gives it
 * Advantage ("Advantage on any ability check you make to remain mounted").
 */
export function askToStayMounted(
  state: GameState,
  riderIds: readonly string[],
  mountId: string,
  why: string,
  createdAt: number
): EffectNarration[] {
  const mount = state.actors.find((actor) => actor.id === mountId);
  if (!mount) return [];
  const events: EffectNarration[] = [];
  for (const riderId of riderIds) {
    const rider = state.actors.find((actor) => actor.id === riderId);
    if (!rider) continue;
    const military = saddleOf(mount) === "saddle-military";
    const salt = `stay-mounted:${state.combat.round}:${state.combat.pendingSaves.length}`;
    createPendingSaves(state, {
      sourceActorId: mount.id,
      sourceName: mount.name,
      actionName: `Stay on ${mount.name}`,
      ability: "dex",
      dc: STAY_MOUNTED_DC,
      targetIds: [rider.id],
      proposedDamage: 0,
      halfOnSuccess: false,
      conditionIds: [],
      unseats: mount.id,
      ...(military ? { advantageFrom: "Military Saddle" } : {}),
      newSaveId: () => derivedUuid(`${rider.id}:${mount.id}`, salt),
      createdAt
    });
    events.push({
      kind: "effect",
      text: `${rider.name} makes a DC ${STAY_MOUNTED_DC} Dexterity saving throw to stay on ${mount.name} (${why}).`,
      actorId: rider.id
    });
  }
  return events;
}

/** A failed save to stay mounted: the rider falls off, landing Prone within 5 feet of its mount (`place` sets its token
 *  down beside it where the map can). */
export function unseat(
  state: GameState,
  riderId: string,
  mountId: string,
  place?: (riderId: string, besideId: string) => boolean
): EffectNarration[] {
  const rider = state.actors.find((actor) => actor.id === riderId);
  const mount = state.actors.find((actor) => actor.id === mountId);
  if (!rider || !mount || mountOf(state, riderId)?.id !== mountId) return [];
  leaveMount(state, rider, mountId);
  const placed = place?.(riderId, mountId) ?? false;
  applyCondition(rider, "prone");
  return [
    {
      kind: "effect",
      text: `${rider.name} falls off ${mount.name} and lands Prone within 5 feet of it.${placed ? "" : " Move the token."}`,
      actorId: rider.id
    }
  ];
}

/** Sets an unseated rider down in the nearest unoccupied space beside its mount, at the mount's height (a rider thrown
 *  from a flying mount then falls). */
export function placeBeside(
  state: GameState,
  riderId: string,
  besideId: string,
  geometry: TokenMapGeometry | null
): boolean {
  const at = state.combat.tokens.find((token) => token.actorId === besideId);
  if (!geometry || !at?.position) return false;
  moveEncounterToken(state, riderId, nearestOpenSpace(state, riderId, at.position, geometry), geometry);
  return true;
}

/** A creature knocked Prone while it rides, or while it is ridden: each rider owes the save to stay on. */
export function knockedProneWhileMounted(state: GameState, actor: Actor): EffectNarration[] {
  const riders = ridersOf(state, actor.id);
  const mount = mountOf(state, actor.id);
  const why = `${actor.name} is knocked Prone`;
  return [
    ...(riders.length > 0 ? askToStayMounted(state, riders, actor.id, why, Date.now()) : []),
    ...(mount ? askToStayMounted(state, [actor.id], mount.id, why, Date.now()) : [])
  ];
}
