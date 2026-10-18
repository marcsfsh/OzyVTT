// The text rules hidden blocks share between server and client: where a paragraph is, how a block reads once it
// is in a body, and how an old GM body splits into blocks. One copy, because a client that counted paragraphs
// differently would place every block it saves somewhere else.

/** A span of text, `end` exclusive. */
export type CodexTextSpan = Readonly<{ start: number; end: number }>;

/** What a block contributes to a body. */
export type CodexBlockContent = Readonly<{ title: string | null; text: string }>;

/** A block as `assembleCodexBody` places it: `anchor` is the number of player-text paragraphs before it. */
export type CodexPlacedBlock = CodexBlockContent & Readonly<{ anchor: number }>;

const BLANK_LINE = /^[ \t\r]*$/;

/**
 * The paragraphs of a text: runs of lines that are not blank, split at blank lines (lines holding only spaces or
 * tabs). Leading and trailing blank lines belong to no paragraph.
 */
export function codexParagraphs(text: string): CodexTextSpan[] {
  const spans: CodexTextSpan[] = [];
  let open: number | null = null;
  let lastEnd = 0;
  let lineStart = 0;
  for (;;) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    if (BLANK_LINE.test(line)) {
      if (open !== null) spans.push({ start: open, end: lastEnd });
      open = null;
    } else {
      open ??= lineStart;
      lastEnd = line.endsWith("\r") ? lineEnd - 1 : lineEnd;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  if (open !== null) spans.push({ start: open, end: lastEnd });
  return spans;
}

export function codexParagraphCount(text: string): number {
  return codexParagraphs(text).length;
}

/** A block's text without the blank lines around it, so a block never adds a gap of its own. */
function trimmedBlockText(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "").trimEnd();
}

/** A block as it reads in a body: its title as a level 2 heading over its text. Empty when it holds nothing. */
export function renderCodexBlock(block: CodexBlockContent): string {
  const text = trimmedBlockText(block.text);
  const title = block.title?.trim() ?? "";
  if (title === "") return text;
  return text === "" ? `## ${title}` : `## ${title}\n\n${text}`;
}

/**
 * The player text with `blocks` inserted at their anchors, and where each landed. `blocks` must be the ones the
 * reader may see, in document order; nothing marks where any other block sits. A block that renders empty is left
 * out and gets no range. With no block to place, the body is the player text unchanged.
 */
export function assembleCodexBody(
  playerText: string,
  blocks: readonly CodexPlacedBlock[]
): Readonly<{ body: string; ranges: ReadonlyArray<CodexTextSpan | null> }> {
  const rendered = blocks.map(renderCodexBlock);
  if (rendered.every((text) => text === "")) return { body: playerText, ranges: blocks.map(() => null) };
  const paragraphs = codexParagraphs(playerText);
  const count = paragraphs.length;
  const anchorOf = (index: number) => Math.min(Math.max(0, Math.trunc(blocks[index]!.anchor)), count);
  // Stable by anchor, so blocks at one anchor keep their order whatever order the caller's list was in.
  const order = blocks.map((_, index) => index).sort((a, b) => anchorOf(a) - anchorOf(b) || a - b);
  const ranges: Array<CodexTextSpan | null> = blocks.map(() => null);
  let body = "";
  let copied = 0;
  let position = 0;
  while (position < order.length && anchorOf(order[position]!) < count) {
    const anchor = anchorOf(order[position]!);
    const at = paragraphs[anchor]!.start;
    body += playerText.slice(copied, at);
    copied = at;
    for (; position < order.length && anchorOf(order[position]!) === anchor; position += 1) {
      const index = order[position]!;
      if (rendered[index] === "") continue;
      ranges[index] = { start: body.length, end: body.length + rendered[index]!.length };
      body += `${rendered[index]}\n\n`;
    }
  }
  if (position === order.length) return { body: body + playerText.slice(copied), ranges };
  // The rest sit after the last paragraph: the text's trailing blank lines give way to one blank line per block.
  body += playerText.slice(copied).trimEnd();
  for (; position < order.length; position += 1) {
    const index = order[position]!;
    if (rendered[index] === "") continue;
    if (body.trim() !== "") body += "\n\n";
    ranges[index] = { start: body.length, end: body.length + rendered[index]!.length };
    body += rendered[index];
  }
  return { body, ranges };
}

const LEVEL_TWO_HEADING = /^##[ \t]+(.*\S)[ \t]*$/;
/** The longest block title. */
export const CODEX_BLOCK_TITLE_MAX = 160;

/**
 * An old single GM body as hidden blocks: one per `## ` heading, the heading as its title and the text under it as
 * its text, plus one untitled block for any text before the first heading. A blank body gives none.
 */
export function splitCodexHiddenBlocks(markdown: string): CodexBlockContent[] {
  const blocks: CodexBlockContent[] = [];
  let title: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const text = trimmedBlockText(lines.join("\n"));
    if (title !== null || text.trim() !== "") blocks.push({ title, text });
  };
  for (const line of markdown.split("\n")) {
    const heading = LEVEL_TWO_HEADING.exec(line);
    if (!heading) {
      lines.push(line);
      continue;
    }
    flush();
    title = heading[1]!.trim().slice(0, CODEX_BLOCK_TITLE_MAX);
    lines = [];
  }
  flush();
  return blocks;
}
