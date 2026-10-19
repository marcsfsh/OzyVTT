/**
 * What an action's prose says that play needs as data. Read where an action enters the system (the content
 * build, a homebrew save, an import), so the engine never reads prose while a fight runs.
 */
import type {
  ActionArea,
  ActionMove,
  ActionReaction,
  ActionTeleport,
  ActorAction,
  DamageDrain,
  ForcedPush
} from "@vtt/schemas";

/**
 * The area of effect a description names. SRD 2024 phrasing is consistent enough to pattern-match ("60-foot
 * Cone", "60-foot-long, 5-foot-wide Line", "20-foot-radius Sphere", "15-foot Emanation", "10-foot Cube").
 * Null when it names none, and the GM targets tokens directly. A line that omits its width is 5 feet wide, and one
 * printed after its name gives its length and width in words ("a Line of strong wind 60 feet long and 10 feet wide").
 * A Cylinder keeps its radius ("5-foot-radius, 40-foot-high Cylinder"), drawn on a flat map as that circle, and an
 * "N-foot square" on the ground is a Cube of that side.
 */
export function areaOfProse(description: string): ActionArea | null {
  const line = /(\d+)-foot(?:-long)?(?:,?\s*(\d+)-foot-wide)?\s+Line/i.exec(description);
  if (line) return { shape: "line", sizeFeet: Number(line[1]), widthFeet: line[2] ? Number(line[2]) : 5 };
  const namedLine = /\bLine\b[^.]*?\b(\d+) feet long and (\d+) feet wide/i.exec(description);
  if (namedLine) return { shape: "line", sizeFeet: Number(namedLine[1]), widthFeet: Number(namedLine[2]) };
  const cone = /(\d+)-foot\s+Cone/i.exec(description);
  if (cone) return { shape: "cone", sizeFeet: Number(cone[1]), widthFeet: null };
  const radial = /(\d+)-foot(?:-radius)?\s+(Sphere|Emanation)/i.exec(description);
  if (radial)
    return {
      shape: radial[2].toLowerCase() === "emanation" ? "emanation" : "sphere",
      sizeFeet: Number(radial[1]),
      widthFeet: null
    };
  const cylinder =
    /(\d+)-foot-radius,?\s+(?:\d+[- ]foot[- ](?:high|tall)\s+)?Cylinder/i.exec(description) ??
    /\d+[- ]foot[- ](?:high|tall),\s+(\d+)-foot-radius\s+Cylinder/i.exec(description);
  if (cylinder) return { shape: "cylinder", sizeFeet: Number(cylinder[1]), widthFeet: null };
  const cube = /(\d+)-foot\s+Cube/i.exec(description) ?? /(\d+)-foot[- ]square\b/i.exec(description);
  if (cube) return { shape: "cube", sizeFeet: Number(cube[1]), widthFeet: null };
  return null;
}

/**
 * The AC a Parry-style reaction adds ("adds 2 to its AC against that attack"), melee only when the text names a
 * melee attack. Null for any other reaction, which stays prose.
 */
export function acReactionOfProse(description: string): ActionReaction | null {
  const match = /\badds (\d+) to its AC against (?:one|that|the) (?:melee )?attack/i.exec(description);
  const amount = match ? Number(match[1]) : 0;
  if (amount < 1 || amount > 10) return null;
  return {
    trigger: "hit-by-attack",
    response: "ac-bonus",
    amount,
    ...(/\bmelee attack\b/i.test(description) ? { melee: true } : {})
  };
}

/** One place in a Multiattack: an action, how many times, and the others that can fill it instead ("using Scimitar or
 *  Shortbow in any combination", "uses Charm or Draining Kiss"). */
export type MultiattackComponent = { actionId: string; count: number; or?: string[] };
/** "It can replace one attack with a use of Roar": what can take the place of attacks, how many each use replaces,
 *  whether every attack may be replaced (`any`), and the one attack it replaces when the text names it (`of`). */
export type MultiattackReplacement = { actionIds: string[]; attacks: number; any?: true; of?: string };
/** A Multiattack as data: its plan, the plans it can be instead ("or it makes two Hurl Flame attacks"), and its
 *  replacements. */
export type MultiattackOfProse = {
  plan: MultiattackComponent[];
  alternatives: MultiattackComponent[][];
  replacements: MultiattackReplacement[];
};

const COUNT_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const NAME = "[A-Z][A-Za-z'\u2019-]*(?: [A-Z][A-Za-z'\u2019-]*)*";
const NAMES = `${NAME}(?:(?:,\\s*(?:or\\s+|and\\s+)?|\\s+or\\s+|\\s+and\\s+)${NAME})*`;
const COUNT = "one|two|three|four|five|six|[1-6]";
/** The clauses of a plan, tried in order at each position: an any-combination pool, "two X or Y attacks", "two X
 *  attacks", and "uses X" (with "either", "twice", "to cast ..." and "if available"). */
const CLAUSES: ReadonlyArray<Readonly<{ pattern: RegExp; kind: "pool" | "either" | "attack" | "use" }>> = [
  {
    kind: "pool",
    pattern: new RegExp(
      `(?:makes\\s+)?(${COUNT})\\s+(?:other\\s+)?attacks,\\s+using\\s+(${NAMES})\\s+in any combination`,
      "y"
    )
  },
  {
    kind: "either",
    pattern: new RegExp(`(?:makes\\s+)?(${COUNT})\\s+(${NAME})\\s+or\\s+(${NAME})\\s+attacks?\\b`, "y")
  },
  { kind: "attack", pattern: new RegExp(`(?:makes\\s+)?(${COUNT})\\s+(${NAME})\\s+attacks?\\b`, "y") },
  {
    kind: "use",
    pattern: new RegExp(
      `(?:can\\s+)?uses?\\s+(?:either\\s+)?(${NAMES})(?:\\s+to cast\\s+${NAME}(?:\\s+\\([^)]*\\))?)?(\\s+twice)?(?:\\s+if available)?`,
      "y"
    )
  }
];
const SEPARATOR = /\s*(?:,\s*)?(?:and\s+)?(?:it\s+)?/y;

const countOf = (word: string) => COUNT_WORDS[word.toLowerCase()] ?? Number.parseInt(word, 10);
const namesOf = (list: string) => list.split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/).filter(Boolean);

/** One plan's components, or null when any part of it isn't a clause the reader knows or names no action. */
function planOf(text: string, idOf: (name: string) => string | undefined): MultiattackComponent[] | null {
  const components: MultiattackComponent[] = [];
  const add = (names: readonly string[], count: number): boolean => {
    const ids = names.map((name) => idOf(name));
    if (ids.some((id) => id === undefined) || !Number.isInteger(count) || count < 1 || count > 6) return false;
    const [first, ...others] = [...new Set(ids as string[])];
    const same = components.find((component) => component.actionId === first && !component.or && others.length === 0);
    if (same) same.count += count;
    else components.push({ actionId: first, count, ...(others.length > 0 ? { or: others } : {}) });
    return true;
  };
  let at = 0;
  while (at < text.length) {
    SEPARATOR.lastIndex = at;
    at += SEPARATOR.exec(text)?.[0].length ?? 0;
    if (at >= text.length) break;
    let matched = false;
    for (const { pattern, kind } of CLAUSES) {
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      if (!match) continue;
      const ok =
        kind === "pool"
          ? add(namesOf(match[2]), countOf(match[1]))
          : kind === "either"
            ? add([match[2], match[3]], countOf(match[1]))
            : kind === "attack"
              ? add([match[2]], countOf(match[1]))
              : add(namesOf(match[1]), match[2] ? 2 : 1);
      if (!ok) return null;
      at = pattern.lastIndex;
      matched = true;
      break;
    }
    if (!matched) return null;
  }
  return components.length > 0 && components.length <= 6 ? components : null;
}

/** "It can replace one attack with a use of Roar", "... with a Tail attack", "... with a use of (A) Sleep Breath or (B)
 *  Spellcasting to cast Scorching Ray", "It can replace the Claw attack with ...". A name nothing answers is skipped. */
function replacementOf(sentence: string, idOf: (name: string) => string | undefined): MultiattackReplacement | null {
  const match =
    /^It can replace (one|two|any) attacks? with (.+?)(?: if available)?\.$/i.exec(sentence) ??
    /^It can replace the (.+?) attack with (.+?)(?: if available)?\.$/i.exec(sentence);
  if (!match) return null;
  const options = match[2].split(/\s+or\s+(?=\(B\))/).map((option) =>
    option
      .replace(/^(?:a use of|an?)\s+/i, "")
      .replace(/^\([AB]\)\s*/, "")
      .replace(/\s+to cast\s+.*$/i, "")
      .replace(/\s+attack$/i, "")
      .trim()
  );
  const actionIds = [...new Set(options.map((option) => idOf(option)).filter((id): id is string => id !== undefined))];
  if (actionIds.length === 0) return null;
  const which = match[1].toLowerCase();
  if (which === "one" || which === "two" || which === "any")
    return { actionIds, attacks: which === "two" ? 2 : 1, ...(which === "any" ? { any: true as const } : {}) };
  const of = idOf(match[1]);
  return of ? { actionIds, attacks: 1, of } : null;
}

/**
 * A Multiattack's plan from its SRD 2024 text, against the stat block's other actions (`idOf` maps a printed name to
 * an action id): "makes two Claw attacks and one Infernal Sting attack", "makes two attacks, using Scimitar or
 * Shortbow in any combination", "makes one Bite attack and uses Constrict", with an alternative plan ("..., or it
 * makes two Hurl Flame attacks", "or uses Holy Burst twice") and replacements ("It can replace one attack with a use
 * of Roar"). Null when the main plan isn't one the reader can say for sure (a hydra's "as many Bite attacks as it
 * has heads"), which leaves the Multiattack prose.
 */
export function multiattackOfProse(
  description: string,
  idOf: (name: string) => string | undefined
): MultiattackOfProse | null {
  const sentences = description.trim().split(/(?<=\.)\s+/);
  const main = /^The [^.]*? (makes .+?)\.$/.exec(sentences[0] ?? "")?.[1];
  if (!main) return null;
  // An alternative plan starts at "or (it) makes" / "or uses"; a condition on it ("if it used Hasten this turn") is the
  // GM's to judge.
  const [first, ...others] = main.split(/,?\s+or\s+(?:it\s+)?(?=makes\s|uses\s)/);
  const plan = planOf(first, idOf);
  if (!plan) return null;
  const alternatives = others.flatMap((text) => {
    const alternative = planOf(text.replace(/\s+if it\b.*$/i, ""), idOf);
    return alternative ? [alternative] : [];
  });
  const replacements = sentences.slice(1).flatMap((sentence) => {
    const replacement = replacementOf(sentence, idOf);
    return replacement ? [replacement] : [];
  });
  return { plan, alternatives, replacements };
}

/**
 * What a stat block's damage drains, from its SRD 2024 text: "its Hit Point maximum decreases by an amount equal to the
 * damage taken" (a wraith's Life Drain), "... equal to the Necrotic damage taken" (that type alone), and "the vampire
 * regains Hit Points equal to that amount". Null when the text says neither, or names a fixed amount ("decreases by 5
 * (1d10)"), which stays the GM's.
 */
export function drainOfProse(description: string): DamageDrain | null {
  const lowered =
    /\bHit Point maximum decreases by an amount equal to the (?:([A-Z][a-z]+) )?damage (?:taken|dealt)\b/.exec(
      description
    );
  const heals = /\bregains Hit Points equal to (half )?(?:that amount|the damage (?:taken|dealt))\b/.exec(description);
  if (!lowered && !heals) return null;
  const type = lowered?.[1]?.toLowerCase();
  return {
    ...(type ? { damageType: type } : {}),
    ...(lowered ? { reducesMaximum: true as const } : {}),
    ...(heals ? { heals: heals[1] ? ("half" as const) : ("all" as const) } : {})
  };
}

/** The push an attack's hit makes, from its SRD 2024 text: "the target is pushed up to 15 feet straight away from the
 *  giant". Null when the text prints none. */
export function hitPushOfProse(description: string): ForcedPush | null {
  const push = /\bthe target is pushed (up to )?(\d+) feet (?:straight )?away from\b/.exec(description);
  return push ? { feet: Number.parseInt(push[2]!, 10), ...(push[1] ? { upTo: true as const } : {}) } : null;
}

const SPEED_MODES = { fly: "fly", swim: "swim", climb: "climb", burrow: "burrow" } as const;

/** Where an action's text makes an attack or calls for a saving throw. */
const ATTACK_OR_SAVE = /\bmakes? (?:one|two|an?) [^.]*?attack|Saving Throw:/i;

/**
 * The move an action makes its own creature take, from its SRD 2024 text: "The dragon moves up to half its Speed, and
 * it makes one Rend attack", "the roc flies up to half its Fly Speed without provoking Opportunity Attacks", "The
 * sahuagin swims up to its Swim Speed straight toward an enemy it can see". `first` when the move comes before the
 * attack or the save the action makes. A move of "its Speed or Burrow Speed" may be either. Null when it prints none.
 */
export function moveOfProse(description: string): ActionMove | null {
  const found =
    /\b(?:the (?!target\b)[a-z -]+?|it) (?:can |then )?(move|moves|fly|flies|swim|swims|climb|climbs|burrow|burrows) up to (half )?its (?:(Fly|Swim|Climb|Burrow) )?Speed( or [A-Z][a-z]+ Speed)?([^.]*)/i.exec(
      description
    );
  if (!found) return null;
  const verb = found[1]!.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");
  const named = found[3]?.toLowerCase() ?? verb;
  const mode = found[4] ? undefined : SPEED_MODES[named as keyof typeof SPEED_MODES];
  const rest = found[5] ?? "";
  const first =
    ATTACK_OR_SAVE.test(description.slice(found.index)) && !ATTACK_OR_SAVE.test(description.slice(0, found.index));
  return {
    speed: found[2] ? "half" : "full",
    ...(mode ? { mode } : {}),
    provokes: !/without provoking Opportunity Attacks/i.test(rest),
    ...(/straight toward/i.test(rest) ? { straight: true as const } : {}),
    ...(first ? { first: true as const } : {})
  };
}

/**
 * The teleport an action makes its creature take: "The dog teleports up to 40 feet to an unoccupied space it can see";
 * the balor's "teleports itself or a willing demon within 10 feet of itself up to 60 feet"; a dryad's Tree Stride, 5
 * feet from a tree up to 60 feet from the last, at most 65 feet. Null when it prints none.
 */
export function teleportOfProse(description: string): ActionTeleport | null {
  const plain =
    /\bteleports(?: itself(?: or a willing [a-z ]+ within \d+ feet of itself)?)? up to (\d+) feet to an unoccupied space\b/i.exec(
      description
    );
  if (plain) return { feet: Number.parseInt(plain[1]!, 10) };
  const stride =
    /\bteleports to an unoccupied space within (\d+) feet of a second [^.]*? within (\d+) feet of the previous\b/i.exec(
      description
    );
  return stride ? { feet: Number.parseInt(stride[1]!, 10) + Number.parseInt(stride[2]!, 10) } : null;
}

/** A jump an action allows: "The bulette jumps up to 30 feet by spending 10 feet of movement." Null when none. */
export function leapOfProse(description: string): { feet: number; costFeet: number } | null {
  const leap = /\bjumps up to (\d+) feet by spending (\d+) feet of movement\b/i.exec(description);
  return leap ? { feet: Number.parseInt(leap[1]!, 10), costFeet: Number.parseInt(leap[2]!, 10) } : null;
}

/** The action with its prose facts filled: the area (an authored one wins), whether it is a Multiattack whose
 *  attacks nothing structured names, a Parry's AC reaction (an authored reaction wins), what its damage drains, how
 *  far its hit pushes, and the move, teleport or jump it makes its creature take (an authored one wins). The same
 *  object when nothing changes. */
export function withProseFacts<Action extends ActorAction>(action: Action): Action {
  const area = action.area ?? areaOfProse(action.description);
  const untracked = /multiattack/i.test(action.name) && !action.multiattack;
  const reaction = action.reaction ?? (action.activation === "reaction" ? acReactionOfProse(action.description) : null);
  const drain = action.drain ?? (action.damage.length > 0 ? drainOfProse(action.description) : null);
  // A save's push is the save's (`failurePush`); an attack's lands with the hit.
  const push = action.onHitPush ?? (action.attack && !action.save ? hitPushOfProse(action.description) : null);
  const move = action.move ?? moveOfProse(action.description);
  const teleport = action.teleport ?? teleportOfProse(action.description);
  const leap = action.leap ?? leapOfProse(action.description);
  if (
    area === (action.area ?? null) &&
    untracked === (action.untrackedMultiattack === true) &&
    reaction === (action.reaction ?? null) &&
    drain === (action.drain ?? null) &&
    push === (action.onHitPush ?? null) &&
    move === (action.move ?? null) &&
    teleport === (action.teleport ?? null) &&
    leap === (action.leap ?? null)
  )
    return action;
  const { untrackedMultiattack: _previous, ...rest } = action;
  return {
    ...rest,
    ...(area ? { area } : {}),
    ...(untracked ? { untrackedMultiattack: true as const } : {}),
    ...(reaction ? { reaction } : {}),
    ...(drain ? { drain } : {}),
    ...(push ? { onHitPush: push } : {}),
    ...(move ? { move } : {}),
    ...(teleport ? { teleport } : {}),
    ...(leap ? { leap } : {})
  } as Action;
}
