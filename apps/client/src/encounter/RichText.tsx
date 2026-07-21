import { type ReactNode } from "react";

/**
 * Renders the markdown subset the SRD reference text uses - ***bold-italic***, **bold**, *italic*,
 * paragraph breaks, "- "/"* " bullets, and the flattened pipe tables a few spells carry (Control
 * Weather) - as block-safe JSX. Display only: it never executes or trusts the content, it just formats
 * the bundled reference prose that would otherwise show raw "**" markers or a wall of pipes.
 *
 * Because it can emit <p> and <table>, callers must wrap it in a block element (a <div>), never a <p>.
 */

/** Inline emphasis: ***both*** > **bold** > *italic*. Everything else passes through as text. */
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
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

type Block =
  | Readonly<{ kind: "prose"; text: string }>
  | Readonly<{ kind: "table"; name: string; header: readonly string[]; rows: readonly (readonly string[])[] }>;

const isSeparatorCell = (cell: string) => /^:?-+:?$/.test(cell);

/** Splits the flattened "Table: Name | a | b | |---|---| | 1 | x |" runs out of the prose into table blocks. */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const tablePattern = /Table:\s*([A-Za-z][\w ]*?)\s*(\|[\s\S]*?)(?=\s*Table:|$)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(text)) !== null) {
    if (match.index > last) blocks.push({ kind: "prose", text: text.slice(last, match.index) });
    const cells = match[2].split("|").map((cell) => cell.trim()).filter((cell) => cell !== "");
    const firstSeparator = cells.findIndex(isSeparatorCell);
    const header = firstSeparator === -1 ? [] : cells.slice(0, firstSeparator);
    const columns = header.length || 2;
    const data = cells.slice(firstSeparator === -1 ? 0 : firstSeparator).filter((cell) => !isSeparatorCell(cell));
    const rows: string[][] = [];
    for (let start = 0; start < data.length; start += columns) rows.push(data.slice(start, start + columns));
    blocks.push({ kind: "table", name: match[1], header, rows });
    last = match.index + match[0].length;
  }
  if (last < text.length) blocks.push({ kind: "prose", text: text.slice(last) });
  return blocks;
}

function ProseBlock({ text, keyBase }: Readonly<{ text: string; keyBase: string }>) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return <>{lines.map((line, lineIndex) => {
    const bullet = line.startsWith("- ") || line.startsWith("* ");
    return <p key={`${keyBase}-${lineIndex}`} className={bullet ? "rt-line rt-bullet" : "rt-line"}>
      {bullet ? "• " : null}{inline(bullet ? line.slice(2) : line, `${keyBase}-${lineIndex}`)}
    </p>;
  })}</>;
}

export function RichText({ text }: Readonly<{ text: string }>) {
  // Normalize em-dashes to " - " at render so bundled SRD prose never shows one in the UI, without
  // mutating the licensed content in storage (house style: no em-dashes anywhere on screen).
  const normalized = text.replace(/\s*—\s*/g, " - ");
  const blocks = parseBlocks(normalized);
  return <>{blocks.map((block, blockIndex) => block.kind === "table"
    ? <div className="rt-table-wrap" key={`t-${blockIndex}`}>
        <table className="rt-table">
          <caption>{block.name}</caption>
          {block.header.length > 0 && <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{cell}</th>)}</tr></thead>}
          <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell, `t-${blockIndex}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    : <ProseBlock key={`p-${blockIndex}`} text={block.text} keyBase={`p-${blockIndex}`} />)}</>;
}
