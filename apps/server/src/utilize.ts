import type { AbilityId, GameState } from "@vtt/domain";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import { catalogIdOf, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { toolAbility, toolUses } from "./ability-checks.js";
import { GameAccessDeniedError, type Initiator } from "./authorization.js";
import { holdsFeature } from "./class-features.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { effectiveModeFor, overrideCovers, type RuleId } from "./rules-families.js";

/**
 * The Utilize action (SRD 5.2.1 Rules Glossary, Utilize; Equipment, Tools): "When an object requires an action for its
 * use, you take the Utilize action." In a fight it takes the creature's action on its own turn, and a Thief's Fast
 * Hands takes it as a Bonus Action instead. Outside a fight nothing is spent. A tool or a piece of gear works only while
 * its user carries it. Doors (`doors.ts`), a Shield donned in a fight (`held-items.ts`) and a tool's or gear's printed
 * uses rolled from the sheet (`check-rolls.ts`) all spend it here.
 */

type Actor = GameState["actors"][number];

/** What a use took: the action, a Fast Hands Bonus Action, or nothing (no fight, or the GM off the creature's turn). */
export type UtilizeSpent = "action" | "bonus-action" | null;

/** SRD Fast Hands (Thief 3): "As a Bonus Action, you can ... take the Utilize action, or take the Magic action to use a
 *  magic item that requires that action", or make a Dexterity (Sleight of Hand) check with Thieves' Tools. */
export const holdsFastHands = (definition: ActorDefinition | undefined) =>
  holdsFeature(definition, "fast-hands", "Fast Hands");

/** Whether `actor` is in the running fight's turn order. */
export const fighting = (state: GameState, actor: Pick<Actor, "id">) =>
  state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id);

/** Refuses a Fast Hands Bonus Action for a creature without the feature. */
export function requireFastHands(actor: Actor, definition: ActorDefinition | undefined): void {
  if (!holdsFastHands(definition))
    throw new CommandRejectedError(`${actor.name} has no Fast Hands to take this as a Bonus Action.`);
}

/**
 * Spends what one use of an object costs in a fight: the action, or with `bonusAction` (Fast Hands) the Bonus Action.
 * A player may use it only on the creature's own turn, and strict rules refuse a second one; the GM may act off the turn,
 * which spends nothing. `what` names the use for the refusal ("Pick the lock").
 */
export function spendUtilize(
  state: GameState,
  actor: Actor,
  initiator: Pick<Initiator, "role">,
  what: string,
  options: Readonly<{
    bonusAction?: boolean;
    definition?: ActorDefinition | undefined;
    /** The thing lets anyone use it as a Bonus Action (a Handy Haversack), so Fast Hands isn't needed. */
    anyone?: boolean;
  }> = {}
): UtilizeSpent {
  if (options.bonusAction && options.anyone !== true) requireFastHands(actor, options.definition);
  const combat = state.combat;
  if (!fighting(state, actor)) return null;
  if (combat.turnActorId !== actor.id) {
    if (initiator.role === "player") throw new GameAccessDeniedError(`${what} on ${actor.name}'s turn.`);
    return null;
  }
  const bonus = options.bonusAction === true;
  const used = bonus ? combat.turn.bonusActionUsed : combat.turn.actionUsed;
  if (used) {
    const rule: RuleId = bonus ? "economy.bonus-action-used" : "economy.action-used";
    if (
      initiator.role === "player" &&
      effectiveModeFor(combat, rule) === "strict" &&
      !overrideCovers(combat.turn, rule)
    )
      throw new RulesBlockedError(
        rule,
        `${actor.name} has already used ${bonus ? "a Bonus Action" : "an Action"} this turn.`
      );
    return bonus ? "bonus-action" : "action";
  }
  state.combat = {
    ...combat,
    turn: { ...combat.turn, ...(bonus ? { bonusActionUsed: true } : { actionUsed: true }) }
  };
  return bonus ? "bonus-action" : "action";
}

/** The carried row of a catalog item, when the creature has one. */
export const carriedRow = (actor: Actor, catalogId: string): InventoryItem | undefined =>
  actor.inventory.find((row) => row.quantity > 0 && catalogIdOf(row) === catalogId);

/** One thing a tool or a piece of gear does when its user takes the Utilize action, and the check it takes. */
export type UtilizeUse = Readonly<{
  label: string;
  dc: number;
  ability: AbilityId;
  /** The skill the check uses with the item (Thieves' Tools: Sleight of Hand; a Grappling Hook: Acrobatics). */
  skill?: string;
  /** The tool whose proficiency the check uses, when the item is a tool. */
  tool?: string;
  /** What a success leaves on the creature the use is for (Cobbler's Tools' footwear). */
  onSuccess?: "next-acrobatics-advantage";
}>;

/** SRD Lock and Fast Hands: picking a lock or disarming a trap with Thieves' Tools is a Dexterity (Sleight of Hand)
 *  check. */
const TOOL_SKILLS: Readonly<Record<string, string>> = { "thieves-tools": "sleight-of-hand" };

/** SRD Cobbler's Tools: "Modify footwear to give Advantage on the wearer's next Dexterity (Acrobatics) check". */
const FOOTWEAR_USE = /^Modify footwear\b/i;

/**
 * The Utilize uses an item's record prints: a tool's "Utilize" line at its DCs with the tool's ability (`toolUses`), or a
 * piece of gear's authored `utilize` checks (a Grappling Hook's DC 13 Dexterity (Acrobatics)). Empty when it prints none.
 */
export function utilizeUses(record: EquipmentReference | undefined): readonly UtilizeUse[] {
  if (!record) return [];
  if (record.category === "tool") {
    const ability = toolAbility(record.description);
    if (!ability) return [];
    const skill = TOOL_SKILLS[record.id];
    return toolUses(record.description).map((use) => ({
      ...use,
      ability,
      tool: record.id,
      ...(skill ? { skill } : {}),
      ...(FOOTWEAR_USE.test(use.label) ? { onSuccess: "next-acrobatics-advantage" as const } : {})
    }));
  }
  return (record.utilize ?? []).map((use) => ({
    label: use.label,
    dc: use.dc,
    ability: use.ability,
    ...(use.skill !== undefined ? { skill: use.skill } : {})
  }));
}
