import { describe, expect, it } from "vitest";
import { articleFor, countOf, withArticle } from "./words.js";

describe("articles", () => {
  it("takes an before a vowel sound", () => {
    expect(withArticle("Intelligence check")).toBe("an Intelligence check");
    expect(withArticle("Arcana check")).toBe("an Arcana check");
    expect(withArticle("INT save")).toBe("an INT save");
    expect(withArticle("otherworldly patron")).toBe("an otherworldly patron");
    expect(withArticle("hour")).toBe("an hour");
  });

  it("takes a before a consonant sound", () => {
    expect(withArticle("Wisdom (Perception) check")).toBe("a Wisdom (Perception) check");
    expect(withArticle("DEX save")).toBe("a DEX save");
    expect(withArticle("unique item")).toBe("a unique item");
    expect(withArticle("one-handed weapon")).toBe("a one-handed weapon");
    expect(articleFor("Strength saving throw")).toBe("a");
  });
});

describe("counts", () => {
  it("names one thing in the singular and others in the plural", () => {
    expect(countOf(1, "page")).toBe("1 page");
    expect(countOf(0, "page")).toBe("0 pages");
    expect(countOf(2, "journal entry", "journal entries")).toBe("2 journal entries");
  });
});
