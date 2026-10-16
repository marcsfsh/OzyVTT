import type { Actor, CombatState, GameState, RuleMode } from "@vtt/domain";
import { d20Die } from "@vtt/rules-5e";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { familyModeFor, type RuleId } from "./rules-families.js";
import { CommandRejectedError } from "./game-store.js";
import { castSlot, noUsesRemaining, slotsLeft, spendSlot, unpreparedSpell, useLimitFor } from "./resolution/economy.js";

/**
 * Where an action tap goes, decided by the server. The sheet sends intent; the server answers:
 * - `resolved`: in the fight, on this creature's turn; the full structured resolution (`action.resolve`).
 * - `blocked`: in the fight, off turn; still resolved, where the action economy refuses it with the overridable,
 *   askable `economy.not-your-turn` block (a reaction or a legendary action is the point of acting off turn).
 * - `loose`: no fight, or this creature isn't in it; the server rolls the action's dice and attributes
 *   them, touching no combat state.
 */
export type TapRoute = "resolved" | "loose" | "blocked";

/** The block an off-turn action or Bonus Action meets (`evaluateActionEconomy`), in the `economy` family. */
export const NOT_YOUR_TURN: RuleId = "economy.not-your-turn";

/** Which route a tap takes, before anything is rolled. `loose` covers "no fight" and "not in the fight":
 *  a creature outside the turn order is not off-turn. */
export function routeForTap(
  combat: Pick<CombatState, "active" | "turnActorId" | "initiative">,
  actorId: string
): TapRoute {
  if (!combat.active) return "loose";
  if (!combat.initiative.some((entry) => entry.actorId === actorId)) return "loose";
  return combat.turnActorId === actorId ? "resolved" : "blocked";
}

/** The dice a loose tap rolls: the attack roll (honouring an explicit roll mode), the healing, and, only if asked,
 *  each damage part (opt-in so a sheet with its own damage chip can't double-roll). Never moves hit points;
 *  returns formulas for the caller to roll and attribute. */
export function looseRollPlan(
  action: Pick<ActorAction, "name" | "attack" | "damage" | "healing">,
  options: Readonly<{ includeDamage: boolean; rollMode?: "advantage" | "disadvantage" | "normal" }>
): ReadonlyArray<Readonly<{ formula: string; purpose: "attack" | "damage" | "healing"; label: string }>> {
  const plan: Array<{ formula: string; purpose: "attack" | "damage" | "healing"; label: string }> = [];
  if (action.attack) {
    const die = d20Die(options.rollMode);
    const bonus = action.attack.bonus;
    plan.push({
      formula: `${die}${bonus === 0 ? "" : bonus < 0 ? ` - ${Math.abs(bonus)}` : ` + ${bonus}`}`,
      purpose: "attack",
      label: action.name
    });
  }
  if (action.healing) plan.push({ formula: action.healing.formula, purpose: "healing", label: action.name });
  if (options.includeDamage) {
    for (const part of action.damage)
      plan.push({ formula: part.formula, purpose: "damage", label: `${action.name} (${part.type})` });
  }
  return plan;
}

/** What a loose use spends: an item's charges or a feature's per-rest uses count outside a fight as in one, and so
 *  does a spell slot an item cast consumes. Per-turn and per-encounter limits have no fight to count against.
 *  Mutates the actor, refusing before anything is spent when nothing remains. A missing spell slot is refused only
 *  while the table polices slots (`slots`); advised, it is a GM note, and nothing is spent. */
export function spendLooseUses(
  actor: Actor,
  action: ActorAction,
  siblings: readonly ActorAction[],
  slotLevel?: number,
  slots: RuleMode = "strict",
  definition?: ActorDefinition
): Readonly<{ usesLeft: number | null; spent: boolean; warning?: string }> {
  const uses = action.uses && action.uses.per !== "turn" && action.uses.per !== "encounter" ? action.uses : null;
  const key = uses ? (uses.pool ?? action.id) : null;
  const limit = uses ? useLimitFor(siblings, action) : 0;
  const used = key ? (actor.actionUses[key] ?? 0) : 0;
  if (key && used >= limit) throw new CommandRejectedError(noUsesRemaining(action, limit));
  const slot = action.spellSlot ? castSlot(actor, action.spellSlot.level, slotLevel) : null;
  const slotRefusal =
    slot && action.spellSlot && slot.level < action.spellSlot.level
      ? `${action.name} needs a slot of level ${action.spellSlot.level} or higher.`
      : slot && slotsLeft(actor, slot.level, slot.pact) <= 0
        ? `${action.name} spends a level-${slot.level} ${slot.pact ? "Pact Magic" : "spell"} slot - ${actor.name} has none left.`
        : null;
  const refusal = unpreparedSpell(actor, action, definition) ?? slotRefusal;
  if (refusal !== null && slots === "strict") throw new CommandRejectedError(refusal);
  if (key) actor.actionUses = { ...actor.actionUses, [key]: used + 1 };
  const spendsSlot = slot !== null && slotRefusal === null;
  if (spendsSlot) spendSlot(actor, slot);
  return {
    usesLeft: key ? limit - used - 1 : null,
    spent: key !== null || spendsSlot,
    ...(refusal !== null && slots === "assisted" ? { warning: refusal } : {})
  };
}

/** How strictly spell slots are policed for a tap: the fight's mode in a fight, the table's standing policy outside
 *  one. */
export function slotsModeFor(state: Pick<GameState, "combat" | "rulesPolicy">): RuleMode {
  return state.combat.active
    ? familyModeFor(state.combat, "slots")
    : familyModeFor({ rulesMode: state.rulesPolicy.dial, ruleExceptions: state.rulesPolicy.exceptions }, "slots");
}
