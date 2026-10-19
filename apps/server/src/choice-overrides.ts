import { CatalogChoiceError, resolveCatalogChoice, type CatalogChoiceCatalogs } from "@vtt/domain";
import { normalizeDamageType } from "@vtt/rules-5e";
import type { Actor, ActorDefinition } from "@vtt/schemas";
import type { ContentView } from "./content-library.js";

/** Picks a character may re-make on a rest (a feature's `replaces` clause). Most are stored on the actor as
 *  `choiceOverrides`, outside the choices ledger, so no rebuild is needed; a pick the build itself reads (a land
 *  whose spells the character has prepared) goes into the ledger (`ledger-rechoice.ts`). What may be
 *  re-chosen, and to what, comes from content. */

/** An inline option as this module reads it: what it grants, and the earlier answer it needs. */
type ReplaceableOption = Readonly<{
  id: string;
  name?: string;
  grants?: Readonly<{ spells?: readonly unknown[] } & Record<string, unknown>>;
  modifiers?: readonly unknown[];
  actions?: readonly unknown[];
  effects?: readonly unknown[];
  requires?: Readonly<{ offer: string; id: string }>;
}>;
type ReplaceableChoice = Readonly<{
  kind?: string;
  choose?: number;
  from?: readonly string[];
  fromCatalog?: string;
  options?: ReadonlyArray<ReplaceableOption>;
}>;

/** The rider block as this module needs it; the fields read are named explicitly. */
type ReplaceableRecord = Readonly<{
  id: string;
  name: string;
  replaces?: ReadonlyArray<Readonly<{ offer: string; when: string; amount: number }>>;
  choice?: ReplaceableChoice;
  choices?: ReadonlyArray<ReplaceableChoice>;
  extraPicks?: ReadonlyArray<Readonly<{ offer: string }>>;
}>;

/** One offer this character may re-choose on a rest, with the answers that are legal for it. */
export type ReplaceableOffer = Readonly<{
  offer: string;
  /** The rest after which it may be re-made. A `short-rest` clause is satisfied by a Long Rest too. */
  per: "short-rest" | "long-rest";
  /** The feature's display name, for the refusal message and the GM's log line. */
  label: string;
  options: readonly string[];
  /** Each option's display name, by id. */
  optionNames: Readonly<Record<string, string>>;
  /** The build reads this answer (its options grant spells, or another pick depends on it), so a re-choice is
   *  written to the ledger and the sheet rebuilt, and is never kept as an override. */
  rebuilds: boolean;
  /** A pick of several answers (Weapon Mastery's weapon kinds): each re-choice swaps one held answer for another, up
   *  to `swaps` of them a rest. Always written to the ledger. */
  multi: boolean;
  swaps: number;
}>;

/** Every option a choice offers, from whichever sources it names. */
function optionsOf(choice: ReplaceableChoice, catalogs: CatalogChoiceCatalogs): Array<{ id: string; name: string }> {
  const named = choice.options
    ? choice.options.map((option) => ({ id: option.id, name: option.name ?? option.id }))
    : (choice.from ?? []).map((id) => ({ id, name: id }));
  if (!choice.fromCatalog) return named;
  try {
    const resolved = resolveCatalogChoice(choice.fromCatalog, catalogs);
    const seen = new Set(named.map((option) => option.id));
    return [...named, ...resolved.filter((option) => !seen.has(option.id))];
  } catch (error) {
    // A catalog gap leaves the bespoke options standing, as in the builder.
    if (!(error instanceof CatalogChoiceError)) throw error;
    return named;
  }
}

/** An option a rest-time override can stand in for: one whose only mechanics are the damage defences
 *  `choiceOverrideDefenses` reads at damage time (Fiendish Resilience). Anything else the build reads off the chosen
 *  option (a modifier, an action, its being on the sheet), so changing it rebuilds. */
const DEFENCE_GRANTS = new Set(["damageResistances", "damageImmunities", "when"]);
function overridable(choice: ReplaceableChoice): boolean {
  const options = choice.options ?? [];
  return (
    options.length > 0 &&
    options.every(
      (option) =>
        (option.modifiers?.length ?? 0) === 0 &&
        (option.actions?.length ?? 0) === 0 &&
        (option.effects?.length ?? 0) === 0 &&
        Object.entries(option.grants ?? {}).every(
          ([key, value]) => DEFENCE_GRANTS.has(key) || (Array.isArray(value) && value.length === 0)
        ) &&
        Object.values(option.grants ?? {}).some((value) => Array.isArray(value) && value.length > 0)
    )
  );
}

/** Whether another pick this character holds is gated on `offer`'s answer (Nature's Ward and the later land spells
 *  read the land). */
function hasDependents(carriers: readonly ReplaceableRecord[], offer: string): boolean {
  return carriers.some((record) =>
    [record.choice, ...(record.choices ?? [])].some((choice) =>
      (choice?.options ?? []).some((option) => option.requires?.offer === offer)
    )
  );
}

/** A class's cantrips as a rest-time pick of several, keyed `class-cantrips:<classId>`: any cantrip on its list. */
function classCantripOffer(
  ref: Readonly<{ kind: string; sourceId: string }>,
  clause: Readonly<{ when: string; amount: number }>,
  library: ContentView
): ReplaceableOffer | null {
  if (ref.kind !== "class" || (clause.when !== "short-rest" && clause.when !== "long-rest")) return null;
  const record = library.classRecord(ref.sourceId);
  const listId = record?.spellcasting?.spellListId ?? ref.sourceId;
  let cantrips: Array<{ id: string; name: string }> = [];
  try {
    cantrips = resolveCatalogChoice(`${listId}-spells`, library.catalogChoiceCatalogs()).filter(
      (option) => option.level === 0
    );
  } catch (error) {
    if (!(error instanceof CatalogChoiceError)) throw error;
  }
  if (cantrips.length === 0) return null;
  return {
    offer: `class-cantrips:${ref.sourceId}`,
    per: clause.when,
    label: `${record?.name ?? ref.sourceId} cantrips`,
    options: cantrips.map((option) => option.id),
    optionNames: Object.fromEntries(cantrips.map((option) => [option.id, option.name])),
    rebuilds: true,
    multi: true,
    swaps: clause.amount
  };
}

/** Every rest-time re-choice this built character has. Empty for monsters, PDF imports, and content without `replaces`. */
export function replaceableOffers(definition: ActorDefinition | undefined, library: ContentView): ReplaceableOffer[] {
  const carriers = definition?.character?.features ?? [];
  const held = carriers
    .map((ref) => ({ ref, record: library.featureRecord(ref) as ReplaceableRecord | undefined }))
    .filter(
      (entry): entry is { ref: (typeof carriers)[number]; record: ReplaceableRecord } => entry.record !== undefined
    );
  const records = held.map((entry) => entry.record);
  const offers: ReplaceableOffer[] = [];
  for (const { ref, record } of held) {
    for (const clause of record.replaces ?? []) {
      // Only rest clauses become runtime state; build-time replacement belongs to the ledger.
      if (clause.when !== "short-rest" && clause.when !== "long-rest") continue;
      // A class's cantrips swapped on a rest (a Wizard's "Whenever you finish a Long Rest, you can replace one of
      // your cantrips from this feature with another Wizard cantrip").
      if (clause.offer === "class-cantrips") {
        const swap = classCantripOffer(ref, clause, library);
        if (swap && !offers.some((existing) => existing.offer === swap.offer)) offers.push(swap);
        continue;
      }
      if (offers.some((existing) => existing.offer === clause.offer)) continue;
      // The options are the offer's own list: a re-choice can't reach past what the original pick could choose.
      const target =
        clause.offer.startsWith("feature:") && clause.offer.slice("feature:".length).replace(/\/\d+$/, "") === record.id
          ? record
          : (records.find((candidate) => `feature:${candidate.id}` === clause.offer) ?? null);
      const choice = target?.choice ?? target?.choices?.[0];
      if (!choice) continue; // a clause naming an offer with no option list re-chooses nothing
      const options = optionsOf(choice, library.catalogChoiceCatalogs());
      const multi =
        (choice.choose ?? 1) > 1 ||
        choice.kind === "weapon-mastery" ||
        (target!.extraPicks ?? []).some((grant) => grant.offer === clause.offer);
      offers.push({
        offer: clause.offer,
        per: clause.when,
        label: target!.name,
        options: options.map((option) => option.id),
        optionNames: Object.fromEntries(options.map((option) => [option.id, option.name])),
        rebuilds:
          multi ||
          !overridable(choice) ||
          (choice.options ?? []).some((option) => (option.grants?.spells?.length ?? 0) > 0) ||
          hasDependents(records, clause.offer),
        multi,
        swaps: clause.amount
      });
    }
  }
  return offers;
}

// Reading the chosen overrides at damage time.

/** A feature or inline option as this half needs it: id, name and defence grants. Structural on purpose. */
type GrantingRecord = Readonly<{
  id: string;
  name?: string;
  grants?: Readonly<{
    damageResistances?: readonly string[];
    damageImmunities?: readonly string[];
    /** `FeatureGrantsSchema.when`; see `ungated` for why gated blocks are refused here. */
    when?: readonly unknown[];
  }>;
}>;

// Gated grants blocks are not read: this runs inside the damage math with no bearer context to
// evaluate the gate, so it fails closed. A superseded gated option was never baked, so there is
// nothing to subtract either. No shipped option is gated.
const ungated = (record: GrantingRecord | undefined): boolean => (record?.grants?.when?.length ?? 0) === 0;
type FeatureRef = Readonly<{
  id: string;
  kind: "class" | "subclass" | "species" | "lineage" | "background" | "option";
  sourceId: string;
}>;
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
  resistances: [],
  immunities: [],
  suppressed: new Set<string>(),
  sources: new Map<string, string>()
});

const defenceGrantsOf = (record: GrantingRecord | undefined) =>
  ungated(record) ? [...(record?.grants?.damageResistances ?? []), ...(record?.grants?.damageImmunities ?? [])] : [];

/** What the character chose, resolved for the damage pipeline (e.g. Fiendish Resilience re-chosen on a
 *  Short Rest). Fails open wherever a lookup misses, since a damage roll must never throw. */
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
    const label =
      features
        .filter((ref) => ref.kind !== "option")
        .map((ref) => featureRecord(ref))
        .find((record) => record?.id === featureId)?.name ?? featureId;

    // Resolved like the builder resolves an inline option: kind "option" under its parent feature's id.
    const chosen = featureRecord({ kind: "option", sourceId: featureId, id: chosenId });
    for (const id of ungated(chosen) ? (chosen?.grants?.damageResistances ?? []) : []) resistances.push(id);
    for (const id of ungated(chosen) ? (chosen?.grants?.damageImmunities ?? []) : []) immunities.push(id);
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
  const suppressed = new Set(
    candidateSuppressions.map(normalizeDamageType).filter((type) => !grantedElsewhere.has(type))
  );
  return { resistances, immunities, suppressed, sources };
}
