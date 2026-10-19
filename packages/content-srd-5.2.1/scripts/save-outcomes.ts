/**
 * What a save does, read from the SRD text once at build time so the engine never reads prose: the damage
 * a success takes, the conditions a failure imposes and how they end (a duration, a save repeated at the end of
 * each turn, the grapple's escape DC, taking damage). Each reader covers one printing style, the override
 * table holds the reviewed cases a reader gets wrong, and `test/save-outcomes.test.ts` pins known ones.
 */
import {
  DamageTypeSchema,
  SaveConditionSchema,
  type DamageType,
  type ForcedPush,
  type ObjectPrint,
  type OngoingDamage,
  type SaveCondition,
  type SaveFailureDuration
} from "@vtt/schemas";

export type SaveOutcome = {
  successDamage: "half" | "none";
  failureConditions: SaveCondition[];
  conditionChoices?: SaveCondition[];
  failureDuration?: SaveFailureDuration;
  repeatSave?: true;
  escapeDc?: number;
  endsOnDamage?: true;
  endsOnSourceSideDamage?: true;
  speedZero?: true;
  rangeFeet?: number;
  failsAtHitPoints?: number;
  ongoingDamage?: OngoingDamage;
  ignoresCover?: true;
  failurePush?: ForcedPush;
  advantageAtSize?: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
  failureEndsForm?: true;
  breaksConcentration?: true;
  heldBy?: ObjectPrint;
};

/** The damage types a stat block lists after "Vulnerability to" or "Immunity to" ("Bludgeoning, Poison, and Psychic"),
 *  less Poison and Psychic, which every object ignores anyway. */
function objectDefences(clause: string, label: string): DamageType[] {
  const listed = new RegExp(`${label} to ([A-Za-z, ]+?) damage`).exec(clause)?.[1] ?? "";
  return listed
    .split(/,\s*(?:and\s+)?|\s+and\s+/)
    .map((word) => DamageTypeSchema.safeParse(word.trim().toLowerCase()))
    .flatMap((parsed) =>
      parsed.success && parsed.data !== "poison" && parsed.data !== "psychic" ? [parsed.data] : []
    );
}

/** What holds the creature a failure restrains when a trait prints its statistics: "until the rope is destroyed", with
 *  the erinyes' Magic Rope: "The rope has AC 20, HP 90, and Immunity to Poison and Psychic damage." */
export function heldByFromTraits(clause: string, traits: readonly string[]): ObjectPrint | undefined {
  const named = /until the (\w+) is destroyed\b/.exec(clause)?.[1];
  if (!named) return undefined;
  for (const text of traits) {
    const printed = new RegExp(`The ${named} has AC (\\d+), HP (\\d+)`).exec(text);
    if (!printed) continue;
    const immunities = objectDefences(text, "Immunity");
    return {
      name: `${named[0]!.toUpperCase()}${named.slice(1)}`,
      armorClass: Number.parseInt(printed[1]!, 10),
      hitPoints: Number.parseInt(printed[2]!, 10),
      ...(immunities.length > 0 ? { immunities } : {})
    };
  }
  return undefined;
}

/** What holds the creature a failure restrains, when the clause prints its statistics: "Restrained condition until the
 *  web is destroyed (AC 10; HP 5; Vulnerability to Fire damage; Immunity to Poison and Psychic damage)". */
export function heldByOf(clause: string): ObjectPrint | undefined {
  const printed = /until the (\w+) is destroyed \(AC (\d+); HP (\d+)((?:; [^)]*)?)\)/.exec(clause);
  if (!printed) return undefined;
  const name = printed[1]!;
  const rest = printed[4] ?? "";
  const immunities = objectDefences(rest, "Immunity");
  const vulnerabilities = objectDefences(rest, "Vulnerability");
  const resistances = objectDefences(rest, "Resistance");
  return {
    name: `${name[0]!.toUpperCase()}${name.slice(1)}`,
    armorClass: Number.parseInt(printed[2]!, 10),
    hitPoints: Number.parseInt(printed[3]!, 10),
    ...(immunities.length > 0 ? { immunities } : {}),
    ...(resistances.length > 0 ? { resistances } : {}),
    ...(vulnerabilities.length > 0 ? { vulnerabilities } : {})
  };
}

/** The push a failure clause prints: "is pushed 10 feet away from you", "pushed up to 30 feet straight away from the
 *  dragon". */
export function failurePushOf(clause: string): ForcedPush | undefined {
  const push = /\bpushed (up to )?(\d+) feet (?:straight )?away from\b/.exec(clause);
  return push ? { feet: Number.parseInt(push[2]!, 10), ...(push[1] ? { upTo: true as const } : {}) } : undefined;
}

const CONDITIONS: ReadonlySet<string> = new Set(SaveConditionSchema.options);

const conditionIdsOf = (names: string): SaveCondition[] =>
  names
    .split(/,? (?:and )?/)
    .map((name) => name.toLowerCase())
    .filter((id): id is SaveCondition => CONDITIONS.has(id));

type NamedConditions = Readonly<{ conditions: SaveCondition[]; choices?: SaveCondition[] }>;

/**
 * The conditions the first "has the X condition" or "has the X and Y conditions" names. Only the first
 * phrase: later ones are usually conditional ("Failure by 5 or More") or describe what the first condition
 * already does; the "while X, also Y" and "until the grapple ends" sentences are read separately. "X or Y" is the
 * caster's choice of one ("the Blinded or Deafened condition"): the first stands until one is picked.
 */
function namedConditions(clause: string): NamedConditions {
  const match = clause.match(
    /\b(?:has|have|gains?|having) the ([A-Z][a-z]+(?:,? (?:and |or )?[A-Z][a-z]+)*) conditions?\b/
  );
  if (!match) return { conditions: [] };
  if (!/\bor\b/.test(match[1])) return { conditions: [...new Set(conditionIdsOf(match[1]))] };
  const choices = [...new Set(conditionIdsOf(match[1].replace(/,? or /g, ", ")))];
  return choices.length > 1 ? { conditions: choices.slice(0, 1), choices } : { conditions: choices };
}

/** "While Charmed, the creature has the Incapacitated condition" and "it has the Restrained condition until the
 *  grapple ends": conditions that last exactly as long as the first, so they ride the same effect. */
function companionConditions(clause: string, first: readonly SaveCondition[]): SaveCondition[] {
  const found: SaveCondition[] = [];
  for (const match of clause.matchAll(
    /\bWhile ([A-Z][a-z]+)(?: (?:in this way|this way))?, the (?:target|creature) (?:also )?has the ([A-Z][a-z]+(?: and [A-Z][a-z]+)?) conditions?/g
  )) {
    if (first.includes(match[1].toLowerCase() as SaveCondition)) found.push(...conditionIdsOf(match[2]));
  }
  if (first.includes("grappled")) {
    for (const match of clause.matchAll(
      /\b(?:it|the target) has the ([A-Z][a-z]+(?: and [A-Z][a-z]+)?) conditions? until the grapple ends|\bUntil the grapple ends, the target has the ([A-Z][a-z]+(?: and [A-Z][a-z]+)?) conditions?/g
    ))
      found.push(...conditionIdsOf(match[1] ?? match[2]!));
  }
  return found;
}

const MINUTES_PER: Readonly<Record<string, number>> = { minute: 1, hour: 60, day: 1440 };

/**
 * How long the failure's conditions last, from the first duration phrase after them: "until the end of its next
 * turn" is the target's turn, "until the end of the ghoul's / your next turn" the source's, "until the start of ...
 * next turn" the source's start, "for 1 minute" ten rounds (as does "After 1 minute, it succeeds automatically"), a
 * longer span ("for 1 hour", "for 24 hours") minutes of game time, and "until you finish a Long Rest" the bearer's next
 * one. "For the duration" is left to the spell's own ending (its duration, its Concentration).
 */
export function failureDurationOf(clause: string): SaveFailureDuration | undefined {
  // "The target is immune to this ghost's Possession for 24 hours" is how long an immunity lasts, not the failure.
  const lifetime = clause
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\bimmune\b/i.test(sentence))
    .join(" ");
  const timed = lifetime.match(
    /\buntil the (start|end) of (its|your|the [A-Za-z' -]+?(?:'s|s')) next turn\b|\bfor (\d+) (minute|hour|day)s?\b|\bAfter (\d+) (minute|hour|day)s?, it succeeds automatically\b|\buntil (?:you|it|the target) finish(?:es)? a (Short or Long|Long) Rest\b/
  );
  if (!timed) return undefined;
  if (timed[7]) return { type: "until-rest", rest: timed[7] === "Long" ? "long" : "short" };
  const count = timed[3] ?? timed[5];
  if (count) {
    const minutes = Number.parseInt(count, 10) * MINUTES_PER[(timed[4] ?? timed[6])!]!;
    return minutes <= 10 ? { type: "rounds", rounds: minutes * 10 } : { type: "minutes", minutes };
  }
  if (timed[1] === "start") return { type: "until-source-next-turn" };
  return timed[2] === "its" ? { type: "until-bearer-turn-end" } : { type: "until-source-turn-end" };
}

/** "Until you or your allies damage it", "If you or one of your allies deals damage to the target": the failure ends
 *  when the source's side deals damage to the creature. */
const ENDS_ON_SOURCE_SIDE_DAMAGE =
  /\buntil you or your allies (?:damage|deal damage to) (?:it|the target)\b|\bIf you or one of your allies deals damage to the target\b/;

/** "Repeats the save at the end of each of its turns" in its printings, which ends on a success. A save repeated a
 *  set number of times (Flesh to Stone's three) or once (a basilisk's next turn) is left to the GM. */
function repeatsEachTurn(clause: string): boolean {
  if (/\bthree (?:times|successes|of these)\b/i.test(clause)) return false;
  return /\b(?:repeats? the save|makes? (?:another|a) [A-Z][a-z]+ saving throw) at the end of each of its turns\b|\bAt the end of each of its turns(?: and [^,.]+)?,? (?:the target |it )?(?:repeats the save|makes another [A-Z][a-z]+ saving throw)/i.test(
    clause
  );
}

const ENDS_ON_DAMAGE =
  /\bif it takes (?:any )?damage\b|\buntil it takes damage\b|\bends early if the target takes (?:any )?damage\b|\bends for the target if it takes damage\b|\bIf it takes any damage\b/;

const DICE = String.raw`\d+ \((\d+d\d+(?: [+-] \d+)?)\) ([A-Z][a-z]+) damage`;
/** "takes 21 (6d6) Acid damage at the start of each of the behir's turns", one or two typed terms. */
const ONGOING_DAMAGE = new RegExp(
  String.raw`\btakes ${DICE}(?: plus ${DICE})? at the start of each of (its|the [A-Za-z' -]+?(?:'s|s')) turns\b`
);

/**
 * Damage the failure's conditions bring at the start of each turn while they last: on the target's turns ("each of
 * its turns") or the source's ("each of the behir's turns"). Damage at the end of a turn, or on a hit-point
 * threshold, is left to the GM.
 */
function ongoingDamageOf(clause: string): OngoingDamage | undefined {
  const match = clause.match(ONGOING_DAMAGE);
  if (!match) return undefined;
  const damage = [
    [match[1], match[2]],
    [match[3], match[4]]
  ].flatMap(([formula, type]) => {
    const parsed = DamageTypeSchema.safeParse(type?.toLowerCase());
    return formula && parsed.success ? [{ formula, type: parsed.data }] : [];
  });
  if (damage.length === 0) return undefined;
  return { damage, at: match[5] === "its" ? "bearer-turn-start" : "source-turn-start" };
}

/**
 * Hit points a failed save's lasting harm takes each turn, and what ends it: "The target receives an infernal wound.
 * While wounded, the target loses 5 (1d10) Hit Points at the start of each of its turns. The wound closes after 1
 * minute, after a spell restores Hit Points to the target, or after the target or a creature within 5 feet of it takes
 * an action to stanch the wound, doing so by succeeding on a DC 12 Wisdom (Medicine) check." The loss is no damage,
 * so it has no type; the stanching check is the GM's, said in `reminder`. Null when the text prints no such loss.
 */
export function hitPointLossOf(description: string): Readonly<{
  failureEffect: {
    name: string;
    tags: string[];
    duration?: { type: "rounds"; rounds: number };
    endsOnSpellHealing?: true;
    modifiers: [];
  };
  ongoingDamage: OngoingDamage;
  reminder: string | null;
}> | null {
  const loss = /\bloses \d+ \((\d+d\d+(?: [+-] \d+)?)\) Hit Points at the start of each of its turns\b/.exec(
    description
  );
  if (!loss) return null;
  const named = /\breceives an? ([a-z]+) wound\b/.exec(description);
  const name = named ? `${named[1]![0]!.toUpperCase()}${named[1]!.slice(1)} Wound` : "Wounded";
  const stanch =
    /\btakes an action to stanch the wound, doing so by succeeding on a DC (\d+) Wisdom \(Medicine\) check\b/.exec(
      description
    );
  return {
    failureEffect: {
      name,
      tags: [],
      ...(/\bcloses after 1 minute\b/.test(description) ? { duration: { type: "rounds" as const, rounds: 10 } } : {}),
      ...(/\bafter a spell restores Hit Points to the target\b/.test(description)
        ? { endsOnSpellHealing: true as const }
        : {}),
      modifiers: []
    },
    ongoingDamage: { damage: [{ formula: loss[1]! }], at: "bearer-turn-start", hitPointLoss: true },
    reminder: stanch
      ? `The ${name.toLowerCase()} also closes when the bearer or a creature within 5 feet takes an action and succeeds on a DC ${stanch[1]} Wisdom (Medicine) check: end it by hand.`
      : null
  };
}

/** The reminder text without the ongoing damage the engine now deals: the clause is cut from its sentence, and a
 *  sentence that was only that damage goes. Null when nothing is left to remind. */
export function withoutOngoingDamage(text: string): string | null {
  const clause = new RegExp(String.raw`,? and (?:it )?${ONGOING_DAMAGE.source.replace(/^\\b/, "")}`);
  const kept = text.split(/(?<=\.)\s+/).flatMap((sentence) => {
    if (!ONGOING_DAMAGE.test(sentence)) return [sentence];
    const cut = sentence.replace(clause, "");
    return cut === sentence ? [] : [cut];
  });
  return kept.length > 0 ? kept.join(" ") : null;
}

/** Everything a failure clause says about its conditions' lifetime. */
function failureLifetime(clause: string, named: NamedConditions): Omit<SaveOutcome, "successDamage"> {
  const first = named.conditions;
  const failureConditions = [...new Set([...first, ...companionConditions(clause, first)])].slice(0, 4);
  const push = failurePushOf(clause);
  if (failureConditions.length === 0) return { failureConditions, ...(push ? { failurePush: push } : {}) };
  const escape = first.includes("grappled") ? clause.match(/\(escape DC (\d+)\)/) : null;
  const duration = failureDurationOf(clause);
  const ongoing = ongoingDamageOf(clause);
  return {
    failureConditions,
    ...(named.choices ? { conditionChoices: named.choices } : {}),
    ...(duration ? { failureDuration: duration } : {}),
    ...(repeatsEachTurn(clause) ? { repeatSave: true as const } : {}),
    ...(escape ? { escapeDc: Number.parseInt(escape[1]!, 10) } : {}),
    ...(ENDS_ON_DAMAGE.test(clause) ? { endsOnDamage: true as const } : {}),
    ...(ENDS_ON_SOURCE_SIDE_DAMAGE.test(clause) ? { endsOnSourceSideDamage: true as const } : {}),
    ...(/\ba Speed of 0\b/.test(clause) ? { speedZero: true as const } : {}),
    ...(ongoing ? { ongoingDamage: ongoing } : {}),
    ...(push ? { failurePush: push } : {})
  };
}

/**
 * A 2024 stat-block save: "Failure: ... Success: Half damage." The failure clause runs from "Failure:" (or
 * "First Failure") to the next label; a success that is not printed does nothing, so only an explicit
 * "Success: Half damage" halves. "Failure or Success:" lines apply either way and are not the success line, and
 * "Failure by 5 or More" is a further branch, apart from the plain failure. The save's reach ("within 10 feet")
 * is a grapple's range.
 */
export function statBlockSaveOutcome(description: string): SaveOutcome {
  const start = description.search(/\b(?:First Failure|Failure:)/);
  const tail = start === -1 ? "" : description.slice(start);
  const end = tail.search(
    /\b(?:Failure or Success:|Success:|Second Failure|Subsequent Failures:|Failure by \d+ or More)|\s-\s(?:Second|Third) /
  );
  const failure = end === -1 ? tail : tail.slice(0, end);
  const success = /(?<!or )\bSuccess:\s*Half damage\b/.test(description);
  const lifetime = failureLifetime(failure, namedConditions(failure));
  const reach =
    lifetime.escapeDc !== undefined ? description.slice(0, Math.max(0, start)).match(/\bwithin (\d+) feet\b/) : null;
  const heldBy = lifetime.failureConditions.includes("restrained") ? heldByOf(failure) : undefined;
  return {
    successDamage: success ? "half" : "none",
    ...lifetime,
    ...(reach ? { rangeFeet: Number.parseInt(reach[1]!, 10) } : {}),
    ...(heldBy ? { heldBy } : {})
  };
}

/**
 * A spell's save, from its running prose: half when the text halves the damage of a successful save ("or
 * half as much damage on a successful one"), the condition the failure sentence names ("must succeed on
 * a Wisdom saving throw or have the Charmed condition", "On a failed save, ... has the Restrained condition"), and
 * how the spell says it ends. "For the duration" conditions end with the spell (its Concentration).
 */
function spellSaveOutcome(description: string): SaveOutcome {
  const half =
    /half as much(?: damage)?(?: only)?(?: on a success|,? on a successful| if it succeeds)|successful save[^.]*\bhalf\b/i.test(
      description
    );
  const sentences = description.split(/(?<=[.!?])\s+/);
  const failureIndex = sentences.findIndex((sentence) =>
    /saving throw,? or\b|failed save|fails (?:the|its|a|this) save|on a failure/i.test(sentence)
  );
  const failureSentences = sentences
    .filter((sentence) => /saving throw,? or\b|failed save|fails (?:the|its|a|this) save|on a failure/i.test(sentence))
    .join(" ");
  const named = namedConditions(failureSentences);
  // The failure sentence and the ones after it, where spells say what else the condition does and how it ends.
  const after = failureIndex === -1 ? "" : sentences.slice(failureIndex).join(" ");
  const duration = failureDurationOf(failureSentences);
  const lifetime = failureLifetime(after, named);
  const { failureDuration: _later, ...rest } = lifetime;
  return {
    successDamage: half ? "half" : "none",
    ...rest,
    ...(duration && named.conditions.length > 0 ? { failureDuration: duration } : {})
  };
}

/** Reviewed corrections, keyed by spell id; each says why the reader is wrong there. */
const SPELL_SAVE_OVERRIDES: Readonly<Record<string, Partial<SaveOutcome>>> = {
  // "or be transported to a harmless demiplane": the Incapacitated condition is named in the next sentence.
  banishment: { failureConditions: ["incapacitated"] },
  // The ray is rolled per target (Restrained is only the indigo ray), so no single condition applies.
  "prismatic-spray": { failureConditions: [] },
  // The first save's Thunder damage is all or nothing; the halving is the turn-3 lightning's.
  "storm-of-vengeance": { successDamage: "none" },
  // No save at the cast: 150 HP or fewer is Stunned outright, then a Constitution save at the end of each of its
  // turns ends it. (A tougher target's Speed 0 until your next turn is left to the GM.)
  "power-word-stun": { failureConditions: ["stunned"], repeatSave: true, failsAtHitPoints: 150 },
  // Three successes or three failures: the GM keeps count.
  "flesh-to-stone": { repeatSave: undefined },
  contagion: { repeatSave: undefined },
  // "The target gains no benefit from Half Cover or Three-Quarters Cover for this save."
  "sacred-flame": { ignoresCover: true },
  // "An affected target repeats the save at the end of each of its turns, ending the spell on itself on a success."
  // The spell names no condition, so the reader leaves the repeat out.
  slow: { repeatSave: true },
  // "The target repeats the save at the end of each of its turns, ending the spell on a success." No condition names
  // it for the reader.
  "ray-of-enfeeblement": { repeatSave: true },
  // "Another 5d4 Acid damage at the end of its next turn", with no condition for the reader to hang it on.
  "vitriolic-sphere": {
    ongoingDamage: { damage: [{ formula: "5d4", type: "acid" }], at: "bearer-turn-end" }
  },
  // "On a failed save, a creature has the Prone condition, and its Concentration is broken"; the tremor deals no damage.
  earthquake: { successDamage: "none", breaksConcentration: true },
  // "Have the Prone condition and lose Concentration".
  "sleet-storm": { breaksConcentration: true },
  // "Make a DC 15 Intelligence saving throw" yourself: "you take 6d6 Psychic damage and have the Incapacitated condition
  // until you finish a Long Rest" (`spell-effects.ts` makes it the caster's own save).
  "contact-other-plane": { failureDuration: { type: "until-rest", rest: "long" } },
  // "For the duration, the target makes a Wisdom saving throw at the end of each of its turns ... On a successful save,
  // the spell ends." The failure leaves no condition for the reader to hang it on.
  "phantasmal-killer": { repeatSave: true },
  // "While Restrained, the target takes 1d6 Piercing damage at the start of each of its turns", and "A Large or larger
  // creature has Advantage on this save".
  "ensnaring-strike": {
    ongoingDamage: { damage: [{ formula: "1d6", type: "piercing" }], at: "bearer-turn-start" },
    advantageAtSize: "large"
  },
  // "If the creature is shape-shifted (as a result of the Polymorph spell, for example), it reverts to its true form and
  // can't shape-shift until it leaves the Cylinder."
  moonbeam: { failureEndsForm: true }
};

/** `spellSaveOutcome` with the reviewed corrections applied. Unset fields an override names are dropped. */
export function spellSaveOutcomeFor(spellId: string, description: string): SaveOutcome {
  const merged: SaveOutcome = { ...spellSaveOutcome(description), ...SPELL_SAVE_OVERRIDES[spellId] };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined)) as SaveOutcome;
}

/** Every override must still name a spell, so a renamed id fails the build out loud. */
export const SPELL_SAVE_OVERRIDE_IDS: readonly string[] = Object.keys(SPELL_SAVE_OVERRIDES);
