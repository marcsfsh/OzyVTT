import type { Actor, CombatState, GameState } from "@vtt/domain";
import { d20Die } from "@vtt/rules-5e";
import type { ActorAction } from "@vtt/schemas";
import { effectiveModeFor, overrideCovers, type RuleId } from "./rules-families.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { noUsesRemaining, useLimitFor } from "./resolution/economy.js";

/**
 * Where an action tap goes, decided by the server. The sheet sends intent; the server answers:
 * - `resolved`: in the fight, on this creature's turn; the full structured resolution (`action.resolve`).
 * - `blocked`: in the fight, off turn; a machine-readable rules block the GM can override and the
 *   player can ask about.
 * - `loose`: no fight, or this creature isn't in it; the server rolls the action's dice and attributes
 *   them, touching no combat state.
 */
export type TapRoute = "resolved" | "loose" | "blocked";

/** The rule id this file can throw, in the `economy` family (see rules-families.ts). */
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

/** Off-turn: refuse, warn or allow per the `economy` family's mode. Reactions and legendary actions are
 *  exempt (taken on others' turns by design; `evaluateActionEconomy` owns their rules). A GM Allow earlier
 *  this turn covers the family. */
export function offTurnVerdict(
  state: GameState,
  action: Pick<ActorAction, "activation" | "legendary">,
  currentName: string
): Readonly<{ blocked: false; warning: string | null }> {
  if (action.activation === "reaction" || action.legendary !== undefined) return { blocked: false, warning: null };
  const mode = effectiveModeFor(state.combat, NOT_YOUR_TURN);
  if (mode === "freeform" || overrideCovers(state.combat.turn, NOT_YOUR_TURN)) return { blocked: false, warning: null };
  const message = `Not your turn yet - ${currentName} is up.`;
  if (mode === "strict") throw new RulesBlockedError(NOT_YOUR_TURN, message);
  return { blocked: false, warning: message };
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
 *  Mutates the actor, refusing before anything is spent when nothing remains. */
export function spendLooseUses(
  actor: Actor,
  action: ActorAction,
  siblings: readonly ActorAction[],
  slotLevel: number | undefined = action.spellSlot?.level
): Readonly<{ usesLeft: number | null; spent: boolean }> {
  const uses = action.uses && action.uses.per !== "turn" && action.uses.per !== "encounter" ? action.uses : null;
  const key = uses ? (uses.pool ?? action.id) : null;
  const limit = uses ? useLimitFor(siblings, action) : 0;
  const used = key ? (actor.actionUses[key] ?? 0) : 0;
  if (key && used >= limit) throw new CommandRejectedError(noUsesRemaining(action, limit));
  const level = action.spellSlot ? slotLevel : undefined;
  if (level !== undefined && action.spellSlot && level < action.spellSlot.level)
    throw new CommandRejectedError(`${action.name} needs a slot of level ${action.spellSlot.level} or higher.`);
  if (level !== undefined && !actor.spellSlots?.some((slot) => slot.level === level && slot.remaining > 0))
    throw new CommandRejectedError(`${action.name} spends a level-${level} spell slot - ${actor.name} has none left.`);
  if (key) actor.actionUses = { ...actor.actionUses, [key]: used + 1 };
  if (level !== undefined)
    actor.spellSlots = actor.spellSlots!.map((slot) =>
      slot.level === level ? { ...slot, remaining: slot.remaining - 1 } : slot
    );
  return { usesLeft: key ? limit - used - 1 : null, spent: key !== null || level !== undefined };
}
