/**
 * The copy scanners. `userFacingStrings` feeds the vocabulary locks: JSX text, label-ish props (as
 * attributes or object keys) and the arguments of calls that put a sentence on screen. Its blind spot
 * is a literal inside a JSX expression. `proseStrings` feeds the writing rules and reads wider: every
 * string a person could read, in the client and on the server, minus the ones that are code.
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

/** A string from the prose scan. `confirm` marks a confirm dialog's own text, the one place a question belongs. */
export interface ProseString extends CopyString {
  readonly confirm: boolean;
}

/** JSX attributes and object keys whose values are code (class lists, ids, wire values, URLs). */
const CODE_KEYS = new Set([
  "className",
  "style",
  "id",
  "key",
  "href",
  "src",
  "type",
  "role",
  "name",
  "htmlFor",
  "value",
  "defaultValue",
  "pattern",
  "accept",
  "autoComplete",
  "inputMode",
  "rowKey"
]);

/** Calls whose first argument is a matcher, a selector or SQL. The rest of their arguments are still read. */
const CODE_CALLS = new Set([
  "RegExp",
  "split",
  "replace",
  "replaceAll",
  "includes",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "match",
  "matchAll",
  "search",
  "querySelector",
  "querySelectorAll",
  "closest",
  "matchMedia",
  "prepare",
  "exec"
]);

/** SQL text and fragments, which carry `?` placeholders and uppercase keywords. */
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WHERE|VALUES|LIKE|ESCAPE)\b|[=<>] \?|\(\?/;

/** One token with no capital and no space (an id, a slug, a wire value), or a path or query string. */
const IDENTIFIER = /^[a-z][a-z0-9_.:/-]*$|^\S*[/=]\S*$/;

/** The named HTML entities copy uses, decoded so `&mdash;` in JSX is read as the dash it renders. */
const ENTITIES: Readonly<Record<string, string>> = {
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&ldquo;": "\u201c",
  "&rdquo;": "\u201d",
  "&hellip;": "…",
  "&apos;": "'",
  "&quot;": '"',
  "&amp;": "&"
};
const decodeEntities = (text: string): string => text.replace(/&[a-z]+;/g, (entity) => ENTITIES[entity] ?? entity);

/** The text a literal renders: escapes resolved, template holes as `$`. Null for anything that is not a literal. */
function cookedText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return node.head.text + node.templateSpans.map((span) => `$${span.literal.text}`).join("");
  if (ts.isJsxText(node)) return node.text.replace(/\s+/g, " ").trim();
  return null;
}

const calleeName = (call: ts.CallExpression | ts.NewExpression): string => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return "";
};

const tagName = (node: ts.Node): string =>
  ts.isJsxElement(node)
    ? node.openingElement.tagName.getText()
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName.getText()
      : "";

/** Whether a literal is code where it stands: a key, a type, a module path, a comparison, a matcher or a class list. */
function isCode(node: ts.Node, parent: ts.Node): boolean {
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent))
    return true;
  if (ts.isLiteralTypeNode(parent) || ts.isImportTypeNode(parent) || ts.isCaseClause(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && CODE_KEYS.has(nameOf(parent.name))) return true;
  if (ts.isJsxAttribute(parent) && (CODE_KEYS.has(nameOf(parent.name)) || nameOf(parent.name).startsWith("data-")))
    return true;
  if (ts.isElementAccessExpression(parent) || ts.isComputedPropertyName(parent)) return true;
  if (
    ts.isBinaryExpression(parent) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken,
      ts.SyntaxKind.InKeyword
    ].includes(parent.operatorToken.kind)
  )
    return true;
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.[0] === node)
    return (
      CODE_CALLS.has(calleeName(parent)) || (ts.isIdentifier(parent.expression) && parent.expression.text === "require")
    );
  return false;
}

/**
 * Inside a confirm dialog: a call to `confirm` (or `askConfirm`, `setConfirm`), a `<ConfirmRow>`, or the server's
 * history confirmation.
 */
function inConfirm(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isCallExpression(at) && /^(confirm|askConfirm|setConfirm)$/.test(calleeName(at))) return true;
    if (ts.isNewExpression(at) && calleeName(at) === "TimelineConfirmationRequired") return true;
    if (tagName(at) === "ConfirmRow") return true;
  }
  return false;
}

/**
 * Every literal a person could read: string and template literals and JSX text, with escapes and HTML
 * entities resolved and template holes as `$`. Skipped as code: keys, types, module paths, comparisons,
 * matchers, class lists, SQL, ids, paths, and text with no letter and nothing outside ASCII.
 */
export function proseStrings(file: string, source: string): ProseString[] {
  // A `.ts` file parsed as TSX reads a generic call's `<T>` as JSX.
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found: ProseString[] = [];
  const visit = (node: ts.Node): void => {
    const raw = cookedText(node);
    if (raw !== null && node.parent && !isCode(node, node.parent)) {
      const text = decodeEntities(raw);
      if ((/[A-Za-z]/.test(text) || /[^\x00-\x7f]/.test(text)) && !SQL.test(text) && !IDENTIFIER.test(text))
        found.push({
          file,
          line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
          text,
          confirm: inConfirm(node)
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}
