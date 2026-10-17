import type { BuilderAbilityMethod, BuilderOffer } from "@vtt/domain";
import { ABILITIES, abilityModifier, type Ability } from "@vtt/rules-5e";
import type { ReviewSection } from "@vtt/ui";
import { METHOD_LABELS } from "./AbilitiesStep";
import {
  ABILITY_LABELS,
  ASI_SHORTHAND,
  classLineOf,
  STEP_IDS,
  STEP_LABELS,
  titleize,
  type BuilderDraft,
  type OfferContext,
  type StepId
} from "./build-payload";

function pickedNames(draft: BuilderDraft, offer: BuilderOffer): string {
  const picks = draft.picks[offer.key] ?? [];
  if (picks.length === 0) return "—";
  // The full ability name, matching the "Strength / 17" row above.
  return picks
    .map((id) =>
      id === ASI_SHORTHAND
        ? (draft.asiIncreases[offer.key] ?? [])
            .map((entry) => `+${entry.amount} ${ABILITY_LABELS[entry.ability]}`)
            .join(", ")
        : (offer.options.find((option) => option.id === id)?.name ?? titleize(id))
    )
    .join(", ");
}

type ReviewInput = Readonly<{
  draft: BuilderDraft;
  offers: readonly BuilderOffer[];
  context: OfferContext;
  /** Each step's blocked reason, or null while the catalogs load. */
  stepReasons: readonly (string | null)[] | null;
  base: Readonly<Record<Ability, number | null>>;
  bonuses: Readonly<Record<Ability, number>>;
  method: BuilderAbilityMethod;
  onEdit: (step: StepId) => void;
}>;

function sectionFor(
  input: ReviewInput,
  id: StepId,
  owner: BuilderOffer["step"] | null,
  items: ReviewSection["items"]
): ReviewSection {
  const { draft, offers, stepReasons, onEdit } = input;
  // Stamp the level as the footer does: several ASI decisions would otherwise share one label.
  const siblings = owner ? offers.filter((offer) => offer.step === owner) : [];
  const extra = siblings.map((offer) => ({
    label:
      siblings.filter((other) => other.label === offer.label).length > 1
        ? `${offer.label} (level ${offer.level})`
        : offer.label,
    value: pickedNames(draft, offer)
  }));
  const reason = stepReasons ? stepReasons[STEP_IDS.indexOf(id)] : null;
  return {
    id,
    title: STEP_LABELS[id],
    items: [...items, ...extra],
    onEdit: () => onEdit(id),
    ...(reason ? { incomplete: reason } : {})
  };
}

/** The review step's summary: one section per step, each with its picks and a way back to edit it. */
export function reviewSections(input: ReviewInput): ReviewSection[] {
  const { draft, context, base, bonuses, method } = input;
  const scoreItems = ABILITIES.map((ability) => {
    const total = base[ability] == null ? null : base[ability]! + bonuses[ability];
    const modifier = total == null ? null : abilityModifier(total);
    return {
      label: ABILITY_LABELS[ability],
      // The modifier is what the player rolls with, so show it beside the score.
      value:
        total == null
          ? "—"
          : `${total}${bonuses[ability] ? ` (${base[ability]} +${bonuses[ability]})` : ""} · ${modifier! >= 0 ? "+" : ""}${modifier}`,
      numeric: true
    };
  });
  return [
    sectionFor(input, "species", "species", [{ label: "Species", value: context.species?.name ?? "—" }]),
    sectionFor(input, "background", "background", [
      { label: "Background", value: context.background?.name ?? "—" },
      ...(context.originFeat ? [{ label: "Origin feat", value: context.originFeat.name }] : [])
    ]),
    sectionFor(input, "class", "class", [
      { label: context.classes.length > 1 ? "Classes" : "Class", value: classLineOf(context) ?? "—" },
      { label: "Level", value: String(draft.level), numeric: true },
      context.classes.length > 1
        ? {
            label: "Hit dice",
            value: context.classes.map(({ record, levels }) => `${levels}${record.hitDie}`).join(" + "),
            numeric: true
          }
        : { label: "Hit die", value: context.hitDie ?? "—", numeric: true }
    ]),
    /* No separate subclass item: the subclass is a feature offer, so `sectionFor` already emits it. */
    sectionFor(input, "features", "features", []),
    sectionFor(input, "abilities", null, [
      ...scoreItems,
      { label: "Method", value: METHOD_LABELS[method] },
      {
        label: "Hit points",
        value:
          draft.hpMode === "average"
            ? "Average each level"
            : draft.hpMode === "roll"
              ? "Rolled by the table"
              : draft.hpEntries.length > 0
                ? `Rolled ${draft.hpEntries.join(", ")}`
                : "Rolled (none entered)"
      }
    ]),
    sectionFor(input, "equipment", "equipment", [])
  ];
}
