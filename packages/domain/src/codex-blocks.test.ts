import { describe, expect, it } from "vitest";
import { assembleCodexBody, codexParagraphs, renderCodexBlock, splitCodexHiddenBlocks } from "./codex-blocks.js";

// The client places blocks by these rules and the server assembles by them, so both read one copy.
describe("codex paragraphs", () => {
  it("splits at blank lines and ignores the blank lines around the text", () => {
    const text = "\n\nOne line\nstill one\n\n  \t\nTwo\n\n\n";
    expect(codexParagraphs(text).map((span) => text.slice(span.start, span.end))).toEqual([
      "One line\nstill one",
      "Two"
    ]);
    expect(codexParagraphs("")).toEqual([]);
    expect(codexParagraphs(" \n\t\n")).toEqual([]);
  });
});

describe("assembling a body", () => {
  const text = "Ysolde keeps the inn.\n\nShe pours cheap ale.";

  it("is the player text byte for byte when no block is placed", () => {
    const odd = "\nFirst\n\n\n\nSecond  \n";
    expect(assembleCodexBody(odd, [])).toEqual({ body: odd, ranges: [] });
  });

  it("places blocks at their anchors and reports where each landed", () => {
    const { body, ranges } = assembleCodexBody(text, [
      { anchor: 0, title: null, text: "Top." },
      { anchor: 1, title: "Debts", text: "She owes the Order." },
      { anchor: 2, title: null, text: "End." }
    ]);
    expect(body).toBe(
      "Top.\n\nYsolde keeps the inn.\n\n## Debts\n\nShe owes the Order.\n\nShe pours cheap ale.\n\nEnd."
    );
    expect(ranges.map((range) => range && body.slice(range.start, range.end))).toEqual([
      "Top.",
      "## Debts\n\nShe owes the Order.",
      "End."
    ]);
  });

  it("joins the text cleanly around a block left out, so nothing marks where it was", () => {
    const shown = { anchor: 1, title: null, text: "Shown first." };
    const later = { anchor: 1, title: null, text: "Shown second." };
    expect(assembleCodexBody(text, [shown, later]).body).toBe(
      "Ysolde keeps the inn.\n\nShown first.\n\nShown second.\n\nShe pours cheap ale."
    );
  });

  it("reads an anchor past the end as the end, and skips a block with nothing in it", () => {
    const { body, ranges } = assembleCodexBody("Only.\n\n", [
      { anchor: 9, title: null, text: "  \n" },
      { anchor: 9, title: null, text: "\n\nAfter.\n" }
    ]);
    expect(body).toBe("Only.\n\nAfter.");
    expect(ranges[0]).toBeNull();
  });

  it("starts an empty text with the block itself", () => {
    expect(assembleCodexBody("", [{ anchor: 0, title: "Clue", text: "" }]).body).toBe("## Clue");
    expect(renderCodexBlock({ title: "  ", text: "Plain." })).toBe("Plain.");
  });
});

describe("splitting an old GM body into hidden blocks", () => {
  it("makes one block per level 2 heading and one for the text before the first", () => {
    expect(
      splitCodexHiddenBlocks("Opening note.\n\n## Secrets\nShe is a spy.\n\n### Detail\nStill secrets.\n## Plans\n")
    ).toEqual([
      { title: null, text: "Opening note." },
      { title: "Secrets", text: "She is a spy.\n\n### Detail\nStill secrets." },
      { title: "Plans", text: "" }
    ]);
    expect(splitCodexHiddenBlocks("## Only heading\nText")).toEqual([{ title: "Only heading", text: "Text" }]);
    expect(splitCodexHiddenBlocks("  \n\n")).toEqual([]);
  });
});
