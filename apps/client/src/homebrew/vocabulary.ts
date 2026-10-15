/** Option lists and rider types shared by the record forms and the rider forms. */

import { CONDITION_IDS, DAMAGE_TYPE_IDS } from "@vtt/content-srd-5.2.1/schemas";
import { type SelectOption, opt, suggestionLabel } from "./schema";

export type RiderKind = "modifiers" | "grants" | "uses" | "tags" | "actions" | "effects";

/** Which carrier mounts this form. A stat block's attack is `ActionSchema.attack` with a required
    flat `bonus`, while feature and item actions (`FeatureActionSchema`) name an `ability`, so scope
    is three-valued. `"item"` is feature-shaped for actions and differs only in carrier rules. */
export type RiderScope = "feature" | "item" | "statblock";

export const ABILITIES = [
  opt("str", "Strength"),
  opt("dex", "Dexterity"),
  opt("con", "Constitution"),
  opt("int", "Intelligence"),
  opt("wis", "Wisdom"),
  opt("cha", "Charisma")
];

/* Riders name damage types and conditions from the SRD's closed sets, so these are choices, never free text. */
export const DAMAGE_TYPES: readonly SelectOption[] = DAMAGE_TYPE_IDS.map((id) => opt(id, suggestionLabel(id)));
export const CONDITIONS: readonly SelectOption[] = CONDITION_IDS.map((id) => opt(id, suggestionLabel(id)));

export const SIZES = [
  opt("tiny", "Tiny"),
  opt("small", "Small"),
  opt("medium", "Medium"),
  opt("large", "Large"),
  opt("huge", "Huge"),
  opt("gargantuan", "Gargantuan")
];
