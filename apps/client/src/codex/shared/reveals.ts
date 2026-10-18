import { pageLinkKey } from "@vtt/domain";
import type { CodexBlock } from "@vtt/domain";

/** When the block reached the audience it has now: the earliest stamp among the readers it is shown to. */
export function stampOf(block: CodexBlock) {
  const audiences = block.audience === "everyone" ? ["everyone"] : block.characterIds;
  return block.reveals.find((reveal) => audiences.includes(reveal.to)) ?? null;
}

/** A sentence about the pages a block links and whether its readers can open them. */
export function linksSentence(
  text: string,
  pages: ReadonlyArray<Readonly<{ title: string; revealedToPlayers: boolean }>>
) {
  const titles = [...text.matchAll(/\[\[([^\]#|]+)(?:#[^\]]*)?\]\]/g)]
    .map((match) => match[1].trim())
    .filter((title, index, all) => title && all.indexOf(title) === index);
  if (titles.length === 0) return null;
  const known = new Map(pages.map((page) => [pageLinkKey(page.title), page]));
  const open = titles.filter((title) => known.get(pageLinkKey(title))?.revealedToPlayers);
  const closed = titles.filter((title) => !known.get(pageLinkKey(title))?.revealedToPlayers);
  const list = (names: readonly string[]) =>
    names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const parts: string[] = [];
  if (open.length > 0) parts.push(`The links go to ${list(open)}, which everyone can already see.`);
  if (closed.length > 0)
    parts.push(
      `${list(closed)} ${closed.length === 1 ? "is" : "are"} Hidden, so players read ${closed.length === 1 ? "that name" : "those names"} as plain text.`
    );
  return parts.join(" ");
}
