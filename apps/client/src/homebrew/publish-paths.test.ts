/**
 * Eleven realistic ways a GM authors an item, driven through the production editor machinery
 * (`blankDraft`, each field's own `write`, `emptyValue`, `forStorage`, `bodyForPublish`) and checked by
 * `publishIssues`, which runs the same `HOMEBREW_BODY_SCHEMAS` as the server's publish gate.
 *
 * Two failure mechanisms are covered:
 * - A: `EquipmentReferenceSchema` is `.strict()` and its `weapon`/`armor` sub-objects have five
 *   required keys each, so a container written on first touch must arrive complete.
 * - B: a select returned to "Not set" must omit `.optional()` columns that reject `null` (`slot`,
 *   `rarity`, `weapon.category`, a cast's `ability`).
 *
 * The helpers live in `authoring-harness.ts`; `applyField` throws on keys with no control, so no
 * test can hand-build a body the editor couldn't produce.
 */

import { describe, expect, it } from "vitest";
import {
  applyField,
  authored,
  clearField,
  issuesFor as harnessIssues,
  parsesAsStored as harnessParses
} from "./authoring-harness";
import { blankDraft, forStorage } from "./defaults";
import { bodyForPublish } from "./validate";
import type { Draft } from "./schema";
import type { HomebrewType } from "./types";

const RECORD_ID = "hb-test-a1b2c3";

const item = (...edits: ReadonlyArray<readonly [string, unknown]>): Draft => authored("equipment", "Test Item", edits);

const issuesFor = (type: HomebrewType, draft: Draft): readonly string[] => harnessIssues(type, draft, RECORD_ID);
const parsesAsStored = (type: HomebrewType, draft: Draft) => harnessParses(type, draft, RECORD_ID);

/** Publishable means the checklist is empty and the shared schema accepts the stored body. */
function expectPublishable(type: HomebrewType, draft: Draft) {
  expect(issuesFor(type, draft)).toEqual([]);
  expect(parsesAsStored(type, draft)!.success).toBe(true);
}

describe("the eleven item authoring paths (Appendix A5 repro)", () => {
  it("1. plain gear item — defaults plus name and description", () => {
    expectPublishable("equipment", item(["description", "A sturdy iron lantern."]));
  });

  it("2. MELEE WEAPON with the range fields never touched — the flagship case", () => {
    // Mechanism A: touching Damage seeds the whole container with null ranges, as an SRD mace carries.
    const mace = item(["category", "weapon"], ["weapon.damageDice", "1d6"], ["weapon.damageType", "bludgeoning"]);
    expectPublishable("equipment", mace);
    const stored = bodyForPublish("equipment", forStorage(mace), RECORD_ID) as { weapon: Record<string, unknown> };
    expect(stored.weapon.rangeFeet).toBeNull();
    expect(stored.weapon.longRangeFeet).toBeNull();
    // The kind the select already displays, and nothing invented.
    expect(stored.weapon.category).toBe("simple");
  });

  it("3. weapon with only damage and damage type filled in", () => {
    // Mechanism A: the seeded container includes the enum the control already shows.
    expectPublishable("equipment", item(["weapon.damageDice", "2d6"], ["weapon.damageType", "slashing"]));
  });

  it("4. armour with only base AC and Adds Dexterity touched", () => {
    // Mechanism A: `dexModifierCap`, `stealthDisadvantage` and `strengthRequired` are required.
    const armour = item(["category", "armor"], ["armor.acBase", 14], ["armor.addDexModifier", true]);
    expectPublishable("equipment", armour);
    const stored = bodyForPublish("equipment", forStorage(armour), RECORD_ID) as { armor: Record<string, unknown> };
    expect(stored.armor).toEqual({
      acBase: 14,
      addDexModifier: true,
      dexModifierCap: null,
      stealthDisadvantage: false,
      strengthRequired: null
    });
  });

  it("5. armour with all five controls touched", () => {
    expectPublishable(
      "equipment",
      item(
        ["category", "armor"],
        ["armor.acBase", 16],
        ["armor.addDexModifier", false],
        ["armor.dexModifierCap", 2],
        ["armor.strengthRequired", 15],
        ["armor.stealthDisadvantage", true]
      )
    );
  });

  it("6. the slot select chosen and then returned to “Not set”", () => {
    // Mechanism B: `ItemSlotSchema.optional()` rejects `null`, so "Not set" removes the key.
    const draft = clearField("equipment", item(["description", "A charm."], ["slot", "neck"]), "slot");
    expect("slot" in (forStorage(draft) as Record<string, unknown>)).toBe(false);
    expectPublishable("equipment", draft);
  });

  it("7. the rarity control cleared back to empty", () => {
    // Mechanism B: `rarity` is an open slug, offered as the printed list plus free entry.
    const magic = item(["description", "A ring."], ["isMagic", true], ["rarity", "rare"]);
    const cleared = clearField("equipment", magic, "rarity");
    expect("rarity" in (forStorage(cleared) as Record<string, unknown>)).toBe(false);
    expectPublishable("equipment", cleared);
  });

  it("8. magic item with an armour-class modifier", () => {
    const ring = item(
      ["description", "A ring of protection."],
      ["isMagic", true],
      // The row `RiderEditor` mints, minus the `rowId` that `forStorage` strips.
      ["modifiers", [{ type: "armor-class", amount: 1, whileArmored: false }]]
    );
    expectPublishable("equipment", ring);
  });

  it("9. magic item with one cast — a seeded row and a spell picked", () => {
    const wand = item(
      ["description", "A wand."],
      ["isMagic", true],
      ["casts", [{ rowId: "r1", spellId: "fireball", consumesSpellSlot: false }]]
    );
    expectPublishable("equipment", wand);
    // `rowId` is editor identity and the cast schema is `.strict()`, so it must not reach the store.
    const stored = bodyForPublish("equipment", forStorage(wand), RECORD_ID) as {
      casts: Array<Record<string, unknown>>;
    };
    expect(stored.casts[0]).not.toHaveProperty("rowId");
  });

  it("10. a cast row whose ability select is returned to “Not set”", () => {
    // Mechanism B inside a row: `ItemSpellCastSchema.ability` is `.optional()` and `.strict()`.
    const row = applyField(
      "equipment",
      { rowId: "r1", spellId: "fireball", consumesSpellSlot: false, ability: "int" },
      "ability",
      undefined
    );
    expect("ability" in row === false || row.ability === undefined).toBe(true);
    expectPublishable("equipment", item(["description", "A wand."], ["isMagic", true], ["casts", [row]]));
  });

  it("11. the weapon-kind select returned to “Not set” — the one case that stays blocked, and now SAYS so", () => {
    // A weapon must be simple or martial, so this stays blocked, but as a named sentence under the
    // button before anything is sent.
    const draft = clearField(
      "equipment",
      item(["weapon.damageDice", "1d8"], ["weapon.damageType", "slashing"]),
      "weapon.category"
    );
    expect(issuesFor("equipment", draft)).toContain("Fill in weapon kind.");
    expect(parsesAsStored("equipment", draft)!.success).toBe(false);
  });
});

describe("the checklist and the store agree", () => {
  it("lists every outstanding requirement at once, not one at a time", () => {
    // Three distinct requirements, three lines.
    const broken = item(["category", ""], ["weapon.damageDice", "not-dice"], ["isMagic", true], ["cursed", true]);
    const issues = issuesFor("equipment", broken);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.some((text) => text.includes("category"))).toBe(true);
    expect(issues.some((text) => text.includes("not-dice"))).toBe(true);
    expect(issues.some((text) => text.includes("attunement"))).toBe(true);
  });

  it("never enables Publish on a body the shared schema refuses", () => {
    // An empty checklist must imply the store accepts the body. The converse is not asserted: the
    // checklist may be stricter where a product rule says so ("a weapon with no dice rolls nothing").
    const drafts: readonly Draft[] = [
      item(["description", "Gear."]),
      item(["weapon.damageDice", "1d6"], ["weapon.damageType", "piercing"]),
      item(["category", "armor"], ["armor.acBase", 12], ["armor.addDexModifier", true]),
      item(["description", "A ring."], ["isMagic", true], ["rarity", "rare"]),
      // Invalid ones too, so the property is exercised both ways.
      item(["category", ""]),
      item(["weapon.damageDice", "1d8"]),
      item(["description", "A ring."], ["isMagic", true], ["cursed", true])
    ];
    for (const draft of drafts) {
      if (issuesFor("equipment", draft).length === 0) expect(parsesAsStored("equipment", draft)!.success).toBe(true);
    }
  });

  it("a blank unnamed draft asks for its name and nothing else", () => {
    // The one place the list is truncated: everything else is downstream of the missing name.
    expect(issuesFor("equipment", blankDraft("equipment"))).toEqual(["Give this item a name."]);
    expect(issuesFor("monster", blankDraft("monster"))).toEqual(["Give this monster a name."]);
  });
});

describe("the same repair, on the other type that had it", () => {
  it("an area spell's shape publishes — it wrote a key the column has never had", () => {
    // The key is `size`; `SpellReferenceSchema` isn't `.strict()`, so a wrong key would be silently
    // stripped and `size`/`unit` reported as required.
    let spell: Draft = { ...blankDraft("spell"), name: "Blast", description: "A blast." };
    spell = applyField("spell", spell, "target.type", "area");
    spell = applyField("spell", spell, "shape.type", "sphere");
    spell = applyField("spell", spell, "shape.size", 20);
    expectPublishable("spell", spell);
    const stored = bodyForPublish("spell", forStorage(spell), RECORD_ID) as { shape: Record<string, unknown> };
    expect(stored.shape).toEqual({ type: "sphere", size: 20, unit: "feet" });
  });

  it("a spell's saving throw cleared back to none stays null, because that column is nullable", () => {
    // `save` is nullable and required, so clearing the ability keeps the key as `null`. Picking one
    // writes the whole block, with what the save does at its defaults until the GM says otherwise.
    let spell: Draft = { ...blankDraft("spell"), name: "Blast", description: "A blast." };
    spell = applyField("spell", spell, "save.ability", "dex");
    expect((spell as Record<string, unknown>).save).toEqual({
      ability: "dex",
      successDamage: "half",
      failureCondition: null
    });
    spell = applyField("spell", spell, "save.failureCondition", "prone");
    expectPublishable("spell", spell);
    spell = clearField("spell", spell, "save.ability");
    expect((spell as Record<string, unknown>).save).toBeNull();
    expectPublishable("spell", spell);
  });
});

describe("opening a record never dirties it", () => {
  it("tops up a half-written weapon block but leaves an item with no weapon alone", async () => {
    const { withDefaults } = await import("./defaults");
    // A stored or imported half-written weapon is topped up on open, which makes it publishable.
    const halfWritten = withDefaults("equipment", {
      name: "Old Mace",
      category: "weapon",
      weapon: { damageDice: "1d6" }
    });
    expect(halfWritten.weapon).toEqual({
      category: "simple",
      damageDice: "1d6",
      damageType: "",
      rangeFeet: null,
      longRangeFeet: null
    });

    // An absent weapon stays absent, or merely selecting a plain item would PATCH it.
    const lantern = {
      name: "Lantern",
      source: "homebrew",
      description: null,
      category: "gear",
      costGp: 5,
      weightLb: 2
    };
    expect(withDefaults("equipment", lantern)).toEqual(lantern);
  });
});
