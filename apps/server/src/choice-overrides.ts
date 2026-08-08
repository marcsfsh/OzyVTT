import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import type { ContentView } from "./content-library.js";

/**
 * PICKS A CHARACTER MAY RE-MAKE ON A REST - the runtime half of a feature's `replaces` clause.
 *
 * "Whenever you finish a Long Rest, choose one type of land"; "whenever you finish a Short or Long
 * Rest, choose one damage type." These are not build decisions and they are deliberately not written
 * to `character.choices[]`: that ledger is the provenance level-up and respec are built on, and a
 * Barbarian re-choosing weapon masteries between fights must not require a rebuild. They live on the
 * actor as `choiceOverrides`, set by `actor.rechoose` and cleared by the matching rest (`rests.ts`).
 *
 * This module answers the one question the command needs: WHICH offers may be re-chosen on this
 * character, and WHAT may they be re-chosen to. Both come from the content - a feature declaring
 * `replaces`, and that offer's own option list - so the server is the authority and no client list
 * of "re-choosable things" can drift away from it (CLAUDE.md rule 2).
 */

/** The rider block as this module needs it. `featureRecord` returns the real bundle record; its
    declared type is the narrow rider shape, so the two fields read here are named explicitly. */
type ReplaceableRecord = Readonly<{
  id: string;
  name: string;
  replaces?: ReadonlyArray<Readonly<{ offer: string; when: string; amount: number }>>;
  choice?: Readonly<{ from?: readonly string[]; fromCatalog?: string; options?: ReadonlyArray<Readonly<{ id: string }>> }>;
  choices?: ReadonlyArray<Readonly<{ from?: readonly string[]; fromCatalog?: string; options?: ReadonlyArray<Readonly<{ id: string }>> }>>;
}>;

/** One offer this character may re-choose on a rest, with the answers that are legal for it. */
export type ReplaceableOffer = Readonly<{
  offer: string;
  /** The rest that CLEARS the override. A `short-rest` clause is satisfied by a long rest too. */
  per: "short-rest" | "long-rest";
  /** The feature's display name, for the refusal message and the GM's log line. */
  label: string;
  options: readonly string[];
}>;

/** Every option id a choice offers, whichever of the three sources it names. */
function optionIdsOf(choice: NonNullable<ReplaceableRecord["choice"]>, catalogs: CatalogChoiceCatalogs): string[] {
  const named = choice.options ? choice.options.map((option) => option.id) : [...(choice.from ?? [])];
  if (!choice.fromCatalog) return named;
  try {
    const resolved = resolveCatalogChoice(choice.fromCatalog, catalogs);
    const seen = new Set(named);
    return [...named, ...resolved.map((option) => option.id).filter((id) => !seen.has(id))];
  } catch (error) {
    // A content gap in the catalog half leaves the bespoke half standing, exactly as the builder's
    // own offer machinery does - never an accidentally empty list that accepts nothing.
    if (!(error instanceof CatalogChoiceError)) throw error;
    return named;
  }
}

/**
 * Every rest-time re-choice this built character has. Empty for a monster, a PDF import, or any
 * character whose content declares no `replaces` - which is every character until one does.
 */
export function replaceableOffers(definition: ActorDefinition | undefined, library: ContentView): ReplaceableOffer[] {
  const carriers = definition?.character?.features ?? [];
  const offers: ReplaceableOffer[] = [];
  for (const ref of carriers) {
    const record = library.featureRecord(ref) as ReplaceableRecord | undefined;
    for (const clause of record?.replaces ?? []) {
      // Build-time replacement is the ledger's business, not the actor's; only the two rest clauses
      // become runtime state.
      if (clause.when !== "short-rest" && clause.when !== "long-rest") continue;
      if (offers.some((existing) => existing.offer === clause.offer)) continue;
      // The options are the SAME list the offer itself has - a re-choice may never reach past what
      // the original pick could have chosen. Resolved off the feature the offer key names, which for
      // every SRD case is the feature declaring the clause.
      const target = clause.offer.startsWith("feature:") && clause.offer.slice("feature:".length).replace(/\/\d+$/, "") === record!.id
        ? record!
        : (carriers.map((candidate) => library.featureRecord(candidate) as ReplaceableRecord | undefined)
            .find((candidate) => candidate && `feature:${candidate.id}` === clause.offer) ?? null);
      const choice = target?.choice ?? target?.choices?.[0];
      if (!choice) continue; // a clause naming an offer with no option list re-chooses nothing
      offers.push({
        offer: clause.offer, per: clause.when, label: target!.name,
        options: optionIdsOf(choice, library.catalogChoiceCatalogs())
      });
    }
  }
  return offers;
}
