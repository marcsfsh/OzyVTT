import type { ActorMovementReply, EncounterTokenPosition, GameState } from "@vtt/domain";
import type { MoveMode } from "@vtt/domain/commands";
import type { ActorDefinition } from "@vtt/schemas";
import { footprintOrigin } from "@vtt/rules-5e";
import { RulesBlockedError } from "./game-store.js";
import { holdsFeature } from "./class-features.js";
import { isIncapacitated } from "./condition-rules.js";
import { areEnemies } from "./creature-sides.js";
import { effectiveActions } from "./effective-actions.js";
import {
  NO_OPPORTUNITY_ATTACKS_TAG,
  NO_REACTIONS_TAG,
  ONE_THING_A_TURN_TAG,
  READIED_TAG,
  releaseReadied
} from "./effects.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { imageToGrid, type SquareGridCalibration } from "./grid-calibration.js";
import { travelBudgetFeet, travelCostsExtra, type TravelMode } from "./speed.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import type { MovementCost, MovementCostOptions } from "./terrain.js";
import { moveEncounterToken, type TokenMapGeometry } from "./token-placement.js";
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
  /** A player moved the token (not the GM): off its turn, or by teleportation, that needs the GM's go-ahead. */
  byPlayer?: boolean;
  /** Map distance in feet between two image points; null when unmeasurable. */
  distance: (a: Point, b: Point) => number | null;
  /** What the move costs the mover, difficult terrain, creatures and extra costs included (`movementCost`);
   *  `distance` when absent. */
  cost?: (from: Point, to: Point, options: MovementCostOptions) => MovementCost | null;
  /** Footprint-aware feet between an enemy and the mover at `point` (SRD: nearest point of each space); center-to-center when absent. Used for reach. */
  creatureDistance?: (enemy: Readonly<{ actorId: string; position: Point }>, moverPoint: Point) => number | null;
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
 * Opportunity attacks: leaving an enemy's melee reach anywhere along the path opens a leaves-reach prompt answered as
 * a real melee attack; the move completes first (arrival-timing approximation). Disengage suppresses; a hidden mover
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
      : {})
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
  return (swarmOnly ? ["Swarm"] : SHARES_SPACE).some((name) => holdsFeature(definition, name, name));
};

/** SRD: "You can't willingly end a move in a space occupied by another creature." Hidden creatures don't count, so
 *  the refusal can't give one away; neither do the creatures the mover drags. */
function endsInOccupiedSpace(state: GameState, input: MovementRulesInput, to: Point): boolean {
  if (!input.calibration || sharesSpace(state, input.actorId, input)) return false;
  const moverToken = state.combat.tokens.find((token) => token.actorId === input.actorId);
  const mine = cellsAt(input.calibration, to, moverToken?.sizeCells ?? 1);
  return state.combat.tokens.some((token) => {
    if (token.actorId === input.actorId || !token.position || input.dragging?.actorIds.includes(token.actorId))
      return false;
    if (sharesSpace(state, token.actorId, input, true)) return false;
    if (state.actors.find((actor) => actor.id === token.actorId)?.visibility === "gm-only") return false;
    if (input.perceives && !input.perceives(token.actorId)) return false;
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
  const done = (crawled = false): MovementRulesOutcome => ({
    warning: outcome.warnings.length > 0 ? outcome.warnings.join(" ") : null,
    overridden: outcome.overridden,
    prompts,
    crawled,
    ...(readied ? { readied: true as const } : {})
  });
  // Forced movement is the GM's (the command refuses a player's), and spends nothing.
  if (!mover || from === null || to === null || mode === "forced") return done();
  readied = readiedMove(state, mover, mode);
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
  if (input.byPlayer && turnsRunning(state) && state.combat.turnActorId !== actorId && !readied)
    police(
      state,
      input,
      "movement.off-turn",
      `It isn't ${mover.name}'s turn, so moving now needs the GM's go-ahead.`,
      outcome
    );
  // Teleportation spends no movement and provokes nothing, and a player's needs the GM's go-ahead (the spell or
  // feature that grants it is theirs to rule on).
  if (mode === "teleport" && input.byPlayer)
    police(state, input, "movement.teleport", `${mover.name} can teleport only with the GM's go-ahead.`, outcome);
  if ((counted || input.byPlayer) && endsInOccupiedSpace(state, input, to))
    police(state, input, "movement.occupied", `${mover.name} can't end its move in another creature's space.`, outcome);
  if (mode === "teleport" || !counted) return done();
  // SRD Abjure Foes: a creature limited to one of moving, an action or a Bonus Action that took either can't move.
  const limited = mover.effects.find((effect) => effect.tags.includes(ONE_THING_A_TURN_TAG));
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

  // The budget for this way of moving; Prone, the only way is to crawl (SRD Prone: "Your only movement options are
  // to crawl or to spend an amount of movement equal to half your Speed ... to right yourself").
  const crawling = mover.conditions.some((condition) => condition.id === "prone");
  const travel: TravelMode = crawling ? "walk" : mode;
  const moverDefinition = mover.definitionId ? input.resolveDefinition(mover.definitionId) : undefined;
  const derivation = deriveEquipment(mover, moverDefinition, input.catalog);
  let budget = travelBudgetFeet(mover, derivation, moverDefinition, travel);
  if (budget === null && travel !== "walk") {
    police(state, input, "movement.no-speed", `${mover.name} has no ${MODE_NAMES[travel]} Speed.`, outcome);
    budget = travelBudgetFeet(mover, derivation, moverDefinition, "walk");
  }
  const slowed = crawling || travelCostsExtra(mover, moverDefinition, travel, derivation);
  const extraPerStep = (slowed ? 1 : 0) + (input.dragging?.costsExtra ? 1 : 0);
  const options: MovementCostOptions = {
    extraPerStep,
    carried: input.dragging?.actorIds ?? [],
    resolveDefinition: input.resolveDefinition,
    ...(input.perceives ? { perceives: input.perceives } : {}),
    ...(sharesSpace(state, actorId, input) ? { passesCreatures: true } : {})
  };
  const straight = (): MovementCost | null => {
    const distance = input.distance(from, to);
    return distance === null ? null : { feet: distance * (1 + extraPerStep), difficultFeet: 0 };
  };
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
  if (readied) {
    state.combat = { ...state.combat, reactionsUsed: [...new Set([...state.combat.reactionsUsed, mover.id])] };
    releaseReadied(state, mover.id);
  }
  openOpportunityAttacks(state, input, mover, charge?.path ?? [from, to], prompts);
  return done(crawling);
}

/** Leaves-reach prompts for every enemy whose reach the mover leaves anywhere along its path (SRD "If you move
 *  heedlessly past your foes, you put yourself in danger"). */
function openOpportunityAttacks(
  state: GameState,
  input: MovementRulesInput,
  mover: GameState["actors"][number],
  path: readonly Point[],
  prompts: Array<{ actorId: string; name: string }>
): void {
  const { actorId } = input;
  if (mover.visibility === "gm-only" || mover.effects.some((effect) => effect.tags.includes("disengaged"))) return;
  // "The rat doesn't provoke Opportunity Attacks when it moves out of an enemy's reach"; Flyby, when it flies out.
  const moverDefinition = mover.definitionId ? input.resolveDefinition(mover.definitionId) : undefined;
  if (holdsFeature(moverDefinition, "agile", "Agile")) return;
  if ((input.mode ?? "walk") === "fly" && holdsFeature(moverDefinition, "flyby", "Flyby")) return;
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
    // Tolerance both ways: "was in reach" forgives noise at exactly reach, and "now out" needs a real step past it.
    let left: number | null = null;
    for (let index = 1; index < path.length && left === null; index++) {
      const wasIn = measure({ actorId: enemy.id, position: enemyPosition }, path[index - 1]!);
      const nowOut = measure({ actorId: enemy.id, position: enemyPosition }, path[index]!);
      if (
        wasIn !== null &&
        nowOut !== null &&
        wasIn <= reach + DISTANCE_TOLERANCE_FEET &&
        nowOut > reach + DISTANCE_TOLERANCE_FEET
      )
        left = wasIn;
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
    state.combat = {
      ...state.combat,
      pendingReactions: [
        ...state.combat.pendingReactions,
        {
          id: input.newPromptId(),
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
}
