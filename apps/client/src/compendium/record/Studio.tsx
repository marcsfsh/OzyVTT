import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, IconArrow, IconCheck, IconEye, IconWarning, Modal, Steps, cx, type StepItem } from "@vtt/ui";
import { FieldRenderer, type CustomRenderer } from "../../homebrew/FieldRenderer";
import type { HomebrewValidationIssue } from "../../homebrew/api";
import type { Draft, FieldDef, SchemaContext } from "../../homebrew/schema";
import type { SpellMembership } from "../../homebrew/SpellListContents";
import type { BlockedReason } from "../../homebrew/validate";
import { placeIssues, type PlacedIssue } from "../../homebrew/wizard/issues";
import { OTHER_STEP, REVIEW_STEP, moreFields, wizardSteps } from "../../homebrew/wizard/steps";
import { isCustomQuestion, type WizardDef, type WizardStep } from "../../homebrew/wizard/types";
import "../../homebrew/homebrew.css";
import "../../homebrew/wizard/wizard.css";

/**
 * The record's questions, as C's studio lays them out: the steps down the left, each marked done, current or missing
 * something, the step's questions in the middle, and the preview pinned on the right from 980 pixels. Steps shows one
 * step at a time, All questions every step on one page. The steps are the wizard's, which are data over the editor's
 * own fields, and each step also holds the editor's other fields for its part of the record, so nothing the full
 * editor asked lost its place. On a phone the steps are a strip across the top, and the preview is a bar over the
 * bottom tabs that opens full screen.
 *
 * It owns no record state: the record view holds the draft, its autosave and Publish, so Card, Edit, Sharing and
 * History are views of one draft.
 */

export type StudioMode = "steps" | "all";

export type StudioProps = Readonly<{
  def: WizardDef;
  draft: Draft;
  onDraft: (next: Draft) => void;
  ctx: SchemaContext;
  recordId: string;
  spells: readonly SpellMembership[];
  /** Everything outstanding before publish: the editor's checklist, the server's verdict behind it. */
  checklist: readonly BlockedReason[];
  /** The server's warnings, which never block a publish. */
  warnings: readonly HomebrewValidationIssue[];
  stepId: string;
  onStep: (stepId: string) => void;
  visited: ReadonlySet<string>;
  onVisited: (stepId: string) => void;
  /** A record opened to edit has been through every step; a new one has been through the ones the GM has seen. */
  seenAll: boolean;
  mode: StudioMode;
  /** The editor's bespoke parts: the level table, features, riders and a spell list's contents. */
  custom: Readonly<Record<string, CustomRenderer>>;
  /** "Publish" or "Update", or null when there is nothing to put live. */
  publishLabel: string | null;
  onPublish: () => void;
  busy: boolean;
  /** What review says once the record is live. */
  published: ReactNode;
  /** The record as people meet it, pinned beside the questions. */
  preview: ReactNode;
  /** One line about the record for the phone's preview bar. */
  previewLine: string;
  /** Wide enough to pin the preview. */
  wide: boolean;
  phone: boolean;
  /** A note above the questions: the name another record shares. */
  note?: ReactNode;
}>;

/** Each step's readiness: done, missing something, or not reached yet. */
export function stepStates(
  steps: readonly WizardStep[],
  placed: readonly PlacedIssue[],
  visited: ReadonlySet<string>,
  seenAll: boolean
): ReadonlyMap<string, "done" | "incomplete" | "upcoming"> {
  return new Map(
    steps.map((step) => {
      if (step.id === REVIEW_STEP) return [step.id, placed.length === 0 ? "done" : "incomplete"] as const;
      const seen = seenAll || visited.has(step.id);
      const open = placed.some((issue) => issue.stepId === step.id);
      return [step.id, open && seen ? "incomplete" : seen && !open ? "done" : "upcoming"] as const;
    })
  );
}

/** A field the step asks, carrying the requirement placed on it once the step has been through. */
function withIssue(field: FieldDef, issue: string | null): FieldDef {
  if (!issue) return field;
  return { ...field, validate: (value, scope, ctx) => field.validate?.(value, scope, ctx) ?? issue };
}

export function useStudioPlan(def: WizardDef, draft: Draft, checklist: readonly BlockedReason[]) {
  const steps = useMemo(() => wizardSteps(def, draft), [def, draft]);
  const placed = useMemo(() => placeIssues(steps, checklist, draft), [steps, checklist, draft]);
  return { steps, placed };
}

export function Studio(props: StudioProps) {
  const { def, draft, onDraft, ctx, recordId, spells, checklist, stepId, onStep, visited, onVisited, mode } = props;
  const { steps, placed } = useStudioPlan(def, draft, checklist);
  const states = stepStates(steps, placed, visited, props.seenAll);
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === stepId)
  );
  const step = steps[index]!;
  const [previewOpen, setPreviewOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | null>(null);

  // A new step starts at its top with its heading announced, or at the question a review line pointed to. In All
  // questions a step is a place on the page, so moving to it scrolls there. Opening the studio moves nothing.
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      return;
    }
    const key = pendingFocus.current;
    pendingFocus.current = null;
    const root = bodyRef.current;
    if (!root) return;
    const scope = mode === "all" ? root.querySelector<HTMLElement>(`[data-step="${step.id}"]`) : root;
    const question = key ? scope?.querySelector<HTMLElement>(`[data-question="${key}"]`) : null;
    if (question) {
      question.scrollIntoView?.({ block: "center" });
      question.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    } else if (mode === "all") {
      scope?.scrollIntoView?.({ block: "start" });
      scope?.querySelector<HTMLElement>("h3")?.focus();
    } else {
      root.scrollTo?.({ top: 0 });
      headingRef.current?.focus();
    }
  }, [step.id, mode]);

  // The phone's strip keeps the step in view as the GM moves along it.
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>("[aria-current='step']")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [step.id]);

  const go = (target: number) => {
    const next = steps[Math.min(Math.max(target, 0), steps.length - 1)]!;
    onVisited(step.id);
    onStep(next.id);
  };
  const goToIssue = (issue: PlacedIssue) => {
    if (!issue.stepId) return;
    pendingFocus.current = issue.questionKey;
    onVisited(step.id);
    onStep(issue.stepId);
  };

  const stepItems: StepItem[] = steps.map((entry) => {
    const state = states.get(entry.id);
    return { label: entry.title, ...(state === "done" || state === "incomplete" ? { state } : {}) };
  });
  const blocked = checklist.length > 0;
  const isReview = step.id === REVIEW_STEP;

  const stepBody = (entry: WizardStep, own: boolean) => {
    const idPrefix = `cp-step-${def.type}-${entry.id}`;
    const stepIssues = placed.filter((issue) => issue.stepId === entry.id);
    const showIssues = (props.seenAll || visited.has(entry.id)) && stepIssues.length > 0;
    const issueFor = (key: string) =>
      showIssues ? (stepIssues.find((issue) => issue.questionKey === key)?.text ?? null) : null;
    const extra = moreFields(def, entry, draft);
    const fields = (list: readonly FieldDef[]) =>
      list.map((field) => (
        <div className="cp-question" data-question={field.key} key={field.key}>
          <FieldRenderer
            field={withIssue(field, issueFor(field.key))}
            value={draft}
            onValue={onDraft}
            draft={draft}
            onDraft={onDraft}
            ctx={ctx}
            idPrefix={idPrefix}
            custom={props.custom}
          />
        </div>
      ));
    return (
      <section className="cp-step" data-step={entry.id} aria-labelledby={`${idPrefix}-heading`} key={entry.id}>
        <div className="cp-step-head">
          <h3 className="cp-step-title" id={`${idPrefix}-heading`} tabIndex={-1} ref={own ? headingRef : undefined}>
            {entry.title}
          </h3>
          {entry.intro && <p className="cp-step-intro">{entry.intro}</p>}
        </div>
        {entry.id === REVIEW_STEP ? (
          <ReviewStep
            steps={steps}
            placed={placed}
            warnings={props.warnings}
            blocked={blocked}
            published={props.published}
            onGo={goToIssue}
          />
        ) : (
          <>
            {showIssues && (
              <div className="cp-todo" role="status">
                <p className="cp-todo-title">Still needed here</p>
                <ul className="cp-todo-list">
                  {stepIssues.map((issue, issueIndex) => (
                    <li key={`${issue.path ?? ""}-${issueIndex}`}>{issue.text}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="cp-questions">
              {(entry.questions ?? []).map((question, questionIndex) =>
                // A hidden question takes no row, so a step's spacing does not show what it is not asking.
                !isCustomQuestion(question) && question.visibleWhen && !question.visibleWhen(draft, draft) ? null : (
                  <div className="cp-question" data-question={question.key} key={`${question.key}-${questionIndex}`}>
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
              {extra.length > 0 &&
                (entry.id === OTHER_STEP ? (
                  fields(extra)
                ) : (
                  <details className="cp-more" open={mode === "all" ? true : undefined}>
                    <summary className="cp-more-summary">More answers for {entry.title.toLowerCase()}</summary>
                    <div className="cp-questions">{fields(extra)}</div>
                  </details>
                ))}
            </div>
          </>
        )}
      </section>
    );
  };

  const next = steps[index + 1];
  const footer =
    mode === "steps" ? (
      <footer className="cp-step-foot">
        <Button variant="secondary" size="sm" onClick={() => go(index - 1)} disabled={index === 0 || props.busy}>
          Back
        </Button>
        <span className="cp-grow" />
        {!isReview && next ? (
          <Button size="sm" className="cp-next" onClick={() => go(index + 1)}>
            <IconArrow /> {props.phone ? "Next" : `Next: ${next.title}`}
          </Button>
        ) : (
          isReview &&
          props.publishLabel && (
            <Button variant="primary" onClick={props.onPublish} disabled={blocked || props.busy}>
              {props.publishLabel}
            </Button>
          )
        )}
      </footer>
    ) : null;

  return (
    <div className={cx("cp-studio", props.wide && "is-wide", props.phone && "is-phone", `is-${mode}`)}>
      {props.phone ? (
        <nav className="cp-stepstrip" aria-label="Steps" ref={stripRef}>
          {steps.map((entry, entryIndex) => {
            const state = states.get(entry.id);
            return (
              <button
                key={entry.id}
                type="button"
                className={cx("cp-stepchip", entry.id === step.id && "is-now", state && `is-${state}`)}
                aria-current={entry.id === step.id ? "step" : undefined}
                onClick={() => go(entryIndex)}
              >
                {state === "done" && entry.id !== step.id && <IconCheck />}
                {state === "incomplete" && entry.id !== step.id && <IconWarning />}
                {entry.title}
              </button>
            );
          })}
        </nav>
      ) : (
        <nav className="cp-studio-steps scroll-y" aria-label="Steps">
          <Steps
            steps={stepItems}
            current={index}
            orientation="vertical"
            onStepSelect={(target) => go(target)}
            maxSelectable={steps.length - 1}
            ariaLabel={`${def.type === "equipment" ? "Item" : def.type} steps`}
          />
        </nav>
      )}

      <div className="cp-studio-main">
        <div className="cp-studio-body scroll-y" ref={bodyRef}>
          {props.note}
          {mode === "all" ? steps.map((entry) => stepBody(entry, entry.id === step.id)) : stepBody(step, true)}
        </div>
        {footer}
      </div>

      {props.wide && !props.phone && (
        <aside className="cp-studio-preview scroll-y" aria-label="Preview">
          <p className="cp-eyebrow">Preview</p>
          {props.preview}
        </aside>
      )}

      {!props.wide && (
        <div className="cp-peek">
          <IconEye />
          <span className="cp-peek-line">{props.previewLine}</span>
          <Button size="sm" onClick={() => setPreviewOpen(true)}>
            Preview
          </Button>
        </div>
      )}
      {previewOpen && (
        <Modal open size="full" title="Preview" onClose={() => setPreviewOpen(false)} className="cp-preview-modal">
          {props.preview}
        </Modal>
      )}
    </div>
  );
}

function ReviewStep({
  steps,
  placed,
  warnings,
  blocked,
  published,
  onGo
}: Readonly<{
  steps: readonly WizardStep[];
  placed: readonly PlacedIssue[];
  warnings: readonly HomebrewValidationIssue[];
  blocked: boolean;
  published: ReactNode;
  onGo: (issue: PlacedIssue) => void;
}>) {
  const unplaced = placed.filter((issue) => issue.stepId === null);
  return (
    <div className="cp-review">
      {!blocked ? (
        (published ?? (
          <p className="cp-step-intro">
            Everything the game needs is here. Publish it to use it at the table. Players get it only once you share it.
          </p>
        ))
      ) : (
        <>
          <p className="cp-step-intro">
            {placed.length === 1 ? "One thing is left" : `${placed.length} things are left`} before this can be
            published.
          </p>
          {steps
            .filter((step) => placed.some((issue) => issue.stepId === step.id))
            .map((step) => (
              <div key={step.id} className="cp-review-group">
                <p className="cp-eyebrow">{step.title}</p>
                <ul className="cp-review-list">
                  {placed
                    .filter((issue) => issue.stepId === step.id)
                    .map((issue, issueIndex) => (
                      <li key={`${issue.path ?? ""}-${issueIndex}`} className="cp-problem">
                        <IconWarning />
                        <span className="cp-grow">{issue.text}</span>
                        <Button variant="secondary" size="sm" onClick={() => onGo(issue)}>
                          Go to it
                        </Button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          {unplaced.length > 0 && (
            <div className="cp-review-group">
              <p className="cp-eyebrow">The whole record</p>
              <ul className="cp-review-list">
                {unplaced.map((issue, issueIndex) => (
                  <li key={`${issue.path ?? ""}-${issueIndex}`} className="cp-problem">
                    <IconWarning />
                    <span className="cp-grow">{issue.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {warnings.length > 0 && (
        <Alert tone="info" title="Warnings">
          <ul className="cp-review-list">
            {warnings.map((warning, warningIndex) => (
              <li key={`${warning.path.join(".")}-${warningIndex}`}>{warning.message}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
