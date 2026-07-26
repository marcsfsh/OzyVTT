import type { ReactNode } from "react";
import { cx } from "./util";
import { IconCheck } from "./icons";
import "./Steps.css";

export interface StepItem {
  label: ReactNode;
  /** Plain-text name for the compact (phone) indicator. Defaults to `label`. */
  shortLabel?: string;
}

export interface StepsProps {
  steps: StepItem[];
  /** Zero-based index of the active step; earlier steps read as done. */
  current: number;
  /** Allow jumping back to an already-completed step. Upcoming steps stay locked. */
  onStepSelect?: (index: number) => void;
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
export function Steps({ steps, current, onStepSelect, ariaLabel = "Progress", className }: StepsProps) {
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
          const state = i < index ? "done" : i === index ? "current" : "upcoming";
          const jumpable = onStepSelect != null && state === "done";
          const inner = (
            <>
              <span className="nh-step-marker" aria-hidden="true">{state === "done" ? <IconCheck /> : i + 1}</span>
              <span className="nh-step-label">{step.label}</span>
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
