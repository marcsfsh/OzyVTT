import type { CodexEntityType } from "@vtt/domain";
import { codexParagraphs, type CodexBlock, type PlayerCodexBlock } from "../contract";

/**
 * A page as one document: the player text cut at its blocks, so the GM reads and writes each block where it sits.
 * The server keeps the player text and the blocks apart (an anchor is the number of player-text paragraphs before
 * a block), and `codexParagraphs` is the one rule for what a paragraph is, so the client places a block exactly
 * where the server does.
 */

/** A stretch of player text, or one block, in document order. */
export type GmDocItem<TBlock> = Readonly<{ kind: "text"; text: string }> | Readonly<{ kind: "block"; block: TBlock }>;

/**
 * The GM's document: runs of player text between the blocks, in order. A run keeps the text's own formatting
 * between its paragraphs. Blocks with the same anchor keep their order.
 */
export function gmDocument<TBlock extends Readonly<{ anchor: number }>>(
  playerText: string,
  blocks: readonly TBlock[]
): GmDocItem<TBlock>[] {
  const paragraphs = codexParagraphs(playerText);
  const count = paragraphs.length;
  const anchorOf = (block: TBlock) => Math.min(Math.max(0, Math.trunc(block.anchor)), count);
  const ordered = blocks.map((block, index) => ({ block, index }));
  ordered.sort((a, b) => anchorOf(a.block) - anchorOf(b.block) || a.index - b.index);
  const items: GmDocItem<TBlock>[] = [];
  let from = 0;
  const pushText = (to: number) => {
    if (to <= from) return;
    items.push({ kind: "text", text: playerText.slice(paragraphs[from].start, paragraphs[to - 1].end) });
    from = to;
  };
  for (const { block } of ordered) {
    pushText(anchorOf(block));
    items.push({ kind: "block", block });
  }
  pushText(count);
  return items;
}

/** A block in the editor: one the server has (`id`), or one being written that has none yet. */
export type DraftBlock = Readonly<{
  key: string;
  id: string | null;
  title: string;
  text: string;
}>;
/** The editor's document: text segments with blocks between them. A text segment is always first and last. */
export type DraftItem = Readonly<{ kind: "text"; key: string; text: string }> | (DraftBlock & { kind: "block" });

let draftKey = 0;
export const nextDraftKey = () => `d${(draftKey += 1)}`;

/** The editor's document for a record, with an empty text segment wherever the GM could type between blocks. */
export function draftDocument(playerText: string, blocks: readonly CodexBlock[]): DraftItem[] {
  const items: DraftItem[] = [];
  const pushText = (text: string) => items.push({ kind: "text", key: nextDraftKey(), text });
  for (const item of gmDocument(playerText, blocks)) {
    if (item.kind === "text") {
      pushText(item.text);
      continue;
    }
    if (items.length === 0 || items[items.length - 1].kind === "block") pushText("");
    const block = item.block;
    items.push({ kind: "block", key: block.id, id: block.id, title: block.title ?? "", text: block.text });
  }
  if (items.length === 0 || items[items.length - 1].kind === "block") pushText("");
  return items;
}

/**
 * What the editor's document saves as: the player text (its segments joined by a blank line) and each block with
 * the number of paragraphs before it.
 */
export function saveShape(items: readonly DraftItem[]): Readonly<{
  playerBody: string;
  blocks: ReadonlyArray<DraftBlock & Readonly<{ anchor: number }>>;
}> {
  const texts: string[] = [];
  const blocks: Array<DraftBlock & { anchor: number }> = [];
  let paragraphs = 0;
  for (const item of items) {
    if (item.kind === "text") {
      const text = item.text.trim();
      if (text === "") continue;
      texts.push(text);
      paragraphs += codexParagraphs(text).length;
    } else {
      blocks.push({ key: item.key, id: item.id, title: item.title, text: item.text, anchor: paragraphs });
    }
  }
  return { playerBody: texts.join("\n\n"), blocks };
}

/**
 * Splits a text segment at the caret for a new block: the text before the caret's paragraph break stays, the rest
 * moves after the block. A caret inside a paragraph splits at the end of that paragraph, since a block sits
 * between paragraphs.
 */
export function splitForBlock(text: string, caret: number): readonly [before: string, after: string] {
  const paragraphs = codexParagraphs(text);
  const holding = paragraphs.find((span) => caret >= span.start && caret <= span.end);
  const at = holding ? holding.end : caret;
  return [text.slice(0, at).trimEnd(), text.slice(at).trimStart()];
}

/** A stretch of a player's body: their text, or one block that reached them. */
export type PlayerDocItem =
  Readonly<{ kind: "text"; text: string }> | Readonly<{ kind: "block"; text: string; block: PlayerCodexBlock }>;

/** A player's body cut at the blocks the server placed in it, by the offsets it sent. */
export function playerDocument(body: string, blocks: readonly PlayerCodexBlock[]): PlayerDocItem[] {
  const items: PlayerDocItem[] = [];
  let from = 0;
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  for (const block of sorted) {
    if (block.start < from || block.end > body.length || block.end <= block.start) continue;
    const before = body.slice(from, block.start);
    if (before.trim()) items.push({ kind: "text", text: before });
    items.push({ kind: "block", text: body.slice(block.start, block.end), block });
    from = block.end;
  }
  const rest = body.slice(from);
  if (rest.trim()) items.push({ kind: "text", text: rest });
  return items;
}

// ----- The kind groups players and the GM browse by -----

export type KindGroup = Readonly<{
  id: string;
  label: string;
  iconId: string;
  types: readonly CodexEntityType[];
}>;

export const KIND_GROUPS: readonly KindGroup[] = [
  { id: "people", label: "People", iconId: "person", types: ["character"] },
  { id: "places", label: "Places", iconId: "castle", types: ["location"] },
  { id: "factions", label: "Factions", iconId: "flag", types: ["faction", "religion"] },
  { id: "things", label: "Things", iconId: "sword", types: ["item"] },
  { id: "lore", label: "Lore", iconId: "sun", types: ["note", "event", "species"] }
];

export function kindGroupOf(type: CodexEntityType): KindGroup {
  return KIND_GROUPS.find((group) => group.types.includes(type)) ?? KIND_GROUPS[KIND_GROUPS.length - 1];
}
