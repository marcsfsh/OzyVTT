/**
 * The Material components a cast needs in hand (SRD 5.2.1 "Components"): each one the text gives a worth ("a diamond
 * worth 300+ GP") or says the spell consumes, since a Component Pouch or a Spellcasting Focus stands in only for the
 * free ones. Read once at build time into `SpellReference.components.costly`, so the server never reads the prose. A
 * carried item is the material when it is one of `itemIds` or its name holds one of `matches`.
 * `test/spell-materials.test.ts` checks that every priced or consumed material has a row.
 */
import type { SpellMaterial } from "../src/schemas.js";

const gem = (name: string, costGp: number, consumed: boolean, matches: readonly string[] = [name]): SpellMaterial => ({
  name,
  matches: [...matches],
  costGp,
  consumed
});

const COSTLY: Readonly<Record<string, readonly SpellMaterial[]>> = {
  "arcane-lock": [gem("gold dust", 25, true)],
  "arcane-sword": [gem("miniature sword", 250, false)],
  "astral-projection": [
    { ...gem("jacinth", 1000, true), perTarget: true },
    { ...gem("silver bar", 100, true), perTarget: true }
  ],
  augury: [gem("divinatory tokens", 25, false, ["divinatory", "marked sticks", "marked bones", "cards"])],
  awaken: [gem("agate", 1000, true)],
  bless: [
    {
      name: "Holy Symbol",
      matches: ["holy symbol"],
      itemIds: ["holy-symbol-amulet", "holy-symbol-emblem", "holy-symbol-reliquary"],
      costGp: 5,
      consumed: false
    }
  ],
  "chromatic-orb": [gem("diamond", 50, false)],
  "circle-of-death": [gem("black pearl", 500, false)],
  clairvoyance: [gem("jeweled horn or glass eye", 100, false, ["jeweled horn", "glass eye"])],
  clone: [gem("diamond", 1000, true), gem("sealable vessel", 2000, false, ["vessel"])],
  contingency: [gem("statuette of yourself", 1500, false, ["statuette"])],
  "continual-flame": [gem("ruby dust", 50, true, ["ruby"])],
  "create-undead": [{ ...gem("black onyx stone", 150, false, ["onyx"]), perTarget: true }],
  divination: [gem("incense", 25, true)],
  "find-familiar": [gem("incense", 10, true)],
  "find-the-path": [gem("divination tools", 100, false, ["divination tools", "cards", "runes"])],
  forbiddance: [gem("ruby dust", 1000, false, ["ruby"])],
  forcecage: [gem("ruby dust", 1500, true, ["ruby"])],
  gate: [gem("diamond", 5000, false)],
  "gentle-repose": [{ name: "2 Copper Pieces", costGp: null, consumed: true, coins: { unit: "cp", amount: 2 } }],
  "glyph-of-warding": [gem("powdered diamond", 200, true, ["diamond"])],
  "greater-restoration": [gem("diamond dust", 100, true, ["diamond"])],
  "guards-and-wards": [gem("silver rod", 10, false)],
  hallow: [gem("incense", 1000, true)],
  "heroes-feast": [gem("gem-encrusted bowl", 1000, true, ["bowl"])],
  "holy-aura": [gem("reliquary", 1000, false)],
  identify: [gem("pearl", 100, false)],
  "illusory-script": [{ name: "ink", itemIds: ["ink"], matches: ["bottle of ink"], costGp: 10, consumed: true }],
  imprisonment: [gem("statuette of the target", 5000, false, ["statuette"])],
  "instant-summons": [gem("sapphire", 1000, false)],
  "legend-lore": [gem("incense", 250, true), { ...gem("ivory strips", 50, false, ["ivory"]), count: 4 }],
  "magic-circle": [gem("salt and powdered silver", 100, true, ["powdered silver", "silver dust"])],
  "magic-jar": [gem("gem, crystal or reliquary", 500, false, ["gem", "crystal", "reliquary"])],
  "magic-mouth": [gem("jade dust", 10, true, ["jade"])],
  "magnificent-mansion": [gem("miniature door", 15, false)],
  nondetection: [gem("diamond dust", 25, true, ["diamond"])],
  "planar-binding": [gem("jewel", 1000, true, ["jewel", "gem"])],
  "plane-shift": [gem("forked metal rod", 250, false, ["forked"])],
  "programmed-illusion": [gem("jade dust", 25, false, ["jade"])],
  "project-image": [gem("statuette of yourself", 5, false, ["statuette"])],
  "protection-from-evil-and-good": [
    { name: "Holy Water", itemIds: ["holy-water"], matches: ["holy water"], costGp: 25, consumed: true }
  ],
  "raise-dead": [gem("diamond", 500, true)],
  reincarnate: [gem("rare oils", 1000, true, ["rare oil"])],
  resurrection: [gem("diamond", 1000, true)],
  revivify: [gem("diamond", 300, true)],
  scrying: [gem("crystal ball, mirror or font", 1000, false, ["crystal ball", "mirror", "font"])],
  "secret-chest": [
    gem("chest of rare materials", 5000, false, ["chest"]),
    gem("Tiny replica of the chest", 50, false, ["replica"])
  ],
  sequester: [gem("gem dust", 5000, true, ["gem"])],
  shapechange: [gem("jade circlet", 1500, false, ["circlet"])],
  simulacrum: [gem("powdered ruby", 1500, true, ["ruby"])],
  stoneskin: [gem("diamond dust", 100, true, ["diamond"])],
  "summon-dragon": [gem("object engraved with a dragon", 500, false, ["dragon"])],
  symbol: [gem("powdered diamond", 1000, true, ["diamond"])],
  "teleportation-circle": [gem("rare inks", 50, true, ["rare ink"])],
  "true-resurrection": [gem("diamonds", 25000, true, ["diamond"])],
  "true-seeing": [gem("mushroom powder", 25, true, ["mushroom"])],
  "warding-bond": [{ ...gem("platinum rings", 50, false, ["platinum ring"]), count: 2 }]
};

/** The costly materials of one spell, or undefined when its material (if any) is free. */
export function costlyMaterialsFor(id: string): SpellMaterial[] | undefined {
  const rows = COSTLY[id];
  return rows ? rows.map((row) => structuredClone(row)) : undefined;
}

/** The reviewed ids, so a test can check every row names a real spell. */
export const SPELL_MATERIAL_IDS: readonly string[] = Object.keys(COSTLY);
