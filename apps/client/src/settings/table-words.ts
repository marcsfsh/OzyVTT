import type { RuleMode } from "@vtt/domain";

// The table settings' words, shared by Settings and the fight's options so one setting has one name in both places.

/**
 * The rules dial. The wire stays `strict | assisted | freeform`: three schemas, the archive documents and the public
 * API speak it, so renaming it would be a breaking change.
 */
export const DIAL_COPY: ReadonlyArray<Readonly<{ value: RuleMode; label: string; help: string }>> = [
  { value: "strict", label: "Enforce", help: "Enforce blocks an illegal move until you allow it." },
  { value: "assisted", label: "Advise", help: "Advise allows every move and leaves a note on an illegal one." },
  { value: "freeform", label: "Off", help: "Off checks nothing and shows no prompts." }
];
export const dialLabel = (mode: RuleMode) => DIAL_COPY.find((entry) => entry.value === mode)?.label ?? mode;
/** One setting's help, a sentence that starts with its name, for a list of the three. */
export const dialLine = (entry: (typeof DIAL_COPY)[number]) => entry.help;

/** Whether a player's hit waits for the GM's Apply. */
export const PLAYER_HITS = {
  label: "Players' hits",
  options: [
    { value: "proposal", label: "Applied by the GM" },
    { value: "direct", label: "Applied immediately" }
  ]
} as const;

/** When turns start while players roll their own initiative. */
export const PLAYER_INITIATIVE = {
  label: "Players' initiative",
  options: [
    { value: "immediate", label: "Start turns immediately" },
    { value: "wait", label: "Wait until everyone has rolled" }
  ]
} as const;

/** The health display's name, and who sees it. */
export const HEALTH_DISPLAY_LABEL = "Health display";
export const HEALTH_AUDIENCE_LABEL = "Health is";
/** Why "Health is" has no choice for a status badge. */
export const BADGE_AUDIENCE_REASON = "A status badge shows to everyone, so it has no GM-only setting.";

/** The label for one option of a setting, by its wire value. */
export const optionLabel = (
  setting: Readonly<{ options: ReadonlyArray<{ value: string; label: string }> }>,
  value: string
) => setting.options.find((option) => option.value === value)?.label ?? value;
