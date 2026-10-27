/**
 * A stat block's printed words, cleaned of what the open5e transcription added to them, so every action and trait reads
 * as SRD 5.2.1 prints it: the 5etools link tags it carries ("Sphere [Area of Effect]|XPHB|Sphere", "Cover|XPHB|Total
 * Cover"), two words it mangled ("HitomThe spear", "start Hitazard burning"), and the spell-list lines it appended to
 * actions that only cast one spell. The names of actions printed for some forms only keep their limit.
 */

/**
 * The words after a link tag are the ones printed. A bracketed tag repeats the word before it ("20-foot-radius Sphere
 * [Area of Effect]|XPHB|Sphere"), so the tag and its repeat go; a named one ("Cover|XPHB|Total Cover", "Short
 * Rest|XPHB|Short or Long Rest") gives its rules entry's name in title case, which goes.
 */
function withoutLinkTags(text: string): string {
  return text
    .replace(/(\b[A-Z][a-z]+) \[[^\]]*\]\|XPHB\|\1\b/g, "$1")
    .replace(/\[[^\]]*\]\|XPHB\|/g, "")
    .replace(/\b(?:[A-Z][a-z]+ )*[A-Z][a-z]+\|XPHB\|/g, "");
}

/** Two words the transcription ran together: "Hit or Miss:" and the Fire Aura's "start burning". */
function withoutGlitches(text: string): string {
  return text.replace(/\bHitom(?=[A-Z])/g, "Hit or Miss: ").replace(/\bstart Hitazard burning\b/g, "start burning");
}

/** A list line with no spells after its label ("- **At Will:**"). */
const EMPTY_LIST_LINE = /\n- \*\*(?:At Will|\d\/Day(?: Each)?):\*\*[ \t]*(?=\n|$)/g;
/** The spell-list lines the transcription appended to an action that casts one spell ("The imp casts Invisibility
 *  ... \n\n- **At Will:** Invisibility"); its own sentence already names the spell. */
const APPENDED_LIST = /(?:\n+- \*\*(?:At Will|\d\/Day(?: Each)?):\*\*[^\n]*)+\s*$/;

/** An action's printed text: link tags, glitches and stray list lines out. Only a Spellcasting action keeps its
 *  lists, less any empty line. */
export function statBlockActionText(actionId: string, text: string): string {
  const cleaned = withoutGlitches(withoutLinkTags(text));
  return actionId === "spellcasting"
    ? cleaned.replace(EMPTY_LIST_LINE, "").trimEnd()
    : cleaned.replace(APPENDED_LIST, "").trimEnd();
}

/** A trait's printed text. */
export function statBlockTraitText(text: string): string {
  return withoutGlitches(withoutLinkTags(text));
}

/**
 * The limits SRD 5.2.1 prints in some action and trait names, which the transcription drops: the forms an action
 * works in, keyed by creature and the name as transcribed ("Bite" is "Bite (Wolf or Hybrid Form Only)"), and what one
 * needs ("Entangling Rope (Requires Magic Rope)").
 */
const PRINTED_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  erinyes: { "Entangling Rope": "Entangling Rope (Requires Magic Rope)" },
  vampire: {
    Multiattack: "Multiattack (Vampire Form Only)",
    "Grave Strike": "Grave Strike (Vampire Form Only)",
    Bite: "Bite (Bat or Vampire Form Only)"
  },
  werebear: {
    Bite: "Bite (Bear or Hybrid Form Only)",
    Handaxe: "Handaxe (Humanoid or Hybrid Form Only)",
    Rend: "Rend (Bear or Hybrid Form Only)"
  },
  wereboar: {
    Gore: "Gore (Boar or Hybrid Form Only)",
    Javelin: "Javelin (Humanoid or Hybrid Form Only)",
    Tusk: "Tusk (Boar or Hybrid Form Only)"
  },
  wererat: {
    Bite: "Bite (Rat or Hybrid Form Only)",
    "Hand Crossbow": "Hand Crossbow (Humanoid or Hybrid Form Only)"
  },
  weretiger: {
    Bite: "Bite (Tiger or Hybrid Form Only)",
    Longbow: "Longbow (Humanoid or Hybrid Form Only)"
  },
  werewolf: {
    Bite: "Bite (Wolf or Hybrid Form Only)",
    Longbow: "Longbow (Humanoid or Hybrid Form Only)"
  }
};

/** The name as SRD 5.2.1 prints it: the transcribed one, trimmed, with the limit it dropped. */
export function printedName(slug: string, name: string): string {
  const trimmed = name.trim();
  return PRINTED_NAMES[slug]?.[trimmed] ?? trimmed;
}

/** Every creature and name the table renames, for the build's check that each still names something. */
export const PRINTED_NAME_KEYS: ReadonlyArray<readonly [string, string]> = Object.entries(PRINTED_NAMES).flatMap(
  ([slug, names]) => Object.keys(names).map((name) => [slug, name] as const)
);
