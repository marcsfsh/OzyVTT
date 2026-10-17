import type { EncounterToken } from "@vtt/domain";
import { initialsOf } from "../scene/tokenGlyph";
import type { GridCalibration } from "../scene/gridPreview";
import { creatureNumbers } from "./numbering";
import { creatureDistanceFeet } from "./targetHints";

/** One creature in a target list: named and numbered as on its token, with its distance and, where known, its AC. */
export type TargetRow = Readonly<{
  id: string;
  label: string;
  initials: string;
  kind: string;
  number?: number;
  /** "50 ft · AC 15": the distance from the attacker, and the AC when this viewer knows it. */
  detail?: string;
}>;

type Candidate = Readonly<{ id: string; name: string; kind: string; armorClass?: number }>;

/** Target rows for `attackerId`'s action. A player knows the AC of their party only; the GM knows every creature's. */
export function targetRows(
  attackerId: string,
  candidates: readonly Candidate[],
  tokens: readonly EncounterToken[],
  calibration: GridCalibration | null,
  everyone: readonly Candidate[] = candidates
): TargetRow[] {
  const numbers = creatureNumbers(everyone);
  const byActor = new Map(tokens.map((token) => [token.actorId, token]));
  const attacker = byActor.get(attackerId);
  return candidates.map((candidate) => {
    const token = byActor.get(candidate.id);
    const feet = attacker && token ? creatureDistanceFeet(calibration, attacker, token) : null;
    const parts = [
      feet !== null ? `${feet} ft` : null,
      candidate.armorClass !== undefined ? `AC ${candidate.armorClass}` : null
    ].filter((part): part is string => part !== null);
    const number = numbers.get(candidate.id);
    return {
      id: candidate.id,
      label: candidate.name,
      initials: initialsOf(candidate.name),
      kind: candidate.kind,
      ...(number !== undefined ? { number } : {}),
      ...(parts.length > 0 ? { detail: parts.join(" · ") } : {})
    };
  });
}
