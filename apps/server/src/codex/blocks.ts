import { createHash } from "node:crypto";
import {
  codexParagraphs,
  splitCodexHiddenBlocks,
  type CodexAudience,
  type CodexBlock,
  type CodexBlockContentRow,
  type CodexBlockReveal,
  type CodexCalendar,
  type CodexInWorldDate
} from "@vtt/domain";
import { inWorldLabel } from "./calendar.js";
import { freshId } from "./db.js";
import type { CodexLinkSource } from "./links.js";
import {
  CodexNotFoundError,
  CodexValidationError,
  MAX_BLOCKS,
  anchor,
  audience,
  blockText,
  blockTitle
} from "./validate.js";

/**
 * Hidden blocks: markdown placed in a page's or quest's player text, each with its own audience and the stamps of
 * when it reached each one. They are stored as one JSON list on their record, in document order. Everything here
 * is pure list work; the record modules write the result and what derives from it.
 */

/** A reveal stamp as stored; its label is derived from the live calendar when read. */
export type StoredReveal = Readonly<{
  to: string;
  at: string;
  sessionId: string | null;
  /** The session's number when stamped, kept for a session deleted since. */
  sessionNumber: number | null;
  inWorldDate: CodexInWorldDate | null;
}>;
export type StoredBlock = Readonly<{
  id: string;
  anchor: number;
  title: string | null;
  text: string;
  audience: CodexAudience;
  characterIds: readonly string[];
  reveals: readonly StoredReveal[];
}>;
/** A new block's content, as create and add take it. */
export type CodexBlockInput = Readonly<{ title?: string | null; text: string; anchor?: number }>;
/** Where a block sits: every block of a record, in document order. */
export type CodexBlockPlacement = Readonly<{ id: string; anchor: number }>;

/** The audience keys a block reaches: `everyone`, or each of its characters. */
export function audienceKeys(block: Pick<StoredBlock, "audience" | "characterIds">): string[] {
  if (block.audience === "everyone") return ["everyone"];
  return block.audience === "characters" ? [...block.characterIds] : [];
}

/** Whether a reader holding `characterIds` may read something with this audience. */
export function audienceReaches(
  target: Readonly<{ audience: CodexAudience; characterIds: readonly string[] }>,
  characterIds: ReadonlySet<string>
): boolean {
  if (target.audience === "everyone") return true;
  return target.audience === "characters" && target.characterIds.some((id) => characterIds.has(id));
}

/** Some audience a block reaches has no stamp yet, so the next reveal pass has work on its record. */
export function blocksPending(blocks: readonly StoredBlock[]): boolean {
  return blocks.some((block) => audienceKeys(block).some((key) => !block.reveals.some((reveal) => reveal.to === key)));
}

// Stored JSON, read defensively: a malformed block is dropped and a malformed audience reads as hidden.

const isString = (value: unknown): value is string => typeof value === "string";
function readDate(value: unknown): CodexInWorldDate | null {
  if (!value || typeof value !== "object") return null;
  const date = value as Record<string, unknown>;
  return [date.year, date.month, date.day].every((part) => Number.isSafeInteger(part))
    ? { year: date.year as number, month: date.month as number, day: date.day as number }
    : null;
}
function readReveal(value: unknown): StoredReveal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isString(raw.to) || !isString(raw.at)) return null;
  return {
    to: raw.to,
    at: raw.at,
    sessionId: isString(raw.sessionId) ? raw.sessionId : null,
    sessionNumber: Number.isSafeInteger(raw.sessionNumber) ? (raw.sessionNumber as number) : null,
    inWorldDate: readDate(raw.inWorldDate)
  };
}
function readBlock(value: unknown): StoredBlock | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isString(raw.id) || !isString(raw.text)) return null;
  const ids = Array.isArray(raw.characterIds) ? raw.characterIds.filter(isString) : [];
  const shown =
    raw.audience === "everyone"
      ? { audience: "everyone" as const, characterIds: [] }
      : raw.audience === "characters" && ids.length > 0
        ? { audience: "characters" as const, characterIds: ids }
        : { audience: "hidden" as const, characterIds: [] };
  return {
    id: raw.id,
    anchor: Number.isSafeInteger(raw.anchor) && (raw.anchor as number) >= 0 ? (raw.anchor as number) : 0,
    title: isString(raw.title) ? raw.title : null,
    text: raw.text,
    ...shown,
    reveals: Array.isArray(raw.reveals) ? raw.reveals.map(readReveal).filter((reveal) => reveal !== null) : []
  };
}
export function parseBlocks(raw: string | null | undefined): StoredBlock[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(readBlock).filter((block) => block !== null) : [];
  } catch {
    return [];
  }
}
export function serializeBlocks(blocks: readonly StoredBlock[]): string {
  return JSON.stringify(blocks);
}

/** What labels a stamp as it is read: the live calendar and each session's current number. */
export type StampReader = Readonly<{ calendar: CodexCalendar; sessionNumbers: ReadonlyMap<string, number | null> }>;

/** A stored stamp in its wire form: the session's number now, or the one it had if it is gone. */
export function stampOf(
  reveal: StoredReveal,
  reader: StampReader
): Omit<CodexBlockReveal, "to"> & Readonly<{ to: string }> {
  const live = reveal.sessionId !== null ? reader.sessionNumbers.get(reveal.sessionId) : undefined;
  return {
    to: reveal.to,
    at: reveal.at,
    sessionId: reveal.sessionId,
    sessionNumber: live === undefined ? reveal.sessionNumber : live,
    inWorldDate: reveal.inWorldDate,
    inWorldLabel: reveal.inWorldDate ? inWorldLabel(reader.calendar, reveal.inWorldDate) : null
  };
}
export function toWireBlocks(blocks: readonly StoredBlock[], reader: StampReader): CodexBlock[] {
  return blocks.map((block) => ({
    id: block.id,
    anchor: block.anchor,
    title: block.title,
    text: block.text,
    audience: block.audience,
    characterIds: [...block.characterIds],
    reveals: block.reveals.map((reveal) => stampOf(reveal, reader))
  }));
}
/** Back from the wire, as a backup carries blocks: the label is derived again on read. */
export function fromWireBlocks(blocks: readonly CodexBlock[]): StoredBlock[] {
  return parseBlocks(JSON.stringify(blocks.map((block) => ({ ...block }))));
}
/** A revision keeps content and place only. */
export function blockContents(blocks: readonly StoredBlock[]): CodexBlockContentRow[] {
  return blocks.map((block) => ({ id: block.id, anchor: block.anchor, title: block.title, text: block.text }));
}

// List work. Every function returns a new list in document order: by anchor, ties in their stored order.

function sorted(blocks: readonly StoredBlock[]): StoredBlock[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => a.block.anchor - b.block.anchor || a.index - b.index)
    .map(({ block }) => block);
}

/** Anchors past the end of the player text read as the end, and are stored that way when the text changes. */
export function clampAnchors(blocks: readonly StoredBlock[], playerText: string): StoredBlock[] {
  const count = codexParagraphs(playerText).length;
  return sorted(blocks.map((block) => (block.anchor > count ? { ...block, anchor: count } : block)));
}

/** New hidden blocks from content, placed after the player text unless an anchor says otherwise. */
export function newBlocks(inputs: readonly CodexBlockInput[], playerText: string): StoredBlock[] {
  if (inputs.length > MAX_BLOCKS) throw new CodexValidationError(`A record holds at most ${MAX_BLOCKS} blocks.`);
  const end = codexParagraphs(playerText).length;
  return clampAnchors(
    inputs.map((input) => ({
      id: freshId(),
      anchor: anchor(input.anchor, end),
      title: blockTitle(input.title),
      text: blockText(input.text),
      audience: "hidden",
      characterIds: [],
      reveals: []
    })),
    playerText
  );
}

function indexOf(blocks: readonly StoredBlock[], blockId: string): number {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index === -1) throw new CodexNotFoundError("That block no longer exists.");
  return index;
}

/** `block` placed at its anchor, `slot` places among the blocks already there (default: last). */
export function placeBlock(blocks: readonly StoredBlock[], block: StoredBlock, slotAt: number | null): StoredBlock[] {
  const others = sorted(blocks.filter((existing) => existing.id !== block.id));
  const sameAnchor = others.filter((existing) => existing.anchor === block.anchor);
  const before = Math.min(slotAt ?? sameAnchor.length, sameAnchor.length);
  // Insert after the `before`-th block at this anchor, or before the first block past it.
  let at = others.findIndex((existing) => existing.anchor > block.anchor);
  if (at === -1) at = others.length;
  if (before < sameAnchor.length) at = others.indexOf(sameAnchor[before]!);
  return [...others.slice(0, at), block, ...others.slice(at)];
}

export function addBlock(
  blocks: readonly StoredBlock[],
  input: CodexBlockInput,
  slotAt: number | null,
  playerText: string
): { blocks: StoredBlock[]; block: StoredBlock } {
  if (blocks.length >= MAX_BLOCKS) throw new CodexValidationError(`A record holds at most ${MAX_BLOCKS} blocks.`);
  const [block] = newBlocks([input], playerText);
  return { blocks: placeBlock(blocks, block!, slotAt), block: block! };
}

export function editBlock(
  blocks: readonly StoredBlock[],
  blockId: string,
  input: Readonly<{ title?: string | null; text?: string }>
): StoredBlock[] {
  const index = indexOf(blocks, blockId);
  const block = blocks[index]!;
  const next: StoredBlock = {
    ...block,
    title: input.title === undefined ? block.title : blockTitle(input.title),
    text: input.text === undefined ? block.text : blockText(input.text)
  };
  return blocks.map((existing, at) => (at === index ? next : existing));
}

export function moveBlock(
  blocks: readonly StoredBlock[],
  blockId: string,
  anchorAt: number,
  slotAt: number | null,
  playerText: string
): StoredBlock[] {
  const block = blocks[indexOf(blocks, blockId)]!;
  const count = codexParagraphs(playerText).length;
  return placeBlock(blocks, { ...block, anchor: Math.min(anchor(anchorAt, count), count) }, slotAt);
}

/** Leaves the list alone for an id it does not hold, so a repeated delete is no error. */
export function removeBlock(blocks: readonly StoredBlock[], blockId: string): StoredBlock[] {
  return blocks.filter((block) => block.id !== blockId);
}

/** A new audience; the stamps stay, so showing a block again keeps the first time it was shown. */
export function setBlockAudience(
  blocks: readonly StoredBlock[],
  blockId: string,
  value: string,
  characterIds: readonly string[] | null | undefined
): StoredBlock[] {
  const index = indexOf(blocks, blockId);
  const shown = audience(value, characterIds);
  return blocks.map((block, at) => (at === index ? { ...block, ...shown } : block));
}

/** The editor's whole layout: every block exactly once, in document order, each with its anchor. */
export function applyLayout(
  blocks: readonly StoredBlock[],
  layout: readonly CodexBlockPlacement[],
  playerText: string
): StoredBlock[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const listed = new Set(layout.map((placement) => placement.id));
  if (listed.size !== layout.length || listed.size !== blocks.length || layout.some((place) => !byId.has(place.id)))
    throw new CodexValidationError("The layout must list every block of this record exactly once.");
  const count = codexParagraphs(playerText).length;
  let previous = 0;
  return layout.map((placement) => {
    const at = Math.min(anchor(placement.anchor, count), count);
    if (at < previous) throw new CodexValidationError("The layout must list the blocks in document order.");
    previous = at;
    return { ...byId.get(placement.id)!, anchor: at };
  });
}

/**
 * Keeps each block beside the same paragraph when the player text changes. The paragraphs before and after the
 * changed stretch are matched; a block inside the stretch moves to just after its new text.
 */
export function rebaseAnchors(blocks: readonly StoredBlock[], before: string, after: string): StoredBlock[] {
  if (before === after || blocks.length === 0) return clampAnchors(blocks, after);
  const paragraphsOf = (text: string) => codexParagraphs(text).map((span) => text.slice(span.start, span.end));
  const old = paragraphsOf(before);
  const next = paragraphsOf(after);
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) head += 1;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail += 1;
  const shift = next.length - old.length;
  return sorted(
    blocks.map((block) => {
      const at = Math.min(block.anchor, old.length);
      if (at <= head) return { ...block, anchor: at };
      if (at >= old.length - tail) return { ...block, anchor: at + shift };
      return { ...block, anchor: next.length - tail };
    })
  );
}

/**
 * A restore never shows players anything new: a block keeps its audience only while its title and text are the
 * ones it holds now. Every other block comes back hidden. Stamps stay with the block's id.
 */
export function restoreBlocks(
  current: readonly StoredBlock[],
  restored: readonly CodexBlockContentRow[]
): StoredBlock[] {
  const now = new Map(current.map((block) => [block.id, block]));
  return restored.map((content) => {
    const existing = now.get(content.id);
    const unchanged = existing !== undefined && existing.title === content.title && existing.text === content.text;
    return {
      id: content.id,
      anchor: content.anchor,
      title: content.title,
      text: content.text,
      audience: unchanged ? existing.audience : "hidden",
      characterIds: unchanged ? existing.characterIds : [],
      reveals: existing?.reveals ?? []
    };
  });
}

/**
 * An old single GM body as hidden blocks after the player text. Ids derive from the record and the section, so
 * a page and its revisions, or one backup restored twice, give an unchanged section the same id.
 */
export function blocksFromGmBody(ownerId: string, playerText: string, gmBody: string): StoredBlock[] {
  const end = codexParagraphs(playerText).length;
  const seen = new Map<string, number>();
  return splitCodexHiddenBlocks(gmBody).map((section) => {
    const key = `${section.title ?? ""}\n${section.text}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      id: derivedId(`${ownerId}\nblock\n${key}\n${occurrence}`),
      anchor: end,
      title: section.title,
      text: section.text.slice(0, 100_000),
      audience: "hidden",
      characterIds: [],
      reveals: []
    };
  });
}

/**
 * Old GM field values that sat beside a different value players read, as one hidden block after the player text,
 * one `key: value` line each. The page keeps one value per field now, and the players' one stays.
 */
export function blocksFromGmFields(
  ownerId: string,
  playerText: string,
  values: Readonly<Record<string, string>>
): StoredBlock[] {
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${value}`);
  if (lines.length === 0) return [];
  return [
    {
      id: derivedId(`${ownerId}\nfields`),
      anchor: codexParagraphs(playerText).length,
      title: "GM field values",
      text: lines.join("\n\n"),
      audience: "hidden",
      characterIds: [],
      reveals: []
    }
  ];
}

/** A UUID (version 5 layout) from a seed, for ids an upgrade must give the same way twice. */
export function derivedId(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The text a block contributes to links and search: its title over its text. */
export function blockSourceText(block: Pick<StoredBlock, "title" | "text">): string {
  return block.title ? `${block.title}\n${block.text}` : block.text;
}

/** A record's text for `[[link]]` mentions: the player text, then each block in the layer its audience gives it. */
export function linkSources(playerText: string, blocks: readonly StoredBlock[]): CodexLinkSource[] {
  return [
    { text: playerText, layer: "player" },
    ...blocks.map((block): CodexLinkSource => ({
      text: blockSourceText(block),
      layer: block.audience === "everyone" ? "player" : "gm",
      characterIds: block.audience === "characters" ? block.characterIds : []
    }))
  ];
}
