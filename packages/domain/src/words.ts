// Small English helpers, shared so a phrase the server writes and one the client builds read the same way.

/** Words that start with a vowel letter but a consonant sound ("a unique", "a one-handed"). */
const CONSONANT_SOUND = /^(eu|ewe|one\b|once\b|uni|use|usu|uti|ure|uri|ura)/i;
/** Words that start with a silent "h" ("an hour"). */
const VOWEL_SOUND = /^(hour|honest|honor|heir)/i;

/** "a" or "an" for the word that follows: "an Intelligence check", "an INT save", "a Wisdom check". */
export function articleFor(word: string): "a" | "an" {
  const text = word.trim();
  if (VOWEL_SOUND.test(text)) return "an";
  if (CONSONANT_SOUND.test(text)) return "a";
  return /^[aeiou]/i.test(text) ? "an" : "a";
}

/** The word with its indefinite article: "an Intelligence check". */
export function withArticle(word: string): string {
  return `${articleFor(word)} ${word}`;
}

/** A count with its noun: "1 page", "3 pages", "1 journal entry", "2 journal entries" (pass the plural). */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
