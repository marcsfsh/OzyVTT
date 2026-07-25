import { type ReactNode } from "react";
import { CodexImage } from "./CodexImage";

/**
 * The codex page renderer: a display-only, injection-safe markdown subset (headings, ***bold-italic***,
 * **bold**, *italic*, ~~strike~~, `code`, "- "/"1. " lists, "> " quotes, "---" rules, paragraphs, and
 * [[wiki-links]]). Like the SRD `RichText`, it never uses dangerouslySetInnerHTML and never executes
 * content - it only formats the GM's prose - and it normalizes em-dashes to " - " per house style.
 * `[[Title]]` / `[[Title#Section]]` render as clickable links that call `onNavigate` with the bare target;
 * `[[kind:ref]]` entity links render as inert chips for now (their targets resolve in a later milestone).
 */

const EMPHASIS = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~/g;
const CODE = /`([^`]+)`/g;
const WIKILINK = /\[\[([^\]]+)\]\]/g;
const ENTITY_PREFIX = /^(page|actor|monster|spell|map|marker):/i;

function emphasize(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  EMPHASIS.lastIndex = 0;
  while ((match = EMPHASIS.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) nodes.push(<strong key={`${keyBase}-${index}`}><em>{match[1]}</em></strong>);
    else if (match[2] !== undefined) nodes.push(<strong key={`${keyBase}-${index}`}>{match[2]}</strong>);
    else if (match[3] !== undefined) nodes.push(<em key={`${keyBase}-${index}`}>{match[3]}</em>);
    else nodes.push(<del key={`${keyBase}-${index}`}>{match[4]}</del>);
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** `code` spans render literally (no emphasis inside); everything else flows through emphasize(). */
function codeAndEmphasis(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  CODE.lastIndex = 0;
  while ((match = CODE.exec(text)) !== null) {
    if (match.index > last) nodes.push(...emphasize(text.slice(last, match.index), `${keyBase}-e${index}`));
    nodes.push(<code key={`${keyBase}-c${index}`} className="codex-md-code">{match[1]}</code>);
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(...emphasize(text.slice(last), `${keyBase}-e${index}`));
  return nodes;
}

function inline(text: string, keyBase: string, onNavigate?: (target: string) => void, knownTitles?: ReadonlySet<string>): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  WIKILINK.lastIndex = 0;
  while ((match = WIKILINK.exec(text)) !== null) {
    if (match.index > last) nodes.push(...codeAndEmphasis(text.slice(last, match.index), `${keyBase}-e${index}`));
    const inner = match[1].trim();
    const [targetPart, sectionPart] = inner.split("#", 2);
    const target = targetPart.trim();
    const section = sectionPart?.trim();
    const isEntity = ENTITY_PREFIX.test(target);
    const shown = section ? `${target.replace(ENTITY_PREFIX, "")} › ${section}` : target.replace(ENTITY_PREFIX, "");
    // A plain [[Title]] is clickable only if it resolves. When knownTitles is provided (the player, who
    // can't auto-create), an unresolved link renders inert ("redlink") instead of a live-looking dead end.
    const resolvable = !isEntity && !!onNavigate && (!knownTitles || knownTitles.has(target.toLowerCase()));
    if (resolvable) {
      nodes.push(<button key={`${keyBase}-w${index}`} type="button" className="codex-md-link" onClick={() => onNavigate!(target)}>{shown}</button>);
    } else {
      nodes.push(<span key={`${keyBase}-w${index}`} className="codex-md-link codex-md-link-inert">{shown}</span>);
    }
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(...codeAndEmphasis(text.slice(last), `${keyBase}-e${index}`));
  return nodes;
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(codex-asset:([0-9a-fA-F-]{36})\)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+\.\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

export function CodexMarkdown({ text, onNavigate, token, knownTitles }: Readonly<{ text: string; onNavigate?: (target: string) => void; token?: string; knownTitles?: ReadonlySet<string> }>) {
  const normalized = text.replace(/\s*—\s*/g, " - ");
  const lines = normalized.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    const key = `p-${blocks.length}`;
    blocks.push(<p key={key} className="codex-md-p">{inline(paragraph.join(" "), key, onNavigate, knownTitles)}</p>);
    paragraph = [];
  };
  // Collect a run of consecutive lines matching `pattern` (capture group 1 is the item text) starting at `from`.
  const collect = (from: number, pattern: RegExp): { items: string[]; next: number } => {
    const items: string[] = [];
    let i = from;
    for (let match = pattern.exec(lines[i]?.trim() ?? ""); match; match = pattern.exec(lines[i]?.trim() ?? "")) { items.push(match[1]); i += 1; }
    return { items, next: i };
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    const key = `l-${index}`;
    if (line === "") { flush(); index += 1; continue; }
    const image = IMAGE_LINE.exec(line);
    if (image) {
      flush();
      // Only ever render an app-served codex asset URL - the injection-safety guarantee (anything else falls through to text).
      if (token) blocks.push(<CodexImage key={key} assetId={image[2]} token={token} alt={image[1]} className="codex-md-img" />);
      else blocks.push(<p key={key} className="codex-md-p codex-preview-empty">[image: {image[1] || "image"}]</p>);
      index += 1;
      continue;
    }
    if (RULE.test(line)) { flush(); blocks.push(<hr key={key} className="codex-md-hr" />); index += 1; continue; }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const Tag = (level === 1 ? "h3" : level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
      blocks.push(<Tag key={key} className={`codex-md-h codex-md-h${level}`}>{inline(heading[2], key, onNavigate, knownTitles)}</Tag>);
      index += 1;
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      const { items, next } = collect(index, BULLET);
      blocks.push(<ul key={key} className="codex-md-ul">{items.map((item, i) => <li key={i} className="codex-md-li">{inline(item, `${key}-${i}`, onNavigate, knownTitles)}</li>)}</ul>);
      index = next;
      continue;
    }
    if (NUMBERED.test(line)) {
      flush();
      const { items, next } = collect(index, NUMBERED);
      blocks.push(<ol key={key} className="codex-md-ol">{items.map((item, i) => <li key={i} className="codex-md-li">{inline(item, `${key}-${i}`, onNavigate, knownTitles)}</li>)}</ol>);
      index = next;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const { items, next } = collect(index, QUOTE);
      blocks.push(<blockquote key={key} className="codex-md-quote">{inline(items.join(" "), key, onNavigate, knownTitles)}</blockquote>);
      index = next;
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flush();
  return <>{blocks}</>;
}
