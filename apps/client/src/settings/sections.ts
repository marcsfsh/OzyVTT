/**
 * Settings as data: the sections the page lists in its bar and every setting in them, with the words the page shows.
 * The page and the search both read this, so a setting is found by the name it is shown with. Who sees a section is
 * structural: a player's page mounts only the sections `sectionsFor("player")` returns, so GM controls are never in
 * a player's tree.
 */

import { HEALTH_DISPLAY_LABEL, PLAYER_HITS, PLAYER_INITIATIVE } from "./table-words";

export type SettingsSectionId = "players" | "fights" | "characters" | "device" | "access" | "api";

export type SettingsSection = Readonly<{
  id: SettingsSectionId;
  label: string;
  /** One sentence under the section's heading. */
  hint: string;
  audience: "everyone" | "gm";
}>;

/** In the bar's order. Players leads because the join address is what a GM opens at every session. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "players", label: "Players", hint: "Who is at the table, and what they see of each other.", audience: "gm" },
  {
    id: "fights",
    label: "Encounters",
    hint: "How the rules assistant and the turn order treat an encounter.",
    audience: "gm"
  },
  { id: "characters", label: "Characters", hint: "How players build and level their characters.", audience: "gm" },
  { id: "device", label: "Device", hint: "Choices for this device alone.", audience: "everyone" },
  {
    id: "access",
    label: "Access",
    hint: "Who can sign in as the GM, and which tools can reach this table.",
    audience: "gm"
  },
  { id: "api", label: "API", hint: "Every operation this server answers, with examples.", audience: "gm" }
];

export function sectionsFor(role: "gm" | "player"): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => role === "gm" || section.audience === "everyone");
}

/** The section a role lands on at `/settings`. */
export const homeSection = (role: "gm" | "player"): SettingsSectionId => (role === "gm" ? "players" : "device");

export const isSettingsSection = (value: string | undefined): value is SettingsSectionId =>
  SETTINGS_SECTIONS.some((section) => section.id === value);

export const pathForSection = (id: SettingsSectionId) => `/settings/${id}`;

/** One setting: its label and a sentence of hint as the page shows them, and other words a GM might search for. */
export type SettingEntry = Readonly<{
  id: string;
  section: SettingsSectionId;
  label: string;
  hint: string;
  /** Who sees this one, when it differs from its section (a GM row in Device). */
  audience?: "gm";
  words?: string;
}>;

const entries = <const T extends Record<string, Omit<SettingEntry, "id">>>(table: T) =>
  Object.fromEntries(Object.entries(table).map(([id, entry]) => [id, { id, ...entry }])) as {
    [K in keyof T]: SettingEntry;
  };

export const SETTING = entries({
  joinAddress: {
    section: "players",
    label: "Join address",
    hint: "Share it at the start of each session so players can join.",
    words: "join link url qr code wifi invite"
  },
  partyVisibility: {
    section: "players",
    label: "What players see of each other",
    hint: "Each player always has their own character in full.",
    words: "party sheet visibility other characters"
  },
  atTheTable: {
    section: "players",
    label: "At the table",
    hint: "The characters players have claimed, and whether each player is connected.",
    words: "connected claimed release token image presence"
  },
  rulesAssistant: {
    section: "fights",
    label: "Rules assistant",
    hint: "Each encounter starts with this, and you can change it mid-encounter on the Table.",
    words: "enforce advise off dial rules checks movement action economy spell slots targeting"
  },
  playerHits: {
    section: "fights",
    label: PLAYER_HITS.label,
    hint: "Whether a player's damage waits for you to apply it.",
    words: "damage apply proposal"
  },
  playerInitiative: {
    section: "fights",
    label: PLAYER_INITIATIVE.label,
    hint: "When players roll their own initiative, whether turns wait for every roll.",
    words: "turn order roll initiative"
  },
  d20Dice: {
    section: "fights",
    label: "Players' d20 rolls",
    hint: "Attacks, checks, saves, initiative and death saves, unless an encounter chooses its own.",
    words: "physical dice type manual roll total face d20"
  },
  damageDice: {
    section: "fights",
    label: "Players' damage",
    hint: "Damage dice, unless an encounter chooses its own.",
    words: "physical dice type manual roll total face damage healing"
  },
  targeting: {
    section: "fights",
    label: "Who picks targets",
    hint: "In an encounter, the player aims their own actions, or asks you to choose.",
    words: "target targeting aim choose pick gm player attack spell"
  },
  healthDisplay: {
    section: "fights",
    label: HEALTH_DISPLAY_LABEL,
    hint: "Each token's own menu can change it for that token.",
    words: "hit points bar ring aura badge bloodied"
  },
  newTokens: {
    section: "fights",
    label: "New tokens",
    hint: "Whether a newly staged character or monster starts shown to players.",
    words: "staging hidden shown reveal tokens"
  },
  playerBuilder: {
    section: "characters",
    label: "Who builds characters",
    hint: "When this is off, only you can build and level characters.",
    words: "builder level up create character"
  },
  maxLevel: {
    section: "characters",
    label: "Max party level",
    hint: "Players can build and level their own characters up to this level.",
    words: "level cap maximum"
  },
  abilityMethods: {
    section: "characters",
    label: "Ability scores",
    hint: "Players choose from the methods that are on, and at least one stays on.",
    words: "standard array point buy roll custom formula 4d6"
  },
  hitPointRolls: {
    section: "characters",
    label: "Hit point rolls",
    hint: "A character who rolls hit points on a new level never gets less than the average.",
    words: "hp average minimum floor"
  },
  randomCharacters: {
    section: "characters",
    label: "Random characters",
    hint: "You can always roll one, and this lets players roll their own.",
    words: "random generate"
  },
  theme: {
    section: "device",
    label: "Theme",
    hint: "It applies to this device alone.",
    words: "dusk dawn dark light night day colours appearance"
  },
  reduceTransparency: {
    section: "device",
    label: "Reduce transparency",
    hint: "Panels turn solid, and the glows go.",
    words: "transparency blur glass solid glow contrast accessibility"
  },
  rollInput: {
    section: "device",
    label: "How you roll",
    hint: "With I roll my dice, you type what your own dice show.",
    words: "physical dice auto roll manual"
  },
  pinchZoom: {
    section: "device",
    label: "Pinch zoom",
    hint: "Two fingers on a touch screen zoom the whole page while this is on, and maps zoom with two fingers either way.",
    words: "zoom pinch magnify enlarge double tap accessibility phone tablet"
  },
  arrangeScenes: {
    section: "device",
    audience: "gm",
    label: "Arrange new encounters",
    hint: "A new encounter opens on your table first, so you can place tokens before players see it.",
    words: "staging preview encounter arrange"
  },
  leaveTable: {
    section: "device",
    label: "Leave the table",
    hint: "Your character stays yours, and you can join again on this device.",
    words: "sign out quit leave"
  },
  gmPassword: {
    section: "access",
    label: "GM password",
    hint: "Changing it keeps you signed in here and signs out every other GM browser.",
    words: "password change sign in"
  },
  signOut: {
    section: "access",
    label: "Sign out",
    hint: "This browser asks for the GM password again next time.",
    words: "log out sign out"
  },
  everyGmBrowser: {
    section: "access",
    label: "Every GM browser",
    hint: "Use this when a device you signed in on is lost, and sign in again here after.",
    words: "revoke sessions lost device"
  },
  credentials: {
    section: "access",
    label: "Integration credentials",
    hint: "A credential lets a tool such as a stream overlay reach this table with the scopes you pick.",
    words: "api key token bot overlay scopes rotate revoke"
  },
  apiReference: {
    section: "api",
    label: "API reference",
    hint: "Every operation this server answers, with its request, responses and examples.",
    words: "openapi endpoints operations http rest spec"
  }
});

/** Every setting a role can reach, for the search. */
export function settingsFor(role: "gm" | "player"): readonly SettingEntry[] {
  const sections = new Set(sectionsFor(role).map((section) => section.id));
  return Object.values(SETTING).filter(
    (entry) =>
      sections.has(entry.section) &&
      (role === "gm" || entry.audience !== "gm") &&
      // Leaving is a player's door; the GM signs out in Access.
      !(role === "gm" && entry.id === "leaveTable")
  );
}

/** The settings whose label, hint or words hold every word typed, best first: label matches lead. */
export function searchSettings(entries: readonly SettingEntry[], query: string): readonly SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const label = (entry: SettingEntry) => entry.label.toLowerCase();
  const text = (entry: SettingEntry) => `${entry.label} ${entry.hint} ${entry.words ?? ""}`.toLowerCase();
  return entries
    .filter((entry) => words.every((word) => text(entry).includes(word)))
    .sort(
      (a, b) => Number(words.every((w) => label(b).includes(w))) - Number(words.every((w) => label(a).includes(w)))
    );
}

/** The element id a setting's row carries, so the search can bring it into view. */
export const settingAnchor = (id: string) => `setting-${id}`;
