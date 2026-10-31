import type { GmView } from "@vtt/domain";
import { THEME_NAMES, type Theme } from "@vtt/ui";
import type { SettingsSectionId } from "./sections";
import { FAMILY_COPY } from "./FightsSection";
import { PARTY_VISIBILITY_OPTIONS } from "./PlayersSection";
import { PLAYER_HITS, dialLabel, optionLabel } from "./table-words";

/** What a device holds for itself, which the GM's state doesn't carry. */
export type DeviceFacts = Readonly<{
  theme: Theme;
  rollInput: "digital" | "manual";
  pinchZoom: boolean;
  /** Active integration credentials, or null before they are read. */
  activeCredentials: number | null;
}>;

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** A count of things the GM set, as Settings' lines say it: words up to ten ("six checks"), digits past it. People and
 *  credentials stay digits, as the mockup writes them ("3 at the table", "2 credentials active"). */
export const countWords = (count: number, one: string, many: string) =>
  `${count <= 10 ? WORDS[count] : count} ${count === 1 ? one : many}`;

const lower = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);

/**
 * The one line under each section's name in Settings' list (settings spec 2.1): what it holds now, in the settings'
 * own words, joined with " · ". The GM's sections read the GM's state; Device and Access read what the device knows.
 */
export function sectionLine(id: SettingsSectionId, gm: GmView | null, device: DeviceFacts): string {
  if (id === "device")
    return [
      THEME_NAMES[device.theme],
      device.rollInput === "manual" ? "you roll" : "auto-roll",
      `pinch zoom ${device.pinchZoom ? "on" : "off"}`
    ].join(" · ");
  if (id === "api") return "Every operation, with examples";
  if (id === "access")
    return device.activeCredentials === null
      ? "GM password and credentials"
      : `${device.activeCredentials} ${device.activeCredentials === 1 ? "credential" : "credentials"} active`;
  if (!gm) return "";
  if (id === "players") {
    const atTable = gm.actors.filter(
      (actor) => actor.kind === "player-character" && !actor.archived && actor.ownerSessionId !== null
    ).length;
    const seen = PARTY_VISIBILITY_OPTIONS.find((option) => option.value === gm.partyVisibility)?.label ?? "";
    return ["Join address", lower(seen), `${atTable} at the table`].filter(Boolean).join(" · ");
  }
  if (id === "fights") {
    const policy = gm.rulesPolicy;
    const checks =
      policy.dial === "freeform"
        ? "checks nothing"
        : countWords(
            FAMILY_COPY.filter(({ family }) => policy.exceptions[family] !== "freeform").length,
            "check",
            "checks"
          );
    return [dialLabel(policy.dial), checks, `hits ${lower(optionLabel(PLAYER_HITS, gm.combat.playerDamageMode))}`].join(
      " · "
    );
  }
  // Characters.
  const builder = gm.builderPolicy;
  return [
    builder.playerBuilder === "open" ? "Players build" : "Only you build",
    `level ${builder.maxLevel}`,
    countWords(builder.allowedAbilityMethods.length, "method", "methods")
  ].join(" · ");
}
