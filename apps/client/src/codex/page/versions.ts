import { codexParagraphs } from "@vtt/domain";

/**
 * What a version of a page holds, as far as a revision carries it: its title, player text, blocks, banner and tags.
 * A change to a field or to who sees a block is not in a revision, so it reads as "Saved".
 */
export type PageShape = Readonly<{
  title: string;
  playerBody: string;
  blocks: ReadonlyArray<Readonly<{ title: string | null; text: string }>>;
  bannerAssetId: string | null;
  tags: readonly string[];
}>;

const blockName = (block: Readonly<{ title: string | null; text: string }>) =>
  block.title?.trim() || `the block "${firstWords(block.text)}"`;

/** A paragraph's first few words, for naming it in a line. */
export function firstWords(text: string, count = 5): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
}

/**
 * What changed from one version to the next newer one (or to the page now), in a line: renamed, added or took out a
 * block (by its title), changed the text, the tags or the banner. Nothing a revision carries changed reads "Saved".
 */
export function whatChanged(older: PageShape, newer: PageShape): string {
  const parts: string[] = [];
  if (older.title.trim() !== newer.title.trim()) parts.push(`Renamed to ${newer.title.trim() || "Untitled"}`);
  const olderNames = older.blocks.map(blockName);
  const newerNames = newer.blocks.map(blockName);
  const added = newer.blocks.filter((block) => !olderNames.includes(blockName(block)));
  const taken = older.blocks.filter((block) => !newerNames.includes(blockName(block)));
  for (const block of added) parts.push(`Added ${blockName(block)}`);
  for (const block of taken) parts.push(`Took out ${blockName(block)}`);
  const sameBlocksChanged = newer.blocks.some((block) => {
    const before = older.blocks.find((candidate) => blockName(candidate) === blockName(block));
    return before !== undefined && before.text.trim() !== block.text.trim();
  });
  if (older.playerBody.trim() !== newer.playerBody.trim() || sameBlocksChanged) parts.push("Changed the text");
  const tagsBefore = [...older.tags].sort().join(",");
  if (tagsBefore !== [...newer.tags].sort().join(",")) parts.push("Changed the tags");
  if (older.bannerAssetId !== newer.bannerAssetId) parts.push("Changed the banner");
  if (parts.length === 0) return "Saved";
  const [first, ...rest] = parts;
  return [first, ...rest.map((part) => part.charAt(0).toLowerCase() + part.slice(1))].join(", ");
}

/**
 * What the page now has that a version does not: each block (by its title) and each paragraph of player text, named
 * for the "Added since" line.
 */
export function addedSince(version: PageShape, now: PageShape): readonly string[] {
  const names = version.blocks.map(blockName);
  const blocks = now.blocks.filter((block) => !names.includes(blockName(block))).map(blockName);
  const paragraphsThen = new Set(
    codexParagraphs(version.playerBody).map((paragraph) =>
      version.playerBody.slice(paragraph.start, paragraph.end).trim()
    )
  );
  const paragraphs = codexParagraphs(now.playerBody)
    .map((paragraph) => now.playerBody.slice(paragraph.start, paragraph.end).trim())
    .filter((text) => text && !paragraphsThen.has(text))
    .map((text) => `"${firstWords(text)}"`);
  return [...blocks, ...paragraphs];
}
