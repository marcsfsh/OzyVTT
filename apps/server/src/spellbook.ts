import { featurePicks } from "@vtt/content-srd-5.2.1";
import type { Actor, ActorDefinition } from "@vtt/schemas";
import type { ContentView } from "./content-library.js";

/**
 * A Wizard's spellbook as its picks read it (SRD Wizard, Spellbook): the Wizard spells its levels wrote in the book,
 * which are its own class spell picks and a spellbook feature's (Evocation Savant), from the choices ledger, and the
 * spells recorded on the actor beyond the sheet (`Actor.spellbook`: the rest of its level picks and the copies). A
 * feature that picks "spells in your spellbook" (Spell Mastery, Signature Spells) takes only these.
 */

const WIZARD = "wizard";
/** The tag of a feature whose spell picks go into the spellbook (Evocation Savant). */
const SPELLBOOK_TAG = "spellbook";

type FeatureRef = NonNullable<NonNullable<ActorDefinition["character"]>["features"]>[number];

/** The features on the sheet whose picks this rule reads: those that write into the book, and those that must pick
 *  from it. */
function bookFeatures(
  definition: ActorDefinition,
  library: Pick<ContentView, "featureRecord" | "featRecord">
): { writers: Set<string>; readers: Map<string, string> } {
  const writers = new Set<string>();
  const readers = new Map<string, string>();
  for (const ref of definition.character?.features ?? []) {
    const record = library.featureRecord(ref as FeatureRef);
    if (!record) continue;
    if ("tags" in record && record.tags.includes(SPELLBOOK_TAG)) writers.add(record.id);
    if (featurePicks(record).some((pick) => pick.fromSpellbook === true)) readers.set(record.id, record.name);
  }
  return { writers, readers };
}

/** The spells in the character's spellbook, as its picks may take them. */
export function spellbookOf(
  actor: Pick<Actor, "spellbook"> | null,
  definition: ActorDefinition,
  library: Pick<ContentView, "featureRecord" | "featRecord">
): Set<string> {
  const { writers } = bookFeatures(definition, library);
  const starting = definition.character?.classes[0]?.id;
  const rows = definition.character?.choices ?? [];
  return new Set([
    ...rows
      .filter((row) => {
        if (row.kind !== "spell") return false;
        const featureId = typeof row.payload?.featureId === "string" ? row.payload.featureId : null;
        return featureId === null ? (row.classId ?? starting) === WIZARD : writers.has(featureId);
      })
      .map((row) => row.id),
    ...(actor?.spellbook ?? []).map((entry) => entry.id)
  ]);
}

/** Why a sheet's pick "from your spellbook" can't stand (Spell Mastery, Signature Spells), or null when each is in
 *  the book. A pick the sheet it replaces already held stands as it was. */
export function spellbookPickRefusal(
  actor: Pick<Actor, "spellbook"> | null,
  definition: ActorDefinition,
  library: Pick<ContentView, "featureRecord" | "featRecord" | "spellRecord">,
  previous?: ActorDefinition
): string | null {
  const { readers } = bookFeatures(definition, library);
  if (readers.size === 0) return null;
  const book = spellbookOf(actor, definition, library);
  const held = new Set(
    (previous?.character?.choices ?? []).map((row) => `${String(row.payload?.featureId)}:${row.id}`)
  );
  for (const row of definition.character?.choices ?? []) {
    const featureId = typeof row.payload?.featureId === "string" ? row.payload.featureId : null;
    const feature = featureId === null ? undefined : readers.get(featureId);
    if (feature === undefined || book.has(row.id) || held.has(`${featureId}:${row.id}`)) continue;
    const spell = library.spellRecord(row.id)?.name ?? row.id;
    return `${spell} isn't in ${definition.name}'s spellbook, and ${feature} takes a spell from the spellbook. Pick one the book holds, or add it to the book first.`;
  }
  return null;
}
