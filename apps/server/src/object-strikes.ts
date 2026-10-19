import type { GameState, RollRecord } from "@vtt/domain";
import {
  d20FacesFor,
  d20TestFormula,
  keptD20,
  parseDiceFormula,
  resolveDice,
  resolveWithD20s,
  type DiceResolution,
  type RandomSource
} from "@vtt/rules-5e";
import { catalogIdOf, type ActorDefinition } from "@vtt/schemas";
import { requireActorAccess, type Initiator } from "./authorization.js";
import { holdsFeature } from "./class-features.js";
import { exhaustionPenalty } from "./condition-rules.js";
import type { EffectNarration } from "./effects.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, sourceItemOf, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { damageObject, findObject, type ObjectHit, type ObjectRef } from "./objects.js";
import { criticalExpression } from "./resolution/damage.js";
import { commitEconomy, planEconomy } from "./resolution/economy.js";
import { recordRoll, rolledTerms } from "./roll-history.js";
import { effectiveModeFor, type RulesOverride } from "./rules-families.js";
import { distance, nearestOnSegment } from "./vision/geometry.js";
import { pixelsPerFootOf, segmentOf } from "./vision/sight.js";
import type { TokenMapGeometry } from "./token-placement.js";
import { isHiddenDoor } from "./doors.js";

/**
 * A creature attacks an object (SRD 5.2.1 Breaking Objects: "Objects can be harmed by attacks"): one of its own attacks,
 * rolled against the object's Armor Class as against a creature's, a natural 20 a Critical Hit that doubles the damage
 * dice and a natural 1 a miss, its damage through the object's defences. It spends what the attack spends (one attack
 * of the Attack action, its action) and must reach the object. A Siege Monster deals double damage to objects, and a
 * Sword of Sharpness deals its dice's maximum to one.
 */

type Actor = GameState["actors"][number];

/** SRD Sword of Sharpness: "When you attack an object with this magic sword and hit, maximize your weapon damage dice
 *  against the target." */
const MAXIMIZES_AGAINST_OBJECTS = new Set(["sword-of-sharpness"]);

export type ObjectStrikeInput = Readonly<{
  actorId: string;
  actionId: string;
  target: ObjectRef;
  commandId: string;
  /** The GM's choice of roll mode; a player's is never passed. */
  rollMode?: "advantage" | "disadvantage" | "normal" | null;
  override?: RulesOverride | null;
}>;

export type ObjectStrikeDeps = Readonly<{
  definition: ActorDefinition | undefined;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  random: RandomSource;
  newId: () => string;
  sessionId: string;
  now: () => string;
  geometry: TokenMapGeometry | null;
  /** Feet between two creatures, for an object that holds one. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

export type ObjectStrike = Readonly<{
  objectName: string;
  attackName: string;
  natural: number;
  total: number;
  outcome: "hit" | "crit" | "miss";
  /** What the object took, and whether it broke; null on a miss. */
  hit: ObjectHit | null;
  events: EffectNarration[];
}>;

/** How far the attacker's space is from the object, in feet; null when the map can't say. */
function feetToObject(state: GameState, attacker: Actor, ref: ObjectRef, deps: ObjectStrikeDeps): number | null {
  if (!("wallId" in ref)) return deps.distanceFeet?.(attacker.id, ref.actorId) ?? null;
  const wall = state.combat.vision.walls.find((candidate) => candidate.id === ref.wallId);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === attacker.id);
  const pixelsPerFoot =
    state.combat.vision.measure?.pixelsPerFoot ?? (deps.geometry ? pixelsPerFootOf(deps.geometry) : null);
  if (!wall || !token?.position || !pixelsPerFoot) return null;
  const halfSpace = ((token.gridSizePx ?? token.sizePx) * token.sizeCells) / 2;
  const gap = distance(token.position, nearestOnSegment(token.position, segmentOf(wall))) - halfSpace;
  return Math.max(0, gap) / pixelsPerFoot;
}

/** The attacker's own reasons for Disadvantage on an attack roll that an object can't change (SRD conditions). */
function ownDisadvantage(attacker: Actor): string[] {
  const has = (id: string) => attacker.conditions.some((condition) => condition.id === id);
  return [
    ...(has("blinded") ? ["Blinded"] : []),
    ...(has("poisoned") ? ["Poisoned"] : []),
    ...(has("prone") ? ["Prone"] : []),
    ...(has("restrained") ? ["Restrained"] : [])
  ];
}

function record(
  state: GameState,
  attacker: Actor,
  resolution: DiceResolution,
  purpose: RollRecord["purpose"],
  label: string,
  initiator: Initiator,
  input: ObjectStrikeInput,
  deps: ObjectStrikeDeps
): void {
  recordRoll(state, {
    id: deps.newId(),
    commandId: input.commandId,
    initiatorSessionId: deps.sessionId,
    initiatorRole: initiator.role,
    initiatorLabel: attacker.name,
    label: label.slice(0, 80),
    actorId: attacker.id,
    purpose,
    visibility: attacker.visibility === "public" ? "public" : "gm-only",
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    ...rolledTerms(resolution),
    total: resolution.total,
    createdAt: deps.now()
  });
}

export function strikeObject(
  state: GameState,
  input: ObjectStrikeInput,
  initiator: Initiator,
  deps: ObjectStrikeDeps
): ObjectStrike {
  const attacker = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!attacker) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(initiator, state, attacker.id, "attack", "You can only attack with your own character.");
  const found = findObject(state, input.target);
  // A secret door is wall to a player, so it answers as nothing there.
  if (!found || (found.wall && isHiddenDoor(found.wall) && initiator.role === "player"))
    throw new CommandRejectedError("That object is no longer there.");
  if (state.combat.active && !state.combat.initiative.some((entry) => entry.actorId === attacker.id))
    throw new CommandRejectedError(`${attacker.name} isn't in this fight.`);
  const siblings = effectiveActions(deps.definition, attacker, deps.catalog);
  const action = siblings.find((candidate) => candidate.id === input.actionId);
  if (!action?.attack) throw new CommandRejectedError("Choose one of the creature's attacks.");
  // Reach for a melee attack, the long range for a ranged or thrown one.
  const feet = feetToObject(state, attacker, input.target, deps);
  const reach = Math.max(
    action.attack.reachFeet ?? (action.attack.rangeFeet === undefined ? 5 : 0),
    action.attack.rangeFeet ?? 0
  );
  if (feet !== null && feet > reach + DISTANCE_TOLERANCE_FEET) {
    const rule = "range.out-of-reach" as const;
    const message = `${found.stats.name} is ${Math.round(feet * 10) / 10} ft away, beyond ${action.name}'s ${reach} ft.`;
    if (effectiveModeFor(state.combat, rule) === "strict" && initiator.role === "player")
      throw new RulesBlockedError(rule, message);
  }
  // In a fight the attack spends what it spends against a creature.
  const warnings: string[] = [];
  if (state.combat.active) {
    const economyInput = {
      actorId: attacker.id,
      targetIds: [],
      commandId: input.commandId,
      override: input.override ?? null
    };
    const { plan, overridden } = planEconomy(
      state,
      attacker,
      action,
      economyInput,
      deps.definition,
      warnings,
      undefined,
      siblings,
      false,
      deps.catalog,
      undefined,
      deps.resolveDefinition
    );
    commitEconomy({ state, attacker, plan, overridden, input: economyInput });
  }

  const disadvantage = ownDisadvantage(attacker);
  const mode = input.rollMode ?? (disadvantage.length > 0 ? ("disadvantage" as const) : ("normal" as const));
  const bonus = action.attack.bonus + exhaustionPenalty(attacker);
  const faces = d20FacesFor(mode, [], deps.random);
  const natural = keptD20(faces, mode);
  const roll = resolveWithD20s(d20TestFormula(mode, bonus), faces, deps.random);
  record(state, attacker, roll, "attack", `${action.name} attack roll`, initiator, input, deps);
  const outcome =
    natural === 20 ? "crit" : natural === 1 || roll.total < found.stats.armorClass ? "miss" : ("hit" as const);
  if (outcome === "miss")
    return {
      objectName: found.stats.name,
      attackName: action.name,
      natural,
      total: roll.total,
      outcome,
      hit: null,
      events: []
    };

  const itemId = sourceItemOf(action, deriveEquipment(attacker, deps.definition, deps.catalog), attacker.inventory);
  const row = itemId ? attacker.inventory.find((candidate) => candidate.id === itemId) : undefined;
  const maximized = row !== undefined && MAXIMIZES_AGAINST_OBJECTS.has(catalogIdOf(row));
  const dice: RandomSource = maximized ? (sides) => sides : deps.random;
  const parts = action.damage.map((part) => {
    const expression = parseDiceFormula(part.formula);
    const rolled = resolveDice(outcome === "crit" ? criticalExpression(expression) : expression, dice);
    record(state, attacker, rolled, "damage", `${action.name} damage`, initiator, input, deps);
    return { amount: rolled.total, type: part.type };
  });
  const siege = holdsFeature(deps.definition, "siege-monster", "Siege Monster");
  const hit = damageObject(state, input.target, parts, { siege });
  return {
    objectName: found.stats.name,
    attackName: action.name,
    natural,
    total: roll.total,
    outcome,
    hit,
    events: hit.events
  };
}
