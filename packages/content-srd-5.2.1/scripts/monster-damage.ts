/**
 * A monster action's damage, read from its printed stat-block text, which is the authority: open5e's attack rows
 * drop the "plus 7 (2d6) Poison damage" of almost a hundred attacks and get a few dice wrong. The hit clause gives
 * what every hit deals and what it deals only under a stated condition; a save's "Failure:" clause gives what the
 * failure deals at once, leaving damage that recurs on later turns to the GM, named in `laterDamage`.
 * `test/monster-damage.test.ts` checks every bundled monster against its own text.
 */
import type { ActorAction } from "@vtt/schemas";

type Part = { formula: string; type: string };
type ConditionalDamage = NonNullable<ActorAction["conditionalDamage"]>[number];

const DAMAGE_TYPES: ReadonlySet<string> = new Set([
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder"
]);

/** "1d8 + 3" from "1d8+3" or "1d4 − 1" (the source prints a minus sign at times). */
const formulaOf = (dice: string) => dice.replace(/−/g, "-").replace(/\s*([+-])\s*/, " $1 ");

/** One printed damage term: "7 (1d8 + 3) Piercing damage", or a fixed "1 Piercing damage". */
const TERM = /(\d+)(?:\s*\((\d+d\d+(?:\s*[+\-−]\s*\d+)?)\))?\s+([A-Z][a-z]+) damage/;

/** The attack's hit clause: its first sentence after "Melee Attack Roll: +5, reach 5 ft." and the rest. */
function hitClauseOf(description: string): { first: string; rest: string } | null {
  const body = description.replace(
    /^.*?Attack Roll:[^.]*?(?:ft|feet)\.(?:\s*or range [^.]*?(?:ft|feet)\.)?\s*(?:Hit:\s*)?/s,
    ""
  );
  if (body === description) return null;
  const [first, ...rest] = body.split(/(?<=\.)\s+/);
  return { first: first ?? "", rest: rest.join(" ") };
}

/** What a condition on extra damage reads as, or null when the engine can't tell it. */
function conditionOf(text: string): Pick<ConditionalDamage, "when" | "feet"> | null {
  const charge = /moved (\d+)\+ feet straight toward/.exec(text);
  if (charge) return { when: "charge", feet: Number(charge[1]) };
  if (/\bAdvantage\b/.test(text)) return { when: "advantage" };
  if (/\bthe target is Bloodied\b/.test(text)) return { when: "target-bloodied" };
  if (/\bis Bloodied\b/.test(text)) return { when: "self-bloodied" };
  if (/\bthe target is Grappled by\b/.test(text)) return { when: "target-grappled-by-self" };
  return null;
}

/**
 * The damage an attack's hit deals as printed, and what it deals under a condition: "plus 2 (1d4) Slashing damage
 * if the attack roll had Advantage" adds, "or 2 (1d4) Piercing damage if the swarm is Bloodied" replaces the first
 * part, and a charge ("If the target is a Large or smaller creature and the boar moved 20+ feet straight toward it
 * immediately before the hit, the target takes an extra 3 (1d6) Piercing damage and has the Prone condition")
 * adds. Null when the text prints no damage the engine can type.
 */
export function printedHitDamage(
  description: string
): { damage: Part[]; conditionalDamage: ConditionalDamage[] } | null {
  const clause = hitClauseOf(description);
  if (!clause) return null;
  const damage: Part[] = [];
  const conditionalDamage: ConditionalDamage[] = [];
  const terms = new RegExp(`(?:^|,?\\s*\\b(plus|or)\\s+)${TERM.source}(?:\\s+(?:if|when)\\s+([^,.;—]+))?`, "g");
  for (const match of clause.first.matchAll(terms)) {
    const [, connector, flat, dice, typeName, condition] = match;
    const type = typeName.toLowerCase();
    if (!DAMAGE_TYPES.has(type)) continue;
    const part = { formula: dice ? formulaOf(dice) : flat, type };
    if (condition === undefined) {
      // An "or" with no condition is a choice the GM makes ("Piercing or Slashing"); the first stands.
      if (connector !== "or") damage.push(part);
      continue;
    }
    const when = conditionOf(condition);
    if (when) conditionalDamage.push({ ...when, mode: connector === "or" ? "instead" : "plus", damage: [part] });
  }
  if (damage.length === 0) return null;
  const charge =
    /If (?:the )?target is (?:a )?(Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller(?: creature)? and the [^,]*? moved (\d+)\+ feet straight toward it immediately before the hit, the target takes an extra \d+ \((\d+d\d+(?:\s*[+-]\s*\d+)?)\) ([A-Z][a-z]+) damage( and has the Prone condition)?/.exec(
      clause.rest
    );
  if (charge && DAMAGE_TYPES.has(charge[4].toLowerCase()))
    conditionalDamage.push({
      when: "charge",
      mode: "plus",
      feet: Number(charge[2]),
      maxTargetSize: charge[1].toLowerCase() as NonNullable<ConditionalDamage["maxTargetSize"]>,
      damage: [{ formula: formulaOf(charge[3]), type: charge[4].toLowerCase() }],
      ...(charge[5] ? { conditions: ["prone"] } : {})
    });
  return { damage, conditionalDamage };
}

/**
 * The damage a failed save deals at once, from the first sentence of its "Failure:" clause; damage the clause
 * deals later ("takes 10 (3d6) Acid damage at the start of each of the cube's turns", "While Poisoned, the target
 * takes...") is not dealt by the action, so it is returned as `laterDamage` for the GM to apply. A failure that
 * depends on the target's hit points ("If the target has 20 Hit Points or fewer...") deals nothing on its own.
 */
export function printedSaveDamage(description: string): { damage: Part[]; laterDamage: string | null } {
  const failure = /Failure:\s*(.+?)(?:\s*Success:|$)/s.exec(description);
  if (!failure) return { damage: termsIn(description), laterDamage: null };
  const segment = failure[1];
  const [first, ...rest] = segment.split(/(?<=\.)\s+/);
  const later = rest.filter((sentence) => TERM.test(sentence)).join(" ");
  if (/^If the target has \d+ Hit Points or fewer/.test(first ?? ""))
    return { damage: [], laterDamage: withoutSourceTags(segment) };
  return { damage: termsIn(first ?? ""), laterDamage: later.length > 0 ? withoutSourceTags(later) : null };
}

/** The upstream's 5etools link tags ("Cover|XPHB|Total Cover"), which read as noise to the table. */
const withoutSourceTags = (text: string) => text.replace(/(?:\[[^\]]*\]|\w+)\|XPHB\|/g, "");

/** Every rolled, typed damage term in a passage. */
function termsIn(text: string): Part[] {
  const damage: Part[] = [];
  for (const match of text.matchAll(new RegExp(TERM.source, "g"))) {
    const type = match[3].toLowerCase();
    if (match[2] && DAMAGE_TYPES.has(type)) damage.push({ formula: formulaOf(match[2]), type });
  }
  return damage;
}
