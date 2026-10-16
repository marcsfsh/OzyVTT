import { useState } from "react";
import type { BuilderOffer, ContentSpellSummary } from "@vtt/domain";
import { ABILITIES, type Ability } from "@vtt/rules-5e";
import { Alert, Badge, ChoiceGrid, SegmentedControl, Select, type ChoiceOption } from "@vtt/ui";
import type { BuilderCatalogs } from "../content/catalogs";
// The fight's own spell card, so a spell reads the same while choosing it and while casting it.
import { SpellCard } from "../encounter/spells";
import { ABILITY_LABELS, ABILITY_SCORE_CAP, ASI_SHORTHAND, FEAT_KINDS, type BuilderDraft } from "./build-payload";

/** The grids that answer the table's offers: one pick, or an Ability Score Improvement. */

/**
 * How many options an offer needs before its grid gets a search box. Answered offers never fold
 * away: at capacity the unchosen options grey out, and `ChoiceGrid bounded` caps the grid's height.
 */
export const SEARCH_THRESHOLD = 8;

/** The offer kinds whose options are spells, and therefore have rules worth reading while choosing. */
const SPELL_KINDS: ReadonlySet<string> = new Set(["spell", "cantrip"]);

/**
 * Badge only the exception: nearly every option is SRD, so only homebrew gets a badge. `ChoiceCard`
 * collapses the slot when the badge is `undefined`.
 */
export const sourceBadge = (source: string | undefined) =>
  source === "homebrew" ? <Badge tone="primary">Homebrew</Badge> : undefined;
/** Sentence-cases a stored provenance phrase for a card's disabled reason. */
const asReason = (phrase: string) => phrase.charAt(0).toUpperCase() + phrase.slice(1);

/** A feat's one-line summary, for grids whose options are feats. */
const featSummary = (catalogs: BuilderCatalogs, id: string) =>
  catalogs.choice.feats.find((entry) => entry.id === id)?.summary ?? undefined;

/** What an option's `level` says on the card. Only the spell catalogs carry one; 0 is a cantrip. */
const spellLevelLine = (level: number | null | undefined) =>
  level == null ? undefined : level === 0 ? "Cantrip" : `Level ${level}`;

/**
 * Provenance for an offer option, by id. The server's offers carry options as `{ id, name, level? }`,
 * so `source` is looked back up in the catalog the id came from.
 *
 * Subclasses and feats only: spell, equipment and monster summaries carry no `source`, so a
 * homebrew spell is still unbadged. These catalogs are audience-merged server-side, so nothing a
 * player may not see can be badged.
 */
const offerSource = (catalogs: BuilderCatalogs, id: string): string | undefined =>
  catalogs.choice.subclasses.find((entry) => entry.id === id)?.source ??
  catalogs.choice.feats.find((entry) => entry.id === id)?.source;

/**
 * One pick offered by the content: heading, count, and the grid that answers it.
 * The grid never folds away: every option stays mounted, unchosen ones grey at capacity, and a
 * chosen card stays tappable so the pick can be swapped. `ChoiceGrid bounded` caps the height.
 */
export function OfferPicker({
  offer,
  draft,
  catalogs,
  onSet
}: Readonly<{
  offer: BuilderOffer;
  draft: BuilderDraft;
  catalogs: BuilderCatalogs;
  onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  /** See `SEARCH_THRESHOLD`. */
  const long = offer.options.length > SEARCH_THRESHOLD;
  /**
   * The spell whose rules are open, or null. Read from the already-loaded spell catalog, so it costs
   * no round trip and tells the server nothing.
   */
  const [reading, setReading] = useState<ContentSpellSummary | null>(null);
  const spells = SPELL_KINDS.has(offer.kind) ? catalogs.choice.spells : null;

  if (offer.unresolvable) {
    return (
      <section className="cb-offer">
        <h3 className="cb-offer-title">{offer.label}</h3>
        <Alert tone="warning" title="Not available yet">
          This choice has no options to show: {offer.unresolvable} You can finish the character without it.
        </Alert>
      </section>
    );
  }
  const isFeat = FEAT_KINDS.has(offer.kind);
  const options: ChoiceOption[] = offer.options.map((option) => ({
    value: option.id,
    // The option's name is the title for every kind (equipment included), matching the review step.
    title: option.name,
    // Feats show their summary. A spell's type line ("Cantrip", "Level 3") also goes in `description`,
    // not `meta`, which is the mono micro-label meant for numbers.
    description: isFeat ? featSummary(catalogs, option.id) : spellLevelLine(option.level),
    badge: sourceBadge(offerSource(catalogs, option.id)),
    // A proficiency the build already holds stays listed but disabled, saying where it came from;
    // picked from another source it would be merged away server-side, silently costing a pick.
    ...(offer.unavailable?.[option.id]
      ? { disabled: true, disabledReason: asReason(offer.unavailable[option.id]) }
      : {}),
    keywords: option.id
  }));
  const many = offer.capacity > 1;
  return (
    <section className="cb-offer">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">{offer.label}</h3>
        {/* Only choose-N offers show a running count; for choose-one the selected card says it all. */}
        {many && (
          <span className="cb-offer-count tabular" role="status">
            {picks.length} of {offer.capacity} chosen
          </span>
        )}
      </div>
      {offer.help && <p className="cb-offer-help">{offer.help}</p>}
      <ChoiceGrid
        ariaLabel={offer.label}
        options={options}
        /* Capped height with internal scroll, so a long step stays readable without unmounting options. */
        bounded
        searchable={long}
        searchPlaceholder="Search options…"
        selection={many ? "multiple" : "single"}
        value={many ? null : (picks[0] ?? null)}
        onChange={(value) => onSet(offer, [value])}
        values={many ? picks : undefined}
        /* `max` greys the unchosen cards at capacity for every choose-N offer. A choose-one offer is a
         radiogroup and passes none, so a keyboard user can still arrow between answers. */
        max={many ? offer.capacity : undefined}
        onToggle={(value, next) => onSet(offer, next ? [...picks, value] : picks.filter((id) => id !== value))}
        /* Opens a spell's rules in a modal; `onInspect` never changes `picks`. */
        onInspect={spells ? (id) => setReading(spells.find((spell) => spell.id === id) ?? null) : undefined}
        inspectLabel={(option) => `Read the ${option.title} rules`}
      />
      {reading && <SpellCard spell={reading} onClose={() => setReading(null)} />}
    </section>
  );
}

/**
 * An Ability Score Improvement level: raise two points, or take a feat. Both routes write one
 * `asi-or-feat` ledger row. The catalog's own "Ability Score Improvement" feat is filtered out of
 * the feat list since the ability route covers it (the server accepts either).
 */
export function AsiOffer({
  offer,
  draft,
  catalogs,
  capBefore,
  onSet,
  onIncreases
}: Readonly<{
  offer: BuilderOffer;
  draft: BuilderDraft;
  catalogs: BuilderCatalogs;
  /** This build's scores just before this improvement, or null while the ability step has none.
      Lets each row show the result and refuse abilities with no room under the 20 cap. */
  capBefore: Readonly<Record<Ability, number>> | null;
  onSet: (offer: BuilderOffer, ids: readonly string[]) => void;
  onIncreases: (offer: BuilderOffer, increases: ReadonlyArray<{ ability: Ability; amount: number }>) => void;
}>) {
  const picks = draft.picks[offer.key] ?? [];
  const route = picks[0] === ASI_SHORTHAND ? "asi" : picks.length > 0 ? "feat" : null;
  const increases = draft.asiIncreases[offer.key] ?? [];
  const featOptions: ChoiceOption[] = offer.options
    .filter((option) => option.id !== "ability-score-improvement")
    .map((option) => ({
      value: option.id,
      title: option.name,
      description: featSummary(catalogs, option.id),
      badge: sourceBadge(offerSource(catalogs, option.id)),
      // A feat whose prerequisite this build does not meet stays listed, saying why.
      ...(offer.unavailable?.[option.id]
        ? { disabled: true, disabledReason: asReason(offer.unavailable[option.id]) }
        : {}),
      keywords: option.id
    }));

  /**
   * Which shape of increase is being made: derived from the draft when it holds an answer (an
   * amount-1 entry only comes from the +1/+1 split), otherwise from the local pick. Choosing the
   * route writes no abilities; the step stays blocked until the split adds to 2 (`offerFilled`).
   */
  const [pickedSplit, setPickedSplit] = useState<"one" | "two" | null>(null);
  const split = increases.length > 0 ? (increases.some((entry) => entry.amount === 1) ? "two" : "one") : pickedSplit;
  const amount = split === "two" ? 1 : 2;
  const slotCount = split === "two" ? 2 : split === "one" ? 1 : 0;
  /** The ability shown in each row; `""` is "not answered yet", which the draft cannot represent. */
  const slots: readonly string[] = Array.from({ length: slotCount }, (_, index) => increases[index]?.ability ?? "");

  /** What raising `ability` by this row's amount would make it; null while there is nothing to cap. */
  const projected = (index: number, ability: Ability): number | null => {
    if (!capBefore) return null;
    const elsewhere = slots.reduce(
      (total, entry, position) => (position !== index && entry === ability ? total + amount : total),
      0
    );
    return capBefore[ability] + elsewhere + amount;
  };

  const changeSplit = (next: string) => {
    setPickedSplit(next as "one" | "two");
    // A +2 answer cannot carry over as a +1: keep the first ability if it still fits, invent nothing else.
    const first = increases[0]?.ability;
    const keeps = first && (capBefore?.[first] ?? 0) + (next === "two" ? 1 : 2) <= ABILITY_SCORE_CAP;
    onIncreases(offer, keeps ? [{ ability: first, amount: next === "two" ? 1 : 2 }] : []);
  };
  const setAbility = (index: number, ability: string) => {
    const next = slots.map((entry, position) => (position === index ? ability : entry));
    onIncreases(
      offer,
      next.filter((entry): entry is Ability => entry !== "").map((entry) => ({ ability: entry, amount }))
    );
  };

  return (
    <section className="cb-offer">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">
          {offer.label} <span className="cb-offer-level tabular">Level {offer.level}</span>
        </h3>
      </div>
      <SegmentedControl
        ariaLabel={`Level ${offer.level} improvement`}
        value={route ?? ""}
        onChange={(next) => {
          if (next === "asi") {
            onSet(offer, [ASI_SHORTHAND]);
            setPickedSplit(null);
            onIncreases(offer, []);
          } else {
            onSet(offer, []);
            setPickedSplit(null);
          }
        }}
        options={[
          { value: "asi", label: "Raise ability scores" },
          { value: "feat", label: "Take a feat" }
        ]}
      />
      {route === "asi" && (
        <div className="cb-asi">
          <SegmentedControl
            size="sm"
            ariaLabel="How to split the increase"
            value={split ?? ""}
            onChange={changeSplit}
            options={[
              { value: "one", label: "+2 to one" },
              { value: "two", label: "+1 to two" }
            ]}
          />
          <div className="cb-asi-rows">
            {slots.map((chosen, index) => (
              <label key={index} className="cb-asi-row">
                <span className="cb-asi-label">+{amount} to</span>
                <Select
                  value={chosen}
                  aria-label={`Ability to raise by ${amount}`}
                  onChange={(event) => setAbility(index, event.target.value)}
                >
                  <option value="">Choose an ability…</option>
                  {ABILITIES.map((ability) => {
                    const total = projected(index, ability);
                    const noRoom = total != null && total > ABILITY_SCORE_CAP;
                    // The current pick stays selectable even when it no longer fits, so the control can let go of it;
                    // the step's blocked reason explains the rest.
                    return (
                      <option key={ability} value={ability} disabled={noRoom && ability !== chosen}>
                        {ABILITY_LABELS[ability]}
                        {total == null ? "" : ` — ${total}${noRoom ? ` (over ${ABILITY_SCORE_CAP})` : ""}`}
                      </option>
                    );
                  })}
                </Select>
              </label>
            ))}
          </div>
        </div>
      )}
      {route !== "asi" && (
        <ChoiceGrid
          ariaLabel={`Level ${offer.level} feat`}
          options={featOptions}
          /* Bounded like every other offer grid: a level-20 build can have five feat lists. */
          bounded
          searchable={featOptions.length > SEARCH_THRESHOLD}
          searchPlaceholder="Search feats…"
          value={route === "feat" ? (picks[0] ?? null) : null}
          onChange={(value) => onSet(offer, [value])}
        />
      )}
    </section>
  );
}

/**
 * Species, Background and Class get the same `.cb-offer` shell and heading as every other decision.
 * Choose-one, so no count (keep in step with `OfferPicker`).
 */
export function PrimaryPick({
  label,
  ariaLabel,
  options,
  value,
  onChange,
  searchPlaceholder
}: Readonly<{
  label: string;
  ariaLabel: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  searchPlaceholder: string;
}>) {
  return (
    <section className="cb-offer">
      <div className="cb-offer-head">
        <h3 className="cb-offer-title">{label}</h3>
      </div>
      <ChoiceGrid
        ariaLabel={ariaLabel}
        options={options}
        value={value}
        onChange={onChange}
        searchable={options.length > SEARCH_THRESHOLD}
        searchPlaceholder={searchPlaceholder}
      />
    </section>
  );
}

/* No `facet`: `ChoiceGrid` only reads it alongside `facets`, and there is one source. */
export const speciesOptionsOf = (catalogs: BuilderCatalogs): ChoiceOption[] =>
  catalogs.choice.species.map((entry) => ({
    value: entry.id,
    title: entry.name,
    description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: `${entry.speedFeet} ft.${entry.darkvisionFeet ? ` · darkvision ${entry.darkvisionFeet} ft.` : ""}`,
    keywords: `${entry.creatureType} ${entry.languages.join(" ")}`
  }));

export const backgroundOptionsOf = (catalogs: BuilderCatalogs): ChoiceOption[] =>
  catalogs.backgrounds.map((entry) => ({
    value: entry.id,
    title: entry.name,
    description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: entry.abilityOptions
      ? entry.abilityOptions.from.map((ability) => ability.toUpperCase()).join(" / ")
      : undefined,
    keywords: entry.skillProficiencies.join(" ")
  }));

export const classOptionsOf = (catalogs: BuilderCatalogs): ChoiceOption[] =>
  catalogs.choice.classes.map((entry) => ({
    value: entry.id,
    title: entry.name,
    description: entry.summary ?? undefined,
    badge: sourceBadge(entry.source),
    meta: `${entry.hitDie} · ${entry.savingThrows.map((ability) => ability.toUpperCase()).join("/")}${entry.spellcasting ? ` · ${entry.spellcasting.ability.toUpperCase()} caster` : ""}`,
    keywords: entry.primaryAbilities.join(" ")
  }));
