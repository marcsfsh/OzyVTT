import { formEffectOf } from "./transform/forms.js";
import type { ActorMovementReply, EncounterTokenPosition, GameState } from "@vtt/domain";
import type { MoveMode } from "@vtt/domain/commands";
import type { ActorDefinition } from "@vtt/schemas";
import { footprintOrigin } from "@vtt/rules-5e";
import { RulesBlockedError } from "./game-store.js";
import { altitudesAlong, heightRefusal, sharesHeight } from "./altitude.js";
import {
  activeMoveGrant,
  activeTeleportGrant,
  spendMoveGrant,
  spendTeleportGrant,
  type MoveGrant
} from "./granted-moves.js";
import { holdsFeature } from "./class-features.js";
import { HIDDEN_SOURCE } from "./hidden-source.js";
import { ridesWith } from "./mounts.js";
import { isIncapacitated } from "./condition-rules.js";
import { areEnemies } from "./creature-sides.js";
import { burrowsThroughWalls, openingPassage, stopsOnlyInEnemySpace } from "./wall-passage.js";
import { effectiveActions } from "./effective-actions.js";
import { NO_OPPORTUNITY_ATTACKS_TAG, NO_REACTIONS_TAG, READIED_TAG, releaseReadied } from "./effects.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { imageToGrid, type SquareGridCalibration } from "./grid-calibration.js";
import { jumpLimits, leapRider } from "./jumping.js";
import { travelBudgetFeet, travelCostsExtra, type TravelMode } from "./speed.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { DAZED_TAG } from "./resolution/economy.js";
import type { MovementCost, MovementCostOptions } from "./terrain.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
import { fearSources } from "./vision/rules.js";
import {
  effectiveModeFor,
  familyModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  rememberOverride,
  type RuleId,
  type RulesOverride
} from "./rules-families.js";

type Point = Readonly<{ x: number; y: number }>;

export type MovementRulesInput = Readonly<{
  actorId: string;
  /** Position before the move; null when entering from the tray (free). */
  from: EncounterTokenPosition | null;
  /** Snapped position after the move; null when returning to the tray (free). */
  to: EncounterTokenPosition | null;
  /** How the move travels; walking when absent. */
  mode?: MoveMode;
  /** The mover's height before and after the move, in feet; on the ground when absent. */
  fromAltitudeFeet?: number;
  toAltitudeFeet?: number;
  /** A player moved the token (not the GM): off its turn, or by teleportation, that needs the GM's go-ahead. */
  byPlayer?: boolean;
  /** What held the mover up as it set off (the token's own, when absent). */
  wasAirborne?: "fly" | "levitate";
  /** Map distance in feet between two image points; null when unmeasurable. */
  distance: (a: Point, b: Point) => number | null;
  /** What the move costs the mover, difficult terrain, creatures and extra costs included (`movementCost`);
   *  `distance` when absent. */
  cost?: (from: Point, to: Point, options: MovementCostOptions) => MovementCost | null;
  /** Footprint-aware feet between an enemy and the mover at `point` and `altitudeFeet` (SRD: nearest point of each space,
   *  height included); center-to-center when absent. Used for reach. */
  creatureDistance?: (
    enemy: Readonly<{ actorId: string; position: Point }>,
    moverPoint: Point,
    altitudeFeet?: number
  ) => number | null;
  /** The map's grid, so a move can't end in another creature's space; no check without one. */
  calibration?: SquareGridCalibration | null;
  /** Creatures the mover drags along (it grapples them), and whether that costs it an extra foot per foot. */
  dragging?: Readonly<{ actorIds: readonly string[]; costsExtra: boolean }>;
  override: RulesOverride | null;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog, so a reach-granting item widens the opportunity-attack trigger. */
  catalog?: EquipmentCatalog;
  /** With dynamic vision on: whether the mover perceived a creature as it set off. One it didn't is no obstacle and no
   *  refusal, as a hidden one isn't. Every creature counts when absent. */
  perceives?: (actorId: string) => boolean;
  /** With dynamic vision on: whether the mover saw a point as it set off ("an unoccupied space you can see", for a
   *  teleport). Every point counts when absent. */
  seesPoint?: (point: Point) => boolean;
  /** Whether a point lies in Difficult Terrain, where a jump's landing needs a check. No check when absent. */
  difficultAt?: (point: Point) => boolean;
  /** With dynamic vision on: whether a creature saw the mover as it set off, which an opportunity attack needs. The
   *  conditions alone decide (Blinded, Invisible) when absent. */
  seenBy?: (actorId: string) => boolean;
  /** The mover was hidden from the table as it set off (the shared check: out of every character's sight or under the
   *  fog). A player's character can't see it go, and its prompt would point at it, so none opens for one. */
  moverHiddenFromPlayers?: boolean;
  newPromptId: () => string;
  now: () => number;
  commandId: string;
}>;

export type MovementRulesOutcome = Readonly<{
  /** Assisted-mode rules notes let through (GM log). */
  warning: string | null;
  /** Strict blocks bypassed with the given reason (audited OVERRIDE line). */
  overridden: string | null;
  /** Leaves-reach reaction prompts opened by this move (already pushed into state). */
  prompts: ReadonlyArray<{ actorId: string; name: string }>;
  /** It crawled (Prone), for the narration. */
  crawled: boolean;
  /** It was a Readied creature's move off its turn, taken with its Reaction. */
  readied?: true;
  /** The move or teleport an action or feature granted that this one was taken with (`granted-moves.ts`). */
  granted?: string;
  /** A jump that landed in Difficult Terrain, which owes a DC 10 Dexterity (Acrobatics) check (`jumping.ts`). */
  landsOnDifficult?: true;
  /** The teleport arrived in a filled space and fails with this Force damage (`failedTeleport`). */
  teleportFails?: string;
  /** The mover waits here, at the edge of the reach it leaves, while the Opportunity Attacks it provoked are answered
   *  (`held-moves.ts`); `refundFeet` is what the rest of the way cost, given back if it never goes on. */
  heldAt?: Readonly<{ position: Point; altitudeFeet: number; promptIds: readonly string[]; refundFeet: number }>;
  /** The way a walk, a flight, a climb, a swim or a burrow went, step by step, as its cost measured it. */
  path?: readonly Point[];
}>;

/**
 * Movement rules for one completed token move (SRD Movement / Opportunity Attacks), run inside the
 * token.move mutation after the snap so distances are authoritative; a strict rejection discards the
 * whole draft.
 *
 * Budget: only the current combatant's own move with known speed on a measurable map; GM off-turn
 * repositioning, tray moves and unknown speeds are free. Each way of moving has its budget (`travelBudgetFeet`), the
 * movement already spent this turn coming off whichever is used (SRD "Special Speeds": switching subtracts the
 * distance already moved). Crawling, and climbing or swimming without the speed, cost an extra foot per foot, and so
 * does dragging a grappled creature. Teleportation and forced movement spend none and provoke nothing.
 *
 * Granted moves (`granted-moves.ts`): a move an action or feature gave the creature for this turn ("moves up to half
 * its Speed", Tactical Shift) is charged to that grant, on the creature's turn or off it, when it fits; it provokes
 * unless the grant says otherwise. A granted teleport is checked for its range, an unoccupied space and sight, and
 * needs no GM go-ahead. A player's move off the turn with no grant, or a teleport with none, is the GM's to allow; the
 * GM's own off-turn moves with no grant are repositioning and spend nothing.
 *
 * Opportunity attacks: leaving an enemy's melee reach anywhere along the path opens a leaves-reach prompt answered as
 * a real melee attack, and the mover waits at the last point of its way still in reach while the prompts are open
 * (`heldAt`, `held-moves.ts`). Disengage suppresses; a hidden mover
 * prompts no one (a player must not learn a hidden token's retreat), and neither does a mover the enemy can't see
 * (Invisible, or the enemy Blinded) unless its Blindsight or Truesight reaches. Sides are `areEnemies`', as attacks'.
 */
/** A move spends movement only on the mover's own turn in combat, with movement rules on. While a wait-mode
 *  fight gathers initiative no turn has begun, so tokens are still being positioned. */
/** SRD Ready: a Readied creature may "move up to your Speed in response" to its trigger, with its Reaction, off its
 *  own turn. Counted like any move (unless the movement rules are off), against its Speed and apart from the turn's. */
function readiedMove(state: GameState, mover: GameState["actors"][number], mode: MoveMode): boolean {
  return (
    turnsRunning(state) &&
    state.combat.turnActorId !== mover.id &&
    mode !== "teleport" &&
    mode !== "forced" &&
    state.combat.initiative.some((entry) => entry.actorId === mover.id) &&
    mover.effects.some((effect) => effect.tags.includes(READIED_TAG)) &&
    familyModeFor(state.combat, "movement") !== "freeform"
  );
}

function movementCounts(state: GameState, actorId: string): boolean {
  return (
    turnsRunning(state) &&
    state.combat.turnActorId === actorId &&
    familyModeFor(state.combat, "movement") !== "freeform"
  );
}

/** A fight whose turns have begun: not a wait-mode fight still gathering initiative. */
function turnsRunning(state: GameState): boolean {
  const gathering = state.combat.playerInitiativeMode === "wait" && state.combat.pendingInitiative.length > 0;
  return state.combat.active && !gathering;
}

const TRAVEL_MODES: readonly TravelMode[] = ["walk", "fly", "swim", "climb", "burrow"];
const MODE_NAMES: Readonly<Record<TravelMode, string>> = {
  walk: "walking",
  fly: "Fly",
  swim: "Swim",
  climb: "Climb",
  burrow: "Burrow"
};

/** What `actor:movement` reports: the same budgets `applyMovementRules` charges against. */
export function movementStatus(
  state: GameState,
  actorId: string,
  input: Pick<MovementRulesInput, "resolveDefinition" | "catalog">
): ActorMovementReply {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const definition = actor?.definitionId ? input.resolveDefinition(actor.definitionId) : undefined;
  const counted = actor !== undefined && movementCounts(state, actorId);
  const derivation = actor ? deriveEquipment(actor, definition, input.catalog) : null;
  const modes =
    actor && derivation
      ? TRAVEL_MODES.flatMap((mode) => {
          const budget = travelBudgetFeet(actor, derivation, definition, mode);
          return budget === null
            ? []
            : [{ mode, budgetFeet: budget, extraCost: travelCostsExtra(actor, definition, mode, derivation) }];
        })
      : [];
  return {
    counted,
    speedFeet: actor && derivation ? travelBudgetFeet(actor, derivation, definition, "walk") : null,
    usedFeet: counted ? state.combat.turn.movementUsedFeet : 0,
    enforcement: effectiveModeFor(state.combat, "movement.exceeds-speed"),
    ...(modes.length > 0 ? { modes } : {}),
    ...(actor?.conditions.some((condition) => condition.id === "prone") ? { crawling: true } : {}),
    ...(actor && dragCostsExtra(state, actor.id, grappledBy(state, actor.id), input.resolveDefinition)
      ? { dragging: true }
      : {}),
    ...grantsOf(state, actor),
    ...(incorporeal(definition) ? { throughWalls: true } : {}),
    ...(openingPassage(definition) ? { opening: openingPassage(definition)! } : {}),
    ...(burrowsThroughWalls(definition) ? { burrowsThroughWalls: burrowsThroughWalls(definition)! } : {}),
    ...(actor && freeOfDifficultTerrain(actor) ? { ignoresDifficultTerrain: true } : {})
  };
}

/** The move and teleport granted to a creature for this turn, as `actor:movement` reports them. */
function grantsOf(state: GameState, actor: GameState["actors"][number] | undefined) {
  const move = actor ? activeMoveGrant(state, actor) : null;
  const teleport = actor ? activeTeleportGrant(state, actor) : null;
  return {
    ...(move && move.feet > 0
      ? {
          granted: {
            name: move.name,
            feet: move.feet,
            ...(move.mode ? { mode: move.mode } : {}),
            provokes: move.provokes,
            ...(move.jump ? { jump: true } : {})
          }
        }
      : {}),
    ...(teleport ? { teleport: { name: teleport.name, feet: teleport.feet } } : {})
  };
}

/** The creatures a grappler holds (its `grapple` effects on them). */
export function grappledBy(state: GameState, grapplerId: string): readonly string[] {
  return state.actors
    .filter((actor) =>
      actor.effects.some((effect) => effect.tags.includes("grapple") && effect.sourceActorId === grapplerId)
    )
    .map((actor) => actor.id);
}

const SIZE_RANK: Readonly<Record<string, number>> = { tiny: 0, small: 1, medium: 2, large: 3, huge: 4, gargantuan: 5 };

/** SRD Grappled: "The grappler can drag or carry you when it moves, but every foot of movement costs it 1 extra foot
 *  unless you are Tiny or two or more sizes smaller than it." A bugbear's Abduct: it "needn't spend extra movement to
 *  move a creature it is grappling". */
export function dragCostsExtra(
  state: GameState,
  grapplerId: string,
  grappledIds: readonly string[],
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): boolean {
  const grappler = state.actors.find((actor) => actor.id === grapplerId);
  const definition = grappler?.definitionId ? resolveDefinition?.(grappler.definitionId) : undefined;
  if (holdsFeature(definition, "abduct", "Abduct")) return false;
  const rank = (actorId: string) =>
    SIZE_RANK[state.actors.find((actor) => actor.id === actorId)?.size ?? "medium"] ?? SIZE_RANK.medium!;
  return grappledIds.some((actorId) => {
    const size = state.actors.find((actor) => actor.id === actorId)?.size ?? "medium";
    return size !== "tiny" && rank(grapplerId) - rank(actorId) < 2;
  });
}

/** The creatures a grappler drags come along, moved the same way it went, and snapped (SRD Grappled: "Movable").
 *  Returns those moved. */
export function dragAlong(
  state: GameState,
  heldIds: readonly string[],
  from: Point,
  to: Point,
  geometry: TokenMapGeometry
): string[] {
  const moved: string[] = [];
  for (const heldId of heldIds) {
    const held = state.combat.tokens.find((token) => token.actorId === heldId)?.position;
    if (!held) continue;
    moveEncounterToken(state, heldId, { x: held.x + to.x - from.x, y: held.y + to.y - from.y }, geometry);
    moved.push(heldId);
  }
  return moved;
}

/** A sense a stat block prints ("blindsight 60 ft."), in feet; 0 when it has none. Characters record no senses. */
function senseRangeFeet(definition: ActorDefinition | undefined, sense: "blindsight" | "truesight"): number {
  const senses = (definition?.extensions["open5e.srd-2024"] as { senses?: unknown } | undefined)?.senses;
  if (!Array.isArray(senses)) return 0;
  for (const entry of senses) {
    const match = typeof entry === "string" ? entry.match(new RegExp(`^${sense} (\\d+)`, "i")) : null;
    if (match) return Number.parseInt(match[1], 10);
  }
  return 0;
}

/** SRD Opportunity Attack: "a creature that you can see". A Blinded reactor sees only within its Blindsight; an
 *  Invisible mover is seen only within Blindsight or Truesight. `distanceFeet` is how far apart they were. */
function seesMover(
  reactor: GameState["actors"][number],
  reactorDefinition: ActorDefinition | undefined,
  mover: GameState["actors"][number],
  distanceFeet: number
): boolean {
  const within = (range: number) => range > 0 && distanceFeet <= range + DISTANCE_TOLERANCE_FEET;
  const blindsight = within(senseRangeFeet(reactorDefinition, "blindsight"));
  if (reactor.conditions.some((condition) => condition.id === "blinded")) return blindsight;
  if (mover.conditions.some((condition) => condition.id === "invisible"))
    return blindsight || within(senseRangeFeet(reactorDefinition, "truesight"));
  return true;
}

/** One rule a move breaks, through the strict/assisted/override ladder: strict throws (unless the GM's override
 *  waives it, or one earlier this turn covers it), assisted lets it through as a note. */
type Policing = { warnings: string[]; overridden: string | null };
function police(
  state: GameState,
  input: Pick<MovementRulesInput, "override">,
  rule: RuleId,
  message: string,
  outcome: Policing,
  remember = false
): void {
  if (effectiveModeFor(state.combat, rule) === "freeform") return;
  if (overrideWaives(input.override, rule)) {
    outcome.overridden = overrideReason(input.override);
    if (remember) rememberOverride(state, rule, input.override);
    return;
  }
  if (effectiveModeFor(state.combat, rule) === "strict" && !overrideCovers(state.combat.turn, rule))
    throw new RulesBlockedError(rule, message);
  outcome.warnings.push(message);
}

/** The grid cells a token covers at a position. */
function cellsAt(calibration: SquareGridCalibration, position: Point, sizeCells: number): Set<string> {
  const origin = footprintOrigin(imageToGrid(calibration, position), sizeCells);
  const cells = new Set<string>();
  for (let column = 0; column < sizeCells; column++)
    for (let row = 0; row < sizeCells; row++) cells.add(`${origin.column + column},${origin.row + row}`);
  return cells;
}

/** Traits that let a creature end its move in another's space ("The elemental can enter a creature's space and stop
 *  there"); a swarm's works both ways ("The swarm can occupy another creature's space and vice versa"). */
const SHARES_SPACE = ["Air Form", "Fire Form", "Water Form", "Swarm"] as const;
const sharesSpace = (state: GameState, actorId: string, input: MovementRulesInput, swarmOnly = false): boolean => {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const definition = actor?.definitionId ? input.resolveDefinition(actor.definitionId) : undefined;
  // A form that can enter a creature's space and stop there (a vampire's mist, Gaseous Form's cloud).
  if (!swarmOnly && actor && formEffectOf(actor)?.form?.sharesSpaces) return true;
  return (swarmOnly ? ["Swarm"] : SHARES_SPACE).some((name) => holdsFeature(definition, name, name));
};

/** A spell's force that neither blocks a space nor is blocked (Spiritual Weapon's force, an Arcane Eye). */
const intangible = (state: GameState, actorId: string): boolean =>
  state.actors.find((actor) => actor.id === actorId)?.summon?.intangible === true;

/** SRD: "You can't willingly end a move in a space occupied by another creature." Hidden creatures don't count, so
 *  the refusal can't give one away; neither do the creatures the mover drags. */
function endsInOccupiedSpace(state: GameState, input: MovementRulesInput, to: Point, everyone = false): boolean {
  if (!input.calibration || intangible(state, input.actorId)) return false;
  const moverActor = state.actors.find((actor) => actor.id === input.actorId);
  // Air Form and Water Form as the stalker and the water elemental print them: "can enter an enemy's space and stop
  // there", so only an enemy's space is one it may end in.
  const enemiesOnly = moverActor !== undefined && stopsOnlyInEnemySpace(moverDefinitionOf(moverActor, input));
  if (sharesSpace(state, input.actorId, input) && !enemiesOnly) return false;
  const moverToken = state.combat.tokens.find((token) => token.actorId === input.actorId);
  const mine = cellsAt(input.calibration, to, moverToken?.sizeCells ?? 1);
  const feetPerCell = input.calibration.distancePerCell;
  return state.combat.tokens.some((token) => {
    if (token.actorId === input.actorId || !token.position || input.dragging?.actorIds.includes(token.actorId))
      return false;
    // A rider shares its mount's space.
    if (ridesWith(state, input.actorId, token.actorId)) return false;
    // A creature above or below the mover's space at the end isn't in it (a flier over a goblin).
    if (moverToken && !sharesHeight(moverToken, token, feetPerCell, input.toAltitudeFeet ?? 0)) return false;
    if (sharesSpace(state, token.actorId, input, true) || intangible(state, token.actorId)) return false;
    const occupant = state.actors.find((actor) => actor.id === token.actorId);
    if (enemiesOnly && moverActor && occupant && areEnemies(moverActor, occupant, input.resolveDefinition))
      return false;
    if (!everyone && occupant?.visibility === "gm-only") return false;
    if (!everyone && input.perceives && !input.perceives(token.actorId)) return false;
    for (const cell of cellsAt(input.calibration!, token.position, token.sizeCells ?? 1))
      if (mine.has(cell)) return true;
    return false;
  });
}

export function applyMovementRules(state: GameState, input: MovementRulesInput): MovementRulesOutcome {
  const { actorId, from, to } = input;
  const mode = input.mode ?? "walk";
  const mover = state.actors.find((candidate) => candidate.id === actorId);
  const prompts: Array<{ actorId: string; name: string }> = [];
  const outcome: Policing = { warnings: [], overridden: null };
  let readied = false;
  let granted: string | undefined;
  let landsOnDifficult = false;
  let failDamage: string | undefined;
  let heldAt: MovementRulesOutcome["heldAt"];
  const travelled: { path?: readonly Point[] } = {};
  const done = (crawled = false): MovementRulesOutcome => ({
    warning: outcome.warnings.length > 0 ? outcome.warnings.join(" ") : null,
    overridden: outcome.overridden,
    prompts,
    crawled,
    ...(readied ? { readied: true as const } : {}),
    ...(granted ? { granted } : {}),
    ...(landsOnDifficult ? { landsOnDifficult: true as const } : {}),
    ...(failDamage ? { teleportFails: failDamage } : {}),
    ...(heldAt ? { heldAt } : {}),
    ...(travelled.path ? { path: travelled.path } : {})
  });
  // Forced movement is the GM's (the command refuses a player's), and spends nothing.
  if (!mover || from === null || to === null || mode === "forced") return done();
  const fromAltitude = input.fromAltitudeFeet ?? 0;
  const toAltitude = input.toAltitudeFeet ?? fromAltitude;
  // A granted teleport the move keeps to the terms of is taken now, by anyone, with nothing more to ask.
  if (mode === "teleport") {
    const teleport = activeTeleportGrant(state, mover);
    const refusal = teleport ? teleportRefusal(state, input, mover.name, teleport, toAltitude) : null;
    if (teleport && refusal === null) {
      spendTeleportGrant(mover, teleport.effectId);
      granted = teleport.name;
      // A space filled by a creature the mover didn't know of fails the teleport that says so (Dimension Door).
      if (teleport.failDamage && endsInOccupiedSpace(state, input, to, true)) failDamage = teleport.failDamage;
      return done();
    }
    if (teleport && refusal && input.byPlayer) police(state, input, "movement.teleport", refusal, outcome);
  }
  const grant = mode === "teleport" ? null : fittingMoveGrant(state, input, mover, mode, fromAltitude, toAltitude);
  readied = !grant && readiedMove(state, mover, mode);
  const counted = movementCounts(state, actorId) || readied;
  // A readied move is the creature's Reaction: one it still has.
  if (readied && state.combat.reactionsUsed.includes(mover.id))
    police(
      state,
      input,
      "economy.reaction-used",
      `${mover.name} has no reaction left to take the readied move with.`,
      outcome
    );
  // SRD: you move on your own turn. A player's move off it (a reaction that moves) is the GM's call; a readied move
  // is the creature's own Reaction.
  if (input.byPlayer && turnsRunning(state) && state.combat.turnActorId !== actorId && !readied && !grant)
    police(
      state,
      input,
      "movement.off-turn",
      `It isn't ${mover.name}'s turn, so moving now needs the GM's go-ahead.`,
      outcome
    );
  // Teleportation spends no movement and provokes nothing, and a player's needs the GM's go-ahead (the spell or
  // feature that grants it is theirs to rule on).
  if (mode === "teleport" && input.byPlayer && !activeTeleportGrant(state, mover))
    police(state, input, "movement.teleport", `${mover.name} can teleport only with the GM's go-ahead.`, outcome);
  if ((counted || input.byPlayer || grant) && endsInOccupiedSpace(state, input, to))
    police(state, input, "movement.occupied", `${mover.name} can't end its move in another creature's space.`, outcome);
  // SRD 5.2.1 Frightened: "You can't willingly move closer to the source of fear."
  const feared = (counted || input.byPlayer || grant) && approachesFear(state, input, mover, from, to);
  if (feared)
    police(
      state,
      input,
      "movement.toward-fear",
      `${mover.name} is Frightened and can't willingly move closer to ${feared}.`,
      outcome
    );
  // Height changes by flying, climbing, jumping or teleporting; a creature in the air moves by flying.
  const moverToken = state.combat.tokens.find((token) => token.actorId === actorId);
  const heightBar =
    counted || input.byPlayer || grant
      ? heightRefusal(mover.name, mode, fromAltitude, toAltitude, input.wasAirborne ?? moverToken?.airborne)
      : null;
  if (heightBar) police(state, input, "movement.altitude", heightBar, outcome);
  if (mode === "teleport") return done();
  // A granted move is charged to its grant, and provokes unless it says otherwise.
  if (grant) {
    spendMoveGrant(mover, grant.effectId, grant.chargeFeet);
    if (grant.jump && grant.costFeet > 0) {
      const used = state.combat.turn.movementUsedFeet;
      const budget = movementCounts(state, actorId)
        ? travelBudgetFeet(
            mover,
            deriveEquipment(mover, moverDefinitionOf(mover, input), input.catalog),
            moverDefinitionOf(mover, input),
            "walk"
          )
        : null;
      if (budget !== null && used + grant.costFeet > budget + 1e-6)
        police(
          state,
          input,
          "movement.exceeds-speed",
          `${mover.name} has ${Math.max(0, budget - used)} ft of movement left, and ${grant.name} spends ${grant.costFeet} ft.`,
          outcome,
          true
        );
      if (budget !== null)
        state.combat = {
          ...state.combat,
          turn: { ...state.combat.turn, movementUsedFeet: used + grant.costFeet }
        };
    }
    granted = grant.name;
    landsOnDifficult = grant.jump === true && input.difficultAt?.(to) === true;
    const held = grant.provokes ? openOpportunityAttacks(state, input, mover, grant.path, prompts) : null;
    if (held) heldAt = { position: held.at, altitudeFeet: held.altitudeFeet, promptIds: held.promptIds, refundFeet: 0 };
    return done(mover.conditions.some((condition) => condition.id === "prone"));
  }
  if (!counted) return done();
  // SRD Abjure Foes, a Rogue's Daze: a creature limited to one of moving, an action or a Bonus Action that took
  // either can't move (resolution/economy.ts refuses the rest).
  const limited = mover.effects.find((effect) => effect.tags.includes(DAZED_TAG));
  if (
    limited &&
    !readied &&
    state.combat.turnActorId === actorId &&
    (state.combat.turn.actionUsed || state.combat.turn.bonusActionUsed)
  )
    police(
      state,
      input,
      "condition.one-thing-a-turn",
      `${mover.name} has acted this turn, and ${limited.name} allows only one of moving, an action or a Bonus Action.`,
      outcome
    );
  if (mode === "jump") {
    landsOnDifficult = applyJump(state, input, mover, fromAltitude, toAltitude, outcome, readied);
    if (readied) spendReadied(state, mover.id);
    openOpportunityAttacks(state, input, mover, [from, to], prompts);
    return done();
  }

  // The budget for this way of moving; Prone, the only way is to crawl (SRD Prone: "Your only movement options are
  // to crawl or to spend an amount of movement equal to half your Speed ... to right yourself").
  const crawling = mover.conditions.some((condition) => condition.id === "prone");
  const travel: TravelMode = crawling ? "walk" : mode;
  const moverDefinition = moverDefinitionOf(mover, input);
  const derivation = deriveEquipment(mover, moverDefinition, input.catalog);
  let budget = travelBudgetFeet(mover, derivation, moverDefinition, travel);
  if (budget === null && travel !== "walk") {
    police(state, input, "movement.no-speed", `${mover.name} has no ${MODE_NAMES[travel]} Speed.`, outcome);
    budget = travelBudgetFeet(mover, derivation, moverDefinition, "walk");
  }
  const { extraPerStep, slowed, options } = costOptions(state, input, mover, travel, fromAltitude, toAltitude);
  const straight = () => straightCost(input, from, to, fromAltitude, toAltitude, extraPerStep);
  let charge = input.cost ? input.cost(from, to, options) : straight();
  if (charge?.blocked) {
    police(
      state,
      input,
      "movement.blocked-path",
      state.combat.vision.enabled && state.combat.vision.walls.length > 0
        ? `${mover.name} can't get there. Walls or other creatures bar the way.`
        : `${mover.name} can't get there. Other creatures bar the way.`,
      outcome
    );
    charge = straight();
  }
  const moved = charge?.feet ?? null;
  const difficultFeet = charge?.difficultFeet ?? 0;
  if (moved !== null && budget !== null && moved > 0.05) {
    // A readied move is its own: up to its Speed, whatever the creature whose turn it is has moved.
    const used = readied ? 0 : state.combat.turn.movementUsedFeet;
    const overrun = used + moved > budget + 1e-6;
    if (overrun) {
      const how = [
        difficultFeet > 0 ? `${Math.round(difficultFeet * 10) / 10} ft of it for difficult terrain` : null,
        crawling ? "crawling" : slowed ? `${travel === "climb" ? "climbing" : "swimming"} without the speed` : null,
        input.dragging?.costsExtra ? "dragging" : null
      ].filter((part): part is string => part !== null);
      const message =
        budget === 0
          ? `${mover.name} can't move while its Speed is 0.`
          : `${mover.name} has ${Math.max(0, Math.round((budget - used) * 10) / 10)} ft of movement left (this move needs ${Math.round(moved * 10) / 10} ft${how.length > 0 ? `, ${how.join(", ")}` : ""}).`;
      // A GM Allow covers the movement family for the rest of the turn, as before.
      police(
        state,
        input,
        budget === 0 ? "movement.no-movement-remaining" : "movement.exceeds-speed",
        message,
        outcome,
        true
      );
    }
    if (!readied) state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: used + moved } };
  }
  // The readied move spends the Reaction and uses up the ready, and a spell it held with it.
  if (readied) spendReadied(state, mover.id);
  const path = charge?.path && charge.path.length > 1 ? charge.path : [from, to];
  travelled.path = path;
  const held = openOpportunityAttacks(state, input, mover, path, prompts);
  if (held) {
    // What the rest of the way cost, for a mover the attack stops: its own movement, not a readied move's.
    const rest = readied
      ? null
      : (input.cost
          ? input.cost(held.at, to, costOptions(state, input, mover, travel, held.altitudeFeet, toAltitude).options)
          : straight()
        )?.feet;
    heldAt = {
      position: held.at,
      altitudeFeet: held.altitudeFeet,
      promptIds: held.promptIds,
      refundFeet: rest !== null && rest !== undefined && moved !== null ? Math.min(rest, moved) : 0
    };
  }
  return done(crawling);
}

/** A jump on the creature's turn (SRD Long Jump, High Jump): across up to its long jump and up to its high jump, a
 *  foot of movement for each foot jumped, or a rider's cheap leap (Boots of Striding and Springing). It passes over what
 *  lies between. Returns whether it lands in Difficult Terrain. */
function applyJump(
  state: GameState,
  input: MovementRulesInput,
  mover: GameState["actors"][number],
  fromAltitude: number,
  toAltitude: number,
  outcome: Policing,
  readied: boolean
): boolean {
  const { from, to } = input;
  if (!from || !to) return false;
  if (mover.conditions.some((condition) => condition.id === "prone"))
    police(state, input, "movement.jump", `${mover.name} is Prone and can only crawl.`, outcome);
  const definition = moverDefinitionOf(mover, input);
  const derivation = deriveEquipment(mover, definition, input.catalog);
  const used = readied ? 0 : state.combat.turn.movementUsedFeet;
  // "If you move at least 10 feet immediately before the jump": the run-up is the turn's movement so far.
  const ranUp = used >= 10;
  const limits = jumpLimits(definition, derivation, ranUp);
  const across = input.distance(from, to) ?? 0;
  const rise = Math.max(0, toAltitude - fromAltitude);
  const leap = leapRider(state, mover, derivation);
  const leaping = leap !== null && across <= leap.feet + DISTANCE_TOLERANCE_FEET && rise <= limits.highFeet;
  const start = ranUp ? "" : " from a standing start";
  if (!leaping && across > limits.longFeet + DISTANCE_TOLERANCE_FEET)
    police(
      state,
      input,
      "movement.jump",
      `${mover.name} can jump ${limits.longFeet} ft across${start}, and that space is ${Math.round(across)} ft away.`,
      outcome
    );
  if (rise > limits.highFeet + DISTANCE_TOLERANCE_FEET)
    police(
      state,
      input,
      "movement.jump",
      `${mover.name} can jump ${limits.highFeet} ft up${start}, and that is ${rise} ft.`,
      outcome
    );
  const cost = leaping ? leap.costFeet : Math.max(across, rise);
  const budget = travelBudgetFeet(mover, derivation, definition, "walk");
  if (budget !== null && used + cost > budget + 1e-6)
    police(
      state,
      input,
      budget === 0 ? "movement.no-movement-remaining" : "movement.exceeds-speed",
      budget === 0
        ? `${mover.name} can't move while its Speed is 0.`
        : `${mover.name} has ${Math.max(0, Math.round((budget - used) * 10) / 10)} ft of movement left (this jump needs ${Math.round(cost * 10) / 10} ft).`,
      outcome,
      true
    );
  if (!readied)
    state.combat = {
      ...state.combat,
      turn: {
        ...state.combat.turn,
        movementUsedFeet: used + cost,
        ...(leaping ? { turnUses: { ...state.combat.turn.turnUses, [leap.useKey]: 1 } } : {})
      }
    };
  return input.difficultAt?.(to) === true;
}

/** The name of a source of fear the move ends closer to: the creature behind an effect that frightens the mover. A
 *  source hidden from the table is named as such. Null when the move approaches none. */
function approachesFear(
  state: GameState,
  input: MovementRulesInput,
  mover: GameState["actors"][number],
  from: Point,
  to: Point
): string | null {
  if (!mover.conditions.some((condition) => condition.id === "frightened")) return null;
  for (const sourceId of fearSources(mover)) {
    const source = state.actors.find((actor) => actor.id === sourceId);
    const at = state.combat.tokens.find((token) => token.actorId === sourceId)?.position;
    if (!source || !at) continue;
    const measure = (point: Point, altitudeFeet: number) =>
      input.creatureDistance
        ? input.creatureDistance({ actorId: source.id, position: at }, point, altitudeFeet)
        : input.distance(at, point);
    const before = measure(from, input.fromAltitudeFeet ?? 0);
    const after = measure(to, input.toAltitudeFeet ?? input.fromAltitudeFeet ?? 0);
    if (before !== null && after !== null && after < before - DISTANCE_TOLERANCE_FEET)
      return source.visibility === "gm-only" || input.perceives?.(source.id) === false
        ? HIDDEN_SOURCE.toLowerCase()
        : source.name;
  }
  return null;
}

/** A readied move spends the creature's Reaction and uses up the ready, and a spell it held with it. */
function spendReadied(state: GameState, moverId: string): void {
  state.combat = { ...state.combat, reactionsUsed: [...new Set([...state.combat.reactionsUsed, moverId])] };
  releaseReadied(state, moverId);
}

const moverDefinitionOf = (mover: GameState["actors"][number], input: Pick<MovementRulesInput, "resolveDefinition">) =>
  mover.definitionId ? input.resolveDefinition(mover.definitionId) : undefined;

/** "The ghost can move through other creatures and objects as if they were Difficult Terrain." */
const incorporeal = (definition: ActorDefinition | undefined) =>
  holdsFeature(definition, "incorporeal-movement", "Incorporeal Movement");

/** Freedom of Movement: "The target's movement is unaffected by Difficult Terrain." */
const freeOfDifficultTerrain = (mover: GameState["actors"][number]) =>
  mover.effects.some((effect) => effect.tags.includes("freedom-of-movement"));

/** What each foot of a move costs beside itself, and the options the path's cost is measured with. */
function costOptions(
  state: GameState,
  input: MovementRulesInput,
  mover: GameState["actors"][number],
  travel: TravelMode,
  fromAltitude: number,
  toAltitude: number
): { extraPerStep: number; slowed: boolean; options: MovementCostOptions } {
  const crawling = mover.conditions.some((condition) => condition.id === "prone");
  const moverDefinition = moverDefinitionOf(mover, input);
  const derivation = deriveEquipment(mover, moverDefinition, input.catalog);
  const slowed = crawling || travelCostsExtra(mover, moverDefinition, travel, derivation);
  const extraPerStep = (slowed ? 1 : 0) + (input.dragging?.costsExtra ? 1 : 0);
  return {
    extraPerStep,
    slowed,
    options: {
      extraPerStep,
      carried: input.dragging?.actorIds ?? [],
      resolveDefinition: input.resolveDefinition,
      ...(input.perceives ? { perceives: input.perceives } : {}),
      ...(sharesSpace(state, input.actorId, input) || incorporeal(moverDefinition) ? { passesCreatures: true } : {}),
      // A ghost through walls as Difficult Terrain; a burrower through earth and stone: freely (Earth Glide), or at
      // half its Burrow Speed (Tunneler).
      ...(incorporeal(moverDefinition) || (travel === "burrow" && burrowsThroughWalls(moverDefinition) === "half")
        ? { throughWalls: true }
        : {}),
      ...(travel === "burrow" && burrowsThroughWalls(moverDefinition) === "free" ? { throughWallsFree: true } : {}),
      // Amorphous, Compression and the elementals' forms slip through any gap; a swarm through one a Tiny creature fits.
      ...(openingPassage(moverDefinition) ? { opening: openingPassage(moverDefinition)! } : {}),
      ...(freeOfDifficultTerrain(mover) ? { ignoresDifficult: true } : {}),
      ...(fromAltitude !== 0 || toAltitude !== 0 ? { altitude: { fromFeet: fromAltitude, toFeet: toAltitude } } : {})
    }
  };
}

/** A move's cost as the crow flies, height included by the grid's rule (the larger of across and up). */
function straightCost(
  input: Pick<MovementRulesInput, "distance">,
  from: Point,
  to: Point,
  fromAltitude: number,
  toAltitude: number,
  extraPerStep = 0
): MovementCost | null {
  const distance = input.distance(from, to);
  if (distance === null) return null;
  const rise = Math.abs(toAltitude - fromAltitude);
  return { feet: Math.max(distance, rise) * (1 + extraPerStep), difficultFeet: 0 };
}

/** Why a teleport breaks a granted teleport's terms (SRD: "up to N feet to an unoccupied space you can see"), or null
 *  when it keeps them. */
function teleportRefusal(
  state: GameState,
  input: MovementRulesInput,
  name: string,
  teleport: Readonly<{ feet: number; unseen?: true }>,
  toAltitude: number
): string | null {
  const { from, to } = input;
  if (!from || !to) return null;
  const far = straightCost(input, from, to, input.fromAltitudeFeet ?? 0, toAltitude)?.feet ?? null;
  if (far !== null && far > teleport.feet + DISTANCE_TOLERANCE_FEET)
    return `${name} can teleport up to ${teleport.feet} ft, and that space is ${Math.round(far)} ft away.`;
  if (endsInOccupiedSpace(state, input, to)) return `${name} can teleport only to an unoccupied space.`;
  if (!teleport.unseen && input.seesPoint && !input.seesPoint(to))
    return `${name} can teleport only to a space it can see.`;
  return null;
}

/** The granted move this one is taken with: one for this turn, of this way of moving, with the feet for it. A jump's
 *  grant takes a jump only; a straight charge must end nearer an enemy than it began. Null when none fits, and then
 *  the move is the turn's own. */
function fittingMoveGrant(
  state: GameState,
  input: MovementRulesInput,
  mover: GameState["actors"][number],
  mode: MoveMode,
  fromAltitude: number,
  toAltitude: number
):
  | (MoveGrant & { effectId: string; name: string; chargeFeet: number; costFeet: number; path: readonly Point[] })
  | null {
  const grant = activeMoveGrant(state, mover);
  const { from, to } = input;
  if (!grant || !from || !to || grant.feet <= 0) return null;
  const jumping = mode === "jump";
  if (grant.jump ? !jumping : jumping) return null;
  if (grant.mode !== undefined && grant.mode !== mode) return null;
  const travel: TravelMode = mode === "teleport" || mode === "forced" || mode === "jump" ? "walk" : mode;
  let cost: MovementCost | null;
  if (grant.jump) cost = straightCost(input, from, to, fromAltitude, toAltitude);
  else {
    const { options, extraPerStep } = costOptions(state, input, mover, travel, fromAltitude, toAltitude);
    cost = input.cost
      ? input.cost(from, to, options)
      : straightCost(input, from, to, fromAltitude, toAltitude, extraPerStep);
    if (cost?.blocked) return null;
  }
  if (cost === null || cost.feet > grant.feet + DISTANCE_TOLERANCE_FEET) return null;
  if (grant.straight && !endsNearerAnEnemy(state, input, mover, from, to)) return null;
  if (grant.awayFromActorId && !endsFartherFrom(state, input, grant.awayFromActorId, from, to)) return null;
  // Toward a creature: where it began is farther from that creature than where it ends.
  if (grant.towardActorId && !endsFartherFrom(state, input, grant.towardActorId, to, from)) return null;
  return {
    ...grant,
    chargeFeet: grant.jump ? grant.feet : cost.feet,
    costFeet: grant.costFeet ?? 0,
    path: cost.path && cost.path.length > 1 ? cost.path : [from, to]
  };
}

/** A flight "as far away from you as it can": it ends farther from that creature than it began. */
function endsFartherFrom(state: GameState, input: MovementRulesInput, actorId: string, from: Point, to: Point) {
  const at = state.combat.tokens.find((token) => token.actorId === actorId)?.position;
  if (!at) return true;
  const before = input.distance(at, from);
  const after = input.distance(at, to);
  return before === null || after === null || after > before + DISTANCE_TOLERANCE_FEET;
}

/** A charge "straight toward an enemy": it ends nearer some enemy than it began. */
function endsNearerAnEnemy(
  state: GameState,
  input: MovementRulesInput,
  mover: GameState["actors"][number],
  from: Point,
  to: Point
): boolean {
  return state.combat.tokens.some((token) => {
    const enemy = state.actors.find((actor) => actor.id === token.actorId);
    if (!enemy || !token.position || !areEnemies(mover, enemy, input.resolveDefinition)) return false;
    const before = input.distance(token.position, from);
    const after = input.distance(token.position, to);
    return before !== null && after !== null && after < before - DISTANCE_TOLERANCE_FEET;
  });
}

/** Leaves-reach prompts for every enemy whose reach the mover leaves anywhere along its path (SRD "If you move
 *  heedlessly past your foes, you put yourself in danger"). */
function openOpportunityAttacks(
  state: GameState,
  input: MovementRulesInput,
  mover: GameState["actors"][number],
  path: readonly Point[],
  prompts: Array<{ actorId: string; name: string }>
): Hold | null {
  const { actorId } = input;
  let hold: Hold | null = null;
  if (mover.visibility === "gm-only" || mover.effects.some((effect) => effect.tags.includes("disengaged"))) return null;
  // "The rat doesn't provoke Opportunity Attacks when it moves out of an enemy's reach"; Flyby, when it flies out.
  const moverDefinition = mover.definitionId ? input.resolveDefinition(mover.definitionId) : undefined;
  if (holdsFeature(moverDefinition, "agile", "Agile")) return null;
  if ((input.mode ?? "walk") === "fly" && holdsFeature(moverDefinition, "flyby", "Flyby")) return null;
  for (const entry of state.combat.initiative) {
    if (entry.actorId === actorId || state.combat.pendingReactions.length >= 20) continue;
    const enemy = state.actors.find((candidate) => candidate.id === entry.actorId);
    if (
      !enemy ||
      !areEnemies(mover, enemy, input.resolveDefinition) ||
      state.combat.reactionsUsed.includes(enemy.id) ||
      isIncapacitated(enemy) ||
      // Shocking Grasp, or anything that takes away Reactions.
      enemy.effects.some(
        (effect) => effect.tags.includes(NO_OPPORTUNITY_ATTACKS_TAG) || effect.tags.includes(NO_REACTIONS_TAG)
      )
    )
      continue;
    const enemyPosition = state.combat.tokens.find((token) => token.actorId === enemy.id)?.position ?? null;
    if (!enemyPosition) continue;
    const enemyDefinition = enemy.definitionId ? input.resolveDefinition(enemy.definitionId) : undefined;
    // The enemy's effective actions, so a reach-granting item widens the trigger.
    const reach = Math.max(
      5,
      ...effectiveActions(enemyDefinition, enemy, input.catalog).flatMap((candidate) =>
        candidate.attack?.reachFeet !== undefined ? [candidate.attack.reachFeet] : []
      )
    );
    const measure =
      input.creatureDistance ??
      ((target: Readonly<{ actorId: string; position: Point }>, point: Point) =>
        input.distance(target.position, point));
    // The mover rises or falls evenly along the way, so a flier climbing out of reach leaves it too.
    const heights = altitudesAlong(
      path.length,
      input.fromAltitudeFeet ?? 0,
      input.toAltitudeFeet ?? input.fromAltitudeFeet ?? 0
    );
    // Tolerance both ways: "was in reach" forgives noise at exactly reach, and "now out" needs a real step past it.
    let left: number | null = null;
    let leftIndex = 0;
    for (let index = 1; index < path.length && left === null; index++) {
      const wasIn = measure({ actorId: enemy.id, position: enemyPosition }, path[index - 1]!, heights[index - 1]);
      const nowOut = measure({ actorId: enemy.id, position: enemyPosition }, path[index]!, heights[index]);
      if (
        wasIn !== null &&
        nowOut !== null &&
        wasIn <= reach + DISTANCE_TOLERANCE_FEET &&
        nowOut > reach + DISTANCE_TOLERANCE_FEET
      ) {
        left = wasIn;
        leftIndex = index - 1;
      }
    }
    if (left === null) continue;
    if (input.seenBy ? !input.seenBy(enemy.id) : !seesMover(enemy, enemyDefinition, mover, left)) continue;
    if (input.moverHiddenFromPlayers === true && enemy.ownerSessionId !== null) continue;
    if (
      state.combat.pendingReactions.some(
        (prompt) => prompt.kind === "leaves-reach" && prompt.actorId === enemy.id && prompt.targetActorId === actorId
      )
    )
      continue;
    const promptId = input.newPromptId();
    // "The attack occurs right before the creature leaves your reach": the mover waits at the last point of the way
    // still in reach, the first such point of all the reaches it leaves.
    if (hold === null || leftIndex < hold.index)
      hold = { index: leftIndex, at: path[leftIndex]!, altitudeFeet: heights[leftIndex] ?? 0, promptIds: [] };
    hold.promptIds.push(promptId);
    state.combat = {
      ...state.combat,
      pendingReactions: [
        ...state.combat.pendingReactions,
        {
          id: promptId,
          kind: "leaves-reach" as const,
          actorId: enemy.id,
          actionId: "opportunity-attack",
          actionName: "Opportunity Attack",
          sourceActorId: actorId,
          sourceName: mover.name,
          targetActorId: actorId,
          triggerCommandId: input.commandId,
          proposedDamage: 0,
          proposedDamageParts: [],
          critical: false,
          weighed: null,
          acBonus: null,
          rollsAttack: true,
          parkedAttack: null,
          createdAt: input.now()
        }
      ]
    };
    prompts.push({ actorId: enemy.id, name: enemy.name });
  }
  return hold;
}

/** Where a mover waits while the Opportunity Attacks it provoked are answered, and the prompts it waits on. */
type Hold = { index: number; at: Point; altitudeFeet: number; promptIds: string[] };
