import { describe, expect, it } from "vitest";
import { loadSpells, type SpellReference } from "@vtt/content-srd-5.2.1";
import type { ActorAction } from "@vtt/schemas";
import { laterSpellAction, spellCastMechanics, upcastAction } from "../src/item-actions.js";

// SRD 5.2.1 "Using a Higher-Level Spell Slot": every part a spell's higher-level text names scales with the slot,
// whether it is the cast's own damage, a later action's, a zone's or a grant's extra damage.

const spells = loadSpells();
const spell = (id: string) => spells.find((entry) => entry.id === id)!;
const NUMBERS = { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 4 };

const castAt = (record: SpellReference, level: number): ActorAction => {
  const built: ActorAction = {
    id: `spell-${record.id}`,
    name: record.name,
    activation: "action",
    description: record.name,
    spellId: record.id,
    ...spellCastMechanics(record, NUMBERS)
  };
  return level > record.level ? upcastAction(built, record, level) : built;
};
const laterAt = (record: SpellReference, name: string, level: number): ActorAction => {
  const row = record.effect!.laterActions!.find((entry) => entry.name === name)!;
  const built = laterSpellAction(record, row, NUMBERS);
  return level > record.level ? upcastAction(built, record, level) : built;
};
const extraDamageOf = (action: ActorAction): string[] =>
  [
    ...(action.grants?.modifiers ?? []),
    ...(action.grants?.options ?? []).flatMap((option) => option.modifiers ?? [])
  ].flatMap((modifier) => (modifier.type === "extra-damage" && modifier.formula ? [modifier.formula] : []));

describe("per-part upcast scaling", () => {
  it("adds 2d8 to the Clenched Fist and 2d6 to the crush for each slot level above 5", () => {
    const hand = spell("arcane-hand");
    expect(laterAt(hand, "clenched fist", 5).damage[0]!.formula).toBe("5d8");
    expect(laterAt(hand, "clenched fist", 7).damage[0]!.formula).toBe("9d8");
    expect(laterAt(hand, "crush", 7).damage[0]!.formula).toBe("8d6 + 4");
  });

  it("adds 1d8 to the explosive rune for each slot level above 3", () => {
    expect(laterAt(spell("glyph-of-warding"), "explosive rune", 5).damage[0]!.formula).toBe("7d8");
  });

  it("adds 1d8 to Conjure Minor Elementals' extra damage for each slot level above 4", () => {
    const elementals = spell("conjure-minor-elementals");
    expect(new Set(extraDamageOf(castAt(elementals, 4)))).toEqual(new Set(["2d8"]));
    expect(new Set(extraDamageOf(castAt(elementals, 6)))).toEqual(new Set(["4d8"]));
  });
});

/** Clauses of a higher-level text that a reader other than the damage dice handles, by spell, with the field that
 *  reads them. A new spell whose clause isn't damage, targets or Hit Points fails until it is reviewed here. */
const READ_ELSEWHERE: Readonly<Record<string, (record: SpellReference) => boolean>> = {
  // The longer duration by slot (`spellDurationAt`).
  geas: () => true,
  hex: () => true,
  "hunters-mark": () => true,
  "magic-circle": () => true,
  // The barrier's level by slot (`zone-barriers.ts` reads the zone's level).
  "globe-of-invulnerability": () => true,
  // The bonus by slot (`bindsWeapon.bonusBySlot`).
  "magic-weapon": (record) => (record.effect?.grant?.bindsWeapon?.bonusBySlot?.length ?? 0) > 0,
  // Three more willing creatures a slot level (`targets.perSlot` caps one or two, so the count is checked at the cast).
  etherealness: () => true,
  // The spell glyph's stored spell may be of the slot's level (`stored-casts.ts`).
  "glyph-of-warding": () => true,
  // The Cube grows 5 feet a slot level (`areaPerSlot`); the gallons are the GM's.
  "create-or-destroy-water": (record) => record.effect?.areaPerSlot !== undefined,
  // From a level 4 slot it lasts until dispelled with no Concentration (`spellDurationAt`).
  "major-image": () => true
};

describe("every higher-level clause on a spell with a later action or a grant is read", () => {
  const walked = spells.filter(
    (record) =>
      record.level > 0 && record.higherLevel && (record.effect?.laterActions !== undefined || record.effect?.grant)
  );

  it("walks the spells that have one", () => {
    expect(walked.length).toBeGreaterThan(30);
  });

  for (const record of walked) {
    it(`${record.id}: its scaling clause changes what it does`, () => {
      const text = record.higherLevel!;
      const next = Math.min(9, record.level + 1);
      const sentences = text.split(/(?<=\.)\s+/).filter((sentence) => sentence.trim().length > 0);
      for (const sentence of sentences) {
        if (/damage/i.test(sentence)) {
          // Each later action's or zone's damage part, and each grant's extra damage, grows with the slot.
          for (const row of record.effect?.laterActions ?? []) {
            // A zone that adds its dice by slot level (Conjure Celestial's light) scales as it is placed.
            if (row.zone?.dicePerSlot !== undefined) continue;
            const base = laterAt(record, row.name, record.level);
            const up = laterAt(record, row.name, next);
            const named = /Bludgeoning damage increases/.test(sentence)
              ? base.damage.filter((part) => part.type === "bludgeoning")
              : base.damage;
            for (const part of named)
              expect(
                up.damage.find((other, index) => base.damage[index] === part && other.formula !== part.formula),
                `${record.id}: ${row.name} ${part.formula} ${part.type} doesn't scale`
              ).toBeDefined();
          }
          const extra = extraDamageOf(castAt(record, record.level));
          if (extra.length > 0) expect(extraDamageOf(castAt(record, next))).not.toEqual(extra);
          continue;
        }
        if (/additional creature/i.test(sentence)) {
          expect(record.effect?.targets?.perSlot, `${record.id}: ${sentence}`).toBeDefined();
          continue;
        }
        if (/Hit Points increase by/i.test(sentence)) {
          expect(record.effect?.grant?.hitPointMaximumGain?.perSlot, `${record.id}: ${sentence}`).toBeDefined();
          continue;
        }
        if (/choose a different ability/i.test(sentence)) {
          expect(record.effect?.grant?.optionsPerTarget, `${record.id}: ${sentence}`).toBe(true);
          continue;
        }
        const reader = READ_ELSEWHERE[record.id];
        expect(reader, `${record.id}: no reader for "${sentence}"`).toBeDefined();
        expect(reader!(record), `${record.id}: "${sentence}"`).toBe(true);
      }
    });
  }
});
