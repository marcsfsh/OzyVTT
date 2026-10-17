import type { ReactNode } from "react";
import type { BuilderOffer, ContentFeatureSummary } from "@vtt/domain";
import { Button, FeatureList } from "@vtt/ui";
import type { BuilderCatalogs } from "../content/catalogs";
import { classSequenceOf, offerFilled, type BuilderDraft, type OfferContext } from "./build-payload";

/**
 * The choices a level-up asks for, gathered on one step: what the new level adds, and every pick the build now
 * offers that the character's earlier levels have not answered. That covers the new level's own picks (a subclass,
 * an Ability Score Improvement or feat, an Expertise) and a spell list that grew. Equipment belongs to level 1, so it
 * stays on its own step.
 */
export function levelUpOffers(offers: readonly BuilderOffer[], draft: BuilderDraft, level: number): BuilderOffer[] {
  return offers.filter(
    (offer) =>
      offer.step !== "equipment" &&
      ((offer.level === level && offer.unresolvable === null) || !offerFilled(offer, draft))
  );
}

/** The class a level went to and that class's own level there: "Fighter 5" for a Fighter's fifth. */
export function classAtLevel(draft: BuilderDraft, level: number): Readonly<{ classId: string; classLevel: number }> {
  const sequence = classSequenceOf(draft);
  const classId = sequence[level - 1] ?? draft.classId ?? "";
  return { classId, classLevel: sequence.slice(0, level).filter((id) => id === classId).length };
}

/** The features a class and its subclass print at one of the class's levels. */
function featuresAt(
  draft: BuilderDraft,
  level: number,
  context: OfferContext,
  offers: readonly BuilderOffer[],
  catalogs: BuilderCatalogs
): ContentFeatureSummary[] {
  const { classId, classLevel } = classAtLevel(draft, level);
  const record = context.classes.find((entry) => entry.record.id === classId)?.record;
  if (!record) return [];
  // The starting class's subclass is the draft's own; a later class's is its subclass pick.
  const subclassOffer = offers.find((offer) => offer.kind === "subclass" && offer.classId === classId);
  const subclassId =
    classId === draft.classId ? draft.subclassId : subclassOffer ? (draft.picks[subclassOffer.key]?.[0] ?? null) : null;
  const subclass = catalogs.choice.subclasses.find((entry) => entry.id === subclassId) ?? null;
  return [...record.features, ...(subclass?.features ?? [])].filter((feature) => feature.level === classLevel);
}

export function LevelStep({
  name,
  draft,
  context,
  offers,
  catalogs,
  renderOffer,
  hitPoints,
  earlier
}: Readonly<{
  name: string;
  draft: BuilderDraft;
  context: OfferContext;
  offers: readonly BuilderOffer[];
  catalogs: BuilderCatalogs;
  renderOffer: (offer: BuilderOffer) => ReactNode;
  /** The hit points section, which the abilities step shows too. */
  hitPoints: ReactNode;
  /** The steps before this one, each a tap away. A phone shows no step rail, so the step lists them itself. */
  earlier: readonly Readonly<{ label: string; onOpen: () => void }>[];
}>) {
  const level = draft.level;
  const { classId, classLevel } = classAtLevel(draft, level);
  const className = context.classes.find((entry) => entry.record.id === classId)?.record.name ?? classId;
  const features = featuresAt(draft, level, context, offers, catalogs);
  const choices = levelUpOffers(offers, draft, level);
  return (
    <>
      <p className="cb-note">
        {name} becomes level {level}: {className} {classLevel}. The earlier steps keep their answers. Open one to change
        it.
      </p>
      <nav className="cb-level-earlier" aria-label="Earlier steps">
        {earlier.map((step) => (
          <Button key={step.label} variant="secondary" size="sm" onClick={step.onOpen}>
            {step.label}
          </Button>
        ))}
      </nav>
      {features.length > 0 && (
        <section className="cb-offer" aria-labelledby="cb-level-new">
          <div className="cb-offer-head">
            <h3 className="cb-offer-title" id="cb-level-new">
              New at {className} {classLevel}
            </h3>
          </div>
          <FeatureList
            items={features.map((feature) => ({
              id: feature.id,
              title: feature.name,
              body: <p>{feature.description}</p>
            }))}
            ariaLabel={`New at ${className} ${classLevel}`}
          />
        </section>
      )}
      {choices.map(renderOffer)}
      {choices.length === 0 && <p className="cb-note">Level {level} asks for no choices besides hit points.</p>}
      {hitPoints}
    </>
  );
}
