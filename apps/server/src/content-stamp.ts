import { createHash } from "node:crypto";
import {
  loadBackgrounds,
  loadClasses,
  loadEquipment,
  loadFeats,
  loadLanguages,
  loadSkills,
  loadSpecies,
  loadSpells,
  loadSubclasses
} from "@vtt/content-srd-5.2.1";

/**
 * Raise this when a change to the character builder makes a different sheet from the same content and ledger (a new
 * action minted, a rider read another way), so every stored character is rebuilt with it at the next start.
 */
export const BUILDER_REVISION = 1;

/**
 * Which builder and SRD content a built sheet was made from, kept in its `source.version`. A stored sheet whose stamp
 * differs is rebuilt from its ledger at the same level (`sheet-refresh.ts`), so a content fix reaches every character
 * without a level up. It covers only the bundled content: a homebrew change rebuilds every sheet when it happens, and a
 * stamp that named homebrew would tell a player when the GM changed records hidden from them.
 */
export const CONTENT_STAMP = `content-${createHash("sha256")
  .update(
    JSON.stringify([
      BUILDER_REVISION,
      loadClasses(),
      loadSubclasses(),
      loadSpecies(),
      loadBackgrounds(),
      loadFeats(),
      loadSpells(),
      loadEquipment(),
      loadSkills(),
      loadLanguages()
    ])
  )
  .digest("hex")
  .slice(0, 16)}`;
