import type { ReactNode } from "react";
import { cx } from "./util";
import "./Steps.css";

export interface StepItem {
  label: ReactNode;
}

export interface StepsProps {
  steps: StepItem[];
  /** Zero-based index of the active step; earlier steps read as done. */
  current: number;
  className?: string;
}

/** Horizontal progress indicator for multi-step flows: character builder,
    map calibration, content-import wizards. Done steps get a check, the current
    step glows, upcoming steps stay quiet. */
export function Steps({ steps, current, className }: StepsProps) {
  return (
    <ol className={cx("nh-steps", className)}>
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={index} className={cx("nh-step", `nh-step--${state}`)} aria-current={state === "current" ? "step" : undefined}>
            <span className="nh-step-marker" aria-hidden="true">{state === "done" ? "✓" : index + 1}</span>
            <span className="nh-step-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
