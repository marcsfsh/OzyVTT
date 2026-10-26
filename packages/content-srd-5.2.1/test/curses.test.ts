import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions, loadSpells } from "../src/index.js";

// SRD 5.2.1 Curses: "Curses can be removed by the Remove Curse and Greater Restoration spells", which end what carries
// the `curse` tag. So every effect a text calls a curse must carry it, or neither spell can end it.

/** A sentence that leaves a curse on its target ("The target is cursed", "become cursed", "place a curse on"). */
const CURSES = /\b(?:is|becomes?) cursed\b|\bplace a curse on\b/i;

/** Every effect tag anywhere in a record's mechanics. */
function tagsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const entry of value) tagsIn(entry, into);
  else if (value !== null && typeof value === "object")
    for (const [key, entry] of Object.entries(value)) {
      if (key !== "tags" || !Array.isArray(entry)) tagsIn(entry, into);
      else for (const tag of entry) into.add(String(tag));
    }
  return into;
}

describe("curses", () => {
  it("tags every stat block action whose text curses its target", () => {
    const cursing = loadMonsterDefinitions().flatMap((monster) =>
      monster.actions
        .filter((action) => CURSES.test(action.description))
        .map((action) => ({ where: `${monster.name}: ${action.name}`, tagged: tagsIn(action).has("curse") }))
    );
    expect(cursing.map(({ where }) => where)).toEqual(
      expect.arrayContaining([
        "Lamia: Corrupting Touch",
        "Werewolf: Bite (Wolf or Hybrid Form Only)",
        "Werebear: Bite (Bear or Hybrid Form Only)",
        "Wereboar: Gore (Boar or Hybrid Form Only)",
        "Wererat: Bite (Rat or Hybrid Form Only)",
        "Weretiger: Bite (Tiger or Hybrid Form Only)",
        "Mummy: Rotting Fist"
      ])
    );
    expect(cursing.filter(({ tagged }) => !tagged).map(({ where }) => where)).toEqual([]);
  });

  it("tags every stat block trait whose text curses a creature", () => {
    const untagged = loadMonsterDefinitions().flatMap((monster) =>
      (monster.traitMechanics ?? [])
        .filter((trait) => {
          const printed = (
            monster.extensions["open5e.srd-2024"] as { traits?: Array<{ name: string; description: string }> }
          )?.traits?.find((entry) => entry.name === trait.name);
          return printed !== undefined && CURSES.test(printed.description);
        })
        .filter((trait) => !tagsIn(trait).has("curse"))
        .map((trait) => `${monster.name}: ${trait.name}`)
    );
    expect(untagged).toEqual([]);
  });

  it("tags every spell whose text curses its target", () => {
    const cursing = loadSpells().filter((spell) => CURSES.test(spell.description));
    expect(cursing.map((spell) => spell.id)).toEqual(expect.arrayContaining(["bestow-curse", "hex"]));
    expect(cursing.filter((spell) => !tagsIn(spell.effect).has("curse")).map((spell) => spell.id)).toEqual([]);
  });
});
