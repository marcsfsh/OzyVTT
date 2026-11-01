import { describe, expect, it } from "vitest";
import { addedSince, firstWords, whatChanged, type PageShape } from "./versions";

const shape = (over: Partial<PageShape> = {}): PageShape => ({
  title: "Ysolde Varn",
  playerBody: "The harbourmaster of Saltmere.",
  blocks: [{ title: "The debt", text: "She owes the Tidebound." }],
  bannerAssetId: null,
  tags: ["saltmere"],
  ...over
});

describe("what changed between two versions", () => {
  it("names a rename, a block added or taken out, the text, the tags and the banner", () => {
    expect(whatChanged(shape(), shape({ title: "Ysolde the Harbourmaster" }))).toBe(
      "Renamed to Ysolde the Harbourmaster"
    );
    expect(
      whatChanged(shape(), shape({ blocks: [...shape().blocks, { title: "Lena's letters", text: "Weekly." }] }))
    ).toBe("Added Lena's letters");
    expect(whatChanged(shape(), shape({ blocks: [] }))).toBe("Took out The debt");
    expect(whatChanged(shape(), shape({ playerBody: "The harbourmaster." }))).toBe("Changed the text");
    expect(whatChanged(shape(), shape({ tags: ["saltmere", "coast"] }))).toBe("Changed the tags");
    expect(whatChanged(shape(), shape({ bannerAssetId: "b1" }))).toBe("Changed the banner");
  });

  it("joins several changes in one line, and says Saved when a revision carries none", () => {
    expect(whatChanged(shape(), shape({ title: "Ysolde", tags: [] }))).toBe("Renamed to Ysolde, changed the tags");
    expect(whatChanged(shape(), shape())).toBe("Saved");
  });

  it("reads a block's own text change as a change to the text", () => {
    expect(whatChanged(shape(), shape({ blocks: [{ title: "The debt", text: "She paid it." }] }))).toBe(
      "Changed the text"
    );
  });
});

describe("what was added since a version", () => {
  it("names each new block by its title and each new paragraph by its first words", () => {
    const now = shape({
      playerBody: "The harbourmaster of Saltmere.\n\nShe rings the tide bell at dusk every evening.",
      blocks: [...shape().blocks, { title: "Lena's letters", text: "Weekly." }]
    });
    expect(addedSince(shape(), now)).toEqual(["Lena's letters", '"She rings the tide bell…"']);
  });

  it("finds nothing when the page is as the version was", () => {
    expect(addedSince(shape(), shape())).toEqual([]);
  });

  it("cuts a long paragraph to its first words", () => {
    expect(firstWords("one two three")).toBe("one two three");
    expect(firstWords("one two three four five six")).toBe("one two three four five…");
  });
});
