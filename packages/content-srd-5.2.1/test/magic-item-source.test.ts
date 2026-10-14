import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Pins the vendored `magic-items.md` so a re-vendor cannot silently shift rows under the parser.
 * `magic-items.test.ts` guards the generated bundle; this guards its input.
 *
 * Items are separated from the two embedded creature stat blocks by the category word, not by
 * italics: every entry, creatures included, has an italic second line.
 */

const SOURCE = fileURLToPath(
  new URL("../sources/dnd-5e-srd-markdown/magic-items.md", import.meta.url)
);
const PROVENANCE = fileURLToPath(
  new URL("../sources/dnd-5e-srd-markdown/PROVENANCE.json", import.meta.url)
);

/** The nine category words an SRD magic-item type line opens with. */
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
    expect(createHash("sha256").update(raw).digest("hex"))
      .toBe("96c71ad35dddf0e79e47ac3d7bbe96704b5209c1f6e1bf01d543080789e18e98");
    // `wc -l` counts newlines; the trailing newline yields one extra empty element in `lines`.
    expect(lines.length - 1).toBe(5015);
    expect(Buffer.byteLength(raw, "utf8")).toBe(244314);
  });

  it("is recorded in PROVENANCE.json as vendored, not as deliberately left out", () => {
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
    // Four `####` rules subsections sit above the A-Z run.
    expect(raw.split("\n").filter((l) => l.startsWith("#### ")).length).toBe(264);
  });

  it("carries 260 entries, of which 258 are items and 2 are creature stat blocks", () => {
    expect(entries.length).toBe(260);
    // Italics are present on all 260, so they cannot discriminate items from creatures.
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
