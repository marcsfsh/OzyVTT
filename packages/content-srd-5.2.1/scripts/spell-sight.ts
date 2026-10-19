import type { SightEffect } from "@vtt/schemas";

/**
 * What each SRD 5.2.1 spell does to light and sight while it lasts, read from its text and reviewed: the light it sheds,
 * the fog or magical Darkness it fills, and the spell light or Darkness it dispels. Dynamic vision reads it
 * (`apps/server/src/vision/cast-sight.ts`). A light a creature carries because the spell's effect lands on it (Faerie
 * Fire's outline, Starry Wisp) rides that effect in `spell-effects.ts` instead.
 */
const SPELL_SIGHT: Readonly<Record<string, SightEffect>> = {
  // "The object sheds Bright Light in a 20-foot radius and Dim Light for an additional 20 feet": on the creature
  // touched (the object it carries), else the caster's own.
  light: { light: { on: "targets", brightFeet: 20, dimFeet: 20 } },
  // "The effect casts Bright Light in a 20-foot radius and Dim Light for an additional 20 feet", until dispelled.
  "continual-flame": { light: { on: "targets", brightFeet: 20, dimFeet: 20 } },
  // "You create up to four torch-size lights ... each light sheds Dim Light in a 10 foot radius."
  "dancing-lights": { light: { on: "point", brightFeet: 0, dimFeet: 10, count: 4 } },
  // "Sunlight spreads from a point ... and fills a 60-foot-radius Sphere. The sunlight's area is Bright Light and sheds
  // Dim Light for an additional 60 feet", and it dispels Darkness of level 3 or lower that it overlaps.
  daylight: {
    light: { on: "area", brightFeet: 60, dimFeet: 60, sunlight: true },
    dispels: { kind: "darkness", upToLevel: 3 }
  },
  // "Magical Darkness ... fills a 15-foot-radius Sphere. Darkvision can't see through it, and nonmagical light can't
  // illuminate it", and it dispels spell light of level 2 or lower that it overlaps.
  darkness: { area: { kind: "magical-darkness" }, dispels: { kind: "light", upToLevel: 2 } },
  // "This spell dispels Darkness in its area that was created by any spell."
  sunburst: { dispels: { kind: "darkness" } },
  "fog-cloud": { area: { kind: "heavily-obscured" } },
  "stinking-cloud": { area: { kind: "heavily-obscured" } },
  cloudkill: { area: { kind: "heavily-obscured" } },
  "incendiary-cloud": { area: { kind: "heavily-obscured" } },
  "sleet-storm": { area: { kind: "heavily-obscured" } },
  "insect-plague": { area: { kind: "lightly-obscured" } },
  web: { area: { kind: "lightly-obscured" } },
  // "It disperses gas or vapor": the fog and clouds its Line overlaps end.
  "gust-of-wind": { dispels: { kind: "fog" } },
  // "Until the spell ends, Dim Light fills the Cylinder."
  moonbeam: { light: { on: "area", brightFeet: 0, dimFeet: 5 } },
  // "Until the spell ends, Bright Light fills the Cylinder."
  "conjure-celestial": { light: { on: "area", brightFeet: 10, dimFeet: 0 } },
  // "It sheds Bright Light in a 20-foot radius and Dim Light for an additional 20 feet."
  "flaming-sphere": { light: { on: "area", brightFeet: 20, dimFeet: 20 } },
  "flame-blade": { light: { on: "caster", brightFeet: 10, dimFeet: 10 } },
  "produce-flame": { light: { on: "caster", brightFeet: 20, dimFeet: 20 } },
  "fire-shield": { light: { on: "caster", brightFeet: 10, dimFeet: 10 } },
  // "A mote of brilliant radiance shines above you ... It sheds Bright Light in a 30-foot radius and Dim Light for an
  // additional 30 feet. This light is sunlight."
  sunbeam: { light: { on: "caster", brightFeet: 30, dimFeet: 30, sunlight: true } }
};

/** The spell's sight, when it has one. */
export function spellSightFor(id: string): SightEffect | undefined {
  const sight = SPELL_SIGHT[id];
  return sight ? structuredClone(sight) : undefined;
}

/** Every spell id the table names, for the build's check that each is a real spell. */
export const SPELL_SIGHT_IDS: readonly string[] = Object.keys(SPELL_SIGHT);
