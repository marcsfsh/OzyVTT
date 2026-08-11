import { describe, expect, it } from "vitest";
import { ItemSlotSchema } from "@vtt/schemas";
import { loadArmor, loadEquipment, loadMagicItems, loadWeapons } from "../src/index.js";
import { RARITY_IDS } from "../src/enums.js";

/**
 * THE GENERATED MAGIC-ITEM BUNDLE, GUARDED.
 *
 * `magic-item-source.test.ts` owns the INPUT - the vendored file, pinned byte for byte. This file
 * owns the OUTPUT of `scripts/build-magic-items.ts` over it. When the two disagree the parser
 * changed and exactly one of them is the defect.
 *
 * The counts here are the parser's own output, re-asserted. That matters most for `slot`: the
 * worn/carried split is a READING of the SRD and three defensible methods give three different
 * numbers for it, so what is pinned is the number the committed rule produces - and C7c/C7d are
 * scoped off this column, which is why it is asserted per slot and not just in total.
 */

const rows = loadMagicItems();
const histogram = (values: readonly string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((into, value) => ({ ...into, [value]: (into[value] ?? 0) + 1 }), {});

/** The five `+1, +2, or +3` ladders, expanded to one row per printed tier. */
const LADDER_ROWS = [
  "Ammunition, +1", "Ammunition, +2", "Ammunition, +3",
  "Armor, +1", "Armor, +2", "Armor, +3",
  "Shield, +1", "Shield, +2", "Shield, +3",
  "Wand of the War Mage, +1", "Wand of the War Mage, +2", "Wand of the War Mage, +3",
  "Weapon, +1", "Weapon, +2", "Weapon, +3"
];

/** The seven `Rarity Varies` tables, kept as one row each rather than expanded. */
const VARIES_ROWS = [
  "Belt of Giant Strength", "Feather Token", "Figurine of Wondrous Power", "Ioun Stone",
  "Potion of Giant Strength", "Potions of Healing", "Spell Scroll"
];

describe("the generated magic-item bundle", () => {
  it("emits 268 rows: 258 printed entries, minus 5 ladders, plus their 15 tiers", () => {
    expect(rows).toHaveLength(268);
    // The arithmetic, spelled out rather than asserted as a total, so a wrong expansion says which
    // half moved. 258 - 5 + 15 = 268.
    const ladders = rows.filter((row) => LADDER_ROWS.includes(row.name));
    expect(ladders.map((row) => row.name).sort()).toEqual([...LADDER_ROWS].sort());
    expect(rows.length - ladders.length).toBe(258 - 5);
    expect(258 - 5 + ladders.length).toBe(268);
    // ...and the seven that deliberately did NOT expand are each still exactly one row.
    for (const name of VARIES_ROWS) {
      expect(rows.filter((row) => row.name === name), name).toHaveLength(1);
      expect(rows.find((row) => row.name === name)!.rarity, name).toBe("varies");
    }
  });

  it("never admits the two creature stat blocks embedded in the A-Z run", () => {
    // Skipped BY NAME by the parser, with a count assertion beside them - the counterpart to the
    // source pin's own check. A silent filter here is how two monsters become two magic items.
    for (const creature of ["Giant Fly", "Avatar of Death"]) {
      expect(rows.map((row) => row.name), creature).not.toContain(creature);
    }
  });

  it("classifies every row into a slot that is a member of ItemSlotSchema", () => {
    // `slot` is the closed enum the engine exhaustively switches on (AC derivation, what may be
    // equipped twice, what an attunement gate applies to), so a name-derived value is CHECKED here
    // rather than trusted. Reported per item, because "one row has a bad slot" is not actionable.
    const bad = rows.filter((row) => !ItemSlotSchema.safeParse(row.slot).success)
      .map((row) => `${row.name} -> ${String(row.slot)}`);
    expect(bad, "rows whose slot is not a member of ItemSlotSchema").toEqual([]);
    expect(histogram(rows.map((row) => row.slot!))).toEqual({
      wondrous: 70, held: 34, weapon: 33, consumable: 25, ring: 22, neck: 15, shoulders: 15,
      armor: 14, head: 12, shield: 9, feet: 7, hands: 6, ammunition: 4, belt: 2
    });
  });

  it("splits the 127 wondrous items 57 worn / 70 carried, and that split is the rule's OUTPUT", () => {
    /**
     * THE NUMBER IS DERIVED, NOT TARGETED. The rule is written down in full in
     * `scripts/build-magic-items.ts`: a wondrous item is worn when its NAME names the garment
     * (56 of 127), or failing that when its own prose does in a "this/these <garment>"
     * construction (1 - `Wings of Flying`, whose first sentence is "While wearing this cloak").
     * Everything else is carried.
     *
     * Two other methods over the same 127 give 62/65 and 52; this file pins what THIS rule
     * produces, and C7c ("wondrous, worn") and C7d ("carried wondrous") are scoped off it.
     */
    const wondrous = rows.filter((row) => row.category === "wondrous-item");
    expect(wondrous).toHaveLength(127);
    const worn = wondrous.filter((row) => row.slot !== "wondrous");
    expect(worn).toHaveLength(57);
    expect(wondrous.filter((row) => row.slot === "wondrous")).toHaveLength(70);
    /**
     * THE ROSTER, NOT JUST THE COUNT, AND IT IS ASSERTED FIRST - because a histogram cannot name the
     * item that moved, and whichever assertion runs first is the one a reader sees. C7c ("wondrous,
     * worn") and C7d ("carried wondrous") are scoped off this column, so the useful failure is
     * "Cloak of Displacement is under neck and was expected under shoulders", not "neck went 15->16".
     */
    const roster = worn.reduce<Record<string, string[]>>((into, row) => (
      { ...into, [row.slot!]: [...(into[row.slot!] ?? []), row.name].sort() }
    ), {});
    expect(roster).toEqual({
      neck: [
        "Amulet of Health", "Amulet of Proof against Detection and Location", "Amulet of the Planes",
        "Brooch of Shielding", "Medallion of Thoughts", "Necklace of Adaptation",
        "Necklace of Fireballs", "Necklace of Prayer Beads", "Periapt of Health",
        "Periapt of Proof against Poison", "Periapt of Wound Closure", "Scarab of Protection",
        "Talisman of Pure Good", "Talisman of Ultimate Evil", "Talisman of the Sphere"
      ],
      shoulders: [
        "Cape of the Mountebank", "Cloak of Arachnida", "Cloak of Displacement",
        "Cloak of Elvenkind", "Cloak of Invisibility", "Cloak of Protection", "Cloak of the Bat",
        "Cloak of the Manta Ray", "Mantle of Spell Resistance", "Robe of Eyes",
        "Robe of Scintillating Colors", "Robe of Stars", "Robe of Useful Items",
        "Robe of the Archmagi", "Wings of Flying"
      ],
      head: [
        "Circlet of Blasting", "Eyes of Charming", "Eyes of Minute Seeing", "Eyes of the Eagle",
        "Goggles of Night", "Hat of Disguise", "Hat of Many Spells", "Headband of Intellect",
        "Helm of Brilliance", "Helm of Comprehending Languages", "Helm of Telepathy",
        "Helm of Teleportation"
      ],
      feet: [
        "Boots of Elvenkind", "Boots of Levitation", "Boots of Speed",
        "Boots of Striding and Springing", "Boots of the Winterlands",
        "Slippers of Spider Climbing", "Winged Boots"
      ],
      hands: [
        "Bracers of Archery", "Bracers of Defense", "Gauntlets of Ogre Power",
        "Gloves of Missile Snaring", "Gloves of Swimming and Climbing", "Gloves of Thievery"
      ],
      belt: ["Belt of Dwarvenkind", "Belt of Giant Strength"]
    });
    // The counts, derived from the roster above so the two can never disagree.
    expect(histogram(worn.map((row) => row.slot!)))
      .toEqual({ neck: 15, shoulders: 15, head: 12, feet: 7, hands: 6, belt: 2 });
    // The two readings inside the rule, named where they can be checked. `Ioun Stone` orbits your
    // head rather than occupying it - three may orbit at once and none competes with a helm - and
    // horseshoes are worn by a horse, not by the bearer this column describes.
    expect(rows.find((row) => row.name === "Ioun Stone")!.slot).toBe("wondrous");
    for (const name of ["Horseshoes of Speed", "Horseshoes of a Zephyr"]) {
      expect(rows.find((row) => row.name === name)!.slot, name).toBe("wondrous");
    }
    // The one prose-derived slot, asserted so a regression in pass 2 is named rather than silent.
    expect(rows.find((row) => row.name === "Wings of Flying")!.slot).toBe("shoulders");
  });

  it("reads the two qualifiers a naive category map gets wrong", () => {
    // `Weapon (Any Ammunition)` is ammunition, not a weapon; `Armor (Shield)` is a shield, not body
    // armor. Both are printed in the parenthetical rather than in the category word.
    const ammunition = rows.filter((row) => row.slot === "ammunition").map((row) => row.name).sort();
    expect(ammunition).toEqual(["Ammunition of Slaying", "Ammunition, +1", "Ammunition, +2", "Ammunition, +3"]);
    expect(rows.filter((row) => row.slot === "shield")).toHaveLength(9);
    expect(rows.find((row) => row.name === "Animated Shield")!.slot).toBe("shield");
  });

  it("declares only rarities RARITY_IDS knows, which is what makes that containment non-vacuous", () => {
    const bad = rows.filter((row) => !RARITY_IDS.includes(row.rarity ?? "")).map((row) => `${row.name} -> ${String(row.rarity)}`);
    expect(bad, "rows whose rarity is outside RARITY_IDS").toEqual([]);
    expect(histogram(rows.map((row) => row.rarity!)))
      .toEqual({ rare: 87, uncommon: 77, "very-rare": 60, legendary: 33, varies: 8, common: 2, artifact: 1 });
    /**
     * `varies` is EIGHT here where the source prints "Rarity Varies" seven times, and the eighth is
     * a decision: `Horn of Valhalla` prints a ladder ("Rare (Silver or Brass), Very Rare (Bronze),
     * or Legendary (Iron)") and is not one of the five that expand, so it needs one rarity. Its
     * metal - and therefore its rung - is a d100 roll printed inside its own description, so any
     * single rung would assert a horn the SRD leaves to the GM's table.
     */
    expect(rows.find((row) => row.name === "Horn of Valhalla")!.rarity).toBe("varies");
    expect(rows.find((row) => row.name === "Horn of Valhalla")!.description)
      .toContain("Rare (Silver or Brass), Very Rare (Bronze), or Legendary (Iron)");
  });

  it("requires attunement on 142 rows - the source's 140, plus the two extra Wand of the War Mage tiers", () => {
    expect(rows.filter((row) => row.attunement?.required === true)).toHaveLength(142);
    // The restriction clause is parsed into slugs, display-only and never enforced.
    expect(rows.find((row) => row.name === "Wand of the War Mage, +1")!.attunement)
      .toEqual({ required: true, restrictedTo: ["spellcaster"] });
    expect(rows.find((row) => row.name === "Robe of the Archmagi")!.attunement!.restrictedTo)
      .toEqual(["sorcerer", "warlock", "wizard"]);
    // An audience that is not a class or a species stays one readable slug rather than being
    // dropped for not resolving - nothing resolves these, the sheet only shows them.
    expect(rows.find((row) => row.name === "Dwarven Thrower")!.attunement!.restrictedTo)
      .toEqual(["dwarf", "creature-attuned-to-a-belt-of-dwarvenkind"]);
    expect(rows.filter((row) => row.attunement?.required && row.attunement.restrictedTo.length === 0)).toHaveLength(119);
  });

  it("prices nothing, because the SRD prints a value band by rarity and not a per-item price", () => {
    expect(rows.filter((row) => row.costGp !== null)).toEqual([]);
    expect(rows.filter((row) => row.weightLb !== null)).toEqual([]);
  });

  it("carries content and no mechanics - the four overlay lanes author those", () => {
    const withMechanics = rows.filter((row) =>
      row.modifiers.length > 0 || row.effects.length > 0 || row.actions.length > 0 ||
      row.casts.length > 0 || row.grantsFeatIds.length > 0 || row.tags.length > 0 || row.cursed);
    expect(withMechanics.map((row) => row.name), "the ETL emits no riders; the overlay does").toEqual([]);
    expect(rows.every((row) => row.isMagic)).toBe(true);
    expect(rows.every((row) => row.source === "srd")).toBe(true);
  });

  it("leads every description with the printed type line, so rarity and attunement reach a reader", () => {
    /**
     * NOTHING ON THE WIRE CARRIES `rarity`: `ContentEquipmentSummary` has no such key, and adding
     * one would be a projection change this unit is not making. The description is the field that
     * already reaches both the browse list and the inventory row, and the SRD's own type line is
     * source text - so leading with it invents nothing and is what puts "Uncommon" and "Requires
     * Attunement by a Spellcaster" in front of a GM.
     */
    expect(rows.find((row) => row.name === "Wand of the War Mage, +1")!.description)
      .toBe("Wand, Uncommon (Requires Attunement by a Spellcaster). While holding this wand, you gain a bonus to spell attack rolls determined by the wand's rarity. In addition, you ignore Half Cover when making a spell attack roll.");
    // The ladder's own rarity per tier, not the printed three-rung line.
    expect(rows.find((row) => row.name === "Wand of the War Mage, +3")!.description).toContain("Wand, Very Rare (");
    // A table IS the promise: `Armor of Resistance` is one row precisely because its d10 table rides
    // in its text, rendered by the same `tableAsText` the class ETL uses.
    expect(rows.find((row) => row.name === "Armor of Resistance")!.description)
      .toContain("1d10 1: Damage Type Acid");
  });

  it("cuts exactly twelve descriptions at the schema's 2000-char cap, and names them", () => {
    /**
     * `EquipmentReferenceSchema.description` is `.max(2000)` and twelve entries render longer. The
     * cap is not this ETL's to move - the same string is copied onto the INVENTORY row by
     * add-from-catalog - so the overflow is cut at a sentence boundary and marked. Naming the
     * twelve is what keeps that from being silent: a thirteenth is a test failure, not a paragraph
     * that quietly stops.
     */
    const cut = rows.filter((row) => row.description!.endsWith(" […]")).map((row) => row.name).sort();
    expect(cut).toEqual([
      "Apparatus of the Crab", "Bag of Beans", "Deck of Illusions", "Feather Token",
      "Hat of Many Spells", "Ioun Stone", "Mirror of Life Trapping", "Mysterious Deck",
      "Ring of Elemental Command", "Rod of Lordly Might", "Staff of the Magi", "Wand of Wonder"
    ]);
    expect(rows.every((row) => row.description!.length <= 2000)).toBe(true);
  });

  it("mints no id that any other bundle already ships, and none twice", () => {
    /**
     * THE GUARD FIRES ZERO TIMES, WHICH IS THE POINT - and it earns its place on the branch not
     * taken. `Potions of Healing` EXPANDED into its four printed tiers would mint
     * `potion-of-healing`, which `equipment.v1.json` already ships and `bundle.test.ts` asserts by
     * name. That collision would have surfaced as one row silently shadowing another in the folded
     * catalog rather than as a failed build.
     */
    const elsewhere = new Map<string, string>();
    for (const record of loadEquipment().filter((item) => !item.isMagic)) elsewhere.set(record.id, "the mundane catalog");
    for (const record of loadWeapons()) elsewhere.set(record.id, "weapons.v1.json");
    for (const record of loadArmor()) elsewhere.set(record.id, "armor.v1.json");
    const collisions = rows.filter((row) => elsewhere.has(row.id)).map((row) => `${row.id} also lives in ${elsewhere.get(row.id)}`);
    expect(collisions, "a minted id already exists elsewhere").toEqual([]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("keeps the grouped Potions of Healing row and leaves the mundane potion alone", () => {
    /**
     * THE RECONCILIATION, TAKEN AND WRITTEN DOWN. `equipment.v1.json` ships a priced, mundane
     * `potion-of-healing`; the SRD's magic-item list prints a four-rung `Potions of Healing` table.
     * Keeping both costs two similar names in the browse list. The alternative - expand the four
     * tiers and delete the hand-authored row - would have made this ETL EDIT its own sibling input,
     * which is the one thing a generated bundle exists to avoid.
     */
    const catalog = loadEquipment();
    expect(catalog.find((item) => item.id === "potion-of-healing")).toMatchObject({ isMagic: false, costGp: 50 });
    expect(catalog.find((item) => item.id === "potions-of-healing")).toMatchObject({ isMagic: true, rarity: "varies", costGp: null });
    expect(rows.filter((row) => /^Potion of Healing/.test(row.name))).toEqual([]);
  });

  it("reaches the addable catalog through the fourth fold, sorted in with everything else", () => {
    const catalog = loadEquipment();
    expect(catalog.filter((item) => item.isMagic)).toHaveLength(268);
    // The fold gives every row the uniform `weapon`/`armor`-present shape the other three have.
    expect(catalog.filter((item) => item.isMagic).every((item) => item.weapon === null && item.armor === null)).toBe(true);
    const wand = catalog.find((item) => item.id === "wand-of-the-war-mage-1")!;
    expect(wand).toMatchObject({ name: "Wand of the War Mage, +1", category: "wand", slot: "held", rarity: "uncommon" });
  });
});
