import type { GameState } from "@vtt/domain";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { adjustableActor, type ActorScope } from "./hit-points.js";
import { applyExhaustionDeath, endConcentrationSustainedBy, releaseGrapplesHeldBy, type EffectNarration } from "./effects.js";
import { conditionLabel, effectiveSpeedFeet, exhaustionLevel, INCAPACITATING_CONDITIONS } from "./condition-rules.js";
import { effectiveModeFor, familyModeFor, overrideCovers, rememberOverride } from "./rules-families.js";

/**
 * Track a condition on an actor. Display remains the source of truth for prose effects, but the
 * engine now owns the mechanical hooks (ADR-0020 amendments): condition immunities skip with
 * narration instead of applying, and Exhaustion reaching level 6 is death. Returns narration events
 * for the caller to log. `level` is exhaustion's 1-6; other conditions carry none. Setting an
 * already-active condition updates its level; clearing an absent one is a no-op.
 */
export function setCondition(state: GameState, actorId: string, conditionId: string, active: boolean, level: number | undefined, scope: ActorScope, options?: Readonly<{ override?: { reason?: string } | null }>): EffectNarration[] {
  const actor = adjustableActor(state, actorId, scope);
  if (level !== undefined && conditionId !== "exhaustion") throw new CommandRejectedError("Only exhaustion has levels.");
  const remaining = actor.conditions.filter((condition) => condition.id !== conditionId);
  if (!active) {
    const events: EffectNarration[] = [];
    // SRD Prone: standing up costs half your Speed - charged when the current combatant stands on
    // its own turn during a live fight. Off-turn/GM housekeeping stays free; Speed 0 can't stand.
    const standingUp = conditionId === "prone" && actor.conditions.some((condition) => condition.id === "prone");
    // Standing up spends MOVEMENT, so it follows the movement family, not the table-wide dial.
    if (standingUp && state.combat.active && state.combat.turnActorId === actor.id && familyModeFor(state.combat, "movement") !== "freeform" && actor.speedFeet !== undefined) {
      const cost = Math.floor(actor.speedFeet / 2);
      const effective = effectiveSpeedFeet(actor) ?? 0;
      const budgetLeft = effective - state.combat.turn.movementUsedFeet;
      if (cost > budgetLeft && !options?.override && effectiveModeFor(state.combat, "movement.stand-up-cost") === "strict" && !overrideCovers(state.combat.turn, "movement.stand-up-cost")) {
        throw new RulesBlockedError("movement.stand-up-cost", effective === 0
          ? `${actor.name} can't stand up - its Speed is 0.`
          : `Standing up costs ${cost} ft of movement - ${actor.name} has ${Math.max(0, Math.round(budgetLeft * 10) / 10)} ft left.`);
      }
      // A GM Allow here covers the movement family for the rest of the turn, exactly as it does on the map.
      if (cost > budgetLeft && options?.override) rememberOverride(state, "movement.stand-up-cost");
      state.combat = { ...state.combat, turn: { ...state.combat.turn, movementUsedFeet: state.combat.turn.movementUsedFeet + cost } };
      events.push({ kind: "condition", text: `${actor.name} stood up (${cost} ft of movement).`, actorId: actor.id });
    }
    actor.conditions = remaining;
    return events;
  }
  // Immunity: skip-with-narration rather than blocking - this is a manual GM command, and telling
  // the table WHY nothing happened beats a rejection dialog (SRD condition immunity).
  if (actor.conditionImmunities.includes(conditionId)) {
    return [{ kind: "condition", text: `${actor.name} is immune to ${conditionLabel(conditionId)} - not applied.`, actorId: actor.id }];
  }
  if (remaining.length >= 20) throw new CommandRejectedError("That combatant already has too many conditions.");
  const previousExhaustion = exhaustionLevel(actor);
  actor.conditions = [...remaining, { id: conditionId, ...(conditionId === "exhaustion" ? { level: level ?? 1 } : {}) }]
    .sort((left, right) => left.id.localeCompare(right.id));
  // SRD: Exhaustion level 6 is death - same engine-owned transition the onEnd grant path fires.
  if (conditionId === "exhaustion" && previousExhaustion < 6 && (level ?? 1) >= 6) {
    return applyExhaustionDeath(state, actor);
  }
  // SRD: an incapacitated creature releases its grapples (Grappling) and its concentration breaks
  // (Concentration). 0 HP separately releases everything it sustains.
  if ((INCAPACITATING_CONDITIONS as readonly string[]).includes(conditionId)) {
    return [...releaseGrapplesHeldBy(state, actor.id), ...endConcentrationSustainedBy(state, actor.id)];
  }
  return [];
}
