import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE VENDORED MAGIC-ITEM SOURCE, PINNED.
 *
 * C5 vendored `magic-items.md` and verified its shape BY HAND at vendoring time. Nothing held it
 * afterwards, which is the gap this file closes: a re-vendor at a different upstream commit would
 * shift 258 item rows underneath C6's parser and every lane built on top of it, and the first
 * symptom would be a wrong item count in a browse list rather than a red test.
 *
 * So the assertions here are deliberately about the SOURCE and not about any bundle. C6 owns the
 * bundle guard (`magic-items.test.ts`); this one owns the input to it. When the two disagree, the
 * parser changed and one of them is the defect.
 *
 * THE DISCRIMINATOR IS THE CATEGORY WORD, NOT THE ITALICS - and that is the whole reason this test
 * asserts both counts separately. All 260 `####` entries in the A-Z section carry an italic second
 * line, INCLUDING the two embedded creature stat blocks, whose lines read `_Large Beast, Unaligned_`
 * and `_Medium Undead, Neutral Evil_`. A parser that separated items from creatures on "has an
 * italic line" would admit both creatures silently. What actually separates them is that 258 of 258
 * item lines open with one of nine category words. The 2 that do not are skipped BY NAME below,
 * with a count assertion beside them, never by a silent filter.
 */

const SOURCE = fileURLToPath(
  new URL("../sources/dnd-5e-srd-markdown/magic-items.md", import.meta.url)
);
const PROVENANCE = fileURLToPath(
  new URL("../sources/dnd-5e-srd-markdown/PROVENANCE.json", import.meta.url)
);

/** The nine category words an SRD magic-item type line opens with. C6's parser consumes this list. */
const CATEGORY_WORDS = [
  "Wondrous Item", "Weapon", "Potion", "Ring", "Armor", "Wand", "Staff", "Rod", "Scroll"
] as const;

/** The two embedded creature stat blocks in the A-Z run. Named, because a silent filter hides a parse bug. */
const NOT_ITEMS = ["Giant Fly", "Avatar of Death"] as const;

const raw = readFileSync(SOURCE, "utf8");
const lines = raw.split("\n");

interface Entry { name: string; typeLine: string; line: number }

const azHeadingIndex = lines.findIndex((l) => l.startsWith("## Magic Items A"));

/** Every `#### Name` from the A-Z heading onward, paired with its next non-blank line. */
const entries: Entry[] = [];
for (let i = azHeadingIndex; i < lines.length; i++) {
  if (!lines[i].startsWith("#### ")) continue;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  entries.push({ name: lines[i].slice(5).trim(), typeLine: (lines[j] ?? "").trim(), line: i + 1 });
}

const opensWithCategory = (typeLine: string): boolean => {
  const inner = typeLine.replace(/^_/, "").replace(/_$/, "");
  return CATEGORY_WORDS.some((word) => inner.startsWith(word));
};

const items = entries.filter((e) => opensWithCategory(e.typeLine));
const nonItems = entries.filter((e) => !opensWithCategory(e.typeLine));

describe("the vendored magic-item source", () => {
  it("is the exact file C5 vendored, byte for byte", () => {
    // The strongest pin available: a re-vendor at any other upstream commit fails here first,
    // naming the file, instead of shifting rows under a parser that reports a plausible number.
    expect(createHash("sha256").update(raw).digest("hex"))
      .toBe("96c71ad35dddf0e79e47ac3d7bbe96704b5209c1f6e1bf01d543080789e18e98");
    // 5015 is the `wc -l` count C5 recorded - i.e. newlines. The file ends with one, so splitting
    // on it yields a 5016th empty element; `lines` keeps that element because dropping it would
    // shift every line number this file asserts.
    expect(lines.length - 1).toBe(5015);
    expect(Buffer.byteLength(raw, "utf8")).toBe(244314);
  });

  it("is recorded in PROVENANCE.json as vendored, not as deliberately left out", () => {
    // C5 split a claim that had justified eight files on a reason true for only seven. The split is
    // the deliverable, so it is pinned: the file is listed, and it is NOT in the leftover sentence.
    const provenance = JSON.parse(readFileSync(PROVENANCE, "utf8")) as {
      files: string[]; notVendored: string; commit: string;
    };
    expect(provenance.files).toContain("magic-items.md");
    expect(provenance.notVendored).not.toContain("magic-items.md");
    expect(provenance.commit).toBe("1b4b99dcb786cdd1a2fb26f8acec1551191f1ca4");
  });

  it("opens its A-Z run at the line C6's parser starts from", () => {
    expect(azHeadingIndex + 1).toBe(578);
    expect(lines[azHeadingIndex]).toBe("## Magic Items A–Z");
    // Four `####` headings sit ABOVE the A-Z run and are rules subsections, not items - so a parser
    // that scans the whole file finds 264 and is wrong by exactly those four.
    expect(raw.split("\n").filter((l) => l.startsWith("#### ")).length).toBe(264);
  });

  it("carries 260 entries, of which 258 are items and 2 are creature stat blocks", () => {
    expect(entries.length).toBe(260);
    // Italics is TOTAL over all 260 and therefore useless as a discriminator - asserted so that a
    // future parser cannot quietly adopt it and admit two creatures as items.
    expect(entries.filter((e) => /^_.*_$/.test(e.typeLine))).toHaveLength(260);
    expect(items).toHaveLength(258);
    expect(nonItems.map((e) => e.name)).toEqual([...NOT_ITEMS]);
    expect(nonItems.map((e) => e.typeLine))
      .toEqual(["_Large Beast, Unaligned_", "_Medium Undead, Neutral Evil_"]);
  });

  it("distributes those 258 items over the nine categories C6 maps to slots", () => {
    const histogram: Record<string, number> = {};
    for (const entry of items) {
      const inner = entry.typeLine.replace(/^_/, "").replace(/_$/, "");
      const word = CATEGORY_WORDS.find((w) => inner.startsWith(w))!;
      histogram[word] = (histogram[word] ?? 0) + 1;
    }
    expect(histogram).toEqual({
      "Wondrous Item": 127, Weapon: 33, Potion: 24, Ring: 22, Armor: 19,
      Wand: 13, Staff: 12, Rod: 7, Scroll: 1
    });
    expect(Object.values(histogram).reduce((a, b) => a + b, 0)).toBe(258);
  });

  it("requires attunement on 140 of the 258", () => {
    expect(items.filter((e) => /requires attunement/i.test(e.typeLine))).toHaveLength(140);
  });
});
