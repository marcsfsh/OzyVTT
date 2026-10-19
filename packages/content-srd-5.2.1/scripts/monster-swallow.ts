/**
 * A stat block's Swallow as data (`SwallowSchema`), read from its SRD 5.2.1 text: how many it holds ("it can have up to
 * three creatures swallowed at a time"), the size it swallows, the damage from inside that makes it save or regurgitate,
 * a swallow with no save (a giant toad's and a giant frog's) with its conditions and acid, and the actions it can't use
 * meanwhile.
 */
import type { ActorAction, Swallow } from "@vtt/schemas";

type Size = NonNullable<Swallow["maxSize"]>;
type Condition = NonNullable<Swallow["conditions"]>[number];

const COUNTS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const CONDITIONS = ["blinded", "restrained", "grappled"] as const;

/** What the build sets on a swallow action: the swallow, and for one with no save its targets. Null for any other. */
export type SwallowFields = Readonly<{ swallow: Swallow; targets?: ActorAction["targets"]; tags: string[] }>;

export function swallowOf(
  actionName: string,
  description: string,
  idOf: (name: string) => string | undefined
): SwallowFields | null {
  if (!/^Swallow\b/.test(actionName)) return null;
  const capacity =
    /\bcan have (?:only one|up to (\w+)) (?:creatures?|targets?) swallowed at a time\b/.exec(description) ?? null;
  const held = capacity ? (capacity[1] ? (COUNTS[capacity[1].toLowerCase()] ?? 1) : 1) : 1;
  const maxSize = /\bIf the target is (Tiny|Small|Medium|Large|Huge) or smaller, it is swallowed\b/.exec(description);
  const regurgitate =
    /\btakes (\d+) damage or more on a single turn from (?:the swallowed creature|a creature inside it), the [a-z' -]+? must succeed on a DC (\d+) Constitution saving throw at the end of that turn or regurgitate [^.]*?\bfalls? in a space within (\d+) feet\b/.exec(
      description
    );
  const saved = /Saving Throw: DC \d+/.test(description);
  // "The toad swallows a Medium or smaller target it is grappling": no save, the conditions land at once.
  const outright = saved
    ? null
    : /\bswallows an? (Tiny|Small|Medium|Large|Huge) or smaller target it is grappling\b/.exec(description);
  const conditions = outright
    ? CONDITIONS.filter((id) =>
        new RegExp(`\\bhas the [A-Za-z ]*\\b${id[0]!.toUpperCase()}${id.slice(1)}\\b[A-Za-z ]*conditions?\\b`).test(
          description
        )
      )
    : [];
  const acid =
    /\b(?:the swallowed target|the target) takes \d+ \((\d+d\d+(?: [+-] \d+)?)\) ([A-Z][a-z]+) damage at the end of each of the [a-z' -]+?'s turns\b/.exec(
      description
    );
  const lastBite =
    /\bAt the end of the [a-z' -]+?'s next turn, the swallowed target takes \d+ \((\d+d\d+(?: [+-] \d+)?)\) ([A-Z][a-z]+) damage\. If that damage doesn[\u2019']t kill it, the [a-z' -]+? disgorges it\b/.exec(
      description
    );
  const damage = acid ?? lastBite;
  // "It can't use Bite while it has a swallowed target", "While swallowing the target, the frog can't use Bite".
  const blocked = /\bcan[\u2019']t use ([A-Z][A-Za-z' -]*?)(?= while\b|,|\.)/.exec(description);
  const blocks = blocked ? idOf(blocked[1]!) : undefined;
  const swallow: Swallow = {
    capacity: held,
    ...(maxSize ? { maxSize: maxSize[1]!.toLowerCase() as Size } : {}),
    ...(conditions.length > 0 ? { conditions: [...conditions] as Condition[] } : {}),
    ...(damage
      ? {
          ongoingDamage: {
            damage: [{ formula: damage[1]!, type: damage[2]!.toLowerCase() as never }],
            at: "source-turn-end" as const
          }
        }
      : {}),
    ...(lastBite ? { disgorges: true as const } : {}),
    ...(blocks ? { blocks: [blocks] } : {}),
    ...(regurgitate
      ? {
          regurgitate: {
            damage: Number(regurgitate[1]),
            dc: Number(regurgitate[2]),
            withinFeet: Number(regurgitate[3])
          }
        }
      : {})
  };
  return {
    swallow,
    ...(outright
      ? { targets: { count: 1, maxSize: outright[1]!.toLowerCase() as Size, grappledBySource: true as const } }
      : {}),
    // "A swallowed creature has the Blinded and Restrained conditions and can't teleport".
    tags: /\bswallowed creature [^.]*\bcan[\u2019']t teleport\b/.test(description) ? ["no-teleport"] : []
  };
}
