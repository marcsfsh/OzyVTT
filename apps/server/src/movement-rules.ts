import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { RulesBlockedError } from "./game-store.js";
import { effectiveSpeedFeet, isIncapacitated } from "./condition-rules.js";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { effectiveModeFor, familyModeFor, overrideCovers, overrideReason, rememberOverride } from "./rules-families.js";

type Point = Readonly<{ x: number; y: number }>;

export type MovementRulesInput = Readonly<{
  actorId: string;
  /** Position before the move; null = entered from the tray (free). */
  from: EncounterTokenPosition | null;
  /** Authoritative snapped position after the move; null = returned to the tray (free). */
  to: EncounterTokenPosition | null;
  /** Map distance in feet between two image points; null when unmeasurable. Used for the mover's own budget (how far it traveled). */
  distance: (a: Point, b: Point) => number | null;
  /** Footprint-aware feet between an enemy combatant and the mover standing at `point` (SRD: measure from the nearest point of each creature's space); falls back to center-to-center when absent. Used for reach checks. */
  creatureDistance?: (enemy: Readonly<{ actorId: string; position: Point }>, moverPoint: Point) => number | null;
  override: Readonly<{ reason?: string }> | null;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog, so a reach-granting item widens the opportunity-attack trigger. */
  catalog?: EquipmentCatalog;
  newPromptId: () => string;
  now: () => number;
  commandId: string;
}>;

export type MovementRulesOutcome = Readonly<{
  /** Assisted-mode overrun allowed through (GM log note). */
  warning: string | null;
  /** Strict overrun bypassed with the given reason (audited OVERRIDE line). */
  overridden: string | null;
  /** leaves-reach reaction prompts opened by this move (already pushed into state). */
  prompts: ReadonlyArray<{ actorId: string; name: string }>;
}>;

/**
 * Movement rules for one completed token move (SRD Movement and Position / Opportunity Attacks),
 * run INSIDE the token.move mutation after the snap so the measured distance is authoritative - a
 * strict rejection throws and discards the whole draft.
 *
 * Budget: applies only to the current combatant's own willing move with a known speed on a
 * measurable map; GM off-turn repositioning, tray moves, and unknown speeds stay free and never
 * accumulate. Effective speed folds in exhaustion (−5 ft/level), the `speed` modifiers the mover's
 * live effects carry, Speed-0 conditions, and Dashing - all of it in `effectiveSpeedFeet`, so the
 * number in the refusal below is the one the SRD would print.
 *
 * Opportunity attacks: leaving an enemy's melee reach opens a leaves-reach reaction prompt answered
 * as a real melee attack; the move completes first (arrival-timing approximation, documented).
 * Disengage suppresses; a hidden mover prompts no one (a player must never learn a hidden token's
 * retreat); the npc side is GM-adjudicated. Sides use the player-character-vs-monster heuristic.
 */
export function applyMovementRules(state: GameState, input: MovementRulesInput): MovementRulesOutcome {
  const { actorId, from, to } = input;
  const mover = state.actors.find((candidate) => candidate.id === actorId);
  const prompts: Array<{ actorId: string; name: string }> = [];
  let warning: string | null = null;
  let overridden: string | null = null;
  // The movement family owns both halves of this function - the speed budget and the opportunity-attack
  // prompts - so a GM who switches movement policing Off gets neither, and a GM who leaves it on keeps
  // both no matter what the rest of the dial says.
  if (!mover || !state.combat.active || state.combat.turnActorId !== actorId || from === null || to === null || familyModeFor(state.combat, "movement") === "freeform") {
    return { warning, overridden, prompts };
  }

  const moved = input.distance(from, to);
  const effective = effectiveSpeedFeet(mover);
  if (moved !== null && effective !== null && moved > 0.05) {
    const used = state.combat.turn.movementUsedFeet;
    const overrun = used + moved > effective + 1e-6;
    const rule = effective === 0 ? "movement.no-movement-remaining" : "movement.exceeds-speed";
    if (overrun && !input.override) {
      const message = effective === 0
        ? `${mover.name} can't move - its Speed is 0.`
        : `${mover.name} has ${Math.max(0, Math.round((effective - used) * 10) / 10)} ft of movement left (this move needs ${Math.round(moved * 10) / 10} ft).`;
      // A GM Allow earlier this turn already covered movement - don't re-block the same family (D9).
      if (effectiveModeFor(state.combat, rule) === "strict" && !overrideCovers(state.combat.turn, rule)) throw new RulesBlockedError(rule, message);
      warning = message;
    }
    if (overrun && input.override) {
      overridden = overrideReason(input.override);
      // Movement overrides never used to be remembered, so every step re-prompted. They are now.
      rememberOverride(state, rule);
    }
    state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: used + moved } };
  }

  if (mover.visibility !== "gm-only" && mover.kind !== "npc" && !mover.effects.some((effect) => effect.tags.includes("disengaged"))) {
    const enemyKind = mover.kind === "player-character" ? "monster" : "player-character";
    for (const entry of state.combat.initiative) {
      if (entry.actorId === actorId || state.combat.pendingReactions.length >= 20) continue;
      const enemy = state.actors.find((candidate) => candidate.id === entry.actorId);
      if (!enemy || enemy.kind !== enemyKind || state.combat.reactionsUsed.includes(enemy.id) || isIncapacitated(enemy)) continue;
      const enemyPosition = state.combat.tokens.find((token) => token.actorId === enemy.id)?.position ?? null;
      if (!enemyPosition) continue;
      const enemyDefinition = enemy.definitionId ? input.resolveDefinition(enemy.definitionId) : undefined;
      // The ENEMY's effective actions: a reach-granting item must widen the trigger, or the prompt never appears.
      const reach = Math.max(5, ...effectiveActions(enemyDefinition, enemy, input.catalog).flatMap((candidate) => candidate.attack?.reachFeet !== undefined ? [candidate.attack.reachFeet] : []));
      const measure = input.creatureDistance ?? ((target: Readonly<{ actorId: string; position: Point }>, point: Point) => input.distance(target.position, point));
      const wasIn = measure({ actorId: enemy.id, position: enemyPosition }, from);
      const nowOut = measure({ actorId: enemy.id, position: enemyPosition }, to);
      // Tolerance both ways: "was in reach" forgives snapping dust at exactly reach, and "now out"
      // fires only on a real step past it (≥ one cell on a grid) rather than sub-foot float drift.
      if (wasIn === null || nowOut === null || wasIn > reach + DISTANCE_TOLERANCE_FEET || nowOut <= reach + DISTANCE_TOLERANCE_FEET) continue;
      if (state.combat.pendingReactions.some((prompt) => prompt.kind === "leaves-reach" && prompt.actorId === enemy.id && prompt.targetActorId === actorId)) continue;
      state.combat = { ...state.combat, pendingReactions: [...state.combat.pendingReactions, {
        id: input.newPromptId(), kind: "leaves-reach" as const, actorId: enemy.id, actionId: "opportunity-attack", actionName: "Opportunity Attack",
        sourceActorId: actorId, sourceName: mover.name, targetActorId: actorId, triggerCommandId: input.commandId,
        proposedDamage: 0, proposedDamageParts: [], critical: false, createdAt: input.now()
      }] };
      prompts.push({ actorId: enemy.id, name: enemy.name });
    }
  }
  return { warning, overridden, prompts };
}
