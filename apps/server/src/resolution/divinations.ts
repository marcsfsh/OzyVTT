import { parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import { recordRoll, type ResolveContext } from "./context.js";

/**
 * SRD Augury, Commune and Divination: "If you cast the spell more than once before finishing a Long Rest, there is a
 * cumulative 25 percent chance for each casting after the first that you get no answer." The casts since the caster's
 * last Long Rest are counted on its uses (a Long Rest clears them); each later cast rolls the d100 and says whether an
 * answer comes. The answer itself is the GM's.
 */
const ASKING_SPELLS: ReadonlySet<string> = new Set(["augury", "commune", "divination"]);

/** The uses key counting a spell's casts since the last Long Rest. */
export const castsSinceRestKey = (spellId: string) => `casts-since-rest-${spellId}`;

export function rollForAnAnswer(ctx: ResolveContext): void {
  const { action, attacker, deps, warnings } = ctx;
  const spellId = action.spellId;
  if (spellId === undefined || !ASKING_SPELLS.has(spellId)) return;
  const key = castsSinceRestKey(spellId);
  const before = attacker.actionUses[key] ?? 0;
  attacker.actionUses = { ...attacker.actionUses, [key]: Math.min(20, before + 1) };
  if (before === 0) return;
  const chance = Math.min(100, 25 * before);
  const rolled = resolveDice(parseDiceFormula("1d100"), deps.random);
  recordRoll(ctx, rolled, "manual", `${action.name}: chance of no answer`);
  warnings.push(
    rolled.total <= chance
      ? `${attacker.name} gets no answer: the d100 shows ${rolled.total} against a ${chance}% chance of none.`
      : `An answer comes: the d100 shows ${rolled.total} against a ${chance}% chance of none.`
  );
}
