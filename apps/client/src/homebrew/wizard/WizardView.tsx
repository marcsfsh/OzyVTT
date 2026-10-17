/**
 * One wizard, any type: the step list (a column on a laptop, "Step 2 of 7" on a phone), one step's questions, the
 * live preview beside them (one tap away on a phone), and Back / Next. The last step is the review, where the
 * editor's own publish checklist is read back step by step and Publish lives.
 *
 * It owns no record state. `RecordDetail` holds the draft, its autosave and the publish action, so the wizard and
 * the full editor are two views of one draft and switching between them loses nothing.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, IconChevron, Steps, type StepItem } from "@vtt/ui";
import { FieldRenderer } from "../FieldRenderer";
import type { HomebrewValidationIssue } from "../api";
import type { Draft, FieldDef, SchemaContext } from "../schema";
import type { SpellMembership } from "../SpellListContents";
import { typeLabel } from "../types";
import type { BlockedReason } from "../validate";
import { placeIssues, type PlacedIssue } from "./issues";
import { isCustomQuestion, type WizardDef, type WizardStep } from "./types";
import "./wizard.css";

export const REVIEW_STEP = "review";

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type WizardViewProps = Readonly<{
  def: WizardDef;
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  recordId: string;
  spells: readonly SpellMembership[];
  /** Everything outstanding before publish: the editor's checklist, the server's verdict behind it. */
  checklist: readonly BlockedReason[];
  /** Never blocking: the server's "worth checking" notes. */
  warnings: readonly HomebrewValidationIssue[];
  stepId: string;
  onStep: (stepId: string) => void;
  /** Steps the GM has been through; their outstanding answers are pointed at, untouched ones are left alone. */
  visited: ReadonlySet<string>;
  onVisited: (stepId: string) => void;
  /** "Publish" or "Update", or null when there is nothing to put live. */
  publishLabel: string | null;
  onPublish: () => void;
  busy: boolean;
  actionError: string | null;
  /** What review says once the record is live, and the switch that shows it to players. */
  published: ReactNode;
  onOpenEditor: (sectionId: string | null) => void;
}>;

/** The steps the record's answers keep, then the review. */
export function wizardSteps(def: WizardDef, draft: Draft): readonly WizardStep[] {
  return [
    ...def.steps.filter((step) => !step.visibleWhen || step.visibleWhen(draft)),
    { id: REVIEW_STEP, title: "Review", owns: [], sections: [] }
  ];
}

/** A field asked inside a wizard, carrying the requirement placed on it, once its step has been through. */
function withIssue(field: FieldDef, issue: string | null): FieldDef {
  if (!issue) return field;
  return {
    ...field,
    validate: (value, scope, ctx) => field.validate?.(value, scope, ctx) ?? issue
  };
}

export function WizardView(props: WizardViewProps) {
  const { def, draft, onDraft, ctx, recordId, spells, checklist, stepId, onStep, visited, onVisited } = props;
  const steps = useMemo(() => wizardSteps(def, draft), [def, draft]);
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === stepId)
  );
  const step = steps[index];
  const isReview = step.id === REVIEW_STEP;
  const placed = useMemo(() => placeIssues(steps, checklist), [steps, checklist]);
  const issuesOf = (id: string) => placed.filter((issue) => issue.stepId === id);
  const [previewOpen, setPreviewOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | null>(null);

  // A new step starts at its top with its heading announced, or at the question a review line pointed to.
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
    const key = pendingFocus.current;
    pendingFocus.current = null;
    const question = key ? bodyRef.current?.querySelector<HTMLElement>(`[data-question="${key}"]`) : null;
    if (question) {
      question.scrollIntoView({ block: "center" });
      question.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    } else {
      headingRef.current?.focus();
    }
  }, [step.id]);

  const go = (target: number) => {
    const next = steps[Math.min(Math.max(target, 0), steps.length - 1)];
    onVisited(step.id);
    setPreviewOpen(false);
    onStep(next.id);
  };
  const goToIssue = (issue: PlacedIssue) => {
    if (!issue.stepId) return;
    pendingFocus.current = issue.questionKey;
    onVisited(step.id);
    setPreviewOpen(false);
    onStep(issue.stepId);
  };

  const stepItems: StepItem[] = steps.map((entry) => {
    const outstanding = entry.id === REVIEW_STEP ? checklist.length > 0 : issuesOf(entry.id).length > 0;
    return {
      label: entry.title,
      ...(visited.has(entry.id) && entry.id !== REVIEW_STEP ? { state: outstanding ? "incomplete" : "done" } : {})
    };
  });

  const stepIssues = issuesOf(step.id);
  const showIssues = visited.has(step.id) && stepIssues.length > 0;
  const issueFor = (key: string) =>
    showIssues ? (stepIssues.find((issue) => issue.questionKey === key)?.text ?? null) : null;
  const idPrefix = `hb-wiz-${def.type}-${step.id}`;
  const blocked = checklist.length > 0;

  return (
    <div className={`hb-wiz${previewOpen ? " is-previewing" : ""}`}>
      <nav className="hb-wiz-steps scroll-y" aria-label="Steps">
        <Steps
          steps={stepItems}
          current={index}
          orientation="vertical"
          onStepSelect={(target) => go(target)}
          maxSelectable={steps.length - 1}
          ariaLabel={`${capitalized(typeLabel(def.type))} steps`}
        />
      </nav>

      <section className="hb-wiz-body scroll-y" ref={bodyRef} aria-labelledby={`${idPrefix}-heading`}>
        <div className="hb-wiz-step-head">
          <h3 className="hb-wiz-heading" id={`${idPrefix}-heading`} tabIndex={-1} ref={headingRef}>
            {step.title}
          </h3>
          <Button variant="ghost" size="sm" className="hb-wiz-preview-open" onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
        </div>

        {isReview ? (
          <ReviewStep
            steps={steps}
            placed={placed}
            warnings={props.warnings}
            blocked={blocked}
            actionError={props.actionError}
            published={props.published}
            onGo={goToIssue}
            onOpenEditor={props.onOpenEditor}
          />
        ) : (
          <>
            {step.intro && <p className="hb-wiz-intro">{step.intro}</p>}
            {showIssues && (
              <div className="hb-wiz-todo" role="status">
                <p className="hb-wiz-todo-title">Still needed here</p>
                <ul className="hb-wiz-todo-list">
                  {stepIssues.map((issue, issueIndex) => (
                    <li key={`${issue.path ?? ""}-${issueIndex}`}>{issue.text}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="hb-wiz-questions">
              {(step.questions ?? []).map((question, questionIndex) =>
                // A hidden question takes no row, so a step's spacing does not show what it is not asking.
                !isCustomQuestion(question) && question.visibleWhen && !question.visibleWhen(draft, draft) ? null : (
                  <div
                    className="hb-wiz-question"
                    data-question={question.key}
                    key={`${question.key}-${questionIndex}`}
                  >
                    {isCustomQuestion(question) ? (
                      question.render({ draft, onDraft, ctx, recordId, spells, idPrefix })
                    ) : (
                      <FieldRenderer
                        field={withIssue(question, issueFor(question.key))}
                        value={draft}
                        onValue={onDraft}
                        draft={draft}
                        onDraft={onDraft}
                        ctx={ctx}
                        idPrefix={idPrefix}
                      />
                    )}
                  </div>
                )
              )}
            </div>
          </>
        )}
      </section>

      <aside className="hb-wiz-preview scroll-y" aria-label="Preview">
        <div className="hb-wiz-preview-head">
          <Button variant="ghost" size="sm" className="hb-wiz-preview-back" onClick={() => setPreviewOpen(false)}>
            <span className="hb-wiz-back-icon" aria-hidden="true">
              <IconChevron />
            </span>
            Back to the questions
          </Button>
          <h3 className="hb-wiz-preview-title">As the table sees it</h3>
        </div>
        <def.Preview draft={draft} ctx={ctx} recordId={recordId} />
      </aside>

      <footer className="hb-wiz-foot">
        <div className="hb-wiz-foot-back">
          {index > 0 && (
            <Button variant="secondary" onClick={() => go(index - 1)} disabled={props.busy}>
              Back
            </Button>
          )}
        </div>
        <div className="hb-wiz-foot-next">
          {!isReview ? (
            <Button variant="primary" arrow onClick={() => go(index + 1)}>
              {steps[index + 1]?.id === REVIEW_STEP ? "Review" : "Next"}
            </Button>
          ) : (
            props.publishLabel && (
              <Button variant="primary" onClick={props.onPublish} disabled={blocked || props.busy}>
                {props.publishLabel}
              </Button>
            )
          )}
        </div>
      </footer>
    </div>
  );
}

function ReviewStep({
  steps,
  placed,
  warnings,
  blocked,
  actionError,
  published,
  onGo,
  onOpenEditor
}: Readonly<{
  steps: readonly WizardStep[];
  placed: readonly PlacedIssue[];
  warnings: readonly HomebrewValidationIssue[];
  blocked: boolean;
  actionError: string | null;
  published: ReactNode;
  onGo: (issue: PlacedIssue) => void;
  onOpenEditor: (sectionId: string | null) => void;
}>) {
  const unplaced = placed.filter((issue) => issue.stepId === null);
  return (
    <div className="hb-wiz-review">
      {actionError && (
        <p className="hb-blocked" role="alert">
          {actionError}
        </p>
      )}
      {!blocked ? (
        (published ?? (
          <p className="hb-wiz-intro">
            Everything the game needs is here. Publish it to use it at the table; players see it only once you show it
            to them.
          </p>
        ))
      ) : (
        <>
          <p className="hb-wiz-intro">
            {placed.length === 1 ? "One thing is left" : `${placed.length} things are left`} before this can be
            published.
          </p>
          {steps
            .filter((step) => placed.some((issue) => issue.stepId === step.id))
            .map((step) => (
              <div key={step.id} className="hb-wiz-review-group">
                <p className="hb-wiz-review-step">{step.title}</p>
                <ul className="hb-wiz-todo-list">
                  {placed
                    .filter((issue) => issue.stepId === step.id)
                    .map((issue, issueIndex) => (
                      <li key={`${issue.path ?? ""}-${issueIndex}`} className="hb-wiz-review-line">
                        <span>{issue.text}</span>
                        <Button variant="secondary" size="sm" className="tap-target" onClick={() => onGo(issue)}>
                          Go to it
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          {unplaced.length > 0 && (
            <div className="hb-wiz-review-group">
              <p className="hb-wiz-review-step">In the full editor</p>
              <ul className="hb-wiz-todo-list">
                {unplaced.map((issue, issueIndex) => (
                  <li key={`${issue.path ?? ""}-${issueIndex}`} className="hb-wiz-review-line">
                    <span>{issue.text}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="tap-target"
                      onClick={() => onOpenEditor(issue.sectionId ?? null)}
                    >
                      Open it
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {warnings.length > 0 && (
        <Alert tone="info" title="Worth checking">
          <ul className="hb-warnings">
            {warnings.map((warning, warningIndex) => (
              <li key={`${warning.path.join(".")}-${warningIndex}`}>{warning.message}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
