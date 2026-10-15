/**
 * What a save does, read from the SRD text once at build time so the engine never reads prose: the damage
 * a success takes and the condition a failure imposes. Each reader covers one printing style, the override
 * table holds the reviewed cases a reader gets wrong, and `test/save-outcomes.test.ts` pins known ones.
 */
import { SaveConditionSchema, type SaveCondition } from "@vtt/schemas";

export type SaveOutcome = { successDamage: "half" | "none"; failureCondition: SaveCondition | null };

const CONDITIONS: ReadonlySet<string> = new Set(SaveConditionSchema.options);

/** The first condition named as "has the X condition" (or "X and Y conditions"); the engine applies one. */
function namedCondition(clause: string): SaveCondition | null {
  for (const match of clause.matchAll(/\b(?:has|have|gains?|having) the ([A-Z][a-z]+)\b[^.]*?\bconditions?\b/g)) {
    const id = match[1].toLowerCase();
    if (CONDITIONS.has(id)) return id as SaveCondition;
  }
  return null;
}

/**
 * A 2024 stat-block save: "Failure: ... Success: Half damage." The failure clause runs from "Failure:" (or
 * "First Failure") to the next label; a success that is not printed does nothing, so only an explicit
 * "Success: Half damage" halves. "Failure or Success:" lines apply either way and are not the success line.
 */
export function statBlockSaveOutcome(description: string): SaveOutcome {
  const start = description.search(/\b(?:First Failure|Failure:)/);
  const tail = start === -1 ? "" : description.slice(start);
  const end = tail.search(/\b(?:Failure or Success:|Success:|Second Failure|Subsequent Failures:)/);
  const failure = end === -1 ? tail : tail.slice(0, end);
  const success = /(?<!or )\bSuccess:\s*Half damage\b/.test(description);
  return { successDamage: success ? "half" : "none", failureCondition: namedCondition(failure) };
}

/**
 * A spell's save, from its running prose: half when the text halves the damage of a successful save ("or
 * half as much damage on a successful one"), and the condition the failure sentence names ("must succeed on
 * a Wisdom saving throw or have the Charmed condition", "On a failed save, ... has the Restrained condition").
 */
function spellSaveOutcome(description: string): SaveOutcome {
  const half =
    /half as much(?: damage)?(?: only)?(?: on a success|,? on a successful| if it succeeds)|successful save[^.]*\bhalf\b/i.test(
      description
    );
  const failureSentences = description
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /saving throw,? or\b|failed save|fails (?:the|its|a|this) save|on a failure/i.test(sentence))
    .join(" ");
  return { successDamage: half ? "half" : "none", failureCondition: namedCondition(failureSentences) };
}

/** Reviewed corrections, keyed by spell id; each says why the reader is wrong there. */
const SPELL_SAVE_OVERRIDES: Readonly<Record<string, Partial<SaveOutcome>>> = {
  // "or be transported to a harmless demiplane": the Incapacitated condition is named in the next sentence.
  banishment: { failureCondition: "incapacitated" },
  // The ray is rolled per target (Restrained is only the indigo ray), so no single condition applies.
  "prismatic-spray": { failureCondition: null },
  // The first save's Thunder damage is all or nothing; the halving is the turn-3 lightning's.
  "storm-of-vengeance": { successDamage: "none" }
};

/** `spellSaveOutcome` with the reviewed corrections applied. */
export function spellSaveOutcomeFor(spellId: string, description: string): SaveOutcome {
  return { ...spellSaveOutcome(description), ...SPELL_SAVE_OVERRIDES[spellId] };
}

/** Every override must still name a spell, so a renamed id fails the build instead of going quiet. */
export const SPELL_SAVE_OVERRIDE_IDS: readonly string[] = Object.keys(SPELL_SAVE_OVERRIDES);
