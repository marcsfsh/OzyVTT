/**
 * The copy scanner shared by every client vocabulary lock. User-facing strings are JSX text, label-ish
 * props (as attributes or object keys) and the arguments of calls that put a sentence on screen;
 * identifiers, comments, class names and wire values are not. Blind spot: literals inside a JSX
 * expression are not scanned.
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
 * The props that carry copy, in both spellings (`help="…"`, `help: "…"`). Adding one can move the
 * corpus floors in `design-conventions-shape.ts`.
 */
export const COPY_PROPS = [
  "aria-label", "ariaLabel", "label", "placeholder", "title", "empty", "emptyLabel", "heading",
  "help", "hint", "body", "summary", "confirmLabel", "cancelLabel", "removeLabel", "maxReachedReason"
].join("|");

/** The calls that put a sentence on screen with no prop to hang it on. */
export const COPY_CALLS = "setError|setNotice|toast";

/** The strings a person reads; `source` is passed in so a caller can strip comments first. */
export function userFacingStrings(file: string, source: string): CopyString[] {
  const found: CopyString[] = [];
  source.split("\n").forEach((line, index) => {
    // `[:=]` covers object-literal keys; the backtick branch covers template literals. The branches are
    // separate so a template literal may contain a double quote (`Delete map "${name}"?`).
    const quoted = `(?:"([^"\\n]+)"|\`([^\`\\n]+)\`)`;
    for (const match of line.matchAll(new RegExp(`\\b(?:${COPY_PROPS})\\s*[:=]\\s*\\{?${quoted}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    for (const match of line.matchAll(new RegExp(`\\b(?:${COPY_CALLS})\\(\\s*${quoted}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    // A display fallback rendered in JSX (`{actor?.name ?? "combatant"}`) is copy. The trailing `}`
    // keeps code defaults out, since those close on `)` or `;`. Not caught: a fallback assigned to a
    // variable first, or passed to `setError(x ?? "…")`.
    for (const match of line.matchAll(new RegExp(`\\?\\?\\s*${quoted}\\s*\\}`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    // A success message as a callback's second argument (`run(async () => {…}, "Encounter started…")`);
    // `}, "…")` is its tell.
    for (const match of line.matchAll(new RegExp(`\\},\\s*${quoted}\\s*\\)`, "g"))) {
      found.push({ file, line: index + 1, text: match[1] ?? match[2] });
    }
    // A JSX text node runs from the `>` that closed a tag to the next `<` or `{`, so a sentence
    // interrupted by an interpolation is still caught. `(?<!=)` keeps arrow functions' `=>` out.
    for (const match of line.matchAll(/(?<!=)>([^<>{}\n]*[A-Za-z][^<>{}\n]*)(?=[<{])/g)) {
      const text = match[1].trim();
      // A backtick means the `>` closed a generic type argument (`request<{ … }>(token, \`/…\`)`), not a tag.
      if (text.length > 1 && !text.includes("`")) found.push({ file, line: index + 1, text });
    }
  });
  return found;
}

/** Every user-facing string in a set of sources, in source order. */
export function scanCopy(sources: readonly CopySource[]): CopyString[] {
  return sources.flatMap((source) => userFacingStrings(source.file, source.read()));
}

/** The one-line citation every vocabulary failure prints, so a failure is a jump target. */
export const citeCopy = (entry: CopyString): string =>
  `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`;

/**
 * A template literal's `${…}` holes replaced by `$`, applied when matching rules (failures print the
 * raw string). The second replace handles a nested template the capture cut off at its last `${`.
 */
export const withoutInterpolations = (text: string): string =>
  text.replace(/\$\{[^}]*\}/g, "$").replace(/\$\{[^}]*$/, "$");

/** A captured "JSX text" that is really code (a `>` comparison in an expression). Play lock only. */
export const looksLikeCode = (text: string): boolean => /===|!==|&&|\|\||=>|\?\?/.test(text);

/** Reads a file by absolute path: the `CopySource.read` most callers want. */
export const readSource = (absolutePath: string) => (): string => readFileSync(absolutePath, "utf8");
