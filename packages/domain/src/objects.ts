/**
 * The SRD 5.2.1 tables for an object's statistics (Rules Glossary: Breaking Objects), shared by the server and the GM's
 * editor on the map: Armor Class by what an object is made of, and Hit Points by its size, fragile or resilient (the
 * table's averages). A Huge or Gargantuan object is tracked as Large sections.
 */

export const OBJECT_ARMOR_CLASS = {
  cloth: 11,
  paper: 11,
  rope: 11,
  crystal: 13,
  glass: 13,
  ice: 13,
  wood: 15,
  stone: 17,
  iron: 19,
  steel: 19,
  mithral: 21,
  adamantine: 23
} as const;
export type ObjectSubstance = keyof typeof OBJECT_ARMOR_CLASS;
export const OBJECT_SUBSTANCES = Object.keys(OBJECT_ARMOR_CLASS) as ObjectSubstance[];

export const OBJECT_HIT_POINTS = {
  tiny: { fragile: 2, resilient: 5 },
  small: { fragile: 3, resilient: 10 },
  medium: { fragile: 4, resilient: 18 },
  large: { fragile: 5, resilient: 27 }
} as const;
export type ObjectSize = keyof typeof OBJECT_HIT_POINTS;
export const OBJECT_SIZES = Object.keys(OBJECT_HIT_POINTS) as ObjectSize[];
