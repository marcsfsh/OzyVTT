import type { EncounterTokenPosition, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { RulesBlockedError } from "./game-store.js";
import { isIncapacitated } from "./condition-rules.js";
import { effectiveActions } from "./effective-actions.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { effectiveSpeedFeet } from "./speed.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import {
  effectiveModeFor,
  familyModeFor,
  overrideCovers,
  overrideReason,
  overrideWaives,
  rememberOverride,
  type RulesOverride
} from "./rules-families.js";

type Point = Readonly<{ x: number; y: number }>;

export type MovementRulesInput = Readonly<{
  actorId: string;
  /** Position before the move; null when entering from the tray (free). */
  from: EncounterTokenPosition | null;
  /** Snapped position after the move; null when returning to the tray (free). */
  to: EncounterTokenPosition | null;
  /** Map distance in feet between two image points; null when unmeasurable. Used for the mover's own budget. */
  distance: (a: Point, b: Point) => number | null;
  /** Footprint-aware feet between an enemy and the mover at `point` (SRD: nearest point of each space); center-to-center when absent. Used for reach. */
  creatureDistance?: (enemy: Readonly<{ actorId: string; position: Point }>, moverPoint: Point) => number | null;
  override: RulesOverride | null;
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
  /** Leaves-reach reaction prompts opened by this move (already pushed into state). */
  prompts: ReadonlyArray<{ actorId: string; name: string }>;
}>;

/**
 * Movement rules for one completed token move (SRD Movement / Opportunity Attacks), run inside the
 * token.move mutation after the snap so distances are authoritative; a strict rejection discards the
 * whole draft.
 *
 * Budget: only the current combatant's own move with known speed on a measurable map; GM off-turn
 * repositioning, tray moves and unknown speeds are free. Speed comes from `effectiveSpeedFeet`
 * (exhaustion, effect modifiers, Speed-0 conditions, Dash).
 *
 * Opportunity attacks: leaving an enemy's melee reach opens a leaves-reach prompt answered as a real
 * melee attack; the move completes first (arrival-timing approximation). Disengage suppresses; a hidden
 * mover prompts no one (a player must not learn a hidden token's retreat). Sides use the
 * player-character vs monster heuristic; NPCs are GM-adjudicated.
 */
export function applyMovementRules(state: GameState, input: MovementRulesInput): MovementRulesOutcome {
  const { actorId, from, to } = input;
  const mover = state.actors.find((candidate) => candidate.id === actorId);
  const prompts: Array<{ actorId: string; name: string }> = [];
  let warning: string | null = null;
  let overridden: string | null = null;
  // The movement family owns both the speed budget and the opportunity-attack prompts.
  if (
    !mover ||
    !state.combat.active ||
    state.combat.turnActorId !== actorId ||
    from === null ||
    to === null ||
    familyModeFor(state.combat, "movement") === "freeform"
  ) {
    return { warning, overridden, prompts };
  }

  const moved = input.distance(from, to);
  const moverDefinition = mover.definitionId ? input.resolveDefinition(mover.definitionId) : undefined;
  const effective = effectiveSpeedFeet(mover, deriveEquipment(mover, moverDefinition, input.catalog));
  if (moved !== null && effective !== null && moved > 0.05) {
    const used = state.combat.turn.movementUsedFeet;
    const overrun = used + moved > effective + 1e-6;
    const rule = effective === 0 ? "movement.no-movement-remaining" : "movement.exceeds-speed";
    const waived = overrideWaives(input.override, rule);
    if (overrun && !waived) {
      const message =
        effective === 0
          ? `${mover.name} can't move - its Speed is 0.`
          : `${mover.name} has ${Math.max(0, Math.round((effective - used) * 10) / 10)} ft of movement left (this move needs ${Math.round(moved * 10) / 10} ft).`;
      // A GM Allow earlier this turn already covers the movement family.
      if (effectiveModeFor(state.combat, rule) === "strict" && !overrideCovers(state.combat.turn, rule))
        throw new RulesBlockedError(rule, message);
      warning = message;
    }
    if (overrun && waived) {
      overridden = overrideReason(input.override);
      rememberOverride(state, rule, input.override);
    }
    state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: used + moved } };
  }

  if (
    mover.visibility !== "gm-only" &&
    mover.kind !== "npc" &&
    !mover.effects.some((effect) => effect.tags.includes("disengaged"))
  ) {
    const enemyKind = mover.kind === "player-character" ? "monster" : "player-character";
    for (const entry of state.combat.initiative) {
      if (entry.actorId === actorId || state.combat.pendingReactions.length >= 20) continue;
      const enemy = state.actors.find((candidate) => candidate.id === entry.actorId);
      if (!enemy || enemy.kind !== enemyKind || state.combat.reactionsUsed.includes(enemy.id) || isIncapacitated(enemy))
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
      const wasIn = measure({ actorId: enemy.id, position: enemyPosition }, from);
      const nowOut = measure({ actorId: enemy.id, position: enemyPosition }, to);
      // Tolerance both ways: "was in reach" forgives noise at exactly reach, and "now out" needs a real step past it.
      if (
        wasIn === null ||
        nowOut === null ||
        wasIn > reach + DISTANCE_TOLERANCE_FEET ||
        nowOut <= reach + DISTANCE_TOLERANCE_FEET
      )
        continue;
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
            createdAt: input.now()
          }
        ]
      };
      prompts.push({ actorId: enemy.id, name: enemy.name });
    }
  }
  return { warning, overridden, prompts };
}
