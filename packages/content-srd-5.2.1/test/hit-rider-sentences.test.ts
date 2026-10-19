import { describe, expect, it } from "vitest";
import type { ActorAction } from "@vtt/schemas";
import { loadMonsterDefinitions } from "../src/index.js";

// Every sentence a stat block's hit prints after its damage is either read into data the engine runs, or said to the
// GM in the action's reminder, so an attack never reads as applied whole while its text does more.

type Check = Readonly<{ pattern: RegExp; read: (action: ActorAction) => boolean }>;

const condition = (action: ActorAction, id: string) =>
  (action.onHit ?? []).some((rider) => rider.conditions.some((entry) => entry.id === id)) ||
  (action.conditionalDamage ?? []).some((variant) => variant.conditions?.includes(id));

/** What each kind of rider sentence is read into. */
const READERS: readonly Check[] = [
  { pattern: /\bhas the Grappled condition \(escape DC \d+\)/, read: (action) => condition(action, "grappled") },
  { pattern: /\bgive it the Grappled condition\b/, read: (action) => condition(action, "grappled") },
  {
    pattern: /\bWhile Grappled, the target has the Restrained condition\b/,
    read: (action) => condition(action, "restrained")
  },
  { pattern: /\bcan[\u2019']t be targeted by the [a-z' ]+Tail\b/, read: () => true },
  {
    pattern: /\bmoved \d+\+ feet straight toward it immediately before the hit\b/,
    read: (action) => (action.conditionalDamage ?? []).some((variant) => variant.when === "charge")
  },
  { pattern: /\bit has the Prone condition\b/, read: (action) => condition(action, "prone") },
  {
    pattern: /\bthe target has the ([A-Z][a-z]+) condition until the (?:start|end) of\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.duration !== undefined && rider.conditions.length > 0)
  },
  {
    pattern: /\bcan[\u2019']t regain Hit Points\b/,
    read: (action) =>
      (action.onHit ?? []).some((rider) => rider.tags?.includes("no-healing")) ||
      action.save?.failureEffect?.tags.includes("no-healing") === true
  },
  {
    pattern: /\bpulls the target (?:up to )?\d+ feet straight toward\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.pull)
  },
  {
    pattern: /\bpushes the target (?:up to )?\d+ feet straight away\b/,
    read: (action) => action.onHitPush !== undefined
  },
  {
    pattern: /\bit starts burning\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.hazard === "burning")
  },
  {
    pattern: /\bSpeed decreases by \d+ feet\b/,
    read: (action) =>
      (action.onHit ?? []).some((rider) => (rider.modifiers ?? []).some((modifier) => modifier.type === "speed"))
  },
  {
    pattern: /\bcan[\u2019']t take a Bonus Action or Reaction\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.tags?.includes("no-reactions"))
  },
  {
    pattern: /\battaches to\b|\bWhile (?:the [a-z ]+ is )?attached\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.name === "Attached")
  },
  {
    pattern: /\bcan[\u2019']t teleport\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.tags?.includes("no-teleport"))
  },
  {
    pattern: /\bescape this grapple have Disadvantage\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.tags?.includes("escape-disadvantage"))
  },
  {
    pattern: /\bdies if it is reduced to 0 Hit Points\b|\bdies and turns to dust\b/,
    read: (action) => action.drain?.killsAtZero !== undefined
  },
  { pattern: /\bbody is then absorbed\b/, read: (action) => action.drain?.killsAtZero?.bodyGone === true },
  {
    pattern:
      /\bthe target becomes Stable\b|^While (?:it has the )?Poisoned(?: condition)?, the target (?:also )?has the Paralyzed condition\b/,
    read: (action) => action.drain?.stableAtZero !== undefined
  },
  {
    pattern: /\bscore decreases by \d+d\d+\b|\bThe target dies if this reduces that score to 0\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.lowersScore !== undefined)
  },
  {
    pattern: /\bHit Point maximum decreases by an amount equal to the damage taken\b/,
    read: (action) => action.drain?.reducesMaximum === true
  },
  {
    pattern: /\bit is cursed\b|\bWhile cursed\b|\bis cursed for\b|\bUntil the curse ends\b/,
    read: (action) =>
      (action.onHit ?? []).some((rider) => rider.name === "Cursed" || rider.tags?.includes("no-healing"))
  },
  {
    pattern: /^(?:and )?the target has the [A-Z][a-z]+ condition\.$/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.conditions.length > 0)
  },
  {
    pattern: /\bWhenever the [A-Za-z]+ target finishes a Long Rest\b/,
    read: (action) => (action.onHit ?? []).some((rider) => rider.atRest?.at === "long-rest")
  },
  {
    pattern:
      /\bIf the target is an? (?:creature|non-Undead creature|Humanoid|creature that isn[\u2019']t an Undead or elf)(?: and doesn[\u2019']t already have an infernal wound)?, it (?:is subjected to|must make) the following|\bthe target is subjected to the following effect\b/,
    read: (action) => action.save !== undefined || (action.onHit ?? []).some((rider) => rider.save)
  },
  {
    pattern:
      /^(?:Constitution|Strength|Dexterity|Wisdom|Intelligence|Charisma) Saving Throw: DC \d+\.$|^(?:First |Second |Subsequent )?Failures?:?\b|^Success:|^After 1 minute, it succeeds automatically\.$|^The target repeats the save\b|^While (?:Poisoned|wounded)\b|^The wound closes\b|^If the cursed target drops to 0 Hit Points\b/,
    read: (action) =>
      action.save !== undefined || (action.onHit ?? []).some((rider) => rider.save || rider.atRest?.save)
  }
];

/** What a hit prints that changes nothing in play. */
const NARRATIVE = [
  /^Hit or Miss: The (?:spear|sword) magically returns\b/,
  /^Being underwater doesn[\u2019']t grant Resistance to this Fire damage\.$/,
  // A Shadow rising hours later is the story's.
  /^If a Humanoid is slain by this attack, a Shadow rises from the corpse 1d4 hours later\.$/,
  /\bfrom (?:one of (?:two|four|ten) (?:tentacles|claws|pincers|chains|hands)|both (?:claws|talons|of the griffon[\u2019']s front claws)|all (?:four|eight) tentacles)\.$/
];

/** The sentences a hit prints after its damage: the rest of the damage sentence, then each one after it. */
function riderSentences(description: string): string[] {
  const body = description.replace(/^Legendary Action[^.]*\.\s*/, "");
  const at = body.search(/\b\d+ \(\d+d\d+(?: [+-] \d+)?\) [A-Z][a-z]+ damage\b|\b\d+ [A-Z][a-z]+ damage\b/);
  if (at === -1) return [];
  const rest = body.slice(at);
  const end = rest.indexOf(". ");
  if (end === -1) return [];
  const tail = rest
    .slice(0, end + 1)
    .replace(/^.*?damage(?: (?:plus|and) [^,.]*? damage)*,?\s*/, "")
    // "or 11 (2d8 + 2) Necrotic damage if the swarm is Bloodied": damage under a condition, read with the hit's.
    .replace(/^or \d+ \(\d+d\d+(?: [+-] \d+)?\) [A-Z][a-z]+ damage if [^.]*\.$/, "");
  return [tail, ...rest.slice(end + 2).split(/(?<=\.)\s+/)]
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
}

describe("a stat block hit's printed riders", () => {
  it("are each read into data or named in the action's reminder", () => {
    const unread: string[] = [];
    for (const monster of loadMonsterDefinitions())
      for (const action of monster.actions) {
        if (!action.attack || action.spellId !== undefined || action.reminder) continue;
        for (const sentence of riderSentences(action.description)) {
          if (NARRATIVE.some((pattern) => pattern.test(sentence))) continue;
          // A rider's own reminder says what the engine leaves of it (a shadow's Strength drain).
          const said = sentence.replace(/^and /, "").toLowerCase();
          const reminded = (action.onHit ?? []).some((rider) => rider.reminder?.toLowerCase().includes(said));
          if (reminded || READERS.some((check) => check.pattern.test(sentence) && check.read(action))) continue;
          unread.push(`${monster.name}: ${action.name}: ${sentence}`);
        }
      }
    expect(unread).toEqual([]);
  });
});
