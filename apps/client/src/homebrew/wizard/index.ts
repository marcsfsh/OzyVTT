/** One wizard per homebrew type. */

import type { HomebrewType } from "../types";
import {
  BACKGROUND_WIZARD,
  CLASS_WIZARD,
  FEAT_WIZARD,
  SPECIES_WIZARD,
  SPELL_LIST_WIZARD,
  SUBCLASS_WIZARD
} from "./character";
import { EQUIPMENT_WIZARD } from "./equipment";
import { MONSTER_WIZARD } from "./monster";
import { SPELL_WIZARD } from "./spell";
import type { WizardDef } from "./types";

export const WIZARDS: Readonly<Record<HomebrewType, WizardDef>> = {
  class: CLASS_WIZARD,
  subclass: SUBCLASS_WIZARD,
  species: SPECIES_WIZARD,
  background: BACKGROUND_WIZARD,
  feat: FEAT_WIZARD,
  spell: SPELL_WIZARD,
  "spell-list": SPELL_LIST_WIZARD,
  equipment: EQUIPMENT_WIZARD,
  monster: MONSTER_WIZARD
};
