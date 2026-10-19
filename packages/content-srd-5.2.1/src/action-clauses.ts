/**
 * Printed clauses a stat-block action's readers turn into data, and whether the action carries that data. The content
 * build reports each clause an action prints and doesn't carry, and a server test holds every action the manifest marks
 * enforced to carry all of its own, so a rider the readers drop can't hide behind a damage roll that does resolve.
 */
import type { ActorAction } from "@vtt/schemas";

/** One kind of printed clause: a Speed cut, a roll at Disadvantage, no Reactions, a size gate, a creature type left
 *  out, "each enemy", and a creature that must see the user. */
export type ActionClause = "speed" | "disadvantage" | "no-reactions" | "size" | "not-type" | "each-enemy" | "sees-user";

type Effectish = Readonly<{
  tags?: readonly string[];
  modifiers?: ReadonlyArray<Readonly<{ type: string; mode?: string; amount?: number }>>;
  speedZero?: boolean;
}>;

/** Every effect the action can leave: a failure's, a success's, its hits', its grant's. */
function effectsOf(action: ActorAction): Effectish[] {
  const save = action.save;
  return [
    ...(save?.failureEffect ? [save.failureEffect] : []),
    ...(save?.successEffect ? [save.successEffect] : []),
    ...(save?.speedZero ? [{ speedZero: true }] : []),
    ...(action.onHit ?? []),
    ...(action.grants ? [action.grants] : []),
    ...(action.effectOptions ?? []).map((option) => option.effect)
  ];
}

const tagged = (effects: readonly Effectish[], tag: string) => effects.some((effect) => effect.tags?.includes(tag));
const modified = (effects: readonly Effectish[], test: (modifier: { type: string; mode?: string }) => boolean) =>
  effects.some((effect) => effect.modifiers?.some(test));

/** What carries each clause, read from the action's own data. */
const CARRIED: Readonly<Record<ActionClause, (action: ActorAction, effects: readonly Effectish[]) => boolean>> = {
  speed: (_action, effects) =>
    effects.some((effect) => effect.speedZero === true) ||
    tagged(effects, "speed-halved") ||
    modified(effects, (modifier) => modifier.type === "speed"),
  disadvantage: (action, effects) =>
    modified(effects, (modifier) => modifier.type === "roll-mode" && modifier.mode === "disadvantage") ||
    (action.onHit ?? []).some((rider) => rider.tags?.includes("dazed")),
  "no-reactions": (_action, effects) => tagged(effects, "no-reactions"),
  size: (action) =>
    action.save?.failureMaxSize !== undefined ||
    action.save?.failurePush?.maxTargetSize !== undefined ||
    action.targets?.maxSize !== undefined ||
    action.inflicts?.maxTargetSize !== undefined ||
    action.swallow?.maxSize !== undefined ||
    action.onHitPush?.maxTargetSize !== undefined ||
    action.pull?.maxTargetSize !== undefined ||
    (action.onHit ?? []).some(
      (rider) => rider.maxTargetSize !== undefined || rider.pull?.maxTargetSize !== undefined
    ) ||
    (action.conditionalDamage ?? []).some((entry) => entry.maxTargetSize !== undefined),
  "not-type": (action) =>
    action.targets?.notCreatureTypes !== undefined ||
    action.save?.sparesCreatureTypes !== undefined ||
    action.save?.onlyCreatureTypes !== undefined,
  "each-enemy": (action) => action.targets?.who === "enemies",
  "sees-user": (action) => action.sight?.seenBy !== undefined
};

/** Where each clause is printed, in the stock phrasing of SRD 5.2.1 stat blocks. */
const PRINTED: Readonly<Record<ActionClause, RegExp>> = {
  speed: /\bSpeed (?:decreases by \d+ feet|is halved|becomes 0|is 0)\b|\bSpeed of 0\b/,
  disadvantage: /\bDisadvantage on\b/,
  "no-reactions": /\bcan[’']t take (?:a Bonus Action or )?Reactions?\b/,
  size: /\bIf the target is (?:an? )?(?:Tiny|Small|Medium|Large|Huge)(?: creature)? or smaller\b/,
  "not-type": /\bisn[’']t an? [A-Z][a-z]+\b/,
  "each-enemy": /\beach enemy\b/i,
  "sees-user": /\bthat can see (?:the|it)\b/
};

/** The clauses an action prints but carries no data for. Empty when the readers (or a reviewed fix) took them all. */
export function unconsumedClauses(action: ActorAction): ActionClause[] {
  const effects = effectsOf(action);
  return (Object.keys(PRINTED) as ActionClause[]).filter(
    (clause) => PRINTED[clause].test(action.description) && !CARRIED[clause](action, effects)
  );
}
