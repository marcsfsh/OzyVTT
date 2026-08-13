import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
import { normalizeDamageType } from "@vtt/rules-5e";
import type { Actor, ActorDefinition } from "@vtt/schemas";
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

// -------------------------------------------------------------------------------------------------
// THE READER. `choiceOverrides` was written, cleared, projected - and read by nobody at damage time.
// -------------------------------------------------------------------------------------------------

/**
 * A feature or one of its inline options as this half needs it: an id, a display name, and the
 * defence grants a pick carries. Structural on purpose, so the content records stay the authoring
 * surface (the same rule `equipment-derivation.ts` follows for every other read of them).
 */
type GrantingRecord = Readonly<{
  id: string; name?: string;
  grants?: Readonly<{
    damageResistances?: readonly string[]; damageImmunities?: readonly string[];
    /** `FeatureGrantsSchema.when` - see `ungated` below for why this reader refuses a gated block. */
    when?: readonly unknown[];
  }>;
}>;

/**
 * A gated grants block is NOT read here, deliberately.
 *
 * This function answers "what did the character RE-CHOOSE on their last short rest", and it runs
 * inside the damage maths with no `RiderContext` in hand - there is no bearer state flattened here
 * to evaluate a `while-armored` or a `while-hp-at-or-below` against. Applying the ids anyway would
 * ignore the gate, which is an over-grant; so a gated option's defences simply do not arrive through
 * the re-choice path. That fails CLOSED, and it costs nothing today because no shipped option
 * carries a gate. The way to lift it is to hand this reader the derivation's `context`, which is
 * already computed one call away in `applyDamageDetailed`.
 *
 * The same test is what keeps SUPPRESSION honest: a superseded option whose grants were gated was
 * never baked into the definition, so there is nothing of it to subtract.
 */
const ungated = (record: GrantingRecord | undefined): boolean => (record?.grants?.when?.length ?? 0) === 0;
type FeatureRef = Readonly<{ id: string; kind: "class" | "subclass" | "species" | "lineage" | "background" | "option"; sourceId: string }>;
type FeatureLookup = (ref: FeatureRef) => GrantingRecord | undefined;

/**
 * The defences a rest-time RE-CHOICE puts in force, and the build-time answer it replaces.
 *
 * `suppressed` is what makes this a re-choice rather than an accumulation: the build baked the
 * original pick's grants into `definition.damageResistances`, so a Warlock who built on Cold and
 * re-chose Fire must LOSE cold and GAIN fire, not hold both. A type another feature also grants
 * (a Tiefling's racial fire resistance) is never suppressed - it was not the option's to give.
 */
export type OverrideDamageDefenses = Readonly<{
  resistances: readonly string[];
  immunities: readonly string[];
  /** Normalised types to drop from the DEFINITION's own lists, because the pick that put them there was replaced. */
  suppressed: ReadonlySet<string>;
  /** Which feature explains each type, for the damage line ("Fiendish Resilience"). */
  sources: ReadonlyMap<string, string>;
}>;

const EMPTY_OVERRIDE_DEFENSES: OverrideDamageDefenses = Object.freeze({
  resistances: [], immunities: [], suppressed: new Set<string>(), sources: new Map<string, string>()
});

const defenceGrantsOf = (record: GrantingRecord | undefined) =>
  ungated(record) ? [...(record?.grants?.damageResistances ?? []), ...(record?.grants?.damageImmunities ?? [])] : [];

/**
 * WHAT THE CHARACTER ACTUALLY CHOSE, resolved for the damage pipeline.
 *
 * `actor.choiceOverrides` had a writer (`actor.rechoose`), a clearer (`rests.ts`), a projection, and
 * a validator that answered "what MAY be re-chosen" - and no reader anywhere that answered "what WAS
 * chosen". The Warlock's Fiendish Resilience is twelve inline options each carrying
 * `grants: { damageResistances: [id] }`, re-chosen on a short rest: a player could pick fire, see it
 * on the sheet, see it in the projection, and take full fire damage.
 *
 * Fails open in every direction a lookup can miss (no catalog, no built sheet, an offer key that
 * names no feature, an option the content no longer has), because a damage roll must never throw.
 */
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

    // The re-choice, resolved the same way the builder resolves an inline option: kind "option"
    // under its PARENT feature's id.
    const chosen = featureRecord({ kind: "option", sourceId: featureId, id: chosenId });
    for (const id of ungated(chosen) ? chosen?.grants?.damageResistances ?? [] : []) resistances.push(id);
    for (const id of ungated(chosen) ? chosen?.grants?.damageImmunities ?? [] : []) immunities.push(id);
    for (const id of defenceGrantsOf(chosen)) {
      const type = normalizeDamageType(id);
      if (!sources.has(type)) sources.set(type, label);
    }

    // The build-time answer this override REPLACES - already baked into the definition's lists.
    for (const ref of features) {
      if (ref.kind !== "option" || ref.sourceId !== featureId || ref.id === chosenId) continue;
      supersededRefs.add(ref);
      candidateSuppressions.push(...defenceGrantsOf(featureRecord(ref)));
    }
  }

  // A superseded type that ANY other feature grants stays: the option's pick is what is being
  // replaced, never the whole sheet's claim on that damage type.
  const grantedElsewhere = new Set<string>();
  for (const ref of features) {
    if (supersededRefs.has(ref)) continue;
    for (const id of defenceGrantsOf(featureRecord(ref))) grantedElsewhere.add(normalizeDamageType(id));
  }
  const suppressed = new Set(candidateSuppressions.map(normalizeDamageType).filter((type) => !grantedElsewhere.has(type)));
  return { resistances, immunities, suppressed, sources };
}
