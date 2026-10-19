import type { GameState, RollVisibility } from "@vtt/domain";
import type { CheckSubject } from "./ability-checks.js";
import { canPlayerTarget, GameAccessDeniedError, requireActorAccess, type Initiator } from "./authorization.js";
import { rollAbilityCheck, type CheckResult, type CheckRollDependencies, type CheckRollInput } from "./check-rolls.js";
import { CommandRejectedError } from "./game-store.js";
import { carriedRow, spendUtilize, utilizeUses, type UtilizeUse } from "./utilize.js";

/**
 * A tool's or a piece of gear's Utilize use, rolled as a check (SRD 5.2.1 Tools: "This entry lists things you can do
 * with the tool when you take the Utilize action ... This entry also provides the DC for the action"). The use is one
 * its record prints, at its DC and with its ability; the item must be carried; in a fight it takes the Utilize action,
 * or a Thief's Bonus Action (Fast Hands). The check adds the tool's proficiency where the roller has it, and Advantage
 * with a skill the use names that the roller is proficient in. `rollUtilizeCheck` is the step other rules call for
 * their own tool checks (a lock on Manacles, a trap).
 */

/** The slack on "within 5 feet", as for reach. */
const TOUCH_FEET = 5.1;

export type UtilizeCheckInput = Readonly<{
  commandId: string;
  actorId: string;
  /** The carried tool or piece of gear the use needs, by catalog id. */
  itemId: string;
  subject: CheckSubject;
  dc: number;
  /** What the roll is named ("Pick a lock (Thieves' Tools)"). */
  label: string;
  visibility: RollVisibility;
  face?: number;
  forcedMode?: CheckRollInput["forcedMode"];
  situations?: readonly string[];
  /** Take the use as a Bonus Action (Fast Hands). */
  bonusAction?: boolean;
  onSuccess?: CheckRollInput["onSuccess"];
}>;

/** One Utilize check with an item: the item carried, the use's cost spent, then the check rolled at its DC. */
export function rollUtilizeCheck(
  state: GameState,
  scope: Initiator,
  input: UtilizeCheckInput,
  deps: CheckRollDependencies
): CheckResult {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(scope, state, actor.id, "check", "You can only roll for your own character.");
  const name = deps.catalog?.equipmentRecord(input.itemId)?.name ?? input.itemId;
  if (!carriedRow(actor, input.itemId))
    throw new CommandRejectedError(`${actor.name} needs ${name} in the pack to do that.`);
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  spendUtilize(state, actor, scope, input.label, { bonusAction: input.bonusAction === true, definition });
  return rollAbilityCheck(
    state,
    scope,
    {
      commandId: input.commandId,
      actorId: actor.id,
      subject: input.subject,
      dc: input.dc,
      visibility: input.visibility,
      label: input.label,
      ...(input.face !== undefined ? { face: input.face } : {}),
      ...(input.forcedMode !== undefined ? { forcedMode: input.forcedMode } : {}),
      ...(input.situations !== undefined ? { situations: input.situations } : {}),
      ...(input.onSuccess !== undefined ? { onSuccess: input.onSuccess } : {})
    },
    deps
  );
}

export type ItemUseInput = Readonly<{
  commandId: string;
  actorId: string;
  itemId: string;
  /** Which of the item's printed Utilize uses, by its place in the list. */
  use: number;
  visibility: RollVisibility;
  face?: number;
  forcedMode?: CheckRollInput["forcedMode"];
  situations?: readonly string[];
  bonusAction?: boolean;
  /** The creature the use works for (the wearer of the footwear Cobbler's Tools modify); absent, the roller. */
  forActorId?: string;
}>;

/** The printed use, by its place in the item's list, refused when the item prints none there. */
export function itemUseOf(
  deps: CheckRollDependencies,
  itemId: string,
  index: number
): Readonly<{ use: UtilizeUse; itemName: string }> {
  const record = deps.catalog?.equipmentRecord(itemId);
  const use = utilizeUses(record)[index];
  if (!record || !use) throw new CommandRejectedError("That item has no such use.");
  return { use, itemName: record.name };
}

/** A tool's or gear's printed Utilize use, from the sheet: the record's DC and ability, never the caller's. */
export function rollItemUse(
  state: GameState,
  scope: Initiator,
  input: ItemUseInput,
  deps: CheckRollDependencies
): CheckResult {
  const { use, itemName } = itemUseOf(deps, input.itemId, input.use);
  const onSuccess = use.onSuccess ? { kind: use.onSuccess, actorId: forWhom(state, scope, input, deps) } : undefined;
  return rollUtilizeCheck(
    state,
    scope,
    {
      commandId: input.commandId,
      actorId: input.actorId,
      itemId: input.itemId,
      subject: {
        ability: use.ability,
        ...(use.skill !== undefined ? { skill: use.skill } : {}),
        ...(use.tool !== undefined ? { tool: use.tool } : {})
      },
      dc: use.dc,
      label: `${use.label} (${itemName})`.slice(0, 80),
      visibility: input.visibility,
      ...(input.face !== undefined ? { face: input.face } : {}),
      ...(input.forcedMode !== undefined ? { forcedMode: input.forcedMode } : {}),
      ...(input.situations !== undefined ? { situations: input.situations } : {}),
      ...(input.bonusAction !== undefined ? { bonusAction: input.bonusAction } : {}),
      ...(onSuccess ? { onSuccess } : {})
    },
    deps
  );
}

/** Who a use works for: the roller, or a creature the roller can reach and, for a player, see. */
function forWhom(state: GameState, scope: Initiator, input: ItemUseInput, deps: CheckRollDependencies): string {
  const id = input.forActorId ?? input.actorId;
  if (id === input.actorId) return id;
  const other = state.actors.find((candidate) => candidate.id === id);
  if (!other || (scope.role === "player" && !canPlayerTarget(state, id, deps.unseen)))
    throw new GameAccessDeniedError("Choose a creature you can see.");
  const feet = deps.distanceFeet?.(input.actorId, id) ?? null;
  if (feet !== null && feet > TOUCH_FEET)
    throw new CommandRejectedError(`${other.name} is too far away. Move within 5 feet first.`);
  return id;
}

/** SRD Fast Hands: "Make a Dexterity (Sleight of Hand) check to pick a lock or disarm a trap with Thieves' Tools or to
 *  pick a pocket" as a Bonus Action. A plain check spends nothing; this one spends the Thief's Bonus Action. */
export function spendFastHandsCheck(
  state: GameState,
  scope: Initiator,
  actorId: string,
  subject: CheckSubject,
  deps: CheckRollDependencies
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(scope, state, actor.id, "check", "You can only roll for your own character.");
  if (subject.ability !== "dex" || subject.skill !== "sleight-of-hand")
    throw new CommandRejectedError("Fast Hands makes a Dexterity (Sleight of Hand) check as a Bonus Action.");
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  spendUtilize(state, actor, scope, "Make a Sleight of Hand check", { bonusAction: true, definition });
}
