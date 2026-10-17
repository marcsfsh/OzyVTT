/** One wizard per homebrew type. */

import type { HomebrewType } from "../types";
import { MONSTER_WIZARD } from "./monster";
import { SPELL_WIZARD } from "./spell";
import type { WizardDef } from "./types";

export const WIZARDS: Readonly<Partial<Record<HomebrewType, WizardDef>>> = {
  spell: SPELL_WIZARD,
  monster: MONSTER_WIZARD
};
