import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { adjustableActor, type ActorScope } from "./hit-points.js";
import {
  applyExhaustionDeath,
  endConcentrationSustainedBy,
  releaseGrapplesHeldBy,
  type EffectNarration
} from "./effects.js";
import {
  conditionLabel,
  currentSpeedFeet,
  effectiveSpeedFeet,
  exhaustionLevel,
  INCAPACITATING_CONDITIONS
} from "./condition-rules.js";
import { effectiveModeFor, familyModeFor, overrideCovers, rememberOverride } from "./rules-families.js";

/** Tracks a condition on an actor. The engine owns the mechanical hooks (ADR-0020): condition immunities
 *  skip with narration, and Exhaustion reaching level 6 is death. Returns narration events. `level` is
 *  Exhaustion's 1-6. Setting an active condition updates its level; clearing an absent one is a no-op. */
export function setCondition(
  state: GameState,
  actorId: string,
  conditionId: string,
  active: boolean,
  level: number | undefined,
  scope: ActorScope,
  options?: Readonly<{
    override?: { reason?: string } | null;
    resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
  }>
): EffectNarration[] {
  const actor = adjustableActor(state, actorId, scope);
  if (level !== undefined && conditionId !== "exhaustion")
    throw new CommandRejectedError("Only exhaustion has levels.");
  const remaining = actor.conditions.filter((condition) => condition.id !== conditionId);
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
      const cost = Math.floor((currentSpeedFeet(actor) ?? 0) / 2);
      const effective = effectiveSpeedFeet(actor) ?? 0;
      const budgetLeft = effective - state.combat.turn.movementUsedFeet;
      // Speed 0 is its own refusal: with a zeroed Speed the cost is also 0, so `cost > budgetLeft` alone would pass.
      const blocked = effective === 0 || cost > budgetLeft;
      // One sentence for both exits: strict throws it, assisted narrates it.
      const violation =
        effective === 0
          ? `${actor.name} can't stand up - its Speed is 0.`
          : `Standing up costs ${cost} ft of movement - ${actor.name} has ${Math.max(0, Math.round(budgetLeft * 10) / 10)} ft left.`;
      if (
        blocked &&
        !options?.override &&
        effectiveModeFor(state.combat, "movement.stand-up-cost") === "strict" &&
        !overrideCovers(state.combat.turn, "movement.stand-up-cost")
      ) {
        throw new RulesBlockedError("movement.stand-up-cost", violation);
      }
      // A GM Allow here covers the movement family for the rest of the turn, exactly as it does on the map.
      if (blocked && options?.override) rememberOverride(state, "movement.stand-up-cost");
      state.combat = {
        ...state.combat,
        turn: { ...state.combat.turn, movementUsedFeet: state.combat.turn.movementUsedFeet + cost }
      };
      events.push({ kind: "condition", text: `${actor.name} stood up (${cost} ft of movement).`, actorId: actor.id });
      // Assisted mode (and a strict turn already covered by a GM Allow) narrates the violation as a
      // "Rules note", the movement family's convention, rather than passing silently. An explicit
      // `override` on this command is audited by the caller instead.
      if (blocked && !options?.override)
        events.push({ kind: "condition", text: `Rules note: ${violation}`, actorId: actor.id });
    }
    actor.conditions = remaining;
    return events;
  }
  // Immunity: skip with narration rather than reject (SRD condition immunity). Innate and item-granted
  // immunities read the same; without a catalog only innate ones apply.
  const granted = options?.catalog
    ? deriveEquipment(
        actor,
        actor.definitionId ? options.resolveDefinition?.(actor.definitionId) : undefined,
        options.catalog
      ).conditionImmunities
    : [];
  const grantedImmunity = granted.find((entry) => entry.id === conditionId);
  if (actor.conditionImmunities.includes(conditionId) || grantedImmunity) {
    return [
      {
        kind: "condition",
        text: `${actor.name} is immune to ${conditionLabel(conditionId)} - not applied.`,
        actorId: actor.id
      }
    ];
  }
  if (remaining.length >= 20) throw new CommandRejectedError("That combatant already has too many conditions.");
  const previousExhaustion = exhaustionLevel(actor);
  actor.conditions = [
    ...remaining,
    { id: conditionId, ...(conditionId === "exhaustion" ? { level: level ?? 1 } : {}) }
  ].sort((left, right) => left.id.localeCompare(right.id));
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
