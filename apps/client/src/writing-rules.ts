/**
 * The checkable half of the Writing section in docs/DESIGN.md, applied by `writing.test.ts`. The other half
 * ("X, not Y", "X rather than Y", a clause tacked on with "-ing", a three-part series) can't be matched safely,
 * so it is left to whoever writes and reviews the copy.
 */

export interface WritingRule {
  readonly id: string;
  readonly pattern: RegExp;
  /** Proper nouns the pattern would catch, removed before it is tried ("Utilize" is an SRD action). */
  readonly names?: RegExp;
  /** A confirm dialog's own text may break this rule. */
  readonly confirmMay?: boolean;
  /** What to write instead, printed with every failure. */
  readonly fix: string;
}

export const WRITING_RULES: readonly WritingRule[] = [
  {
    id: "dash",
    pattern: /[\u2013\u2014]/,
    fix: "Use a colon or a full stop, or `·` between label fragments. A range is written 5-6, with a plain hyphen."
  },
  {
    id: "spaced-hyphen",
    // A hyphen before a digit is subtraction ("2d6 + 1d4 - 2").
    pattern: / - (?!\d)/,
    fix: "Write two sentences, or join label fragments with `·`."
  },
  { id: "curly-quote", pattern: /[\u2018\u2019\u201c\u201d]/, fix: "Use straight quotes and apostrophes." },
  {
    id: "emoji",
    pattern: /(?![\u00a9\u00ae\u2122])\p{Extended_Pictographic}/u,
    fix: "Render an icon from @vtt/ui, or say it in words."
  },
  {
    id: "question",
    pattern: /\?/,
    confirmMay: true,
    fix: "Only a confirm dialog asks. State the fact, or say what to do."
  },
  {
    id: "exclamation",
    // `![alt](src)` is a Markdown image.
    pattern: /!(?!\[)/,
    fix: "State it plainly, without an exclamation mark."
  },
  {
    id: "filler",
    pattern: /\b(simply|just|easily|lets you|note that)\b/i,
    fix: "Delete the filler word. If the sentence says nothing without it, delete the sentence."
  },
  {
    id: "inflated",
    pattern:
      /\b(comprehensive|crucial|enhance[ds]?|enhancing|leverag\w*|robust|seamless\w*|streamlin\w*|utiliz\w*|vital)\b/i,
    names: /\bUtilize\b|\bEnhance Ability\b/g,
    fix: "Use a plain word: use, get, start, end, help, show, is, has."
  },
  {
    id: "pronoun",
    pattern: /\b(he|she|her|hers|his|him|himself|herself)\b/i,
    fix: "Name the character. The app doesn't know a character's pronouns."
  },
  {
    id: "ordinal-level",
    pattern: /\b\d+(st|nd|rd|th)\b|\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)-level\b|\$-level\b/i,
    fix: 'Use SRD 5.2.1 wording: "level 3 spell slot", "a level 5 character".'
  },
  {
    id: "srd-term",
    pattern: /\b[Ll]ong rests?\b|\b[Ss]hort rests?\b|\b[Bb]onus actions?\b/,
    fix: "Capitalise the rules term as SRD 5.2.1 does: Long Rest, Short Rest, Bonus Action."
  }
];

/** Backticked code (`?id=a&id=b`, `uses.pool ?? action.id`) is code, so the rules skip it. */
const withoutCode = (text: string): string => text.replace(/`[^`]*`/g, "``");

/** The rules a string breaks. `confirm` is true for a confirm dialog's own text. */
export function brokenRules(text: string, confirm = false): WritingRule[] {
  const prose = withoutCode(text);
  return WRITING_RULES.filter(
    (rule) => !(confirm && rule.confirmMay) && rule.pattern.test(rule.names ? prose.replace(rule.names, "") : prose)
  );
}
