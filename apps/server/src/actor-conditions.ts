import type { GameState } from "@vtt/domain";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import type { Initiator } from "./authorization.js";
import { adjustableActor } from "./hit-points.js";
import {
  applyCondition,
  applyExhaustionDeath,
  endConcentrationSustainedBy,
  releaseGrapplesHeldBy,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";
import { conditionLabel, exhaustionLevel, INCAPACITATING_CONDITIONS } from "./condition-rules.js";
import { deriveEquipment } from "./equipment-derivation.js";
import { currentSpeedFeet, effectiveSpeedFeet } from "./speed.js";
import {
  effectiveModeFor,
  familyModeFor,
  overrideCovers,
  overrideWaives,
  rememberOverride,
  type RulesOverride
} from "./rules-families.js";

/** Tracks a condition on an actor. The engine owns the mechanical hooks (ADR-0020): condition immunities
 *  skip with narration, and Exhaustion reaching level 6 is death. Returns narration events. `level` is
 *  Exhaustion's 1-6. Setting an active condition updates its level; clearing an absent one is a no-op. */
export function setCondition(
  state: GameState,
  actorId: string,
  conditionId: string,
  active: boolean,
  level: number | undefined,
  scope: Initiator,
  options?: ConditionImmunitySource & Readonly<{ override?: RulesOverride | null }>
): EffectNarration[] {
  const actor = adjustableActor(state, actorId, scope);
  if (level !== undefined && conditionId !== "exhaustion")
    throw new CommandRejectedError("Only exhaustion has levels.");
  if (!active) {
    const events: EffectNarration[] = [];
    // SRD Prone: standing up costs half your Speed, charged when the current combatant stands on its own
    // turn in a live fight. Off-turn/GM housekeeping is free; Speed 0 can't stand.
    const standingUp = conditionId === "prone" && actor.conditions.some((condition) => condition.id === "prone");
    // Standing up spends movement, so it follows the movement family.
    if (
      standingUp &&
      state.combat.active &&
      state.combat.turnActorId === actor.id &&
      familyModeFor(state.combat, "movement") !== "freeform" &&
      actor.speedFeet !== undefined
    ) {
      // Half your current Speed (slowed or exhausted creatures pay less). Not `effectiveSpeedFeet`: Dash adds
      // movement without raising Speed.
      const definition = actor.definitionId ? options?.resolveDefinition?.(actor.definitionId) : undefined;
      const derivation = deriveEquipment(actor, definition, options?.catalog);
      const cost = Math.floor((currentSpeedFeet(actor, derivation) ?? 0) / 2);
      const effective = effectiveSpeedFeet(actor, derivation) ?? 0;
      const budgetLeft = effective - state.combat.turn.movementUsedFeet;
      // Speed 0 is its own refusal: with a zeroed Speed the cost is also 0, so `cost > budgetLeft` alone would pass.
      const blocked = effective === 0 || cost > budgetLeft;
      // One sentence for both exits: strict throws it, assisted narrates it.
      const violation =
        effective === 0
          ? `${actor.name} can't stand up - its Speed is 0.`
          : `Standing up costs ${cost} ft of movement - ${actor.name} has ${Math.max(0, Math.round(budgetLeft * 10) / 10)} ft left.`;
      const waived = overrideWaives(options?.override, "movement.stand-up-cost");
      if (
        blocked &&
        !waived &&
        effectiveModeFor(state.combat, "movement.stand-up-cost") === "strict" &&
        !overrideCovers(state.combat.turn, "movement.stand-up-cost")
      ) {
        throw new RulesBlockedError("movement.stand-up-cost", violation);
      }
      // A GM Allow here covers the movement family for the rest of the turn, exactly as it does on the map.
      if (blocked && waived) rememberOverride(state, "movement.stand-up-cost", options?.override);
      state.combat = {
        ...state.combat,
        turn: { ...state.combat.turn, movementUsedFeet: state.combat.turn.movementUsedFeet + cost }
      };
      events.push({ kind: "condition", text: `${actor.name} stood up (${cost} ft of movement).`, actorId: actor.id });
      // Assisted mode (and a strict turn already covered by a GM Allow) narrates the violation as a
      // "Rules note", the movement family's convention, rather than passing silently. An explicit
      // `override` on this command is audited by the caller instead.
      if (blocked && !waived) events.push({ kind: "condition", text: `Rules note: ${violation}`, actorId: actor.id });
    }
    actor.conditions = actor.conditions.filter((condition) => condition.id !== conditionId);
    return events;
  }
  const previousExhaustion = exhaustionLevel(actor);
  // Immunity: skip with narration rather than reject (SRD condition immunity). Innate and item-granted
  // immunities read the same; without a catalog only innate ones apply.
  const written = applyCondition(actor, conditionId, { level, immunities: options });
  if (written === "immune") {
    return [
      {
        kind: "condition",
        text: `${actor.name} is immune to ${conditionLabel(conditionId)} - not applied.`,
        actorId: actor.id
      }
    ];
  }
  if (written === "full") throw new CommandRejectedError("That combatant already has too many conditions.");
  // SRD: Exhaustion level 6 is death, the same transition the onEnd grant path fires.
  if (conditionId === "exhaustion" && previousExhaustion < 6 && (level ?? 1) >= 6) {
    return applyExhaustionDeath(state, actor);
  }
  // SRD: an incapacitated creature releases its grapples and its concentration breaks. 0 HP separately
  // releases everything it sustains.
  if ((INCAPACITATING_CONDITIONS as readonly string[]).includes(conditionId)) {
    return [...releaseGrapplesHeldBy(state, actor.id), ...endConcentrationSustainedBy(state, actor.id)];
  }
  return [];
}
