/** The steps a record is made and edited in: its wizard's steps that fit the record, a step for any part of the
    editor no step covers, and the review. Creating and editing walk the same list. */

import { SCHEMAS } from "../schemas";
import type { Draft, FieldDef } from "../schema";
import { questionKeys } from "./issues";
import type { WizardDef, WizardStep } from "./types";

export const REVIEW_STEP = "review";
export const OTHER_STEP = "other";

export function wizardSteps(def: WizardDef, draft: Draft): readonly WizardStep[] {
  const covered = new Set(def.steps.flatMap((step) => step.sections));
  const uncovered = SCHEMAS[def.type].sections
    .filter((section) => !covered.has(section.id) && (!section.visibleWhen || section.visibleWhen(draft)))
    .map((section) => section.id);
  return [
    ...def.steps.filter((step) => !step.visibleWhen || step.visibleWhen(draft)),
    ...(uncovered.length > 0
      ? [{ id: OTHER_STEP, title: "Other details", owns: [], sections: uncovered } satisfies WizardStep]
      : []),
    { id: REVIEW_STEP, title: "Review", owns: [], sections: [] }
  ];
}

const under = (key: string, prefix: string) => key === prefix || key.startsWith(`${prefix}.`);

/**
 * The editor's own fields that no step asks, each in one step: the step that owns its path, or else the first that
 * stands in for its section. Every answer the full editor has keeps one place in the steps, and none is asked twice.
 * A group the steps ask part of keeps the rest of its rows.
 */
export function moreFields(def: WizardDef, step: WizardStep, draft: Draft): readonly FieldDef[] {
  const steps = wizardSteps(def, draft);
  const asked = def.steps.flatMap((entry) => [...questionKeys(entry), ...(entry.covers ?? [])]);
  const isAsked = (key: string) => asked.some((one) => under(one, key) || under(key, one));
  const homeOf = (sectionId: string, key: string) =>
    (
      steps.find((entry) => entry.sections.includes(sectionId) && entry.owns.some((prefix) => under(key, prefix))) ??
      steps.find((entry) => entry.sections.includes(sectionId))
    )?.id;
  const out: FieldDef[] = [];
  for (const sectionId of step.sections) {
    const section = SCHEMAS[def.type].sections.find((entry) => entry.id === sectionId);
    if (!section || (section.visibleWhen && !section.visibleWhen(draft))) continue;
    for (const field of section.fields) {
      if (out.some((held) => held.key === field.key) || homeOf(sectionId, field.key) !== step.id) continue;
      if (field.kind === "group" && field.rows) {
        if (asked.some((one) => one === field.key)) continue;
        const rest = field.rows.filter((row) => !isAsked(row.key));
        if (rest.length === field.rows.length) out.push(field);
        else if (rest.length > 0) out.push({ ...field, rows: rest });
        continue;
      }
      if (!isAsked(field.key)) out.push(field);
    }
  }
  return out;
}
