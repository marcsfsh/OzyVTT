import type { ReactNode } from "react";
import type { ContentFeatureSummary } from "@vtt/domain";
import { FeatureList, type FeatureItem } from "@vtt/ui";
import { titleize, type OfferContext, type StepId } from "./build-payload";
import { withArticle } from "@vtt/domain";

/** The wizard's detail column: what the current pick is, read from the content catalogs. */

/**
 * One row per distinct trait name. Content lists per-lineage variants as separate features
 * (Dragonborn's "Breath Weapon (Fire)" etc.), and the repeats say the same thing.
 */
function featureItems(features: readonly ContentFeatureSummary[], limit = 40): FeatureItem[] {
  const seen = new Set<string>();
  const distinct = features.filter((feature) => (seen.has(feature.name) ? false : (seen.add(feature.name), true)));
  return distinct.slice(0, limit).map((feature) => ({
    id: feature.id,
    title: feature.name,
    meta: feature.level != null ? `Level ${feature.level}` : undefined,
    body: <p>{feature.description}</p>
  }));
}

export function stepDetail(step: StepId, context: OfferContext, level: number): ReactNode {
  if (step === "species" && context.species) {
    return (
      <>
        <p>{context.species.description ?? context.species.summary}</p>
        <FeatureList
          items={featureItems(context.species.features)}
          allowExpandAll={context.species.features.length > 6}
          ariaLabel={`${context.species.name} traits`}
        />
      </>
    );
  }
  if (step === "background" && context.background) {
    return (
      <>
        <p>{context.background.description ?? context.background.summary}</p>
        <p className="tabular">Skills: {context.background.skillProficiencies.map(titleize).join(", ") || "None"}</p>
      </>
    );
  }
  if (step === "class" && context.classRecord) {
    return (
      <>
        <p>{context.classRecord.description ?? context.classRecord.summary}</p>
        <p className="tabular">
          Hit die {context.classRecord.hitDie} · saves{" "}
          {context.classRecord.savingThrows.map((ability) => ability.toUpperCase()).join(", ")}
        </p>
        {/* "None" for absent, as in every review row and allocator cell. */}
        <p className="tabular">
          Armor: {context.classRecord.armorProficiencies.join(", ") || "None"} · weapons:{" "}
          {context.classRecord.weaponProficiencies.join(", ") || "None"}
        </p>
        <FeatureList
          items={featureItems(context.classRecord.features.filter((feature) => (feature.level ?? 1) <= level))}
          allowExpandAll
          ariaLabel={`${context.classRecord.name} features`}
        />
      </>
    );
  }
  if (step === "features" && context.subclass) {
    return (
      <>
        <p>{context.subclass.description ?? context.subclass.summary}</p>
        <FeatureList items={featureItems(context.subclass.features)} ariaLabel={`${context.subclass.name} features`} />
      </>
    );
  }
  return null;
}

/** What the reserved detail column says while it has nothing to show. A subclass pane is reserved
    only when a subclass can be picked; below the subclass level the step body says so and keeps the
    full width. */
export function detailPlaceholder(step: StepId, context: OfferContext, subclassPending: boolean): string | undefined {
  const placeholders: Partial<Record<StepId, string>> = {
    species: "Pick a species to read its traits here.",
    background: "Pick a background to read about it here.",
    class: "Pick a class to read about it here.",
    ...(subclassPending
      ? {}
      : {
          features: context.classRecord?.subclassLabel
            ? `Pick ${withArticle(context.classRecord.subclassLabel.toLowerCase())} to read about it here.`
            : "Pick a subclass to read about it here."
        })
  };
  return placeholders[step];
}
