import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "../class-features.js";
import { RAGING_TAG } from "../effects.js";
import { armorWeightOf, effectiveSlot } from "@vtt/rules-5e";
import { deriveEquipment, type EquipmentCatalog } from "../equipment-derivation.js";
import type { RuleId } from "../rules-families.js";
import type { DefinitionAction, LiveActor } from "./context.js";

/**
 * When an action may be taken within its user's own turn, beside the slots the economy counts: at the start of the
 * turn (Superior Defense), as part of the Attack action (Sacred Weapon), Step of the Wind straight after another Bonus
 * Action (Fleet Step), and Rage, which Heavy armor refuses before a use is spent.
 */

type Violation = Readonly<{ rule: RuleId; message: string }>;

/** SRD "At the start of your turn": the creature's own turn, before it has moved, attacked or taken anything. */
export function turnJustStarted(state: GameState, actorId: string): boolean {
  const { turn, turnActorId } = state.combat;
  if (turnActorId !== actorId) return false;
  const used = Object.entries(turn.turnUses).some(([key, count]) => count > 0 && key.startsWith(`${actorId}:`));
  return (
    !turn.actionUsed && !turn.bonusActionUsed && turn.movementUsedFeet === 0 && turn.attackRolled !== true && !used
  );
}

/** The Attack action is open on the user's turn: its attacks are being made, or it has made them. */
export function attackActionOpen(state: GameState, actorId: string): boolean {
  const open = state.combat.turn.actionInstance;
  return state.combat.turn.actionUsed && open?.actorId === actorId && open.components.attack !== undefined;
}

/** How many attacks the Attack action makes: the most any one weapon attack makes (Extra Attack folded in). */
export function attacksOfAttackAction(siblings: ReadonlyArray<DefinitionAction>): number {
  return siblings.reduce(
    (most, candidate) =>
      candidate.attack && candidate.activation === "action" && !candidate.multiattack && !candidate.spellId
        ? Math.max(most, candidate.attack.count ?? 1)
        : most,
    1
  );
}

/** Why the action's timing doesn't fit the moment, in a fight; outside one there are no turns to time it by. */
export function timingViolations(state: GameState, attacker: LiveActor, action: DefinitionAction): Violation[] {
  if (!state.combat.active || action.timing === undefined) return [];
  const onOwnTurn = state.combat.turnActorId === attacker.id;
  if (!onOwnTurn)
    return [{ rule: "economy.not-your-turn", message: `${action.name} is used on ${attacker.name}'s own turn.` }];
  if (action.timing === "turn-start" && !turnJustStarted(state, attacker.id))
    return [
      {
        rule: "economy.turn-start",
        message: `${action.name} is used at the start of ${attacker.name}'s turn, before it moves or acts.`
      }
    ];
  if (action.timing === "attack-action" && state.combat.turn.actionUsed && !attackActionOpen(state, attacker.id))
    return [
      {
        rule: "economy.attack-action",
        message: `${action.name} is used when ${attacker.name} takes the Attack action, and its action this turn went on something else.`
      }
    ];
  return [];
}

/** SRD "When you take the Attack action": used before any attack, it takes the action as the Attack action, whose
 *  attacks the weapon swings then spend. Null when the Attack action is already open or there is no turn. */
export function attackActionOpening(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  siblings: ReadonlyArray<DefinitionAction>
): Readonly<{ actorId: string; components: Record<string, number> }> | null {
  if (action.timing !== "attack-action" || !state.combat.active || state.combat.turnActorId !== attacker.id)
    return null;
  if (state.combat.turn.actionUsed) return null;
  return { actorId: attacker.id, components: { attack: attacksOfAttackAction(siblings) } };
}

/** SRD Rage: "You can enter it as a Bonus Action if you aren't wearing Heavy armor." Refused before a use is spent. */
export function rageArmorViolation(
  attacker: LiveActor,
  action: DefinitionAction,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): Violation | null {
  if (!action.grants?.tags.includes(RAGING_TAG)) return null;
  const body = attacker.inventory.find(
    (row) =>
      row.equipped &&
      row.quantity > 0 &&
      row.armor !== undefined &&
      effectiveSlot({ slot: row.magic?.slot, category: row.category }) === "armor"
  );
  const weight = catalog
    ? deriveEquipment(attacker, definition, catalog).context.armorWeight
    : body
      ? armorWeightOf(body.armor!)
      : null;
  if (weight !== "heavy") return null;
  return { rule: "economy.heavy-armor", message: `${attacker.name} is wearing Heavy armor and can't enter a Rage.` };
}

/** Step of the Wind, paid or its free Dash. */
const STEP_OF_THE_WIND: ReadonlySet<string> = new Set(["step-of-the-wind", "dash-bonus"]);
const fleetReadyKey = (actorId: string) => `${actorId}:fleet-step-ready`;
const fleetUsedKey = (actorId: string) => `${actorId}:fleet-step`;

/**
 * SRD Fleet Step: "When you take a Bonus Action other than Step of the Wind, you can also use Step of the Wind
 * immediately after that Bonus Action." `free`: this Step of the Wind takes no Bonus Action of its own; `marks`: what the
 * turn records, the Bonus Action that opens the step or the step taken.
 */
export function fleetStep(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  definition: ActorDefinition | undefined
): Readonly<{ free: boolean; marks: string[] }> {
  const none = { free: false, marks: [] };
  if (!state.combat.active || state.combat.turnActorId !== attacker.id || action.activation !== "bonus-action")
    return none;
  if (!definition || !holdsFeature(definition, "fleet-step", "Fleet Step")) return none;
  const uses = state.combat.turn.turnUses;
  if (!STEP_OF_THE_WIND.has(action.id)) return { free: false, marks: [fleetReadyKey(attacker.id)] };
  const ready = (uses[fleetReadyKey(attacker.id)] ?? 0) > 0 && (uses[fleetUsedKey(attacker.id)] ?? 0) === 0;
  return ready && state.combat.turn.bonusActionUsed ? { free: true, marks: [fleetUsedKey(attacker.id)] } : none;
}
