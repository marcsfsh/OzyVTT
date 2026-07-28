import type { ReactNode } from "react";
import { cx } from "./util";
import { IconCheck, IconWarning } from "./icons";
import "./Steps.css";

export interface StepItem {
  label: ReactNode;
  /** Plain-text name for the compact (phone) indicator. Defaults to `label`. */
  shortLabel?: string;
  /** Overrides the position-derived state for a step that is NOT the current one.
      Position alone can only say "before" and "after"; a flow that knows whether a
      visited step is actually finished says so here, so a step the player left
      unanswered stops claiming a check mark. Never overrides `current`. */
  state?: "done" | "incomplete";
}

export interface StepsProps {
  steps: StepItem[];
  /** Zero-based index of the active step; earlier steps read as done. */
  current: number;
  /** Allow jumping back to an already-completed step. Upcoming steps stay locked. */
  onStepSelect?: (index: number) => void;
  /** Highest index the flow will accept a jump to (inclusive). Supplied, it REPLACES
      the "done steps only" rule: a visited-but-unfinished step stays reachable, and
      steps past the frontier stay locked. Omitted, nothing changes. */
  maxSelectable?: number;
  /** Accessible name for the flow — used by the compact indicator's progress bar. */
  ariaLabel?: string;
  className?: string;
}

/** Progress indicator for multi-step flows: character builder, map calibration,
    content-import wizards. Two forms, one component, swapped by media query so
    there is no resize listener and no JS breakpoint to drift:

      - ≤760px: "Step 3 of 7" + the step name + a progress bar. A seven-step flow
        would otherwise wrap into a multi-row blob at 375px.
      - >760px: the full horizontal rail — done steps check off, the current step
        glows, upcoming steps stay quiet. It scrolls sideways rather than wrapping.

    Only one form is displayed at a time, so `display:none` keeps the other out of
    the accessibility tree too. */
export function Steps({ steps, current, onStepSelect, maxSelectable, ariaLabel = "Progress", className }: StepsProps) {
  const total = Math.max(steps.length, 1);
  const index = Math.min(Math.max(current, 0), total - 1);
  const active = steps[index];
  const activeName = active?.shortLabel ?? active?.label;
  const percent = ((index + 1) / total) * 100;

  return (
    <div className={cx("nh-steps-wrap", className)}>
      <div className="nh-steps-compact">
        <div className="nh-steps-compact-head">
          <span className="nh-steps-count tabular">Step {index + 1} of {total}</span>
          <span className="nh-steps-compact-label">{activeName}</span>
        </div>
        <div
          className="nh-steps-bar"
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${index + 1} of ${total}`}
        >
          <div className="nh-steps-bar-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <ol className="nh-steps" aria-label={ariaLabel}>
        {steps.map((step, i) => {
          // Precedence, in this order: the current step wins outright; then whatever the flow
          // declared; then position, exactly as before. With neither new prop supplied this is the
          // original expression.
          const state = i === index ? "current" : step.state ?? (i < index ? "done" : "upcoming");
          const jumpable = onStepSelect != null && i !== index
            && (maxSelectable != null ? i <= maxSelectable : state === "done");
          const inner = (
            <>
              {/* Three marks, never three colours: the check for done, the system's one caution mark
                  for a step left unfinished, the number for one not reached yet. The caution mark is
                  the SAME glyph the footer's blocked reason uses, so "not finished" reads the same
                  in the rail as it does in the sentence explaining it. */}
              <span className="nh-step-marker" aria-hidden="true">
                {state === "done" ? <IconCheck /> : state === "incomplete" ? <IconWarning /> : i + 1}
              </span>
              <span className="nh-step-label">
                {step.label}
                {/* The check mark is decorative, so "done" and "not finished" would otherwise sound
                    identical. Said only when the flow declared a state — position-derived rails
                    keep their original, unannotated names. */}
                {step.state != null && state !== "current" && (
                  <span className="nh-sr-only">{state === "done" ? " — done" : " — not finished"}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={i} className={cx("nh-step", `nh-step--${state}`)} aria-current={state === "current" ? "step" : undefined}>
              {jumpable
                ? <button type="button" className="nh-step-jump interactive" onClick={() => onStepSelect?.(i)}>{inner}</button>
                : inner}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
