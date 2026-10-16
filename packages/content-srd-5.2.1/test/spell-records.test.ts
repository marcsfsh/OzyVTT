import { describe, expect, it } from "vitest";
import { loadSpells } from "../src/index.js";

// The spell cards read as the SRD 5.2.1 spells chapter prints them, where the open5e source truncated or misread it.

const spell = (id: string) => loadSpells().find((record) => record.id === id)!;

describe("a spell card's text", () => {
  it("keeps the paragraphs and options the source dropped", () => {
    expect(spell("moonbeam").description).toMatch(/^A silvery beam of pale light shines down in a 5-foot-radius/);
    expect(spell("dispel-evil-and-good").description).toContain("**Dismissal.**");
    expect(spell("command").description).toContain("**Approach.**");
    expect(spell("conjure-celestial").description).toContain("**Searing Light.**");
    expect(spell("knock").description).toMatch(/^Choose an object that you can see within range/);
    expect(spell("dissonant-whispers").higherLevel).toBe(
      "The damage increases by 1d6 for each spell slot level above 1."
    );
  });
});

describe("a spell card's header", () => {
  it("prints casting times in the SRD's words, including the long ones the source shortened", () => {
    expect(spell("fire-bolt").castingTime).toBe("Action");
    expect(spell("healing-word").castingTime).toBe("Bonus Action");
    expect(spell("alarm").castingTime).toBe("1 minute");
    expect(spell("prayer-of-healing").castingTime).toBe("10 minutes");
    expect(spell("hallow").castingTime).toBe("24 hours");
  });

  it("marks a material consumed only when the spell consumes it", () => {
    expect(spell("bless").components.materialConsumed).toBe(false);
    expect(spell("identify").components.materialConsumed).toBe(false);
    expect(spell("revivify").components.materialConsumed).toBe(true);
    expect(spell("jump").components.materialText).toBe("a grasshopper's hind leg");
  });
});
