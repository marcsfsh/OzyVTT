/**
 * The copy scanner shared by every client vocabulary lock. User-facing strings are JSX text, label-ish
 * props (as attributes or object keys) and the arguments of calls that put a sentence on screen;
 * identifiers, comments, class names and wire values are not. Blind spot: literals inside a JSX
 * expression are not scanned.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

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

/** The props that carry copy, in both spellings (`help="…"`, `help: "…"`). */
export const COPY_PROPS = [
  "aria-label",
  "ariaLabel",
  "label",
  "placeholder",
  "title",
  "empty",
  "emptyLabel",
  "heading",
  "help",
  "hint",
  "body",
  "summary",
  "confirmLabel",
  "cancelLabel",
  "removeLabel",
  "maxReachedReason"
].join("|");

/** The calls that put a sentence on screen with no prop to hang it on. */
export const COPY_CALLS = "setError|setNotice|toast";

const COPY_PROP_NAMES = new Set(COPY_PROPS.split("|"));
const COPY_CALL_NAMES = new Set(COPY_CALLS.split("|"));

/** The literal text of a string or template literal (holes kept as `${…}`), or null for anything else. */
function literalText(node: ts.Node | undefined, file: ts.SourceFile): string | null {
  if (!node) return null;
  if (ts.isJsxExpression(node)) return literalText(node.expression, file);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(file).slice(1, -1);
  return null;
}

function nameOf(node: ts.PropertyName | ts.JsxAttributeName): string {
  return ts.isIdentifier(node) || ts.isStringLiteral(node)
    ? node.text
    : ts.isJsxNamespacedName(node)
      ? `${node.namespace.text}:${node.name.text}`
      : "";
}

/**
 * The strings a person reads: JSX text, copy props (as attributes or object keys), the first argument
 * of a copy call, a `?? "…"` fallback rendered in JSX, and a success message passed after a callback
 * (`run(async () => {…}, "Encounter started")`). Parsed as TSX, so layout does not matter.
 */
export function userFacingStrings(file: string, source: string): CopyString[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: CopyString[] = [];
  const push = (node: ts.Node, text: string | null) => {
    if (text === null || text.length === 0) return;
    found.push({ file, line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1, text });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text.length > 1 && /[A-Za-z]/.test(text)) push(node, text);
    } else if (ts.isJsxAttribute(node) && COPY_PROP_NAMES.has(nameOf(node.name))) {
      push(node, literalText(node.initializer, parsed));
    } else if (ts.isPropertyAssignment(node) && COPY_PROP_NAMES.has(nameOf(node.name))) {
      push(node, literalText(node.initializer, parsed));
    } else if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && COPY_CALL_NAMES.has(node.expression.text))
        push(node, literalText(node.arguments[0], parsed));
      node.arguments.forEach((argument, index) => {
        const previous = node.arguments[index - 1];
        if (
          previous &&
          (ts.isArrowFunction(previous) || ts.isFunctionExpression(previous)) &&
          ts.isBlock(previous.body)
        )
          push(argument, literalText(argument, parsed));
      });
    } else if (
      node.parent !== undefined &&
      ts.isJsxExpression(node.parent) &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      push(node.right, literalText(node.right, parsed));
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found.sort((a, b) => a.line - b.line);
}

/** Every user-facing string in a set of sources, in source order. */
export function scanCopy(sources: readonly CopySource[]): CopyString[] {
  return sources.flatMap((source) => userFacingStrings(source.file, source.read()));
}

/** The one-line citation every vocabulary failure prints, so a failure is a jump target. */
export const citeCopy = (entry: CopyString): string => `${entry.file}:${entry.line}  ${JSON.stringify(entry.text)}`;

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
