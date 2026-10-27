/* The default pictures (DESIGN.md, Pictures and default avatars). Each is a 64 by 64 SVG that keeps what matters
   inside the inscribed circle, so it works square as a portrait and round as a token. The URLs are static entries
   the bundler resolves, so no page fetches a file path at runtime. */

/** The nineteen general avatars in their fixed order. The order is part of the pick: never reorder it. */
export const GENERAL_AVATARS = [
  "horizon",
  "moonrise",
  "palm",
  "d20",
  "blades",
  "claws",
  "orbit",
  "pyramid",
  "bolt",
  "cassette",
  "shades",
  "joystick",
  "gem",
  "flame",
  "waves",
  "pines",
  "horns",
  "paw",
  "vortex"
] as const;
export type GeneralAvatar = (typeof GENERAL_AVATARS)[number];

/** The SRD 5.2.1 classes that have an avatar of their own, by class id. */
export const CLASS_AVATARS = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard"
] as const;
export type ClassAvatar = (typeof CLASS_AVATARS)[number];

/** Static is reserved for an explicit anonymous-identity state that a projection supplies; nothing picks it today. */
export type AvatarId = GeneralAvatar | `class-${ClassAvatar}` | "static";

const URLS: Readonly<Record<AvatarId, string>> = {
  horizon: new URL("./horizon.svg", import.meta.url).href,
  moonrise: new URL("./moonrise.svg", import.meta.url).href,
  palm: new URL("./palm.svg", import.meta.url).href,
  d20: new URL("./d20.svg", import.meta.url).href,
  blades: new URL("./blades.svg", import.meta.url).href,
  claws: new URL("./claws.svg", import.meta.url).href,
  orbit: new URL("./orbit.svg", import.meta.url).href,
  pyramid: new URL("./pyramid.svg", import.meta.url).href,
  bolt: new URL("./bolt.svg", import.meta.url).href,
  cassette: new URL("./cassette.svg", import.meta.url).href,
  shades: new URL("./shades.svg", import.meta.url).href,
  joystick: new URL("./joystick.svg", import.meta.url).href,
  gem: new URL("./gem.svg", import.meta.url).href,
  flame: new URL("./flame.svg", import.meta.url).href,
  waves: new URL("./waves.svg", import.meta.url).href,
  pines: new URL("./pines.svg", import.meta.url).href,
  horns: new URL("./horns.svg", import.meta.url).href,
  paw: new URL("./paw.svg", import.meta.url).href,
  vortex: new URL("./vortex.svg", import.meta.url).href,
  "class-barbarian": new URL("./class-barbarian.svg", import.meta.url).href,
  "class-bard": new URL("./class-bard.svg", import.meta.url).href,
  "class-cleric": new URL("./class-cleric.svg", import.meta.url).href,
  "class-druid": new URL("./class-druid.svg", import.meta.url).href,
  "class-fighter": new URL("./class-fighter.svg", import.meta.url).href,
  "class-monk": new URL("./class-monk.svg", import.meta.url).href,
  "class-paladin": new URL("./class-paladin.svg", import.meta.url).href,
  "class-ranger": new URL("./class-ranger.svg", import.meta.url).href,
  "class-rogue": new URL("./class-rogue.svg", import.meta.url).href,
  "class-sorcerer": new URL("./class-sorcerer.svg", import.meta.url).href,
  "class-warlock": new URL("./class-warlock.svg", import.meta.url).href,
  "class-wizard": new URL("./class-wizard.svg", import.meta.url).href,
  static: new URL("./static.svg", import.meta.url).href
};

/** The bundled URL of an avatar. */
export function avatarUrl(id: AvatarId): string {
  return URLS[id];
}

/** Unsigned 32-bit FNV-1a over the id's UTF-16 code units, unnormalized, so an opaque id keeps its picture. */
export function avatarHash(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** The general avatar an actor keeps, picked by its actor id alone. Never pass a definition id or a name. */
export function generalAvatarFor(actorId: string): GeneralAvatar {
  return GENERAL_AVATARS[avatarHash(actorId) % GENERAL_AVATARS.length];
}

const isClassAvatar = (id: string): id is ClassAvatar => (CLASS_AVATARS as readonly string[]).includes(id);

/**
 * The main class's avatar: the class with the most levels, the first taken on a tie. A homebrew winner has no avatar
 * of its own, so it gives null and the general pick applies.
 */
export function classAvatarFor(classes: ReadonlyArray<Readonly<{ id: string; level: number }>>): AvatarId | null {
  let main: Readonly<{ id: string; level: number }> | undefined;
  for (const entry of classes) if (!main || entry.level > main.level) main = entry;
  return main && isClassAvatar(main.id) ? `class-${main.id}` : null;
}

/**
 * The default picture for an actor: its main class's avatar when the viewer's data holds its classes, else the general
 * pick by actor id. Pass `classes` only from what the viewer's projection already includes.
 */
export function defaultAvatarFor(
  actorId: string,
  classes?: ReadonlyArray<Readonly<{ id: string; level: number }>>
): AvatarId {
  return (classes && classAvatarFor(classes)) || generalAvatarFor(actorId);
}
