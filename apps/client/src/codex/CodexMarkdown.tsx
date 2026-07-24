import { type ReactNode } from "react";
import { CodexImage } from "./CodexImage";

/**
 * The codex page renderer: a display-only, injection-safe markdown subset (headings, ***bold-italic***,
 * **bold**, *italic*, "- "/"* " bullets, paragraphs, and [[wiki-links]]). Like the SRD `RichText`, it
 * never uses dangerouslySetInnerHTML and never executes content - it only formats the GM's prose - and
 * it normalizes em-dashes to " - " per house style. `[[Title]]` / `[[Title#Section]]` render as
 * clickable links that call `onNavigate` with the bare target; `[[kind:ref]]` entity links render as
 * inert chips for now (their targets resolve in a later milestone).
 */

const EMPHASIS = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
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
    else nodes.push(<em key={`${keyBase}-${index}`}>{match[3]}</em>);
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function inline(text: string, keyBase: string, onNavigate?: (target: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  WIKILINK.lastIndex = 0;
  while ((match = WIKILINK.exec(text)) !== null) {
    if (match.index > last) nodes.push(...emphasize(text.slice(last, match.index), `${keyBase}-e${index}`));
    const inner = match[1].trim();
    const [targetPart, sectionPart] = inner.split("#", 2);
    const target = targetPart.trim();
    const section = sectionPart?.trim();
    const isEntity = ENTITY_PREFIX.test(target);
    const shown = section ? `${target.replace(ENTITY_PREFIX, "")} › ${section}` : target.replace(ENTITY_PREFIX, "");
    if (isEntity || !onNavigate) {
      nodes.push(<span key={`${keyBase}-w${index}`} className="codex-md-link codex-md-link-inert">{shown}</span>);
    } else {
      nodes.push(<button key={`${keyBase}-w${index}`} type="button" className="codex-md-link" onClick={() => onNavigate(target)}>{shown}</button>);
    }
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(...emphasize(text.slice(last), `${keyBase}-e${index}`));
  return nodes;
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(codex-asset:([0-9a-fA-F-]{36})\)$/;

export function CodexMarkdown({ text, onNavigate, token }: Readonly<{ text: string; onNavigate?: (target: string) => void; token?: string }>) {
  const normalized = text.replace(/\s*—\s*/g, " - ");
  const lines = normalized.split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    const key = `p-${blocks.length}`;
    blocks.push(<p key={key} className="codex-md-p">{inline(paragraph.join(" "), key, onNavigate)}</p>);
    paragraph = [];
  };
  lines.forEach((raw, lineIndex) => {
    const line = raw.trim();
    const key = `l-${lineIndex}`;
    if (line === "") { flush(); return; }
    const image = IMAGE_LINE.exec(line);
    if (image) {
      flush();
      // Only ever render an app-served codex asset URL - the injection-safety guarantee (anything else falls through to text).
      if (token) blocks.push(<CodexImage key={key} assetId={image[2]} token={token} alt={image[1]} className="codex-md-img" />);
      else blocks.push(<p key={key} className="codex-md-p codex-preview-empty">[image: {image[1] || "image"}]</p>);
      return;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const Tag = (level === 1 ? "h3" : level === 2 ? "h4" : "h5") as "h3" | "h4" | "h5";
      blocks.push(<Tag key={key} className={`codex-md-h codex-md-h${level}`}>{inline(heading[2], key, onNavigate)}</Tag>);
      return;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flush();
      blocks.push(<p key={key} className="codex-md-p codex-md-bullet">{"• "}{inline(line.slice(2), key, onNavigate)}</p>);
      return;
    }
    paragraph.push(line);
  });
  flush();
  return <>{blocks}</>;
}
