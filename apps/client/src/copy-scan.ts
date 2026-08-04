/**
 * THE COPY SCANNER — one implementation, read by every vocabulary lock in the client.
 *
 * `codex/vocabulary.test.ts` proved the technique: read the source, decide which string
 * literals a *person* reads, and fail the build on a retired word. The Codex needed it because
 * the same thing had three names on three surfaces. The rest of the product has the same
 * disease (D28: "actor" and "combatant" in copy, five phrasings for one dice-visibility
 * choice, "Encounter" naming both a fight and a place), so the lock is now play-wide too.
 *
 * **This module exists so there is exactly ONE scanner.** Two copies of the extraction rules
 * would drift from each other — which is precisely the failure the locks exist to catch, and
 * it would be embarrassing for it to happen inside the enforcement layer. The logic below is
 * `codex/vocabulary.test.ts`'s, moved verbatim and parameterized on the sources; that test
 * imports it and its floors and pins are unchanged by the move, which is the proof the
 * extraction changed nothing.
 *
 * **How it decides what is user-facing** (the inherited contract, unchanged):
 *   · JSX text nodes — the words between `>` and the next `<` or `{`;
 *   · label-ish props (`aria-label`, `label`, `placeholder`, `title`, `help`, `body`, …), in
 *     both spellings: `help="…"` as a JSX attribute and `help: "…"` as an object-literal key,
 *     so a `useConfirm({ title, body })` dialog is visible;
 *   · the arguments of the calls that put a sentence on screen with no prop to hang it on.
 * Identifiers, comments, CSS class names and wire field names are deliberately out of scope.
 * `visibility === "gm-only"` is protocol; `label="GM only"` is copy. Drawing that line is the
 * whole job — widening the scan to every string literal would flag every wire value in the
 * tree and the lock would be turned off within a week.
 *
 * **Two blind spots, inherited and stated rather than papered over:**
 *  1. *Interpolated copy.* A literal inside a JSX expression — `{claimed ? "Claimed" :
 *     "Available"}`, `{actor.kind}`, `" · GM only"` in a ternary — is invisible here, because
 *     the JSX-text branch stops at `{`. Fixing that class means fixing the copy at the site;
 *     the lock's job for them is preventing *re-introduction through the visible channels*.
 *  2. *Meaning-level drift.* A regex matches tokens, not senses: "Save" the throw and "Save"
 *     the persist verb are one token. Senses are separated by scoping a rule to the files
 *     where only one sense lives, and reviewed by a human everywhere else.
 */
import { readFileSync } from "node:fs";

/** A file to scan: the name a failure message should print, and how to read it. */
export interface CopySource {
  /** What the failure prints and what `(file, string)` exemptions match on. */
  readonly file: string;
  readonly read: () => string;
}

export interface CopyString {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * The props that carry copy. Both spellings — `help="…"` in JSX and `help: "…"` in a
 * confirm/meta object.
 *
 * Frozen at the Codex's list on extraction day. Adding a prop here widens every lock at once,
 * which is a deliberate, reviewable act: it can only *find* more copy, never less, but it
 * moves the measured corpus floors in `design-conventions-shape.ts` and can surface offenders
 * in files nobody was editing. Add one when a new primitive introduces a copy prop, and
 * re-measure the floors in the same commit.
 */
export const COPY_PROPS = [
  "aria-label", "ariaLabel", "label", "placeholder", "title", "empty", "emptyLabel", "heading",
  "help", "hint", "body", "summary", "confirmLabel", "cancelLabel", "removeLabel", "maxReachedReason"
].join("|");

/** The calls that put a sentence on screen with no prop to hang it on. */
export const COPY_CALLS = "setError|setNotice|toast";

/**
 * JSX text nodes, label-ish props and message calls — the strings a person actually reads.
 *
 * `source` is passed in rather than read here so a caller can strip comments first (the play
 * lock does; a comment naming a retired word to say it is retired is not copy).
 */
export function userFacingStrings(file: string, source: string): CopyString[] {
  const found: CopyString[] = [];
  source.split("\n").forEach((line, index) => {
    // `[:=]` catches the object-literal half, and the backtick branch catches template literals —
    // between them, `confirm({ title: "Delete marker", body: \`…\` })` becomes visible for the first
    // time. The two branches are separate so a template literal may contain a double quote of its own,
    // which the atlas's `Delete map "${name}"?` does.
    const quoted = `(?:"([^"\\n]+)"|\`([^\`\\n]+)\`)`;
    for (const match of line.matchAll(new RegExp(`\\b(?:${COPY_PROPS})\\s*[:=]\\s*\\{?${quoted}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    for (const match of line.matchAll(new RegExp(`\\b(?:${COPY_CALLS})\\(\\s*${quoted}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    // A display fallback inside a JSX expression — `{actor?.name ?? "combatant"}` — is copy the same
    // way a JSX text node is: the person reads it when the left side is missing. The trailing `}` is
    // what keeps this honest and narrow: a code default (`visibility ?? "public") !== "gm-only"`, or
    // `const mode = x ?? "public";`) closes on `)` or `;`, never the `}` of a rendered expression, so
    // enum defaults stay code. It does NOT reach a fallback assigned to a variable first and rendered
    // later (`const label = x ?? "Battlemap";`) or one passed to `setError(x ?? "…")` — those two
    // shapes are the scanner's known boundary, watched by review rather than regex.
    for (const match of line.matchAll(new RegExp(`\\?\\?\\s*${quoted}\\s*\\}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    // A success message trailing a callback argument — `run(async () => {…}, "Encounter started…")` —
    // is a toast with no prop to hang it on, and `COPY_CALLS` cannot see it because it is the SECOND
    // argument. The closing line `}, "…")` is its unmistakable, low-noise tell.
    for (const match of line.matchAll(new RegExp(`\\},\\s*${quoted}\\s*\\)`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    // A JSX text node runs from the `>` that closed a tag up to the next `<` or `{`. The old form
    // required a literal `<` to close it, so any sentence interrupted by an interpolation vanished
    // whole — including MarkerInspector's "is hidden from them. Players cannot see either.{onRevealMap …".
    // `(?<!=)` is what keeps that widening honest: without it every arrow function's `=>` opens a
    // "text node" and the body of the Codex's own code is scanned as copy.
    for (const match of line.matchAll(/(?<!=)>([^<>{}\n]*[A-Za-z][^<>{}\n]*)(?=[<{])/g)) {
      const text = match[1].trim();
      // A backtick is the tell for the other thing a `>` closes: a generic type argument, as in
      // `request<{ marker: CodexMarker }>(token, \`/markers/…\`)`. No sentence a GM reads has one.
      if (text.length > 1 && !text.includes("`")) found.push({ file, line: index + 1, text });
    }
  });
  return found;
}

/** Every user-facing string in a set of sources, in source order. */
export function scanCopy(sources: readonly CopySource[]): CopyString[] {
  return sources.flatMap((source) => userFacingStrings(source.file, source.read()));
}

/** The one-line citation shape every vocabulary failure prints, so a failure is a jump target. */
export const citeCopy = (entry: CopyString): string =>
  `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`;

/**
 * A template literal's `${…}` holes blanked, the sentence around them kept.
 *
 * Applied at MATCH time, never at scan time, and the difference matters: the corpus keeps the
 * raw string (`codex/vocabulary.test.ts` pins `'Delete map "${currentMap.name}"? Its pins are
 * removed.'` verbatim, and a failure message must print what is actually typed), while a word
 * rule reads only the part a person sees. Without this, `` `Delete ${actor.name}?` `` — which
 * renders "Delete Bergthora?" and contains no vocabulary at all — fails an "actor" rule, and
 * eleven such sites would have to be excused one by one. Excusing them would then excuse the
 * real thing too: a hand-typed "actor" on the same line.
 *
 * A `$` is left behind so a rule can still see that a hole was there, and so two words either
 * side of a hole do not fuse into a third word that neither of them is.
 *
 * The second branch handles a hole the capture cut in half. The scanner's template-literal
 * branch stops at the next backtick, so a nested template — `PartyStrip.tsx`'s
 * `` `${name} — ${hp} — ${CLAIM_WORD[claim]}${actor.presence ? ` … ` : ""}` `` — is captured
 * with its last `${` still open. Everything after an unclosed `${` is the inside of an
 * expression, which is code, so it goes the same way the closed ones do.
 */
export const withoutInterpolations = (text: string): string =>
  text.replace(/\$\{[^}]*\}/g, "$").replace(/\$\{[^}]*$/, "$");

/**
 * Whether a captured "JSX text node" is really source code.
 *
 * The text branch runs from a `>` to the next `<` or `{`, and a `>=` comparison inside a JSX
 * expression opens one: `CharacterSheet.tsx`'s `proficiencies.skills.length > 0)) ||
 * actor.kind === "player-character") &&` is captured as a sentence. It is not one — nobody
 * reads it — and the tells are unambiguous, because no copy in this product contains a JS
 * operator sequence.
 *
 * **This is a filter the play lock applies, not a change to the scan.** The Codex corpus is
 * pinned at the size it measured before the scanner moved out of it and does not use this;
 * applying it there would move a pinned number for no benefit. Here it removes non-copy that
 * would otherwise have to be carried as exemptions, and an exemption that excuses a scanner
 * artifact teaches the next reader that exemptions are for inconvenience.
 */
export const looksLikeCode = (text: string): boolean => /===|!==|&&|\|\||=>|\?\?/.test(text);

/** Read a file by absolute path — the `CopySource.read` most callers want. */
export const readSource = (absolutePath: string) => (): string => readFileSync(absolutePath, "utf8");
