import { describe, expect, it } from "vitest";
import { ITEM_MECHANICS } from "../scripts/item-mechanics/items.js";
import { loadArmor, loadEquipment, loadMagicItems, loadWeapons } from "../src/index.js";

/**
 * What `scripts/build-magic-items.ts` decides, pinned where a reading of the SRD is a choice: the
 * ladder expansion, the worn/carried slot split, the browse categories and the base-item column.
 * Counts the ETL already refuses on (270 rows, slots and rarities in their enums) are not repeated.
 */

const rows = loadMagicItems();
const histogram = (values: readonly string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((into, value) => ({ ...into, [value]: (into[value] ?? 0) + 1 }), {});

/** The five `+1, +2, or +3` ladders, expanded to one row per printed tier. */
const LADDER_ROWS = [
  "Ammunition, +1",
  "Ammunition, +2",
  "Ammunition, +3",
  "Armor, +1",
  "Armor, +2",
  "Armor, +3",
  "Shield, +1",
  "Shield, +2",
  "Shield, +3",
  "Wand of the War Mage, +1",
  "Wand of the War Mage, +2",
  "Wand of the War Mage, +3",
  "Weapon, +1",
  "Weapon, +2",
  "Weapon, +3"
];

/** The seven `Rarity Varies` tables, kept as one row each. */
const VARIES_ROWS = [
  "Belt of Giant Strength",
  "Feather Token",
  "Figurine of Wondrous Power",
  "Ioun Stone",
  "Potion of Giant Strength",
  "Spell Scroll"
];

describe("the generated magic-item bundle", () => {
  it("expands the five +1/+2/+3 ladders to one row per tier, and keeps each Rarity Varies table whole", () => {
    const ladders = rows.filter((row) => /, \+[123]$/.test(row.name));
    expect(ladders.map((row) => row.name).sort()).toEqual([...LADDER_ROWS].sort());
    // The six that deliberately did not expand are each still exactly one row (Potions of Healing expands into
    // its strengths, below).
    for (const name of VARIES_ROWS) {
      expect(
        rows.filter((row) => row.name === name),
        name
      ).toHaveLength(1);
      expect(rows.find((row) => row.name === name)!.rarity, name).toBe("varies");
    }
  });

  it("never admits the two creature stat blocks embedded in the A-Z run", () => {
    // The parser skips these by name.
    for (const creature of ["Giant Fly", "Avatar of Death"]) {
      expect(
        rows.map((row) => row.name),
        creature
      ).not.toContain(creature);
    }
  });

  it("emits only category values the browse-and-add chips can filter on", () => {
    /**
     * The picker's chips filter on `category`, so a miscategorised row vanishes from its chip. Exact
     * histogram, so a row moving between two legal categories fails too.
     */
    expect(histogram(rows.map((row) => row.category))).toEqual({
      "wondrous-item": 127,
      weapon: 33,
      consumable: 27,
      ring: 22,
      wand: 15,
      armor: 14,
      staff: 12,
      shield: 9,
      rod: 7,
      ammunition: 4
    });
  });

  it("splits the wondrous items into worn and carried by the slot rule, pinned by name", () => {
    /**
     * The rule lives in `scripts/build-magic-items.ts`: worn when the name names a garment, minus
     * `Hat of Many Spells` (held), plus `Wings of Flying` (its prose says "this cloak").
     */
    const worn = rows.filter((row) => row.category === "wondrous-item" && row.slot !== "wondrous");
    const roster = worn.reduce<Record<string, string[]>>(
      (into, row) => ({ ...into, [row.slot!]: [...(into[row.slot!] ?? []), row.name].sort() }),
      {}
    );
    expect(roster).toEqual({
      neck: [
        "Amulet of Health",
        "Amulet of Proof against Detection and Location",
        "Amulet of the Planes",
        "Brooch of Shielding",
        "Medallion of Thoughts",
        "Necklace of Adaptation",
        "Necklace of Fireballs",
        "Necklace of Prayer Beads",
        "Periapt of Health",
        "Periapt of Proof against Poison",
        "Periapt of Wound Closure",
        "Scarab of Protection",
        "Talisman of Pure Good",
        "Talisman of Ultimate Evil",
        "Talisman of the Sphere"
      ],
      shoulders: [
        "Cape of the Mountebank",
        "Cloak of Arachnida",
        "Cloak of Displacement",
        "Cloak of Elvenkind",
        "Cloak of Invisibility",
        "Cloak of Protection",
        "Cloak of the Bat",
        "Cloak of the Manta Ray",
        "Mantle of Spell Resistance",
        "Wings of Flying"
      ],
      // The SRD's one-of-each list caps cloaks and headwear and leaves robes and lenses alone, so they wear apart.
      body: [
        "Robe of Eyes",
        "Robe of Scintillating Colors",
        "Robe of Stars",
        "Robe of Useful Items",
        "Robe of the Archmagi"
      ],
      eyes: ["Eyes of Charming", "Eyes of Minute Seeing", "Eyes of the Eagle", "Goggles of Night"],
      head: [
        "Circlet of Blasting",
        "Hat of Disguise",
        "Headband of Intellect",
        "Helm of Brilliance",
        "Helm of Comprehending Languages",
        "Helm of Telepathy",
        "Helm of Teleportation"
      ],
      feet: [
        "Boots of Elvenkind",
        "Boots of Levitation",
        "Boots of Speed",
        "Boots of Striding and Springing",
        "Boots of the Winterlands",
        "Slippers of Spider Climbing",
        "Winged Boots"
      ],
      // "One pair of gloves or gauntlets, one pair of bracers": two caps, so two slots.
      bracers: ["Bracers of Archery", "Bracers of Defense"],
      hands: [
        "Gauntlets of Ogre Power",
        "Gloves of Missile Snaring",
        "Gloves of Swimming and Climbing",
        "Gloves of Thievery"
      ],
      belt: ["Belt of Dwarvenkind", "Belt of Giant Strength"]
    });
    // `Ioun Stone` orbits the head and takes no slot, and horseshoes are worn by a horse.
    // `Hat of Many Spells` is held; at `head` it would block a helm (`SLOT_CAPACITY.head` is 1).
    expect(rows.find((row) => row.name === "Hat of Many Spells")!.slot).toBe("wondrous");
    expect(rows.find((row) => row.name === "Ioun Stone")!.slot).toBe("wondrous");
    for (const name of ["Horseshoes of Speed", "Horseshoes of a Zephyr"]) {
      expect(rows.find((row) => row.name === name)!.slot, name).toBe("wondrous");
    }
    // The one prose-derived slot, asserted so a regression in pass 2 is named.
    expect(rows.find((row) => row.name === "Wings of Flying")!.slot).toBe("shoulders");
  });

  it("reads the two qualifiers a naive category map gets wrong", () => {
    // Both qualifiers are printed in the parenthetical, after the category word.
    const ammunition = rows
      .filter((row) => row.slot === "ammunition")
      .map((row) => row.name)
      .sort();
    expect(ammunition).toEqual(["Ammunition of Slaying", "Ammunition, +1", "Ammunition, +2", "Ammunition, +3"]);
    expect(rows.find((row) => row.name === "Animated Shield")!.slot).toBe("shield");
  });

  it("reads each printed rarity, and a d100 rung as varies", () => {
    expect(histogram(rows.map((row) => row.rarity!))).toEqual({
      rare: 88,
      uncommon: 78,
      "very-rare": 61,
      legendary: 33,
      varies: 7,
      common: 2,
      artifact: 1
    });
    // `Horn of Valhalla`'s rung is a d100 roll in its description, so it is `varies` (seven rungs).
    expect(rows.find((row) => row.name === "Horn of Valhalla")!.rarity).toBe("varies");
    expect(rows.find((row) => row.name === "Horn of Valhalla")!.description).toContain(
      "Rare (Silver or Brass), Very Rare (Bronze), or Legendary (Iron)"
    );
  });

  it("requires attunement on 142 rows: the source's 140, plus the two extra Wand of the War Mage tiers", () => {
    expect(rows.filter((row) => row.attunement?.required === true)).toHaveLength(142);
    // The restriction clause is parsed into slugs, display-only and never enforced.
    expect(rows.find((row) => row.name === "Wand of the War Mage, +1")!.attunement).toEqual({
      required: true,
      restrictedTo: ["spellcaster"]
    });
    expect(rows.find((row) => row.name === "Robe of the Archmagi")!.attunement!.restrictedTo).toEqual([
      "sorcerer",
      "warlock",
      "wizard"
    ]);
    // Audiences that are not a class or species stay as one display-only slug.
    expect(rows.find((row) => row.name === "Dwarven Thrower")!.attunement!.restrictedTo).toEqual([
      "dwarf",
      "creature-attuned-to-a-belt-of-dwarvenkind"
    ]);
  });

  it("prices nothing, because the SRD prints a value band by rarity and not a per-item price", () => {
    expect(rows.filter((row) => row.costGp !== null)).toEqual([]);
    expect(rows.filter((row) => row.weightLb !== null)).toEqual([]);
  });

  it("carries no mechanics the overlay did not author: the ETL itself emits none", () => {
    /**
     * Every rider in the generated bundle must come from `scripts/item-mechanics/items.ts`; one
     * hand-edited into `magic-items.v1.json` would be destroyed by the next build.
     * `item-mechanics.test.ts` covers the other direction.
     */
    const authored = new Set(Object.keys(ITEM_MECHANICS));
    const withMechanics = rows.filter(
      (row) =>
        row.modifiers.length > 0 ||
        row.effects.length > 0 ||
        row.actions.length > 0 ||
        row.casts.length > 0 ||
        row.grantsFeatIds.length > 0 ||
        row.tags.length > 0 ||
        row.cursed
    );
    expect(
      withMechanics.filter((row) => !authored.has(row.id)).map((row) => row.name),
      "a rider in the generated bundle that items.ts does not author was hand-edited in, and the next build destroys it"
    ).toEqual([]);
    expect(rows.every((row) => row.isMagic)).toBe(true);
    expect(rows.every((row) => row.source === "srd")).toBe(true);
  });

  it("leads every description with the printed type line, so rarity and attunement reach a reader", () => {
    /**
     * The wire summary carries no `rarity`, so the description leads with the SRD type line to put
     * rarity and attunement in front of the reader.
     */
    expect(rows.find((row) => row.name === "Wand of the War Mage, +1")!.description).toBe(
      "Wand, Uncommon (Requires Attunement by a Spellcaster). While holding this wand, you gain a bonus to spell attack rolls determined by the wand's rarity. In addition, you ignore Half Cover when making a spell attack roll."
    );
    // The ladder's own rarity per tier, over the printed three-rung line.
    expect(rows.find((row) => row.name === "Wand of the War Mage, +3")!.description).toContain("Wand, Very Rare (");
    // `Armor of Resistance`'s d10 table rides in its text via `tableAsText`.
    expect(rows.find((row) => row.name === "Armor of Resistance")!.description).toContain("1d10 1: Damage Type Acid");
  });

  it("cuts no description, so the long d100 tables keep their last rows", () => {
    // The cap matches `InventoryItemSchema.description` (add-from-catalog copies this string onto it).
    const cut = rows.filter((row) => row.description!.endsWith(" […]")).map((row) => row.name);
    expect(cut).toEqual([]);
    const textOf = (name: string) => rows.find((row) => row.name === name)!.description!;
    // The GM rolls on these tables from the text, so the final rows must be there.
    expect(textOf("Wand of Wonder")).toContain("98\u201300: The creature closest to the chosen point of origin");
    expect(textOf("Mysterious Deck")).toContain("You draw no more cards.");
    expect(textOf("Mysterious Deck")).toContain("Void");
    // Spot-checks mechanics that a lower cap would cut.
    expect(textOf("Ring of Elemental Command")).toContain("save DC of 18");
    expect(textOf("Rod of Lordly Might")).toContain("Drain Life");
    expect(textOf("Staff of the Magi")).toContain("Retributive Strike");
    expect(textOf("Apparatus of the Crab")).toContain("escape DC 15");
  });

  it("mints no id that any other bundle already ships, and none twice", () => {
    /**
     * Expanding `Potions of Healing` into tiers would mint `potion-of-healing`, which `equipment.v1.json`
     * already ships; a collision would silently shadow one row in the folded catalog.
     */
    const elsewhere = new Map<string, string>();
    for (const record of loadEquipment().filter((item) => !item.isMagic))
      elsewhere.set(record.id, "the mundane catalog");
    for (const record of loadWeapons()) elsewhere.set(record.id, "weapons.v1.json");
    for (const record of loadArmor()) elsewhere.set(record.id, "armor.v1.json");
    const collisions = rows
      .filter((row) => elsewhere.has(row.id))
      .map((row) => `${row.id} also lives in ${elsewhere.get(row.id)}`);
    expect(collisions, "a minted id already exists elsewhere").toEqual([]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("mints a row for each stronger Potion of Healing, and leaves the common one to the gear catalog", () => {
    /**
     * The table's common strength is the priced gear `potion-of-healing`; minting it again would make this ETL
     * edit its own sibling input. Each other strength is its own item, with its own rarity and dice.
     */
    const catalog = loadEquipment();
    expect(catalog.find((item) => item.id === "potion-of-healing")).toMatchObject({ isMagic: false, costGp: 50 });
    expect(catalog.find((item) => item.id === "potions-of-healing")).toBeUndefined();
    const strengths = rows
      .filter((row) => /^Potion of Healing/.test(row.name))
      .map((row) => ({
        id: row.id,
        rarity: row.rarity,
        heals: row.actions.map((action) => [action.activation, action.healing?.formula]),
        used: row.consumedOnUse
      }));
    expect(strengths).toEqual([
      { id: "potion-of-healing-greater", rarity: "uncommon", heals: [["bonus-action", "4d4 + 4"]], used: true },
      { id: "potion-of-healing-superior", rarity: "rare", heals: [["bonus-action", "8d4 + 8"]], used: true },
      { id: "potion-of-healing-supreme", rarity: "very-rare", heals: [["bonus-action", "10d4 + 20"]], used: true }
    ]);
    // Each heals what its own row of the printed table says.
    for (const row of rows.filter((candidate) => /^Potion of Healing/.test(candidate.name))) {
      const printed = new RegExp(`${row.name.replace(/[()]/g, "\\$&")}: HP Regained ([0-9d+ ]+),`).exec(
        row.description ?? ""
      )?.[1];
      expect(printed, row.id).toBe(row.actions[0].healing?.formula);
    }
  });

  it("gives every magic shield the plain shield's armor block, so its own bonus stacks on the +2", () => {
    // AC derivation counts a shield only through its armor block; the rarity bonus is a separate rider.
    const plain = loadEquipment().find((item) => item.id === "shield")!.armor;
    expect(plain).toMatchObject({ acBase: 2 });
    const shields = rows.filter((row) => row.slot === "shield");
    expect(shields.filter((row) => JSON.stringify(row.armor) !== JSON.stringify(plain)).map((row) => row.id)).toEqual(
      []
    );
    expect(shields.map((row) => row.id)).toContain("shield-2");
  });

  it("reaches the addable catalog through the fourth fold, sorted in with everything else", () => {
    const catalog = loadEquipment();
    expect(catalog.filter((item) => item.isMagic)).toHaveLength(rows.length);
    // The fold gives every row the uniform `weapon`/`armor`-present shape the other three have; only a
    // shield carries an armor block of its own (see below), and only what is wielded as a weapon of its own a weapon
    // block (a staff as a Quarterstaff, the Rod of Lordly Might as a Mace, the Sun Blade as a Longsword).
    const magic = catalog.filter((item) => item.isMagic);
    expect(
      magic
        .filter((item) => item.weapon !== null)
        .map((item) => item.id)
        .sort()
    ).toEqual([
      "rod-of-lordly-might",
      "staff-of-power",
      "staff-of-striking",
      "staff-of-the-magi",
      "staff-of-the-woodlands",
      "staff-of-thunder-and-lightning",
      "staff-of-withering",
      "sun-blade"
    ]);
    expect(magic.filter((item) => item.armor !== null && item.slot !== "shield")).toEqual([]);
    const wand = catalog.find((item) => item.id === "wand-of-the-war-mage-1")!;
    expect(wand).toMatchObject({
      name: "Wand of the War Mage, +1",
      category: "wand",
      slot: "held",
      rarity: "uncommon"
    });
  });
});

/**
 * `appliesTo` is the data basis for binding a magic weapon, armor or piece of ammunition to a base item; the
 * player's pick is validated against `baseIds` server-side. Pinned per row (label) and per form (resolution).
 */
describe("the eligibility column", () => {
  it("carries the printed base qualifier for every weapon, armor and ammunition row, by name", () => {
    const labels = Object.fromEntries(rows.filter((row) => row.appliesTo).map((row) => [row.id, row.appliesTo!.label]));
    expect(labels, "a rebuild changed or dropped the appliesTo LABEL column").toEqual({
      "adamantine-armor": "Any Medium or Heavy, Except Hide Armor",
      "ammunition-1": "Any Ammunition",
      "ammunition-2": "Any Ammunition",
      "ammunition-3": "Any Ammunition",
      "ammunition-of-slaying": "Any Ammunition",
      "armor-1": "Any Light, Medium, or Heavy",
      "armor-2": "Any Light, Medium, or Heavy",
      "armor-3": "Any Light, Medium, or Heavy",
      "armor-of-invulnerability": "Plate Armor",
      "armor-of-resistance": "Any Light, Medium, or Heavy",
      "armor-of-vulnerability": "Any Light, Medium, or Heavy",
      "berserker-axe": "Battleaxe, Greataxe, or Halberd",
      "dagger-of-venom": "Dagger",
      "dancing-sword": "Greatsword, Longsword, Rapier, Scimitar, or Shortsword",
      defender: "Any Melee Weapon",
      "demon-armor": "Any Light, Medium, or Heavy",
      "dragon-scale-mail": "Scale Mail",
      "dragon-slayer": "Any Simple or Martial",
      "dwarven-plate": "Half Plate Armor or Plate Armor",
      "dwarven-thrower": "Warhammer",
      "energy-bow": "Longbow or Shortbow",
      "elven-chain": "Chain Mail or Chain Shirt",
      "flame-tongue": "Any Melee Weapon",
      "frost-brand": "Glaive, Greatsword, Longsword, Rapier, Scimitar, or Shortsword",
      "giant-slayer": "Any Simple or Martial",
      "glamoured-studded-leather": "Studded Leather Armor",
      "hammer-of-thunderbolts": "Maul or Warhammer",
      "holy-avenger": "Any Simple or Martial",
      "javelin-of-lightning": "Javelin",
      "luck-blade": "Glaive, Greatsword, Longsword, Rapier, Scimitar, Sickle, or Shortsword",
      "mace-of-disruption": "Mace",
      "mace-of-smiting": "Mace",
      "mace-of-terror": "Mace",
      "mithral-armor": "Any Medium or Heavy, Except Hide Armor",
      "nine-lives-stealer": "Any Simple or Martial",
      oathbow: "Longbow or Shortbow",
      "plate-armor-of-etherealness": "Half Plate Armor or Plate Armor",
      "quarterstaff-of-the-acrobat": "Quarterstaff",
      "scimitar-of-speed": "Scimitar",
      "sword-of-life-stealing": "Glaive, Greatsword, Longsword, Rapier, Scimitar, or Shortsword",
      "sword-of-sharpness": "Glaive, Greatsword, Longsword, or Scimitar",
      "sword-of-wounding": "Glaive, Greatsword, Longsword, Rapier, Scimitar, or Shortsword",
      "thunderous-greatclub": "Greatclub",
      "trident-of-fish-command": "Trident",
      "vicious-weapon": "Any Simple or Martial",
      "vorpal-sword": "Glaive, Greatsword, Longsword, or Scimitar",
      "weapon-1": "Any Simple or Martial",
      "weapon-2": "Any Simple or Martial",
      "weapon-3": "Any Simple or Martial",
      "weapon-of-warning": "Any Simple or Martial"
    });
  });

  it("resolves every printed form to the same base ids, pinned in full", () => {
    // Rows sharing a label must share the resolution, so the per-form table covers every row.
    const byLabel = new Map<string, readonly string[]>();
    for (const row of rows) {
      if (!row.appliesTo) continue;
      const previous = byLabel.get(row.appliesTo.label);
      if (previous)
        expect(row.appliesTo.baseIds, `${row.id} resolves "${row.appliesTo.label}" differently from a sibling`).toEqual(
          previous
        );
      byLabel.set(row.appliesTo.label, row.appliesTo.baseIds);
    }
    expect(Object.fromEntries(byLabel), "a rebuild changed a form's RESOLVED base list").toEqual({
      // The kinds the gear table sells: a magic arrow fits a bow, a magic bolt a crossbow.
      "Any Ammunition": [
        "arrows-20",
        "crossbow-bolts-20",
        "sling-bullets-20",
        "blowgun-needles-50",
        "firearm-bullets-10"
      ],
      "Any Light, Medium, or Heavy": [
        "breastplate",
        "chain-mail",
        "chain-shirt",
        "half-plate-armor",
        "hide-armor",
        "leather-armor",
        "padded-armor",
        "plate-armor",
        "ring-mail",
        "scale-mail",
        "splint-armor",
        "studded-leather-armor"
      ],
      "Any Medium or Heavy, Except Hide Armor": [
        "breastplate",
        "chain-mail",
        "chain-shirt",
        "half-plate-armor",
        "plate-armor",
        "ring-mail",
        "scale-mail",
        "splint-armor"
      ],
      "Any Melee Weapon": [
        "battleaxe",
        "club",
        "dagger",
        "flail",
        "glaive",
        "greataxe",
        "greatclub",
        "greatsword",
        "halberd",
        "handaxe",
        "javelin",
        "lance",
        "light-hammer",
        "longsword",
        "mace",
        "maul",
        "morningstar",
        "pike",
        "quarterstaff",
        "rapier",
        "scimitar",
        "shortsword",
        "sickle",
        "spear",
        "trident",
        "war-pick",
        "warhammer",
        "whip"
      ],
      "Any Simple or Martial": [
        "battleaxe",
        "blowgun",
        "club",
        "dagger",
        "dart",
        "flail",
        "glaive",
        "greataxe",
        "greatclub",
        "greatsword",
        "halberd",
        "hand-crossbow",
        "handaxe",
        "heavy-crossbow",
        "javelin",
        "lance",
        "light-crossbow",
        "light-hammer",
        "longbow",
        "longsword",
        "mace",
        "maul",
        "morningstar",
        "musket",
        "pike",
        "pistol",
        "quarterstaff",
        "rapier",
        "scimitar",
        "shortbow",
        "shortsword",
        "sickle",
        "sling",
        "spear",
        "trident",
        "war-pick",
        "warhammer",
        "whip"
      ],
      "Battleaxe, Greataxe, or Halberd": ["battleaxe", "greataxe", "halberd"],
      "Chain Mail or Chain Shirt": ["chain-mail", "chain-shirt"],
      Dagger: ["dagger"],
      "Glaive, Greatsword, Longsword, Rapier, Scimitar, Sickle, or Shortsword": [
        "glaive",
        "greatsword",
        "longsword",
        "rapier",
        "scimitar",
        "sickle",
        "shortsword"
      ],
      "Glaive, Greatsword, Longsword, Rapier, Scimitar, or Shortsword": [
        "glaive",
        "greatsword",
        "longsword",
        "rapier",
        "scimitar",
        "shortsword"
      ],
      "Glaive, Greatsword, Longsword, or Scimitar": ["glaive", "greatsword", "longsword", "scimitar"],
      Greatclub: ["greatclub"],
      "Greatsword, Longsword, Rapier, Scimitar, or Shortsword": [
        "greatsword",
        "longsword",
        "rapier",
        "scimitar",
        "shortsword"
      ],
      "Half Plate Armor or Plate Armor": ["half-plate-armor", "plate-armor"],
      Javelin: ["javelin"],
      "Longbow or Shortbow": ["longbow", "shortbow"],
      Mace: ["mace"],
      "Maul or Warhammer": ["maul", "warhammer"],
      "Plate Armor": ["plate-armor"],
      Quarterstaff: ["quarterstaff"],
      "Scale Mail": ["scale-mail"],
      Scimitar: ["scimitar"],
      "Studded Leather Armor": ["studded-leather-armor"],
      Trident: ["trident"],
      Warhammer: ["warhammer"]
    });
    // Every resolved id is a row of the base bundle it points into: the cross-bundle half.
    const weaponIds = new Set(loadWeapons().map((weapon) => weapon.id));
    const armorIds = new Set(loadArmor().map((piece) => piece.id));
    const ammunitionIds = new Set(
      loadEquipment()
        .filter((item) => item.ammunition)
        .map((item) => item.id)
    );
    for (const row of rows) {
      if (!row.appliesTo) continue;
      const pool = row.category === "weapon" ? weaponIds : row.category === "ammunition" ? ammunitionIds : armorIds;
      for (const id of row.appliesTo.baseIds)
        expect(pool.has(id), `${row.id}: base "${id}" is not in its base bundle`).toBe(true);
    }
  });

  it("is total on weapons, body armor and ammunition, and absent everywhere else", () => {
    const templates = new Set(["weapon", "armor", "ammunition"]);
    // The Sun Blade is a hilt that is its own blade, not a base made magic. The Energy Bow binds to its bow and changes
    // what it shoots (`weaponChanges`).
    expect(
      rows
        .filter((row) => templates.has(row.category) && !row.appliesTo)
        .map((row) => row.id)
        .sort()
    ).toEqual(["sun-blade"]);
    expect(rows.filter((row) => !templates.has(row.category) && row.appliesTo)).toEqual([]);
    // Magic ammunition is a piece of one kind, picked like a magic weapon's base; a shield carries its own block.
    expect(
      rows
        .filter((row) => row.category === "ammunition" && row.appliesTo)
        .map((row) => row.id)
        .sort()
    ).toEqual(["ammunition-1", "ammunition-2", "ammunition-3", "ammunition-of-slaying"]);
  });
});

describe("what a spent last charge does", () => {
  it("declares the outcome of every last charge's d20 whose 1 the SRD text prints", () => {
    const rolled = rows.filter((row) => row.charges?.lastChargeRoll);
    for (const row of rolled) {
      const printsOne = /roll 1d20\. On a 1\b/.test(row.description ?? "");
      expect(row.charges?.lastCharge !== undefined, `${row.id}: lastCharge`).toBe(printsOne);
    }
    // The Staff of the Magi's d20 prints only a 20.
    expect(rolled.filter((row) => row.charges?.lastCharge === undefined).map((row) => row.id)).toEqual([
      "staff-of-the-magi"
    ]);
  });

  it("ends the item where its text says the last charge or use does, with no d20", () => {
    const outcomes = Object.fromEntries(
      rows
        .filter((row) => row.charges?.lastCharge !== undefined && !row.charges.lastChargeRoll)
        .map((row) => [row.id, row.charges!.lastCharge])
    );
    expect(outcomes).toEqual({
      "bag-of-beans": "nonmagical",
      "candle-of-invocation": "destroyed",
      "chime-of-opening": "destroyed",
      "gem-of-brightness": "nonmagical",
      "necklace-of-fireballs": "destroyed",
      "ring-of-three-wishes": "nonmagical",
      "scarab-of-protection": "destroyed",
      "talisman-of-pure-good": "destroyed",
      "talisman-of-ultimate-evil": "destroyed"
    });
  });
});
