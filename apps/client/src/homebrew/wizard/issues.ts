/** Where a publish requirement belongs in a wizard: the step that owns its path (or, without a path, the step
    standing in for its editor section) and, inside that step, the question that answers it. The requirements
    themselves are the editor's (`publishIssues`, then the server's verdict); a wizard only places them. */

import type { Draft, FieldDef } from "../schema";
import type { BlockedReason } from "../validate";
import { isCustomQuestion, type WizardStep } from "./types";

export type PlacedIssue = BlockedReason &
  Readonly<{
    /** Null when no step answers it; the review step lists it, with the editor as the way to fix it. */
    stepId: string | null;
    /** The question to point at, when one of the step's fields answers the path. */
    questionKey: string | null;
  }>;

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}.`);

/** A step's question keys: its fields through groups, as the renderer lays them out, and its own composers. */
export function questionKeys(step: WizardStep): readonly string[] {
  const out: string[] = [];
  const walk = (fields: readonly FieldDef[]) => {
    for (const field of fields) {
      out.push(field.key);
      if (field.kind === "group" && field.rows) walk(field.rows);
    }
  };
  for (const question of step.questions ?? []) {
    if (isCustomQuestion(question)) out.push(question.key);
    else walk([question]);
  }
  return out;
}

function stepFor(steps: readonly WizardStep[], reason: BlockedReason, draft: Draft): WizardStep | null {
  const segments = reason.segments;
  if (segments) {
    const claimant = steps.find((step) => step.claims?.(segments, draft));
    if (claimant) return claimant;
  }
  const path = reason.path;
  if (path) {
    const owner = steps.find((step) => step.owns.some((prefix) => under(path, prefix)));
    if (owner) return owner;
  }
  const section = reason.sectionId;
  if (section) return steps.find((step) => step.sections.includes(section)) ?? null;
  return null;
}

/** The longest field key the path falls under, so `range.distance` points at the range question. */
function questionFor(step: WizardStep, path: string): string | null {
  let best: string | null = null;
  for (const key of questionKeys(step)) {
    if (!key || !under(path, key)) continue;
    if (best === null || key.length > best.length) best = key;
  }
  return best;
}

export function placeIssues(
  steps: readonly WizardStep[],
  reasons: readonly BlockedReason[],
  draft: Draft
): readonly PlacedIssue[] {
  return reasons.map((reason) => {
    const step = stepFor(steps, reason, draft);
    return {
      ...reason,
      stepId: step?.id ?? null,
      questionKey: step && reason.path ? questionFor(step, reason.path) : null
    };
  });
}
