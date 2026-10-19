import { ABILITIES, type Ability } from "@vtt/rules-5e";
import type { CharacterChoice } from "@vtt/schemas";

/**
 * A studied manual or tome in the choices ledger (`item-study.ts`): one row per study, at the character level the
 * reader had then, carrying the ability, the amount and the most it may reach. The build applies it at that level, after
 * the level's own increases, so every rebuild keeps it.
 */

export const STUDIED_ITEM_KIND = "studied-item";

/** One study's increase, as the build applies it: at `level`, `ability` up by `amount`, never above `maximum`. */
export type StudyIncrease = Readonly<{ level: number; ability: Ability; amount: number; maximum: number }>;

/** The increases the ledger's studies give, each at the level it was made (or the build's level, if lower). A
 *  malformed row gives nothing. */
export function studyIncreasesOf(choices: readonly CharacterChoice[], buildLevel: number): StudyIncrease[] {
  return choices.flatMap((row) => {
    if (row.kind !== STUDIED_ITEM_KIND) return [];
    const payload = row.payload as { ability?: unknown; amount?: unknown; maximum?: unknown } | undefined;
    const ability = ABILITIES.find((candidate) => candidate === payload?.ability);
    const amount = payload?.amount;
    const maximum = payload?.maximum;
    if (!ability || typeof amount !== "number" || typeof maximum !== "number") return [];
    return [{ level: Math.min(row.level, buildLevel), ability, amount, maximum }];
  });
}

/**
 * The ledger a create or rebuild sends, with the studies the stored sheet records in place of any the request names.
 * A study is the GM's record of downtime, so a request can neither add one nor drop one.
 */
export function withStoredStudies(
  sent: readonly CharacterChoice[],
  stored: readonly CharacterChoice[] | undefined
): CharacterChoice[] {
  return [
    ...sent.filter((row) => row.kind !== STUDIED_ITEM_KIND),
    ...(stored ?? []).filter((row) => row.kind === STUDIED_ITEM_KIND)
  ];
}
