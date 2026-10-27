import type { SpellWalls } from "../src/schemas.js";

/**
 * What each SRD 5.2.1 spell does to the map's walls and doors, read from its text and reviewed: the walls its placed
 * area raises, what its cast does to the door it is aimed at, the gap it cuts in a wall, and the objects it destroys.
 * The server applies it on the live map (`apps/server/src/spell-walls.ts`).
 */
const SPELL_WALLS: Readonly<Record<string, SpellWalls>> = {
  // "An Invisible wall of force ... Nothing can physically pass through the wall. It is immune to all damage ... A
  // Disintegrate spell destroys the wall instantly." Invisible, so sight passes; a creature it cuts is pushed aside.
  // "A hemispherical dome or a globe with a radius of up to 10 feet" is raised round the circle its form places.
  "wall-of-force": { raises: { kind: "window", pushes: true, force: true } },
  // "Each panel has AC 15 and 30 Hit Points per inch of thickness, and it has Immunity to Poison and Psychic damage":
  // the 6-inch panels, 180 Hit Points each, or the "10-foot-by-20-foot panels that are only 3 inches thick", 90 each.
  // "If you maintain your Concentration on this spell for its full duration, the wall becomes permanent."
  "wall-of-stone": {
    raises: {
      kind: "wall",
      panelFeet: 10,
      panel: { name: "Stone panel", armorClass: 15, hitPoints: 180, immunities: ["poison", "psychic"] },
      pushes: true,
      permanentAfterFull: true,
      forms: [
        {
          option: "thin",
          panelFeet: 20,
          panel: { name: "Thin stone panel", armorClass: 15, hitPoints: 90, immunities: ["poison", "psychic"] }
        }
      ]
    }
  },
  // "It has AC 12 and 30 Hit Points per 10-foot section, and it has Immunity to Cold, Poison, and Psychic damage and
  // Vulnerability to Fire damage." The text calls it no more than solid, so sight passes and movement doesn't.
  "wall-of-ice": {
    raises: {
      kind: "window",
      panelFeet: 10,
      panel: { name: "Ice section", armorClass: 12, hitPoints: 30, immunities: ["cold"], vulnerabilities: ["fire"] },
      pushes: true
    }
  },
  // The cage: "1/2-inch diameter bars spaced 1/2 inch apart", which no creature passes; sight, attacks and spells go
  // between them. The 10-foot solid box is the GM's to draw.
  forcecage: { raises: { kind: "bars", pushes: true, force: true } },
  // "A target that is held shut by a mundane lock or that is stuck or barred becomes unlocked, unstuck, or unbarred."
  knock: { door: "knock" },
  // "You touch a closed door ... and magically lock it."
  "arcane-lock": { door: "arcane-lock" },
  // "All doors in the warded area are magically locked, as if sealed by the Arcane Lock spell", for the caster and the
  // creatures it names (its allies here), until the 24 hours are up.
  "guards-and-wards": { locksDoorsInArea: true },
  // "open an unlocked door or container".
  "mage-hand": { door: "open-or-close" },
  // Invisible Hand: "an unlocked door or window to fly open or slam shut".
  thaumaturgy: { door: "open-or-close" },
  // Beckon Air: "close open doors and shutters".
  elementalism: { door: "close" },
  // "You could also shape a stone door or its frame to seal the door shut", or "make a small passage through a wall
  // that is 5 feet thick".
  "stone-shape": { door: "seal", cuts: { feet: 5, lasting: true } },
  // "A passage appears ... up to 5 feet wide ... and lasts for the duration."
  passwall: { cuts: { feet: 5, lasting: false } },
  // "A Large or smaller object or a creation of magical force is disintegrated without a saving throw."
  disintegrate: { disintegrates: true }
};

/** The spell's walls and doors, when it has any. */
export function spellWallsFor(id: string): SpellWalls | undefined {
  const walls = SPELL_WALLS[id];
  return walls ? structuredClone(walls) : undefined;
}

/** Every spell id the table names, for the build's check that each is a real spell. */
export const SPELL_WALLS_IDS: readonly string[] = Object.keys(SPELL_WALLS);
