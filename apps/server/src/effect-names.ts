/** A stat block's note on how often an action is used, printed after its name. */
const USES_NOTE = /\s*\((?:Recharge[^)]*|\d+\/Day(?: Each)?|Costs \d+ Actions?)\)\s*$/i;

/** An action's name as an effect it leaves is named: without the uses note ("Spores (Recharge 6)" leaves "Spores"),
 *  which says nothing about the effect. */
export function effectNameOf(actionName: string): string {
  return actionName.replace(USES_NOTE, "").trim() || actionName;
}
