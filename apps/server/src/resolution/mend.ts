import { mendRow } from "../row-penalties.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/** The spells that remove the penalty acid or rust left on an armor or weapon: "The penalty can be removed by casting
 *  the Mending spell on the armor or weapon" (a rust monster's Antennae, an ooze's Pseudopod and Corrosive Form). */
const MENDING_SPELLS: ReadonlySet<string> = new Set(["mending"]);

/** Mending cast on a creature's armor or weapon: the one the cast names (`objectItemId`), else its most penalized one,
 *  loses its penalty. The cast's target carries it, or its caster when it names none. */
export function mendOnCast(ctx: ResolveContext): void {
  const { action, attacker, targets, input, deps } = ctx;
  if (action.spellId === undefined || !MENDING_SPELLS.has(action.spellId) || input.commit === false) return;
  if (!deps.resolveDefinition) return;
  const holder = targets[0] ?? attacker;
  for (const event of mendRow(holder, input.objectItemId, {
    resolveDefinition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {})
  }))
    ctx.tableNarration.push(tableLineOf(ctx, event));
}
