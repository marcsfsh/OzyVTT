import type { CombatState, GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { effectiveModeFor, overrideCovers } from "./rules-families.js";
import { RulesBlockedError } from "./game-store.js";

/**
 * WHERE A TAP GOES (D10, WI3) - decided by the SERVER.
 *
 * The routing used to be a single client-side boolean: `structuredAttacks = liveCombat?.active &&
 * myTurn && actor.kind === "player-character" && definition !== null` on the character sheet. Off-turn,
 * out-of-fight, and monster-sheet taps all silently became loose dice, and the server never had an
 * opinion about it - so the same tap meant different things depending on which client made it, and a
 * player whose turn had passed got no explanation at all, just a die that did nothing.
 *
 * Now the sheet sends INTENT and the server answers with what actually happened. Three routes:
 * - `resolved` - in the fight, on this creature's turn: the full structured resolution, same resolver,
 *   same economy, same narration as `action.resolve`.
 * - `blocked` - in the fight, off turn: a real, machine-readable rules block ("Not your turn yet"),
 *   which means it is overridable by the GM and askable by the player (D8) instead of being silence.
 * - `loose` - no fight, or this creature is not in it: the server rolls the action's own dice and
 *   attributes them, touching no combat state at all.
 */
export type TapRoute = "resolved" | "loose" | "blocked";

/** The one new rule id this file can throw. Lives in the `economy` family (see rules-families.ts). */
export const NOT_YOUR_TURN = "economy.not-your-turn";

/**
 * Which route a tap takes, before anything is rolled.
 *
 * `loose` covers both "there is no fight" and "this creature is not IN the fight" - a GM rolling a
 * wandering monster's attack off the map is not off-turn, they are outside the turn order entirely,
 * and telling them to wait their turn would be nonsense.
 */
export function routeForTap(combat: Pick<CombatState, "active" | "turnActorId" | "initiative">, actorId: string): TapRoute {
  if (!combat.active) return "loose";
  if (!combat.initiative.some((entry) => entry.actorId === actorId)) return "loose";
  return combat.turnActorId === actorId ? "resolved" : "blocked";
}

/**
 * Off-turn: refuse, warn, or wave through, per the `economy` family's mode.
 *
 * Reactions and legendary actions are deliberately exempt: taking them on someone else's turn is the
 * whole point, and `evaluateActionEconomy` already owns their real rules (a spent reaction, an empty
 * legendary pool). Blocking them here would make the router a second, dumber copy of the economy.
 *
 * A GM Allow earlier this turn covers the family, so the same block stops re-prompting (D9).
 */
export function offTurnVerdict(state: GameState, action: Pick<ActorAction, "activation" | "legendary">, currentName: string): Readonly<{ blocked: false; warning: string | null }> {
  if (action.activation === "reaction" || action.legendary !== undefined) return { blocked: false, warning: null };
  const mode = effectiveModeFor(state.combat, NOT_YOUR_TURN);
  if (mode === "freeform" || overrideCovers(state.combat.turn, NOT_YOUR_TURN)) return { blocked: false, warning: null };
  const message = `Not your turn yet - ${currentName} is up.`;
  if (mode === "strict") throw new RulesBlockedError(NOT_YOUR_TURN, message);
  return { blocked: false, warning: message };
}

/**
 * The dice a LOOSE tap rolls: the action's attack roll (honoring an explicit advantage/disadvantage),
 * and - only when the caller asks for it in the same tap - each of its damage parts.
 *
 * Damage is opt-in precisely because it is easy to double-roll: a sheet that renders its own damage
 * chip beside the attack must not also ask for damage here. And a loose damage roll NEVER moves hit
 * points - HP flows through the resolver and the damage commands, unchanged. This function returns
 * formulas; the caller rolls and attributes them through the shared roll writer.
 */
export function looseRollPlan(action: Pick<ActorAction, "name" | "attack" | "damage">, options: Readonly<{ includeDamage: boolean; rollMode?: "advantage" | "disadvantage" | "normal" }>): ReadonlyArray<Readonly<{ formula: string; purpose: "attack" | "damage"; label: string }>> {
  const plan: Array<{ formula: string; purpose: "attack" | "damage"; label: string }> = [];
  if (action.attack) {
    const die = options.rollMode === "advantage" ? "2d20kh1" : options.rollMode === "disadvantage" ? "2d20kl1" : "1d20";
    const bonus = action.attack.bonus;
    plan.push({ formula: `${die}${bonus === 0 ? "" : bonus < 0 ? ` - ${Math.abs(bonus)}` : ` + ${bonus}`}`, purpose: "attack", label: action.name });
  }
  if (options.includeDamage) {
    for (const part of action.damage) plan.push({ formula: part.formula, purpose: "damage", label: `${action.name} (${part.type})` });
  }
  return plan;
}
