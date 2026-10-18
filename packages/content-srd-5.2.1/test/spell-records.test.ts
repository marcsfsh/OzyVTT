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

describe("a spell card's text, kept to its own spell", () => {
  it("carries no heading of the next section, as the source's Tsunami did", () => {
    for (const record of loadSpells()) expect(record.description, record.id).not.toContain("###");
    expect(spell("tsunami").description).toMatch(/A creature that moves out of the wall falls to the ground\.$/);
  });
});

describe("a spell's map template", () => {
  it("covers the area the text gives a wall or a storm", () => {
    expect(spell("storm-of-vengeance").area).toEqual({ shape: "cylinder", sizeFeet: 300, widthFeet: null });
    expect(spell("tsunami").area).toEqual({ shape: "line", sizeFeet: 300, widthFeet: 50 });
    expect(spell("wind-wall").area).toEqual({ shape: "line", sizeFeet: 50, widthFeet: 5 });
    expect(spell("wall-of-ice").area).toEqual({ shape: "line", sizeFeet: 100, widthFeet: 5 });
  });
});

describe("a spell's higher-slot rows", () => {
  const rolls = (id: string) =>
    Object.fromEntries(
      spell(id)
        .castingOptions.filter((option) => option.type.startsWith("slot_level_"))
        .map((option) => [Number(option.type.slice("slot_level_".length)), option.damageRoll])
    );

  it("prints Conjure Celestial's healing as the total at each level", () => {
    expect(rolls("conjure-celestial")).toEqual({ 8: "5d12", 9: "6d12" });
  });

  it("prints each row as the text's base dice plus the increase, never the increase alone", () => {
    // "The damage increases by 1d6 for each spell slot level above 3": a row's dice less the increases it adds name
    // dice the card prints, the spell's own.
    const increase = /increases? by (\d+)d(\d+)\b[^.]*?for (?:each|every) (?:spell )?slot level above (\d)/;
    let checked = 0;
    for (const record of loadSpells()) {
      const match = increase.exec(record.higherLevel ?? "");
      if (!match) continue;
      const [perLevel, die, above] = [Number(match[1]), Number(match[2]), Number(match[3])];
      for (const option of record.castingOptions) {
        const dice = /^(\d+)d(\d+)\b/.exec(option.damageRoll ?? "");
        if (!option.type.startsWith("slot_level_") || !dice || Number(dice[2]) !== die) continue;
        const level = Number(option.type.slice("slot_level_".length));
        const base = Number(dice[1]) - perLevel * (level - above);
        expect(record.description, `${record.id} at level ${level}`).toContain(`${base}d${die}`);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(200);
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

describe("what a spell card says a cast rolls", () => {
  it("marks an attack roll only where the caster makes a spell attack, now or on a later turn", () => {
    for (const id of ["fire-bolt", "guiding-bolt", "spiritual-weapon", "arcane-hand", "flame-blade"])
      expect(spell(id).attackRoll, id).toBe(true);
    // Each only mentions attack rolls: other creatures', or ones against the target.
    for (const id of ["shining-smite", "bless", "faerie-fire", "hunters-mark", "vicious-mockery"])
      expect(spell(id).attackRoll, id).toBe(false);
  });

  it("asks for Searing Smite's save at the start of the target's turns, not when it is cast", () => {
    expect(spell("searing-smite").save?.ability).toBe("con");
    expect(spell("searing-smite").effect).toMatchObject({
      noCastSave: true,
      damage: [{ formula: "1d6", type: "fire" }]
    });
  });
});
