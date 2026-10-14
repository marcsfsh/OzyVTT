import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
import { normalizeDamageType } from "@vtt/rules-5e";
import type { Actor, ActorDefinition } from "@vtt/schemas";
import type { ContentView } from "./content-library.js";

/** Picks a character may re-make on a rest (a feature's `replaces` clause). Stored on the actor as
 *  `choiceOverrides`, not in the choices ledger, so no rebuild is needed. What may be re-chosen, and to
 *  what, comes from content. */

/** The rider block as this module needs it; the two fields read are named explicitly. */
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
  /** The rest that clears the override. A `short-rest` clause is satisfied by a long rest too. */
  per: "short-rest" | "long-rest";
  /** The feature's display name, for the refusal message and the GM's log line. */
  label: string;
  options: readonly string[];
}>;

/** Every option id a choice offers, from whichever sources it names. */
function optionIdsOf(choice: NonNullable<ReplaceableRecord["choice"]>, catalogs: CatalogChoiceCatalogs): string[] {
  const named = choice.options ? choice.options.map((option) => option.id) : [...(choice.from ?? [])];
  if (!choice.fromCatalog) return named;
  try {
    const resolved = resolveCatalogChoice(choice.fromCatalog, catalogs);
    const seen = new Set(named);
    return [...named, ...resolved.map((option) => option.id).filter((id) => !seen.has(id))];
  } catch (error) {
    // A catalog gap leaves the bespoke options standing, as in the builder.
    if (!(error instanceof CatalogChoiceError)) throw error;
    return named;
  }
}

/** Every rest-time re-choice this built character has. Empty for monsters, PDF imports, and content without `replaces`. */
export function replaceableOffers(definition: ActorDefinition | undefined, library: ContentView): ReplaceableOffer[] {
  const carriers = definition?.character?.features ?? [];
  const offers: ReplaceableOffer[] = [];
  for (const ref of carriers) {
    const record = library.featureRecord(ref) as ReplaceableRecord | undefined;
    for (const clause of record?.replaces ?? []) {
      // Only rest clauses become runtime state; build-time replacement belongs to the ledger.
      if (clause.when !== "short-rest" && clause.when !== "long-rest") continue;
      if (offers.some((existing) => existing.offer === clause.offer)) continue;
      // The options are the offer's own list: a re-choice can't reach past what the original pick could choose.
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

// Reading the chosen overrides at damage time.

/** A feature or inline option as this half needs it: id, name and defence grants. Structural on purpose. */
type GrantingRecord = Readonly<{
  id: string; name?: string;
  grants?: Readonly<{
    damageResistances?: readonly string[]; damageImmunities?: readonly string[];
    /** `FeatureGrantsSchema.when`; see `ungated` for why gated blocks are refused here. */
    when?: readonly unknown[];
  }>;
}>;

// Gated grants blocks are not read: this runs inside the damage math with no bearer context to
// evaluate the gate, so it fails closed. A superseded gated option was never baked, so there is
// nothing to subtract either. No shipped option is gated.
const ungated = (record: GrantingRecord | undefined): boolean => (record?.grants?.when?.length ?? 0) === 0;
type FeatureRef = Readonly<{ id: string; kind: "class" | "subclass" | "species" | "lineage" | "background" | "option"; sourceId: string }>;
type FeatureLookup = (ref: FeatureRef) => GrantingRecord | undefined;

/** Defences a rest-time re-choice puts in force, plus `suppressed`: the baked-in original pick it replaces
 *  (unless another feature also grants that type). */
export type OverrideDamageDefenses = Readonly<{
  resistances: readonly string[];
  immunities: readonly string[];
  /** Normalised types to drop from the definition's own lists because the pick that added them was replaced. */
  suppressed: ReadonlySet<string>;
  /** Which feature explains each type, for the damage line ("Fiendish Resilience"). */
  sources: ReadonlyMap<string, string>;
}>;

const EMPTY_OVERRIDE_DEFENSES: OverrideDamageDefenses = Object.freeze({
  resistances: [], immunities: [], suppressed: new Set<string>(), sources: new Map<string, string>()
});

const defenceGrantsOf = (record: GrantingRecord | undefined) =>
  ungated(record) ? [...(record?.grants?.damageResistances ?? []), ...(record?.grants?.damageImmunities ?? [])] : [];

/** What the character chose, resolved for the damage pipeline (e.g. Fiendish Resilience re-chosen on a
 *  short rest). Fails open wherever a lookup misses, since a damage roll must never throw. */
export function choiceOverrideDefenses(
  definition: ActorDefinition | undefined,
  overrides: Actor["choiceOverrides"] | undefined,
  featureRecord: FeatureLookup | undefined
): OverrideDamageDefenses {
  const features = (definition?.character?.features ?? []) as readonly FeatureRef[];
  const offers = Object.keys(overrides ?? {});
  if (!featureRecord || features.length === 0 || offers.length === 0) return EMPTY_OVERRIDE_DEFENSES;

  const resistances: string[] = [];
  const immunities: string[] = [];
  const sources = new Map<string, string>();
  const supersededRefs = new Set<FeatureRef>();
  const candidateSuppressions: string[] = [];

  for (const offer of offers) {
    // The offer key is `feature:<id>` (or `feature:<id>/N` for a feature offering several picks).
    if (!offer.startsWith("feature:")) continue;
    const featureId = offer.slice("feature:".length).replace(/\/\d+$/, "");
    const chosenId = overrides![offer]!.id;
    const label = features
      .filter((ref) => ref.kind !== "option")
      .map((ref) => featureRecord(ref))
      .find((record) => record?.id === featureId)?.name ?? featureId;

    // Resolved like the builder resolves an inline option: kind "option" under its parent feature's id.
    const chosen = featureRecord({ kind: "option", sourceId: featureId, id: chosenId });
    for (const id of ungated(chosen) ? chosen?.grants?.damageResistances ?? [] : []) resistances.push(id);
    for (const id of ungated(chosen) ? chosen?.grants?.damageImmunities ?? [] : []) immunities.push(id);
    for (const id of defenceGrantsOf(chosen)) {
      const type = normalizeDamageType(id);
      if (!sources.has(type)) sources.set(type, label);
    }

    // The build-time answer this override replaces, already baked into the definition's lists.
    for (const ref of features) {
      if (ref.kind !== "option" || ref.sourceId !== featureId || ref.id === chosenId) continue;
      supersededRefs.add(ref);
      candidateSuppressions.push(...defenceGrantsOf(featureRecord(ref)));
    }
  }

  // A superseded type any other feature grants stays: only the option's own contribution is replaced.
  const grantedElsewhere = new Set<string>();
  for (const ref of features) {
    if (supersededRefs.has(ref)) continue;
    for (const id of defenceGrantsOf(featureRecord(ref))) grantedElsewhere.add(normalizeDamageType(id));
  }
  const suppressed = new Set(candidateSuppressions.map(normalizeDamageType).filter((type) => !grantedElsewhere.has(type)));
  return { resistances, immunities, suppressed, sources };
}
