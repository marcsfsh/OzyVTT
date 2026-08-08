/**
 * **The eleven authoring paths, and the regression that stops "homebrew items cannot be published"
 * coming back.**
 *
 * This is a port of the diagnosis, not a new invention. The reported defect was reproduced by
 * feeding the server's `EquipmentReferenceSchema` bodies built exactly the way the editor builds
 * them — blank draft, `setAt` writes, the value a select writes when it is returned to "Not set",
 * `forStorage` on the way out — across eleven realistic ways a GM might author an item. Seven of
 * the eleven were refused, including the most obvious item in the game: a homebrew melee weapon,
 * which could not be published unless the GM typed a number into "Range".
 *
 * Two mechanisms produced those seven, and each case below names the one it exercises:
 *
 *  - **A.** `EquipmentReferenceSchema` is the one `.strict()` content schema and its `weapon` and
 *    `armor` sub-objects have five REQUIRED keys each (two nullable, which is not optional). The
 *    editor wrote them on touch, so the container arrived half-built.
 *  - **B.** A select returned to "Not set" wrote `null` into columns that are `.optional()` and
 *    reject `null` — `slot`, `rarity`, `weapon.category`, a cast's `ability`.
 *
 * ## What these tests drive, and why it is the real thing
 *
 * They go through the PRODUCTION editor machinery — `blankDraft`, the field schema's own `write`
 * (which is where container seeding lives), `FieldDef.emptyValue` (which is what a cleared control
 * writes), `forStorage`, `bodyForPublish` — and end at `publishIssues`, which runs
 * `HOMEBREW_BODY_SCHEMAS`: the very map the server's publish gate uses for tier 1 and the store
 * uses to read a body back. A body this file calls publishable is one the server's tier 1 accepts,
 * by construction rather than by assertion.
 *
 * `applyField` is the load-bearing helper: it looks a field up in the real schema and applies the
 * real write, so a test cannot accidentally hand-build a body shape the editor could never produce
 * — which is exactly how the original bug survived a green 123-test homebrew suite.
 *
 * **Those helpers now live in `authoring-harness.ts`.** They grew a second consumer — the both-paths
 * guard in `vocabulary-parity.mirror.test.ts`, which runs in the node project so it may import the
 * server's own modules — and one of them, `applyField`'s throw, is the guarantee that whole phase
 * rests on. The extraction moved the code and changed exactly one thing about it: the six-key
 * `RIDER_KEYS` escape hatch that used to sit here is down to `grants` alone, because `fieldsOf` now
 * walks the rider fields too. See that file's header for why that mattered.
 */

import { describe, expect, it } from "vitest";
import { applyField, authored, clearField, issuesFor as harnessIssues, parsesAsStored as harnessParses } from "./authoring-harness";
import { blankDraft, forStorage } from "./defaults";
import { bodyForPublish } from "./validate";
import type { Draft } from "./schema";
import type { HomebrewType } from "./types";

const RECORD_ID = "hb-test-a1b2c3";

const item = (...edits: ReadonlyArray<readonly [string, unknown]>): Draft => authored("equipment", "Test Item", edits);

const issuesFor = (type: HomebrewType, draft: Draft): readonly string[] => harnessIssues(type, draft, RECORD_ID);
const parsesAsStored = (type: HomebrewType, draft: Draft) => harnessParses(type, draft, RECORD_ID);

/** Publishable = the checklist is empty AND the shared schema accepts the stored body. Asserting
    both is the point: they must never disagree, and a disagreement here is the defect returning. */
function expectPublishable(type: HomebrewType, draft: Draft) {
  expect(issuesFor(type, draft)).toEqual([]);
  expect(parsesAsStored(type, draft)!.success).toBe(true);
}

describe("the eleven item authoring paths (Appendix A5 repro)", () => {
  it("1. plain gear item — defaults plus name and description", () => {
    expectPublishable("equipment", item(["description", "A sturdy iron lantern."]));
  });

  it("2. MELEE WEAPON with the range fields never touched — the flagship case", () => {
    // Mechanism A. This is the one the report is named after: `weapon.rangeFeet` and
    // `weapon.longRangeFeet` are required-nullable, the editor only wrote what was touched, and the
    // GM was told "Fill in range." on a mace. Touching Damage now seeds the whole container with
    // null ranges — the same body a duplicated SRD Mace already carries.
    const mace = item(["category", "weapon"], ["weapon.damageDice", "1d6"], ["weapon.damageType", "bludgeoning"]);
    expectPublishable("equipment", mace);
    const stored = bodyForPublish("equipment", forStorage(mace), RECORD_ID) as { weapon: Record<string, unknown> };
    expect(stored.weapon.rangeFeet).toBeNull();
    expect(stored.weapon.longRangeFeet).toBeNull();
    // Not invented: the kind the select was already displaying, and nothing else.
    expect(stored.weapon.category).toBe("simple");
  });

  it("3. weapon with only damage and damage type filled in", () => {
    // Mechanism A, second face: `weapon.category` was Required too, so three issues arrived one at
    // a time. The seeded container carries the enum the control already showed.
    expectPublishable("equipment", item(["weapon.damageDice", "2d6"], ["weapon.damageType", "slashing"]));
  });

  it("4. armour with only base AC and Adds Dexterity touched", () => {
    // Mechanism A: `dexModifierCap`, `stealthDisadvantage` and `strengthRequired` were all Required.
    const armour = item(["category", "armor"], ["armor.acBase", 14], ["armor.addDexModifier", true]);
    expectPublishable("equipment", armour);
    const stored = bodyForPublish("equipment", forStorage(armour), RECORD_ID) as { armor: Record<string, unknown> };
    expect(stored.armor).toEqual({ acBase: 14, addDexModifier: true, dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null });
  });

  it("5. armour with all five controls touched", () => {
    expectPublishable(
      "equipment",
      item(
        ["category", "armor"], ["armor.acBase", 16], ["armor.addDexModifier", false],
        ["armor.dexModifierCap", 2], ["armor.strengthRequired", 15], ["armor.stealthDisadvantage", true]
      )
    );
  });

  it("6. the slot select chosen and then returned to “Not set”", () => {
    // Mechanism B. `ItemSlotSchema.optional()` rejects `null`; "Not set" now removes the key.
    const draft = clearField("equipment", item(["description", "A charm."], ["slot", "neck"]), "slot");
    expect("slot" in (forStorage(draft) as Record<string, unknown>)).toBe(false);
    expectPublishable("equipment", draft);
  });

  it("7. the rarity control cleared back to empty", () => {
    // Mechanism B, and the control changed with it: `rarity` is an OPEN slug, so it is now a
    // complete list of the six printed rarities that still accepts a word of the GM's own.
    const magic = item(["description", "A ring."], ["isMagic", true], ["rarity", "rare"]);
    const cleared = clearField("equipment", magic, "rarity");
    expect("rarity" in (forStorage(cleared) as Record<string, unknown>)).toBe(false);
    expectPublishable("equipment", cleared);
  });

  it("8. magic item with an armour-class modifier", () => {
    const ring = item(
      ["description", "A ring of protection."],
      ["isMagic", true],
      // The exact row `RiderEditor` mints, minus the `rowId` `forStorage` strips.
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
    // `rowId` is editor identity and the cast schema is `.strict()`; it must not reach the store.
    const stored = bodyForPublish("equipment", forStorage(wand), RECORD_ID) as { casts: Array<Record<string, unknown>> };
    expect(stored.casts[0]).not.toHaveProperty("rowId");
  });

  it("10. a cast row whose ability select is returned to “Not set”", () => {
    // Mechanism B inside a row: `ItemSpellCastSchema.ability` is `.optional()` and `.strict()`.
    const row = applyField("equipment", { rowId: "r1", spellId: "fireball", consumesSpellSlot: false, ability: "int" }, "ability", undefined);
    expect("ability" in row === false || row.ability === undefined).toBe(true);
    expectPublishable("equipment", item(["description", "A wand."], ["isMagic", true], ["casts", [row]]));
  });

  it("11. the weapon-kind select returned to “Not set” — the one case that stays blocked, and now SAYS so", () => {
    // The honest outcome rather than a forced pass: a weapon is simple or martial, and a body with
    // neither is genuinely incomplete. What changed is where the GM learns it. Before, the button
    // was enabled and the server answered with a 409 reading "Required"; now it is a sentence under
    // the button, naming the field, before anything is sent.
    const draft = clearField("equipment", item(["weapon.damageDice", "1d8"], ["weapon.damageType", "slashing"]), "weapon.category");
    expect(issuesFor("equipment", draft)).toContain("Fill in weapon kind.");
    expect(parsesAsStored("equipment", draft)!.success).toBe(false);
  });
});

describe("the checklist and the store agree", () => {
  it("lists every outstanding requirement at once, not one at a time", () => {
    // The serial dead-end, inverted: a half-authored magic item used to surrender one sentence per
    // round trip. Three distinct requirements, three lines, before anything is sent.
    const broken = item(
      ["category", ""],
      ["weapon.damageDice", "not-dice"],
      ["isMagic", true],
      ["cursed", true]
    );
    const issues = issuesFor("equipment", broken);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.some((text) => text.includes("category"))).toBe(true);
    expect(issues.some((text) => text.includes("not-dice"))).toBe(true);
    expect(issues.some((text) => text.includes("attunement"))).toBe(true);
  });

  it("never enables Publish on a body the shared schema refuses", () => {
    // The invariant the whole repair rests on, stated as a one-directional property: an EMPTY
    // checklist must imply the store accepts the body. The converse is deliberately NOT asserted —
    // the checklist may be stricter than the schema where a product rule says so ("a weapon with no
    // dice rolls nothing", "with no numbers the description is the whole card"), and those are
    // sentences a Zod schema has no way to express. Looser is the failure this catches, and looser
    // is what shipped.
    const drafts: readonly Draft[] = [
      item(["description", "Gear."]),
      item(["weapon.damageDice", "1d6"], ["weapon.damageType", "piercing"]),
      item(["category", "armor"], ["armor.acBase", 12], ["armor.addDexModifier", true]),
      item(["description", "A ring."], ["isMagic", true], ["rarity", "rare"]),
      // Deliberately invalid ones, so the property is exercised in both directions.
      item(["category", ""]),
      item(["weapon.damageDice", "1d8"]),
      item(["description", "A ring."], ["isMagic", true], ["cursed", true])
    ];
    for (const draft of drafts) {
      if (issuesFor("equipment", draft).length === 0) expect(parsesAsStored("equipment", draft)!.success).toBe(true);
    }
  });

  it("a blank unnamed draft asks for its name and nothing else", () => {
    // The one place the list is deliberately truncated: twenty schema issues on a record created
    // three seconds ago is a wall, and every one of them is downstream of "it has no name yet".
    expect(issuesFor("equipment", blankDraft("equipment"))).toEqual(["Give this item a name."]);
    expect(issuesFor("monster", blankDraft("monster"))).toEqual(["Give this monster a name."]);
  });
});

describe("the same repair, on the other type that had it", () => {
  it("an area spell's shape publishes — it wrote a key the column has never had", () => {
    // `shape.sizeFeet` for a column called `size`. `SpellReferenceSchema` is not `.strict()`, so the
    // typo was STRIPPED in silence and `size`/`unit` came back Required: an area spell could be
    // authored and never published, found by running the real schema rather than by reading it.
    let spell: Draft = { ...blankDraft("spell"), name: "Blast", description: "A blast." };
    spell = applyField("spell", spell, "target.type", "area");
    spell = applyField("spell", spell, "shape.type", "sphere");
    spell = applyField("spell", spell, "shape.size", 20);
    expectPublishable("spell", spell);
    const stored = bodyForPublish("spell", forStorage(spell), RECORD_ID) as { shape: Record<string, unknown> };
    expect(stored.shape).toEqual({ type: "sphere", size: 20, unit: "feet" });
  });

  it("a spell's saving throw cleared back to none stays null, because that column is nullable", () => {
    // The other half of `emptyValue`: `save` is `.nullable()` and REQUIRED, so removing the key
    // would be as wrong here as writing null was for `slot`. Nine fields carry `"null"`; they are
    // exactly the nine required-but-nullable columns.
    let spell: Draft = { ...blankDraft("spell"), name: "Blast", description: "A blast." };
    spell = applyField("spell", spell, "save", "dex");
    spell = clearField("spell", spell, "save");
    expect((spell as Record<string, unknown>).save).toBeNull();
    expectPublishable("spell", spell);
  });
});

describe("opening a record never dirties it", () => {
  it("tops up a half-written weapon block but leaves an item with no weapon alone", async () => {
    const { withDefaults } = await import("./defaults");
    // The repair path: a record stored before the fix (or imported from a pack) sitting on the
    // exact shape the store refuses. Opening it makes it publishable without the GM being told to
    // type a range into a mace.
    const halfWritten = withDefaults("equipment", { name: "Old Mace", category: "weapon", weapon: { damageDice: "1d6" } });
    expect(halfWritten.weapon).toEqual({ category: "simple", damageDice: "1d6", damageType: "", rangeFeet: null, longRangeFeet: null });

    // The guard that matters as much: an ABSENT weapon stays absent. `useAutosave` compares the
    // filled draft against the server's body, so growing a key here would turn "select a record"
    // into a PATCH on every plain item in the library.
    const lantern = { name: "Lantern", source: "homebrew", description: null, category: "gear", costGp: 5, weightLb: 2 };
    expect(withDefaults("equipment", lantern)).toEqual(lantern);
  });
});
